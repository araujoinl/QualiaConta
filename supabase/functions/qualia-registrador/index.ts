// qualia-registrador — la pieza que ESCRIBE en ADM Cloud (plan-f4, plan corto
// aprobado por Carlos el 2026-08-20: encender apenas el backtest en seco
// pruebe que el port produce lo mismo que el server).
//
// HOY este archivo sirve la acción `backtest`: rearma el payload de cada
// trabajo YA registrado por el server usando los ports puros (vendor_bills,
// bank_charges) y lo compara campo por campo contra el documento REAL en ADM.
// CERO escrituras: puro GET. La acción `registrar` llega con el cutover y
// nace detrás del kill-switch (`escritura` = off por default).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { sb } from '../_shared/db.ts';
import { autorizado } from '../_shared/auth.ts';
import { AdmCliente } from '../_shared/adm.ts';
import type { CredAdm } from '../_shared/adm.ts';
import { Catalogo } from '../_shared/catalogo.ts';
import { armarVendorBill, ErrorPropuesta, soloDigitos, totalPredicho } from './vendor_bills.ts';
import { armarCargo } from './bank_charges.ts';
import { armarJournal, armarTransferencia } from './otros_tipos.ts';
import { registrarTrabajo } from './registro.ts';

// deno-lint-ignore no-explicit-any
type Dic = Record<string, any>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface Diferencia {
  campo: string;
  esperado: unknown;
  adm: unknown;
}

function num(x: unknown): number {
  return Math.round(Number(x ?? 0) * 100) / 100;
}

/** Compara el payload rearmado contra el documento vivo. */
function diffVendorBill(payload: Dic, doc: Dic): Diferencia[] {
  const difs: Diferencia[] = [];
  const cmp = (campo: string, esperado: unknown, adm: unknown) => {
    if (esperado !== adm) difs.push({ campo, esperado, adm });
  };

  cmp('DocDate', String(payload.DocDate ?? '').slice(0, 10), String(doc.DocDate ?? '').slice(0, 10));
  cmp('NCF', payload.NCF ?? null, doc.NCF ?? null);
  cmp('FiscalID', soloDigitos(payload.FiscalID), soloDigitos(doc.FiscalID));
  cmp('CurrencyID', payload.CurrencyID, doc.CurrencyID);
  if (Math.abs(Number(payload.ExchangeRate) - Number(doc.ExchangeRate ?? 0)) > 0.0001) {
    difs.push({ campo: 'ExchangeRate', esperado: payload.ExchangeRate, adm: doc.ExchangeRate });
  }
  cmp('ExpenseTypeID', payload.ExpenseTypeID ?? null, doc.ExpenseTypeID ?? null);

  const itemsAdm: Dic[] = doc.Items ?? [];
  if ((payload.Items ?? []).length !== itemsAdm.length) {
    difs.push({ campo: 'Items.length', esperado: payload.Items.length, adm: itemsAdm.length });
  } else {
    (payload.Items as Dic[]).forEach((it, i) => {
      const a = itemsAdm[i] ?? {};
      if (num(it.Quantity) !== num(a.Quantity)) difs.push({ campo: `Items[${i}].Quantity`, esperado: it.Quantity, adm: a.Quantity });
      if (Math.abs(Number(it.Price) - Number(a.Price ?? 0)) > 0.0005) difs.push({ campo: `Items[${i}].Price`, esperado: it.Price, adm: a.Price });
      if (num(it.DiscountPercent) !== num(a.DiscountPercent)) difs.push({ campo: `Items[${i}].DiscountPercent`, esperado: it.DiscountPercent, adm: a.DiscountPercent });
      const schedEsp = it.TaxScheduleID ? 'con' : 'sin';
      const schedAdm = a.TaxScheduleID ? 'con' : 'sin';
      if (schedEsp !== schedAdm) difs.push({ campo: `Items[${i}].TaxScheduleID`, esperado: schedEsp, adm: schedAdm });
    });
  }

  const predicho = totalPredicho(payload);
  if (Math.abs(predicho - Number(doc.TotalAmount ?? 0)) > 0.05) {
    difs.push({ campo: 'TotalAmount(predicho)', esperado: predicho, adm: doc.TotalAmount });
  }
  return difs;
}

