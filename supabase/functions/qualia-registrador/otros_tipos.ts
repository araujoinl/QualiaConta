// qualia-registrador/otros_tipos.ts — ports de registrar-asiento-diario.py
// (Journals, 360 líneas) y registrar-transferencia-bancaria.py
// (BankBankTransfers, 336 líneas), bloque a bloque con sus lápidas.

import { Catalogo } from '../_shared/catalogo.ts';
import type { AdmCliente } from '../_shared/adm.ts';
import { ErrorPropuesta } from './vendor_bills.ts';

// deno-lint-ignore no-explicit-any
type Dic = Record<string, any>;

/** nro_referencia del banco > banco_tx_id > trabajo: sin llave, dos gemelos
 * del mismo día son indistinguibles y no hay NCF que los separe. */
export function referenciaMovimiento(p: Dic, trabajoId: string): string {
  return String(p.nro_referencia ?? '') || String(p.banco_tx_id ?? '') || trabajoId;
}

/** Un documento ya existente que ES este movimiento: se adopta y se cierra. */
export interface Adopcion {
  adoptar: true;
  docid: string;
  uuid: string;
}

export interface ArmadoSimple {
  adoptar?: false;
  payload: Dic;
  referencia: string;
  avisos: string[];
  /** Cuentas tocadas (para el candado de nómina en Journals). */
  cuentas: string[];
}

function resolverCuentaLinea(cat: Catalogo, l: Dic, i: number): string {
  const cod = String(l.cuenta ?? '').trim();
  const cuentaId = String(l.cuenta_id ?? '').trim();
  let uid: string | null = null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(cod)) uid = cod;
  else if (/^[0-9a-f-]{36}$/.test(cuentaId)) uid = cuentaId;
  else uid = cat.cuentaUuid(cod);
  if (!uid) throw new ErrorPropuesta(`no encontré el UUID de la cuenta '${cod}' (línea ${i + 1}) en ADM`);
  // ADM no afecta cuentas de GRUPO: hay que usar su subcuenta hoja.
  if (cat.esGrupo(uid)) {
    throw new ErrorPropuesta(
      `la cuenta '${cod || uid}' (${cat.nombreCuenta(uid)}, línea ${i + 1}) es de GRUPO y ADM no la ` +
        `afecta directamente: usá su subcuenta hoja (pasá cuenta_id en la línea)`,
    );
  }
  return uid;
}

