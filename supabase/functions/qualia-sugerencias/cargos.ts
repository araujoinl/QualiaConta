// Detector de cargos bancarios — port fiel de
// empresas/blackbox/hermes/scripts/sugerir-cargos.sh (cron --no-agent, CERO tokens).
//
// Siembra en la mesa de trabajo los movimientos bancarios que la contabilidad
// debe registrar y que no vienen de ventas ni de facturas de compra:
//
//   EGRESOS  → comisiones, impuestos (Imp. 2.0 por 1000, Desc. 1% DGII),
//              manejo/mantenimiento de cuenta, retención por estado de cuenta,
//              sobregiro, intereses.
//   INGRESOS → capitalización de intereses, créditos por pago total,
//              reversos/devoluciones del banco. (Los pagos de clientes NO:
//              esos viven en la conciliación de entradas.)
//
// Las NOTAS DE DÉBITO quedaron fuera a propósito (2026-08-03): no son gasto del
// banco sino pagos a terceros —DGII, Aduanas, TSS— sin beneficiario en el
// estado de cuenta. Las lleva notas_debito.ts, con su propio cruce contra ADM.
//
// Dos carriles, igual que el fuente:
//   CARRIL A — los cargos que el banco SÍ factura, agrupados por comprobante
//              fiscal (un NCF ampara todos los cargos de cuenta+concepto+día).
//   CARRIL B — lo que ningún comprobante ampara: el banco no lo factura (la
//              retención del 1%, los intereses que paga) o todavía no emitió
//              el NCF. De a un movimiento, como siempre.
//
// Y el CIERRE: cuando el NCF llega DESPUÉS de que el carril B ya sembró el
// cargo suelto, se cierra esa suelta ('rechazada', con el motivo adentro de la
// propuesta) — el comprobante la superó y dejarla en 'propuesta' era cola viva
// para cualquier consumidor que no fuera el frontend.
//
// REGLA QUE NO SE ROMPE: este detector NUNCA retira una sugerencia por su
// cuenta salvo el cierre por NCF descrito arriba, que es la única excepción
// automática documentada (mesa-de-trabajo.md, 2026-08-15). Todo lo demás lo
// decide el humano en la web.
//
// El port cambia el chasis (bash+psql → TS+supabase-js: acá no hay RPC de SQL
// crudo) pero NO las reglas: cada criterio con incidente encima viaja con su
// comentario. El ensayo QUALIA_DRY_RUN del fuente no se porta — el modo
// 'sombra' del contrato F1 lo reemplaza (calcula todo, escribe SOLO en
// qualia_sombra).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { registrarSombra } from '../_shared/sombra.ts';

export type Modo = 'server' | 'sombra' | 'nube';

const FUNCION_SOMBRA = 'qualia-sugerencias/cargos';

export interface OpcionesCargos {
  // Ventana del carril B en días (era el env QUALIA_DIAS_CARGOS). Es
  // configurable por una razón concreta: cuando entra una cuenta nueva al mapa
  // —las dos Visa entraron el 2026-08-05— llega con meses de movimientos que
  // ninguna corrida miró nunca, y con 30 días quedan invisibles para siempre.
  // Se hace UNA pasada larga y se vuelve al default. Alargar no puede duplicar
  // nada: lo ya reclamado lo frena el not-exists de reclamos.
  diasVentana?: number;
  // Filtro de cuentas para la pasada de recuperación (era QUALIA_CUENTAS_CARGOS),
  // vacío en la corrida normal. Va junto con la ventana larga y por la misma
  // razón: alargarla PARA TODAS las cuentas arrastra los cargos viejos que el
  // humano ya registró a mano en ADM antes de que existiera la mesa, y el
  // detector no tiene cómo saberlo — su único guardia es «ningún trabajo lo
  // reclama», no «ningún documento existe en ADM». Con el filtro, la
  // recuperación toca sólo la cuenta que se acaba de mapear.
  cuentas?: string[];
}

export interface ResultadoCargos {
  modo: Modo;
  accion: 'ninguna' | 'sombra' | 'insertadas';
  comprobantes: number;
  movimientos: number;
  cerradas: number;
  resumenes: string[];
}

// ---------------------------------------------------------------------------
// Helpers de fecha/monto/jsonb — imitan la semántica SQL del fuente.
// ---------------------------------------------------------------------------

const DIA_MS = 86_400_000;

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function restarDias(iso: string, dias: number): string {
  return new Date(Date.parse(iso) - dias * DIA_MS).toISOString().slice(0, 10);
}

function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function round4(x: number): number {
  return Math.round((x + Number.EPSILON) * 10_000) / 10_000;
}

// to_char(x, 'FM999,999,990.00') del fuente.
const FMT_MONTO = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function fmtMonto(x: number): string {
  return FMT_MONTO.format(x);
}

