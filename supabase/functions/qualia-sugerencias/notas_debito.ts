// Detector de notas de débito del banco — port fiel de
// empresas/blackbox/hermes/scripts/sugerir-notas-debito.sh (cron --no-agent,
// CERO tokens).
//
// Una nota de débito es plata que salió del banco y NADA MÁS: el estado de
// cuenta dice "Nota De Débito" a secas, sin beneficiario y sin concepto. Puede
// ser el pago del ITBIS, la TSS, aduanas, un abono a un préstamo o a una línea
// de crédito. Clasificarla por su descripción es imposible — no hay descripción.
//
// LA PREGUNTA QUE LO RESUELVE NO ES "QUÉ TIPO ES" SINO "¿YA ESTÁ EN ADM?".
// El humano no le cuenta al banco lo que hizo, pero sí se lo cuenta a ADM: los
// pagos a factura los sube él a mano, con su comprobante. Entonces se cruza
// cada nota de débito contra los pagos registrados y el resultado decide todo:
//
//   YA ESTÁ + beneficiario fiscal  → falta el VOLANTE del impuesto (el papel de
//         DGII que dice cuánto se debe). NO el comprobante de pago: ese ya lo
//         subió él por ADM. No hay nada contable que hacer, sólo adjuntar.
//   YA ESTÁ + cualquier otro       → NO se sugiere. Está registrado y se
//         concilia solo; recordárselo sería ruido.
//   NO ESTÁ                        → nadie lo asentó, y no va a llegar por el
//         flujo de facturas. Es el préstamo o la línea de crédito. Ahí sí hay
//         trabajo y se propone.
//
// Se limita a las notas de débito A PROPÓSITO. Toda salida sin registrar serían
// 90 filas en julio (RD$7,4 MM), y 79 de ellas son pagos a proveedor que el
// humano sube por rutina: el sistema estaría reclamándole su propio trabajo
// pendiente y enterrando lo que sí necesita decisión. Lo opaco es lo que se
// sugiere; lo que se explica solo, no.
//
// El cruce va contra el ESPEJO de pagos de ADM, no contra la API: mismo patrón
// que el fuente. Si el refresco del espejo se rompe, el espejo envejece y todo
// empieza a verse como "no registrado". Es la falla a vigilar (qualia-salud).
//
// El port cambia el chasis (bash+psql → TS+supabase-js) pero NO las reglas.
// El ensayo QUALIA_DRY_RUN del fuente no se porta — el modo 'sombra' del
// contrato F1 lo reemplaza (calcula todo, escribe SOLO en qualia_sombra).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { registrarSombra } from '../_shared/sombra.ts';

export type Modo = 'server' | 'sombra' | 'nube';

const FUNCION_SOMBRA = 'qualia-sugerencias/notas_debito';

// TODO(F1): el espejo vivía en /opt/data/preentrenamiento/raw del contenedor,
// refrescado cada noche por mesa/refrescar-precedentes.sh (bill-payments y
// account-payments entran por LA pregunta que decide qué hacer con una salida
// del banco: ¿ya la registró el humano?). En el mundo serverless el espejo
// tiene que aterrizar en un lugar alcanzable por la function; esta ruta en el
// bucket es una CONVENCIÓN PROPUESTA hasta que se porte refrescar-precedentes
// (misma F1, otro constructor) — si aterriza en otro lado (otra ruta, una
// tabla), cambiar estas constantes y nada más.
const BUCKET_ESPEJO = 'qualia-espejos';
const ARCHIVOS_ESPEJO = ['bill-payments.jsonl', 'account-payments.jsonl'];
const rutaEspejo = (empresaId: string, archivo: string) => `espejo-adm/${empresaId}/${archivo}`;

// A quién se le paga un impuesto. Sale de los beneficiarios REALES del espejo,
// no de una lista inventada; se amplía cuando aparezca un organismo nuevo.
// (Los \m/\M de POSIX del fuente son \b en RegExp de JS.)
const RX_FISCAL = /dgii|impuestos internos|tesoreria|seguridad social|\btss\b|aduanas|\bdga\b/i;

