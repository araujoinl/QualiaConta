// qualia-contable/tools.ts — las 16 tools del turno (docs/contrato-turno.md
// §2-§3 con sus enmiendas normativas del 2026-08-16, más
// `ratificar_brecha_itbis` del 2026-08-17): los JSON schemas que viajan a
// llamarLLM y la implementación de `ejecutar`.
//
// Las tres reglas que ordenan el archivo entero:
//
//  1. **Los identificadores nacen de la FILA, jamás de la salida del LLM.**
//     `empresa_id`, `trabajo_id`, `caso_id`, `docid` y `aprobado_por_nombre`
//     no están en ningún schema: los pone el harness o se leen de
//     `qualia_trabajos` (plan §4.6 y enmienda 1 del contrato).
//  2. **`propuesta → aprobada` no existe en el vocabulario del turno.** Los
//     únicos estados que estas tools escriben son `propuesta`,
//     `esperando_respuesta`, `error` y —sólo en `rechazar_paso`, la excepción
//     documentada sobre hijos del caso propio— `rechazada`. Aprobar es del
//     humano, registrar en ADM es de F4.
//  3. **Guard de estado en el WHERE de toda escritura**, y cero filas es un
//     ErrorGuard que se ve (bus.ts). El «UPDATE 0» silencioso ya mordió dos
//     veces y este contrato lo hereda muerto.
//
// Las tools son GORDAS a propósito (contrato §5): una iteración cuesta ~11k de
// entrada, así que una tool fina que obliga a dos llamadas donde
// `dossier_completo` daba todo cuesta ~11k de más.

import {
  claveExamen,
  CtxTurno,
  ErrorGuard,
  RE_UUID,
  recortar,
  ResultadoTool,
} from './tipos.ts';
import { EventoNuevo, filaFresca, frenoDeEscritura, insertarEventos, moverEstado } from './bus.ts';
import { ArgsLeerAdm, leerAdm, TIPOS_DOC } from './adm.ts';
import {
  ArgsBanco,
  ArgsDgii,
  ArgsDossier,
  consultarBanco,
  consultarDgii,
  dossierCompleto,
  dossierDelTurno,
  bajarJson,
} from './consultas.ts';
import { ArgsBuscarPrecedente, buscarPrecedente } from './precedentes.ts';
import { ArgsLibro, escribirLibro } from './libro.ts';
import {
  ArgsRatificarBrecha,
  precedenteDeLaEmpresa,
  ratificarBrechaItbis,
} from './precedente-brecha.ts';
import { validarPropuesta, validarResumen } from './validar.ts';
import { CLAVE_TOPE_BRECHA, TASAS_LEGALES, TOPE_BRECHA_PCT_DEFAULT } from '../_shared/brecha-itbis.ts';
import { rutaAggTiposGasto } from './espejos.ts';
import { NUCLEO } from './nucleo.ts';

type Dic = Record<string, unknown>;

const dic = (v: unknown): Dic | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Dic) : null;

/** Las cuatro que cierran el turno: tras cualquiera de ellas el loop termina. */
export const TOOLS_CIERRE = new Set([
  'proponer',
  'preguntar_al_humano',
  'responder',
  'marcar_error',
]);

// Los estados que cada escritura exige, con su lápida:
//  - propuesta: sólo desde analizando (guard del contrato de la mesa).
//  - esperando_respuesta: analizando O aprobada — las DOS puertas. La de
//    `aprobada` es la del AMBIGUO del registro; con el guard viejo de sólo
//    `analizando` el UPDATE quedaba en 0 sin fallar y la fila zombi dos horas.
//  - error: cualquier estado no terminal.
const DESDE_PARA_PROPUESTA = ['analizando'];
const DESDE_PARA_PREGUNTA = ['analizando', 'aprobada'];
const DESDE_PARA_ERROR = ['pendiente', 'analizando', 'propuesta', 'esperando_respuesta', 'aprobada'];

const TIPOS_EVENTO = new Set(['progreso', 'nota', 'pregunta']);

/**
 * Normaliza el array `eventos` que traen las tools de cierre. Los eventos del
 * cierre viajan ADENTRO de la tool, no sueltos: es lo que hace que un cierre
 * no pueda quedar mudo ni un evento huérfano de su cambio de estado.
 */
function eventosDe(valor: unknown, tipoPorDefecto: 'progreso' | 'nota' | 'pregunta'): EventoNuevo[] {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor)) throw new Error('`eventos` tiene que ser un array');
  const salida: EventoNuevo[] = [];
  for (const crudo of valor) {
    const e = dic(crudo);
    if (!e) throw new Error('cada evento es un objeto {tipo, contenido}');
    const contenido = String(e.contenido ?? '').trim();
    if (contenido === '') throw new Error('un evento sin `contenido` no dice nada: quitalo o escribilo');
    const tipo = String(e.tipo ?? tipoPorDefecto);
    if (!TIPOS_EVENTO.has(tipo)) {
      throw new Error(`tipo de evento '${tipo}' desconocido: progreso | nota | pregunta`);
    }
    salida.push({ tipo: tipo as EventoNuevo['tipo'], contenido });
  }
  return salida;
}

/**
 * Los errores de validación vuelven al MODELO para que corrija, no revientan.
 *
 * `faltantes` es la mitad nueva (2026-08-16): cuando lo que falla son CAMPOS
 * —no la forma ni la aritmética—, el resultado los nombra uno por uno y dice
 * que el camino es `preguntar_al_humano` por ESOS campos. Sin nombrarlos, el
 * único feedback determinista que el turno recibía era «el objeto no cuadra»,
 * y la respuesta aprendida a eso es rellenar el molde hasta que cuadre.
 */
function rechazo(errores: string[], avisos: string[] = [], faltantes: string[] = []): ResultadoTool {
  const huecos = [...new Set(faltantes)];
  // Cada hueco empuja UN error y UN faltante (el helper `falta()` de validar.ts
  // y los tres sitios que los empujan de a pares), así que la resta cuenta los
  // errores que NO son de campos: forma, catálogo, aritmética. Elegir el mensaje
  // sólo por `huecos.length > 0` daba el diagnóstico equivocado cuando fallaban
  // las dos cosas — «faltan datos, no forma» sobre un cuadre que no cierra manda
  // al turno a buscar un campo mientras el problema es que las cuentas no dan.
  const otros = Math.max(0, errores.length - faltantes.length);
  const partes: string[] = [];
  if (huecos.length > 0) {
    partes.push(
      `faltan CAMPOS: ${huecos.join(', ')}. Si podés obtenerlos de una fuente (el documento, ADM, DGII, el banco), traelos y volvé a llamar. ` +
        'Si NO podés, la salida es preguntar_al_humano nombrando exactamente esos campos y qué hace falta para llenarlos — inventarlos o deducirlos para que la validación pase es el desvío que esta compuerta existe para frenar',
    );
  }
  if (otros > 0) {
    partes.push(
      huecos.length > 0
        ? `y además hay ${otros} problema(s) que NO son de campos (forma, catálogo o aritmética): ésos se corrigen en la propuesta, y si la aritmética no da, el dato leído está mal — volvé al papel`
        : 'corregí y volvé a llamar. Si el problema es que el hecho no entra en ningún documento de ADM, la salida es preguntar_al_humano, no forzar el molde',
    );
  }
  return {
    error: 'la propuesta no pasó las validaciones; NADA se escribió',
    problemas: errores,
    campos_faltantes: huecos.length > 0 ? huecos : undefined,
    avisos: avisos.length > 0 ? avisos : undefined,
    instruccion: partes.length > 0
      ? partes.join(' — ')
      : 'corregí y volvé a llamar. Si el problema es que el hecho no entra en ningún documento de ADM, la salida es preguntar_al_humano, no forzar el molde',
  };
}

// ═══════════════════════════════════════════════════ el núcleo, servido a pedido

// `consultar_nucleo` sirve lo que el generador empaquetó en nucleo.ts: normas
// DGII, doctrina de asiento, NIIF-PYMES y los criterios ratificados de la
// empresa. Por qué a pedido y no inyectado entero: son ~110 KB y cada iteración
// re-paga el prompt sobre ~11k de presupuesto (contrato §5); lo que viaja en el
// system es el ÍNDICE, que es corto, y el documento se pide por su clave.
//
// Es SOLO lectura sobre un módulo del bundle: no toca base, ni red, ni ADM. Por
// eso vale igual en server, sombra, nube y examen, y no necesita entrada en el
// snapshot del corpus — la respuesta es la misma en cualquier corrida.