function fmtDDMM(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

// jsonb_strip_nulls: quita claves null de los objetos a toda profundidad y
// conserva los elementos de array. La propuesta entera pasa por acá, igual
// que en el INSERT original.
function stripNulls(v: unknown): unknown {
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

// `jsonb @> to_jsonb(id)`: contención de array, o igualdad si es escalar.
function contiene(v: unknown, id: string): boolean {
  if (Array.isArray(v)) return v.includes(id);
  return v === id;
}

// PostgREST corta en 1000 filas por request: TODA lectura de tablas del bus o
// del banco pagina, para que un mes cargado no deje reclamos fuera del
// snapshot (un reclamo invisible = movimiento re-sugerido, el agujero pagado).
// `data: unknown` porque el parser de tipos de supabase-js no entiende los
// select con rutas jsonb (`propuesta->>banco_tx_id`) y degrada el tipo; la
// forma real la fija el <T> del caller.
async function todas<T>(
  pagina: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const LOTE = 1000;
  const filas: T[] = [];
  for (let desde = 0; ; desde += LOTE) {
    const { data, error } = await pagina(desde, desde + LOTE - 1);
    if (error) throw new Error(`detectarCargos: consulta paginada falló: ${error.message}`);
    const lote = (data ?? []) as T[];
    filas.push(...lote);
    if (lote.length < LOTE) break;
  }
  return filas;
}

// ---------------------------------------------------------------------------
// Mapa de cuentas (bloques `cargos` y `cuentas` del viejo mapa-cuentas.yaml)
// ---------------------------------------------------------------------------

interface ReglaCargo {
  prio: number;
  dir: 'cargo' | 'credito';
  rx: RegExp;
  cuenta: string | null;
  cuentaNombre: string | null;
  revisar: string | null;
}

interface BancoGl {
  numero: string;
  glCodigo: string;
  glNombre: string | null;
}

interface Mapa {
  reglas: ReglaCargo[];
  bancos: Map<string, BancoGl>;
}

// TODO(F1): el mapa vivía en mapa-cuentas.yaml montado :ro en el contenedor.
// El plan (§10.3) lo manda a tabla por empresa junto al catálogo de GUIDs;
// mientras esa tabla no exista, se lee de qualia_config clave='mapa_cuentas'
// (fila de la empresa primero, global después — misma precedencia que modo()).
// El valor acepta las dos formas: el yaml completo ({empresas: {...}}) o el
// bloque de la empresa directo ({cargos: [...], cuentas: [...]}). Hay que
// SEMBRAR ese config antes de encender el cron: sin fila, este detector falla
// duro igual que el script fallaba sin el archivo.
//
// TODO(F1): las regex del mapa pasan de POSIX (~* de Postgres) a RegExp de JS
// con flag 'i'. El vocabulario actual del mapa (alternancias simples) es
// idéntico en ambos motores; si alguna vez entra \m/\M hay que traducirlo a \b.
async function cargarMapa(supabase: SupabaseClient, empresaId: string): Promise<Mapa> {
  const { data, error } = await supabase
    .from('qualia_config')
    .select('empresa_id, valor')
    .eq('clave', 'mapa_cuentas')
    .or(`empresa_id.eq.${empresaId},empresa_id.is.null`);
  if (error) throw new Error(`detectarCargos: no pude leer qualia_config: ${error.message}`);

  const fila = (data ?? []).find((f) => f.empresa_id === empresaId) ??
    (data ?? []).find((f) => f.empresa_id === null);
  if (!fila) {
    // Igual que el open() fallido del fuente: sin mapa el detector no corre a
    // ciegas — carril B sin reglas sería silencio eterno sin que nadie lo note.
    throw new Error(`detectarCargos: falta el mapa de cuentas (qualia_config clave='mapa_cuentas') para ${empresaId}`);
  }

  const valor = fila.valor as Record<string, unknown> | null;
  let bloque: Record<string, unknown> = {};
  const empresas = (valor?.empresas ?? null) as Record<string, Record<string, unknown>> | null;
  if (empresas) {
    const entradas = Object.values(empresas);
    bloque = entradas.find(
      (e) => String(e.empresa_id ?? '').toLowerCase() === empresaId.toLowerCase(),
    ) ?? (entradas.length === 1 ? entradas[0] : {});
  } else if (valor) {
    bloque = valor;
  }

  const reglas: ReglaCargo[] = [];
  const crudas = (bloque.cargos ?? []) as Array<Record<string, unknown>>;
  crudas.forEach((r, i) => {
    const dir = r.direccion;
    if (!r.match || (dir !== 'cargo' && dir !== 'credito')) return;
    reglas.push({
      prio: i, // primera regla que matchea gana: el orden del mapa es la prioridad
      dir,
      rx: new RegExp(String(r.match), 'i'),
      cuenta: (r.cuenta as string) ?? null,
      cuentaNombre: (r.cuenta_nombre as string) ?? null,
      revisar: (r.revisar as string) ?? null,
    });
  });

  const bancos = new Map<string, BancoGl>();
  for (const c of (bloque.cuentas ?? []) as Array<Record<string, unknown>>) {
    if (!c.numero || !c.cuenta_contable) continue;
    bancos.set(String(c.numero), {
      numero: String(c.numero),
      glCodigo: String(c.cuenta_contable),
      glNombre: (c.cuenta_nombre as string) ?? (c.alias as string) ?? null,
    });
  }

  return { reglas, bancos };
}

// ---------------------------------------------------------------------------
// Snapshot de reclamos: qué movimientos y qué NCF ya tienen dueño en el bus.
// ---------------------------------------------------------------------------

interface FilaTrabajo {
  id: string;
  tipo: string | null;
  estado: string | null;
  banco_tx_id: string | null;
  origen_tx: string | null;
  destino_tx: string | null;
  banco_tx_ids: unknown;
  movimientos: unknown;
  documento_adm: string | null;
  ncf: string | null;
  anulado_en: string | null;
  eliminado_en: string | null;
}

const SELECT_RECLAMOS =
  'id, tipo, estado, ' +
  'banco_tx_id:propuesta->>banco_tx_id, ' +
  'origen_tx:propuesta->origen->>banco_tx_id, ' +
  'destino_tx:propuesta->destino->>banco_tx_id, ' +
  'banco_tx_ids:propuesta->banco_tx_ids, ' +
  'movimientos:propuesta->movimientos, ' +
  'documento_adm:propuesta->>documento_adm, ' +
  'ncf:propuesta->>ncf, ' +
  'anulado_en:propuesta->registro_adm->>anulado_en, ' +
  'eliminado_en:propuesta->registro_adm->>eliminado_en';

// Vivo: un documento anulado o borrado en ADM deja de reclamar su movimiento,
// porque anular es casi siempre el paso previo a registrarlo bien. Sin esto,
// la primera fila se quedaba con el movimiento para siempre y corregir un
// registro equivocado no tenía salida.
function vivo(t: FilaTrabajo): boolean {
  return t.anulado_en == null && t.eliminado_en == null;
}

// Las CINCO formas de reclamar un movimiento, no sólo `banco_tx_id`: el cargo
// suelto/nota/asignación por `banco_tx_id`, la transferencia por sus dos patas
// (`origen`/`destino`) y por su array `banco_tx_ids`, y el comprobante fiscal
// por el array `movimientos`. El 2026-08-04 se pasó de un documento por
// movimiento a uno por comprobante y se anularon los 54 viejos; mirando sólo
// `banco_tx_id`, esos 40 cargos volvían a sugerirse uno por uno teniendo ya su
// comprobante vivo esperando decisión. Mismo criterio que `idsLevantados()` en
// la mesa web — es la implementación de referencia del plan §5-F1.
function reclama(t: FilaTrabajo, txId: string): boolean {
  return t.banco_tx_id === txId ||
    t.origen_tx === txId ||
    t.destino_tx === txId ||
    contiene(t.banco_tx_ids, txId) ||
    contiene(t.movimientos, txId);
}

async function snapshotReclamos(supabase: SupabaseClient, empresaId: string): Promise<FilaTrabajo[]> {
  return await todas<FilaTrabajo>((desde, hasta) =>
    supabase
      .from('qualia_trabajos')
      .select(SELECT_RECLAMOS)
      .eq('empresa_id', empresaId)
      .order('id', { ascending: true })
      .range(desde, hasta)
  );
}

// ---------------------------------------------------------------------------
// Tipos del banco
// ---------------------------------------------------------------------------

interface Cuenta {
  id: string;
  banco: string | null;
  nombre: string | null;
  numero: string | null;
  moneda: string | null;
}

interface Transaccion {
  id: string;
  account_id: string;
  fecha_posteo: string;
  monto: number;
  descripcion: string | null;
}

interface ComprobanteDb {
  ncf: string;
  fecha_emision: string;
  monto_dop: number;
  lineas: Array<Record<string, unknown>> | null;
}

// ---------------------------------------------------------------------------
// Carril A — estructuras intermedias (los CTE del fuente, uno a uno)
// ---------------------------------------------------------------------------

interface LineaComprobante {
  ncf: string;
  fechaEmision: string;
  montoComprobante: number;
  cuenta: string; // numero de la cuenta bancaria (l->>'cuenta')
  concepto: string;
  montoLinea: number | null;
  fechaLinea: string | null;
  accountId: string;
  moneda: string | null;
  banco: string | null;
  cuentaBanco: string | null; // a.nombre
}

interface LineaResuelta {
  dia: string;
  movs: number;
  suma: number;
  tasa: number | null;
  ids: string[];
  diasCandidatos: number;
}

interface GrupoComprobante {
  ncf: string;
  fechaEmision: string;
  montoComprobante: number;
  banco: string | null;
  moneda: string | null;
  cuenta: string;
  cuentaBanco: string | null;
  lineasTotal: number;
  lineasOk: number;
  movsTotal: number;
  tasa: number | null;
  sumaBanco: number;
  conceptos: string;
  movimientoIds: string[];
  desglose: unknown[];
  cuentasDistintas: number;
  cuentaUnica: string | null;
  cuentaUnicaNombre: string | null;
  glCodigo: string | null;
  glNombre: string | null;
}

interface InsertTrabajo {
  clave: string; // llave natural para qualia_sombra
  fila: {
    empresa_id: string;
    tipo: 'sugerencia';
    origen: 'cron_conciliacion';
    estado: 'propuesta';
    resumen: string;
    propuesta: unknown;
  };
}

// por_dia + dia_bueno + linea_resuelta del fuente, para UNA línea del
// comprobante contra las transacciones de su cuenta.
function resolverLinea(linea: LineaComprobante, txCuenta: Transaccion[]): LineaResuelta | null {
  if (linea.fechaLinea == null || linea.montoLinea == null) return null;
  const desde = restarDias(linea.fechaLinea, 4); // 4 días hacia atrás: el
  // comprobante se emite el día hábil siguiente y un lunes tiene que poder
  // alcanzar al viernes.
  const conceptoUp = linea.concepto.toUpperCase();

  const porDia = new Map<string, { movs: number; suma: number; ids: string[] }>();
  for (const t of txCuenta) {
    if (t.monto >= 0) continue;
    if ((t.descripcion ?? '').trim().toUpperCase() !== conceptoUp) continue;
    if (t.fecha_posteo < desde || t.fecha_posteo > linea.fechaLinea) continue;
    const d = porDia.get(t.fecha_posteo) ?? { movs: 0, suma: 0, ids: [] };
    d.movs += 1;
    d.suma += Math.abs(t.monto);
    d.ids.push(t.id);
    porDia.set(t.fecha_posteo, d);
  }

  // El día bueno es aquel cuya suma CIERRA. En cuentas en dólares nunca va a
  // cerrar —el comprobante viene en pesos— así que ahí se valida que la tasa
  // implícita sea plausible y se guarda para que el humano la vea.
  const candidatos: Array<{ dia: string; movs: number; suma: number; tasa: number | null }> = [];
  for (const [dia, d] of porDia) {
    const suma = round2(d.suma);
    if (linea.moneda !== 'USD') {
      if (Math.abs(suma - linea.montoLinea) < 0.01) candidatos.push({ dia, movs: d.movs, suma, tasa: null });
    } else if (suma > 0) {
      const tasa = linea.montoLinea / suma;
      if (tasa >= 40 && tasa <= 90) candidatos.push({ dia, movs: d.movs, suma, tasa: round4(tasa) });
    }
  }
  if (candidatos.length === 0) return null;

  // Un solo día candidato = resuelto sin ambigüedad. Si hay dos, no se adivina
  // (diasCandidatos > 1 marca la línea como sin_resolver aguas abajo).
  candidatos.sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0));
  const tasas = candidatos.map((c) => c.tasa).filter((t): t is number => t != null);
  return {
    dia: candidatos[0].dia,
    movs: Math.min(...candidatos.map((c) => c.movs)),
    suma: Math.min(...candidatos.map((c) => c.suma)),
    tasa: tasas.length ? Math.min(...tasas) : null,
    ids: [...porDia.get(candidatos[0].dia)!.ids].sort(),
    diasCandidatos: candidatos.length,
  };
}

