// Utilidades compartidas por los detectores de qualia-sugerencias.
//
// Los detectores son ports fieles de los `sugerir-*.sh` del contenedor Hermes
// (empresas/blackbox/hermes/scripts/). Cada regla rara de acá abajo pagó su
// bug con un incidente real — antes de "simplificar" algo, leer el comentario
// que tiene al lado en el fuente original.

import { sb } from '../_shared/db.ts';

export type Cliente = ReturnType<typeof sb>;
export type Modo = 'sombra' | 'nube';

export interface ConteoDetector {
  detectadas: number;
  sembradas: number;
  actualizadas: number;
  avisos: string[];
}

export const conteoVacio = (avisos: string[] = []): ConteoDetector => ({
  detectadas: 0,
  sembradas: 0,
  actualizadas: 0,
  avisos,
});

// ── Espejos de ADM ──────────────────────────────────────────────────────────
// En el server los espejos viven en /opt/data/preentrenamiento/raw y los
// refresca mesa/refrescar-precedentes.sh cada madrugada. En la nube la
// convención (compartida con notas_debito.ts, que la propuso primero) es:
// bucket `qualia-espejos` (privado, migracion 20260816000300), prefijo
// `espejo-adm/<empresa_id>/`, mismos nombres
// de archivo.
//
// TODO(F1): la function que porta refrescar-precedentes.sh debe ESCRIBIR los
// espejos en esa ruta. Hasta que exista, estos detectores no siembran nada —
// que es exactamente el comportamiento diseñado del fuente: sin espejo no se
// propone a ciegas. Si el espejo aterriza en otro lado (otra ruta, una tabla),
// cambiar estas constantes y nada más.
export const BUCKET_ESPEJOS = 'qualia-espejos';
export const rutaEspejo = (empresaId: string, archivo: string) =>
  `espejo-adm/${empresaId}/${archivo}`;

/** Baja un archivo del bucket de espejos. null = no está o no se pudo leer. */
export async function descargarEspejo(
  cliente: Cliente,
  empresaId: string,
  archivo: string,
): Promise<string | null> {
  const { data, error } = await cliente.storage
    .from(BUCKET_ESPEJOS)
    .download(rutaEspejo(empresaId, archivo));
  if (error || !data) return null;
  return await data.text();
}

/**
 * Filas de un .jsonl, TOLERANTE: se saltan las líneas ilegibles y se sigue.
 * Una línea rota no puede matar la corrida — el espejo lo escribe otro proceso
 * y una bajada interrumpida deja la última línea a medias (regla ganada en
 * sugerir-transferencias.sh). Devuelve el `data` de cada sobre, o {}.
 */
export function filasJsonlTolerante(texto: string): Record<string, unknown>[] {
  const filas: Record<string, unknown>[] = [];
  for (const linea of texto.split('\n')) {
    const limpia = linea.trim();
    if (!limpia) continue;
    try {
      const sobre = JSON.parse(limpia) as Record<string, unknown> | null;
      filas.push(((sobre ?? {}).data as Record<string, unknown>) ?? {});
    } catch {
      continue;
    }
  }
  return filas;
}

/**
 * Filas de un .jsonl, ESTRICTA: una línea ilegible tira la corrida entera.
 * Es el comportamiento de sugerir-asignacion.sh y sugerir-recurrentes.sh
 * (crashean con el espejo roto y no siembran nada). Acá importa el porqué:
 * un espejo a medias no solo pierde matches — puede convertir un caso ambiguo
 * en "candidato único" y proponer con confianza algo que no se verificó.
 * Devuelve los SOBRES enteros (el consumidor decide cómo abrir `data`).
 */
export function filasJsonlEstricta(texto: string): Record<string, unknown>[] {
  const filas: Record<string, unknown>[] = [];
  for (const linea of texto.split('\n')) {
    const limpia = linea.trim();
    if (!limpia) continue; // el iterador de Python tampoco ve una línea vacía final
    filas.push(JSON.parse(limpia) as Record<string, unknown>);
  }
  return filas;
}

// ── mapa-cuentas.yaml ───────────────────────────────────────────────────────