const NUCLEO_LINEAS_CONTEXTO = 15;
// Topes del fragmento: un `buscar` amplio podría devolver el núcleo entero y
// costar más que pedir el documento. Cuando se llega al tope se dice, con la
// instrucción de pedir el doc completo.
const NUCLEO_MAX_FRAGMENTOS = 8;
const NUCLEO_TOPE_FRAGMENTO = 1_200;
const NUCLEO_MIN_TERMINO = 3;

/**
 * Minúsculas sin tildes: «retención» y «retencion» tienen que colisionar, o
 * media búsqueda en un corpus fiscal dominicano falla por un acento.
 */
function normNucleo(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * El título del documento: su primer encabezado markdown. Los documentos
 * ratificados (doctrina, criterios) abren con front-matter YAML, así que la
 * primera línea es `---` y hay que saltarlo.
 */
function tituloNucleo(texto: string): string {
  const lineas = texto.split('\n');
  let i = 0;
  if (lineas[0]?.trim() === '---') {
    i = 1;
    while (i < lineas.length && lineas[i].trim() !== '---') i++;
    i++;
  }
  for (; i < lineas.length; i++) {
    const l = lineas[i].trim();
    if (l.startsWith('#')) return l.replace(/^#+\s*/, '').trim();
    if (l !== '') return recortar(l, 120);
  }
  return '(sin título)';
}

/** Índice del núcleo: clave + título. Lo pega el harness al system del turno. */
export const INDICE_NUCLEO: Array<{ clave: string; titulo: string }> = Object
  .entries(NUCLEO)
  .map(([clave, texto]) => ({ clave, titulo: tituloNucleo(texto) }));

interface FragmentoNucleo {
  clave: string;
  titulo: string;
  lineas: string;
  fragmento: string;
}

/** Las líneas que matchean, con su contexto y las ventanas vecinas fusionadas. */
function fragmentosNucleo(termino: string): { fragmentos: FragmentoNucleo[]; total: number } {
  const aguja = normNucleo(termino);
  const radio = Math.floor(NUCLEO_LINEAS_CONTEXTO / 2);
  const fragmentos: FragmentoNucleo[] = [];
  let total = 0;

  for (const [clave, texto] of Object.entries(NUCLEO)) {
    const lineas = texto.split('\n');
    // Dos coincidencias vecinas son UN fragmento, no dos que repiten renglones.
    const ventanas: Array<[number, number]> = [];
    for (let i = 0; i < lineas.length; i++) {
      if (!normNucleo(lineas[i]).includes(aguja)) continue;
      total++;
      const desde = Math.max(0, i - radio);
      const hasta = Math.min(lineas.length - 1, i + radio);
      const ultima = ventanas[ventanas.length - 1];
      if (ultima && desde <= ultima[1] + 1) ultima[1] = Math.max(ultima[1], hasta);
      else ventanas.push([desde, hasta]);
    }
    for (const [desde, hasta] of ventanas) {
      fragmentos.push({
        clave,
        titulo: tituloNucleo(texto),
        lineas: `${desde + 1}-${hasta + 1}`,
        fragmento: recortar(lineas.slice(desde, hasta + 1).join('\n'), NUCLEO_TOPE_FRAGMENTO),
      });
    }
  }
  return { fragmentos, total };
}

function consultarNucleo(args: Dic): ResultadoTool {
  const doc = String(args.doc ?? '').trim();
  const buscar = String(args.buscar ?? '').trim();

  if (doc !== '') {
    const texto = NUCLEO[doc];
    // Un documento que no está NO se inventa: vuelve el índice para que la
    // próxima llamada pida una clave que existe.
    if (texto === undefined) {
      return {
        error: `'${doc}' no existe en el núcleo`,
        indice: INDICE_NUCLEO,
        instruccion: 'pedí una de las claves del índice, copiada tal cual. Nunca cites una norma o un hecho que no leíste acá',
      };
    }
    return {
      clave: doc,
      titulo: tituloNucleo(texto),
      contenido: texto,
      nota: buscar !== '' ? '`buscar` se ignoró: con `doc` viaja el documento entero' : undefined,
    };
  }

  const salida: ResultadoTool = {
    indice: INDICE_NUCLEO,
    instruccion: 'el texto completo de cualquiera se pide con consultar_nucleo {doc: "<clave>"}',
  };
  if (buscar === '') return salida;

  if (normNucleo(buscar).length < NUCLEO_MIN_TERMINO) {
    return {
      ...salida,
      error: `'${buscar}' es demasiado corto para buscar (mínimo ${NUCLEO_MIN_TERMINO} caracteres): matchearía medio núcleo`,
    };
  }

  const { fragmentos, total } = fragmentosNucleo(buscar);
  const servidos = fragmentos.slice(0, NUCLEO_MAX_FRAGMENTOS);
  return {
    ...salida,
    buscar,
    coincidencias: total,
    fragmentos: servidos,
    // Un fragmento es un puntero, no la fuente: lo que se cita se lee entero.
    nota: total === 0
      ? 'ninguna coincidencia: el núcleo no habla de eso con esa palabra. Probá otra, o mirá el índice — si de verdad no está, decilo en vez de inventarlo'
      : fragmentos.length > servidos.length
      ? `se sirven ${servidos.length} de ${fragmentos.length} fragmentos: afiná el término o pedí el documento entero con {doc}`
      : 'antes de citar una norma o un hecho, pedí el documento entero: el fragmento es dónde está, no la fuente',
  };
}

// ════════════════════════════════════════════════════════ escrituras del bus

async function avisarProgreso(ctx: CtxTurno, args: Dic): Promise<ResultadoTool> {
  const texto = String(args.texto ?? '').trim();
  if (texto === '') return { error: '`texto` vacío: un progreso mudo no es señal de vida' };

  const fila = await filaFresca(ctx);
  // 'analizando' es el caso normal (la fila reclamada por esta invocación).
  // 'registrada' entra por la enmienda 3: en el motivo escribir_libro la fila
  // es terminal y no hay claim de estado, pero el hilo sigue vivo.
  if (fila.estado !== 'analizando' && fila.estado !== 'registrada' && ctx.modo !== 'examen') {
    throw new ErrorGuard(
      `avisar_progreso con la fila en '${fila.estado}': el claim ya no es tuyo (se exige analizando, o registrada en el motivo escribir_libro)`,
    );
  }

  const freno = await frenoDeEscritura(ctx, 'avisar_progreso', { evento: 'progreso', contenido: texto });
  if (freno) return freno;
  await insertarEventos(ctx, ctx.trabajoId, [{ tipo: 'progreso', contenido: texto }]);
  return { ok: true, evento: 'progreso' };
}

/**
 * Completa `tipo_gasto.adm_id` desde el catálogo 606 de la empresa cuando el
 * modelo trajo el código pero no el GUID. Determinista: es una traducción de
 * catálogo, no una decisión. Sin catálogo alcanzable no rompe nada — la
 * compuerta deja aviso y el registrador cae a su default de siempre.
 */
/**
 * El RNC de la propia empresa, de qualia_config (`empresa_rnc`). Se cachea por
 * proceso: no cambia en caliente y el cierre no debe pagar un SELECT por él.
 */
const cacheRncEmpresa = new Map<string, string>();
/**
 * El tope de magnitud de la brecha de ITBIS (`tope_brecha_itbis_pct`), en % del
 * total del papel. Se resuelve acá y viaja a la compuerta: `validarPropuesta` es
 * síncrona a propósito —es una función pura sobre el jsonb— y salir a la base
 * desde adentro la volvería otra cosa. Ilegible o ausente = el default del
 * módulo, nunca una puerta más ancha.
 */
const cacheTopeBrecha = new Map<string, number>();
async function topeBrechaDeLaEmpresa(ctx: CtxTurno): Promise<number> {
  const previo = cacheTopeBrecha.get(ctx.empresaId);
  if (previo !== undefined) return previo;
  let tope = TOPE_BRECHA_PCT_DEFAULT;
  try {
    const { data } = await ctx.db
      .from('qualia_config')
      .select('empresa_id, valor')
      .eq('clave', CLAVE_TOPE_BRECHA);
    const fila = (data ?? []).find((f: Dic) => f.empresa_id === ctx.empresaId) ??
      (data ?? []).find((f: Dic) => f.empresa_id === null);
    const v = fila?.valor as unknown;
    if (typeof v === 'number' && Number.isFinite(v)) tope = v;
    else if (v && typeof v === 'object') {
      for (const k of ['valor', CLAVE_TOPE_BRECHA]) {
        const n = (v as Dic)[k];
        if (typeof n === 'number' && Number.isFinite(n)) {
          tope = n;
          break;
        }
      }
    }
  } catch {
    tope = TOPE_BRECHA_PCT_DEFAULT;
  }
  cacheTopeBrecha.set(ctx.empresaId, tope);
  return tope;
}

async function rncDeLaEmpresa(ctx: CtxTurno): Promise<string> {
  const previo = cacheRncEmpresa.get(ctx.empresaId);
  if (previo !== undefined) return previo;
  let rnc = '';
  try {
    const { data } = await ctx.db
      .from('qualia_config')
      .select('valor')
      .eq('empresa_id', ctx.empresaId)
      .eq('clave', 'empresa_rnc')
      .single();
    const v = data?.valor as { rnc?: unknown } | string | null | undefined;
    rnc = typeof v === 'string' ? v : String((v as { rnc?: unknown })?.rnc ?? '');
  } catch {
    rnc = '';
  }
  cacheRncEmpresa.set(ctx.empresaId, rnc);
  return rnc;
}

async function resolverTipoGasto(ctx: CtxTurno, propuesta: Dic): Promise<void> {
  const tg = propuesta?.tipo_gasto as Record<string, unknown> | undefined;
  if (!tg || typeof tg !== 'object') return;
  const codigo = String(tg.codigo ?? '').trim();
  const admId = String(tg.adm_id ?? '').trim();
  if (codigo === '' || admId !== '') return;
  try {
    const cat = await bajarJson(ctx, rutaAggTiposGasto(ctx.empresaId));
    const fila = cat?.[codigo] as Record<string, unknown> | undefined;
    const guid = String(fila?.adm_id ?? '').trim();
    if (guid !== '') tg.adm_id = guid;
  } catch {
    // catálogo ausente o ilegible: el aviso de la compuerta lo dice
  }
}

async function proponer(ctx: CtxTurno, args: Dic): Promise<ResultadoTool> {
  const fila = await filaFresca(ctx);
  if (fila.tipo === 'caso') {
    return {
      error: 'un caso no se cierra con `proponer`: cada paso es un TRABAJO (abrir_trabajo) y el caso se contesta con preguntar_al_humano{dictamen}',
      nota: 'el caso jamás lleva registro_adm propio: es la pregunta, no el asiento',
    };
  }

  const resumen = String(args.resumen ?? '').trim();
  const propuesta = dic(args.propuesta);
  if (!propuesta) return rechazo(['`propuesta` tiene que ser un objeto jsonb']);

  const vResumen = validarResumen(resumen);
  // El dossier del preparador viaja a la compuerta: es contra su ficha de DGII
  // que se contrasta el eje fiscal de la propuesta. Una descarga del cache por
  // cierre de turno, y sólo en el cierre.
  await resolverTipoGasto(ctx, propuesta as Dic);
  const vPropuesta = validarPropuesta(propuesta, {
    hijoDeCaso: false,
    dossier: await dossierDelTurno(ctx),
    rncEmpresa: await rncDeLaEmpresa(ctx),
    topeBrechaPct: await topeBrechaDeLaEmpresa(ctx),
    // El precedente del EMISOR de esta propuesta: lo único que autoriza a
    // absorber una brecha de ITBIS sin preguntar. Se resuelve por llamada y sin
    // cache porque el propio turno puede haberlo creado hace dos iteraciones
    // (`ratificar_brecha_itbis`).
    precedenteBrecha: await precedenteDeLaEmpresa(ctx, (propuesta as Dic).rnc),
  });
  const errores = [...vResumen.errores, ...vPropuesta.errores];
  const avisos = [...vResumen.avisos, ...vPropuesta.avisos];
  const faltantes = [...vResumen.faltantes, ...vPropuesta.faltantes];

  // El turno NO registra en ADM (contrato §6.1): un registro_adm nuevo en la
  // propuesta sería evidencia fabricada, y el CHECK de la base lo tomaría por
  // buena para dejar pasar un `registrada`. Se acepta sólo si es EL MISMO que
  // ya tenía la fila (una corrección que lo conserva).
  const nuevo = (propuesta as Dic).registro_adm;
  if (nuevo !== undefined) {
    const viejo = (dic(fila.propuesta) ?? {}).registro_adm;
    if (JSON.stringify(nuevo) !== JSON.stringify(viejo)) {
      errores.push('`registro_adm` no lo escribe el turno: registrar en ADM es de otra pieza, y un DocID que nadie generó es una mentira sobre el libro contable');
    }
  }
  if ('cerrado' in propuesta) {
    errores.push('`propuesta.cerrado` es de la web: cerrar es del humano');
  }
  if (errores.length > 0) return rechazo(errores, avisos, faltantes);

  let eventos: EventoNuevo[];
  try {
    eventos = eventosDe(args.eventos, 'nota');
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  const freno = await frenoDeEscritura(ctx, 'proponer', {
    estado: 'propuesta',
    resumen,
    propuesta,
    eventos,
  });
  if (freno) return freno;

  await moverEstado(ctx, { estado: 'propuesta', resumen, propuesta }, DESDE_PARA_PROPUESTA);
  await insertarEventos(ctx, ctx.trabajoId, eventos);
  return { ok: true, estado: 'propuesta', eventos: eventos.length, avisos: avisos.length > 0 ? avisos : undefined };
}

async function preguntarAlHumano(ctx: CtxTurno, args: Dic): Promise<ResultadoTool> {
  const tipo = String(args.tipo ?? 'pregunta');
  if (tipo !== 'pregunta' && tipo !== 'dictamen') {
    return { error: `\`tipo\` '${tipo}' desconocido: pregunta | dictamen` };
  }
  const texto = String(args.texto ?? '').trim();
  if (texto === '') return { error: '`texto` vacío: una pregunta sin pregunta deja la fila esperando para siempre' };

  let extras: EventoNuevo[];
  try {
    extras = eventosDe(args.eventos, 'nota');
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  // El dictamen de un caso es una NOTA («ya te dije lo que pienso, decidí
  // vos»); la pregunta abierta es un evento `pregunta`.
  const eventos: EventoNuevo[] = [
    ...extras,
    { tipo: tipo === 'dictamen' ? 'nota' : 'pregunta', contenido: texto },
  ];

  const freno = await frenoDeEscritura(ctx, 'preguntar_al_humano', {
    estado: 'esperando_respuesta',
    tipo,
    eventos,
  });
  if (freno) return freno;

  await moverEstado(ctx, { estado: 'esperando_respuesta' }, DESDE_PARA_PREGUNTA);
  await insertarEventos(ctx, ctx.trabajoId, eventos);
  return { ok: true, estado: 'esperando_respuesta', tipo };
}

/**
 * El acuse que no cambia nada: la respuesta a un rechazo, el aviso de que
 * falta algo, el cierre de una corrección que no generaliza.
 *
 * El marcador `datos.criterio` es obligatorio SOLO en el carril de
 * correcciones y rechazos explicados (enmienda 5): en un acuse simple va
 * omitido para no ensuciar la auditoría — los hilos SIN marcador son los que
 * se revisan cuando hay que buscar correcciones perdidas.
 */
async function responder(ctx: CtxTurno, args: Dic): Promise<ResultadoTool> {
  let eventos: EventoNuevo[];
  try {
    eventos = eventosDe(args.eventos, 'nota');
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  if (eventos.length === 0) return { error: '`eventos` vacío: responder sin decir nada no responde nada' };

  const criterio = args.criterio === undefined || args.criterio === null
    ? null
    : String(args.criterio);
  if (criterio !== null && criterio !== 'si' && criterio !== 'no') {
    return { error: `\`criterio\` '${criterio}' inválido: 'si' | 'no' (o se omite en un acuse)` };
  }
  if (criterio === 'no' && String(args.motivo_no ?? '').trim() === '') {
    return { error: "con criterio='no' va `motivo_no`: por qué NO generaliza (¿corrigió lo que VISTE o lo que CONCLUISTE?)" };
  }
  if (criterio !== null) {
    const ultimo = eventos[eventos.length - 1];
    ultimo.datos = {
      criterio,
      ...(criterio === 'no' ? { motivo_no: String(args.motivo_no ?? '').trim() } : {}),
    };
  }

  // `otros_rechazos` es el batch que el harness precarga: cuando caen varios
  // seguidos —lo normal al rehacer el plan de un caso— UNA sola pasada los
  // contesta todos. Va acá adentro y no en llamadas sueltas porque `responder`
  // CIERRA el turno: la segunda llamada nunca correría. Antes esto era una
  // sesión de LLM por cada rechazo, y llenaban el cupo.
  //
  // TODO: el contrato §2.3 no le dio destinatario a esos otros rechazos (la
  // firma de `responder` no lleva trabajo_id). Se resuelve con el guard
  // determinista del fuente —no con confianza en el modelo—; si la revisión
  // prefiere otro camino, es este bloque el que se cambia.
  const otrosCrudos = args.otros_rechazos;
  const otros: Array<{ trabajo_id: string; contenido: string }> = [];
  if (otrosCrudos !== undefined && otrosCrudos !== null) {
    if (!Array.isArray(otrosCrudos)) return { error: '`otros_rechazos` tiene que ser un array' };
    for (const crudo of otrosCrudos) {
      const o = dic(crudo);
      const id = String(o?.trabajo_id ?? '').trim();
      const contenido = String(o?.contenido ?? '').trim();
      if (!RE_UUID.test(id)) return { error: `\`otros_rechazos\`: '${id}' no es un UUID` };
      if (contenido === '') return { error: `\`otros_rechazos\`: al rechazo ${id} le falta la nota` };
      if (id === ctx.trabajoId) continue; // ése es el destino principal
      // En examen no se verifica contra la base: el corpus es histórico y esas
      // filas ya no están en el estado del momento. La decisión se captura
      // igual, y el guard real corre en sombra y en nube.
      const permiso = ctx.modo === 'examen' ? null : await esRechazoDelBatch(ctx, id);
      if (permiso !== null) return { error: permiso };
      otros.push({ trabajo_id: id, contenido });
    }
  }

  const freno = await frenoDeEscritura(ctx, 'responder', {
    trabajo_id: ctx.trabajoId,
    sin_cambio_de_estado: true,
    eventos,
    otros_rechazos: otros,
  });
  if (freno) return freno;

  await insertarEventos(ctx, ctx.trabajoId, eventos);
  const contestados: string[] = [];
  const fallados: string[] = [];
  for (const o of otros) {
    try {
      await insertarEventos(ctx, o.trabajo_id, [{ tipo: 'nota', contenido: o.contenido }]);
      contestados.push(o.trabajo_id);
    } catch (e) {
      // Un hermano que falla no tumba el cierre propio: se dice cuál quedó sin
      // contestar y el batch lo vuelve a traer.
      fallados.push(`${o.trabajo_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return {
    ok: true,
    trabajo_id: ctx.trabajoId,
    estado: 'sin cambios',
    eventos: eventos.length,
    otros_contestados: contestados.length > 0 ? contestados : undefined,
    otros_fallados: fallados.length > 0 ? fallados : undefined,
  };
}

/**
 * ¿`id` es uno de los rechazos que el turno puede contestar? Devuelve null si
 * sí, y el motivo si no. Es el `not exists` del fuente, verificado del lado
 * del código: misma empresa, `rechazada`, sin cierre automático
 * (`superada_por_ncf`) y sin respuesta del contable posterior a la voz del
 * humano — eso último es lo que evita el bucle.
 */
async function esRechazoDelBatch(ctx: CtxTurno, id: string): Promise<string | null> {
  const { data: fila, error } = await ctx.db
    .from('qualia_trabajos')
    .select('id, estado, propuesta, updated_at')
    .eq('id', id)
    .eq('empresa_id', ctx.empresaId)
    .maybeSingle();
  if (error || !fila) return `el trabajo ${id} no es de esta empresa o no existe`;
  if (fila.estado !== 'rechazada') return `el trabajo ${id} está en '${fila.estado}': por acá sólo se contestan rechazos del batch`;
  if (dic(fila.propuesta) && 'superada_por_ncf' in (dic(fila.propuesta) as Dic)) {
    return 'ese rechazo lo cerró el cron de conciliación (superada_por_ncf): no hay humano que haya hablado, y contestarle a una máquina es ruido en el hilo';
  }
  // Ventana amplia (2 h) contra la del fuente (15 min): el harness ya filtró
  // por recencia al precargar el batch; acá alcanza con impedir que el turno
  // escriba sobre un rechazo viejo que nadie le puso delante.
  const edadMs = Date.now() - new Date(String(fila.updated_at ?? 0)).getTime();
  if (!Number.isFinite(edadMs) || edadMs > 2 * 60 * 60 * 1000) {
    return `el rechazo ${id} no es reciente: no es del batch de este turno`;
  }
  const { data: evs } = await ctx.db
    .from('qualia_eventos')
    .select('id, autor')
    .eq('trabajo_id', id)
    .order('id', { ascending: false })
    .limit(20);
  const ultimoUsuario = (evs ?? []).find((e) => e.autor === 'usuario');
  if (ultimoUsuario && (evs ?? []).some((e) => e.autor === 'contable' && e.id > ultimoUsuario.id)) {
    return `al rechazo ${id} ya le contestaste: no repitas (es el bucle que el not-exists evita)`;
  }
  return null;
}

async function marcarError(ctx: CtxTurno, args: Dic): Promise<ResultadoTool> {
  const detalle = String(args.error_detalle ?? '').trim();
  if (detalle === '') {
    return { error: '`error_detalle` vacío: un trabajo mudo es un trabajo perdido — escribí qué pasó, legible para el humano' };
  }
  const nota = String(args.nota ?? '').trim();
  if (nota === '') return { error: '`nota` vacía: el hilo tiene que decir qué pasó, no sólo la fila' };

  const duplicadoDe = String(args.duplicado_de ?? '').trim();
  let vigente: { id: string; estado: string; propuesta: Dic } | null = null;
  if (duplicadoDe !== '') {
    if (!RE_UUID.test(duplicadoDe)) return { error: '`duplicado_de` no es un UUID' };
    if (duplicadoDe === ctx.trabajoId) return { error: '`duplicado_de` apunta a este mismo trabajo' };
    if (ctx.modo !== 'examen') {
      // Enmienda 7: misma empresa y estado en (aprobada, registrada). Un
      // trabajo en cualquier otro estado no es «el vigente».
      const { data, error } = await ctx.db
        .from('qualia_trabajos')
        .select('id, estado, propuesta')
        .eq('id', duplicadoDe)
        .eq('empresa_id', ctx.empresaId)
        .in('estado', ['aprobada', 'registrada'])
        .maybeSingle();
      if (error || !data) {
        return {
          error: `\`duplicado_de\`: ${duplicadoDe} no es un trabajo VIGENTE de esta empresa (se exige estado aprobada o registrada)`,
          nota: 'un documento con eliminado_en/anulado_en NO es duplicado: FP00001120 caía en error para siempre por eso',
        };
      }
      vigente = { id: data.id as string, estado: data.estado as string, propuesta: dic(data.propuesta) ?? {} };
    }
  }

  const freno = await frenoDeEscritura(ctx, 'marcar_error', {
    estado: 'error',
    error_detalle: detalle,
    nota,
    duplicado_de: duplicadoDe || null,
    comprobante_de_trabajo: duplicadoDe ? ctx.trabajoId : null,
  });
  if (freno) return freno;

  // El enlace del comprobante va PRIMERO: es lo irrecuperable de esta tool (el
  // papel del anticipo ISR quedó varado en una fila en error, 672eacb4 →
  // 646ed1cf). Si falla, la fila propia sigue viva y el turno puede reintentar.
  let enlace: ResultadoTool | null = null;
  if (vigente) {
    const propuestaNueva = {
      ...vigente.propuesta,
      comprobante_de_trabajo: ctx.trabajoId,
    };
    const { data: tocada, error: eLink } = await ctx.db
      .from('qualia_trabajos')
      .update({ propuesta: propuestaNueva })
      .eq('id', vigente.id)
      .eq('empresa_id', ctx.empresaId)
      // El guard de estado en el WHERE, como toda escritura (enmienda 7). Sin
      // transacciones no hay CAS sobre el jsonb: si alguien reescribió la
      // propuesta entre la lectura y esto, el merge la pisa — por eso se lee y
      // se escribe pegado, y el estado acota la ventana.
      .in('estado', ['aprobada', 'registrada'])
      .select('id');
    if (eLink || !tocada || tocada.length === 0) {
      enlace = { error: `no pude enlazar el comprobante al trabajo vigente: ${eLink?.message ?? 'el guard de estado no matcheó'}` };
    } else {
      await insertarEventos(ctx, vigente.id, [{
        tipo: 'nota',
        contenido: `📎 El comprobante de este trabajo llegó por separado y quedó enlazado (trabajo ${ctx.trabajoId}, cerrado como subida duplicada).`,
        datos: { comprobante_de_trabajo: ctx.trabajoId },
      }]);
    }
  }
  if (enlace) return enlace; // sin enlace no se cierra la fila propia: el papel se perdería

  await moverEstado(ctx, { estado: 'error', error_detalle: detalle }, DESDE_PARA_ERROR);
  await insertarEventos(ctx, ctx.trabajoId, [{ tipo: 'nota', contenido: nota }]);
  return {
    ok: true,
    estado: 'error',
    enlazado_a: vigente?.id ?? null,
  };
}

// ── la rama de casos ────────────────────────────────────────────────────────

async function abrirTrabajo(ctx: CtxTurno, args: Dic): Promise<ResultadoTool> {
  const madre = await filaFresca(ctx);
  if (madre.tipo !== 'caso') {
    throw new ErrorGuard(`abrir_trabajo desde un trabajo tipo '${madre.tipo}': los hijos nacen de un CASO, y el turno no abre trabajos por su cuenta (las sugerencias son de los detectores)`);
  }
  if (madre.estado !== 'analizando' && ctx.modo !== 'examen') {
    throw new ErrorGuard(`abrir_trabajo con el caso en '${madre.estado}': el claim ya no es tuyo`);
  }

  const resumen = String(args.resumen ?? '').trim();
  const propuesta = dic(args.propuesta);
  if (!propuesta) return rechazo(['`propuesta` tiene que ser un objeto jsonb']);

  const vResumen = validarResumen(resumen);
  // El dossier del CASO: si el paso nace de un papel, su verificación fiscal
  // está ahí y vale lo mismo que en `proponer`; si el caso no tiene dossier, la
  // compuerta no compara nada (ausencia no es contradicción).
  await resolverTipoGasto(ctx, propuesta as Dic);
  const vPropuesta = validarPropuesta(propuesta, {
    hijoDeCaso: true,
    rncEmpresa: await rncDeLaEmpresa(ctx),
    dossier: await dossierDelTurno(ctx),
    topeBrechaPct: await topeBrechaDeLaEmpresa(ctx),
    precedenteBrecha: await precedenteDeLaEmpresa(ctx, (propuesta as Dic).rnc),
  });
  const errores = [...vResumen.errores, ...vPropuesta.errores];
  const avisos = [...vResumen.avisos, ...vPropuesta.avisos];
  // La compuerta vale igual acá: un paso del caso nace en `propuesta`, va al
  // mismo botón y lo registra el MISMO script. La lápida es del caso Formax —
  // el paso de 90k salió sin `fecha` y el humano lo rechazó.
  const faltantes = [...vResumen.faltantes, ...vPropuesta.faltantes];

  if ('registro_adm' in propuesta) {
    errores.push('`registro_adm` no lo escribe el turno: nace cuando la pieza que registra lo genere');
  }
  if ('caso_id' in propuesta) {
    // No es capricho: el caso_id lo pone el harness desde la fila. Si lo
    // pusiera el modelo, un caso_id equivocado ata el paso al caso de otro.
    errores.push('`caso_id` no va en tu propuesta: lo pone el sistema desde la fila del caso');
  }

  // Un hijo que resuelve un movimiento del banco SIN banco_tx_id deja el
  // movimiento en la lista de sueltos y la misma plata se cuenta dos veces: la
  // mesa descarta por banco_tx_id, no por el caso.
  const doc = String(propuesta.documento_adm ?? '');
  const tocaBanco = ['BankCharges', 'BankBankTransfers', 'BillPayments', 'AccountPayments'].includes(doc);
  const filasBanco = (Array.isArray((dic(madre.propuesta) ?? {}).filas)
    ? ((dic(madre.propuesta) as Dic).filas as unknown[])
    : [])
    .map(dic)
    .filter((f): f is Dic => f !== null && String(f.origen ?? '') === 'banco');
  if (tocaBanco && filasBanco.length > 0 && String(propuesta.banco_tx_id ?? '').trim() === '') {
    errores.push(
      'falta `banco_tx_id`: este paso resuelve un movimiento del banco del caso y sin él la misma plata se cuenta dos veces. ' +
        `Los movimientos del caso son: ${filasBanco.map((f) => `${f.tx_id} (${f.resumen ?? ''})`).join(' · ')}`,
    );
    faltantes.push('banco_tx_id');
  }
  if (errores.length > 0) return rechazo(errores, avisos, faltantes);

  const propuestaHija: Dic = { ...propuesta, caso_id: ctx.trabajoId };
  const freno = await frenoDeEscritura(ctx, 'abrir_trabajo', {
    tabla: 'qualia_trabajos',
    tipo: 'sugerencia',
    origen: 'caso',
    estado: 'propuesta',
    resumen,
    propuesta: propuestaHija,
  });
  if (freno) return freno;

  const { data, error } = await ctx.db
    .from('qualia_trabajos')
    .insert({
      empresa_id: ctx.empresaId,
      tipo: 'sugerencia',
      origen: 'caso',
      estado: 'propuesta',
      resumen,
      propuesta: propuestaHija,
    })
    .select('id')
    .single();
  if (error || !data) {
    // El trigger de la base (Journals contra caja) revienta acá: su mensaje es
    // información contable, no ruido — viaja tal cual al modelo.
    return { error: `no pude abrir el trabajo hijo: ${error?.message ?? 'sin fila'}` };
  }

  await insertarEventos(ctx, ctx.trabajoId, [{
    tipo: 'nota',
    contenido: `➕ Abrí el paso «${resumen}» como trabajo aprobable (${data.id}).`,
    datos: { hijo_id: data.id },
  }]);
  return {
    ok: true,
    trabajo_hijo_id: data.id,
    estado: 'propuesta',
    avisos: avisos.length > 0 ? avisos : undefined,
    nota: 'el caso sigue vivo: abrir pasos no lo cierra — cerrarlo es del humano',
  };
}

/**
 * La excepción documentada a «`rechazada` la mueve el usuario»: traducir su
 * decisión, no tomarla. Por eso el guard exige voz del humano POSTERIOR al
 * hijo — sin eso, esto sería el turno rechazando trabajo propio.
 */
async function rechazarPaso(ctx: CtxTurno, args: Dic): Promise<ResultadoTool> {
  const madre = await filaFresca(ctx);
  if (madre.tipo !== 'caso') {
    throw new ErrorGuard('rechazar_paso sólo existe dentro de un caso: sobre cualquier otra fila, rechazar es del humano');
  }
  const hijoId = String(args.trabajo_hijo_id ?? '').trim();
  const motivo = String(args.motivo ?? '').trim();
  if (!RE_UUID.test(hijoId)) return { error: '`trabajo_hijo_id` no es un UUID' };
  if (motivo === '') return { error: '`motivo` vacío: el hilo tiene que decir por qué se reemplaza el paso' };

  // En examen los hijos del caso son historia: no se verifican contra la base
  // (no existen en el estado del momento) y la decisión se captura simulada.
  if (ctx.modo === 'examen') {
    return await frenoDeEscritura(ctx, 'rechazar_paso', {
      trabajo_hijo_id: hijoId,
      estado: 'rechazada',
      nota: `Reemplazada por el nuevo plan del caso: ${motivo}`,
    }) ?? { ok: true };
  }

  const { data: hijo, error } = await ctx.db
    .from('qualia_trabajos')
    .select('id, estado, resumen, created_at, propuesta')
    .eq('id', hijoId)
    .eq('empresa_id', ctx.empresaId)
    .maybeSingle();
  if (error || !hijo) return { error: `el trabajo ${hijoId} no es de esta empresa o no existe` };
  if (String((dic(hijo.propuesta) ?? {}).caso_id ?? '') !== ctx.trabajoId) {
    return { error: `el trabajo ${hijoId} no es hijo de este caso: sólo se rechazan los pasos del caso en curso` };
  }
  if (hijo.estado !== 'propuesta') {
    return { error: `el paso ${hijoId} está en '${hijo.estado}': sólo se reemplazan los que el humano todavía no decidió` };
  }

  // La voz del humano: un evento suyo en el caso POSTERIOR a la creación del
  // hijo. Sin eso no hay replan pedido y esto sería decidir por él.
  const { data: voces } = await ctx.db
    .from('qualia_eventos')
    .select('id, created_at')
    .eq('trabajo_id', ctx.trabajoId)
    .eq('autor', 'usuario')
    .gt('created_at', String(hijo.created_at))
    .limit(1);
  if (!voces || voces.length === 0) {
    return {
      error: 'no hay voz del humano posterior a ese paso: rechazarlo sería tomar su decisión, no traducirla',
      instruccion: 'si el plan cambió por algo que VOS descubriste, decíselo y preguntá — el botón es suyo',
    };
  }

  const numero = (dic(madre.propuesta) ?? {}).numero;
  const nota = `Reemplazada por el nuevo plan del Caso #${numero ?? '?'}: ${motivo}`;
  const freno = await frenoDeEscritura(ctx, 'rechazar_paso', {
    trabajo_hijo_id: hijoId,
    estado: 'rechazada',
    nota,
  });
  if (freno) return freno;

  const { data: tocada, error: eUpd } = await ctx.db
    .from('qualia_trabajos')
    .update({ estado: 'rechazada' })
    .eq('id', hijoId)
    .eq('empresa_id', ctx.empresaId)
    .eq('estado', 'propuesta')
    .eq('propuesta->>caso_id', ctx.trabajoId)
    .select('id');
  if (eUpd || !tocada || tocada.length === 0) {
    return { error: `NADA SE ESCRIBIÓ sobre ${hijoId}: ${eUpd?.message ?? 'el guard no matcheó (¿el humano lo movió?)'}` };
  }
  await insertarEventos(ctx, hijoId, [{ tipo: 'nota', contenido: nota, datos: { caso_id: ctx.trabajoId } }]);
  return { ok: true, trabajo_hijo_id: hijoId, estado: 'rechazada' };
}

// ── el carril de criterios ──────────────────────────────────────────────────

async function proponerCriterio(ctx: CtxTurno, args: Dic): Promise<ResultadoTool> {
  const fila = await filaFresca(ctx);
  if (fila.tipo === 'criterio') {
    return {
      error: 'un criterio no engendra otro criterio: se muerde la cola. Si lo rechazaron, cerralo con `responder`',
    };
  }
  const titulo = String(args.titulo ?? '').trim();
  const enunciado = String(args.enunciado ?? '').trim();
  const alcance = String(args.alcance ?? '').trim();
  const sosten = String(args.sosten ?? '').trim();
  const faltan = [
    titulo === '' ? 'titulo' : null,
    enunciado === '' ? 'enunciado' : null,
    // Las cuatro reglas que no se negocian, ahora en el schema: alcance
    // requerido y no vacío (una regla sin borde se aplica donde no debe) y
    // sostén requerido (cuántos documentos lo respaldan, o «palabra del dueño»).
    alcance === '' ? 'alcance' : null,
    sosten === '' ? 'sosten' : null,
  ].filter(Boolean);
  if (faltan.length > 0) {
    return {
      error: `faltan campos del criterio: ${faltan.join(', ')}`,
      nota: 'si no sabés hasta dónde llega, poné el borde más chico que sea cierto (ese proveedor, esa cuenta) y decilo en el sostén',
    };
  }

  // UNA regla por fila (la tool no acepta más) y NUNCA la clave `archivo`: con
  // ella, aprobar marcaría `estado: ratificado` en un archivo de memoria
  // ENTERO — 73 fichas, ninguna revisada. Por eso `archivo` no existe en la
  // firma: no es un olvido posible.
  const propuesta: Dic = {
    n_reglas: 1,
    reglas: [{ titulo, enunciado, alcance }],
    origen_trabajo: ctx.trabajoId,
    sosten,
    detalle: `Sale de la corrección del humano sobre «${fila.resumen ?? ctx.trabajoId}» (trabajo ${ctx.trabajoId}). Sostén: ${sosten}`,
  };
  const resumen = `Criterio: ${titulo}`;
  const marcador: EventoNuevo = {
    tipo: 'nota',
    contenido: `Criterio propuesto: ${titulo}`,
    datos: { criterio: 'si' },
  };

  const freno = await frenoDeEscritura(ctx, 'proponer_criterio', {
    tabla: 'qualia_trabajos',
    tipo: 'criterio',
    origen: 'correccion_usuario',
    estado: 'propuesta',
    resumen,
    propuesta,
    marcador: marcador.datos,
  });
  if (freno) return freno;

  const { data, error } = await ctx.db
    .from('qualia_trabajos')
    .insert({
      empresa_id: ctx.empresaId,
      tipo: 'criterio',
      origen: 'correccion_usuario',
      estado: 'propuesta',
      resumen,
      propuesta,
    })
    .select('id')
    .single();
  if (error || !data) return { error: `no pude insertar el criterio: ${error?.message ?? 'sin fila'}` };

  await insertarEventos(ctx, ctx.trabajoId, [marcador]);
  return {
    ok: true,
    trabajo_criterio_id: data.id,
    estado: 'propuesta',
    nota: 'lo ratifica el dueño, no vos: seguí con lo tuyo. Al aprobarse nace como entrada de libro, o sea precedente de primera clase',
  };
}

// ════════════════════════════════════════════════════════════ los 16 schemas

interface EsquemaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Dic;
  };
}

const tool = (name: string, description: string, parameters: Dic): EsquemaTool => ({
  type: 'function',
  function: { name, description, parameters },
});

const objeto = (properties: Dic, required: string[] = []): Dic => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const texto = (description: string): Dic => ({ type: 'string', description });

/**
 * El jsonb de la propuesta, UNO para `proponer` y `abrir_trabajo`: los dos
 * paran en la MISMA compuerta (`validarPropuesta`) y los registra el mismo
 * script, así que declarar los campos en uno y dejar el otro con
 * `{type:'object'}` suelto era pedirle al turno que adivine en la rama de casos
 * lo que en la otra le viene dictado.
 *
 * `required` lleva sólo lo que TODO documento necesita. `lineas` quedó afuera a
 * propósito: BillPayments se registra sin ellas —su registrador no lee
 * `p["lineas"]`— y pedirlas en el schema empujaba a inventar un asiento que
 * nadie va a leer. Los condicionales por documento (asignacion, cuenta_numero,
 * banco_id, direccion, tipo_gasto.adm_id…) los dice la compuerta al rechazar,
 * con el motivo; repetirlos acá se re-paga en cada iteración.
 */
const PROPUESTA_SCHEMA = (description: string): Dic => ({
  type: 'object',
  description,
  properties: {
    documento_adm: texto('VendorBills | VendorCreditNotes | BankCharges | BankBankTransfers | BillPayments | AccountPayments | Journals'),
    fecha: texto('AAAA-MM-DD, la del documento'),
    moneda: texto('DOP | USD…'),
    monto: { type: 'number', description: 'el total del documento (en Journals, la suma de los débitos)' },
    itbis: { type: 'number' },
    proveedor: texto('en factura: el nombre del emisor'),
    rnc: texto('en factura: 9 u 11 dígitos'),
    ncf: texto('el comprobante, si el papel lo trae'),
    numero_factura_suplidor: texto('la referencia del papel; obligatoria si NO hay ncf'),
    dgii: { type: 'object', description: 'la verificación TAL CUAL vino de consultar_dgii o del dossier', additionalProperties: true },
    rnc_padron: { type: 'object', description: 'el padrón, cuando el comprobante no verifica', additionalProperties: true },
    tipo_gasto: {
      type: 'object',
      description: 'el 606 de la cabecera, UNO por documento',
      properties: {
        codigo: texto('01..11'),
        nombre: texto('el del catálogo'),
        adm_id: texto('el GUID del tipo de gasto en ADM: es lo que viaja al POST, y sin él se registra el 02'),
      },
      required: ['codigo', 'nombre'],
      additionalProperties: true,
    },
    lineas: { type: 'array', description: 'items {descripcion,cantidad,precio,itbis,cuenta,cuenta_nombre} o partida doble {cuenta,cuenta_nombre,descripcion,debito,credito}. BillPayments va sin ellas', items: { type: 'object', additionalProperties: true } },
    direccion: { type: 'string', enum: ['cargo', 'credito'], description: 'en BankCharges, obligatoria: cargo = salió plata, credito = entró' },
    banco_tx_id: texto('el movimiento del banco que este documento resuelve'),
    cuenta_numero: texto('en BillPayments: el número de la cuenta o tarjeta de la que sale el pago'),
    banco_id: texto('en AccountPayments: el GUID de la cuenta de caja en ADM'),
    asignacion: { type: 'object', description: 'en BillPayments: {facturas:[{docid, monto}]}, la(s) factura(s) que cierra', additionalProperties: true },
    metodo: { type: 'string', enum: ['precedente', 'script', 'razonado'] },
    precedente_ref: texto('obligatorio si metodo != razonado'),
    detalle: texto('los dos pisos: explicación y «Sostén:»'),
  },
  required: ['documento_adm', 'fecha', 'moneda', 'detalle'],
  additionalProperties: true,
});

const EVENTOS_SCHEMA = (description: string): Dic => ({
  type: 'array',
  description,
  items: objeto(
    {
      tipo: { type: 'string', enum: ['progreso', 'nota', 'pregunta'] },
      contenido: texto('el texto, como se lo dirías al humano'),
    },
    ['tipo', 'contenido'],
  ),
});

/**
 * Los schemas van al modelo en CADA iteración: ~2,5k tokens que se re-pagan
 * hasta 8 veces por invocación sobre un presupuesto de ~11k (contrato §5). Por
 * eso las descripciones dicen SÓLO lo que evita una llamada perdida —qué hace,
 * qué guard la frena y la lápida que ahorra un viaje— y la doctrina contable
 * (las 5 preguntas, la jerarquía P-003, el formato del detalle) queda donde ya
 * viaja: la tajada. Repetirla acá es pagarla dos veces por iteración.
 */
export const ESQUEMAS_TOOLS: EsquemaTool[] = [
  // ── lectura ───────────────────────────────────────────────────────────────
  tool(
    'dossier_completo',
    'Todo el contexto en UN viaje: fila, propuesta, hilo, dossier del preparador (extracción, DGII, duplicados), clasificación del proponedor, precedente del proveedor y, si es un caso, sus hijos. Ya viene precargado: llamalo sólo tras una corrección o para releer el hilo entero.',
    objeto({
      hilo_completo: {
        type: 'boolean',
        description: 'true para traer el hilo entero en vez de los últimos 5 eventos',
      },
    }),
  ),
  tool(
    'leer_adm',
    'Lee ADM Cloud (SOLO lectura). documento: por uuid o por docid. listado: una página de un tipo, 50 por página — NO trae anulados, así que una ausencia no prueba que el documento murió. ap_saldo: cuentas por pagar ABIERTAS (la que no aparece ya se pagó). vendor: por RNC exacto. plan_cuentas: el vecindario COMPLETO de una serie del plan VIVO.',
    objeto(
      {
        modo: {
          type: 'string',
          enum: ['documento', 'listado', 'ap_saldo', 'vendor', 'plan_cuentas'],
        },
        tipo_doc: { type: 'string', enum: [...TIPOS_DOC] },
        uuid: texto('el ID de ADM del documento'),
        docid: texto('el número visible (FP00001061, CB00000258…)'),
        rnc: texto('RNC/cédula, sólo dígitos o con guiones'),
        serie: texto('serie del plan de cuentas, p. ej. "220" o "611"'),
        pagina: { type: 'integer', description: 'página del listado, base 0' },
      },
      ['modo'],
    ),
  ),
  tool(
    'consultar_banco',
    'Movimientos del banco de la empresa: fecha_posteo, monto (negativo = salió plata), descripcion, nro_referencia, estado_conciliacion. Por tx_id o filtrando. OJO: monto+fecha NO prueban identidad, y el banco impreso en el papel no es la cuenta de origen.',
    objeto({
      tx_id: texto('uuid del movimiento'),
      cuenta: texto('número de cuenta bancaria'),
      desde: texto('fecha desde, YYYY-MM-DD (por defecto, 120 días atrás)'),
      hasta: texto('fecha hasta, YYYY-MM-DD'),
      monto: { type: 'number', description: 'importe a buscar; se compara en valor absoluto, tolerancia 0,05' },
      texto: texto('parte de la descripción'),
    }),
  ),
  tool(
    'buscar_precedente',
    'Cómo registró ESTA empresa cosas parecidas: histórico destilado por proveedor + entradas del libro. Sus etiquetas se leen literales y no se reinterpretan: PRECEDENTE (citable), SIN CUENTA DOMINANTE (no lo es: repartí por renglón), MUESTRA INSUFICIENTE (señal, no precedente), PARECIDOS DE NOMBRE (no lo son). El precedente de ESTE proveedor ya vino en dossier_completo: esto es para OTRA búsqueda.',
    objeto({
      termino: texto('nombre del proveedor (entre comillas si tiene &)'),
      rnc: texto('RNC del proveedor'),
      cuenta: texto('código de cuenta: quién la usa en el histórico'),
      plan: texto('palabra a buscar en el plan de cuentas completo'),
      tipos: { type: 'boolean', description: 'true: catálogo de tipos de gasto 606 en uso' },
    }),
  ),
  tool(
    'consultar_dgii',
    'Consulta a la DGII: ncf (comprobante impreso), timbre (la URL del QR de un e-CF, que pisa al texto del papel) o padron (RNC). SÓLO si el dossier trae ese campo ausente o «no verificable» — con campo presente, re-consultar está prohibido. Jamás inventes el resultado: si DGII no contesta, eso es el resultado.',
    objeto(
      {
        modo: { type: 'string', enum: ['ncf', 'timbre', 'padron'] },
        rnc: texto('RNC del emisor'),
        ncf: texto('el NCF/e-NCF'),
        url_qr: texto('la URL completa del QR del e-CF (modo timbre)'),
      },
      ['modo'],
    ),
  ),
  tool(
    'consultar_nucleo',
    'Lo ESCRITO que manda sobre tu juicio, empaquetado con vos: normas de la DGII, doctrina de asiento (P-001..P-005 y el mapa hecho→asiento H-01..H-12), NIIF-PYMES y los criterios RATIFICADOS de la empresa. Sin argumentos, el índice; `buscar` agrega los fragmentos que mencionan la palabra; `doc` trae el documento entero. La clave se copia del índice del system: si no está ahí, no existe. Antes de razonar un asiento sin precedente, leelo — citar de memoria una norma o un hecho es inventarlo.',
    objeto({
      doc: texto('la clave exacta del índice, p. ej. "doctrina/conciliacion-hechos"'),
      buscar: texto('palabra o frase a buscar en todo el núcleo (ignora mayúsculas y tildes)'),
    }),
  ),

  // ── escritura intermedia ─────────────────────────────────────────────────
  tool(
    'avisar_progreso',
    'Escribe un evento de progreso en el hilo: la señal de que te estás moviendo, que la mesa muestra en vivo. Uno por FASE, no por comando. Los del cierre van dentro de la tool de cierre, no acá.',
    objeto({ texto: texto('qué estás haciendo, en una línea, hablándole al humano') }, ['texto']),
  ),

  // ── cierre (una sola por invocación) ─────────────────────────────────────
  tool(
    'proponer',
    'CIERRA el turno dejando la fila en propuesta. Valida ANTES de escribir, y en DOS ejes: forma (catálogo, lineas, cuadre 0,05, débitos = créditos, «Sostén:») y SUFICIENCIA — los campos que el script de registro exige antes del POST, según el documento_adm elegido. Si falla no se escribe NADA y te vuelve la lista, con los campos faltantes por nombre: ésos no se deducen, se buscan o se preguntan.',
    objeto(
      {
        resumen: texto('el título de la tarjeta: sólo QUÉ ES, corto'),
        propuesta: PROPUESTA_SCHEMA('el jsonb del documento. Nada de cuenta_destino ni registro_adm.'),
        eventos: EVENTOS_SCHEMA('el cierre para el hilo: qué decidiste y por qué'),
      },
      ['resumen', 'propuesta', 'eventos'],
    ),
  ),
  tool(
    'preguntar_al_humano',
    'CIERRA el turno dejando la fila en esperando_respuesta. tipo=pregunta para lo que no podés decidir; tipo=dictamen para cerrar un caso contestando («ya te dije lo que pienso, decidí vos»). El dictamen termina en botones: los pasos que haya que aplicar se abren con abrir_trabajo — nunca se le reparte trabajo manual al que aprueba.',
    objeto(
      {
        tipo: { type: 'string', enum: ['pregunta', 'dictamen'] },
        texto: texto('la pregunta o el dictamen, con el hecho citado'),
        eventos: EVENTOS_SCHEMA('opcional: lo que averiguaste antes de preguntar'),
      },
      ['tipo', 'texto'],
    ),
  ),
  tool(
    'responder',
    'CIERRA el turno escribiendo notas SIN tocar el estado: el acuse de un rechazo, la respuesta que no cambia nada. En correcciones y rechazos explicados el marcador `criterio` es obligatorio (vuelve auditable el carril); en un acuse simple se omite.',
    objeto(
      {
        eventos: EVENTOS_SCHEMA('lo que le contestás, hablándole a él'),
        criterio: { type: 'string', enum: ['si', 'no'], description: 'sólo en correcciones y rechazos explicados' },
        motivo_no: texto('por qué NO generaliza (obligatorio con criterio="no")'),
        otros_rechazos: {
          type: 'array',
          description: 'los OTROS rechazos recientes que te precargaron: se contestan todos en ESTA llamada, porque responder cierra el turno',
          items: objeto(
            { trabajo_id: texto('uuid del otro rechazo'), contenido: texto('su nota') },
            ['trabajo_id', 'contenido'],
          ),
        },
      },
      ['eventos'],
    ),
  ),
  tool(
    'marcar_error',
    'CIERRA el turno dejando la fila en error, con un detalle legible para el humano (un trabajo mudo es un trabajo perdido). Con duplicado_de enlaza además el papel al trabajo VIGENTE (que tiene que estar aprobada o registrada): así el comprobante no queda varado en una fila muerta. Un documento anulado o eliminado NO es duplicado.',
    objeto(
      {
        error_detalle: texto('qué pasó, en la fila, legible'),
        nota: texto('lo mismo contado en el hilo'),
        duplicado_de: texto('uuid del trabajo vigente del que este documento es comprobante'),
      },
      ['error_detalle', 'nota'],
    ),
  ),

  // ── la rama de casos ─────────────────────────────────────────────────────
  tool(
    'abrir_trabajo',
    'Abre un PASO del caso como trabajo aprobable con su botón: cada paso es un TRABAJO, ninguno queda en prosa. Un trabajo = UN documento (si hacen falta dos, abrí dos). Si el paso resuelve un movimiento del banco del caso, banco_tx_id es obligatorio. El caso_id lo pone el sistema.',
    objeto(
      {
        resumen: texto('el título del paso: qué es, corto'),
        // El MISMO schema que `proponer`: mismo jsonb, misma compuerta, mismo
        // script que lo registra.
        propuesta: PROPUESTA_SCHEMA(
          'el jsonb del paso: mismo formato que en proponer, con banco_tx_id si resuelve un movimiento del banco del caso. El caso_id lo pone el sistema.',
        ),
      },
      ['resumen', 'propuesta'],
    ),
  ),
  tool(
    'rechazar_paso',
    'Marca rechazado un paso hijo de ESTE caso que el humano todavía no decidió, porque él pidió otro plan. Es la única excepción a «rechazar es del humano», y sólo vale traduciendo su decisión: sin voz suya posterior al paso, la tool no escribe.',
    objeto(
      {
        trabajo_hijo_id: texto('uuid del paso a reemplazar'),
        motivo: texto('por qué se reemplaza'),
      },
      ['trabajo_hijo_id', 'motivo'],
    ),
  ),

  // ── criterios ────────────────────────────────────────────────────────────
  tool(
    'proponer_criterio',
    'Propone UNA regla para que el dueño la ratifique, cuando el humano corrigió lo que CONCLUISTE (no lo que viste: eso se arregla y sigue). Una regla por llamada; el alcance no puede faltar —una regla sin borde se aplica donde no debe—. Al aprobarse nace como entrada de libro.',
    objeto(
      {
        titulo: texto('qué decide, en una línea'),
        enunciado: texto('la regla, con el hecho que la sostiene'),
        alcance: texto('hasta dónde vale: este proveedor, esta cuenta, esta empresa'),
        sosten: texto('cuántos documentos del histórico lo respaldan, o «palabra del dueño»'),
      },
      ['titulo', 'enunciado', 'alcance', 'sosten'],
    ),
  ),

  // ── la brecha de ITBIS ───────────────────────────────────────────────────
  tool(
    'ratificar_brecha_itbis',
    'El humano contestó que SE ABSORBE la brecha de ITBIS de este emisor: deja el precedente (qualia_config `brecha_itbis:<rnc>`) y su entrada de libro. La tasa la dice ÉL en su respuesta — deducirla del documento es circular y ya salió al revés una vez. El RNC y quién ratifica los toma el sistema de la fila. No cierra el turno: después volvé a llamar a `proponer`. Sin respuesta suya posterior a tu pregunta, la tool no escribe.',
    objeto(
      {
        tasa: {
          type: 'number',
          enum: [...TASAS_LEGALES],
          description: 'la tasa a la que ESTE emisor factura, según el humano',
        },
        motivo: texto('por qué, con sus palabras (p. ej. «su POS embebe ISC en las bebidas»)'),
        nota: texto('lo que queda escrito en el hilo'),
      },
      ['tasa', 'motivo', 'nota'],
    ),
  ),

  // ── el libro ─────────────────────────────────────────────────────────────
  tool(
    'escribir_libro',
    'Escribe la entrada del libro de acción: fila en la tabla y archivo NUEVO en git (el libro sólo se agrega). El DocID y el «Aprobó» NO se pasan: salen de la fila. Idempotente por trabajo. Un caso JAMÁS va al libro.',
    objeto(
      {
        titulo: texto('el título de la entrada'),
        caso: texto('qué situación resolvió, en una frase'),
        por_que: texto('el razonamiento contable'),
        sosten: texto('en qué se apoya: norma, criterio, precedente, documentos'),
        alcance: texto('a qué casos futuros aplica — sin alcance no automatiza'),
      },
      ['titulo', 'caso', 'por_que', 'sosten', 'alcance'],
    ),
  ),
];

export const NOMBRES_TOOLS: string[] = ESQUEMAS_TOOLS.map((e) => e.function.name);

// QUÉ tools se sirven en cada rama NO se decide acá: es del harness
// (`esquemasDeRama` en index.ts), que arma su lista por nombre y revienta si
// falta un esquema. Este archivo es dueño de la FIRMA y del GUARD de cada
// tool; poner acá una segunda lista por rama sería una segunda fuente de
// verdad que se desincroniza sola.
//
// El dato de presupuesto para esa decisión: los 14 primeros juntos pesan ~3,3k
// tokens de entrada (medido antes de `consultar_nucleo`, que suma su schema a
// todas las ramas), y se re-pagan en CADA iteración sobre las ~11k del contrato
// §5 — servir sólo lo aplicable baja a ~2,9k en facturas y a ~1k en el turno
// que viene sólo a escribir el libro.

// ═══════════════════════════════════════════════════════════════ el dispatch

/**
 * Ejecuta una tool call del modelo.
 *
 * Devuelve el resultado que vuelve al modelo como mensaje `tool` — incluidos
 * los errores de validación, que son información para corregir. Lanza
 * `ErrorGuard` SÓLO cuando la fila ya no es del turno (guard de estado, claim
 * perdido, tipo equivocado): eso el harness lo trata como fatal, «si perdiste
 * el claim, PARÁ».
 */
export async function ejecutar(
  nombre: string,
  args: Record<string, unknown>,
  ctx: CtxTurno,
): Promise<ResultadoTool> {
  const a = args ?? {};
  switch (nombre) {
    case 'dossier_completo':
      return await dossierCompleto(ctx, a as ArgsDossier);
    case 'leer_adm':
      return await leerAdm(ctx, a as ArgsLeerAdm);
    case 'consultar_banco':
      return await consultarBanco(ctx, a as ArgsBanco);
    case 'buscar_precedente':
      return await buscarPrecedente(ctx, a as ArgsBuscarPrecedente);
    case 'consultar_dgii':
      return await consultarDgii(ctx, a as ArgsDgii);
    // Sin ctx a propósito: lee el módulo del bundle, no la base ni la red.
    case 'consultar_nucleo':
      return consultarNucleo(a);
    case 'avisar_progreso':
      return await avisarProgreso(ctx, a);
    case 'proponer':
      return await proponer(ctx, a);
    case 'preguntar_al_humano':
      return await preguntarAlHumano(ctx, a);
    case 'responder':
      return await responder(ctx, a);
    case 'marcar_error':
      return await marcarError(ctx, a);
    case 'abrir_trabajo':
      return await abrirTrabajo(ctx, a);
    // `rechazar_hijo` es el nombre con que la pieza llegó pedida; el contrato
    // §2.4 lo llama `rechazar_paso` y ése es el que viaja en el schema. El
    // alias vive sólo acá para que un caller con el otro nombre no se rompa.
    case 'rechazar_paso':
    case 'rechazar_hijo':
      return await rechazarPaso(ctx, a);
    case 'proponer_criterio':
      return await proponerCriterio(ctx, a);
    case 'ratificar_brecha_itbis':
      return await ratificarBrechaItbis(ctx, a as ArgsRatificarBrecha);
    case 'escribir_libro':
      return await escribirLibro(ctx, a as ArgsLibro);
    default:
      return {
        error: `la tool '${nombre}' no existe`,
        tools: NOMBRES_TOOLS,
      };
  }
}

/** Reexportado para el runner del corpus: la clave del snapshot de lecturas. */
export { claveExamen };
