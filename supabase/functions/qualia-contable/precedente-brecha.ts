// qualia-contable/precedente-brecha.ts — el precedente de brecha de ITBIS por
// emisor: cómo se lee y cómo lo crea el turno cuando el humano dice «absorbé».
//
// POR QUÉ EXISTE ESTE ARCHIVO. Hasta el 2026-08-17 el sistema deducía la tasa
// del documento y absorbía solo. No se puede: por el papel, una factura
// legítima a la tasa reducida del art. 343 y una al 18% con ISC embebido dan
// las dos una tasa efectiva en el medio. Probado contra la FP00001063 —que SÍ
// tenía ISC embebido, documentado—: el código dedujo 16% y concluyó «el
// proveedor cobró de MÁS», al revés de la realidad.
//
// La salida no es afinar la deducción, es sacarla: la tasa la decide un humano
// UNA vez por proveedor, y esa decisión vive en una fila de `qualia_config`.
// Este archivo es el único lugar donde esa fila nace, y sus tres guardas son la
// razón de que se le pueda creer:
//
//  1. EL RNC SALE DE LA FILA (propuesta o dossier del preparador), jamás del
//     modelo: un precedente colgado del RNC equivocado absorbe para siempre en
//     el proveedor que no era.
//  2. TIENE QUE HABER VOZ DEL HUMANO POSTERIOR A LA PREGUNTA. Sin un evento
//     `autor='usuario'` después de tu pregunta, crear el precedente sería el
//     turno ratificándose a sí mismo.
//  3. UN PRECEDENTE QUE YA EXISTE NO SE PISA. Cambiar la tasa de un emisor es
//     otra decisión del humano, no un efecto colateral de un turno.
//
// Y la entrada de libro va con `trabajo_id` NULL a propósito: esta entrada no
// cierra la factura —que sigue viva y tendrá la suya— y el barrido de
// «registrada sin libro» marca cerrado por la existencia de una fila con ese
// trabajo_id.

import { CtxTurno, ErrorGuard, ResultadoTool, soloDigitos } from './tipos.ts';
import { filaFresca, frenoDeEscritura, insertarEventos } from './bus.ts';
import { guardarEntrada, slug } from './libro.ts';
import { dossierDelTurno } from './consultas.ts';
import {
  clavePrecedenteBrecha,
  CRITERIO_BRECHA,
  CRITERIO_BRECHA_ENMENDADO,
  leerPrecedente,
  type PrecedenteBrecha,
  TASAS_LEGALES,
} from '../_shared/brecha-itbis.ts';

type Dic = Record<string, unknown>;

const dic = (v: unknown): Dic | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Dic) : null;

/** El método con que estas entradas quedan rotuladas en `qualia_libro`. */
export const METODO_PRECEDENTE_BRECHA = 'precedente_brecha_itbis';

// ── lectura ─────────────────────────────────────────────────────────────────

interface FilaConfig {
  empresa_id: string | null;
  valor: unknown;
}

/**
 * Las filas de `qualia_config` de esa clave (la de la empresa y la global). Se
 * leen las dos y se filtra acá y no con un `.or()` interpolado: `empresa_id`
 * viene del contexto y no viaja crudo dentro de un string de filtro.
 */
async function filasDePrecedente(ctx: CtxTurno, rnc: string): Promise<FilaConfig[]> {
  const { data, error } = await ctx.db
    .from('qualia_config')
    .select('empresa_id, valor')
    .eq('clave', clavePrecedenteBrecha(rnc));
  if (error || !data) return [];
  return data as unknown as FilaConfig[];
}

/**
 * El precedente ratificado de un emisor, resuelto por empresa con respaldo
 * global. Cualquier problema devuelve null, y null significa PREGUNTAR: no
 * poder leer el permiso nunca es permiso.
 *
 * No se cachea a propósito: el turno puede crearlo a mitad de invocación
 * (`ratificar_brecha_itbis` y después `proponer`), y un cache por proceso haría
 * que la propuesta siguiente no viera el precedente recién ratificado.
 */
export async function precedenteDeLaEmpresa(
  ctx: CtxTurno,
  rnc: unknown,
): Promise<PrecedenteBrecha | null> {
  const digitos = soloDigitos(rnc);
  if (digitos === '') return null;
  try {
    const filas = await filasDePrecedente(ctx, digitos);
    const fila = filas.find((f) => f.empresa_id === ctx.empresaId) ??
      filas.find((f) => f.empresa_id === null);
    return leerPrecedente(fila?.valor ?? null, digitos);
  } catch {
    return null;
  }
}

