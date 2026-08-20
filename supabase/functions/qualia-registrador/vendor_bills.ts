// qualia-registrador/vendor_bills.ts — port de registrar-en-adm.py (929 líneas),
// bloque a bloque y con cada lápida en su comentario (regla del port, F4 §2.1):
// un port que pierde el comentario pierde la guarda en el próximo refactor.
//
// Este archivo es PURO: propuesta + catálogo (+ tasa de ADM precargada) →
// payload listo o ErrorPropuesta. El IO (duplicados, proveedor, POST,
// readback) vive en el orquestador. Puro a propósito: el backtest lo corre
// contra el histórico sin tocar la red.

import { Catalogo } from '../_shared/catalogo.ts';
import { cuadrarItems, netoLinea, r2, totalSegunAdm } from '../_shared/cuadre.ts';
import type { ItemCuadre } from '../_shared/cuadre.ts';

/** El «morir» del script: mensaje para el humano; la fila espera respuesta. */
export class ErrorPropuesta extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ErrorPropuesta';
  }
}

// deno-lint-ignore no-explicit-any
type Dic = Record<string, any>;

export interface ArmadoVendorBill {
  recurso: 'VendorBills' | 'VendorCreditNotes';
  payload: Dic;
  avisos: string[];
  /** RNC en dígitos para resolver el proveedor (vacío = camino SIN_RNC). */
  rnc: string;
}

export function soloDigitos(x: unknown): string {
  return String(x ?? '').replace(/\D/g, '');
}

/**
 * La nota de crédito se decide por el NCF (E34), no por `documento_adm`: el
 * campo lo escribe el modelo y el NCF es un hecho fiscal (NC de Claro,
 * 2026-08-07: el modelo escribió «VendorBills» y mandó los montos en negativo).
 */
export function esNotaCredito(p: Dic): boolean {
  return String(p.ncf ?? '').trim().toUpperCase().startsWith('E34');
}

/**
 * Se endereza UNA vez y en la puerta: con el total en negativo el cuadre corta
 * por objetivo<=0 EN SILENCIO y el verificador compara contra un monto que no
 * es el del papel. Signos MEZCLADOS mueren: una nota con dos líneas negativas
 * y una positiva no es algo que abs() pueda arreglar — es una lectura a
 * medias, y aplanarla inventaría plata. `descuento` se endereza igual que
 * precio/itbis: una NC capturada toda en negativo trae -10 ahí.
 */
export function normalizarNotaCredito(p: Dic): Dic {
  const montos = (p.lineas ?? []).map((l: Dic) => Number(l?.precio ?? 0)).filter((m: number) => m !== 0);
  const signos = new Set(montos.map((m: number) => (m > 0 ? 1 : -1)));
  if (signos.size > 1) {
    throw new ErrorPropuesta(
      `la nota de crédito trae los precios con signos MEZCLADOS (${montos.join(', ')}). ` +
        `No la enderezo: eso inventaría plata. Volvé al documento y capturala entera con un solo signo.`,
    );
  }
  return {
    ...p,
    monto: Math.abs(Number(p.monto ?? 0)),
    itbis: Math.abs(Number(p.itbis ?? 0)),
    lineas: (p.lineas ?? []).map((l: Dic) => ({
      ...l,
      precio: Math.abs(Number(l?.precio ?? 0)),
      itbis: Math.abs(Number(l?.itbis ?? 0)),
      descuento: Math.abs(Number(l?.descuento ?? 0)),
    })),
  };
}

/**
 * (TaxScheduleID, TaxPercent) de una línea. itbis<=0 → exenta (el <=0 es a
 * propósito: acá abajo un negativo ya no es nota de crédito — es una línea mal
 * capturada, y tratarla exenta es el degradado correcto). La base es la
 * DESCONTADA: el ITBIS del papel se cobra sobre el neto (FP00001122: 600 al
 * 10% → 97.20 = 18% de 540). Gana el schedule MÁS CERCANO dentro de 1 punto.
 */
function resolverTasaLinea(
  cat: Catalogo,
  itbis: number,
  cantidad: number,
  precio: number,
  descuento: number,
): { schedId: string | null; pct: number } {
  if (itbis <= 0) return { schedId: null, pct: 0 };
  const base = (cantidad || 1) * (precio || 0) * (1 - (descuento || 0) / 100);
  if (base <= 0) return { schedId: null, pct: 0 };
  const tasa = Math.round((itbis / base) * 1000) / 10;
  const sched = cat.taxPorTasa(tasa);
  if (sched) return { schedId: sched.id, pct: sched.pct };
  throw new ErrorPropuesta(
    `la línea (base ${base.toFixed(2)}, itbis ${itbis.toFixed(2)}, tasa ${tasa.toFixed(1)}%) ` +
      `no calza con ningún schedule conocido (${cat.tasasLegales.join('%, ')}%). Revisar el documento.`,
  );
}

