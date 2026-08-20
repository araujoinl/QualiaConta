// qualia-registrador/pagos.ts — ports de registrar-pago-factura.py
// (BillPayments, 656 líneas) y registrar-pago-cuenta.py (AccountPayments, 350),
// bloque a bloque. Son los tipos que MUEVEN PLATA: el documento nace pendiente
// y el Authorize es lo que la mueve de verdad — por eso su contrato incluye el
// estado `parcial` (E6): creado sin autorizar no es 'registrada', es deuda
// visible.

import { Catalogo } from '../_shared/catalogo.ts';
import type { AdmCliente } from '../_shared/adm.ts';
import { ErrorPropuesta } from './vendor_bills.ts';

// deno-lint-ignore no-explicit-any
type Dic = Record<string, any>;

// Una diferencia MENOR a esto entre lo que se paga y lo que la factura debe no
// es un abono: es la factura que nació torcida (FP00001102: RD$330.00 cobrados
// contra RD$330.02 facturados — ADM ignora la línea de redondeo, se probó).
const TOPE_REDONDEO = 1.0;

export interface PreparadoPago {
  recurso: 'BillPayments' | 'AccountPayments';
  payload: Dic;
  referencia: string;
  avisos: string[];
  /** Extras que van a registro_adm al cerrar. */
  extraFila: Dic;
  /** El pago exige Authorize después del POST. */
  requiereAuthorize: boolean;
  monto: number;
}

/** El código contable de la cuenta de la que sale la plata, desde el catálogo. */
function cuentaDeCaja(cat: Catalogo, p: Dic, moneda: string): string {
  const numero = String(p.cuenta_numero ?? '').trim();
  const tarjeta = cat.tarjetaPorNumero(numero);
  if (tarjeta) return tarjeta;
  const banco = cat.cuentaBancoPorNumero(numero);
  if (banco) {
    if (banco.moneda !== moneda) {
      throw new ErrorPropuesta(
        `el pago es en ${moneda} y sale de '${p.cuenta_banco}', que en ADM es la cuenta ` +
          `${banco.codigo} en ${banco.moneda}. Pagar cruzando monedas no es un pago, es una ` +
          `conversión: lo decide un humano.`,
      );
    }
    return banco.codigo;
  }
  throw new ErrorPropuesta(
    `no sé de qué cuenta de ADM sale este pago: '${p.cuenta_banco}' (${numero}) no está en el ` +
      `catálogo (cuenta_banco/tarjeta_numero). Si es una cuenta nueva, sembrala en ` +
      `qualia_catalogo_adm.`,
  );
}

/**
 * El UUID del tipo de pago, por NOMBRE contra /api/PaymentTypes (los GUID son
 * de esta instancia, no de un catálogo universal). Ojo: 'Tarjeta de Crédito '
 * viene CON espacio al final — se normaliza antes de comparar.
 */
async function tipoDePago(adm: AdmCliente, esTarjeta: boolean): Promise<string> {
  const quiero = esTarjeta ? 'tarjeta' : 'transferencia';
  for (const t of await adm.paginar('PaymentTypes')) {
    const plano = String(t?.Name ?? t?.Description ?? '').trim().toLowerCase();
    if (plano.includes(quiero)) return String(t.ID);
  }
  throw new ErrorPropuesta(`/api/PaymentTypes no tiene un tipo que contenga '${quiero}'`);
}

/** La factura LEÍDA DE ADM: entre que alguien la miró y ahora pudo anularse o
 * pagarse. El filtro ?DocID= MIENTE (pedir FP00001086 trajo otras dos): UUID
 * directo cuando lo hay, y si no paginar y filtrar ACÁ. */
async function buscarFactura(adm: AdmCliente, docid: string, uuid: string | null): Promise<Dic> {
  if (uuid) {
    try {
      const d = await adm.readback('VendorBills', uuid);
      if (String(d?.DocID ?? '').trim() === docid) return d;
    } catch {
      // cae al paginado
    }
  }
  for (const d of await adm.paginar('VendorBills')) {
    if (String(d?.DocID ?? '').trim() === docid) {
      return await adm.readback('VendorBills', String(d.ID));
    }
  }
  throw new ErrorPropuesta(
    `la factura ${docid} no aparece en ADM. Si se eliminó, hay que rehacer el trabajo; el pago ` +
      `no se registra contra un documento que no existe.`,
  );
}