export interface ResultadoNotasDebito {
  modo: Modo;
  accion: 'ninguna' | 'sombra' | 'insertadas';
  nuevas: number;
  resumenes: string[];
}

// ---------------------------------------------------------------------------
// Helpers (misma semántica SQL que el fuente; duplicados a propósito con
// cargos.ts — cada detector viaja completo, como viajaba cada script)
// ---------------------------------------------------------------------------

const DIA_MS = 86_400_000;

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function restarDias(iso: string, dias: number): string {
  return new Date(Date.parse(iso) - dias * DIA_MS).toISOString().slice(0, 10);
}

function difDias(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / DIA_MS);
}

function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

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

// jsonb_strip_nulls: quita claves null a toda profundidad, conserva elementos
// de array.
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

// PostgREST corta en 1000 filas: se pagina para que ningún reclamo quede fuera
// del snapshot (un reclamo invisible = nota re-sugerida).
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
    if (error) throw new Error(`detectarNotasDebito: consulta paginada falló: ${error.message}`);
    const lote = (data ?? []) as T[];
    filas.push(...lote);
    if (lote.length < LOTE) break;
  }
  return filas;
}

// ---------------------------------------------------------------------------
// Reclamos (mismo bloque que cargos.ts, con la diferencia documentada abajo)
// ---------------------------------------------------------------------------

interface FilaTrabajo {
  id: string;
  estado: string | null;
  banco_tx_id: string | null;
  origen_tx: string | null;
  destino_tx: string | null;
  banco_tx_ids: unknown;
  movimientos: unknown;
  anulado_en: string | null;
  eliminado_en: string | null;
}

const SELECT_RECLAMOS =
  'id, estado, ' +
  'banco_tx_id:propuesta->>banco_tx_id, ' +
  'origen_tx:propuesta->origen->>banco_tx_id, ' +
  'destino_tx:propuesta->destino->>banco_tx_id, ' +
  'banco_tx_ids:propuesta->banco_tx_ids, ' +
  'movimientos:propuesta->movimientos, ' +
  'anulado_en:propuesta->registro_adm->>anulado_en, ' +
  'eliminado_en:propuesta->registro_adm->>eliminado_en';

// Vivo: un documento anulado o borrado en ADM deja de reclamar su movimiento,
// porque anular es casi siempre el paso previo a registrarlo bien. Sin esto,
// la primera sugerencia se quedaba con la nota para siempre y corregir un
// registro equivocado no tenía salida.
function vivo(t: FilaTrabajo): boolean {
  return t.anulado_en == null && t.eliminado_en == null;
}

// Las CINCO formas de reclamar, no sólo `banco_tx_id`: el comprobante fiscal
// reclama sus movimientos por el array `movimientos` y la transferencia por
// sus dos patas (y su array `banco_tx_ids`). El 2026-08-04, mirando sólo
// `banco_tx_id`, 40 cargos con su comprobante vivo volvieron a sugerirse uno
// por uno — acá el mismo agujero re-sugería la nota aunque otro trabajo ya la
// tuviera amparada (se pagó de nuevo el 2026-08-15). Mismo criterio que
// `idsLevantados()` en la mesa web.
function reclama(t: FilaTrabajo, txId: string): boolean {
  return t.banco_tx_id === txId ||
    t.origen_tx === txId ||
    t.destino_tx === txId ||
    contiene(t.banco_tx_ids, txId) ||
    contiene(t.movimientos, txId);
}

// ---------------------------------------------------------------------------
// El espejo de pagos de ADM
// ---------------------------------------------------------------------------

interface PagoAdm {
  fecha: string;
  monto: number;
  moneda: string;
  beneficiario: string | null;
  docid: string | null;
}