/**
 * UUID del tipo de gasto del 606. `adm_id` si la propuesta lo trae; si no el
 * código 01-11 contra el catálogo; sin tipo → default 02. Con tipo que no
 * resuelve → morir: el default callado que PISA lo propuesto mandó 22
 * facturas al 02 (caso FP00001130, 2026-08-20).
 */
function tipoGastoId(cat: Catalogo, tg: Dic | null | undefined): string {
  if (!tg) return cat.tipoGastoDefecto;
  if (tg.adm_id) return String(tg.adm_id);
  const t = cat.expenseType(String(tg.codigo ?? ''));
  if (!t) {
    throw new ErrorPropuesta(
      `tipo_gasto con código '${tg.codigo}' que no resuelve contra el catálogo 606 de la empresa. ` +
        `No lo degrado al 02: corregí la propuesta o sembrá el catálogo.`,
    );
  }
  return t.id;
}

/**
 * Qué base y qué exento harían falta, en cada tasa legal, para que la cabecera
 * cierre. Con total e ITBIS hay dos incógnitas y una ecuación: TODAS las tasas
 * producen una lectura que suma bien; la única de verdad es la que no necesita
 * un renglón exento que nadie leyó.
 */
function lecturasPosibles(cat: Catalogo, itbisPapel: number, totalPapel: number): [number, number, number][] {
  const posibles: [number, number, number][] = [];
  for (const t of [...cat.tasasLegales].sort((a, b) => a - b)) {
    const base = itbisPapel / (t / 100);
    const exento = totalPapel - itbisPapel - base;
    if (exento < -0.05) continue; // la base sola pasaría el total: imposible
    posibles.push([t, Math.round(base * 100) / 100, Math.round(exento * 100) / 100]);
  }
  return posibles.sort((a, b) => Math.abs(a[2]) - Math.abs(b[2]));
}

/**
 * El cuadre predictivo pre-POST (🪦 FP00001063: papel 4,520.47/ITBIS 575.72,
 * ADM cobró 645.51 → 69.79 de más; después del POST la única salida es
 * borrar). Renglón por renglón, medio hacia arriba, con LA MISMA
 * implementación del cuadre (netoLinea en exacto — una segunda fórmula en
 * float diverge un centavo en fronteras .xx5).
 */
function verificarCuadre(cat: Catalogo, p: Dic, items: ItemCuadre[]): void {
  let itbisAdm = 0;
  let baseGravada = 0;
  let exento = 0;
  for (const item of items) {
    const neto = Number(netoLinea(item));
    if (item.TaxScheduleID) {
      baseGravada += neto;
      itbisAdm += Number(r2(neto * (item.TaxPercent ?? 0) / 100));
    } else {
      exento += neto;
    }
  }
  itbisAdm = Math.round(itbisAdm * 100) / 100;
  const totalAdm = Math.round((baseGravada + exento + itbisAdm) * 100) / 100;

  const itbisPapel = Math.round(Number(p.itbis ?? 0) * 100) / 100;
  const totalPapel = Math.round(Number(p.monto ?? 0) * 100) / 100;

  if (Math.abs(itbisAdm - itbisPapel) > 0.05 || Math.abs(totalAdm - totalPapel) > 0.05) {
    throw new ErrorPropuesta(
      `NO CUADRA con el documento, no registro:\n` +
        `  el papel dice   total ${totalPapel.toFixed(2)}  ITBIS ${itbisPapel.toFixed(2)}\n` +
        `  ADM cobraría    total ${totalAdm.toFixed(2)}  ITBIS ${itbisAdm.toFixed(2)} (sobre ${baseGravada.toFixed(2)} de base)\n` +
        `Alguna línea tiene el precio o el grupo de impuesto mal leído, o el documento trae un ` +
        `descuento que no se capturó. Corregí las líneas o preguntale al humano.`,
    );
  }

  // Que sume es NECESARIO pero no suficiente (🪦 FP00001120, Carrefour, café:
  // al 18% sobraban 35.90 de exentos inventados; al 16% del art. 343 la
  // cabecera cerraba SOLA). Sólo corre con UNA tasa en juego.
  const usadas = new Set(items.filter((i) => i.TaxScheduleID).map((i) => i.TaxPercent ?? 0));
  if (exento > 0.05 && usadas.size === 1) {
    const propia = [...usadas][0];
    const limpias = lecturasPosibles(cat, itbisPapel, totalPapel)
      .filter(([t, , e]) => Math.abs(e) <= 0.05 && Math.abs(t - propia) > 0.5);
    if (limpias.length) {
      const [tOk, baseOk] = limpias[0];
      throw new ErrorPropuesta(
        `CUADRA PERO LA TASA NO SE SOSTIENE, no registro: esta propuesta cobra ITBIS ${propia}% ` +
          `sobre ${baseGravada.toFixed(2)} de base y manda ${exento.toFixed(2)} a renglones exentos. ` +
          `Al ${tOk}% la misma cabecera cierra SOLA (base ${baseOk.toFixed(2)}, exentos 0.00). ` +
          `Un exento que sale de la resta y no del papel es la firma de una tasa mal asumida — ` +
          `casi siempre la reducida del art. 343 (café, cacao, azúcar, mantequilla, yogurt). ` +
          `Volvé al documento, mirá qué tasa dice impresa, y corregí las líneas.`,
      );
    }
  }
}

