// _shared/llm.ts — el único camino de las functions al LLM.
//
// Centraliza lo que hoy vive repartido en el server (plan-salida-hermes §4.2):
// el selector de modelo del panel (mata a seguir-cuota.sh), el freno de cuota
// por ventana de 5h (el MESA_MAX_GLOBAL acordado el 2026-08-07), el gate de
// llamadas EN VUELO (sin él, 30 facturas de golpe repiten la estampida de 429
// del 2026-08-03), la cadena z.AI → OpenRouter con la matriz código→acción
// completa (modelo-zai.md + replay-skill.py + alerta-cuota.sh), y el registro
// de CADA llamada en qualia_llm_uso (mata a registrar-consumo.py).
//
// Env: ZAI_API_KEY, OPENROUTER_API_KEY.
import { sb, configGlobal } from './db.ts';

// La trampa del endpoint (modelo-zai.md): con el Coding Plan solo atiende el
// endpoint coding; el general responde 429 code 1113 que NO es rate-limit.
const ZAI_COMPLETIONS = 'https://api.z.ai/api/coding/paas/v4/chat/completions';
const OPENROUTER_COMPLETIONS = 'https://openrouter.ai/api/v1/chat/completions';

const MODELO_DEFAULT = 'glm-5.2';
// Visión: SIEMPRE glm-4.6v contra el endpoint coding explícito. glm-5v-turbo
// no está en el plan (1311) y glm-5v no existe (1211) — verificado 2026-08-02.
const MODELO_VISION = 'glm-4.6v';
const FEATURE_KEY = 'ai_feature_config: qualia_contable';

const VENTANA_CUOTA_MS = 5 * 60 * 60 * 1000; // la ventana del Coding Plan
// Tope por defecto: 14M, con margen bajo los 15,1M reales medidos por ventana
// (modelo-zai.md 2026-08-07). Override global: qualia_config 'cuota_tope_entrada'.
const CUOTA_TOPE_DEFAULT = 14_000_000;
// Semáforo de llamadas en vuelo. Override global: qualia_config 'max_en_vuelo'.
const MAX_EN_VUELO_DEFAULT = 4;
// Un claim en_vuelo más viejo que esto es un crash, no una llamada: no cuenta.
const CLAIM_VIEJO_MS = 5 * 60 * 1000;

// UN intento por proveedor, no dos contra el mismo: reintentar contra un
// endpoint con la cuota agotada solo quema reloj (lección de preparar-trabajo).
// Topes asimétricos porque no corren igual: z.AI contesta en ~9-15s o rebota al
// instante; OpenRouter midió 37s y 44s con la misma foto.
const TIMEOUT_ZAI_MS = 60_000;
const TIMEOUT_OPENROUTER_MS = 90_000;

// «Se te acabó la cuota», no «andá más despacio»: ante estos NO se reintenta
// contra z.AI — esperar no los arregla y cada intento es una llamada muerta.
// Misma lista que replay-skill.py y alerta-cuota.sh.
const CODIGOS_DE_CUOTA = new Set(['1308', '1310']);

// JAMÁS 'minimal': apaga el razonamiento, y el modo de falla de este agente no
// es tardar — es inventar (FP00001120: una tasa de ITBIS que el papel nunca
// dijo, despejada para que la aritmética cerrara). El tipo no lo admite y el
// runtime lo corrige igual, porque JS no lee tipos.
export type EsfuerzoRazonamiento = 'low' | 'medium' | 'high';
const ESFUERZOS = new Set<string>(['low', 'medium', 'high']);

export interface MensajeLLM {
  role: 'system' | 'user' | 'assistant' | 'tool';
  // string para texto; array para visión (image_url + text) o contenido mixto.
  content: string | Array<Record<string, unknown>> | null;
  [extra: string]: unknown; // tool_calls, tool_call_id, name…
}

export interface ParamsLLM {
  empresaId: string | null;
  funcion: string;
  proposito: string;
  messages: MensajeLLM[];
  maxTokens?: number;
  reasoningEffort?: EsfuerzoRazonamiento;
  vision?: boolean;
  // Extensiones compatibles (fuera del contrato mínimo, opcionales todas):
  temperature?: number; // el proponedor y la visión de referencia usan 0
  tools?: unknown[]; // el turno de qualia-contable llama con tools (§4.3)
  continuacion?: boolean; // marca de turno partido para qualia_llm_uso
}

