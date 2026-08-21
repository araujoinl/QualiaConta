// Detector de pagos de préstamo — nuevo del 2026-08-21 (decisión de Carlos:
// «registrar directo con script», sin turno del contable LLM).
//
// El caso: el banco debita UNA vez al mes la cuota completa de un préstamo
// («Debito Por Pago De Prestamo-Abono Ordinariocredito #339547») y emite por
// separado los e-NCF de la devengación de intereses del mes. El detector de
// cargos nunca lo levanta —la cuenta del crédito no está en
// `openbanking_accounts` a propósito, es el número del préstamo y no una
// cuenta que el colector lea— y la doctrina H-04 frenaba la cuota mixta
// porque partir capital/interés exigía una tabla de amortización que no
// existe. Los e-NCF SON esa partición, documentada por el propio banco: el
// interés es la suma de los comprobantes y el capital sale por resta. Nada
// que estimar — por eso este detector puede proponer solo donde H-04 mandaba
// a sesión humana.
//
// DOS ETAPAS, en corridas distintas del cron (cada una idempotente):
//
//   FACTURAS — con el mes del débito ya cerrado y sus e-NCF abajo, siembra
//              N+1 trabajos 'propuesta': una factura de proveedor por e-NCF
//              de intereses y una por el abono a capital (sin NCF, con
//              referencia determinista — ADM frena duplicados por NCF O por
//              referencia, y el capital no tiene NCF). El humano las aprueba
//              en la caja «Pagos de préstamos» de la mesa y el registrador
//              las escribe en ADM con su camino VendorBills de siempre.
//
//   PAGO     — cuando TODAS las facturas del grupo ya tienen su docid vivo
//              en ADM, siembra el pago único (BillPayments) que las liquida
//              juntas y acredita el banco por el TOTAL del débito. Un débito
//              → un documento contra el banco: es la única forma en que la
//              conciliación (monto contra monto, 1 a 1) encuentra el
//              movimiento. El registrador ya valida que los renglones sumen
//              exactamente lo que salió del banco.
//
// El grupo se ata con `propuesta.grupo_prestamo` = 'prestamo:<banco_tx_id>'.
// Sólo el PAGO reclama el movimiento (`banco_tx_id`): si lo reclamara también
// la factura de capital, el trigger de amparo marcaría el movimiento con el
// documento equivocado y la etapa 2 no sabría distinguir «falta el pago» de
// «ya está todo».
//
// REGLA HEREDADA QUE NO SE ROMPE: este detector NUNCA retira ni pisa un
// trabajo. Si un e-NCF del grupo ya lo reclamó otro camino (el botón «Mandar
// a la mesa» de NCF Bancos, un pedido al contable), el débito entero se
// SALTA con aviso: dos dueños del mismo papel terminan en dos documentos.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { registrarSombra } from '../_shared/sombra.ts';
import { AdmCliente } from '../_shared/adm.ts';
import type { CredAdm } from '../_shared/adm.ts';
import {
  cargarMapaCuentas,
  c2,
  fmtMonto,
  hoyRD,
  paginar,
  restarDias,
  stripNulls,
} from './comun.ts';

export type Modo = 'server' | 'sombra' | 'nube';

const FUNCION_SOMBRA = 'qualia-sugerencias/prestamos';

// Mismo par de literales que el frontend (RE_PRESTAMO en qualiaSugerencias.js
// del repo Labs_Inv): si divergen, la caja muestra un débito que este detector
// no ve, o al revés. El texto real del banco viene pegado
// («…Abono Ordinariocredito #339547») — por eso ningún \b.
const RE_PRESTAMO = /pago\s+de\s+pr[eé]stamo|abono\s+ordinario/i;
const RE_CREDITO = /cr[eé]dito\s*#?\s*(\d{4,})/i;

// Ventana de búsqueda de débitos. Larga a propósito: la etapa 2 depende de
// que las facturas se aprueben Y registren, y un mes de vacaciones no puede
// dejar el pago sin sembrar para siempre.
const DIAS_VENTANA = 120;

export interface ResultadoPrestamos {
  modo: Modo;
  accion: 'ninguna' | 'sombra' | 'insertadas';
  facturas: number;
  pagos: number;
  resumenes: string[];
  avisos: string[];
}

