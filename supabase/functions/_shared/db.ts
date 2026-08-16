// _shared/db.ts — cliente Supabase y flag de modo del pipeline serverless.
// Contrato F1 de docs/plan-salida-hermes.md (§4, §5-F1): toda function de la
// mudanza obtiene su cliente y su modo de operación por acá, nunca por su cuenta.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// TODO(F4): cambiar a llave restringida. Hoy service_role como toda la flota
// admcloud-*; el plan §4.6 exige partir credenciales y permisos ANTES de
// encender la escritura — este es el punto único donde se cambia.
let cliente: SupabaseClient | null = null;

export function sb(): SupabaseClient {
  if (!cliente) {
    cliente = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
  }
  return cliente;
}

export type Modo = 'server' | 'sombra' | 'nube';
const MODOS = new Set<string>(['server', 'sombra', 'nube']);

/**
 * El flag de cutover (plan §5): 'server' = la function no toca nada, 'sombra' =
 * calcula todo pero solo escribe qualia_sombra, 'nube' = escribe de verdad.
 *
 * Resolución: fila de la empresa > fila global (empresa_id null) > 'server'.
 * El default duro es 'server' y también es la salida ante base ilegible o valor
 * con forma rara: un flag que no se puede leer jamás autoriza a escribir —
 * mismo criterio fail-safe que el kill-switch de F4 (§4.6, "ausencia o valor
 * inválido = no seguir con lo último").
 */
export async function modo(empresaId: string | null): Promise<Modo> {
  const { data, error } = await sb()
    .from('qualia_config')
    .select('empresa_id, valor')
    .eq('clave', 'modo');
  if (error || !data) {
    console.error(`modo(): qualia_config ilegible (${error?.message ?? 'sin datos'}); asumo server`);
    return 'server';
  }
  // El filtro por empresa se hace acá y no con .or() interpolado: empresa_id
  // viene del caller y así jamás viaja crudo dentro de un string de filtro.
  const fila =
    (empresaId ? data.find((f) => f.empresa_id === empresaId) : undefined) ??
    data.find((f) => f.empresa_id === null);
  const valor = (fila?.valor as { modo?: unknown } | null | undefined)?.modo;
  return typeof valor === 'string' && MODOS.has(valor) ? (valor as Modo) : 'server';
}

/**
 * Valor jsonb de una clave GLOBAL de qualia_config (empresa_id null), o null si
 * no hay fila o la base no responde. Los topes del freno de cuota y del gate de
 * concurrencia son globales a propósito: la cuota de z.AI es por CUENTA, no por
 * empresa (medido en modelo-zai.md), así que un tope por empresa mentiría.
 */
export async function configGlobal(clave: string): Promise<unknown | null> {
  const { data, error } = await sb()
    .from('qualia_config')
    .select('valor')
    .eq('clave', clave)
    .is('empresa_id', null)
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0].valor;
}