function armarInsertComprobante(empresaId: string, k: GrupoComprobante): InsertTrabajo {
  const esUsd = k.moneda === 'USD';
  const resumen = `Comprobante ${k.ncf} ${fmtDDMM(k.fechaEmision)}: ${k.conceptos.slice(0, 45)} — ` +
    (esUsd
      ? `US$${fmtMonto(k.sumaBanco)} (NCF RD$${fmtMonto(k.montoComprobante)})`
      : `RD$${fmtMonto(k.montoComprobante)}`) +
    ` (${k.movsTotal} cargo${k.movsTotal === 1 ? '' : 's'})` +
    ` (${k.banco} · ${k.cuentaBanco ?? k.cuenta})`;

  // El asiento se arma con los montos de la CUENTA, no con los del papel:
  // el comprobante siempre está en pesos —DGII lo exige— así que en una cuenta
  // en dólares los dos números NO son el mismo (US$60 de comisión se facturan
  // como RD$3.477,17) y registrar el del papel multiplicaría el gasto por la
  // tasa. El monto fiscal queda en 'monto_ncf' y el cambio en 'tasa_usd'.
  let lineas: unknown[] | null = null;
  if (k.glCodigo != null && k.cuentasDistintas >= 1) {
    lineas = (k.desglose as Array<Record<string, unknown>>)
      .filter((d) => d.cuenta != null)
      .map((d) => ({
        cuenta: d.cuenta,
        cuenta_nombre: d.cuenta_nombre ?? null,
        descripcion: d.concepto,
        debito: esUsd ? (d.suma_banco as number ?? null) : (d.monto as number ?? null),
        credito: 0,
      }));
    lineas.push({
      cuenta: k.glCodigo,
      cuenta_nombre: k.glNombre,
      descripcion: `${k.banco} · ${k.cuentaBanco ?? k.cuenta}`,
      debito: 0,
      credito: esUsd ? k.sumaBanco : k.montoComprobante,
    });
  }

  let detalle: string;
  if (k.lineasOk < k.lineasTotal) {
    detalle = 'OJO: no pude atar todos los cargos de este comprobante a movimientos del banco. ' +
      'Revisá el desglose antes de aprobar.';
  } else if (k.cuentasDistintas > 1) {
    detalle = `Se registrará en ADM como Cargo Bancario con NCF ${k.ncf}` +
      `, por RD$${fmtMonto(k.montoComprobante)}` +
      `, amparando ${k.movsTotal} cargo(s). Mezcla conceptos, así que la cuenta va por renglón.`;
  } else if (k.cuentaUnica == null) {
    detalle = `Ninguna regla del mapa de cargos reconoce «${k.conceptos}». Asignale la cuenta antes de aprobar.`;
  } else {
    detalle = `Se registrará en ADM como Cargo Bancario con NCF ${k.ncf}` +
      `: débito a ${k.cuentaUnica} ${k.cuentaUnicaNombre ?? ''}` +
      `, crédito al banco ${k.glCodigo ?? '?'} ${k.glNombre ?? ''}` +
      `, por RD$${fmtMonto(k.montoComprobante)}` +
      ` que ampara ${k.movsTotal} cargo(s) del banco.`;
  }

  const propuesta = stripNulls({
    ncf: k.ncf,
    direccion: 'cargo',
    fecha: k.fechaEmision,
    monto: esUsd ? k.sumaBanco : k.montoComprobante,
    moneda: k.moneda ?? 'DOP',
    monto_ncf: k.montoComprobante,
    tasa_usd: k.tasa,
    descripcion: k.conceptos,
    banco: k.banco,
    cuenta_banco: k.cuentaBanco ?? '',
    cuenta_numero: k.cuenta,
    proveedor: `Banco ${k.banco}`,
    metodo: 'script',
    documento_adm: 'BankCharges',
    // Los movimientos que este comprobante ampara. Van adentro para que la
    // conciliación sepa qué cubre el documento: sin esto, registrar por
    // comprobante perdería el vínculo con el estado de cuenta. Es además una
    // de las cinco llaves de reclamo (`movimientos[]`).
    movimientos: k.movimientoIds,
    movimientos_n: k.movsTotal,
    desglose: k.desglose,
    confianza: k.lineasOk === k.lineasTotal && k.cuentasDistintas === 1
      ? 0.9
      : k.lineasOk === k.lineasTotal
      ? 0.7
      : 0.4,
    // Cabecera sólo si TODAS las líneas caen en la misma cuenta; si el
    // comprobante mezcla naturalezas, cada una vive en su renglón.
    cuenta_contable: k.cuentasDistintas === 1 && k.cuentaUnica != null
      ? { codigo: k.cuentaUnica, nombre: k.cuentaUnicaNombre }
      : null,
    lineas,
    detalle,
  });

  return {
    clave: `ncf:${k.ncf}:${k.cuenta}`,
    fila: {
      empresa_id: empresaId,
      tipo: 'sugerencia',
      origen: 'cron_conciliacion',
      estado: 'propuesta',
      resumen,
      propuesta,
    },
  };
}

