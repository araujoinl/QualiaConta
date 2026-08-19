// qualia-preparador/comun.ts — tipos y helpers que comparten los módulos del
// preparador. El mapa de bloques del fuente (mesa/preparar-trabajo.sh) vive en
// el encabezado de index.ts; acá solo está lo que necesita más de un módulo.

// Versión del dossier = versión de la lógica de extracción. Un dossier de otra
// versión está vencido aunque el documento sea el mismo. Vive acá y no en
// index.ts porque el CONTABLE también la necesita: es él quien decide si el
// dossier que encuentra le sirve o hay que re-poke al preparador.
export const PREP_VERSION = 3;

export type Extraccion = Record<string, unknown>;

export interface ItemDoc {
  descripcion: string;
  cantidad: number;
  precio: number;
  itbis: number;
}

// Texto EXACTO del fuente: el proponedor y el turno citan esta nota, y el diff
// de sombra contra el dossier del server la compara literal.
export const NOTA_EXTR =
  'extraccion automatica; el agente DEBE verificar contra el documento';

export function fragNinguno(nota: string): Extraccion {
  return { metodo: 'ninguno', nota };
}

// Replica el round(x, 2) de Python para dinero. OJO: Python redondea
// half-to-even y esto half-up — la diferencia solo aparece en el medio centavo
// exacto y el umbral de cuadre (0.05) la absorbe. Aceptado con nombre.
export const round2 = (x: number): number =>
  Math.round((x + Number.EPSILON) * 100) / 100;

export async function sha256hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// btoa por bloques: el spread de un array de megabytes revienta el stack.
export function aBase64(bytes: Uint8Array): string {
  let bin = '';
  const paso = 0x8000;
  for (let i = 0; i < bytes.length; i += paso) {
    bin += String.fromCharCode(...bytes.subarray(i, i + paso));
  }
  return btoa(bin);
}

/**
 * Plazo duro alrededor de una promesa — el `timeout N` que el fuente ponía a
 * cada pierna externa. La promesa perdedora sigue corriendo de fondo (fetch ya
 * disparado), pero el prep no la espera: dentro de waitUntil eso es inocuo y
 * es exactamente lo que hacía el timeout de bash con el proceso hijo.
 */
export function conPlazo<T>(p: Promise<T>, ms: number, etiqueta: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${etiqueta}: excedio el plazo de ${Math.round(ms / 1000)}s`)),
      ms,
    );
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
