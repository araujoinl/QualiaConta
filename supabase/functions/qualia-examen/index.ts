import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { sb } from '../_shared/db.ts';
import { autorizado } from '../_shared/auth.ts';

/**
 * Edge Function: qualia-examen — el tomador del examen del corpus dorado (F3).
 *
 * El plan (§5-F3) establece que el replay histórico NO sirve como red para
 * validar qualia-contable; la red es el corpus dorado + la doble corrida. Esta
 * function es la mitad "corpus": por cada caso reconstruye el punto de entrada
 * (SnapshotExamen), invoca a qualia-contable en modo 'examen' por HTTP y
 * CALIFICA la decisión del turno contra el desenlace real y la lección.
 *
 * Reglas que esta pieza hereda del contrato (contrato-turno.md):
 *  - CERO escrituras a cualquier tabla: acá solo hay SELECT (el bearer) y
 *    fetch. El modo 'examen' del turno tampoco escribe ni pokea — todo vuelve
 *    en la respuesta HTTP.
 *  - El snapshot NO lleva la clave de respuestas: leccion, desenlace_adm,
 *    resumen_humano, estado_final y las decisiones contables de la propuesta
 *    (cuentas, documento_adm, tipo_gasto, registro_adm) se REDACTAN — un
 *    examen donde viaja la respuesta no mide nada.
 *  - La calificación es determinista donde se puede (documento_adm, cuentas,
 *    tipo 606, monto, ¿preguntó cuando debía?) y honesta donde no:
 *    'requiere_ojo_humano' es un veredicto válido, no un fallo del calificador.
 *
 * Los JSON del corpus viajan EN EL BUNDLE de esta function: imports estáticos
 * con `type: 'json'` (el bundler los sigue y los embebe; listar un directorio
 * en runtime no existe en el edge). Agregar un caso al corpus = agregar su
 * import y su fila en el MANIFIESTO.
 */

// ── El corpus, embebido en el bundle ─────────────────────────────────────────

import casoFormaxDeposito from '../qualia-contable/corpus/casos/caso-1-formax-deposito-garantia.json' with { type: 'json' };
import casoMtkPagoError from '../qualia-contable/corpus/casos/caso-2-mtk-designs-pago-en-error.json' with { type: 'json' };
import casoDepositoJ12a from '../qualia-contable/corpus/casos/caso-3-deposito-garantia-j12a.json' with { type: 'json' };
import casoCompraLocales from '../qualia-contable/corpus/casos/caso-4-compra-locales-j11-j12.json' with { type: 'json' };
import casoDhlImpuestos from '../qualia-contable/corpus/casos/caso-5-dhl-impuestos-usa.json' with { type: 'json' };
import corrAnticipoIsr from '../qualia-contable/corpus/correcciones/anticipo-isr-rechazada-sin-motivo.json' with { type: 'json' };
import corrErikGas from '../qualia-contable/corpus/correcciones/erik-gas-total-sin-precio-galon.json' with { type: 'json' };
import corrFormax90k from '../qualia-contable/corpus/correcciones/formax-90k-rechazo-corrige-c002.json' with { type: 'json' };
import corrNuevoMilenio from '../qualia-contable/corpus/correcciones/nuevo-milenio-ncf-corregido.json' with { type: 'json' };
import corrSuenaInversor from '../qualia-contable/corpus/correcciones/suena-inversor-activo-fijo.json' with { type: 'json' };
import critC007Journal from '../qualia-contable/corpus/criterios/c007-journal-cuenta-de-grupo.json' with { type: 'json' };
import critCashback from '../qualia-contable/corpus/criterios/cashback-ingreso-journals.json' with { type: 'json' };
import critFreeway from '../qualia-contable/corpus/criterios/freeway-corretaje-no-arrendamiento.json' with { type: 'json' };
import critHumanoSeguros from '../qualia-contable/corpus/criterios/humano-seguros-naturaleza-del-bien.json' with { type: 'json' };
import critNcClaro from '../qualia-contable/corpus/criterios/nc-claro-vendorcreditnotes.json' with { type: 'json' };
import factBigApple from '../qualia-contable/corpus/facturas-dificiles/big-apple-proveedor-nuevo.json' with { type: 'json' };
import factClaro from '../qualia-contable/corpus/facturas-dificiles/claro-fecha-y-arrastre.json' with { type: 'json' };
import factGuanLan from '../qualia-contable/corpus/facturas-dificiles/guan-lan-itbis-con-isc.json' with { type: 'json' };
import factPier17 from '../qualia-contable/corpus/facturas-dificiles/pier17-flete-importacion-usd.json' with { type: 'json' };
import factTupaq from '../qualia-contable/corpus/facturas-dificiles/tupaq-renglones-vs-nota.json' with { type: 'json' };