// ---------------------------------------------------------------------------
// Carril B — estructuras
// ---------------------------------------------------------------------------

interface Candidato {
  id: string;
  fecha: string;
  monto: number;
  moneda: string | null;
  descripcion: string;
  banco: string | null;
  cuentaNombre: string | null;
  cuentaNumero: string | null;
  direccion: 'cargo' | 'credito';
}

function armarInsertMovimiento(
  empresaId: string,
  c: Candidato,
  regla: ReglaCargo | null,
  gl: BancoGl | null,
): InsertTrabajo {
  const esUsd = c.moneda === 'USD';
  const cuenta = regla?.cuenta ?? null;
  const contraNombre = regla?.cuentaNombre ?? null;
  const glCodigo = gl?.glCodigo ?? null;
  const glNombre = gl?.glNombre ?? null;

  const resumen = `${c.direccion === 'cargo' ? 'Cargo' : 'Crédito'} bancario ${fmtDDMM(c.fecha)}: ` +
    `${c.descripcion.slice(0, 45)} — ${esUsd ? 'US$' : 'RD$'}${fmtMonto(c.monto)}` +
    ` (${c.banco} · ${c.cuentaNombre ?? c.cuentaNumero})`;

  let lineas: unknown[] | null = null;
  if (cuenta != null && glCodigo != null) {
    const lineaContra = {
      cuenta,
      cuenta_nombre: contraNombre,
      descripcion: c.descripcion,
    };
    const lineaBanco = {
      cuenta: glCodigo,
      cuenta_nombre: glNombre,
      descripcion: `${c.banco} · ${c.cuentaNombre ?? c.cuentaNumero}`,
    };
    lineas = c.direccion === 'cargo'
      ? [{ ...lineaContra, debito: c.monto, credito: 0 }, { ...lineaBanco, debito: 0, credito: c.monto }]
      : [{ ...lineaBanco, debito: c.monto, credito: 0 }, { ...lineaContra, debito: 0, credito: c.monto }];
  }

  let detalle: string;
  if (cuenta != null && glCodigo != null && c.direccion === 'cargo') {
    detalle = `Se registrará en ADM como Cargo Bancario: débito a ${cuenta} ${contraNombre ?? ""}` +
      `, crédito al banco ${glCodigo} ${glNombre ?? ""}` +
      '. Cuenta según el mapa de cargos (histórico ADM); el registro se hace al aprobar cuando se encienda la Entrega 2.';
  } else if (cuenta != null && glCodigo != null) {
    detalle = `Se registrará en ADM como Cargo Bancario (crédito): débito al banco ${glCodigo} ${glNombre ?? ""}` +
      `, crédito a ${cuenta} ${contraNombre ?? ""}` +
      '. Cuenta según el mapa de cargos (histórico ADM); el registro se hace al aprobar cuando se encienda la Entrega 2.';
  } else if (cuenta != null) {
    detalle = `Contrapartida ${cuenta} ${contraNombre ?? ""}` +
      ` según el mapa de cargos, pero la cuenta bancaria ${c.cuentaNumero}` +
      ' no está en el mapa de cuentas — completala para armar el asiento.';
  } else if (regla?.revisar != null) {
    detalle = `SIN CUENTA ASIGNADA — ${regla.revisar}.`;
  } else {
    detalle = 'SIN CUENTA ASIGNADA — ninguna regla del mapa de cargos reconoce esta descripción. ' +
      'Revisala con el contable antes de aprobar.';
  }

  const propuesta = stripNulls({
    banco_tx_id: c.id,
    direccion: c.direccion,
    fecha: c.fecha,
    monto: c.monto,
    moneda: c.moneda,
    descripcion: c.descripcion,
    banco: c.banco,
    cuenta_banco: c.cuentaNombre ?? '',
    cuenta_numero: c.cuentaNumero ?? '',
    proveedor: `Banco ${c.banco}`,
    metodo: 'script',
    confianza: cuenta != null ? 0.8 : 0.5,
    documento_adm: 'BankCharges',
    cuenta_contable: cuenta != null ? { codigo: cuenta, nombre: contraNombre } : null,
    lineas,
    detalle,
  });

  return {
    clave: c.id,
    fila: {
      empresa_id: empresaId,
      tipo: 'sugerencia',
      origen: 'cron_conciliacion',
      estado: 'propuesta',
      resumen,
      propuesta,
    },
  };
}