// ── la tool ─────────────────────────────────────────────────────────────────

export interface ArgsRatificarBrecha {
  tasa?: unknown;
  motivo?: unknown;
  nota?: unknown;
}

/** El RNC del emisor, de la FILA: la propuesta si ya la hay, si no el dossier
 * del preparador. Nunca del modelo — el precedente es por emisor y colgarlo del
 * RNC equivocado absorbe para siempre en el proveedor que no era. */
async function emisorDeLaFila(
  ctx: CtxTurno,
  propuesta: Dic,
): Promise<{ rnc: string; nombre: string }> {
  let rnc = soloDigitos(propuesta.rnc);
  let nombre = String(propuesta.proveedor ?? '').trim();
  if (rnc === '' || nombre === '') {
    const extr = dic((await dossierDelTurno(ctx))?.extraccion) ?? {};
    if (rnc === '') rnc = soloDigitos(extr.rnc);
    if (nombre === '') nombre = String(extr.proveedor ?? '').trim();
  }
  return { rnc, nombre };
}

/**
 * ¿Habló el humano DESPUÉS de la pregunta? Devuelve null si sí (y con qué
 * usuario), y el motivo si no. Es la misma guarda de `rechazar_paso`: traducir
 * su decisión, no tomarla.
 */
async function vozDelHumano(
  ctx: CtxTurno,
): Promise<{ error: string } | { creadoPor: string | null }> {
  const { data, error } = await ctx.db
    .from('qualia_eventos')
    .select('id, autor, tipo, creado_por')
    .eq('trabajo_id', ctx.trabajoId)
    .order('id', { ascending: false })
    .limit(50);
  if (error || !data) {
    return { error: `no pude leer el hilo para verificar que el humano contestó: ${error?.message ?? 'sin datos'}` };
  }
  const eventos = data as unknown as Array<{ id: number; autor: string; tipo: string; creado_por: string | null }>;
  const ultimoUsuario = eventos.find((e) => e.autor === 'usuario');
  if (!ultimoUsuario) {
    return {
      error: 'nadie te contestó en este hilo: el precedente nace de una respuesta del humano, no de tu criterio. ' +
        'Preguntá con preguntar_al_humano y esperá',
    };
  }
  const ultimaPregunta = eventos.find((e) => e.autor === 'contable' && e.tipo === 'pregunta');
  if (ultimaPregunta && ultimaPregunta.id > ultimoUsuario.id) {
    return {
      error: 'tu pregunta es posterior a lo último que dijo el humano: todavía no te contestó. ' +
        'Cerrá el turno y esperá su respuesta',
    };
  }
  return { creadoPor: ultimoUsuario.creado_por ?? null };
}

/**
 * `ratificar_brecha_itbis`: el humano contestó «absorbé, este emisor factura al
 * N%», y esta tool deja las dos cosas que esa respuesta produce — la fila de
 * `qualia_config` que autoriza a absorber sin volver a preguntar, y su entrada
 * en el libro de acción.
 *
 * NO cierra el turno ni toca el estado de la fila: después de esto el turno
 * vuelve a llamar a `proponer` y la compuerta ya dicta el reparto a la tasa
 * ratificada.
 */