function diffCargo(payload: Dic, doc: Dic): Diferencia[] {
  const difs: Diferencia[] = [];
  const cmp = (campo: string, esperado: unknown, adm: unknown) => {
    if (esperado !== adm) difs.push({ campo, esperado, adm });
  };
  cmp('DocDate', String(payload.DocDate ?? '').slice(0, 10), String(doc.DocDate ?? '').slice(0, 10));
  cmp('CashAccountID', payload.CashAccountID, doc.CashAccountID);
  cmp('NCF', payload.NCF ?? null, doc.NCF ?? null);
  cmp('FiscalID', soloDigitos(payload.FiscalID), soloDigitos(doc.FiscalID));
  cmp('ExpenseTypeID', payload.ExpenseTypeID ?? null, doc.ExpenseTypeID ?? null);
  if (num(payload.TotalAmount) !== num(doc.TotalAmount)) {
    difs.push({ campo: 'TotalAmount', esperado: payload.TotalAmount, adm: doc.TotalAmount });
  }
  const accAdm: Dic[] = doc.Accounts ?? [];
  if ((payload.Accounts ?? []).length !== accAdm.length) {
    difs.push({ campo: 'Accounts.length', esperado: payload.Accounts.length, adm: accAdm.length });
  } else {
    (payload.Accounts as Dic[]).forEach((l, i) => {
      const a = accAdm[i] ?? {};
      if (l.AccountID !== a.AccountID) difs.push({ campo: `Accounts[${i}].AccountID`, esperado: l.AccountID, adm: a.AccountID });
      if (num(l.Debit) !== num(a.Debit)) difs.push({ campo: `Accounts[${i}].Debit`, esperado: l.Debit, adm: a.Debit });
      if (num(l.Credit) !== num(a.Credit)) difs.push({ campo: `Accounts[${i}].Credit`, esperado: l.Credit, adm: a.Credit });
    });
  }
  return difs;
}

async function backtest(empresaId: string, alcance: string[], limite: number): Promise<Dic> {
  const { data: emp, error } = await sb()
    .from('admcloud_empresas')
    .select('codigo, api_role, api_appid, api_username, api_password')
    .eq('id', empresaId)
    .single();
  if (error || !emp) throw new Error(`sin credenciales ADM: ${error?.message ?? 'sin fila'}`);
  const adm = new AdmCliente(emp as CredAdm);
  const cat = await Catalogo.cargar(sb(), adm, empresaId);

  // La tasa de sistema, precargada para que los builders queden puros.
  const tasas = new Map<string, number>();
  for (const c of await adm.paginar('Currencies')) {
    tasas.set(String(c?.ID ?? ''), Number(c?.ExchangeRate ?? 0));
  }
  const tasaAdm = (m: string) => tasas.get(m) ?? 0;

  const { data: filas, error: e2 } = await sb()
    .from('qualia_trabajos')
    .select('id, propuesta')
    .eq('empresa_id', empresaId)
    .not('propuesta->registro_adm->>docid', 'is', null)
    .order('id', { ascending: false });
  if (e2) throw new Error(`qualia_trabajos ilegible: ${e2.message}`);

  const resultados: Dic[] = [];
  let comparados = 0;
  for (const f of filas ?? []) {
    if (comparados >= limite) break;
    const p = (f as Dic).propuesta ?? {};
    const reg = p.registro_adm ?? {};
    if (reg.eliminado_en || reg.anulado_en || !reg.uuid) continue;
    const documento = String(reg.documento ?? p.documento_adm ?? '');
    if (!alcance.includes(documento)) continue;

    const docid = String(reg.docid ?? '');
    try {
      let payload: Dic | null = null;
      let recursoReal = documento;
      if (documento === 'BankCharges') {
        payload = armarCargo(p, cat, String((f as Dic).id), tasaAdm).payload;
      } else if (documento === 'Journals') {
        payload = armarJournal(p, cat, String((f as Dic).id), tasaAdm).payload;
      } else if (documento === 'BankBankTransfers') {
        payload = armarTransferencia(p, cat, String((f as Dic).id), tasaAdm).payload;
      } else if (documento === 'BillPayments' || documento === 'AccountPayments') {
        // Los pagos históricos no se pueden REARMAR: sus facturas ya no tienen
        // saldo en AP (y ese chequeo ES el dedup, por diseño). El backtest de
        // pagos verifica el documento vivo contra lo que la fila dice.
        payload = null;
      } else {
        const armado = armarVendorBill(p, cat, {
          // En backtest el proveedor/término no se re-resuelven (son IO): se
          // toman del documento vivo para que el diff mida lo que el builder
          // SÍ decide.
          relationshipId: null,
          paymentTermId: null,
          tasaAdmDeMoneda: tasaAdm,
        });
        payload = armado.payload;
        recursoReal = armado.recurso;
      }

      const doc = await adm.readback(recursoReal, String(reg.uuid));
      let difs: Diferencia[];
      if (payload === null) {
        difs = [];
        if (Math.abs(Math.abs(Number(doc.TotalAmount ?? 0)) - Math.abs(Number(p.monto ?? 0))) > 0.05) {
          difs.push({ campo: 'TotalAmount', esperado: p.monto, adm: doc.TotalAmount });
        }
        if (doc.Void === true) difs.push({ campo: 'Void', esperado: false, adm: true });
      } else if (documento === 'BankCharges') {
        difs = diffCargo(payload, doc);
      } else if (documento === 'Journals' || documento === 'BankBankTransfers') {
        difs = [];
        if (String(payload.DocDate ?? '').slice(0, 10) !== String(doc.DocDate ?? '').slice(0, 10)) {
          difs.push({ campo: 'DocDate', esperado: payload.DocDate, adm: doc.DocDate });
        }
        if (Math.abs(Number(payload.TotalAmount ?? 0) - Number(doc.TotalAmount ?? 0)) > 0.05) {
          difs.push({ campo: 'TotalAmount', esperado: payload.TotalAmount, adm: doc.TotalAmount });
        }
        if (documento === 'BankBankTransfers') {
          if (payload.CashAccountID !== (doc.FromCashAccountID ?? doc.CashAccountID)) {
            difs.push({ campo: 'CashAccountID', esperado: payload.CashAccountID, adm: doc.FromCashAccountID ?? doc.CashAccountID });
          }
          if (payload.DebitAccountID !== (doc.ToCashAccountID ?? doc.DebitAccountID)) {
            difs.push({ campo: 'DebitAccountID', esperado: payload.DebitAccountID, adm: doc.ToCashAccountID ?? doc.DebitAccountID });
          }
        } else {
          const accAdm: Dic[] = doc.Accounts ?? [];
          if ((payload.Accounts ?? []).length !== accAdm.length) {
            difs.push({ campo: 'Accounts.length', esperado: payload.Accounts.length, adm: accAdm.length });
          } else {
            (payload.Accounts as Dic[]).forEach((l, i) => {
              const a = accAdm[i] ?? {};
              if (l.AccountID !== a.AccountID) difs.push({ campo: `Accounts[${i}].AccountID`, esperado: l.AccountID, adm: a.AccountID });
              if (num(l.Debit) !== num(a.Debit)) difs.push({ campo: `Accounts[${i}].Debit`, esperado: l.Debit, adm: a.Debit });
              if (num(l.Credit) !== num(a.Credit)) difs.push({ campo: `Accounts[${i}].Credit`, esperado: l.Credit, adm: a.Credit });
            });
          }
        }
      } else {
        payload.RelationshipID = doc.RelationshipID ?? null;
        payload.PaymentTermID = doc.PaymentTermID ?? null;
        if ('PaymentTermID' in payload && payload.PaymentTermID === null) delete payload.PaymentTermID;
        difs = diffVendorBill(payload, doc);
      }
      resultados.push({ docid, documento, ok: difs.length === 0, difs });
    } catch (e) {
      const tipo = e instanceof ErrorPropuesta ? 'propuesta_rechazada' : 'error';
      resultados.push({ docid, documento, ok: false, [tipo]: (e as Error).message.slice(0, 300) });
    }
    comparados++;
  }

  return {
    empresa_id: empresaId,
    comparados,
    identicos: resultados.filter((r) => r.ok).length,
    con_diferencias: resultados.filter((r) => !r.ok).length,
    resultados,
  };
}