export interface CuentaMapa {
  banco?: string;
  numero?: string | number;
  moneda?: string;
  cuenta_contable?: string;
  cuenta_nombre?: string;
  alias?: string;
}

/**
 * Bloque de la empresa del viejo mapa-cuentas.yaml, leído de qualia_config
 * clave='mapa_cuentas' — la MISMA fuente que usa cargos.ts (dos fuentes para
 * el mismo mapa es la desincronización que el plan §10.4 prohíbe). Fila de la
 * empresa primero, global después (la precedencia de modo()); el valor acepta
 * las dos formas: el yaml completo como JSON ({empresas: {...}}) o el bloque
 * de la empresa directo ({cuentas: [...], cargos: [...]}). La selección del
 * bloque es la del fuente: empresa_id case-insensitive, y si hay UNA sola
 * empresa, ésa. Sin fila se tira: los detectores que lo usan morían igual en
 * el server sin el archivo (y sin mapa no hay asiento que armar).
 *
 * TODO(F1): SEMBRAR qualia_config clave='mapa_cuentas' con el contenido del
 * mapa-cuentas.yaml vivo del server antes de encender el cron.
 */
export async function cargarMapaCuentas(
  cliente: Cliente,
  empresaId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await cliente
    .from('qualia_config')
    .select('empresa_id, valor')
    .eq('clave', 'mapa_cuentas')
    .or(`empresa_id.eq.${empresaId},empresa_id.is.null`);
  if (error) throw new Error(`no pude leer qualia_config: ${error.message}`);

  const fila = (data ?? []).find((f) => f.empresa_id === empresaId) ??
    (data ?? []).find((f) => f.empresa_id === null);
  if (!fila) {
    throw new Error(`falta el mapa de cuentas (qualia_config clave='mapa_cuentas') para ${empresaId}`);
  }

  const valor = fila.valor as Record<string, unknown> | null;
  const empresas = (valor?.empresas ?? null) as Record<string, Record<string, unknown>> | null;
  if (empresas) {
    const bloques = Object.values(empresas);
    return bloques.find(
      (e) => String(e.empresa_id ?? '').toLowerCase() === empresaId.toLowerCase(),
    ) ?? (bloques.length === 1 ? bloques[0] : {});
  }
  return valor ?? {};
}

// ── Llaves de reclamo ───────────────────────────────────────────────────────

/**
 * Todos los movimientos bancarios que ALGUNA propuesta ya reclamó, mirando las
 * CINCO formas de reclamar (contrato F1 del plan; la implementación de
 * referencia son las líneas 313-317 de sugerir-cargos.sh):
 *
 *   propuesta->>'banco_tx_id'
 *   propuesta->'origen'->>'banco_tx_id'
 *   propuesta->'destino'->>'banco_tx_id'
 *   propuesta->'banco_tx_ids'  (array)
 *   propuesta->'movimientos'   (array)
 *
 * Mirando menos llaves el agujero ya se pagó DOS veces: 40 cargos re-sugeridos
 * el 2026-08-04 y de nuevo en notas de débito el 2026-08-15. Sin filtro de
 * estado a propósito: una sugerencia rechazada también reclama — el rechazo es
 * para siempre y lo rechazado no se vuelve a sembrar.
 */
export async function clavesReclamadas(
  cliente: Cliente,
  empresaId: string,
): Promise<Set<string>> {
  const filas = await paginar<Record<string, unknown>>((desde, hasta) =>
    cliente
      .from('qualia_trabajos')
      .select(
        'tx:propuesta->>banco_tx_id, tx_origen:propuesta->origen->>banco_tx_id, ' +
          'tx_destino:propuesta->destino->>banco_tx_id, ' +
          'tx_ids:propuesta->banco_tx_ids, movs:propuesta->movimientos',
      )
      .eq('empresa_id', empresaId)
      .order('id')
      .range(desde, hasta)
  );
  const reclamadas = new Set<string>();
  for (const f of filas) {
    for (const suelta of [f.tx, f.tx_origen, f.tx_destino]) {
      if (typeof suelta === 'string' && suelta) reclamadas.add(suelta);
    }
    for (const lista of [f.tx_ids, f.movs]) {
      if (Array.isArray(lista)) for (const v of lista) reclamadas.add(String(v));
    }
  }
  return reclamadas;
}

