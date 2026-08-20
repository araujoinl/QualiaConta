// _shared/guardas.ts — las guardas duras del registrador (F4 §3).
//
// Todas son FAIL-SAFE: ausencia, valor inválido o base ilegible = NO escribir.
// Mismo criterio que modo() en db.ts: «un flag que no se puede leer jamás
// autoriza a escribir».

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { configNumero } from './db.ts';
import type { AdmCliente } from './adm.ts';

/** Resultado de una guarda: pasa, o frena con su motivo (evento registro_frenado). */
export type Veredicto = { ok: true } | { ok: false; motivo: string };

const OK: Veredicto = { ok: true };

/**
 * Kill-switch de escritura (§3, default OFF): qualia_config clave 'escritura',
 * por empresa con respaldo global, {"modo":"on"} para encender. Cualquier otra
 * cosa — ausencia, error, forma rara — es NO escribir.
 */
export async function escrituraEncendida(sb: SupabaseClient, empresaId: string): Promise<boolean> {
  const { data, error } = await sb
    .from('qualia_config')
    .select('empresa_id, valor')
    .eq('clave', 'escritura');
  if (error || !data) return false;
  const fila = data.find((f) => f.empresa_id === empresaId) ??
    data.find((f) => f.empresa_id === null);
  return (fila?.valor as { modo?: unknown } | null)?.modo === 'on';
}

/** Tope de monto por documento (§3.2). Default RD$25.000; Carlos lo sube por config. */
export async function topeMonto(empresaId: string): Promise<number> {
  return await configNumero(empresaId, 'tope_monto_documento', 25_000);
}

export async function topeDiario(empresaId: string): Promise<number> {
  return await configNumero(empresaId, 'tope_diario_escrituras', 20);
}

/**
 * Backdating (§3.4): un documento del mes M se registra hasta el día 5 del mes
 * M+1, EN HORA LOCAL de República Dominicana. Después, sólo con waiver humano
 * explícito en la propuesta (`waiver_backdating: true`, lo pone la web).
 */
export function backdatingOk(fechaDoc: string, waiver: boolean): Veredicto {
  const f = String(fechaDoc ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return { ok: false, motivo: `fecha ilegible: '${fechaDoc}'` };
  if (waiver) return OK;

  // Hora local RD (UTC-4, sin horario de verano).
  const ahora = new Date(Date.now() - 4 * 3600 * 1000);
  const hoy = ahora.toISOString().slice(0, 10);
  const [ay, am] = [ahora.getUTCFullYear(), ahora.getUTCMonth()];
  const [dy, dm] = [Number(f.slice(0, 4)), Number(f.slice(5, 7)) - 1];

  if (f > hoy) return { ok: false, motivo: `fecha futura: ${f}` };
  const mesesAtras = (ay - dy) * 12 + (am - dm);
  if (mesesAtras === 0) return OK;
  if (mesesAtras === 1 && ahora.getUTCDate() <= 5) return OK;
  return {
    ok: false,
    motivo: `backdating: el documento es de ${f.slice(0, 7)} y la ventana del mes anterior ` +
      `cerró el día 5 — sólo un waiver humano explícito lo levanta`,
  };
}

// Qué bandera de cierre de período aplica a cada recurso. GL cierra todo.
const MODULO_POR_RECURSO: Record<string, string> = {
  VendorBills: 'AP_Closed',
  VendorCreditNotes: 'AP_Closed',
  BillPayments: 'AP_Closed',
  AccountPayments: 'AP_Closed',
  BankCharges: 'BR_Closed',
  BankBankTransfers: 'BR_Closed',
  Journals: 'GL_Closed',
};

/**
 * Período contable cerrado (§3, sin waiver posible). La forma medida el
 * 2026-08-20: /api/AccountingPeriods trae FromDate/ToDate y banderas por
 * módulo (GL_Closed, AP_Closed, BR_Closed…). Fecha sin período en la lista o
 * períodos ilegibles = FRENAR: escribir a ciegas en un período que no podemos
 * ver es exactamente lo que esta guarda existe para impedir.
 */
export async function periodoAbierto(
  adm: AdmCliente,
  recurso: string,
  fechaDoc: string,
): Promise<Veredicto> {
  const f = String(fechaDoc ?? '').slice(0, 10);
  // deno-lint-ignore no-explicit-any
  let periodos: any[];
  try {
    periodos = await adm.paginar('AccountingPeriods');
  } catch (e) {
    return { ok: false, motivo: `no pude leer AccountingPeriods: ${(e as Error).message}` };
  }
  const p = periodos.find((x) =>
    String(x?.FromDate ?? '').slice(0, 10) <= f && f <= String(x?.ToDate ?? '').slice(0, 10)
  );
  if (!p) return { ok: false, motivo: `la fecha ${f} no cae en ningún período contable de ADM` };
  const flag = MODULO_POR_RECURSO[recurso] ?? 'GL_Closed';
  if (p.GL_Closed === true || p[flag] === true) {
    return {
      ok: false,
      motivo: `el período ${p.PeriodName ?? f.slice(0, 7)} está cerrado (${
        p.GL_Closed ? 'GL' : flag
      }) — sin waiver posible`,
    };
  }
  return OK;
}

// La nómina jamás va autónoma (§6): cuentas 611.x, 210.04-210.10, 220.0x.
const RE_CUENTA_NOMINA = /^(611\.|210\.(0[4-9]|10)$|220\.0)/;

export function candadoNomina(cuentas: string[]): Veredicto {
  const tocadas = cuentas.filter((c) => RE_CUENTA_NOMINA.test(String(c ?? '').trim()));
  if (tocadas.length) {
    return {
      ok: false,
      motivo: `toca cuentas de nómina (${tocadas.join(', ')}): la nómina jamás va autónoma — ` +
        `ruta humana del §6, no ésta`,
    };
  }
  return OK;
}

/** sha256 del JSON canónico (claves ordenadas) — la huella del evento §4.3. */
export async function hashPayload(payload: unknown): Promise<string> {
  const canonico = JSON.stringify(ordenar(payload));
  const bytes = new TextEncoder().encode(canonico);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function ordenar(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(ordenar);
  if (x && typeof x === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(x as Record<string, unknown>).sort()) {
      o[k] = ordenar((x as Record<string, unknown>)[k]);
    }
    return o;
  }
  return x;
}
