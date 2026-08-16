// qualia-proponedor/espejos.ts — todo lo que el proponedor lee (y el único
// caché que escribe) del bucket qualia-espejos.
//
// En el server el fuente (mesa/proponer-directo.py) lee el dossier de
// /tmp/mesa/<id>/ y los agg del volumen /opt/data/preentrenamiento/agg. En la
// nube (plan-salida-hermes §5-F2) el equivalente es el bucket privado
// qualia-espejos: el preparador deja el dossier en dossier-cache/<id>/ y el
// puente de espejos (mesa/refrescar-precedentes.sh) sube lo destilado a
// espejo-adm/<empresa>/.

import { sb } from '../_shared/db.ts';
import type { Dic } from './compuertas.ts';

export const BUCKET_ESPEJOS = 'qualia-espejos';

// El caché del preparador (contrato F2 de esta corrida): dossier.json y, si el
// documento tenía capa de texto, texto.txt al lado — el mismo par que el
// fuente esperaba encontrar en /tmp/mesa/<id>/.
export const rutaDossier = (trabajoId: string) => `dossier-cache/${trabajoId}/dossier.json`;
export const rutaTexto = (trabajoId: string) => `dossier-cache/${trabajoId}/texto.txt`;
export const rutaClasificacion = (trabajoId: string) => `dossier-cache/${trabajoId}/clasificacion.json`;

// Los agg que el fuente leía del volumen.
// TODO(F2): el puente de espejos hoy sube SOLO los 6 jsonl crudos a
// espejo-adm/<empresa>/; estos agg y la memoria curada (proveedores.md) NO
// viajan todavía. Hasta extender el puente con estas rutas, la compuerta
// correspondiente degrada TODO a turno — que es exactamente el fallback del
// fuente cuando el volumen no está montado (no hay otro: sin agg no se
// propone, jamás se adivina).
export const rutaAggProveedorCuentas = (empresaId: string) =>
  `espejo-adm/${empresaId}/agg/proveedor-cuentas.json`;
export const rutaAggPlanCuentas = (empresaId: string) =>
  `espejo-adm/${empresaId}/agg/plan-cuentas.json`;
// El tipo de gasto del 606 es de la DGII (por RNC, recorre TODAS las
// empresas), no de una: en el server vive en nucleo-contable/agg/, acá bajo
// nucleo/ sin empresa en la ruta.
export const RUTA_AGG_TIPO_GASTO = 'nucleo/agg/rnc-tipo-gasto.json';
export const rutaMemoriaProveedores = (empresaId: string) =>
  `espejo-adm/${empresaId}/memoria/proveedores.md`;

/** Texto de un objeto del bucket, o null si no está o no se pudo leer. */
export async function descargarTexto(ruta: string): Promise<string | null> {
  const { data, error } = await sb().storage.from(BUCKET_ESPEJOS).download(ruta);
  if (error || !data) return null;
  try {
    return await data.text();
  } catch {
    return null;
  }
}

/**
 * Como descargarJson, pero ESPERANDO una versión: Storage no garantiza que lo
 * recién escrito se lea al instante (medido 2026-08-16: el dossier subido a
 * las :41.983 se leía viejo a las :43). Si el preparador mandó su sello
 * (`preparado_en`), se reintenta con backoff corto hasta verlo; agotados los
 * intentos devuelve lo último leído y el motivo queda en el diff.
 */
export async function descargarJsonFresco(
  ruta: string,
  selloEsperado: string | null,
  campoSello = 'preparado_en',
): Promise<Dic | null> {
  let ultimo: Dic | null = null;
  for (let intento = 0; intento < 5; intento++) {
    ultimo = await descargarJson(ruta);
    if (!selloEsperado) return ultimo;
    if (ultimo && String(ultimo[campoSello] ?? '') === selloEsperado) return ultimo;
    await new Promise((r) => setTimeout(r, 300 * (intento + 1)));
  }
  return ultimo;
}

/** cargar_json del fuente: JSON del bucket; ausente o ilegible = null, jamás
 * una excepción — la compuerta que consuma el null pone el motivo. */
export async function descargarJson(ruta: string): Promise<Dic | null> {
  const texto = await descargarTexto(ruta);
  if (texto === null) return null;
  try {
    const v = JSON.parse(texto) as unknown;
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Dic) : null;
  } catch {
    return null;
  }
}

/**
 * El rastro para quien herede el trabajo (port de escribir_clasificacion del
 * fuente): qué se intentó y por qué no se propuso. Nunca es fatal — es
 * cortesía, no contrato: un fallo acá jamás tumba la corrida.
 */
export async function subirClasificacion(trabajoId: string, salida: Dic): Promise<void> {
  try {
    const cuerpo = new Blob([JSON.stringify(salida, null, 2)], { type: 'application/json' });
    const { error } = await sb().storage
      .from(BUCKET_ESPEJOS)
      .upload(rutaClasificacion(trabajoId), cuerpo, {
        upsert: true,
        contentType: 'application/json',
      });
    if (error) console.error(`clasificacion.json de ${trabajoId}: ${error.message}`);
  } catch (e) {
    console.error(
      `clasificacion.json de ${trabajoId}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