/** Cuánto se le debe a cada factura según /api/AP — LA ÚNICA fuente que lo
 * sabe (Balance viene NULL en VendorBills y Status no distingue pagada de
 * impaga). La que NO aparece no debe nada: ya se pagó. */
async function saldosPendientes(adm: AdmCliente, docids: string[]): Promise<Map<string, number>> {
  const faltan = new Set(docids.map((d) => d.trim()));
  const saldos = new Map<string, number>();
  for (const x of await adm.paginar('AP')) {
    const docid = String(x?.DocID ?? '').trim();
    if (faltan.has(docid)) saldos.set(docid, Math.round(Number(x?.Balance ?? 0) * 100) / 100);
  }
  return saldos;
}

interface Renglon {
  docid: string;
  uuid: string | null;
  monto: number;
  parcial: boolean;
  adm?: Dic;
  saldo?: number;
}

/** Qué factura cierra este pago y con cuánto (las tres reglas del fuente). */
function renglones(elegidas: Dic[], montoPago: number): Renglon[] {
  if (!elegidas.length) {
    throw new ErrorPropuesta(
      `la propuesta no dice qué factura cierra este pago: asignacion.facturas viene vacía. Un ` +
        `pago sin documento al que aplicarse queda como anticipo, que no es lo que nadie quiso.`,
    );
  }
  const salida: Renglon[] = [];
  let suma = 0;
  elegidas.forEach((e, i) => {
    const docid = String(e.docid ?? '').trim();
    if (!docid) throw new ErrorPropuesta(`la factura #${i + 1} de la propuesta no trae docid`);
    let monto: number;
    if (e.monto == null) {
      if (elegidas.length > 1) {
        // Repartir un monto entre varias facturas es una decisión contable
        // que este código no inventa.
        throw new ErrorPropuesta(
          `el pago cierra ${elegidas.length} facturas pero el renglón de ${docid} no dice cuánto ` +
            `le toca: repartir es una decisión contable, no la invento.`,
        );
      }
      monto = montoPago;
    } else {
      monto = Math.round(Number(e.monto) * 100) / 100;
    }
    suma += monto;
    salida.push({ docid, uuid: e.uuid ? String(e.uuid) : null, monto, parcial: e.parcial === true });
  });
  // LA SUMA ES EXACTAMENTE LO QUE SALIÓ DEL BANCO: si no, el asiento acredita
  // la caja por algo distinto de lo que la caja movió.
  if (Math.abs(Math.round(suma * 100) / 100 - montoPago) > 0.005) {
    throw new ErrorPropuesta(
      `los renglones suman ${suma.toFixed(2)} y del banco salieron ${montoPago.toFixed(2)}: ` +
        `no registro un pago que descuadra la cuenta de banco.`,
    );
  }
  return salida;
}