// ── Tipos ────────────────────────────────────────────────────────────────────

interface EventoCorpus {
  fecha: string;
  autor: string;
  tipo: string;
  texto: string;
}

interface CasoCorpus {
  trabajo_id: string;
  rama: string;
  resumen_humano: string;
  estado_final: string;
  aprobado_por?: string | null;
  criterio_ratificado?: string;
  eventos: EventoCorpus[];
  propuesta_final: Record<string, unknown> | null;
  desenlace_adm: string;
  leccion: string;
}

/** Lo que el turno recibe: el punto de entrada del caso, SIN la respuesta. */
interface SnapshotExamen {
  trabajo_id: string;
  rama: string;
  // El estado en que el turno siempre corre: el harness ya reclamó la fila.
  estado: 'analizando';
  // Cronología hasta el punto de corte (el hilo que el turno habría visto).
  eventos: EventoCorpus[];
  // Hechos del documento/movimiento, redactados de propuesta_final: lo que un
  // dossier del preparador traería. Las decisiones contables NO viajan.
  dossier: Record<string, unknown> | null;
}

interface DecisionTurno {
  tool: string;
  args: Record<string, unknown>;
}

type Veredicto = 'aprobado' | 'parcial' | 'reprobado' | 'requiere_ojo_humano';

interface ResultadoCaso {
  caso: string;
  rama: string;
  trabajo_id: string;
  veredicto: Veredicto;
  detalle: {
    conducta_esperada: string | null;
    aciertos: string[];
    fallos: string[];
    ojo_humano: string[];
  };
  decision_turno: {
    cierre: string | null;
    decisiones: DecisionTurno[];
    respuesta_cruda: unknown;
  };
  desenlace_real: {
    estado_final: string;
    desenlace_adm: string;
    leccion: string;
  };
  corte: { eventos_visibles: number; eventos_totales: number };
}

// ── Constantes ───────────────────────────────────────────────────────────────

const FUNCION = 'qualia-examen';
const RAMAS = new Set(['casos', 'correcciones', 'criterios', 'facturas-dificiles']);

// Las tools que cierran el turno según el contrato §2.3. abrir_trabajo,
// rechazar_paso, proponer_criterio y escribir_libro escriben pero no cierran.
const CIERRES = new Set(['proponer', 'preguntar_al_humano', 'responder', 'marcar_error']);

// El turno tiene deadline blando propio de ~300s (contrato §4); un solo caso
// puede tardar eso. La plataforma nos mata a ~400s de wall clock, así que en
// modo {todos} hay presupuesto global y se corta ANTES de morir mudo.
const TIMEOUT_CASO_SOLO_MS = 370_000;
const TIMEOUT_CASO_LOTE_MS = 150_000;
const DEADLINE_LOTE_MS = 330_000;

// Umbral de cuadre del contrato (§2.3): la misma tolerancia para comparar montos.
const UMBRAL_MONTO = 0.05;

// En el boletín la respuesta cruda de cada caso se recorta: 20 respuestas
// enteras del turno inflan el JSON sin sumar a la calificación.
const TOPE_CRUDO_LOTE = 6_000;

const MANIFIESTO: Record<string, CasoCorpus> = (() => {
  // Cast por unknown a propósito: el shape literal que Deno infiere de cada
  // JSON varía por archivo (propuesta_final no tiene claves fijas) y el
  // contrato de lectura es CasoCorpus.
  const caso = (m: unknown) => m as CasoCorpus;
  return {
    'casos/caso-1-formax-deposito-garantia.json': caso(casoFormaxDeposito),
    'casos/caso-2-mtk-designs-pago-en-error.json': caso(casoMtkPagoError),
    'casos/caso-3-deposito-garantia-j12a.json': caso(casoDepositoJ12a),
    'casos/caso-4-compra-locales-j11-j12.json': caso(casoCompraLocales),
    'casos/caso-5-dhl-impuestos-usa.json': caso(casoDhlImpuestos),
    'correcciones/anticipo-isr-rechazada-sin-motivo.json': caso(corrAnticipoIsr),
    'correcciones/erik-gas-total-sin-precio-galon.json': caso(corrErikGas),
    'correcciones/formax-90k-rechazo-corrige-c002.json': caso(corrFormax90k),
    'correcciones/nuevo-milenio-ncf-corregido.json': caso(corrNuevoMilenio),
    'correcciones/suena-inversor-activo-fijo.json': caso(corrSuenaInversor),
    'criterios/c007-journal-cuenta-de-grupo.json': caso(critC007Journal),
    'criterios/cashback-ingreso-journals.json': caso(critCashback),
    'criterios/freeway-corretaje-no-arrendamiento.json': caso(critFreeway),
    'criterios/humano-seguros-naturaleza-del-bien.json': caso(critHumanoSeguros),
    'criterios/nc-claro-vendorcreditnotes.json': caso(critNcClaro),
    'facturas-dificiles/big-apple-proveedor-nuevo.json': caso(factBigApple),
    'facturas-dificiles/claro-fecha-y-arrastre.json': caso(factClaro),
    'facturas-dificiles/guan-lan-itbis-con-isc.json': caso(factGuanLan),
    'facturas-dificiles/pier17-flete-importacion-usd.json': caso(factPier17),
    'facturas-dificiles/tupaq-renglones-vs-nota.json': caso(factTupaq),
  };
})();