export function armarJournal(
  p: Dic,
  cat: Catalogo,
  trabajoId: string,
  tasaAdmDeMoneda: (m: string) => number,
): ArmadoSimple {
  const lineas: Dic[] = p.lineas ?? [];
  if (!lineas.length) throw new ErrorPropuesta('no hay líneas en la propuesta');
  const fecha = String(p.fecha ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ErrorPropuesta('falta la fecha del documento');

  const accounts: Dic[] = [];
  const cuentas: string[] = [];
  let sumD = 0;
  let sumC = 0;
  lineas.forEach((l, i) => {
    const uid = resolverCuentaLinea(cat, l, i);
    const debito = Number(l.debito ?? 0);
    const credito = Number(l.credito ?? 0);
    sumD += debito;
    sumC += credito;
    cuentas.push(String(l.cuenta ?? ''));
    accounts.push({
      AccountID: uid,
      Debit: debito,
      Credit: credito,
      Notes: String(l.descripcion ?? l.cuenta_nombre ?? '').slice(0, 200),
    });
  });

  // Partida doble ANTES del POST: ADM autoriza asientos descuadrados sin
  // chistar (🪦 PC00000334, del lado de los pagos).
  if (Math.abs(sumD - sumC) > 0.05) {
    throw new ErrorPropuesta(`no cuadra: débitos=${sumD.toFixed(2)} créditos=${sumC.toFixed(2)}`);
  }

  const moneda = String(p.moneda ?? 'DOP').trim().toUpperCase() || 'DOP';
  const tasa = moneda === 'DOP' ? 1.0 : tasaAdmDeMoneda(moneda);
  if (moneda !== 'DOP' && tasa <= 0) throw new ErrorPropuesta(`asiento en ${moneda} sin tasa en ADM`);

  return {
    payload: {
      DocDate: fecha,
      DocType: 'JOURNAL',
      CurrencyID: moneda,
      ExchangeRate: tasa,
      TotalAmount: sumD,
      Reference: referenciaMovimiento(p, trabajoId),
      Notes: String(p.detalle ?? p.descripcion ?? '').slice(0, 500) || null,
      Accounts: accounts,
    },
    referencia: referenciaMovimiento(p, trabajoId),
    avisos: [],
    cuentas,
  };
}

/**
 * ¿Ya existe un Journal que ES éste? Adopción con TRES llaves (enmienda E8):
 * referencia + fecha + monto AL CENTAVO. Dos de tres jamás cierran — la
 * Reference sale de `nro_referencia`, que es un dato tipeado, y el histórico
 * ya lo tiene mal (ED00000181).
 */
export async function adoptarJournal(
  adm: AdmCliente,
  referencia: string,
  fecha: string,
  monto: number,
): Promise<Adopcion | { ambiguo: string } | null> {
  const candidatos = (await adm.paginar('Journals')).filter((d) =>
    String(d?.Reference ?? '').trim() === referencia &&
    String(d?.DocDate ?? '').slice(0, 10) === fecha
  );
  if (!candidatos.length) return null;
  // El listado de Journals no trae TotalAmount: se lee el detalle.
  for (const c of candidatos) {
    const det = await adm.readback('Journals', String(c.ID));
    if (Math.abs(Number(det?.TotalAmount ?? 0) - monto) <= 0.009) {
      return { adoptar: true, docid: String(det.DocID), uuid: String(det.ID) };
    }
  }
  return {
    ambiguo: `hay Journal(s) con la referencia '${referencia}' y la fecha ${fecha} pero OTRO monto ` +
      `(${candidatos.map((c) => c.DocID).join(', ')}): dos de tres llaves nunca cierran (E8) — decide un humano`,
  };
}

export function armarTransferencia(
  p: Dic,
  cat: Catalogo,
  trabajoId: string,
  tasaAdmDeMoneda: (m: string) => number,
): ArmadoSimple & { uuidOrigen: string; uuidDestino: string } {
  // Origen y destino: bloques explícitos o deducidos de las líneas
  // (débito = destino, crédito = origen).
  let codOrigen = String(p.origen?.cuenta ?? '').trim();
  let codDestino = String(p.destino?.cuenta ?? '').trim();
  if (!codOrigen || !codDestino) {
    for (const l of (p.lineas ?? []) as Dic[]) {
      if (Number(l.debito ?? 0) > 0 && !codDestino) codDestino = String(l.cuenta ?? '').trim();
      if (Number(l.credito ?? 0) > 0 && !codOrigen) codOrigen = String(l.cuenta ?? '').trim();
    }
  }
  if (!codOrigen || !codDestino) throw new ErrorPropuesta('no puedo determinar origen/destino de la transferencia');

  const monto = Number(p.monto ?? 0);
  if (monto <= 0) throw new ErrorPropuesta(`monto inválido: ${p.monto}`);
  const fecha = String(p.fecha ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ErrorPropuesta('falta la fecha del documento');

  const uuidOrigen = cat.cuentaUuid(codOrigen);
  const uuidDestino = cat.cuentaUuid(codDestino);
  if (!uuidOrigen) throw new ErrorPropuesta(`no encontré el UUID de la cuenta origen '${codOrigen}'`);
  if (!uuidDestino) throw new ErrorPropuesta(`no encontré el UUID de la cuenta destino '${codDestino}'`);

  const moneda = String(p.moneda ?? 'DOP').trim().toUpperCase() || 'DOP';
  const tasa = moneda === 'DOP' ? 1.0 : tasaAdmDeMoneda(moneda);
  if (moneda !== 'DOP' && tasa <= 0) throw new ErrorPropuesta(`transferencia en ${moneda} sin tasa en ADM`);

  const referencia = referenciaMovimiento(p, trabajoId);
  return {
    payload: {
      DocDate: fecha,
      CashAccountID: uuidOrigen,
      DebitAccountID: uuidDestino,
      TotalAmount: monto,
      ToAmount: monto,
      CurrencyID: moneda,
      ExchangeRate: tasa,
      Notes: String(p.descripcion ?? p.detalle ?? '').slice(0, 500) || null,
      Reference: referencia || null,
    },
    referencia,
    avisos: [],
    cuentas: [codOrigen, codDestino],
    uuidOrigen,
    uuidDestino,
  };
}

/**
 * Gemelos de una transferencia: mismas dos cuentas, mismo monto, mismo día.
 * Con MI referencia → adopción probada. Con huérfanos sin referencia → AMBIGUO
 * (antes esto adoptaba y cerraba SOLO; con dos traspasos gemelos el segundo se
 * comía el número del primero — el CB00000169 del lado de los cargos).
 */
export async function gemelosTransferencia(
  adm: AdmCliente,
  reclamados: Set<string>,
  uuidOrigen: string,
  uuidDestino: string,
  monto: number,
  fecha: string,
  referencia: string,
): Promise<Adopcion | { ambiguo: string } | null> {
  const gemelos = (await adm.paginar('BankBankTransfers')).filter((d) =>
    String(d?.FromCashAccountID ?? '').toLowerCase() === uuidOrigen.toLowerCase() &&
    String(d?.ToCashAccountID ?? '').toLowerCase() === uuidDestino.toLowerCase() &&
    Math.abs(Number(d?.TotalAmount ?? 0) - monto) < 0.01 &&
    String(d?.DocDate ?? '').slice(0, 10) === fecha
  );
  const mio = gemelos.find((d) => String(d?.Reference ?? '').trim() === referencia);
  if (mio) return { adoptar: true, docid: String(mio.DocID), uuid: String(mio.ID) };
  const huerfanos = gemelos.filter((d) => !reclamados.has(String(d?.DocID ?? '')));
  if (huerfanos.length) {
    return {
      ambiguo: `AMBIGUO: en ADM hay ${gemelos.length} traspaso(s) igual(es) a éste y ` +
        `${huerfanos.length} sin dueño (${huerfanos.map((d) => d.DocID).join(', ')}). Ninguno trae ` +
        `esta referencia: no se puede saber si alguno ES este movimiento — decide un humano ` +
        `(si NO es éste, aprobá con forzar_registro).`,
    };
  }
  return null;
}