// ── El bloque `prestamos` del mapa de cuentas ───────────────────────────────
//
// Vive junto a `cargos` y `cuentas` en qualia_config clave='mapa_cuentas'
// (una sola fuente para todo el mapa — la desincronización que §10.4 prohíbe):
//
//   "prestamos": [{
//     "credito": "339547",                  ← el # que el banco pega en el texto
//     "cuenta": "230.04",                   ← la deuda de ESTE préstamo
//     "cuenta_nombre": "…",
//     "banco_rnc": "102012921",             ← el proveedor (Banco Santa Cruz)
//     "proveedor": "Banco Multiple Santa Cruz S A"
//   }]
//
// `cuenta_intereses` es opcional (default 802.01): un préstamo cuyos
// intereses fueran a otra cuenta lo declara. Sin bloque `prestamos`, el
// detector no hace nada — es opt-in por empresa, y así el encendido es
// sembrar el config y nada más.

interface ReglaPrestamo {
  credito: string;
  cuenta: string;
  cuentaNombre: string | null;
  bancoRnc: string;
  proveedor: string;
  cuentaIntereses: string;
  cuentaInteresesNombre: string;
}

// ── Detección por el NOMBRE de la cuenta (el estándar, 2026-08-21) ──────────
//
// La regla del dueño: cada préstamo tiene SU cuenta contable y el nombre lleva
// el número del banco («Prestamo Compra Nave Bayona No. 339547»). Con eso el
// detector no necesita configuración: busca en el plan de cuentas de ADM la
// cuenta de pasivo (2xx) cuyo nombre contenga el número del crédito, y ésa es
// la deuda. Un préstamo nuevo = abrir su cuenta con el número en el nombre, y
// el robot lo agarra solo en la próxima corrida.
//
// El bloque `prestamos` del mapa sigue vivo como OVERRIDE (gana si existe):
// sirve de puente mientras un nombre no tiene el número, y de escape si algún
// día dos productos comparten dígitos.
//
// El match exige el número como corrida de dígitos EXACTA dentro del nombre
// («339547» no matchea «3395470» ni «1339547») y una sola cuenta candidata:
// con cero se avisa qué nombre falta, con dos no se adivina.
function reglaPorNombre(
  credito: string,
  cuentasAdm: Array<{ codigo: string; nombre: string }>,
  bancoRnc: string,
  proveedor: string,
): ReglaPrestamo | { error: string } {
  const candidatas = cuentasAdm.filter((c) =>
    c.codigo.startsWith('2') && ((c.nombre.match(/\d{4,}/g) ?? []) as string[]).includes(credito)
  );
  if (candidatas.length === 0) {
    return {
      error: `ninguna cuenta de pasivo lleva el número ${credito} en el nombre — ` +
        `renombrala o abrila («… No. ${credito}») para que corra solo`,
    };
  }
  if (candidatas.length > 1) {
    return {
      error: `hay ${candidatas.length} cuentas con el número ${credito} en el nombre ` +
        `(${candidatas.map((c) => c.codigo).join(', ')}) — no adivino: dejá una sola o sembrá el override`,
    };
  }
  if (!bancoRnc) {
    return { error: `sin RNC del banco en qualia_catalogo_adm (categoria banco_rnc) — sembralo` };
  }
  return {
    credito,
    cuenta: candidatas[0].codigo,
    cuentaNombre: candidatas[0].nombre,
    bancoRnc,
    proveedor,
    cuentaIntereses: '802.01',
    cuentaInteresesNombre: 'Intereses de Préstamos',
  };
}

/** El plan de cuentas de ADM (codigo + nombre), para el match por nombre.
 * null = no se pudo leer; los créditos sin override quedan con aviso, y los
 * que sí tienen override siguen — un tropiezo de ADM no frena al detector. */
async function cuentasDeAdm(
  supabase: SupabaseClient,
  empresaId: string,
): Promise<Array<{ codigo: string; nombre: string }> | null> {
  try {
    const { data: emp, error } = await supabase
      .from('admcloud_empresas')
      .select('codigo, api_role, api_appid, api_username, api_password')
      .eq('id', empresaId)
      .single();
    if (error || !emp) return null;
    const adm = new AdmCliente(emp as CredAdm);
    const filas = await adm.paginar('Accounts');
    return filas
      .map((c: Record<string, unknown>) => ({
        codigo: String(c?.AccountCode ?? c?.Code ?? '').trim(),
        nombre: String(c?.Name ?? '').trim(),
      }))
      .filter((c) => c.codigo !== '' && c.nombre !== '');
  } catch {
    return null;
  }
}