/**
 * El armado completo. `tasaAdmDeMoneda` viene precargada por el caller (de
 * /api/Currencies) para que este módulo quede puro; `relationshipId` y
 * `paymentTermId` los resuelve el orquestador (proveedor por RNC exacto).
 */
export function armarVendorBill(
  propuesta: Dic,
  cat: Catalogo,
  opciones: {
    relationshipId: string | null;
    paymentTermId: string | null;
    invoiceId?: string | null;
    tasaAdmDeMoneda: (moneda: string) => number;
  },
): ArmadoVendorBill {
  const avisos: string[] = [];
  const recurso = esNotaCredito(propuesta) ? 'VendorCreditNotes' : 'VendorBills';
  const p = recurso === 'VendorCreditNotes' ? normalizarNotaCredito(propuesta) : propuesta;

  const lineas: Dic[] = p.lineas ?? [];
  if (!lineas.length) throw new ErrorPropuesta('la propuesta no trae líneas');

  // La fecha del documento ES la de emisión del NCF. Si DGII verificó, su
  // fecha es dato duro (FP00001130: 25-jun por 1-jul, corregida a mano ya
  // pagada). DGII la devuelve dd-mm-aaaa; la propuesta va en ISO.
  const fDgii = String(p.dgii?.fecha_emision ?? p.dgii?.fecha ?? '').trim();
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(fDgii.slice(0, 10));
  const fDgiiIso = m ? `${m[3]}-${m[2]}-${m[1]}` : (/^\d{4}-\d{2}-\d{2}/.test(fDgii) ? fDgii.slice(0, 10) : '');
  if (fDgiiIso && String(p.fecha ?? '').slice(0, 10) !== fDgiiIso) {
    throw new ErrorPropuesta(
      `la fecha de la propuesta (${p.fecha}) no es la de emisión del NCF según DGII (${fDgiiIso}). ` +
        `La fecha del documento ES la de emisión impresa — ni la del período, ni la del pago.`,
    );
  }

  // Los renglones, con descuento como descuento (no aplastado en el precio:
  // la FP00001065 salió 540 pelado siendo 600 al 10% y la contable la
  // corrigió a mano).
  const items: (ItemCuadre & Dic)[] = [];
  lineas.forEach((l, i) => {
    const descuento = Number(l.descuento ?? 0);
    if (!(descuento >= 0 && descuento < 100)) {
      throw new ErrorPropuesta(
        `la línea ${i + 1} trae descuento ${l.descuento}%: se espera el PORCENTAJE (0-99.99), no el monto descontado`,
      );
    }
    const { schedId, pct } = resolverTasaLinea(
      cat,
      Number(l.itbis ?? 0),
      Number(l.cantidad ?? 1),
      Number(l.precio ?? 0),
      descuento,
    );
    items.push({
      RowOrder: i + 1,
      RowType: 0,
      Name: String(l.descripcion ?? '').slice(0, 200),
      Quantity: Number(l.cantidad ?? 1),
      Price: Number(l.precio ?? 0),
      Cost: 0.0,
      DiscountPercent: descuento,
      ExchangeRate: 0.0,
      AccountID: l.account_id ?? l.cuenta_id ?? cat.cuentaUuid(String(l.cuenta ?? '')),
      // El monto del ITBIS NO se manda: el server lo calcula del grupo.
      TaxScheduleID: schedId,
      TaxPercent: pct,
    });
  });
  const sinCuenta = items
    .map((it, j) => (!it.AccountID ? `(${it.Name}, ${lineas[j]?.cuenta})` : null))
    .filter(Boolean);
  if (sinCuenta.length) {
    throw new ErrorPropuesta(
      `no encontré en ADM la cuenta de estas líneas: ${sinCuenta.join(' ')}. Si el código está ` +
        `bien escrito, esa cuenta no existe o está inactiva en el catálogo: preguntale al humano.`,
    );
  }

  // Elegir el precio para que la cuenta de ADM caiga en el total del papel
  // (13 de 63 facturas lo necesitaban al 2026-08-05; el centavo va al 606).
  const { items: ajustados, ajuste } = cuadrarItems(items, Number(p.monto ?? 0));
  if (ajuste) {
    avisos.push(
      `cuadre: renglón ${ajuste.renglon + 1}, precio ${ajuste.antes} → ${ajuste.despues} ` +
        `(${ajuste.movido} en el total) para que ADM llegue al total del papel`,
    );
  }

  // La tasa de cambio NUNCA es 1 en moneda extranjera (FP00001118: US$2,306
  // asentados como RD$2,306). Papel (`tasa_usd`) → tasa de ADM con aviso →
  // morir. Y piso de plausibilidad: `tasa_usd: 1` es el mismo bug disfrazado.
  const moneda = String(p.moneda ?? 'DOP').trim().toUpperCase() || 'DOP';
  let tasa = 1.0;
  if (moneda !== 'DOP') {
    tasa = Number(p.tasa_usd ?? 0);
    if (tasa <= 0) {
      tasa = opciones.tasaAdmDeMoneda(moneda);
      if (tasa <= 0) {
        throw new ErrorPropuesta(
          `la factura está en ${moneda} y no hay tasa: la propuesta no trae tasa_usd (la impresa ` +
            `en el papel) y ADM no tiene la moneda configurada. No registro así.`,
        );
      }
      avisos.push(`tasa: la propuesta no trae tasa_usd; va la de ADM (${tasa.toFixed(4)})`);
    }
    if (tasa < 5) {
      throw new ErrorPropuesta(
        `tasa ${tasa.toFixed(4)} para ${moneda} no es plausible (parece el 1.0 del bug FP00001118 ` +
          `o un placeholder). La tasa real está impresa en el papel; corregí tasa_usd.`,
      );
    }
  }

  const payload: Dic = {
    DocDate: p.fecha,
    Reference: p.numero_factura_suplidor ?? p.ncf ?? null,
    NCF: p.ncf ?? null,
    RelationshipID: opciones.relationshipId,
    // None y no "" cuando no hay RNC: así quedó la FP00001133 (SIN_RNC), la
    // única evidencia de que ADM acepta el documento. Vacío y ausente no son
    // lo mismo.
    FiscalID: soloDigitos(p.rnc) || null,
    Beneficiary: String(p.proveedor ?? '').slice(0, 120),
    CurrencyID: moneda,
    ExchangeRate: tasa,
    // Obligatorio aunque el esquema lo marque opcional: omitirlo devuelve
    // «Este término de pago no existe». Se hereda del proveedor.
    PaymentTermID: opciones.paymentTermId ?? cat.terminoContado,
    ExpenseTypeID: tipoGastoId(cat, p.tipo_gasto),
    Items: ajustados,
  };

  if (recurso === 'VendorCreditNotes') {
    // Leído de las dos NCP registradas, no supuesto: PaymentTermID null en
    // las dos (ni existe en el swagger AP); InvoiceID deja el rastro
    // nota→factura.
    delete payload.PaymentTermID;
    if (opciones.invoiceId) payload.InvoiceID = opciones.invoiceId;
  }

  // ADM frena duplicados por DOS claves independientes: el NCF y la
  // referencia. Sin NINGUNA, la misma plata entra dos veces callada (las
  // 1,120 facturas del histórico traen una u otra; el Estado no emite NCF).
  if (!String(payload.NCF ?? '').trim() && !String(payload.Reference ?? '').trim()) {
    throw new ErrorPropuesta(
      `el documento no trae NCF ni referencia, y ésas son las DOS claves con las que ADM frena ` +
        `un duplicado. Ponele la referencia del papel — en una liquidación de aduana, el número ` +
        `de DUA — y volvé a intentar.`,
    );
  }

  verificarCuadre(cat, p, ajustados);

  return { recurso, payload, avisos, rnc: soloDigitos(p.rnc) };
}

/** Lo que ADM va a guardar como total para este payload (para el ledger). */
export function totalPredicho(payload: Dic): number {
  return Number(totalSegunAdm(payload.Items ?? []));
}