// ---------------------------------------------------------------------------
// CIERRE — retira las sueltas del carril B que su comprobante ya superó.
// ---------------------------------------------------------------------------
//
// El carril B siembra el cargo apenas aparece en el estado de cuenta; cuando el
// banco emite el NCF, el carril A siembra el comprobante que lo ampara... y la
// suelta quedaba en 'propuesta' para siempre (5 así al 2026-08-15). El frontend
// las esconde, pero cualquier otro consumidor de las filas 'propuesta' las ve
// como cola viva de decisión, y decidirlas sería registrar dos veces el mismo
// cargo.
//
// Van a 'rechazada' y no a un estado propio porque el CHECK de la tabla sólo
// admite los 8 estados existentes, y porque el filtro anti-re-proposición ya
// trata 'rechazada' como cierre definitivo. El motivo viaja DENTRO de
// `propuesta` (motivo_rechazo / superada_por_ncf) y `aprobado_por*` quedan
// null: así se distingue el cierre automático del rechazo de un humano (esas
// columnas sólo las escribe la web — el grant por columna de qualiaconta_lector
// lo garantiza hoy; cuando F4 recorte la llave de estas functions, también acá).
//
// El criterio de comprobante VIVO es MÁS estricto que el de los not-exists del
// detector: además de sin anulado_en/eliminado_en, acá se exige
// estado <> 'rechazada'. La diferencia importa porque aquellos filtros solo
// SUPRIMEN una re-proposición y éste DESTRUYE una decisión pendiente: si el
// humano rechazó el comprobante ("ese NCF no ampara ese cargo"), la suelta es
// el único camino vivo que le queda al cargo.
//
// Los dos lados van scopeados a documento_adm='BankCharges': otros detectores
// (notas de débito, asignación de pagos) también siembran sueltas con
// banco_tx_id, y el matching difuso del carril A puede arrastrar uno de esos
// movimientos adentro de un comprobante. Cerrarle la fila a otro carril con un
// motivo que no le aplica no es de este módulo.
//
// En el fuente el cierre era una sentencia aparte, posterior al INSERT, para
// ver los comprobantes recién sembrados. Acá se calcula sobre el snapshot de
// la corrida MÁS los comprobantes de esta corrida — misma cobertura, y si algo
// se escapa por carrera, el paso es idempotente: la corrida siguiente lo
// cierra (no hay medio-estado que dure más de un tick).

interface Cierre {
  id: string;
  bancoTxId: string;
  ncf: string; // min(ncf) elige determinístico cuando dos comprobantes reclaman
}