/** El RNC del banco, del catálogo sembrado (categoria banco_rnc, clave el
 * slug del banco del colector — 'santacruz' → 102012921). */
async function rncDelBanco(
  supabase: SupabaseClient,
  empresaId: string,
  banco: string,
): Promise<string> {
  const { data } = await supabase
    .from('qualia_catalogo_adm')
    .select('nombre')
    .eq('empresa_id', empresaId)
    .eq('categoria', 'banco_rnc')
    .eq('clave', banco)
    .maybeSingle();
  return String(data?.nombre ?? '').replace(/\D/g, '');
}

function reglasDelMapa(bloque: Record<string, unknown>): Map<string, ReglaPrestamo> {
  const reglas = new Map<string, ReglaPrestamo>();
  for (const r of (bloque.prestamos ?? []) as Array<Record<string, unknown>>) {
    const credito = String(r.credito ?? '').trim();
    const cuenta = String(r.cuenta ?? '').trim();
    const rnc = String(r.banco_rnc ?? '').replace(/\D/g, '');
    if (!credito || !cuenta || !rnc) continue; // regla a medias = regla que no existe
    reglas.set(credito, {
      credito,
      cuenta,
      cuentaNombre: (r.cuenta_nombre as string) ?? null,
      bancoRnc: rnc,
      proveedor: String(r.proveedor ?? 'Banco').trim(),
      cuentaIntereses: String(r.cuenta_intereses ?? '802.01').trim(),
      cuentaInteresesNombre: String(r.cuenta_intereses_nombre ?? 'Intereses de Préstamos').trim(),
    });
  }
  return reglas;
}

// ── Snapshot de trabajos: reclamos y estado del grupo ───────────────────────

interface FilaTrabajo {
  id: string;
  estado: string | null;
  archivo_nombre: string | null;
  grupo: string | null;
  rol: string | null;
  fecha: string | null;
  ncf: string | null;
  banco_tx_id: string | null;
  documento_adm: string | null;
  monto: string | null;
  docid: string | null;
  uuid: string | null;
  anulado_en: string | null;
  eliminado_en: string | null;
}

const vivo = (t: FilaTrabajo): boolean => t.anulado_en == null && t.eliminado_en == null;

async function snapshotTrabajos(supabase: SupabaseClient, empresaId: string): Promise<FilaTrabajo[]> {
  return await paginar<FilaTrabajo>((desde, hasta) =>
    supabase
      .from('qualia_trabajos')
      .select(
        'id, estado, archivo_nombre, ' +
          'grupo:propuesta->>grupo_prestamo, ' +
          'rol:propuesta->>rol_prestamo, ' +
          'ncf:propuesta->>ncf, ' +
          'banco_tx_id:propuesta->>banco_tx_id, ' +
          'documento_adm:propuesta->>documento_adm, ' +
          'monto:propuesta->>monto, ' +
        'fecha:propuesta->>fecha, ' +
          'docid:propuesta->registro_adm->>docid, ' +
          'uuid:propuesta->registro_adm->>uuid, ' +
          'anulado_en:propuesta->registro_adm->>anulado_en, ' +
          'eliminado_en:propuesta->registro_adm->>eliminado_en',
      )
      .eq('empresa_id', empresaId)
      .order('id', { ascending: true })
      .range(desde, hasta)
  );
}

// ── Tipos del banco ─────────────────────────────────────────────────────────

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

interface Comprobante {
  ncf: string;
  fecha_emision: string;
  periodo_desde: string | null;
  periodo_hasta: string | null;
  monto_dop: number;
  lineas: Array<Record<string, unknown>> | null;
}

interface InsertTrabajo {
  clave: string; // llave natural para qualia_sombra
  fila: Record<string, unknown>;
}

// ── El detector ─────────────────────────────────────────────────────────────