export type RespuestaLLM =
  | {
      ok: true;
      contenido: string;
      // El respaldo piensa (no se le puede apagar) y a veces el JSON llega acá
      // en vez de en content — el caller debe buscar en los dos (lección de
      // proponer-directo.py y preparar-trabajo.sh).
      razonamiento: string;
      mensaje: Record<string, unknown>; // message crudo, tool_calls incluidos
      finalizadoPor: string | null;
      modelo: string;
      proveedor: 'zai' | 'openrouter';
      tokensEntrada: number;
      tokensSalida: number;
      tokensRazonamiento: number;
      latenciaMs: number;
    }
  | { ok: false; error: string; codigo?: string; detalle?: string };

// ─────────────────────────────────────────────────────── selector de modelo

/**
 * El modelo principal se lee del panel EN EL MOMENTO de la llamada — muere la
 * limitación de seguir-cuota.sh ("la pantalla muestra lo que pediste, no lo
 * que corre"). Sin fila NO es un error: significa "nadie tocó el selector"
 * (mismo trato que le daba seguir-cuota.sh), y acá eso cae al default.
 */
async function modeloPrincipal(): Promise<string> {
  const { data, error } = await sb()
    .from('ai_feature_config')
    .select('model')
    .eq('feature_key', 'qualia_contable')
    .eq('provider', 'zai')
    .limit(1);
  if (error) {
    console.error(`${FEATURE_KEY} ilegible (${error.message}); sigo con ${MODELO_DEFAULT}`);
    return MODELO_DEFAULT;
  }
  if (!data || data.length === 0) return MODELO_DEFAULT;

  let m = String(data[0].model ?? '').trim();
  // Mismo peso con y sin prefijo de organización (port de seguir-cuota.sh).
  if (m.startsWith('z-ai/')) m = m.slice('z-ai/'.length);
  // El id se valida contra la forma antes de viajar en un request: viene de
  // una tabla que escribe la web (port de seguir-cuota.sh).
  if (!m || /[^a-zA-Z0-9._-]/.test(m)) {
    console.error(`modelo pedido sin forma de id ('${m}'); sigo con ${MODELO_DEFAULT}`);
    return MODELO_DEFAULT;
  }
  return m;
}

// ─────────────────────────────────────────────────────────── freno y gate

async function numeroDeConfig(clave: string, porDefecto: number): Promise<number> {
  const v = await configGlobal(clave);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object') {
    // TODO: la forma exacta del jsonb de estas claves no quedó pactada en el
    // contrato (para 'modo' es {"modo": …}); se aceptan número pelado y
    // {"valor": n} — ajustar cuando la migración que las siembre lo fije.
    const o = v as Record<string, unknown>;
    for (const k of ['valor', clave]) {
      const n = o[k];
      if (typeof n === 'number' && Number.isFinite(n)) return n;
    }
  }
  return porDefecto;
}

/**
 * Tokens de ENTRADA contra z.AI en la ventana de 5h, o null si no se pudo leer.
 * Solo proveedor 'zai': la cuota es del Coding Plan; lo que atendió OpenRouter
 * se cobra por token y no gasta ventana. Y es entrada a propósito: la cuota se
 * mide en entrada y los cacheados cuentan a precio completo (modelo-zai.md).
 */
async function consumoVentanaZai(): Promise<number | null> {
  const desde = new Date(Date.now() - VENTANA_CUOTA_MS).toISOString();
  // Suma en JS y no en SQL: PostgREST no agrega sin habilitar aggregates en el
  // proyecto. La ventana real midió ~700 llamadas; 10.000 filas dan margen, y
  // una página llena se trata como tope alcanzado (fail-safe, no adivina).
  const { data, error } = await sb()
    .from('qualia_llm_uso')
    .select('tokens_entrada')
    .eq('proveedor', 'zai')
    .gte('ts', desde)
    .range(0, 9999);
  if (error || !data) {
    console.error(`freno de cuota: ventana ilegible (${error?.message ?? 'sin datos'})`);
    return null;
  }
  if (data.length >= 10000) return Number.POSITIVE_INFINITY;
  return data.reduce((suma, f) => suma + (f.tokens_entrada ?? 0), 0);
}