async function cargarEspejo(supabase: SupabaseClient, empresaId: string): Promise<PagoAdm[]> {
  // Ventana del espejo: los pagos viejos no pueden explicar una nota de débito
  // reciente y sólo engordan el cruce.
  const corte = restarDias(hoyISO(), 150);
  const pagos: PagoAdm[] = [];

  for (const archivo of ARCHIVOS_ESPEJO) {
    const ruta = rutaEspejo(empresaId, archivo);
    const { data, error } = await supabase.storage.from(BUCKET_ESPEJO).download(ruta);
    if (error || !data) {
      // Falla dura, igual que el exit 1 del fuente: sin espejo, TODO se vería
      // como "no registrado" y el detector propondría registrar lo que el
      // humano ya asentó. Mejor no correr que correr ciego.
      throw new Error(`detectarNotasDebito: falta el espejo ${BUCKET_ESPEJO}/${ruta}: ${error?.message ?? 'vacío'}`);
    }
    const texto = await data.text();
    for (const linea of texto.split('\n')) {
      const limpia = linea.trim();
      if (!limpia) continue;
      const d = JSON.parse(limpia) as Record<string, unknown>;
      const fecha = String(d.DocDate ?? '').slice(0, 10);
      if (!fecha || fecha < corte) continue;
      // Fiel al fuente en dos matices: float() abortaba ante un TotalAmount no
      // numérico (mejor no correr que correr ciego), y el `or` de Python trata
      // el string VACÍO como falsy — `??` no, y un Beneficiary:'' con
      // RelationshipName fiscal cambiaría la clasificación.
      const monto = Math.abs(Number(d.TotalAmount ?? 0));
      if (Number.isNaN(monto)) {
        throw new Error('TotalAmount no numérico en el espejo de notas de débito');
      }
      if (!(monto > 0)) continue;
      const oTexto = (...vals: unknown[]): string | null => {
        for (const v of vals) {
          if (typeof v === 'string' && v !== '') return v;
        }
        return null;
      };
      pagos.push({
        fecha,
        monto,
        moneda: oTexto(d.CurrencyID) ?? 'DOP',
        beneficiario: oTexto(d.Beneficiary, d.RelationshipName),
        docid: oTexto(d.DocID),
      });
    }
  }
  return pagos;
}

// ---------------------------------------------------------------------------
// Estructuras del cruce
// ---------------------------------------------------------------------------

interface Nota {
  id: string;
  fecha: string;
  monto: number;
  moneda: string | null;
  descripcion: string;
  nroReferencia: string | null;
  banco: string | null;
  cuentaNombre: string | null;
  cuentaNumero: string | null;
}

interface Cruce extends Nota {
  beneficiario: string | null;
  docid: string | null;
  fechaAdm: string | null;
  difMonto: number | null;
  accion: 'registrar' | 'volante' | 'nada';
}

interface InsertTrabajo {
  clave: string;
  fila: {
    empresa_id: string;
    tipo: 'sugerencia';
    origen: 'cron_conciliacion';
    estado: 'propuesta';
    resumen: string;
    propuesta: unknown;
  };
}