export async function prepararBillPayment(
  adm: AdmCliente,
  cat: Catalogo,
  p: Dic,
  trabajoId: string,
): Promise<PreparadoPago> {
  const avisos: string[] = [];
  const monto = Math.round(Number(p.monto ?? 0) * 100) / 100;
  if (monto <= 0) throw new ErrorPropuesta('el monto del pago tiene que ser mayor que cero');
  const fecha = String(p.fecha ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ErrorPropuesta('la propuesta no trae una fecha válida');

  const aplica = renglones((p.asignacion?.facturas ?? []) as Dic[], monto);
  // La llave es el banco_tx_id, NO el NCF: el NCF es de la FACTURA, y
  // compartir referencia entre pago y factura los hace indistinguibles.
  const referencia = String(p.banco_tx_id ?? '') || trabajoId;

  for (const r of aplica) {
    r.adm = await buscarFactura(adm, r.docid, r.uuid);
    if (r.adm.Void) {
      throw new ErrorPropuesta(`la factura ${r.docid} está ANULADA en ADM: un pago contra un documento anulado queda colgado de nada.`);
    }
  }

  // Los saldos son TAMBIÉN el chequeo de duplicado: una factura ya pagada no
  // le debe nada a nadie, este pago exista o no.
  const saldos = await saldosPendientes(adm, aplica.map((r) => r.docid));
  for (const r of aplica) {
    if (!saldos.has(r.docid)) {
      throw new ErrorPropuesta(
        `la factura ${r.docid} no tiene saldo abierto en ADM: ya está pagada. Si este movimiento ` +
          `no es el de ese pago, mirá primero cuál la canceló — pagarla de nuevo genera un anticipo.`,
      );
    }
    const saldo = saldos.get(r.docid)!;
    if (saldo <= 0) throw new ErrorPropuesta(`la factura ${r.docid} figura en AP con saldo ${saldo.toFixed(2)}: nada que pagar`);
    r.saldo = saldo;

    // DE MÁS NUNCA: ADM no lo frena y deja un anticipo que nadie pidió.
    if (r.monto - saldo > 0.005) {
      throw new ErrorPropuesta(
        `la factura ${r.docid} debe ${saldo.toFixed(2)} y este pago le aplica ${r.monto.toFixed(2)} ` +
          `(${(r.monto - saldo).toFixed(2)} de más). ADM no lo frena: lo deja como anticipo.`,
      );
    }
    // DE MENOS, SÓLO DECLARADO — y una diferencia de centavos jamás es abono.
    const falta = Math.round((saldo - r.monto) * 100) / 100;
    if (falta > 0.005) {
      if (!r.parcial) {
        throw new ErrorPropuesta(
          `NO CIERRA: ${r.docid} debe ${saldo.toFixed(2)} y este pago le aplica ${r.monto.toFixed(2)} ` +
            `(quedaría abierta por ${falta.toFixed(2)}). Si el abono es a propósito, el renglón lleva ` +
            `"parcial": true; si no, el cruce está mal hecho río arriba.`,
        );
      }
      if (falta < TOPE_REDONDEO) {
        throw new ErrorPropuesta(
          `${r.docid} debe ${saldo.toFixed(2)} y el pago aplica ${r.monto.toFixed(2)}: ` +
            `${falta.toFixed(2)} de diferencia no es un abono, es la factura torcida (caso ` +
            `FP00001102). O se corrige la factura o lo decide un humano.`,
        );
      }
    }
  }

  // UN BillPayments TIENE UN SOLO RelationshipID: con proveedores mezclados,
  // ADM emite el pago al primero y salda las CxP de los otros contra un tercero.
  const proveedores = new Set(aplica.map((r) => String(r.adm!.RelationshipID ?? '')));
  if (proveedores.size > 1) {
    throw new ErrorPropuesta(
      `las facturas de este pago son de proveedores distintos y un pago va a UNO solo: hay que ` +
        `partirlo en un pago por proveedor.`,
    );
  }
  const factura = aplica[0].adm!;
  const proveedorId = factura.RelationshipID;
  if (!proveedorId) throw new ErrorPropuesta(`la factura ${aplica[0].docid} no trae RelationshipID`);

  const moneda = String(p.moneda ?? 'DOP').trim().toUpperCase() || 'DOP';
  const codigoCaja = cuentaDeCaja(cat, p, moneda);
  const cajaUuid = cat.cuentaUuid(codigoCaja);
  if (!cajaUuid) throw new ErrorPropuesta(`la cuenta de caja ${codigoCaja} no existe en /api/Accounts`);
  const esTarjeta = cat.tarjetaPorNumero(String(p.cuenta_numero ?? '').trim()) !== null;
  const tipoPago = await tipoDePago(adm, esTarjeta);

  const payload: Dic = {
    DocDate: fecha,
    CashAccountID: cajaUuid,
    PaymentTypeID: tipoPago,
    RelationshipID: proveedorId,
    CurrencyID: moneda,
    ExchangeRate: moneda === 'DOP' ? 1.0 : Number(factura.ExchangeRate ?? 1.0),
    Reference: referencia,
    Beneficiary: String(factura.RelationshipName ?? p.asignacion?.proveedor ?? ''),
    Notes: `Pago de ${aplica.map((r) => r.docid).join(', ')} con ${p.cuenta_banco ?? 'tarjeta'}. ${p.descripcion ?? ''}`.trim(),
    // Sin Accounts[]: el asiento lo deriva ADM de la caja y de la CxP de la
    // factura. Mandar líneas acá sería volver a clasificar lo ya clasificado.
    Documents: aplica.map((r) => ({
      DocumentID: r.adm!.ID,
      DocID: r.docid,
      Amount: r.monto,
      TotalAmount: Math.round(Number(r.adm!.TotalAmount ?? r.monto) * 100) / 100,
      // La tasa del RENGLÓN: ADM la valida contra la de la FACTURA, no contra
      // la cabecera («la tasa de cambio indicada… debe ser igual a la del
      // documento», probado 2026-08-05).
      ExchangeRate: Number(r.adm!.ExchangeRate ?? 1.0),
    })),
  };

  for (const r of aplica) {
    if (r.parcial && r.saldo! - r.monto > 0.005) {
      avisos.push(`${r.docid} queda ABIERTA por ${(r.saldo! - r.monto).toFixed(2)} — es un abono, no un cierre`);
    }
  }

  return {
    recurso: 'BillPayments',
    payload,
    referencia,
    avisos,
    extraFila: {
      factura: aplica[0].docid,
      facturas: aplica.map((r) => ({ docid: r.docid, monto: r.monto, parcial: r.parcial })),
    },
    requiereAuthorize: true,
    monto,
  };
}

export async function prepararAccountPayment(
  adm: AdmCliente,
  cat: Catalogo,
  p: Dic,
  trabajoId: string,
): Promise<PreparadoPago> {
  const monto = Math.round(Number(p.monto ?? 0) * 100) / 100;
  if (monto <= 0) throw new ErrorPropuesta('el monto del pago tiene que ser mayor que cero');
  const fecha = String(p.fecha ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ErrorPropuesta('la propuesta no trae una fecha válida');
  const lineas: Dic[] = p.lineas ?? [];
  if (!lineas.length) throw new ErrorPropuesta('no hay líneas en la propuesta');

  // La cuenta del banco: por número contra el catálogo, o la línea de caja.
  const moneda = String(p.moneda ?? 'DOP').trim().toUpperCase() || 'DOP';
  let bancoUuid: string | null = null;
  const numero = String(p.cuenta_numero ?? '').trim();
  if (numero) {
    const banco = cat.cuentaBancoPorNumero(numero);
    if (banco) bancoUuid = cat.cuentaUuid(banco.codigo);
  }
  if (!bancoUuid) {
    const lineaCaja = lineas.find((l) => cat.esCuentaCaja(String(l.cuenta ?? '')));
    if (lineaCaja) bancoUuid = cat.cuentaUuid(String(lineaCaja.cuenta ?? '').trim());
  }
  if (!bancoUuid) throw new ErrorPropuesta('no encontré la cuenta de banco del pago (ni por número ni en las líneas)');

  const accounts: Dic[] = [];
  const items: Dic[] = [];
  let sumD = 0;
  let sumC = 0;
  lineas.forEach((l, i) => {
    const cod = String(l.cuenta ?? '').trim();
    const cuentaId = String(l.cuenta_id ?? '').trim();
    let uid: string | null = /^[0-9a-f-]{36}$/.test(cuentaId) ? cuentaId : cat.cuentaUuid(cod);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(cod)) uid = cod;
    if (!uid) throw new ErrorPropuesta(`no encontré el UUID de la cuenta '${cod}' (línea ${i + 1})`);
    if (cat.esGrupo(uid)) {
      throw new ErrorPropuesta(`la cuenta '${cod || uid}' (línea ${i + 1}) es de GRUPO: usá su subcuenta hoja`);
    }
    const debito = Number(l.debito ?? 0);
    const credito = Number(l.credito ?? 0);
    sumD += debito;
    sumC += credito;
    accounts.push({
      AccountID: uid,
      Debit: debito,
      Credit: credito,
      ExchangeRate: 1.0,
      Notes: String(l.descripcion ?? l.cuenta_nombre ?? '').slice(0, 200),
    });
    // EL MONTO VIAJA EN Items[] (🪦 PC00000376: sin Price el documento nace
    // con Total 0 y VACÍO; ADM ignora el Accounts[] y deriva de los Items).
    // ExchangeRate es requerido («la tasa de 0 no está permitida»).
    // RelationshipID = auxiliar_id para cuentas control con auxiliar (CxP) —
    // 🪦 PC00000377, el mayor del proveedor sin auxiliar.
    if (uid !== bancoUuid) {
      const item: Dic = {
        AccountID: uid,
        Price: debito > 0 ? debito : credito,
        Quantity: 1.0,
        ExchangeRate: 1.0,
        RowType: 0,
        Notes: String(l.descripcion ?? l.cuenta_nombre ?? '').slice(0, 200),
      };
      const aux = String(l.auxiliar_id ?? '').trim();
      if (aux) {
        if (!/^[0-9a-f-]{36}$/.test(aux)) throw new ErrorPropuesta(`auxiliar_id inválido en la línea ${i + 1}`);
        item.RelationshipID = aux;
      }
      items.push(item);
    }
  });

  if (Math.abs(sumD - sumC) > 0.005) throw new ErrorPropuesta(`no cuadra: débitos=${sumD.toFixed(2)} créditos=${sumC.toFixed(2)}`);
  if (Math.abs(sumD - monto) > 0.005) {
    throw new ErrorPropuesta(`las líneas (${sumD.toFixed(2)}) no cuadran con el monto del pago (${monto.toFixed(2)})`);
  }

  const referencia = String(p.nro_referencia ?? '') || String(p.banco_tx_id ?? '') || trabajoId;
  const esTarjeta = cat.tarjetaPorNumero(numero) !== null;

  return {
    recurso: 'AccountPayments',
    payload: {
      DocDate: fecha,
      CashAccountID: bancoUuid,
      PaymentTypeID: await tipoDePago(adm, esTarjeta),
      CurrencyID: moneda,
      ExchangeRate: moneda === 'DOP' ? 1.0 : Number(p.tasa ?? p.tasa_usd ?? 1.0),
      Reference: referencia,
      Beneficiary: String(p.beneficiario ?? p.proveedor ?? '').slice(0, 200),
      Notes: String(p.detalle ?? p.descripcion ?? '').slice(0, 500) || null,
      TotalAmount: monto,
      Accounts: accounts,
      Items: items,
    },
    referencia,
    avisos: [],
    extraFila: {},
    requiereAuthorize: true,
    monto,
  };
}

/** Duplicado de pagos: la referencia es la ÚNICA prueba (dos pagos del mismo
 * día y monto NO son duplicado: se pagan dos facturas gemelas). */
export async function verificarDuplicadoPago(
  adm: AdmCliente,
  recurso: 'BillPayments' | 'AccountPayments',
  referencia: string,
): Promise<void> {
  for (const d of await adm.paginar(recurso)) {
    if (!d?.Void && String(d?.Reference ?? '').trim() === referencia) {
      throw new ErrorPropuesta(`YA REGISTRADO: ${d.DocID} trae la referencia de este movimiento (${referencia})`);
    }
  }
}

/**
 * El Authorize (PUT; con POST da 405) y su verificación por COMPORTAMIENTO:
 * se relee OnlyPendingAuthorize en vez de creerle al success (esta API ya
 * devolvió true sobre cosas que no hizo). Devuelve true si quedó PENDIENTE.
 */
export async function autorizarPago(
  adm: AdmCliente,
  recurso: 'BillPayments' | 'AccountPayments',
  guid: string,
  docid: string,
): Promise<{ pendiente: boolean; aviso?: string }> {
  const siguePendiente = async (): Promise<boolean> => {
    let skip = 0;
    for (let pagina = 0; pagina < 10; pagina++) {
      const d = await adm.get(recurso, { OnlyPendingAuthorize: 'true', skip });
      let lote = d.data ?? [];
      if (!Array.isArray(lote)) lote = Array.isArray(lote?.Item1) ? lote.Item1 : [lote];
      // deno-lint-ignore no-explicit-any
      if ((lote as any[]).some((x) => String(x?.DocID ?? '').trim() === docid)) return true;
      if (lote.length < 50) break;
      skip += lote.length;
    }
    return false;
  };

  if (!(await siguePendiente())) return { pendiente: false };

  const r = await adm.llamar('PUT', `${recurso}/Authorize`, undefined, { id: guid });
  if (String(r.message ?? '').trim().toLowerCase() === 'unauthorized') {
    return {
      pendiente: true,
      aviso: `${docid} quedó PENDIENTE DE AUTORIZACIÓN: el rol puede crear pagos pero no ` +
        `autorizarlos. El documento existe y NO movió plata: autorizalo a mano en ADM.`,
    };
  }
  if (await siguePendiente()) {
    return {
      pendiente: true,
      aviso: `pedí autorizar ${docid} y ADM contestó '${r.message ?? 'ok'}', pero sigue pendiente. ` +
        `NO movió plata: revisalo a mano.`,
    };
  }
  return { pendiente: false };
}