/**
 * Llamadas en vuelo AHORA (claims frescos; >5 min = crash, no cuenta), o null
 * si el conteo falló. El conteo se hace DESPUÉS de insertar el claim propio:
 * insertar-y-contar achica la carrera entre dos invocaciones simultáneas a un
 * instante, sin necesitar un lock que PostgREST no da.
 */
async function contarEnVuelo(): Promise<number | null> {
  const desde = new Date(Date.now() - CLAIM_VIEJO_MS).toISOString();
  const { count, error } = await sb()
    .from('qualia_llm_uso')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'en_vuelo')
    .gte('ts', desde);
  if (error || count === null) {
    console.error(`gate de concurrencia: conteo fallo (${error?.message ?? 'sin count'})`);
    return null;
  }
  return count;
}

// ───────────────────────────────────────────────────── registro en la tabla

interface CamposUso {
  modelo?: string;
  proveedor?: string;
  estado?: string;
  codigo_error?: string | null;
  tokens_entrada?: number;
  tokens_salida?: number;
  tokens_razonamiento?: number;
  latencia_ms?: number;
}

/** Inserta la fila de la llamada (el claim, o una frenada) y devuelve su id. */
async function insertarUso(p: ParamsLLM, campos: CamposUso): Promise<number | null> {
  const { data, error } = await sb()
    .from('qualia_llm_uso')
    .insert({
      empresa_id: p.empresaId,
      funcion: p.funcion,
      proposito: p.proposito,
      continuacion: p.continuacion ?? false,
      ...campos,
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error(`qualia_llm_uso: insert fallo (${error?.message ?? 'sin fila'})`);
    return null;
  }
  return data.id as number;
}

/**
 * Cierra el claim con el resultado. Si el update falla no se pierde la
 * respuesta del LLM que ya se pagó: se loggea y la fila queda en_vuelo hasta
 * que el umbral de 5 min la deje de contar — el patrón es tolerante a crash
 * por diseño, así que también lo es a este fallo.
 */
async function cerrarUso(id: number | null, campos: CamposUso): Promise<void> {
  if (id === null) return;
  const { error } = await sb().from('qualia_llm_uso').update(campos).eq('id', id);
  if (error) console.error(`qualia_llm_uso: update de ${id} fallo (${error.message})`);
}

// ──────────────────────────────────────────────────── la llamada al proveedor

type Intento =
  | { tipo: 'ok'; datos: Record<string, unknown> }
  | { tipo: 'http'; status: number; codigo: string | null; detalle: string }
  | { tipo: 'red'; detalle: string };

function armarCuerpo(
  proveedor: 'zai' | 'openrouter',
  modelo: string,
  p: ParamsLLM,
  esfuerzo: EsfuerzoRazonamiento,
): Record<string, unknown> {
  const cuerpo: Record<string, unknown> = { model: modelo, messages: p.messages };
  if (p.maxTokens !== undefined) cuerpo.max_tokens = p.maxTokens;
  if (p.temperature !== undefined) cuerpo.temperature = p.temperature;
  if (p.tools && p.tools.length > 0) cuerpo.tools = p.tools;
  if (proveedor === 'zai') {
    if (p.vision) {
      // glm-4.6v es un modelo pensante: pensando, el prompt se pasaba del
      // timeout o gastaba el tope en reasoning_content y entregaba content
      // vacío. Thinking APAGADO → respuesta directa en ~15s (medido 2026-08-02
      // con factura real, lección de preparar-trabajo.sh).
      cuerpo.thinking = { type: 'disabled' };
    } else {
      cuerpo.reasoning_effort = esfuerzo;
    }
  }
  // Al respaldo no se le manda NINGÚN campo de razonamiento: thinking es campo
  // propio de z.AI y un campo desconocido puede tumbar el request entero
  // (lección de preparar-trabajo.sh). Allá el modelo piensa a su default y por
  // eso la respuesta se busca también en reasoning_content.
  // TODO: si algún día OpenRouter normaliza reasoning para z-ai/*, portar el
  // esfuerzo también al respaldo — hoy no hay corrida que lo verifique.
  return cuerpo;
}

async function llamarProveedor(
  url: string,
  llave: string,
  cuerpo: Record<string, unknown>,
  timeoutMs: number,
): Promise<Intento> {
  let r: Response;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${llave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // Solo el tipo del error: nada de cuerpos ni URLs con llave en los logs.
    return { tipo: 'red', detalle: e instanceof Error ? e.name : 'error' };
  }
  const texto = await r.text().catch(() => '');
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(texto) as Record<string, unknown>;
  } catch {
    json = null;
  }
  if (!r.ok) {
    const err = (json?.error ?? {}) as Record<string, unknown>;
    // El código puede venir número o string según el proveedor: se normaliza,
    // que es lo que permite comparar contra la matriz.
    const codigo = err.code !== undefined && err.code !== null ? String(err.code) : null;
    const detalle = typeof err.message === 'string' ? err.message : `HTTP ${r.status}`;
    return { tipo: 'http', status: r.status, codigo, detalle };
  }
  if (!json) return { tipo: 'red', detalle: 'respuesta no-JSON' };
  return { tipo: 'ok', datos: json };
}

