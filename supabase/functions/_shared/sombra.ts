// _shared/sombra.ts — el único destino de escritura permitido en modo sombra.
// Contrato F1 de docs/plan-salida-hermes.md §5-F1/§5-F2: en sombra la function
// calcula todo pero SOLO escribe acá; el diff contra lo que produce el server
// es lo que autoriza el cutover.
import { sb } from './db.ts';

/**
 * Registra lo que la function HARÍA, sin hacerlo.
 *
 * `clave` es la llave de dedup para diffear contra el server: la misma decisión
 * calculada dos veces (dos corridas del cron, un re-poke del barrido) debe
 * llegar con la misma clave, así el comparador agrupa en vez de contar
 * duplicados como diferencias.
 *
 * Lanza si el insert falla, a propósito: en sombra esta escritura ES el
 * producto — una sombra que falla callada deja un diff vacío que se leería
 * como "equivalente al server", el falso verde exacto que la fase no se puede
 * permitir.
 */
export async function registrarSombra(
  funcion: string,
  empresaId: string | null,
  clave: string,
  payload: unknown,
): Promise<void> {
  const { error } = await sb().from('qualia_sombra').insert({
    funcion,
    empresa_id: empresaId,
    clave,
    payload: payload ?? null,
  });
  if (error) {
    throw new Error(`registrando sombra ${funcion}/${clave}: ${error.message}`);
  }
}
