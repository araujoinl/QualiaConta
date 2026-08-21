import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Edge Function: qualia-sugerencias
 *
 * Heredera de los 5 crons `sugerir-*` del gateway Hermes (plan-salida-hermes
 * §3.3 y §5-F1): corre los cinco detectores idempotentes en secuencia, para
 * UNA empresa, y devuelve los conteos por detector. La agenda pg_cron la pone
 * otra fase — esta function sólo atiende el POST.
 *
 * Detectores, en el mismo orden del escalonado del crontab viejo
 * (0,5,10,15,20 pasados de la hora):
 *   cargos          → cargos.ts          (otro constructor de esta corrida)
 *   transferencias  → transferencias.ts
 *   notas_debito    → notas_debito.ts    (otro constructor de esta corrida)
 *   asignacion      → asignacion.ts
 *   recurrentes     → recurrentes.ts
 *
 * Modo (qualia_config, clave 'modo'):
 *   'server' → NO se toca nada; el dueño de las sugerencias sigue siendo el
 *              cron de Hermes en CodeBox. Salida temprana.
 *   'sombra' → se calcula todo pero SOLO se escribe qualia_sombra, con la
 *              llave natural de cada sugerencia, para diffear contra lo que
 *              produce el server.
 *   'nube'   → se escribe de verdad en qualia_trabajos.
 *
 * Contrato heredado que NADIE relaja: los detectores jamás retiran una
 * sugerencia (la única excepción viva es del cron de conciliación, con su
 * firma propia, y no vive acá), y todo reclamo de movimiento bancario se
 * verifica contra las 5 llaves (ver clavesReclamadas en comun.ts).
 *
 * Un detector que revienta no frena a los demás: cada uno corre en su
 * try/catch y el error viaja en el conteo. Son independientes entre sí — así
 * corrían también como crons separados.
 *
 * Body (POST, JSON):
 *   empresa_id            (requerido) UUID de admcloud_empresas
 *   hoy                   (opcional)  YYYY-MM-DD — QUALIA_HOY de recurrentes, para probar
 *   desde_asignacion      (opcional)  YYYY-MM-DD — QUALIA_DESDE de asignacion
 *   dias_transferencias   (opcional)  entero     — QUALIA_DIAS_TRANSFERENCIAS
 */

import { sb, modo } from '../_shared/db.ts';
import { autorizado } from '../_shared/auth.ts';
import { detectarCargos } from './cargos.ts';
import { detectarNotasDebito } from './notas_debito.ts';
import { detectarTransferencias } from './transferencias.ts';
import { detectarAsignacion } from './asignacion.ts';
import { detectarRecurrentes } from './recurrentes.ts';
import { detectarPrestamos } from './prestamos.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (!(await autorizado(req))) {
    return json({ error: 'no autorizado' }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    // sin body: el 400 de abajo lo dice mejor que un error de parseo
  }

  const cliente = sb();

  // Sin empresa_id en el body (el caso del cron: pg_cron manda solo
  // {origen, ts}) se corre para TODAS las empresas con qualia_activa — el
  // detector es por empresa, el cron es de la flota. Con empresa_id, solo esa
  // (mismo cinturón del fuente: lo que no parece UUID no arma SQL).
  let empresas: string[];
  const pedido = String(body.empresa_id ?? '');
  if (pedido !== '') {
    if (!/^[0-9a-fA-F-]{36}$/.test(pedido)) {
      return json({ error: 'empresa_id inválido (UUID de admcloud_empresas)' }, 400);
    }
    empresas = [pedido];
  } else {
    const { data, error } = await cliente
      .from('admcloud_empresas')
      .select('id')
      .eq('qualia_activa', true);
    if (error) return json({ error: `no pude listar empresas activas: ${error.message}` }, 500);
    empresas = (data ?? []).map((f) => String(f.id));
    if (empresas.length === 0) {
      return json({ funcion: 'qualia-sugerencias', empresas: 0, accion: 'ninguna' });
    }
  }

  const porEmpresa: Record<string, unknown> = {};
  for (const empresaId of empresas) {
    porEmpresa[empresaId] = await correrEmpresa(cliente, empresaId, body);
  }
  return json({ funcion: 'qualia-sugerencias', empresas: empresas.length, resultados: porEmpresa });
});

async function correrEmpresa(
  cliente: ReturnType<typeof sb>,
  empresaId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const m = await modo(empresaId, 'qualia-sugerencias');
  if (m === 'server') {
    // El server sigue siendo el dueño: esta function no toca nada.
    return { empresa_id: empresaId, modo: 'server', accion: 'ninguna' };
  }

  // TODO(F1, integración): la firma (cliente, empresaId, modo) es la de los
  // detectores de este directorio; cargos.ts y notas_debito.ts los construye
  // otra pieza de esta corrida con los nombres garantizados por contrato —
  // verificar la firma al integrar. `normalizar` tolera mientras tanto un
  // retorno con otra forma (número pelado u objeto propio).
  const detectores: [string, () => Promise<unknown>][] = [
    ['cargos', () => detectarCargos(cliente, empresaId, m)],
    ['transferencias', () =>
      detectarTransferencias(cliente, empresaId, m, {
        dias: body.dias_transferencias == null ? undefined : Number(body.dias_transferencias),
      })],
    ['notas_debito', () => detectarNotasDebito(cliente, empresaId, m)],
    ['asignacion', () =>
      detectarAsignacion(cliente, empresaId, m, {
        desde: body.desde_asignacion == null ? undefined : String(body.desde_asignacion),
      })],
    ['recurrentes', () =>
      detectarRecurrentes(cliente, empresaId, m, {
        hoy: body.hoy == null ? undefined : String(body.hoy),
      })],
    // Sexto detector (2026-08-21): el pago mensual de préstamo, en dos etapas
    // (facturas por e-NCF + capital, y el pago único cuando el grupo ya vive
    // en ADM). Opt-in: sin bloque `prestamos` en el mapa no hace nada.
    ['prestamos', () => detectarPrestamos(cliente, empresaId, m)],
  ];

  const normalizar = (r: unknown): Record<string, unknown> => {
    if (typeof r === 'number') return { sembradas: r };
    if (r !== null && typeof r === 'object') return r as Record<string, unknown>;
    return { resultado: r ?? null };
  };

  const inicio = Date.now();
  const conteos: Record<string, unknown> = {};
  let errores = 0;
  for (const [nombre, correr] of detectores) {
    try {
      conteos[nombre] = { ok: true, ...normalizar(await correr()) };
    } catch (e) {
      errores++;
      conteos[nombre] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return {
    empresa_id: empresaId,
    modo: m,
    errores,
    duracion_ms: Date.now() - inicio,
    detectores: conteos,
  };
}