Deno.serve(async (req: Request) => {
  if (!(await autorizado(req))) return json({ error: 'no autorizado' }, 401);

  let body: Dic = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body JSON requerido' }, 400);
  }

  if (body.accion === 'backtest') {
    const empresaId = String(body.empresa_id ?? '1de77ce6-ed98-4a96-8b1f-d8b902f11cd5');
    const alcance = Array.isArray(body.documentos) && body.documentos.length
      ? body.documentos.map(String)
      : ['VendorBills', 'VendorCreditNotes', 'BankCharges', 'Journals', 'BankBankTransfers', 'BillPayments', 'AccountPayments'];
    const limite = Math.min(Number(body.limite ?? 40), 200);
    try {
      return json(await backtest(empresaId, alcance, limite));
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
  }

  if (body.accion === 'registrar') {
    const trabajoId = String(body.trabajo_id ?? '');
    if (!/^[0-9a-f-]{36}$/.test(trabajoId)) return json({ error: 'trabajo_id inválido' }, 400);
    const invocacion = `reg-${crypto.randomUUID().slice(0, 8)}`;
    return json(await registrarTrabajo(sb(), trabajoId, invocacion));
  }

  if (body.accion === 'barrido') {
    // La red de seguridad: aprobadas sin docid de los tipos portados, en modo
    // nube, de a pocas (el turno por empresa las serializa igual). criterio y
    // caso viven en 'aprobada' para siempre: afuera, como en el poller.
    const limite = Math.min(Number(body.limite ?? 10), 25);
    const { data: filas, error } = await sb()
      .from('qualia_trabajos')
      .select('id')
      .eq('estado', 'aprobada')
      .not('tipo', 'in', '("criterio","caso")')
      .is('propuesta->registro_adm->>docid', null)
      .order('updated_at', { ascending: true })
      .limit(limite);
    if (error) return json({ error: error.message }, 500);
    const resultados = [];
    for (const f of filas ?? []) {
      const invocacion = `reg-${crypto.randomUUID().slice(0, 8)}`;
      resultados.push(await registrarTrabajo(sb(), String((f as Dic).id), invocacion));
    }
    return json({ barridos: resultados.length, resultados });
  }

  return json({ error: `acción desconocida: '${body.accion}'` }, 400);
});
