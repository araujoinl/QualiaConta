// qualia-registrador/registro.ts — el camino VIVO: de una fila 'aprobada' a un
// documento en ADM, con el contrato completo de F4 §4: claim con tope diario,
// turno por empresa, guardas duras, evento ANTES del POST, ledger de intentos,
// readback verificado, docid y estado en sentencias SEPARADAS, adjunto que no
// aborta. El armado del payload viene de los ports puros (vendor_bills,
// bank_charges); acá vive el IO.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { AdmCliente } from '../_shared/adm.ts';
import { Catalogo } from '../_shared/catalogo.ts';
import { modo } from '../_shared/db.ts';
import {
  backdatingOk,
  candadoNomina,
  escrituraEncendida,
  hashPayload,
  periodoAbierto,
  topeDiario,
  topeMonto,
} from '../_shared/guardas.ts';
import { armarVendorBill, ErrorPropuesta, esNotaCredito, soloDigitos } from './vendor_bills.ts';
import { armarCargo, referenciaDe } from './bank_charges.ts';
import { adoptarJournal, armarJournal, armarTransferencia, gemelosTransferencia } from './otros_tipos.ts';
import { autorizarPago, prepararAccountPayment, prepararBillPayment, verificarDuplicadoPago } from './pagos.ts';

// deno-lint-ignore no-explicit-any
type Dic = Record<string, any>;

// Los 7 tipos portados. La nómina NO es un tipo: es un Journal que el candado
// de cuentas frena hacia la ruta humana (plan-f4 §6, jamás autónoma).
const TIPOS_PORTADOS = new Set([
  'VendorBills',
  'VendorCreditNotes',
  'BankCharges',
  'Journals',
  'BankBankTransfers',
  'BillPayments',
  'AccountPayments',
]);
// Presupuesto por tipo (E7): el camino largo del server era factura+adjunto
// ~300s; el claim debe durar MÁS que el peor caso de la propia invocación.
const TTL_CLAIM_S = 360;

// Las entidades sin RNC que se resuelven por NOMBRE, y SOLO éstas — se busca,
// jamás se crea (🪦 FP00001133, la liquidación de aduana de RD$939,118.86).
const SIN_RNC = new Set(['DGA ADUANAS']);

export interface ResultadoRegistro {
  trabajo_id: string;
  resultado: string;
  docid?: string;
  detalle?: string;
}