function calcularCierres(
  snapshot: FilaTrabajo[],
  nuevosComprobantes: Array<{ ncf: string; movimientos: string[] }>,
): Cierre[] {
  interface Amparo {
    ncf: string;
    tiene: (txId: string) => boolean;
  }
  const amparos: Amparo[] = [];
  for (const q of snapshot) {
    if (q.estado === 'rechazada') continue;
    if (q.documento_adm !== 'BankCharges' || q.ncf == null) continue;
    if (!vivo(q)) continue;
    if (!Array.isArray(q.movimientos)) continue; // jsonb_typeof = 'array'
    const movs = q.movimientos as string[];
    amparos.push({ ncf: q.ncf, tiene: (id) => movs.includes(id) });
  }
  for (const n of nuevosComprobantes) {
    amparos.push({ ncf: n.ncf, tiene: (id) => n.movimientos.includes(id) });
  }

  const cierres: Cierre[] = [];
  for (const s of snapshot) {
    if (s.tipo !== 'sugerencia' || s.estado !== 'propuesta') continue;
    if (s.documento_adm !== 'BankCharges') continue;
    const txId = s.banco_tx_id ?? '';
    if (txId === '') continue;
    const ncfs = amparos.filter((a) => a.tiene(txId)).map((a) => a.ncf);
    if (ncfs.length === 0) continue;
    cierres.push({ id: s.id, bancoTxId: txId, ncf: ncfs.sort()[0] });
  }
  return cierres;
}

// ---------------------------------------------------------------------------
// El detector
// ---------------------------------------------------------------------------

