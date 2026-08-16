// _shared/auth.ts — autorización de los pokes de pg_cron / pg_net.
// Contrato F1 de docs/plan-salida-hermes.md §4.6: los triggers invocan con un
// bearer dedicado, nunca la anon pública ni el service_role en el DDL. Toda
// function de la mudanza responde 401 si !(await autorizado(req)).

import { sb } from './db.ts';

let cacheBearer: { valor: string; leido: number } | null = null;

/**
 * Compara el header Authorization contra el bearer de los crons, exacto.
 *
 * El valor NACE Y VIVE en la base (qualia_config clave 'cron_bearer',
 * migración 20260816000200, generado con gen_random_bytes): de ahí lo leen los
 * jobs de pg_cron para armar su header Y de ahí lo lee esta función para
 * validarlo — así el secreto jamás pasa por un log, un .env ni un deploy. El
 * env QUALIA_CRON_BEARER queda como override manual (si existe, manda), y un
 * secreto ilegible o ausente cierra la puerta, jamás la abre. Cache de 60s
 * para no pagar un SELECT por poke.
 */
export async function autorizado(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return false;
  const presentado = auth.slice(7);

  const env = Deno.env.get('QUALIA_CRON_BEARER');
  if (env) return presentado === env;

  if (!cacheBearer || Date.now() - cacheBearer.leido > 60_000) {
    const { data, error } = await sb()
      .from('qualia_config')
      .select('valor')
      .is('empresa_id', null)
      .eq('clave', 'cron_bearer')
      .single();
    if (error || !data) return false;
    const valor = (data.valor as { bearer?: string }).bearer;
    if (typeof valor !== 'string' || valor === '') return false;
    cacheBearer = { valor, leido: Date.now() };
  }
  return presentado === cacheBearer.valor;
}