// La matriz código→acción de z.AI, portada COMPLETA (spec §4 del plan).
type Accion = 'conmutar' | { error: string; codigo?: string; detalle: string };

function accionAnteFallo(i: Intento): Accion {
  if (i.tipo === 'ok') return 'conmutar'; // no llega: solo por completitud del tipo
  if (i.tipo === 'red') return 'conmutar'; // transitorio: el respaldo existe para esto

  // 401: llave vencida o mala. No se conmuta — la llave de OpenRouter es otra,
  // y taparía un secreto roto que hay que rotar YA.
  if (i.status === 401) {
    return { error: 'llave', codigo: '401', detalle: i.detalle };
  }
  switch (i.codigo) {
    case '1113':
      // 429 que NO es rate-limit: endpoint general o plan sin saldo. Esperar no
      // lo arregla y conmutar taparía una config rota que se paga por token
      // para siempre. NO se reintenta acá adentro: se devuelve para que
      // qualia-salud lo haga sonar (la trampa de modelo-zai.md).
      return { error: 'endpoint', codigo: '1113', detalle: i.detalle };
    case '1311':
      // Visión fuera del plan. Los MISMOS pesos servidos por OpenRouter sí
      // atienden (z-ai/glm-4.6v, verificado con la misma transcripción).
      return 'conmutar';
    case '1211':
      // El modelo no existe — tampoco existiría en OpenRouter: conmutar solo
      // duplicaría el error con otra factura.
      return { error: 'modelo_inexistente', codigo: '1211', detalle: i.detalle };
    case '1213':
      // Mensaje vacío: bug del caller, idéntico en cualquier proveedor.
      return { error: 'mensaje_vacio', codigo: '1213', detalle: i.detalle };
    case '1210':
      // Imagen a un modelo sin visión (el fallback ciego de Hermes moría acá).
      return { error: 'modelo_sin_vision', codigo: '1210', detalle: i.detalle };
    default:
      if (i.codigo !== null && CODIGOS_DE_CUOTA.has(i.codigo)) return 'conmutar';
      // Un 429 de RITMO (p.ej. 1302 concurrencia) es transitorio: en el poller
      // lo arreglaba el backoff (replay-skill.py:644-651); acá no se espera —
      // el respaldo existe para esto. Solo 1113 (arriba) es un 429 terminal.
      if (i.status === 429) return 'conmutar';
      if (i.status >= 500) return 'conmutar'; // el proveedor caído es transitorio
      return { error: 'llm', codigo: i.codigo ?? String(i.status), detalle: i.detalle };
  }
}