export async function detectarPrestamos(
  supabase: SupabaseClient,
  empresaId: string,
  modo: Modo,
): Promise<ResultadoPrestamos> {
  if (!/^[0-9a-fA-F-]{36}$/.test(empresaId)) {
    throw new Error(`detectarPrestamos: empresaId no parece UUID: ${JSON.stringify(empresaId)}`);
  }
  if (modo === 'server') {
    return { modo, accion: 'ninguna', facturas: 0, pagos: 0, resumenes: [], avisos: [] };
  }

  const avisos: string[] = [];
  const resumenes: string[] = [];

  // Los OVERRIDES del mapa (opcionales desde que existe el match por nombre):
  // sin bloque `prestamos` el detector corre igual y resuelve la cuenta por el
  // número en el nombre del plan de cuentas.
  const bloque = await cargarMapaCuentas(supabase, empresaId);
  const reglas = reglasDelMapa(bloque);
  // El plan de cuentas se pide UNA vez y sólo si algún crédito lo necesita.
  let cuentasAdmCache: Array<{ codigo: string; nombre: string }> | null | undefined;
  const reglasAuto = new Map<string, ReglaPrestamo>();
  const rncPorBanco = new Map<string, string>();

  // En hora de RD, no UTC: la regla de «mes cerrado» de abajo corta por mes
  // calendario dominicano, igual que la caja de la mesa (misma pareja de
  // reglas que VENTANA_DETECTOR_DIAS: si divergen, una de las dos miente).
  const hoy = hoyRD();
  const desde = restarDias(hoy, DIAS_VENTANA);

  const cuentas = await paginar<Cuenta>((d, h) =>
    supabase
      .from('openbanking_accounts')
      .select('id, banco, nombre, numero, moneda')
      .eq('empresa_id', empresaId)
      .order('id', { ascending: true })
      .range(d, h)
  );
  const cuentaPorId = new Map(cuentas.map((a) => [a.id, a]));
  if (cuentaPorId.size === 0) {
    return { modo, accion: 'ninguna', facturas: 0, pagos: 0, resumenes: [], avisos: [] };
  }

  // Los débitos candidatos. El ilike doble es el pre-filtro del servidor; la
  // regex de verdad corre acá — igual que hace el frontend.
  const transacciones = await paginar<Transaccion>((d, h) =>
    supabase
      .from('openbanking_transactions')
      .select('id, account_id, fecha_posteo, monto, descripcion')
      .in('account_id', [...cuentaPorId.keys()])
      .lt('monto', 0)
      .gte('fecha_posteo', desde)
      .or('descripcion.ilike.%pago de prestamo%,descripcion.ilike.%abono ordinario%')
      .order('id', { ascending: true })
      .range(d, h)
  );
  const debitos = transacciones.filter((t) => RE_PRESTAMO.test(String(t.descripcion ?? '')));
  if (debitos.length === 0) {
    return { modo, accion: 'ninguna', facturas: 0, pagos: 0, resumenes: [], avisos: [] };
  }

  const snapshot = await snapshotTrabajos(supabase, empresaId);
  // Un NCF con dueño vivo por CUALQUIER camino: propuesta.ncf (este detector,
  // el de cargos, un pedido) o el archivo `<ncf>.pdf` del botón «Mandar a la
  // mesa» (que al nacer todavía no tiene propuesta). Rechazada/error no
  // bloquean: ese papel volvió a estar libre, igual que en subirFactura.
  const ncfConDueno = new Set<string>();
  for (const t of snapshot) {
    if (!vivo(t) || t.estado === 'rechazada' || t.estado === 'error') continue;
    if (t.ncf) ncfConDueno.add(t.ncf);
    const m = /^(E\d{12})\.pdf$/i.exec(String(t.archivo_nombre ?? ''));
    if (m) ncfConDueno.add(m[1].toUpperCase());
  }

  const comprobantes = await paginar<Comprobante>((d, h) =>
    supabase
      .from('openbanking_comprobantes')
      .select('ncf, fecha_emision, periodo_desde, periodo_hasta, monto_dop, lineas')
      .gte('fecha_emision', restarDias(hoy, DIAS_VENTANA + 45))
      .order('ncf', { ascending: true })
      .range(d, h)
  );

  const inserts: InsertTrabajo[] = [];
  let facturasNuevas = 0;
  let pagosNuevos = 0;

  for (const tx of debitos) {
    const cuenta = cuentaPorId.get(tx.account_id);
    if (!cuenta) continue;
    const credito = RE_CREDITO.exec(String(tx.descripcion ?? ''))?.[1] ?? null;
    if (!credito) {
      avisos.push(`débito ${tx.id} (${tx.fecha_posteo}): el texto no trae número de crédito — no sé de qué préstamo es`);
      continue;
    }
    // El override del mapa gana; sin él, la cuenta se busca por el número en
    // el nombre del plan de cuentas de ADM (el estándar del dueño).
    let regla = reglas.get(credito) ?? reglasAuto.get(credito) ?? null;
    if (!regla) {
      if (cuentasAdmCache === undefined) cuentasAdmCache = await cuentasDeAdm(supabase, empresaId);
      if (cuentasAdmCache === null) {
        avisos.push(`crédito #${credito}: sin override y no pude leer el plan de cuentas de ADM — reintento en la próxima corrida`);
        continue;
      }
      const banco = String(cuenta.banco ?? '');
      if (!rncPorBanco.has(banco)) {
        rncPorBanco.set(banco, await rncDelBanco(supabase, empresaId, banco));
      }
      const r = reglaPorNombre(credito, cuentasAdmCache, rncPorBanco.get(banco) ?? '', `Banco ${banco}`);
      if ('error' in r) {
        avisos.push(`crédito #${credito}: ${r.error}`);
        continue;
      }
      reglasAuto.set(credito, r);
      regla = r;
    }
    if (String(cuenta.moneda ?? 'DOP') !== 'DOP') {
      // Los e-NCF vienen en DOP; un préstamo en dólares es otro problema.
      avisos.push(`débito ${tx.id}: la cuenta ${cuenta.nombre} no es DOP — este detector sólo arma préstamos en pesos`);
      continue;
    }

    const grupo = `prestamo:${tx.id}`;
    const mesDebito = tx.fecha_posteo.slice(0, 7);
    const delGrupo = snapshot.filter((t) => t.grupo === grupo && vivo(t) && t.estado !== 'rechazada' && t.estado !== 'error');
    const monto = c2(Math.abs(Number(tx.monto)));

    // ── Etapa 2: el pago único, cuando todas las facturas ya viven en ADM ──
    const facturasGrupo = delGrupo.filter((t) => t.documento_adm === 'VendorBills');
    const pagoGrupo = delGrupo.find((t) => t.documento_adm === 'BillPayments');
    if (facturasGrupo.length > 0) {
      if (pagoGrupo) continue; // grupo completo: nada que hacer
      if (!facturasGrupo.every((t) => t.docid)) continue; // aprobar/registrar primero
      const suma = c2(facturasGrupo.reduce((s, t) => s + Number(t.monto ?? 0), 0));
      if (Math.abs(suma - monto) > 0.005) {
        // No puede pasar si la etapa 1 la armó este detector; si pasó, alguien
        // tocó el grupo a mano y el pago NO se inventa.
        avisos.push(`grupo ${grupo}: las facturas suman ${fmtMonto(suma)} y el débito es ${fmtMonto(monto)} — el pago no se siembra, revisá el grupo`);
        continue;
      }
      // La fecha del pago es LA MÁS TARDÍA entre el débito y sus facturas:
      // ADM rechaza aplicar un pago con fecha anterior a la factura («no debe
      // ser posterior a la fecha de aplicación», FP00001175 el 2026-08-21) y
      // los e-NCF de intereses se emiten el 31 mientras el banco debita el
      // ~28. Tres días de corrimiento que la conciliación absorbe (cruza por
      // monto con ventana de días).
      const fechaPago = [tx.fecha_posteo, ...facturasGrupo.map((t) => String(t.fecha ?? ''))]
        .filter((f) => /^\d{4}-\d{2}-\d{2}/.test(f))
        .sort()
        .pop() ?? tx.fecha_posteo;
      const propuesta = stripNulls({
        accion: 'registrar_prestamo',
        grupo_prestamo: grupo,
        rol_prestamo: 'pago',
        documento_adm: 'BillPayments',
        direccion: 'cargo',
        banco_tx_id: tx.id,
        fecha: fechaPago,
        monto,
        moneda: 'DOP',
        banco: cuenta.banco,
        cuenta_banco: cuenta.nombre,
        cuenta_numero: cuenta.numero,
        descripcion: tx.descripcion,
        proveedor: regla.proveedor,
        rnc: regla.bancoRnc,
        metodo: 'script',
        confianza: 0.9,
        asignacion: {
          metodo: 'script',
          proveedor: regla.proveedor,
          facturas: facturasGrupo.map((t) => ({
            docid: t.docid,
            uuid: t.uuid,
            monto: c2(Number(t.monto ?? 0)),
          })),
        },
        detalle: `Pago único de la cuota del préstamo #${credito}: liquida ` +
          facturasGrupo.map((t) => t.docid).join(', ') +
          ` y acredita ${cuenta.nombre} por RD$${fmtMonto(monto)} — un solo documento contra el banco, para que la conciliación cruce 1 a 1 con el débito del ${tx.fecha_posteo}.`,
      });
      inserts.push({
        clave: `${grupo}:pago`,
        fila: {
          empresa_id: empresaId,
          tipo: 'sugerencia',
          origen: 'cron_conciliacion',
          estado: 'propuesta',
          resumen: `Pago del préstamo #${credito} — RD$${fmtMonto(monto)} (${facturasGrupo.length} facturas)`,
          propuesta,
        },
      });
      pagosNuevos += 1;
      resumenes.push(`pago #${credito} ${tx.fecha_posteo} RD$${fmtMonto(monto)}`);
      continue;
    }

    // ── Etapa 1: las facturas del grupo ────────────────────────────────────
    //
    // Sólo con el MES DEL DÉBITO ya cerrado: el banco emite las devengaciones
    // el último día del mes, así que correr antes arriesga armar el grupo con
    // la mitad de los e-NCF — y el capital saldría inflado por resta.
    if (mesDebito >= hoy.slice(0, 7)) continue;

    const ncfsMes = comprobantes.filter((cmp) =>
      String(cmp.periodo_hasta ?? cmp.fecha_emision ?? '').slice(0, 7) === mesDebito &&
      (cmp.lineas ?? []).some((l) => String(l?.cuenta ?? '') === credito)
    );
    if (ncfsMes.length === 0) {
      avisos.push(`débito ${tx.fecha_posteo} #${credito}: sin e-NCF de intereses del mes en el colector — espero`);
      continue;
    }
    const ocupados = ncfsMes.filter((cmp) => ncfConDueno.has(cmp.ncf));
    if (ocupados.length > 0) {
      avisos.push(
        `débito ${tx.fecha_posteo} #${credito}: ${ocupados.map((c) => c.ncf).join(', ')} ya tiene dueño en la mesa — ` +
          'ese camino manda, no siembro un segundo grupo',
      );
      continue;
    }
    const sumaIntereses = c2(ncfsMes.reduce((s, cmp) => s + Number(cmp.monto_dop), 0));
    const capital = c2(monto - sumaIntereses);
    if (capital <= 0) {
      avisos.push(
        `débito ${tx.fecha_posteo} #${credito}: los intereses (${fmtMonto(sumaIntereses)}) igualan o superan ` +
          `el débito (${fmtMonto(monto)}) — esos e-NCF no pueden ser de esta cuota, lo mira un humano`,
      );
      continue;
    }

    for (const cmp of ncfsMes) {
      const montoNcf = c2(Number(cmp.monto_dop));
      const periodo = cmp.periodo_desde && cmp.periodo_hasta
        ? `${cmp.periodo_desde} al ${cmp.periodo_hasta}`
        : mesDebito;
      const propuesta = stripNulls({
        accion: 'registrar_prestamo',
        grupo_prestamo: grupo,
        rol_prestamo: 'intereses',
        documento_adm: 'VendorBills',
        direccion: 'cargo',
        ncf: cmp.ncf,
        // La fecha del documento ES la de emisión del NCF (regla del
        // registrador); el período viaja aparte para la pantalla.
        fecha: cmp.fecha_emision,
        periodo_desde: cmp.periodo_desde,
        periodo_hasta: cmp.periodo_hasta,
        monto: montoNcf,
        itbis: 0,
        moneda: 'DOP',
        banco: cuenta.banco,
        descripcion: tx.descripcion,
        proveedor: regla.proveedor,
        rnc: regla.bancoRnc,
        // 07 Gastos Financieros: el mismo 606 con que se registran las cuotas
        // del leasing del mismo banco (FP00001161/62).
        tipo_gasto: { codigo: '07' },
        metodo: 'script',
        confianza: 0.9,
        cuenta_contable: { codigo: regla.cuentaIntereses, nombre: regla.cuentaInteresesNombre },
        lineas: [{
          descripcion: `Devengación de intereses préstamo #${credito}, período ${periodo}`,
          cantidad: 1,
          precio: montoNcf,
          itbis: 0,
          cuenta: regla.cuentaIntereses,
          cuenta_nombre: regla.cuentaInteresesNombre,
        }],
        detalle: `Intereses del préstamo #${credito} según el e-NCF ${cmp.ncf} del banco ` +
          `(período ${periodo}), exentos de ITBIS. Parte de la cuota de RD$${fmtMonto(monto)} ` +
          `debitada el ${tx.fecha_posteo}; el pago único llega cuando el grupo entero esté en ADM.`,
      });
      inserts.push({
        clave: `${grupo}:${cmp.ncf}`,
        fila: {
          empresa_id: empresaId,
          tipo: 'sugerencia',
          origen: 'cron_conciliacion',
          estado: 'propuesta',
          resumen: `Intereses préstamo #${credito} — ${cmp.ncf} RD$${fmtMonto(montoNcf)}`,
          propuesta,
        },
      });
      facturasNuevas += 1;
    }

    // El capital, por resta y con referencia determinista: sin NCF, la
    // referencia es la única llave con la que ADM frena un duplicado.
    const propuestaCapital = stripNulls({
      accion: 'registrar_prestamo',
      grupo_prestamo: grupo,
      rol_prestamo: 'capital',
      documento_adm: 'VendorBills',
      direccion: 'cargo',
      numero_factura_suplidor: `PRESTAMO-${credito}-${mesDebito.replace('-', '')}`,
      fecha: tx.fecha_posteo,
      monto: capital,
      itbis: 0,
      moneda: 'DOP',
      banco: cuenta.banco,
      descripcion: tx.descripcion,
      proveedor: regla.proveedor,
      rnc: regla.bancoRnc,
      tipo_gasto: { codigo: '07' },
      metodo: 'script',
      confianza: 0.9,
      cuenta_contable: { codigo: regla.cuenta, nombre: regla.cuentaNombre },
      lineas: [{
        descripcion: `Abono a capital préstamo #${credito}, cuota del ${tx.fecha_posteo}`,
        cantidad: 1,
        precio: capital,
        itbis: 0,
        cuenta: regla.cuenta,
        cuenta_nombre: regla.cuentaNombre,
      }],
      detalle: `Abono a capital del préstamo #${credito}: el débito de RD$${fmtMonto(monto)} ` +
        `menos los intereses documentados por ${ncfsMes.length} e-NCF (RD$${fmtMonto(sumaIntereses)}). ` +
        `Baja la deuda en ${regla.cuenta}${regla.cuentaNombre ? ` ${regla.cuentaNombre}` : ''}. Sin NCF: el banco no factura el capital.`,
    });
    inserts.push({
      clave: `${grupo}:capital`,
      fila: {
        empresa_id: empresaId,
        tipo: 'sugerencia',
        origen: 'cron_conciliacion',
        estado: 'propuesta',
        resumen: `Abono a capital préstamo #${credito} — RD$${fmtMonto(capital)}`,
        propuesta: propuestaCapital,
      },
    });
    facturasNuevas += 1;
    resumenes.push(`facturas #${credito} ${mesDebito}: ${ncfsMes.length} intereses + capital ${fmtMonto(capital)}`);
  }

  if (inserts.length === 0) {
    return { modo, accion: 'ninguna', facturas: 0, pagos: 0, resumenes, avisos };
  }

  if (modo === 'sombra') {
    for (const i of inserts) {
      await registrarSombra(FUNCION_SOMBRA, empresaId, i.clave, i.fila);
    }
    return { modo, accion: 'sombra', facturas: facturasNuevas, pagos: pagosNuevos, resumenes, avisos };
  }

  const { error } = await supabase.from('qualia_trabajos').insert(inserts.map((i) => i.fila));
  if (error) throw new Error(`detectarPrestamos: insert en qualia_trabajos falló: ${error.message}`);
  return { modo, accion: 'insertadas', facturas: facturasNuevas, pagos: pagosNuevos, resumenes, avisos };
}