export async function ratificarBrechaItbis(
  ctx: CtxTurno,
  args: ArgsRatificarBrecha,
): Promise<ResultadoTool> {
  const fila = await filaFresca(ctx);
  if (fila.tipo === 'caso') {
    throw new ErrorGuard(
      'ratificar_brecha_itbis sobre un caso: el precedente es de UN emisor y un caso no tiene emisor propio',
    );
  }

  const tasa = typeof args.tasa === 'number' ? args.tasa : Number(args.tasa);
  if (!Number.isFinite(tasa) || !(TASAS_LEGALES as readonly number[]).includes(tasa)) {
    return {
      error: `\`tasa\` '${String(args.tasa)}' no es una tasa legal (${TASAS_LEGALES.join('%, ')}%)`,
      nota: 'la tasa la dice el HUMANO en su respuesta; si no la dijo, volvé a preguntarle cuál es — no la deduzcas del documento, que es exactamente lo que este precedente existe para evitar',
    };
  }
  const motivo = String(args.motivo ?? '').trim();
  if (motivo === '') {
    return {
      error: '`motivo` vacío: sin el porqué, el precedente es un número sin historia y nadie va a saber si sigue valiendo',
      nota: 'copiá lo que dijo el humano (p. ej. «su POS embebe ISC en las bebidas y factura al 18%»)',
    };
  }
  const nota = String(args.nota ?? '').trim();
  if (nota === '') return { error: '`nota` vacía: el hilo tiene que decir qué quedó ratificado' };

  const propuesta = dic(fila.propuesta) ?? {};
  const { rnc, nombre } = await emisorDeLaFila(ctx, propuesta);
  if (rnc === '') {
    return {
      error: 'ni la propuesta ni el dossier traen el RNC del emisor, y el precedente es POR EMISOR',
      instruccion: 'el RNC lo toma el sistema de la fila, no de vos: si de verdad no está, cerrá preguntando por él',
    };
  }
  if (rnc.length !== 9 && rnc.length !== 11) {
    // Un RNC mal leído acá no se nota nunca: la clave queda colgada de un número
    // que no existe y el precedente no aplica jamás, o peor, aplica al que no era.
    return {
      error: `el RNC del emisor en la fila es '${rnc}' (${rnc.length} dígitos) y un RNC/cédula tiene 9 u 11`,
      instruccion: 'arreglá primero el RNC de la propuesta contra el papel y el padrón; el precedente cuelga de ese número para siempre',
    };
  }
  const proveedor = nombre || String(fila.resumen ?? `RNC ${rnc}`);

  // El humano tiene que haber hablado DESPUÉS de la pregunta. En examen el
  // hilo es histórico y no se verifica contra la base (misma excepción que
  // `rechazar_paso`): la decisión se captura igual y el guard real corre en
  // sombra y en nube.
  let creadoPor: string | null = null;
  if (ctx.modo !== 'examen') {
    const voz = await vozDelHumano(ctx);
    if ('error' in voz) return { error: voz.error };
    creadoPor = voz.creadoPor;
  }

  // Quién ratifica: de la fila, o del usuario que escribió en el hilo. Nunca
  // del modelo (enmienda 1 del contrato).
  const ratificadoPor = String(fila.aprobado_por_nombre ?? '').trim() ||
    (creadoPor ? `mesa web (usuario ${creadoPor.slice(0, 8)})` : 'mesa web');
  const hoy = new Date().toISOString().slice(0, 10);
  const clave = clavePrecedenteBrecha(rnc);

  // ── un precedente que ya existe no se pisa ───────────────────────────────
  if (ctx.modo !== 'examen') {
    const filas = await filasDePrecedente(ctx, rnc);
    const propia = filas.find((f) => f.empresa_id === ctx.empresaId);
    const global = filas.find((f) => f.empresa_id === null);
    const ya = leerPrecedente(propia?.valor ?? global?.valor ?? null, rnc);
    if (ya) {
      if (ya.tasa === tasa) {
        return {
          ok: true,
          idempotente: true,
          clave,
          tasa: ya.tasa,
          ratificado_por: ya.ratificado_por,
          nota: 'este emisor YA tenía precedente a esa misma tasa: no escribo nada y podés seguir con proponer',
        };
      }
      return {
        error: `ya hay un precedente para el RNC ${rnc} al ${ya.tasa}% (ratificado por ${ya.ratificado_por}${
          ya.en ? `, ${ya.en}` : ''
        }) y vos venís con ${tasa}%`,
        instruccion: 'cambiar la tasa de un emisor es otra decisión del humano, no un efecto de este turno: contale la contradicción y preguntale cuál vale',
      };
    }
    if (propia || global) {
      // Hay fila pero no se puede leer como precedente (absorber en false, tasa
      // rara, sin firma). Pisarla a ciegas sería tapar una decisión de alguien.
      return {
        error: `existe una fila \`${clave}\` en qualia_config que NO se lee como precedente ratificado`,
        instruccion: 'no la piso: avisale al humano para que la revise a mano',
      };
    }
  }

  const valor = {
    absorber: true,
    tasa,
    motivo,
    ratificado_por: ratificadoPor,
    en: hoy,
    rnc,
    proveedor,
    origen_trabajo: ctx.trabajoId,
    criterio: CRITERIO_BRECHA,
  };

  const titulo = `Brecha de ITBIS de ${proveedor}: se absorbe al ${tasa}%`;
  const entrada = `# ${titulo}

- **Fecha:** ${hoy}
- **Caso:** ${proveedor} (RNC ${rnc}) factura con un ITBIS que no cae en ninguna tasa legal. Salió a la luz en el trabajo \`${ctx.trabajoId}\`${
    fila.resumen ? ` — ${fila.resumen}` : ''
  }, y por el papel no se distingue una factura a la tasa reducida del art. 343 de una al 18% con ISC embebido en el precio.
- **Decisión:** para este emisor se toma la tasa **${tasa}%**. Su brecha de ITBIS se absorbe: se registra el ITBIS **impreso** y la base se parte para que ADM llegue al mismo total del papel, con el sobrante sin ITBIS en las MISMAS cuentas y nunca rotulado exento. Queda como fila \`${clave}\` en \`qualia_config\`, que es lo que el detector lee antes de absorber.
- **Por qué:** ${motivo}
- **Sostén:** respuesta del humano en el hilo del trabajo \`${ctx.trabajoId}\`. Criterio: ${CRITERIO_BRECHA}, que enmienda a ${CRITERIO_BRECHA_ENMENDADO}. La tasa **no** se dedujo del documento: deducirla del mismo número que se quiere verificar es circular, y así se leyó al revés la FP00001063.
- **Aprobó:** ${ratificadoPor}, por la mesa web
- **Alcance:** los comprobantes de **${proveedor} (RNC ${rnc})** de esta empresa, de ${hoy} en adelante, y sólo la brecha **en menos**. Sigue yendo al humano, con precedente y todo: ITBIS impreso MAYOR al de la tasa, brecha que un renglón o una suma de renglones explique exactamente, otra tasa legal que cierre la cabecera sin residuo (candado FP00001120), renglón que no calce con ningún schedule, cabecera que no cierre consigo misma y brecha por encima del tope de magnitud (\`tope_brecha_itbis_pct\`).
- **Deroga:** —
`;

  const freno = await frenoDeEscritura(ctx, 'ratificar_brecha_itbis', {
    tabla: 'qualia_config',
    clave,
    valor,
    entrada_libro: entrada,
    nota,
  });
  if (freno) return freno;

  const { error: eCfg } = await ctx.db
    .from('qualia_config')
    .insert({
      empresa_id: ctx.empresaId,
      clave,
      valor,
      actualizado_por: `qualia-contable/${ctx.trabajoId}`,
    });
  if (eCfg) {
    // La única del par que es irrecuperable a mano es ésta: si no entró, no se
    // escribe el libro — una entrada que anuncia un permiso que no existe es
    // peor que ninguna.
    return { error: `NADA SE ESCRIBIÓ: no pude crear el precedente ${clave}: ${eCfg.message}` };
  }

  // El permiso ya está escrito, así que un fallo del libro NO puede reventar el
  // turno: reintentar caería en la rama «ya existe» y la entrada no se
  // escribiría nunca. Se devuelve visible para que el turno se lo diga al humano.
  let libro:
    | { libro_id: unknown; ref_git: string | null; pendiente_git: boolean; aviso: string | null }
    | null = null;
  let libroError: string | null = null;
  try {
    libro = await guardarEntrada(ctx, {
      // NULL a propósito: esta entrada no cierra la factura (ver cabecera).
      trabajoId: null,
      entrada,
      nombreBase: `${hoy}-precedente-brecha-itbis-${slug(proveedor, 30)}-${rnc}`,
      mensajeCommit: `libro(precedente): brecha de ITBIS de ${proveedor.slice(0, 40)} al ${tasa}%`,
      metodo: METODO_PRECEDENTE_BRECHA,
      precedenteRef: `qualia_config:${clave}`,
      aprobadoPor: ratificadoPor,
    });
  } catch (e) {
    libroError = e instanceof Error ? e.message : String(e);
    console.error(`ratificar_brecha_itbis ${clave}: precedente escrito y libro NO (${libroError})`);
  }

  await insertarEventos(ctx, ctx.trabajoId, [{
    tipo: 'nota',
    contenido: `🔖 ${nota}`,
    datos: { precedente_brecha_itbis: { clave, tasa, rnc, ratificado_por: ratificadoPor } },
  }]);

  return {
    ok: true,
    clave,
    rnc,
    tasa,
    ratificado_por: ratificadoPor,
    libro_id: libro?.libro_id ?? null,
    ref_git: libro?.ref_git ?? null,
    pendiente_git: libro?.pendiente_git ?? null,
    aviso: libroError
      ? `el precedente quedó escrito pero su entrada de libro NO (${libroError}): decíselo al humano en el cierre`
      : libro?.aviso ?? null,
    instruccion: 'el precedente ya está: volvé a llamar a `proponer` con los renglones del papel y la compuerta te dicta el reparto a esta tasa',
  };
}