// ── Paginación ──────────────────────────────────────────────────────────────

/**
 * Trae TODAS las filas de una consulta, de a 1000. PostgREST corta en 1000
 * por default y acá un corte silencioso es un bug caro: un reclamo que quedó
 * en la página que no se leyó re-sugiere un movimiento ya levantado.
 * El caller DEBE incluir un .order() estable para que las páginas no se pisen.
 */
export async function paginar<T>(
  // `data: unknown` a propósito: el parser de tipos de supabase-js no entiende
  // los selects con flechas JSON (alias:propuesta->>llave) y devolvería un
  // tipo de error; el caller declara T y acá se castea.
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGINA = 1000;
  const todas: T[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await consulta(desde, desde + PAGINA - 1);
    if (error) throw new Error(`consulta paginada: ${error.message}`);
    const filas = (data ?? []) as T[];
    todas.push(...filas);
    if (filas.length < PAGINA) break;
  }
  return todas;
}

// ── Redondeo y formato ──────────────────────────────────────────────────────

/**
 * round() de Python: al entero más cercano, empates AL PAR (banker's
 * rounding). Math.round redondea .5 siempre hacia arriba y corre en un día el
 * `dia_habitual` de los recurrentes (mediana de una cantidad par de días da
 * .5 seguido), lo que mueve el flag `vencido`. Por eso no se usa Math.round.
 */
export function pyRound(x: number): number {
  const piso = Math.floor(x);
  const resto = x - piso;
  if (resto < 0.5) return piso;
  if (resto > 0.5) return piso + 1;
  return piso % 2 === 0 ? piso : piso + 1;
}

/**
 * round(x, n) de Python. Python redondea el valor BINARIO real del double
 * (706.675 es en verdad 706.67499… y baja; 0.005 es 0.005000…104 y sube) —
 * escalar por 10^n en float inventa empates que no existen y erraba esos dos
 * casos. toFixed hace el mismo redondeo decimal correcto del valor real; la
 * única divergencia que queda es el empate diádico EXACTO (0.125 → Python
 * 0.12 por par, esto 0.13), imposible en montos que ya vienen con 2 decimales.
 */
export function pyRoundN(x: number, n: number): number {
  if (n === 0) return pyRound(x);
  return Number(x.toFixed(n));
}

/** c2 del fuente: round(float(x or 0), 2). */
export const c2 = (x: unknown): number => pyRoundN(Number(x ?? 0), 2);

const FMT_2 = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const FMT_4 = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

/** f"{x:,.2f}" de Python / to_char 'FM999,999,990.00' de Postgres. */
export const fmtMonto = (x: number): string => FMT_2.format(x);
/** to_char 'FM999,990.0000' (la tasa de cambio). */
export const fmtTasa = (x: number): string => FMT_4.format(x);

/**
 * jsonb_strip_nulls de Postgres: quita los campos null de los objetos,
 * recursivo; los null DENTRO de arrays se quedan. Solo lo usa transferencias
 * (el único fuente que armaba su propuesta con jsonb_strip_nulls) — los otros
 * detectores conservan sus null a propósito: en recurrentes la PRESENCIA de
 * `monto_tipico` (aunque sea null) es la marca de "fila al día".
 */
export function stripNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v !== null && typeof v === 'object') {
    const salida: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === null || val === undefined) continue;
      salida[k] = stripNulls(val);
    }
    return salida;
  }
  return v;
}

// ── Fechas ──────────────────────────────────────────────────────────────────
// Los detectores del server comparaban contra current_date de Postgres, que
// en Supabase es UTC. Se mantiene UTC acá para no correr las ventanas.

export const hoyUTC = (): string => new Date().toISOString().slice(0, 10);

/** Hoy en República Dominicana. El fuente de recurrentes lo exige: el
 * contenedor corría en UTC y después de las 20:00 AST `date +%F` daba el día
 * siguiente — y acá el día del mes decide si ya toca avisar. */
export const hoyRD = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' });

export const restarDias = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** Diferencia a - b en días (fechas ISO YYYY-MM-DD). */
export const difDias = (a: string, b: string): number =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
