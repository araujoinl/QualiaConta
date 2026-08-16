// qualia-contable/espejos.ts — dónde vive lo que el turno LEE del bucket
// privado `qualia-espejos`: el cache que dejó el preparador y los agg que sube
// el puente de espejos (mesa/refrescar-precedentes.sh).
//
// Estas rutas están duplicadas de qualia-proponedor/espejos.ts y de
// qualia-preparador/dedup.ts a propósito, con el mismo criterio que index.ts:
// son el contrato de UBICACIÓN de un archivo en un bucket, ya vivían
// duplicadas entre esas dos piezas, e importarlas cruzado ataría el bundle del
// turno al del preparador. Si una ruta cambia, cambia en las tres.

export const BUCKET_ESPEJOS = 'qualia-espejos';

// El cache del preparador (F2): dossier.json y, si el documento tenía capa de
// texto, texto.txt al lado — el par que el chasis viejo dejaba en /tmp/mesa/<id>/.
export const rutaDossier = (trabajoId: string) => `dossier-cache/${trabajoId}/dossier.json`;
export const rutaTexto = (trabajoId: string) => `dossier-cache/${trabajoId}/texto.txt`;
export const rutaClasificacion = (trabajoId: string) => `dossier-cache/${trabajoId}/clasificacion.json`;

// Los agg destilados del histórico de la empresa.
export const rutaAggProveedorCuentas = (empresaId: string) =>
  `espejo-adm/${empresaId}/agg/proveedor-cuentas.json`;
export const rutaAggPlanCuentas = (empresaId: string) =>
  `espejo-adm/${empresaId}/agg/plan-cuentas.json`;
// El tipo de gasto del 606 es de la DGII y cruza TODAS las empresas (por RNC):
// por eso vive bajo nucleo/ y no lleva empresa en la ruta.
export const RUTA_AGG_TIPO_GASTO = 'nucleo/agg/rnc-tipo-gasto.json';