export async function detectarCargos(
  supabase: SupabaseClient,
  empresaId: string,
  modo: Modo,
  opciones: OpcionesCargos = {},
): Promise<ResultadoCargos> {
  if (!/^[0-9a-fA-F-]{36}$/.test(empresaId)) {
    throw new Error(`detectarCargos: empresaId no parece UUID: ${JSON.stringify(empresaId)}`);
  }
  // En 'server' el detector no toca nada: el server (Hermes/poller) sigue
  // siendo el único dueño de las sugerencias. index.ts ya corta antes, pero el
  // módulo se defiende solo por si lo invocan directo.
  if (modo === 'server') {
    return { modo, accion: 'ninguna', comprobantes: 0, movimientos: 0, cerradas: 0, resumenes: [] };
  }

  const hoy = hoyISO();
  const diasVentana = Math.max(1, Math.floor(opciones.diasVentana ?? 30));
  const filtroCuentas = (opciones.cuentas ?? []).map((c) => c.trim()).filter((c) => c !== '');

  const mapa = await cargarMapa(supabase, empresaId);
  const snapshot = await snapshotReclamos(supabase, empresaId);

  const cuentas = await todas<Cuenta>((desde, hasta) =>
    supabase
      .from('openbanking_accounts')
      .select('id, banco, nombre, numero, moneda')
      .eq('empresa_id', empresaId)
      .order('id', { ascending: true })
      .range(desde, hasta)
  );
  const cuentaPorNumero = new Map(cuentas.filter((a) => a.numero != null).map((a) => [a.numero!, a]));
  const cuentaPorId = new Map(cuentas.map((a) => [a.id, a]));

  // NCF ya reclamados por un trabajo vivo (cualquier estado, incluso
  // 'rechazada': si el humano rechazó el comprobante, no se le vuelve a
  // proponer — el mismo criterio que el carril B para movimientos).
  const ncfReclamados = new Set(
    snapshot
      .filter((q) => q.documento_adm === 'BankCharges' && q.ncf != null && vivo(q))
      .map((q) => q.ncf!),
  );

  // ------------------------------------------------------------------------
  // CARRIL A — los cargos que el banco SÍ factura, agrupados por comprobante.
  // Un NCF ampara todos los cargos de (cuenta + concepto + día): las 7
  // comisiones LBTR del 30/07 son UN comprobante de RD$700, y así es como la
  // contabilidad los registra (un documento por NCF, verificado contra los
  // 159 históricos).
  // ------------------------------------------------------------------------
  const comprobantesDb = await todas<ComprobanteDb>((desde, hasta) =>
    supabase
      .from('openbanking_comprobantes')
      .select('ncf, fecha_emision, monto_dop, lineas')
      .gte('fecha_emision', restarDias(hoy, 60))
      .order('ncf', { ascending: true })
      .range(desde, hasta)
  );

  const lineasComprobante: LineaComprobante[] = [];
  for (const c of comprobantesDb) {
    if (ncfReclamados.has(c.ncf)) continue;
    for (const l of c.lineas ?? []) {
      const numero = l.cuenta == null ? null : String(l.cuenta);
      if (numero == null) continue;
      // El join por cuenta es lo que ata el comprobante a ESTA empresa, y de
      // paso deja fuera solos a los productos que no son cuenta corriente (un
      // leasing, un préstamo): su cargo no aparece en ningún estado de cuenta,
      // así que no hay nada que conciliar y se tratan aparte.
      const a = cuentaPorNumero.get(numero);
      if (!a) continue;
      lineasComprobante.push({
        ncf: c.ncf,
        fechaEmision: c.fecha_emision,
        montoComprobante: Number(c.monto_dop),
        cuenta: numero,
        concepto: String(l.concepto ?? ''),
        montoLinea: l.montoDop == null ? null : Number(l.montoDop),
        fechaLinea: l.fecha == null ? null : String(l.fecha).slice(0, 10),
        accountId: a.id,
        moneda: a.moneda,
        banco: a.banco,
        cuentaBanco: a.nombre,
      });
    }
  }

  // Una sola bajada de transacciones cubre los dos carriles: el A necesita
  // llegar hasta 4 días antes de la línea más vieja del comprobante.
  let fechaMinima = restarDias(hoy, diasVentana);
  for (const li of lineasComprobante) {
    if (li.fechaLinea != null) {
      const desde = restarDias(li.fechaLinea, 4);
      if (desde < fechaMinima) fechaMinima = desde;
    }
  }
  const cuentaIds = cuentas.map((a) => a.id);
  const transacciones = cuentaIds.length === 0 ? [] : await todas<Transaccion>((desde, hasta) =>
    supabase
      .from('openbanking_transactions')
      .select('id, account_id, fecha_posteo, monto, descripcion')
      .in('account_id', cuentaIds)
      .gte('fecha_posteo', fechaMinima)
      .order('fecha_posteo', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, hasta)
  );
  const txPorCuenta = new Map<string, Transaccion[]>();
  for (const t of transacciones) {
    const lista = txPorCuenta.get(t.account_id) ?? [];
    lista.push(t);
    txPorCuenta.set(t.account_id, lista);
  }

  // Agrupar por (ncf, fecha, monto, banco, moneda, cuenta, cuentaBanco) —
  // el mismo GROUP BY del fuente; orden por concepto para el desglose.
  const grupos = new Map<string, { base: LineaComprobante; lineas: Array<{ li: LineaComprobante; r: LineaResuelta | null; m: ReglaCargo | null }> }>();
  for (const li of lineasComprobante) {
    const r = resolverLinea(li, txPorCuenta.get(li.accountId) ?? []);
    // Sólo reglas dir='cargo': el carril A es siempre plata que salió.
    const m = mapa.reglas.find((rr) => rr.dir === 'cargo' && rr.rx.test(li.concepto)) ?? null;
    const k = [li.ncf, li.fechaEmision, li.montoComprobante, li.banco, li.moneda, li.cuenta, li.cuentaBanco].join('|');
    const g = grupos.get(k) ?? { base: li, lineas: [] };
    g.lineas.push({ li, r, m });
    grupos.set(k, g);
  }

  const gruposComprobante: GrupoComprobante[] = [];
  for (const g of [...grupos.values()]) {
    g.lineas.sort((a, b) => (a.li.concepto < b.li.concepto ? -1 : a.li.concepto > b.li.concepto ? 1 : 0));
    const cuentasMapa = new Set(g.lineas.map((x) => x.m?.cuenta).filter((c): c is string => c != null));
    const tasas = g.lineas.map((x) => x.r?.tasa).filter((t): t is number => t != null);
    const conceptos = [...new Set(g.lineas.map((x) => x.li.concepto))].sort().join(' + ');
    const movimientoIds: string[] = [];
    for (const x of g.lineas) if (x.r) movimientoIds.push(...x.r.ids);
    const nombresUnica = g.lineas.map((x) => x.m?.cuentaNombre).filter((n): n is string => n != null);
    const cuentasUnica = g.lineas.map((x) => x.m?.cuenta).filter((c): c is string => c != null);
    const gl = mapa.bancos.get(g.base.cuenta) ?? null;

    gruposComprobante.push({
      ncf: g.base.ncf,
      fechaEmision: g.base.fechaEmision,
      montoComprobante: g.base.montoComprobante,
      banco: g.base.banco,
      moneda: g.base.moneda,
      cuenta: g.base.cuenta,
      cuentaBanco: g.base.cuentaBanco,
      lineasTotal: g.lineas.length,
      lineasOk: g.lineas.filter((x) => x.r?.diasCandidatos === 1).length,
      movsTotal: g.lineas.reduce((s, x) => s + (x.r?.movs ?? 0), 0),
      tasa: tasas.length ? Math.max(...tasas) : null,
      sumaBanco: round2(g.lineas.reduce((s, x) => s + (x.r?.suma ?? 0), 0)),
      conceptos,
      movimientoIds,
      desglose: g.lineas.map((x) =>
        stripNulls({
          concepto: x.li.concepto,
          cuenta_banco: x.li.cuenta,
          monto: x.li.montoLinea,
          fecha_cargo: x.r?.dia ?? null,
          movimientos: x.r?.movs ?? null,
          suma_banco: x.r?.suma ?? null,
          tasa_usd: x.r?.tasa ?? null,
          cuenta: x.m?.cuenta ?? null,
          cuenta_nombre: x.m?.cuentaNombre ?? null,
          // `is distinct from 1`: la línea sin resolver Y la línea sin ningún
          // día candidato quedan marcadas igual.
          sin_resolver: x.r?.diasCandidatos === 1 ? null : true,
        })
      ),
      cuentasDistintas: cuentasMapa.size,
      cuentaUnica: cuentasUnica.length ? [...cuentasUnica].sort()[0] : null,
      cuentaUnicaNombre: nombresUnica.length ? [...nombresUnica].sort()[0] : null,
      glCodigo: gl?.glCodigo ?? null,
      glNombre: gl?.glNombre ?? null,
    });
  }

  const insertsComprobantes = gruposComprobante.map((k) => armarInsertComprobante(empresaId, k));

  // ------------------------------------------------------------------------
  // CARRIL B — lo que NINGÚN comprobante ampara. De a un movimiento.
  // ------------------------------------------------------------------------
  const amparados = new Set<string>();
  for (const k of gruposComprobante) for (const id of k.movimientoIds) amparados.add(id);

  // El prefiltro de candidatos sale de LAS REGLAS del mapa, no de una lista
  // aparte. Mientras fueron dos listas se separaron de verdad: el mapa tenía
  // «ahorro por compra» desde siempre y el prefiltro escrito a mano no, así
  // que el cashback de la Visa 1877 nunca llegó a la mesa y terminó registrado
  // como un Journals que la conciliación no puede ver (2026-08-05). Derivarlo
  // es lo único que asegura que agregar una regla alcance para que el
  // movimiento aparezca.
  const matchDir = (dir: 'cargo' | 'credito', descripcion: string) =>
    mapa.reglas.some((r) => r.dir === dir && r.rx.test(descripcion));

  const corteB = restarDias(hoy, diasVentana);
  const candidatos: Candidato[] = [];
  for (const t of transacciones) {
    if (t.fecha_posteo < corteB) continue;
    const a = cuentaPorId.get(t.account_id);
    if (!a) continue;
    if (filtroCuentas.length && (a.numero == null || !filtroCuentas.includes(a.numero))) continue;
    const desc = t.descripcion ?? '';
    const esCargo = t.monto < 0 && matchDir('cargo', desc);
    const esCredito = t.monto > 0 && matchDir('credito', desc);
    if (!esCargo && !esCredito) continue;
    if (amparados.has(t.id)) continue;
    // Ya reclamado por un trabajo VIVO — las cinco llaves, no sólo banco_tx_id
    // (ver reclama()). El agujero ya se pagó dos veces.
    if (snapshot.some((q) => vivo(q) && reclama(q, t.id))) continue;
    // Y tampoco se vuelve a proponer lo que YA se rechazó una vez. Un rechazo
    // no deja `registro_adm`, así que el filtro de vivo no lo ve... salvo la
    // fila rechazada que arrastra un registro_adm ANULADO: esa deja de ser
    // "viva" y su movimiento volvía a la cola pese al rechazo humano — uno
    // volvió CINCO veces en trece horas. Proponer de nuevo lo que un humano
    // acaba de descartar no es insistencia, es ruido — y enseña a aprobar sin
    // mirar. El movimiento NO se pierde: sigue visible en Sugerencias como
    // salida sin documento; lo que se apaga es la re-proposición automática.
    if (snapshot.some((q) => q.estado === 'rechazada' && reclama(q, t.id))) continue;
    candidatos.push({
      id: t.id,
      fecha: t.fecha_posteo,
      monto: Math.abs(t.monto),
      moneda: a.moneda,
      descripcion: desc.trim(),
      banco: a.banco,
      cuentaNombre: a.nombre,
      cuentaNumero: a.numero,
      direccion: t.monto < 0 ? 'cargo' : 'credito',
    });
    if (candidatos.length >= 40) break; // limit 40 del fuente (ya vienen por fecha)
  }

  const insertsMovimientos = candidatos.map((c) => {
    const regla = mapa.reglas.find((r) => r.dir === c.direccion && r.rx.test(c.descripcion)) ?? null;
    const gl = c.cuentaNumero != null ? mapa.bancos.get(c.cuentaNumero) ?? null : null;
    return armarInsertMovimiento(empresaId, c, regla, gl);
  });

  // ------------------------------------------------------------------------
  // CIERRE (sobre snapshot + comprobantes de esta corrida)
  // ------------------------------------------------------------------------
  const cierres = calcularCierres(
    snapshot,
    gruposComprobante.map((k) => ({ ncf: k.ncf, movimientos: k.movimientoIds })),
  );

  const inserts = [...insertsComprobantes, ...insertsMovimientos];
  const resumenes = inserts.map((i) => i.fila.resumen);

  // ------------------------------------------------------------------------
  // Ejecutar según modo
  // ------------------------------------------------------------------------
  if (modo === 'sombra') {
    // Calcula todo, escribe SOLO qualia_sombra: la clave es la llave natural
    // del movimiento (banco_tx_id para la suelta, ncf+cuenta para el
    // comprobante) para poder diffear contra lo que produce el server.
    for (const i of inserts) {
      await registrarSombra(FUNCION_SOMBRA, empresaId, i.clave, {
        resumen: i.fila.resumen,
        propuesta: i.fila.propuesta,
      });
    }
    // Los cierres también van a sombra, con prefijo propio, para diffear la
    // otra mitad del script (qué sueltas cerraría).
    for (const c of cierres) {
      await registrarSombra(FUNCION_SOMBRA, empresaId, `cierre:${c.id}`, {
        trabajo_id: c.id,
        banco_tx_id: c.bancoTxId,
        superada_por_ncf: c.ncf,
      });
    }
    return {
      modo,
      accion: 'sombra',
      comprobantes: insertsComprobantes.length,
      movimientos: insertsMovimientos.length,
      cerradas: cierres.length,
      resumenes,
    };
  }

  // modo === 'nube': escribe de verdad.
  if (inserts.length > 0) {
    const { error } = await supabase.from('qualia_trabajos').insert(inserts.map((i) => i.fila));
    if (error) throw new Error(`detectarCargos: insert en qualia_trabajos falló: ${error.message}`);
  }

  let cerradas = 0;
  if (cierres.length > 0) {
    // La propuesta completa sólo hace falta para el merge del motivo (el
    // snapshot lleva campos extraídos, no el jsonb entero).
    const { data: sueltas, error } = await supabase
      .from('qualia_trabajos')
      .select('id, propuesta')
      .in('id', cierres.map((c) => c.id));
    if (error) throw new Error(`detectarCargos: no pude releer las sueltas a cerrar: ${error.message}`);
    const propuestaPorId = new Map((sueltas ?? []).map((s) => [s.id, s.propuesta]));

    for (const c of cierres) {
      const propuesta = propuestaPorId.get(c.id);
      if (propuesta == null) continue;
      // La guarda estado='propuesta' imita el snapshot único de la sentencia
      // SQL original: si el humano decidió entre el cálculo y el update, su
      // decisión gana y esta corrida no toca nada. `aprobado_por*` no se
      // escriben: el cierre automático se reconoce por el motivo adentro de
      // la propuesta, nunca firmado como humano.
      const { data: tocadas, error: errorUpdate } = await supabase
        .from('qualia_trabajos')
        .update({
          estado: 'rechazada',
          propuesta: {
            ...(propuesta as Record<string, unknown>),
            motivo_rechazo: `superada por comprobante ${c.ncf}`,
            superada_por_ncf: c.ncf,
          },
        })
        .eq('id', c.id)
        .eq('estado', 'propuesta')
        .select('id');
      if (errorUpdate) throw new Error(`detectarCargos: cierre de ${c.id} falló: ${errorUpdate.message}`);
      cerradas += (tocadas ?? []).length;
    }
  }

  return {
    modo,
    accion: 'insertadas',
    comprobantes: insertsComprobantes.length,
    movimientos: insertsMovimientos.length,
    cerradas,
    resumenes,
  };
}