// ── Helpers chicos ───────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Acepta la ruta con o sin los prefijos del repo y la normaliza a rama/archivo. */
function normalizarCasoPath(p: string): string {
  return p
    .replace(/^\/+/, '')
    .replace(/^supabase\/functions\//, '')
    .replace(/^qualia-contable\//, '')
    .replace(/^corpus\//, '');
}

function numero(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** Bearer para invocar al turno: env primero, después la base (solo lectura). */
async function bearerSaliente(): Promise<string | null> {
  const env = Deno.env.get('QUALIA_CRON_BEARER');
  if (env) return env;
  const { data, error } = await sb()
    .from('qualia_config')
    .select('valor')
    .is('empresa_id', null)
    .eq('clave', 'cron_bearer')
    .single();
  if (error || !data) return null;
  const v = (data.valor as { bearer?: string }).bearer;
  return typeof v === 'string' && v !== '' ? v : null;
}

// ── Armado del snapshot ──────────────────────────────────────────────────────

function esEventoPreparador(ev: EventoCorpus): boolean {
  return ev.autor === 'contable' && ev.tipo === 'progreso' && ev.texto.startsWith('Preparador:');
}

/**
 * El punto de corte de la cronología (README del corpus: «se corta en el punto
 * que se quiera probar»). Reglas deterministas por rama:
 *
 *  - correcciones: el turno entra a atender la VOZ del humano — se corta
 *    después del primer evento de usuario que llega cuando ya había análisis
 *    del contable en el hilo (la corrección, o el rechazo). Si no hay tal voz
 *    (formax-90k llega al corpus solo con la nota del rechazo), cae a la regla
 *    general.
 *  - resto: el turno entra donde entró el contable real — se corta ANTES del
 *    primer evento del contable que no sea el aviso del preparador. En casos y
 *    criterios eso deja visible el pedido/aviso del humano que abrió la fila.
 */
function indiceCorte(caso: CasoCorpus): number {
  const evs = caso.eventos;
  if (caso.rama === 'correcciones') {
    let huboContable = false;
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      if (ev.autor === 'contable' && !esEventoPreparador(ev)) huboContable = true;
      else if (ev.autor === 'usuario' && huboContable) return i + 1;
    }
  }
  for (let i = 0; i < evs.length; i++) {
    const ev = evs[i];
    if (ev.autor === 'contable' && !esEventoPreparador(ev)) return i;
  }
  return evs.length;
}

// Claves de propuesta_final que son HECHOS (documento, banco, verificación
// DGII) y pueden viajar en el dossier. Todo lo demás es decisión del contable
// real —cuentas, documento_adm, tipo_gasto, detalle, confianza, metodo,
// precedente_ref, registro_adm, cerrado— y se queda afuera: es la respuesta.
const CLAVES_DE_HECHO = new Set([
  'ncf', 'rnc', 'rnc_padron', 'fecha', 'monto', 'itbis', 'moneda', 'proveedor',
  'dgii', 'ncf_modificado', 'banco_tx_id', 'banco', 'cuenta_banco', 'direccion',
  'accion', 'numero', 'mandado_en',
]);

// De cada renglón estilo item, solo lo que sale del papel. 'cuenta' y
// 'cuenta_nombre' son la decisión y se retiran.
const CLAVES_DE_LINEA = ['descripcion', 'precio', 'cantidad', 'itbis', 'grupo_impuesto'] as const;

function redactarDossier(caso: CasoCorpus): Record<string, unknown> | null {
  const p = caso.propuesta_final;
  if (!p || typeof p !== 'object') return null;
  const dossier: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(p)) {
    if (CLAVES_DE_HECHO.has(k) && v !== undefined) dossier[k] = v;
  }

  // filas (rama casos): los movimientos del banco con su foto — todo hechos
  // observables; van enteras. 'cerrado' (el desenlace) jamás entra acá porque
  // no está en la lista de hechos.
  if (Array.isArray(p.filas)) dossier.filas = p.filas;

  // lineas: SOLO renglones estilo item (traen 'precio'). Los de partida doble
  // (debito/credito) SON el asiento decidido y no viajan.
  // `lineas_resumen` (pier17) tampoco: el resumen del corpus ya trae la cuenta
  // decidida en el texto.
  if (Array.isArray(p.lineas)) {
    const items = (p.lineas as Array<Record<string, unknown>>)
      .filter((l) => l && typeof l === 'object' && 'precio' in l)
      .map((l) => {
        const limpia: Record<string, unknown> = {};
        for (const k of CLAVES_DE_LINEA) if (l[k] !== undefined) limpia[k] = l[k];
        return limpia;
      });
    if (items.length > 0) dossier.lineas = items;
  }

  return Object.keys(dossier).length > 0 ? dossier : null;
}

function armarSnapshot(caso: CasoCorpus): { snapshot: SnapshotExamen; corte: number } {
  const corte = indiceCorte(caso);
  return {
    corte,
    snapshot: {
      trabajo_id: caso.trabajo_id,
      rama: caso.rama,
      estado: 'analizando',
      eventos: caso.eventos.slice(0, corte),
      dossier: redactarDossier(caso),
    },
  };
}

// ── Invocación del turno ─────────────────────────────────────────────────────

interface RespuestaTurno {
  ok: boolean;
  status?: number;
  cuerpo?: unknown;
  error?: string;
}

async function invocarTurno(
  clave: string,
  snapshot: SnapshotExamen,
  bearer: string,
  timeoutMs: number,
): Promise<RespuestaTurno> {
  const base = Deno.env.get('QUALIA_FUNCTIONS_URL') ?? '';
  if (!base) return { ok: false, error: 'falta QUALIA_FUNCTIONS_URL en el entorno' };

  // El contrato de este payload con qualia-contable: modo 'examen' = cero
  // escrituras a cualquier tabla, cero pokes, todo en la respuesta HTTP.
  // TODO(F3): confirmar el nombre exacto de los campos con el turno cuando
  // las dos piezas se integren — este es el lado que el examen propone.
  const payload = { modo: 'examen', caso: clave, snapshot };

  try {
    const resp = await fetch(`${base}/qualia-contable`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const textoResp = await resp.text().catch(() => '');
    let cuerpo: unknown = null;
    try {
      cuerpo = JSON.parse(textoResp);
    } catch {
      cuerpo = textoResp;
    }
    if (!resp.ok) {
      return { ok: false, status: resp.status, cuerpo, error: `qualia-contable HTTP ${resp.status}` };
    }
    return { ok: true, status: resp.status, cuerpo };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

/**
 * Normaliza las decisiones del turno desde la respuesta HTTP. Se aceptan las
 * formas razonables ({tool,args}, {nombre,argumentos}, tool_calls estilo
 * OpenAI con arguments en string) para no acoplar el examen a un nombre de
 * campo que todavía puede moverse en la integración.
 */
function aDecision(item: unknown): DecisionTurno | null {
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;

  const fn = o.function as Record<string, unknown> | undefined;
  if (fn && typeof fn.name === 'string') {
    let args: Record<string, unknown> = {};
    if (typeof fn.arguments === 'string') {
      try {
        args = JSON.parse(fn.arguments) as Record<string, unknown>;
      } catch {
        // args ilegibles: se conserva el nombre igual — para la conducta alcanza
      }
    } else if (fn.arguments && typeof fn.arguments === 'object') {
      args = fn.arguments as Record<string, unknown>;
    }
    return { tool: fn.name, args };
  }

  const nombre = [o.tool, o.nombre, o.name, o.herramienta].find((v) => typeof v === 'string') as
    | string
    | undefined;
  if (!nombre) return null;
  const args = [o.args, o.argumentos, o.arguments, o.parametros, o.input].find(
    (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  ) as Record<string, unknown> | undefined;
  return { tool: nombre, args: args ?? {} };
}

function normalizarDecisiones(cuerpo: unknown): DecisionTurno[] {
  if (!cuerpo || typeof cuerpo !== 'object') return [];
  const c = cuerpo as Record<string, unknown>;
  const resultado = c.resultado as Record<string, unknown> | undefined;
  const candidatas = [c.decisiones, c.tool_calls, c.acciones, c.llamadas, resultado?.decisiones];
  for (const lista of candidatas) {
    if (Array.isArray(lista) && lista.length > 0) {
      const salida: DecisionTurno[] = [];
      for (const item of lista) {
        const d = aDecision(item);
        if (d) salida.push(d);
      }
      if (salida.length > 0) return salida;
    }
  }
  return [];
}

// ── Calificación ─────────────────────────────────────────────────────────────

type Conducta = 'proponer' | 'preguntar' | 'dictaminar' | 'acusar_rechazo' | 'no_repetir';

/**
 * Qué hizo el contable real en el punto de corte — derivado de la cronología,
 * no de la intuición:
 *
 *  - rama casos: el cierre del caso es SIEMPRE la voz al humano (dictamen o
 *    pregunta) — «cerrar el caso es del humano», contrato §3.3.
 *  - si el turno ya tiene delante un rechazo del humano (pre-corte), lo que
 *    toca es el acuse (rama-respuestas).
 *  - si en la cronología posterior el contable preguntó antes de cualquier
 *    aprobación → había que preguntar; si el humano aprobó una propuesta →
 *    había que proponer.
 *  - estado_final 'rechazada' sin más señal: la propuesta del corpus es el
 *    ANTI-ejemplo — repetirla es reprobar.
 */
function conductaEsperada(caso: CasoCorpus, corte: number): Conducta | null {
  if (caso.rama === 'casos') return 'dictaminar';

  const preCorte = caso.eventos.slice(0, corte);
  if (preCorte.some((ev) => ev.autor === 'usuario' && /rechazada por/i.test(ev.texto))) {
    return 'acusar_rechazo';
  }

  for (const ev of caso.eventos.slice(corte)) {
    if (ev.autor === 'contable' && ev.tipo === 'pregunta') return 'preguntar';
    if (ev.autor === 'usuario' && /aprobada por/i.test(ev.texto)) return 'proponer';
  }

  if (caso.estado_final.startsWith('rechazada')) return 'no_repetir';
  return null;
}

/** Cuentas únicas y ordenadas de un array de lineas (items o partida doble). */
function cuentasDe(lineas: unknown): string[] {
  if (!Array.isArray(lineas)) return [];
  const set = new Set<string>();
  for (const l of lineas) {
    if (l && typeof l === 'object') {
      const c = texto((l as Record<string, unknown>).cuenta);
      if (c) set.add(c);
    }
  }
  return [...set].sort();
}

/** La propuesta dentro de los args de `proponer` (o los args mismos). */
function propuestaDeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const p = args.propuesta;
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : args;
}

function calificar(
  clave: string,
  caso: CasoCorpus,
  corte: number,
  decisiones: DecisionTurno[],
  respuestaCruda: unknown,
): ResultadoCaso {
  const aciertos: string[] = [];
  const fallos: string[] = [];
  const ojoHumano: string[] = [];
  let severo = false;
  // Conducta que el examen no puede juzgar en automático (p.ej. propuso algo
  // DISTINTO de lo rechazado): no es acierto ni fallo — es ojo humano.
  let conductaIndeterminada = false;

  const esperada = conductaEsperada(caso, corte);
  const cierre = [...decisiones].reverse().find((d) => CIERRES.has(d.tool)) ?? null;
  const abiertos = decisiones.filter((d) => d.tool === 'abrir_trabajo').length;
  const criterios = decisiones.filter((d) => d.tool === 'proponer_criterio').length;

  const final = caso.propuesta_final ?? {};
  const docFinal = texto(final.documento_adm);
  const cuentasFinal = cuentasDe(final.lineas);
  // La propuesta del corpus es «bendecida» (comparable como respuesta buena)
  // salvo en los rechazos, donde es el anti-ejemplo.
  const finalBendecida = !caso.estado_final.startsWith('rechazada');

  let resultadoVeredicto: Veredicto | null = null;

  if (decisiones.length === 0) {
    fallos.push('el turno no devolvió ninguna decisión que se pueda calificar');
    resultadoVeredicto = 'reprobado';
  } else if (!cierre) {
    fallos.push(
      `el turno no cerró: ninguna de sus ${decisiones.length} llamadas es una tool de cierre (${[...CIERRES].join(', ')})`,
    );
    resultadoVeredicto = 'reprobado';
  }

  // ── Conducta ──
  let conductaOk = false;
  let conductaLeve = false;
  if (cierre && esperada) {
    switch (esperada) {
      case 'proponer':
        if (cierre.tool === 'proponer') {
          conductaOk = true;
          aciertos.push('propuso, igual que el contable real (el humano terminó aprobando)');
        } else if (cierre.tool === 'preguntar_al_humano') {
          conductaLeve = true;
          fallos.push('preguntó donde el histórico probó que se podía proponer');
        } else {
          severo = true;
          fallos.push(`cerró con ${cierre.tool} donde el histórico pedía una propuesta`);
        }
        break;
      case 'preguntar':
        if (cierre.tool === 'preguntar_al_humano') {
          conductaOk = true;
          aciertos.push('preguntó, y el caso dice que había que preguntar');
          ojoHumano.push('la sustancia de la pregunta (¿es la misma duda que el contable real dejó abierta?)');
        } else if (cierre.tool === 'proponer') {
          severo = true;
          fallos.push('propuso donde el contable real probó que faltaban datos y había que preguntar');
        } else {
          fallos.push(`cerró con ${cierre.tool} donde el histórico pedía preguntar`);
        }
        break;
      case 'dictaminar':
        if (cierre.tool === 'preguntar_al_humano') {
          conductaOk = true;
          aciertos.push('cerró el caso con voz al humano (pregunta/dictamen), como manda la rama de casos');
          if (abiertos > 0) {
            aciertos.push(`abrió ${abiertos} trabajo(s) hijo(s) — ningún paso en prosa (lápida Caso #2)`);
          } else {
            ojoHumano.push('si el dictamen necesitaba pasos aprobables, faltó abrir_trabajo (Caso #2: ninguno queda en prosa)');
          }
          ojoHumano.push('la sustancia del dictamen y de los hijos contra el desenlace real');
        } else if (cierre.tool === 'proponer') {
          severo = true;
          fallos.push('propuso sobre la fila del caso: el caso jamás lleva registro propio — los pasos van por abrir_trabajo');
        } else {
          severo = true;
          fallos.push(`cerró el caso con ${cierre.tool}; el cierre del caso es la voz al humano`);
        }
        break;
      case 'acusar_rechazo':
        if (cierre.tool === 'responder') {
          conductaOk = true;
          aciertos.push('acusó el rechazo con responder, sin re-proponer ni inventar aprendizaje');
          if (criterios > 0) {
            fallos.push('propuso criterio sobre un rechazo mudo: de un rechazo sin motivo no se aprende nada');
          } else {
            aciertos.push('no fabricó un criterio de un rechazo sin motivo');
          }
        } else if (cierre.tool === 'proponer') {
          severo = true;
          fallos.push('re-propuso sobre un rechazo del humano en vez de acusarlo');
        } else {
          fallos.push(`cerró con ${cierre.tool} donde tocaba el acuse (responder)`);
        }
        break;
      case 'no_repetir': {
        const propuesta = cierre.tool === 'proponer' ? propuestaDeArgs(cierre.args) : null;
        if (propuesta) {
          const doc = texto(propuesta.documento_adm);
          const cuentas = cuentasDe(propuesta.lineas);
          const mismaCosa = doc !== null && doc === docFinal &&
            cuentasFinal.length > 0 && cuentas.join(',') === cuentasFinal.join(',');
          if (mismaCosa) {
            severo = true;
            fallos.push(
              `repitió la propuesta que el humano rechazó (${docFinal} · ${cuentasFinal.join(', ')})`,
            );
          } else {
            conductaIndeterminada = true;
            ojoHumano.push('propuso distinto de lo rechazado: si el tratamiento nuevo es correcto lo decide un humano');
          }
        } else if (cierre.tool === 'preguntar_al_humano') {
          conductaOk = true;
          aciertos.push('no repitió la propuesta rechazada: derivó al humano (la letra vigente de C-002)');
          ojoHumano.push('la sustancia de la pregunta contra la lección del caso');
        } else if (cierre) {
          conductaIndeterminada = true;
          ojoHumano.push(`cerró con ${cierre.tool}; el caso solo prueba en negativo (no repetir lo rechazado)`);
        }
        break;
      }
    }
  } else if (cierre && !esperada) {
    ojoHumano.push(
      'el corpus no da señal determinista de la conducta esperada en este punto de corte: califica un humano',
    );
  }

  // ── Contenido (solo cuando propuso, tocaba proponer y el final es bendecido) ──
  let contenidoComparable = false;
  let fallaCore = false;
  let fallasMenores = 0;
  if (cierre?.tool === 'proponer' && esperada === 'proponer' && finalBendecida) {
    const propuesta = propuestaDeArgs(cierre.args);

    if (docFinal) {
      contenidoComparable = true;
      const doc = texto(propuesta.documento_adm);
      if (doc === docFinal) aciertos.push(`documento_adm coincide: ${docFinal}`);
      else {
        fallaCore = true;
        fallos.push(`documento_adm: propuso ${doc ?? '(vacío)'} y el real fue ${docFinal}`);
      }
    }

    if (cuentasFinal.length > 0) {
      contenidoComparable = true;
      const cuentas = cuentasDe(propuestaDeArgs(cierre.args).lineas);
      if (cuentas.join(',') === cuentasFinal.join(',')) {
        aciertos.push(`cuentas coinciden: ${cuentasFinal.join(', ')}`);
      } else if (cuentas.some((c) => cuentasFinal.includes(c))) {
        fallasMenores++;
        fallos.push(`cuentas parciales: propuso [${cuentas.join(', ')}] vs real [${cuentasFinal.join(', ')}]`);
      } else {
        fallaCore = true;
        fallos.push(`cuentas disjuntas: propuso [${cuentas.join(', ') || 'ninguna'}] vs real [${cuentasFinal.join(', ')}]`);
      }
    } else if (docFinal) {
      // pier17 viaja con las lineas resumidas en prosa; el corpus no da
      // cuentas comparables máquina-a-máquina.
      ojoHumano.push('las cuentas del caso real están resumidas en prosa en el corpus: las compara un humano');
    }

    const tipoFinal = final.tipo_gasto && typeof final.tipo_gasto === 'object'
      ? texto((final.tipo_gasto as Record<string, unknown>).codigo)
      : null;
    if (tipoFinal) {
      const tg = propuesta.tipo_gasto;
      const tipoTurno = tg && typeof tg === 'object'
        ? texto((tg as Record<string, unknown>).codigo)
        : texto(tg);
      if (tipoTurno === tipoFinal) aciertos.push(`tipo de gasto 606 coincide: ${tipoFinal}`);
      else {
        fallasMenores++;
        fallos.push(`tipo de gasto 606: propuso ${tipoTurno ?? '(vacío)'} y el real fue ${tipoFinal}`);
      }
    }

    const montoFinal = numero(final.monto);
    const montoTurno = numero(propuesta.monto);
    if (montoFinal !== null && montoTurno !== null) {
      // En valor absoluto: la NC real quedó en negativo en el corpus y el
      // contrato nuevo exige precios positivos en VendorCreditNotes.
      if (Math.abs(Math.abs(montoTurno) - Math.abs(montoFinal)) <= UMBRAL_MONTO) {
        aciertos.push(`monto coincide: ${montoFinal}`);
      } else {
        fallasMenores++;
        fallos.push(`monto: propuso ${montoTurno} y el real fue ${montoFinal}`);
      }
    }

    const ncfFinal = texto(final.ncf);
    const ncfTurno = texto(propuesta.ncf);
    if (ncfFinal && ncfTurno) {
      if (ncfTurno === ncfFinal) aciertos.push(`NCF coincide: ${ncfFinal}`);
      else {
        fallasMenores++;
        fallos.push(`NCF: propuso ${ncfTurno} y el real fue ${ncfFinal}`);
      }
    }
  }

  // ── Veredicto ──
  let veredicto: Veredicto;
  if (resultadoVeredicto) {
    veredicto = resultadoVeredicto;
  } else if (severo) {
    veredicto = 'reprobado';
  } else if (!esperada) {
    veredicto = 'requiere_ojo_humano';
  } else if (conductaLeve) {
    veredicto = 'parcial';
  } else if (conductaIndeterminada && !conductaOk) {
    veredicto = 'requiere_ojo_humano';
  } else if (!conductaOk) {
    veredicto = 'reprobado';
  } else if (contenidoComparable) {
    if (fallaCore) veredicto = 'reprobado';
    else if (fallasMenores > 0) veredicto = 'parcial';
    else veredicto = 'aprobado';
  } else {
    // Conducta verificada pero sin contenido comparable máquina-a-máquina:
    // el veredicto honesto es que lo mire un humano, con los aciertos listados.
    veredicto = 'requiere_ojo_humano';
  }

  return {
    caso: clave,
    rama: caso.rama,
    trabajo_id: caso.trabajo_id,
    veredicto,
    detalle: { conducta_esperada: esperada, aciertos, fallos, ojo_humano: ojoHumano },
    decision_turno: { cierre: cierre?.tool ?? null, decisiones, respuesta_cruda: respuestaCruda },
    desenlace_real: {
      estado_final: caso.estado_final,
      desenlace_adm: caso.desenlace_adm,
      leccion: caso.leccion,
    },
    corte: { eventos_visibles: corte, eventos_totales: caso.eventos.length },
  };
}

// ── Corrida de un caso ───────────────────────────────────────────────────────

async function examinarCaso(
  clave: string,
  caso: CasoCorpus,
  bearer: string,
  timeoutMs: number,
  recortarCrudo: boolean,
): Promise<ResultadoCaso | { caso: string; rama: string; error: string }> {
  const { snapshot, corte } = armarSnapshot(caso);
  const resp = await invocarTurno(clave, snapshot, bearer, timeoutMs);
  if (!resp.ok) {
    // Un turno que no contestó no reprueba el examen: es un fallo de
    // infraestructura y se reporta aparte para no ensuciar el boletín.
    return { caso: clave, rama: caso.rama, error: resp.error ?? `HTTP ${resp.status}` };
  }

  let crudo: unknown = resp.cuerpo;
  if (recortarCrudo) {
    const s = JSON.stringify(resp.cuerpo ?? null);
    if (s.length > TOPE_CRUDO_LOTE) crudo = `${s.slice(0, TOPE_CRUDO_LOTE)}… [recortado: ${s.length} bytes]`;
  }

  return calificar(clave, caso, corte, normalizarDecisiones(resp.cuerpo), crudo);
}

function esResultado(r: ResultadoCaso | { error: string }): r is ResultadoCaso {
  return !('error' in r);
}

// ── Entrada HTTP ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Metodo no permitido' }, 405);
  if (!(await autorizado(req))) return json({ ok: false, error: 'No autorizado' }, 401);

  const t0 = Date.now();
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const bearer = await bearerSaliente();
    if (!bearer) {
      return json(
        { ok: false, error: 'sin bearer para invocar qualia-contable (ni env ni qualia_config)' },
        500,
      );
    }

    // ── {todos: true}: el corpus entero, con boletín ──
    if (body.todos === true) {
      let claves = Object.keys(MANIFIESTO).sort();

      // Filtro opcional por rama: sirve para trocear la corrida cuando el
      // corpus entero no cabe en la ventana de wall clock de una invocación.
      if (body.rama !== undefined) {
        if (typeof body.rama !== 'string' || !RAMAS.has(body.rama)) {
          return json({ ok: false, error: `rama invalida; validas: ${[...RAMAS].join(', ')}` }, 400);
        }
        claves = claves.filter((c) => MANIFIESTO[c].rama === body.rama);
      }

      const resultados: ResultadoCaso[] = [];
      const erroresCasos: Array<{ caso: string; rama: string; error: string }> = [];
      const pendientes: string[] = [];

      for (let i = 0; i < claves.length; i++) {
        const restante = DEADLINE_LOTE_MS - (Date.now() - t0);
        if (restante < 15_000) {
          // Presupuesto agotado: mejor un boletín parcial y honesto que morir
          // mudo a los 400s de la plataforma.
          pendientes.push(...claves.slice(i));
          break;
        }
        const clave = claves[i];
        const r = await examinarCaso(
          clave,
          MANIFIESTO[clave],
          bearer,
          Math.min(TIMEOUT_CASO_LOTE_MS, restante - 10_000),
          true,
        );
        if (esResultado(r)) resultados.push(r);
        else erroresCasos.push(r);
      }

      // El boletín: totales y resumen por rama.
      const cuenta = (v: Veredicto) => resultados.filter((r) => r.veredicto === v).length;
      const porRama: Record<string, Record<string, number>> = {};
      for (const r of resultados) {
        const g = porRama[r.rama] ?? { total: 0, aprobados: 0, parciales: 0, reprobados: 0, requiere_ojo_humano: 0, errores: 0 };
        g.total++;
        if (r.veredicto === 'aprobado') g.aprobados++;
        else if (r.veredicto === 'parcial') g.parciales++;
        else if (r.veredicto === 'reprobado') g.reprobados++;
        else g.requiere_ojo_humano++;
        porRama[r.rama] = g;
      }
      for (const e of erroresCasos) {
        const g = porRama[e.rama] ?? { total: 0, aprobados: 0, parciales: 0, reprobados: 0, requiere_ojo_humano: 0, errores: 0 };
        g.total++;
        g.errores++;
        porRama[e.rama] = g;
      }

      return json({
        ok: true,
        funcion: FUNCION,
        modo: 'todos',
        boletin: {
          casos_corridos: resultados.length,
          aprobados: cuenta('aprobado'),
          parciales: cuenta('parcial'),
          reprobados: cuenta('reprobado'),
          requiere_ojo_humano: cuenta('requiere_ojo_humano'),
          errores: erroresCasos.length,
          por_rama: porRama,
        },
        resultados,
        errores: erroresCasos,
        ...(pendientes.length > 0 ? { incompleto: true, pendientes } : {}),
        duracion_ms: Date.now() - t0,
      });
    }

    // ── {caso_path}: un caso solo ──
    const casoPath = body.caso_path;
    if (typeof casoPath !== 'string' || casoPath.trim() === '') {
      return json({ ok: false, error: 'falta caso_path (o todos: true)' }, 400);
    }
    const clave = normalizarCasoPath(casoPath.trim());
    const caso = MANIFIESTO[clave];
    if (!caso) {
      return json(
        { ok: false, error: `caso desconocido: ${clave}`, disponibles: Object.keys(MANIFIESTO).sort() },
        404,
      );
    }

    const r = await examinarCaso(clave, caso, bearer, TIMEOUT_CASO_SOLO_MS, false);
    if (!esResultado(r)) {
      return json({ ok: false, funcion: FUNCION, ...r, duracion_ms: Date.now() - t0 }, 502);
    }
    return json({ ok: true, funcion: FUNCION, resultado: r, duracion_ms: Date.now() - t0 });
  } catch (e) {
    return json(
      { ok: false, funcion: FUNCION, error: e instanceof Error ? e.message : String(e), duracion_ms: Date.now() - t0 },
      500,
    );
  }
});