function extraerExito(
  datos: Record<string, unknown>,
  modelo: string,
  proveedor: 'zai' | 'openrouter',
  t0: number,
): Extract<RespuestaLLM, { ok: true }> {
  const choices = (datos.choices ?? []) as Array<Record<string, unknown>>;
  const mensaje = (choices[0]?.message ?? {}) as Record<string, unknown>;
  const usage = (datos.usage ?? {}) as Record<string, unknown>;
  const detalles = (usage.completion_tokens_details ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    ok: true,
    contenido: typeof mensaje.content === 'string' ? mensaje.content : '',
    razonamiento: typeof mensaje.reasoning_content === 'string' ? mensaje.reasoning_content : '',
    mensaje,
    finalizadoPor: typeof choices[0]?.finish_reason === 'string'
      ? (choices[0].finish_reason as string)
      : null,
    modelo,
    proveedor,
    tokensEntrada: num(usage.prompt_tokens),
    tokensSalida: num(usage.completion_tokens),
    // z.AI lo reporta en completion_tokens_details; algún proveedor lo sube al
    // nivel del usage — se aceptan los dos.
    tokensRazonamiento: num(detalles.reasoning_tokens) || num(usage.reasoning_tokens),
    latenciaMs: Date.now() - t0,
  };
}

// ─────────────────────────────────────────────────────────────── la entrada