function plano(txt: unknown): string {
  return String(txt ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

async function evento(db: SupabaseClient, trabajoId: string, contenido: string, datos?: Dic) {
  await db.from('qualia_eventos').insert({
    trabajo_id: trabajoId,
    autor: 'sistema',
    tipo: 'progreso',
    contenido: contenido.slice(0, 2000),
    datos: datos ?? null,
  });
}

/**
 * RelationshipID + PaymentTermID del proveedor. Match por RNC EXACTO, jamás
 * por nombre (los nombres se escriben de veinte formas); la única excepción es
 * la lista cerrada SIN_RNC. Si no existe, se CREA con el respaldo de DGII que
 * la propuesta trae (razón social del comprobante o del padrón) — nace
 * «Pendiente de Aprobación» y lo aprueba un humano en ADM.
 */
async function asegurarProveedor(
  adm: AdmCliente,
  cat: Catalogo,
  p: Dic,
): Promise<{ rid: string; termino: string; aviso?: string }> {
  const rnc = soloDigitos(p.rnc);

  if (rnc.length !== 9 && rnc.length !== 11) {
    const nombre = plano(p.proveedor);
    if (!SIN_RNC.has(nombre)) {
      throw new ErrorPropuesta(
        `la propuesta no trae un RNC válido ('${p.rnc ?? ''}') y «${p.proveedor}» no está en la ` +
          `lista SIN_RNC: no busco ni creo el proveedor.`,
      );
    }
    for (const v of await adm.paginar('Vendors')) {
      if (plano(v?.Name) === nombre) {
        return { rid: v.ID, termino: v.PaymentTermID ?? cat.terminoContado };
      }
    }
    throw new ErrorPropuesta(`«${p.proveedor}» (SIN_RNC) no existe en ADM y ese camino JAMÁS crea.`);
  }

  for (const v of await adm.paginar('Vendors')) {
    if (soloDigitos(v?.FiscalID) === rnc) {
      return { rid: v.ID, termino: v.PaymentTermID ?? cat.terminoContado };
    }
  }

  // El respaldo del ALTA es que DGII reconozca el RNC, no que el comprobante
  // verifique: son dos preguntas distintas.
  const dgii: Dic = p.dgii ?? {};
  const padron: Dic = p.rnc_padron ?? {};
  const comprobanteOk = ['VIGENTE', 'ACEPTADO'].includes(String(dgii.estado ?? '').toUpperCase());
  const padronOk = String(padron.estado ?? '').toUpperCase() === 'ENCONTRADO' &&
    String(padron.razon_social ?? '').trim() !== '';
  const nombre = comprobanteOk
    ? String(dgii.razon_social_emisor ?? '').trim()
    : padronOk
    ? String(padron.razon_social).trim()
    : '';
  if (!nombre) {
    throw new ErrorPropuesta(
      `el proveedor RNC ${rnc} no existe en ADM y ninguna vía de DGII dio su razón social ` +
        `(comprobante: ${dgii.estado ?? 'sin consultar'}; padrón: ${padron.estado ?? 'sin consultar'}). ` +
        `No invento el nombre.`,
    );
  }

  let termino = cat.terminoContado;
  const m = /(30|45|60)\s*d[ií]as/i.exec(String(p.termino_pago ?? ''));
  if (m) termino = cat.terminoPago(m[1]) ?? termino;

  const d = await adm.llamar('POST', 'Vendors', {
    Name: nombre,
    FiscalID: rnc,
    IsVendor: true,
    CurrencyID: p.moneda ?? 'DOP',
    PaymentTermID: termino,
  });
  if (!d.success || typeof d.data !== 'string') {
    throw new Error(`no pude crear el proveedor: ${d.message ?? 'sin mensaje'}`);
  }
  return {
    rid: d.data,
    termino,
    aviso: `proveedor creado: ${nombre} (nace Pendiente de Aprobación; lo aprueba un humano en ADM)`,
  };
}

/** Duplicado de facturas/NC: corte a 6 meses antes de la fecha del documento. */
async function verificarDuplicadoFactura(
  adm: AdmCliente,
  recurso: string,
  ncf: string | null,
  referencia: string | null,
  docDate: string,
): Promise<void> {
  const corte = (() => {
    const d = new Date(String(docDate).slice(0, 10) + 'T00:00:00Z');
    d.setUTCMonth(d.getUTCMonth() - 6);
    return d.toISOString().slice(0, 10);
  })();
  // deno-lint-ignore no-explicit-any
  const cortar = (lote: any[]) => {
    const ultimo = String(lote[lote.length - 1]?.DocDate ?? '').slice(0, 10);
    return Boolean(ultimo) && ultimo < corte;
  };
  // Las NC son 6 en toda la historia: se paginan enteras (cortar ahí sería
  // pagar el riesgo de perderse un duplicado viejo a cambio de nada).
  const filas = await adm.paginar(recurso, recurso === 'VendorBills' ? cortar : undefined);
  for (const f of filas) {
    if (ncf && String(f?.NCF ?? '').trim().toUpperCase() === ncf.toUpperCase()) {
      throw new ErrorPropuesta(`YA REGISTRADA: ${f.DocID} tiene ese NCF`);
    }
    if (referencia && String(f?.Reference ?? '').trim() === referencia) {
      throw new ErrorPropuesta(`YA REGISTRADA: ${f.DocID} tiene esa referencia`);
    }
  }
}

/**
 * La doble pregunta de los cargos (🪦 CB00000169): (1) ¿hay un gemelo con MI
 * referencia? → YA REGISTRADO. (2) ¿los gemelos vivos del mismo día y monto ya
 * los reclamó otro trabajo? Si queda uno huérfano → AMBIGUO: no se registra
 * nada y se le pregunta al humano citando los DocID.
 */
async function verificarDuplicadoCargo(
  db: SupabaseClient,
  adm: AdmCliente,
  empresaId: string,
  referencia: string,
  fecha: string,
  monto: number,
  cashAccountId: string,
): Promise<void> {
  const f10 = String(fecha).slice(0, 10);
  // deno-lint-ignore no-explicit-any
  const cortar = (lote: any[]) => {
    const ultimo = String(lote[lote.length - 1]?.CreationDate ?? '').slice(0, 10);
    return Boolean(ultimo) && ultimo < f10;
  };
  const filas = await adm.paginar('BankCharges', cortar);

  const { data } = await db
    .from('qualia_trabajos')
    .select('propuesta')
    .eq('empresa_id', empresaId)
    .not('propuesta->registro_adm->>docid', 'is', null);
  const reclamados = new Set(
    (data ?? [])
      .map((r: Dic) => r.propuesta?.registro_adm)
      .filter((r: Dic) => r && !r.eliminado_en && !r.anulado_en)
      .map((r: Dic) => String(r.docid)),
  );

  const gemelos: string[] = [];
  for (const f of filas) {
    if (String(f?.Reference ?? '').trim() === referencia || String(f?.NCF ?? '').trim() === referencia) {
      throw new ErrorPropuesta(`YA REGISTRADO: ${f.DocID} lleva la referencia '${referencia}'`);
    }
    if (
      String(f?.DocDate ?? '').slice(0, 10) === f10 &&
      Math.abs(Math.abs(Number(f?.TotalAmount ?? 0)) - Math.abs(monto)) <= 0.01 &&
      (f?.BankAccountID === cashAccountId || !f?.BankAccountID)
    ) {
      if (!reclamados.has(String(f?.DocID ?? ''))) gemelos.push(String(f?.DocID ?? ''));
    }
  }
  if (gemelos.length) {
    throw new ErrorPropuesta(
      `AMBIGUO: hay cargos gemelos en ADM que ningún trabajo reclama (${gemelos.join(', ')}). ` +
        `No registro nada — puede ser ESTE movimiento ya registrado a mano. Decidilo vos: si NO es ` +
        `éste, aprobá de nuevo con la nota correspondiente.`,
    );
  }
}

/** Sube el documento del trabajo como adjunto de la transacción (no aborta). */
async function subirAdjunto(
  db: SupabaseClient,
  adm: AdmCliente,
  trabajoId: string,
  empresaId: string,
  guid: string,
): Promise<string> {
  const { data: fila } = await db
    .from('qualia_trabajos')
    .select('archivo_nombre, archivo_url')
    .eq('id', trabajoId)
    .single();
  const url = String((fila as Dic)?.archivo_url ?? '');
  if (!url) return 'sin archivo_url: subilo a mano';
  const nombre = String((fila as Dic)?.archivo_nombre ?? 'documento');

  let bytes: Uint8Array;
  let tipo = 'application/octet-stream';
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return `no pude bajar el documento (HTTP ${r.status}, ¿URL vencida?): subilo a mano`;
    tipo = r.headers.get('content-type') ?? tipo;
    bytes = new Uint8Array(await r.arrayBuffer());
  } catch (e) {
    return `no pude bajar el documento (${(e as Error).message}): subilo a mano`;
  }

  const borde = '----qualiaconta' + guid.replace(/\W/g, '');
  const cabeza = `--${borde}\r\nContent-Disposition: form-data; name="file"; filename="${
    nombre.replace(/"/g, '_')
  }"\r\nContent-Type: ${tipo}\r\n\r\n`;
  const cola = `\r\n--${borde}--\r\n`;
  const cuerpo = new Uint8Array(cabeza.length + bytes.length + cola.length);
  cuerpo.set(new TextEncoder().encode(cabeza), 0);
  cuerpo.set(bytes, cabeza.length);
  cuerpo.set(new TextEncoder().encode(cola), cabeza.length + bytes.length);

  try {
    const da = await adm.subirStorage(guid, cuerpo, borde);
    if (da.success) {
      const { data: filaP } = await db.from('qualia_trabajos').select('propuesta').eq('id', trabajoId).single();
      const prop = ((filaP as Dic)?.propuesta ?? {}) as Dic;
      prop.registro_adm = {
        ...(prop.registro_adm ?? {}),
        adjunto: { nombre, storage_id: typeof da.data === 'string' ? da.data : '' },
      };
      await db.from('qualia_trabajos').update({ propuesta: prop }).eq('id', trabajoId).eq('empresa_id', empresaId);
      return `adjunto ${nombre} subido`;
    }
    return `ADJUNTO FALLÓ (${da.message ?? 'sin mensaje'}). El documento SÍ quedó registrado.`;
  } catch (e) {
    return `ADJUNTO FALLÓ (${(e as Error).message}). El documento SÍ quedó registrado.`;
  }
}

export async function registrarTrabajo(
  db: SupabaseClient,
  trabajoId: string,
  invocacion: string,
): Promise<ResultadoRegistro> {
  const salir = (resultado: string, detalle?: string): ResultadoRegistro => ({
    trabajo_id: trabajoId,
    resultado,
    detalle,
  });

  const { data: fila, error } = await db
    .from('qualia_trabajos')
    .select('id, empresa_id, estado, propuesta')
    .eq('id', trabajoId)
    .single();
  if (error || !fila) return salir('no_existe', error?.message);
  const empresaId = String((fila as Dic).empresa_id);
  const p: Dic = (fila as Dic).propuesta ?? {};

  if ((fila as Dic).estado !== 'aprobada') return salir('no_aprobada', (fila as Dic).estado);
  const reg = p.registro_adm ?? {};
  if (reg.docid && !reg.eliminado_en && !reg.anulado_en) return salir('ya_registrada', reg.docid);

  // El router de verdad: el NCF decide la NC, no `documento_adm` (el campo lo
  // escribe el modelo). Tipos fuera del alcance v1 quedan para el server/humano.
  let documento = String(p.documento_adm ?? '').trim();
  if (esNotaCredito(p) && documento !== 'BankCharges') documento = 'VendorCreditNotes';
  if (!TIPOS_PORTADOS.has(documento)) return salir('tipo_no_portado', documento || 'vacío');

  if ((await modo(empresaId, 'qualia-registrador')) !== 'nube') return salir('modo_server');

  if (!(await escrituraEncendida(db, empresaId))) {
    await evento(db, trabajoId, 'registro_frenado: el kill-switch de escritura está apagado (qualia_config escritura)');
    await db.from('qualia_escrituras').insert({
      empresa_id: empresaId,
      trabajo_id: trabajoId,
      invocacion,
      recurso: documento,
      hash_payload: '-',
      estado: 'frenada',
      detalle: 'kill_switch_off',
    });
    return salir('frenada', 'kill_switch_off');
  }

  // Claim (con tope diario adentro, en la misma transacción) y turno.
  const tope = await topeDiario(empresaId);
  const { data: claim } = await db.rpc('qualia_claim_registro', {
    p_trabajo: trabajoId,
    p_invocacion: invocacion,
    p_ttl_s: TTL_CLAIM_S,
    p_tope_diario: tope,
  });
  if (!(claim as Dic)?.ok) {
    const motivo = String((claim as Dic)?.motivo ?? 'sin_claim');
    if (motivo === 'tope_diario') {
      await evento(db, trabajoId, `registro_frenado: tope diario de escrituras alcanzado (${tope})`);
    }
    return salir(motivo);
  }
  const { data: turno } = await db.rpc('qualia_tomar_turno', {
    p_empresa: empresaId,
    p_invocacion: invocacion,
  });
  if (!turno) return salir('sin_turno');

  try {
    const { data: emp, error: eEmp } = await db
      .from('admcloud_empresas')
      .select('codigo, api_role, api_appid, api_username, api_password')
      .eq('id', empresaId)
      .single();
    if (eEmp || !emp) return salir('error', `sin credenciales ADM: ${eEmp?.message ?? 'sin fila'}`);
    // deno-lint-ignore no-explicit-any
    const adm = new AdmCliente(emp as any);
    const cat = await Catalogo.cargar(db, adm, empresaId);
    const tasas = new Map<string, number>();
    for (const c of await adm.paginar('Currencies')) tasas.set(String(c?.ID ?? ''), Number(c?.ExchangeRate ?? 0));

    // Guardas duras ANTES de armar nada.
    const fechaDoc = String(p.fecha ?? '').slice(0, 10);
    const bd = backdatingOk(fechaDoc, p.waiver_backdating === true);
    if (!bd.ok) {
      await evento(db, trabajoId, `registro_frenado: ${bd.motivo}`);
      return salir('frenada', bd.motivo);
    }
    const per = await periodoAbierto(adm, documento, fechaDoc);
    if (!per.ok) {
      await evento(db, trabajoId, `registro_frenado: ${per.motivo}`);
      return salir('frenada', per.motivo);
    }
    const tMonto = await topeMonto(empresaId);
    if (Math.abs(Number(p.monto ?? 0)) > tMonto) {
      await evento(
        db,
        trabajoId,
        `registro_frenado: el monto ${Number(p.monto).toFixed(2)} supera el tope de ${tMonto} — ` +
          `doble llave: espera un confirmar humano (subí el tope por config o registralo a mano)`,
      );
      await db.from('qualia_escrituras').insert({
        empresa_id: empresaId,
        trabajo_id: trabajoId,
        invocacion,
        recurso: documento,
        hash_payload: '-',
        estado: 'frenada',
        detalle: `tope_monto:${tMonto}`,
      });
      return salir('frenada', 'tope_monto');
    }

    // El armado (puro) + los chequeos IO por tipo.
    let payload: Dic;
    let recurso: string = documento;
    let referencia: string;
    let requiereAuthorize = false;
    let extraFila: Dic = {};
    const avisos: string[] = [];
    const tasaDe = (m: string) => tasas.get(m) ?? 0;

    // Adopción (Journals/TE): el documento YA existe y ES este movimiento.
    const adoptar = async (docid: string, uuid: string): Promise<ResultadoRegistro> => {
      const nueva: Dic = { ...p };
      nueva.registro_adm = {
        docid,
        uuid,
        documento: recurso,
        fecha: new Date().toISOString().slice(0, 10),
        reference: referencia,
        adoptado: true,
      };
      await db.from('qualia_trabajos').update({ propuesta: nueva }).eq('id', trabajoId).eq('empresa_id', empresaId);
      await db.from('qualia_trabajos').update({ estado: 'registrada' })
        .eq('id', trabajoId).eq('empresa_id', empresaId).eq('estado', 'aprobada');
      await evento(db, trabajoId, `YA REGISTRADO: ${docid} trae la referencia de este movimiento (${referencia}). Adoptado y cerrado.`);
      return { trabajo_id: trabajoId, resultado: 'adoptada', docid };
    };

    switch (documento) {
      case 'BankCharges': {
        const armado = armarCargo(p, cat, trabajoId, tasaDe);
        payload = armado.payload;
        referencia = armado.referencia;
        avisos.push(...armado.avisos);
        await verificarDuplicadoCargo(db, adm, empresaId, referencia, fechaDoc, Number(p.monto ?? 0), String(payload.CashAccountID));
        break;
      }
      case 'Journals': {
        const armado = armarJournal(p, cat, trabajoId, tasaDe);
        // La nómina jamás va autónoma: el candado mira las CUENTAS, no el
        // Reference (E2: ED00000181 lo tiene mal tipeado).
        const nom = candadoNomina(armado.cuentas);
        if (!nom.ok) {
          await evento(db, trabajoId, `registro_frenado: ${nom.motivo}`);
          return salir('frenada', nom.motivo);
        }
        payload = armado.payload;
        referencia = armado.referencia;
        const adopcion = await adoptarJournal(adm, referencia, fechaDoc, Number(payload.TotalAmount ?? 0));
        if (adopcion && 'ambiguo' in adopcion) throw new ErrorPropuesta(adopcion.ambiguo);
        if (adopcion) return await adoptar(adopcion.docid, adopcion.uuid);
        break;
      }
      case 'BankBankTransfers': {
        const armado = armarTransferencia(p, cat, trabajoId, tasaDe);
        payload = armado.payload;
        referencia = armado.referencia;
        const { data: recl } = await db
          .from('qualia_trabajos')
          .select('propuesta')
          .eq('empresa_id', empresaId)
          .not('propuesta->registro_adm->>docid', 'is', null);
        const reclamados = new Set(
          (recl ?? [])
            .map((r: Dic) => r.propuesta?.registro_adm)
            .filter((r: Dic) => r && !r.eliminado_en && !r.anulado_en)
            .map((r: Dic) => String(r.docid)),
        );
        const g = await gemelosTransferencia(adm, reclamados, armado.uuidOrigen, armado.uuidDestino, Number(p.monto ?? 0), fechaDoc, referencia);
        if (g && 'ambiguo' in g) {
          if (p.forzar_registro === true) {
            avisos.push('forzar_registro: hay gemelos sin dueño y el humano dijo que éste NO es ninguno');
          } else {
            throw new ErrorPropuesta(g.ambiguo);
          }
        } else if (g) {
          return await adoptar(g.docid, g.uuid);
        }
        break;
      }
      case 'BillPayments': {
        const prep = await prepararBillPayment(adm, cat, p, trabajoId);
        payload = prep.payload;
        recurso = prep.recurso;
        referencia = prep.referencia;
        requiereAuthorize = prep.requiereAuthorize;
        extraFila = prep.extraFila;
        avisos.push(...prep.avisos);
        await verificarDuplicadoPago(adm, 'BillPayments', referencia);
        break;
      }
      case 'AccountPayments': {
        const prep = await prepararAccountPayment(adm, cat, p, trabajoId);
        payload = prep.payload;
        recurso = prep.recurso;
        referencia = prep.referencia;
        requiereAuthorize = prep.requiereAuthorize;
        extraFila = prep.extraFila;
        avisos.push(...prep.avisos);
        await verificarDuplicadoPago(adm, 'AccountPayments', referencia);
        break;
      }
      default: {
        const prov = await asegurarProveedor(adm, cat, p);
        if (prov.aviso) avisos.push(prov.aviso);
        let invoiceId: string | null = null;
        if (esNotaCredito(p) && p.factura_original_docid) {
          for (const f of await adm.paginar('VendorBills')) {
            if (String(f?.DocID ?? '') === String(p.factura_original_docid)) {
              invoiceId = String(f.ID);
              break;
            }
          }
        }
        const armado = armarVendorBill(p, cat, {
          relationshipId: prov.rid,
          paymentTermId: prov.termino,
          invoiceId,
          tasaAdmDeMoneda: tasaDe,
        });
        payload = armado.payload;
        recurso = armado.recurso;
        referencia = String(payload.Reference ?? payload.NCF ?? '');
        avisos.push(...armado.avisos);
        await verificarDuplicadoFactura(
          adm,
          recurso,
          payload.NCF ? String(payload.NCF) : null,
          payload.Reference ? String(payload.Reference) : null,
          fechaDoc,
        );
      }
    }

    // El evento y la fila del ledger van ANTES del POST (§4.3): es lo único
    // que convierte «murió entre el POST y el readback» en un huérfano
    // detectable. Y NUNCA re-POST sin buscar el documento antes.
    const hash = await hashPayload(payload);
    const { data: ledger } = await db
      .from('qualia_escrituras')
      .insert({
        empresa_id: empresaId,
        trabajo_id: trabajoId,
        invocacion,
        recurso,
        referencia,
        ncf: payload.NCF ?? null,
        monto: Math.abs(Number(p.monto ?? 0)),
        fecha_doc: fechaDoc,
        hash_payload: hash,
        estado: 'iniciada',
      })
      .select('id')
      .single();
    await evento(db, trabajoId, `escritura_iniciada: ${recurso} ref '${referencia}' hash ${hash.slice(0, 12)}`);

    const cerrarLedger = async (estado: string, extra: Dic) => {
      if ((ledger as Dic)?.id) {
        await db
          .from('qualia_escrituras')
          .update({ estado, actualizado_en: new Date().toISOString(), ...extra })
          .eq('id', (ledger as Dic).id);
      }
    };

    let d;
    try {
      d = await adm.llamar('POST', recurso, payload);
    } catch (e) {
      // El POST pudo haber entrado aunque la conexión muriera: NO se
      // reintenta. La escritura queda 'iniciada' y el humano/cuadre resuelven.
      await evento(
        db,
        trabajoId,
        `el POST murió sin respuesta (${(e as Error).message.slice(0, 150)}): NO reintento — ` +
          `buscá el documento por la referencia '${referencia}' antes de tocar nada`,
      );
      return salir('post_sin_respuesta');
    }

    if (!d.success || typeof d.data !== 'string') {
      const msg = String(d.message ?? 'sin mensaje');
      // El choque de correlativo se reintenta UNA vez y sólo ése, previa
      // re-verificación de duplicados (el contable registra por su cuenta y
      // no pide turno; ADM tampoco es sólo nuestro).
      if (/ya existe una transacci.n con el n.mero/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 5000));
        if (documento === 'BankCharges') {
          await verificarDuplicadoCargo(db, adm, empresaId, referencia, fechaDoc, Number(p.monto ?? 0), String(payload.CashAccountID));
        } else {
          await verificarDuplicadoFactura(adm, recurso, payload.NCF ?? null, payload.Reference ?? null, fechaDoc);
        }
        d = await adm.llamar('POST', recurso, payload);
      }
      if (!d.success || typeof d.data !== 'string') {
        await cerrarLedger('fallida', { detalle: String(d.message ?? 'sin mensaje').slice(0, 300) });
        await evento(db, trabajoId, `ADM rechazó el ${recurso}: ${String(d.message ?? '').slice(0, 300)}`);
        return salir('rechazada_por_adm', String(d.message ?? '').slice(0, 200));
      }
    }
    const guid = String(d.data);

    // Readback con el recurso CORRECTO y verificando que el ID sea EL nuestro.
    const doc = await adm.readback(recurso, guid);
    if (String(doc?.ID ?? '').toLowerCase() !== guid.toLowerCase()) {
      await cerrarLedger('parcial', { adm_uuid: guid, detalle: 'readback devolvió OTRO documento' });
      await evento(db, trabajoId, `el readback devolvió OTRO documento — buscá por NCF antes de reintentar (uuid ${guid})`);
      return salir('readback_raro', guid);
    }
    const docid = String(doc.DocID ?? '');
    const refPersistida = String(doc.Reference ?? '').trim() === referencia;
    if ((recurso === 'BankCharges' || recurso === 'BankBankTransfers' || recurso === 'Journals') && !refPersistida) {
      avisos.push(`OJO: ADM no persistió el Reference '${referencia}' — dos gemelos vuelven a ser indistinguibles`);
    }

    // Los pagos: el documento nace PENDIENTE y el Authorize es lo que mueve la
    // plata (PC00000376: antes del Authorize, Total y cero Accounts). Si queda
    // pendiente, la fila NO cierra: estado `parcial` en el ledger (E6) y la
    // deuda visible en registro_adm.
    let pendiente = false;
    if (requiereAuthorize) {
      const aut = await autorizarPago(adm, recurso as 'BillPayments' | 'AccountPayments', guid, docid);
      pendiente = aut.pendiente;
      if (aut.aviso) avisos.push(aut.aviso);
      if (recurso === 'AccountPayments' && !pendiente) {
        // Cuadre POST-autorización (🪦 PC00000334: ADM autoriza descuadrados
        // sin chistar): D = C = monto sobre las líneas que ADM derivó.
        const doc2 = await adm.readback('AccountPayments', guid);
        // deno-lint-ignore no-explicit-any
        const admD = ((doc2.Accounts ?? []) as any[]).reduce((s, a) => s + Number(a?.Debit ?? 0), 0);
        // deno-lint-ignore no-explicit-any
        const admC = ((doc2.Accounts ?? []) as any[]).reduce((s, a) => s + Number(a?.Credit ?? 0), 0);
        const m = Math.abs(Number(p.monto ?? 0));
        if (Math.abs(admD - admC) > 0.01 || Math.abs(admD - m) > 0.01) {
          pendiente = true;
          avisos.push(
            `REGISTRADO PERO DESCUADRADO: ${docid} derivó D=${admD.toFixed(2)} C=${admC.toFixed(2)} ` +
              `contra monto ${m.toFixed(2)}. Revisar en ADM antes de tocar nada.`,
          );
        }
      }
    }

    // La fila: docid PRIMERO (dato irremplazable), estado DESPUÉS y en
    // sentencia aparte con guard de 'aprobada' (si alguien la movió, el estado
    // se corrige después; el docid no se recupera).
    const nuevaProp: Dic = { ...p };
    nuevaProp.registro_adm = {
      docid,
      uuid: guid,
      documento: recurso,
      fecha: new Date().toISOString().slice(0, 10),
      reference: referencia,
      ...(requiereAuthorize ? { pendiente_autorizacion: pendiente } : {}),
      ...extraFila,
    };
    if (recurso === 'VendorCreditNotes') {
      nuevaProp.documento_adm_declarado = p.documento_adm ?? null;
      nuevaProp.documento_adm = recurso; // la fila queda diciendo la VERDAD
      nuevaProp.aplicacion_pendiente = {
        factura_docid: p.factura_original_docid ?? null,
        ncf_modificado: p.ncf_modificado ?? null,
        monto: Number(p.monto ?? 0),
      };
    }
    await db.from('qualia_trabajos').update({ propuesta: nuevaProp }).eq('id', trabajoId).eq('empresa_id', empresaId);

    await cerrarLedger(pendiente ? 'parcial' : 'confirmada', {
      adm_uuid: guid,
      adm_docid: docid,
      referencia_persistida: refPersistida,
      ...(pendiente ? { detalle: 'creado sin autorizar o descuadrado: NO movió plata todavía' } : {}),
    });

    // El adjunto es del papel: facturas, cargos, asientos y traspasos. Los
    // pagos no llevan (su respaldo es la factura que cancelan).
    if (!requiereAuthorize) {
      avisos.push(await subirAdjunto(db, adm, trabajoId, empresaId, guid));
    }

    if (!pendiente) {
      await db
        .from('qualia_trabajos')
        .update({ estado: 'registrada' })
        .eq('id', trabajoId)
        .eq('empresa_id', empresaId)
        .eq('estado', 'aprobada');
    }

    await evento(
      db,
      trabajoId,
      `${pendiente ? 'CREADO SIN CERRAR' : 'REGISTRADA'}: ${recurso} ${docid} (uuid ${guid}) · total ${doc.TotalAmount}` +
        (avisos.length ? `\n${avisos.join('\n')}` : ''),
      { docid, uuid: guid, recurso, pendiente },
    );

    return {
      trabajo_id: trabajoId,
      resultado: pendiente ? 'parcial' : 'registrada',
      docid,
      detalle: avisos.join(' | '),
    };
  } catch (e) {
    if (e instanceof ErrorPropuesta) {
      await evento(db, trabajoId, `no registro: ${e.message}`);
      return salir('propuesta_rechazada', e.message.slice(0, 300));
    }
    await evento(db, trabajoId, `error del registrador: ${(e as Error).message.slice(0, 300)}`);
    return salir('error', (e as Error).message.slice(0, 300));
  } finally {
    await db.rpc('qualia_soltar_turno', { p_empresa: empresaId, p_invocacion: invocacion });
  }
}
