// qualia-contable/bus.ts — la capa baja de ESCRITURA del turno: el freno por
// modo, el insert de eventos y el UPDATE guardado.
//
// Tres reglas del contrato viven acá, una sola vez, para que ninguna tool
// pueda saltárselas por olvido:
//
//  1. **El guard de estado va en el WHERE de toda escritura**, y cero filas
//     afectadas es un ERROR que se ve — nunca el «UPDATE 0» silencioso que ya
//     mordió dos veces (contrato §2).
//  2. **En modo sombra** la escritura no toca el bus: va a `qualia_sombra` con
//     clave `<trabajo_id>+<tool>` (plan §5-F1).
//  3. **En modo examen** no se escribe NADA, en ninguna tabla, y no se pokea:
//     cada tool de escritura devuelve `{simulado: true, efecto}` y el runner
//     del corpus las captura de la respuesta HTTP.

import { registrarSombra } from '../_shared/sombra.ts';
import { CtxTurno, ErrorGuard, FilaTrabajo, FUNCION, ResultadoTool } from './tipos.ts';

export interface EventoNuevo {
  tipo: 'progreso' | 'nota' | 'pregunta' | 'estado';
  contenido: string;
  datos?: Record<string, unknown>;
}

/**
 * ¿Esta escritura se hace de verdad? Devuelve null si sí; si no, devuelve el
 * resultado que la tool tiene que retornar tal cual (ya registrado en sombra
 * cuando corresponde).
 *
 * `efecto` es lo que la escritura HARÍA, calculado completo: en sombra y en
 * examen el trabajo se hace igual —validaciones incluidas— y lo único que no
 * pasa es el INSERT/UPDATE. Un modo que calcula distinto no sirve para
 * diffear contra el server.
 */
export async function frenoDeEscritura(
  ctx: CtxTurno,
  tool: string,
  efecto: Record<string, unknown>,
): Promise<ResultadoTool | null> {
  if (ctx.modo === 'examen') {
    return { simulado: true, modo: 'examen', tool, efecto };
  }
  if (ctx.modo === 'sombra') {
    // La clave la fija el contrato de esta corrida: mismo trabajo + misma tool
    // = misma decisión, así el comparador agrupa en vez de contar duplicados
    // como diferencias. Dos llamadas distintas de la MISMA tool en un turno
    // (dos avisar_progreso) comparten clave a propósito.
    await registrarSombra(FUNCION, ctx.empresaId, `${ctx.trabajoId}+${tool}`, efecto);
    return { simulado: true, modo: 'sombra', tool, efecto };
  }
  if (ctx.modo !== 'nube') {
    // 'server' significa «esta function no toca nada» (y es también el valor
    // que db.ts devuelve ante config ilegible). Escribir igual sería pisar al
    // contable del contenedor, que en ese modo sigue vivo: se para fuerte.
    throw new ErrorGuard(
      `modo '${ctx.modo}': el turno no escribe en el bus (el server sigue a cargo). El harness no debió invocarlo`,
    );
  }
  return null;
}

/**
 * Inserta eventos del contable en el hilo. No lleva guard de estado propio:
 * quien lo llama ya lo pasó (mover el estado) o no lo necesita (`responder`
 * deja la fila donde está). Los eventos son append-only por diseño del bus.
 */
export async function insertarEventos(
  ctx: CtxTurno,
  trabajoId: string,
  eventos: EventoNuevo[],
): Promise<void> {
  if (eventos.length === 0) return;
  const { error } = await ctx.db.from('qualia_eventos').insert(
    eventos.map((e) => ({
      trabajo_id: trabajoId,
      autor: 'contable',
      tipo: e.tipo,
      contenido: e.contenido,
      datos: e.datos ?? null,
    })),
  );
  if (error) {
    // El cambio de estado ya ocurrió (va primero, ver moverEstado): esto deja
    // la fila movida y muda, que es feo pero recuperable. Se grita en el log y
    // se devuelve al modelo en el resultado de la tool.
    throw new Error(`no pude escribir ${eventos.length} evento(s) en el hilo: ${error.message}`);
  }
}

export interface CambioEstado {
  estado: string;
  resumen?: string;
  propuesta?: Record<string, unknown>;
  error_detalle?: string;
}

/**
 * El UPDATE con el guard de estado EN EL WHERE. Cero filas = el guard no
 * matcheó: la fila ya no está donde el turno cree, y eso es fatal (ErrorGuard)
 * — «si perdiste el claim, PARÁ».
 *
 * Orden invertido respecto de aplicar-propuesta.py a propósito: allá era UNA
 * transacción psql; acá PostgREST no da transacciones, así que el estado se
 * mueve PRIMERO y los eventos van después. Así el modo de falla es una fila
 * movida sin sus eventos (visible y recuperable) y nunca eventos de cierre
 * huérfanos de un cambio de estado que no ocurrió — que es la trampa que el
 * fuente existía para matar.
 *
 * TODO: la atomicidad real necesita una función plpgsql (una migración del bus)
 * que haga UPDATE guardado + INSERT de eventos en una sola llamada. Mientras
 * no exista, este es el orden menos malo.
 */
export async function moverEstado(
  ctx: CtxTurno,
  cambio: CambioEstado,
  estadosPermitidos: string[],
): Promise<void> {
  const set: Record<string, unknown> = { estado: cambio.estado };
  if (cambio.resumen !== undefined) set.resumen = cambio.resumen;
  if (cambio.propuesta !== undefined) set.propuesta = cambio.propuesta;
  if (cambio.error_detalle !== undefined) set.error_detalle = cambio.error_detalle;
  // updated_at NO se toca: lo pone el trigger, y el rol del contable ni
  // siquiera tiene el grant de esa columna (esquema-del-bus §4).

  const { data, error } = await ctx.db
    .from('qualia_trabajos')
    .update(set)
    .eq('id', ctx.trabajoId)
    .eq('empresa_id', ctx.empresaId)
    .in('estado', estadosPermitidos)
    .select('id, estado');
  if (error) throw new ErrorGuard(`la escritura falló (nada se escribió): ${error.message}`);
  if (!data || data.length === 0) {
    const { data: viva } = await ctx.db
      .from('qualia_trabajos')
      .select('estado')
      .eq('id', ctx.trabajoId)
      .eq('empresa_id', ctx.empresaId)
      .maybeSingle();
    throw new ErrorGuard(
      `NADA SE ESCRIBIÓ: el guard de estado no matcheó — la fila está en '${
        viva?.estado ?? 'desconocido'
      }' y esta escritura exige ${estadosPermitidos.join(' | ')}`,
    );
  }
}

/** La fila fresca de la base (la del ctx es la foto del claim). */
export async function filaFresca(ctx: CtxTurno): Promise<FilaTrabajo> {
  if (ctx.modo === 'examen') return ctx.fila;
  const { data, error } = await ctx.db
    .from('qualia_trabajos')
    .select(
      'id, empresa_id, tipo, origen, estado, archivo_nombre, resumen, propuesta, ' +
        'aprobado_por_nombre, error_detalle, created_at, updated_at',
    )
    .eq('id', ctx.trabajoId)
    .eq('empresa_id', ctx.empresaId)
    .maybeSingle();
  if (error || !data) {
    throw new ErrorGuard(`no pude releer la fila ${ctx.trabajoId} (${error?.message ?? 'sin fila'})`);
  }
  // Doble cast: el select va como string concatenado y PostgREST-js no puede
  // derivar la forma de la fila de un literal que no ve entero.
  return data as unknown as FilaTrabajo;
}
