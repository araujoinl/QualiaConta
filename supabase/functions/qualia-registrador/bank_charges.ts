// qualia-registrador/bank_charges.ts — port de registrar-cargo-bancario.py
// (527 líneas), bloque a bloque con sus lápidas. PURO como vendor_bills.ts:
// propuesta + catálogo → payload o ErrorPropuesta; el IO (doble pregunta de
// duplicado, POST, readback, adjunto) vive en el orquestador.

import { Catalogo } from '../_shared/catalogo.ts';
import { ErrorPropuesta, soloDigitos } from './vendor_bills.ts';

// deno-lint-ignore no-explicit-any
type Dic = Record<string, any>;

export interface ArmadoCargo {
  payload: Dic;
  avisos: string[];
  /** La llave que ata ESTE documento a ESTE cargo (NCF > banco_tx_id > trabajo). */
  referencia: string;
  direccion: 'cargo' | 'credito';
}

/**
 * Referencia = NCF > banco_tx_id > trabajo_id. Con comprobante la llave es
 * única por empresa y ADEMÁS protege (ADM frena duplicados por NCF); sin
 * comprobante, dos comisiones iguales del mismo día son indistinguibles en
 * ADM y la llave es el movimiento del banco.
 */
export function referenciaDe(p: Dic, trabajoId: string): string {
  return String(p.ncf ?? '') || String(p.banco_tx_id ?? '') || trabajoId;
}