export async function llamarLLM(p: ParamsLLM): Promise<RespuestaLLM> {
  const t0 = Date.now();
  const esfuerzo: EsfuerzoRazonamiento =
    p.reasoningEffort && ESFUERZOS.has(p.reasoningEffort) ? p.reasoningEffort : 'low';

  // (1) el modelo se resuelve EN el momento de la llamada; visión no pasa por
  // el selector — bajar visión rompe la lectura de facturas y no es decisión
  // de menú (modelo-zai.md).
  const modelo = p.vision ? MODELO_VISION : await modeloPrincipal();

  // (2) FRENO de cuota, antes de reservar nada.
  const tope = await numeroDeConfig('cuota_tope_entrada', CUOTA_TOPE_DEFAULT);
  const consumo = await consumoVentanaZai();
  if (consumo === null) {
    // Sin poder leer la ventana no se llama: llamar a ciegas es exactamente lo
    // que el freno existe para impedir (mismo criterio que seguir-cuota.sh:
    // ante base ilegible, no tocar nada).
    await insertarUso(p, {
      modelo,
      proveedor: 'zai',
      estado: 'error',
      codigo_error: 'freno_ilegible',
      latencia_ms: Date.now() - t0,
    });
    return { ok: false, error: 'freno', detalle: 'ventana de consumo ilegible; sin freno no se llama' };
  }
  // >= y no >: al tope exacto ya no se llama — el margen contra los 15,1M
  // reales de la ventana es la gracia del freno.
  if (consumo >= tope) {
    await insertarUso(p, {
      modelo,
      proveedor: 'zai',
      estado: 'frenada_cuota',
      latencia_ms: Date.now() - t0,
    });
    return { ok: false, error: 'cuota', detalle: `ventana 5h: ${consumo} tokens de entrada >= tope ${tope}` };
  }

  // (3) GATE de concurrencia, patrón claim: la fila en_vuelo se inserta ANTES
  // de llamar y se cierra al terminar. Sin fila no hay llamada: una llamada
  // sin registrar rompe la contabilidad de la que dependen el freno y el gate.
  const claimId = await insertarUso(p, { modelo, proveedor: 'zai', estado: 'en_vuelo' });
  if (claimId === null) {
    return { ok: false, error: 'registro', detalle: 'no pude registrar el claim en qualia_llm_uso' };
  }
  const maxVuelo = await numeroDeConfig('max_en_vuelo', MAX_EN_VUELO_DEFAULT);
  const enVuelo = await contarEnVuelo();
  // El conteo incluye el claim propio, por eso el corte es > y no >=: con tope
  // 4 y 4 en vuelo, la quinta se frena. Si el conteo falla se sigue (abierto):
  // el gate protege de la estampida contra z.AI, no de un hipo de PostgREST.
  if (enVuelo !== null && enVuelo > maxVuelo) {
    await cerrarUso(claimId, { estado: 'frenada_concurrencia', latencia_ms: Date.now() - t0 });
    return { ok: false, error: 'concurrencia', detalle: `${enVuelo} llamadas en vuelo (tope ${maxVuelo})` };
  }

  // (4) la cadena: z.AI primero, OpenRouter de respaldo con los MISMOS pesos.
  const llaveZai = Deno.env.get('ZAI_API_KEY');
  const llaveOr = Deno.env.get('OPENROUTER_API_KEY');
  if (!llaveZai && !llaveOr) {
    await cerrarUso(claimId, { estado: 'error', codigo_error: 'sin_llaves', latencia_ms: Date.now() - t0 });
    return { ok: false, error: 'llave', detalle: 'sin ZAI_API_KEY ni OPENROUTER_API_KEY en el entorno' };
  }

  let proveedor: 'zai' | 'openrouter' = 'zai';
  let modeloUsado = modelo;
  // En un éxito conmutado queda el código que forzó el respaldo (1308, 1311,
  // 'red'…): es el rastro que alerta-cuota.sh leía de qualia_servicio y que
  // ahora qualia-salud lee de acá.
  let codigoConmutacion: string | null = null;
  let intento: Intento | null = null;

  if (llaveZai) {
    intento = await llamarProveedor(
      ZAI_COMPLETIONS,
      llaveZai,
      armarCuerpo('zai', modelo, p, esfuerzo),
      TIMEOUT_ZAI_MS,
    );
    if (intento.tipo !== 'ok') {
      const accion = accionAnteFallo(intento);
      if (accion !== 'conmutar') {
        await cerrarUso(claimId, {
          estado: 'error',
          codigo_error: accion.codigo ?? 'llm',
          latencia_ms: Date.now() - t0,
        });
        return { ok: false, ...accion };
      }
      codigoConmutacion = intento.tipo === 'http'
        ? (intento.codigo ?? String(intento.status))
        : 'red';
      intento = null;
    }
  } else {
    codigoConmutacion = 'sin_zai_api_key';
  }

  // (5) el respaldo: mismo mensaje, mismo peso, prefijo de la organización.
  if (intento === null) {
    if (!llaveOr) {
      await cerrarUso(claimId, {
        estado: 'error',
        codigo_error: codigoConmutacion,
        latencia_ms: Date.now() - t0,
      });
      const sinRespaldo = codigoConmutacion !== null && CODIGOS_DE_CUOTA.has(codigoConmutacion)
        ? 'cuota_zai'
        : codigoConmutacion === '1311'
        ? 'vision_plan'
        : 'red';
      return {
        ok: false,
        error: sinRespaldo,
        codigo: codigoConmutacion ?? undefined,
        detalle: 'z.AI fallo y no hay OPENROUTER_API_KEY: la red de seguridad no existe',
      };
    }
    proveedor = 'openrouter';
    modeloUsado = `z-ai/${modelo}`;
    intento = await llamarProveedor(
      OPENROUTER_COMPLETIONS,
      llaveOr,
      armarCuerpo('openrouter', modeloUsado, p, esfuerzo),
      TIMEOUT_OPENROUTER_MS,
    );
    if (intento.tipo !== 'ok') {
      const codigo = intento.tipo === 'http'
        ? (intento.codigo ?? String(intento.status))
        : 'red';
      await cerrarUso(claimId, {
        estado: 'error',
        proveedor,
        modelo: modeloUsado,
        codigo_error: codigo,
        latencia_ms: Date.now() - t0,
      });
      return {
        ok: false,
        error: 'respaldo',
        codigo,
        detalle: `z.AI: ${codigoConmutacion ?? 'sin intento'}; OpenRouter: ${intento.detalle}`,
      };
    }
  }

  // (6) éxito: registrar SIEMPRE, con los tokens reales del proveedor que
  // atendió — la contabilidad nace acá, no en un rescate del agent.log.
  const r = extraerExito(intento.datos, modeloUsado, proveedor, t0);
  await cerrarUso(claimId, {
    estado: 'ok',
    proveedor,
    modelo: modeloUsado,
    codigo_error: codigoConmutacion,
    tokens_entrada: r.tokensEntrada,
    tokens_salida: r.tokensSalida,
    tokens_razonamiento: r.tokensRazonamiento,
    latencia_ms: r.latenciaMs,
  });
  return r;
}