function armarInsert(empresaId: string, c: Cruce): InsertTrabajo {
  const esUsd = c.moneda === 'USD';
  const simbolo = esUsd ? 'US$' : 'RD$';

  const resumen = c.accion === 'volante'
    ? `Falta el volante: ${c.beneficiario ?? 'impuesto'} ${fmtDDMM(c.fecha)} — ` +
      `${simbolo}${fmtMonto(c.monto)} (ya registrado, ${c.docid})`
    : `Nota de débito sin identificar ${fmtDDMM(c.fecha)} — ${simbolo}${fmtMonto(c.monto)}` +
      ` (${c.banco} · ${c.cuentaNombre ?? c.cuentaNumero})`;

  const detalle = c.accion === 'volante'
    ? `Este pago YA está registrado en ADM (${c.docid}, ${c.beneficiario ?? ''}). ` +
      'No hay nada contable que hacer: falta el ' +
      'VOLANTE del impuesto —el papel de la declaración, no el comprobante de pago— ' +
      'para soportar el gasto.'
    : 'Ningún pago registrado en ADM coincide con este monto y fecha, así que no ' +
      'llegó por el flujo de facturas: suele ser un abono a préstamo o a línea de ' +
      `crédito. Referencia del banco: ${c.nroReferencia ?? 's/n'}` +
      '. Identificá contra qué va antes de registrarlo.';

  const propuesta = stripNulls({
    banco_tx_id: c.id,
    clase: 'nota_debito',
    // Lo que hay que HACER, que es distinto de lo que la cosa ES. La pantalla
    // agrupa por esto: un volante se adjunta, una nota sin identificar se
    // decide.
    accion: c.accion === 'volante' ? 'adjuntar_volante' : 'registrar',
    direccion: 'cargo',
    fecha: c.fecha,
    monto: c.monto,
    moneda: c.moneda,
    descripcion: c.descripcion,
    referencia_banco: c.nroReferencia,
    banco: c.banco,
    cuenta_banco: c.cuentaNombre ?? '',
    cuenta_numero: c.cuentaNumero ?? '',
    metodo: 'script',
    confianza: c.accion === 'volante' ? 0.9 : 0.4,
    // El pago que ya existe en ADM, cuando lo hay. Es la prueba de que no hay
    // que registrar nada.
    pago_adm: c.docid != null
      ? stripNulls({
        docid: c.docid,
        fecha: c.fechaAdm,
        beneficiario: c.beneficiario,
        // Sólo si NO es idéntico: un cero acá se leería como ruido, y una
        // diferencia callada como certeza que no hay.
        dif_monto: c.difMonto != null && c.difMonto > 0.01 ? c.difMonto : null,
      })
      : null,
    // SIN documento_adm a propósito: el registrador sólo automatiza
    // VendorBills y BankCharges, y ninguna de estas dos ramas se registra
    // sola. Falla cerrada.
    detalle,
  });

  return {
    clave: c.id, // la llave natural del movimiento, para el diff de sombra
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
// El detector
// ---------------------------------------------------------------------------

export async function detectarNotasDebito(
  supabase: SupabaseClient,
  empresaId: string,
  modo: Modo,
): Promise<ResultadoNotasDebito> {
  if (!/^[0-9a-fA-F-]{36}$/.test(empresaId)) {
    throw new Error(`detectarNotasDebito: empresaId no parece UUID: ${JSON.stringify(empresaId)}`);
  }
  // En 'server' el detector no toca nada; index.ts ya corta antes, pero el
  // módulo se defiende solo por si lo invocan directo.
  if (modo === 'server') {
    return { modo, accion: 'ninguna', nuevas: 0, resumenes: [] };
  }

  const hoy = hoyISO();
  const pagosAdm = await cargarEspejo(supabase, empresaId);

  const trabajos = await todas<FilaTrabajo>((desde, hasta) =>
    supabase
      .from('qualia_trabajos')
      .select(SELECT_RECLAMOS)
      .eq('empresa_id', empresaId)
      .order('id', { ascending: true })
      .range(desde, hasta)
  );

  const cuentas = await todas<{ id: string; banco: string | null; nombre: string | null; numero: string | null; moneda: string | null }>(
    (desde, hasta) =>
      supabase
        .from('openbanking_accounts')
        .select('id, banco, nombre, numero, moneda')
        .eq('empresa_id', empresaId)
        .order('id', { ascending: true })
        .range(desde, hasta),
  );
  const cuentaPorId = new Map(cuentas.map((a) => [a.id, a]));

  const transacciones = cuentas.length === 0 ? [] : await todas<{
    id: string;
    account_id: string;
    fecha_posteo: string;
    monto: number;
    descripcion: string | null;
    nro_referencia: string | null;
  }>((desde, hasta) =>
    supabase
      .from('openbanking_transactions')
      .select('id, account_id, fecha_posteo, monto, descripcion, nro_referencia')
      .in('account_id', cuentas.map((a) => a.id))
      .lt('monto', 0)
      .gte('fecha_posteo', restarDias(hoy, 120))
      .ilike('descripcion', '%nota de debito%')
      .order('fecha_posteo', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, hasta)
  );

  const notas: Nota[] = [];
  for (const t of transacciones) {
    const a = cuentaPorId.get(t.account_id);
    if (!a) continue;
    // Ya reclamada por un trabajo VIVO — el PRIMERO de los dos not-exists de
    // cargos.ts, mismo criterio que `idsLevantados()` en la mesa.
    //
    // Falta a propósito el SEGUNDO not-exists de cargos (el que además calla
    // lo que ya se rechazó una vez). Hay un hueco conocido: una fila
    // 'rechazada' que lleve registro_adm ANULADO pasa el criterio de vivo de
    // arriba y su movimiento vuelve a la cola pese al rechazo humano. Al
    // 2026-08-15 hay 4 filas así en la base y ninguna reclama una nota de
    // débito —las 4 son 'Debito Por Transferencia'—, así que el hueco no
    // dispara todavía. Si aparece una, portar también ese bloque (está
    // completo en cargos.ts).
    if (trabajos.some((q) => vivo(q) && reclama(q, t.id))) continue;
    notas.push({
      id: t.id,
      fecha: t.fecha_posteo,
      monto: Math.abs(t.monto),
      moneda: a.moneda,
      descripcion: (t.descripcion ?? '').trim(),
      nroReferencia: t.nro_referencia,
      banco: a.banco,
      cuentaNombre: a.nombre,
      cuentaNumero: a.numero,
    });
    if (notas.length >= 40) break; // limit 40 del fuente (ya vienen por fecha)
  }

  // El cruce: misma moneda, fecha con holgura (el asiento en ADM no siempre
  // lleva el día del banco) y monto hasta UN PESO de diferencia.
  //
  // El peso de tolerancia no es pereza: medido el 2026-08-04, la nota de
  // débito del 30/06 por RD$6.195,19 es el pago a Claro que ADM tiene como
  // RD$6.195,16 —tres centavos, el mismo día— y con tolerancia de un centavo
  // se perdía. El siguiente candidato más cercano de todo el espejo está a 28
  // pesos, así que un peso separa sin inventar. Cuando la diferencia pasa del
  // centavo, la propuesta lo dice (`dif_monto`) en vez de afirmar que son
  // idénticos.
  const cruces: Cruce[] = notas.map((n) => {
    const candidatos = pagosAdm
      .filter((p) => p.moneda === n.moneda && Math.abs(p.monto - n.monto) < 1.0 && difDias(p.fecha, n.fecha) <= 5)
      .sort((a, b) => {
        const dm = Math.abs(a.monto - n.monto) - Math.abs(b.monto - n.monto);
        if (dm !== 0) return dm;
        return difDias(a.fecha, n.fecha) - difDias(b.fecha, n.fecha);
      });
    const p = candidatos[0] ?? null;
    const accion: Cruce['accion'] = p?.docid == null
      ? 'registrar'
      : RX_FISCAL.test(p.beneficiario ?? '')
      ? 'volante'
      : 'nada';
    return {
      ...n,
      beneficiario: p?.beneficiario ?? null,
      docid: p?.docid ?? null,
      fechaAdm: p?.fecha ?? null,
      difMonto: p != null ? round2(Math.abs(p.monto - n.monto)) : null,
      accion,
    };
  });

  const inserts = cruces.filter((c) => c.accion !== 'nada').map((c) => armarInsert(empresaId, c));
  const resumenes = inserts.map((i) => i.fila.resumen);

  if (modo === 'sombra') {
    // Calcula todo, escribe SOLO qualia_sombra; clave = banco_tx_id, la llave
    // natural del movimiento, para diffear contra lo que produce el server.
    for (const i of inserts) {
      await registrarSombra(FUNCION_SOMBRA, empresaId, i.clave, {
        resumen: i.fila.resumen,
        propuesta: i.fila.propuesta,
      });
    }
    return { modo, accion: 'sombra', nuevas: inserts.length, resumenes };
  }

  // modo === 'nube': escribe de verdad.
  if (inserts.length > 0) {
    const { error } = await supabase.from('qualia_trabajos').insert(inserts.map((i) => i.fila));
    if (error) throw new Error(`detectarNotasDebito: insert en qualia_trabajos falló: ${error.message}`);
  }

  return { modo, accion: 'insertadas', nuevas: inserts.length, resumenes };
}