export function armarCargo(
  propuesta: Dic,
  cat: Catalogo,
  trabajoId: string,
  tasaAdmDeMoneda: (moneda: string) => number,
): ArmadoCargo {
  const avisos: string[] = [];
  const p = propuesta;
  const lineas: Dic[] = p.lineas ?? [];
  if (!lineas.length) throw new ErrorPropuesta('la propuesta no trae líneas');

  const direccion = (String(p.direccion ?? 'credito') === 'cargo' ? 'cargo' : 'credito') as
    | 'cargo'
    | 'credito';
  const ncf = String(p.ncf ?? '').trim() || null;

  // La línea del banco (CashAccountID): la cuenta de caja — 101/102 o una
  // tarjeta ENUMERADA del catálogo (los 9 «AHORRO POR COMPRA» del histórico
  // son cargos con la tarjeta en CashAccountID; 203.xx entero NO, porque
  // 203.xx es Cuentas por Pagar y tomar el prefijo haría pasar por banco la
  // línea de un proveedor).
  const bancoIdx = lineas.findIndex((l) => cat.esCuentaCaja(String(l?.cuenta ?? '')));
  if (bancoIdx < 0) {
    throw new ErrorPropuesta(
      'no encontré la cuenta de caja (101.xx/102.xx o una tarjeta del catálogo) en las líneas — ' +
        'si es una cuenta nueva, agregala al catálogo de la empresa',
    );
  }
  const bancoCod = String(lineas[bancoIdx].cuenta ?? '').trim();
  const bancoUuid = cat.cuentaUuid(bancoCod);
  if (!bancoUuid) throw new ErrorPropuesta(`no encontré el UUID de la cuenta de banco '${bancoCod}' en ADM`);

  // Las demás líneas van en Accounts[] (contrapartida).
  const accounts: Dic[] = [];
  lineas.forEach((l, i) => {
    if (i === bancoIdx) return; // el banco va en CashAccountID, no en Accounts[]
    const cod = String(l.cuenta ?? '').trim();
    const uid = cat.cuentaUuid(cod);
    if (!uid) throw new ErrorPropuesta(`no encontré el UUID de la cuenta '${cod}' (línea ${i + 1})`);
    const debito = Number(l.debito ?? 0);
    const credito = Number(l.credito ?? 0);
    accounts.push({
      RowOrder: accounts.length,
      RowType: 0,
      AccountID: uid,
      Debit: debito,
      Credit: credito,
      NetAmount: credito - debito,
      Quantity: 0.0,
      ExchangeRate: 0.0,
      LocalAmount: 0.0,
      NetLocalAmount: 0.0,
      Reference: null,
      ProjectID: null,
      DivisionID: null,
      LocationID: null,
      ClassID: null,
      DepartmentID: null,
      FixedAssetID: null,
      RelationshipID: null,
      IsHidden: false,
      Conciliated: false,
      ExpenseCategoryID: null,
      ItemID: null,
      TaxID: null,
      Notes: String(l.descripcion ?? l.cuenta_nombre ?? '').slice(0, 200),
    });
  });
  if (!accounts.length) throw new ErrorPropuesta('no hay líneas de contrapartida (¿todas eran el banco?)');

  const monto = Number(p.monto ?? 0);
  const totalAmount = direccion === 'credito' ? -Math.abs(monto) : Math.abs(monto);

  // Con comprobante manda LA TASA DEL BANCO, no la configurada en ADM: es la
  // que el banco usó para facturar (US$60 → RD$3,477.17 = 57.9528) y la única
  // con la que el monto fiscal del NCF reconstruye. La de ADM es una tasa de
  // sistema y daría otro número en el 606.
  const moneda = String(p.moneda ?? 'DOP').trim().toUpperCase() || 'DOP';
  let tasa = 1.0;
  if (moneda !== 'DOP') {
    tasa = Number(p.tasa_usd ?? 0);
    if (tasa <= 0) {
      tasa = tasaAdmDeMoneda(moneda);
      if (tasa <= 0) throw new ErrorPropuesta(`cargo en ${moneda} sin tasa (ni tasa_usd ni ADM)`);
      avisos.push(`tasa: va la de ADM (${tasa.toFixed(4)}); si el papel imprime otra, corregí la propuesta`);
    }
    if (tasa < 5) {
      throw new ErrorPropuesta(`tasa ${tasa.toFixed(4)} para ${moneda} no es plausible (¿el 1.0 del bug?)`);
    }
  }

  // Partida doble antes del POST.
  const sumD = accounts.reduce((s, a) => s + a.Debit, 0);
  const sumC = accounts.reduce((s, a) => s + a.Credit, 0);
  const dif = direccion === 'credito' ? sumC - sumD - monto : sumD - sumC - monto;
  if (Math.abs(dif) > 0.05) {
    throw new ErrorPropuesta(
      `no cuadra: contrapartida da ${(sumC - sumD).toFixed(2)}, monto banco ${monto.toFixed(2)}, ` +
        `dif ${dif.toFixed(4)}`,
    );
  }

  const referencia = referenciaDe(p, trabajoId);

  const payload: Dic = {
    DocDate: p.fecha,
    DocType: 'BANK_TRA',
    CashAccountID: bancoUuid,
    CurrencyID: moneda,
    ExchangeRate: tasa,
    TotalAmount: totalAmount,
    // La llave propia del documento: los 166 cargos históricos la tienen en
    // null porque nadie la mandaba; desde el script va siempre, y el readback
    // dice si ADM la persiste.
    Reference: referencia,
    Notes: String(p.descripcion ?? p.resumen ?? '').slice(0, 500) || null,
    Accounts: accounts,
  };

  // El comprobante fiscal del banco: soporta el gasto ante DGII y decide la
  // cuenta (con NCF → 640.01 + tipo de gasto 07; sin NCF → 801.01 sin tipo,
  // como los 159 cargos de la contable). Y el RNC del emisor SIEMPRE con NCF:
  // sin él la línea del 606 sale sin emisor (los 16 CB de agosto 2026 que la
  // contable corrigió a mano).
  if (ncf) {
    payload.NCF = ncf;
    const t07 = cat.expenseType('07');
    if (!t07) throw new ErrorPropuesta('el catálogo no tiene el tipo de gasto 07 Gastos Financieros');
    payload.ExpenseTypeID = t07.id;

    let rnc = soloDigitos(p.rnc);
    if (rnc.length !== 9 && rnc.length !== 11) {
      rnc = cat.bancoRnc(String(p.banco ?? '')) ?? '';
    }
    if (!rnc) {
      throw new ErrorPropuesta(
        `el cargo trae NCF ${ncf} pero no pude resolver el RNC del banco emisor (propuesta sin ` +
          `rnc y banco '${p.banco}' fuera del catálogo banco_rnc). No registro un comprobante sin emisor.`,
      );
    }
    payload.FiscalID = rnc;
  }

  return { payload, avisos, referencia, direccion };
}
