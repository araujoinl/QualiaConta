// qualia-preparador/qr.ts — bloque 4b del fuente: el QR del e-CF manda sobre
// lo que diga el texto.
//
// La representación impresa de un e-CF trae un QR que ES la consulta del
// timbre ya armada, y adentro viaja un dato que el papel NO imprime: la HORA
// de la firma. DGII exige el segundo exacto, así que armar la URL leyendo el
// texto está condenado a fallar (verificado 2026-08-06 sobre la E310016169496:
// solo la URL del QR da «Aceptado»). Y de paso corrige lo que el texto lee
// mal: el QR es lo que el emisor firmó; el texto, lo que un regex creyó
// entender de un papel. Por eso el QR PISA al texto y no al revés.
//
// El contenido del QR es input hostil como todo lo que sale del documento:
// acá NO se sigue la URL ni se ejecuta nada — solo se le sacan parámetros, y
// solo si el host es el de DGII. Cada valor lo re-valida el bloque 5 igual.
//
// Plataforma (medido en F0.3): raster con pdfium-WASM scale 3, decodificación
// con jsQR — 187ms el render, <1s el total con un e-CF real.

import { Extraccion, round2 } from './comun.ts';

export interface PaginaRGBA {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const ESCALA_QR = 3;

/**
 * Rasteriza las 2 primeras páginas de un PDF. Sólo las dos primeras: el
 * timbre va en la representación impresa, no en los anexos de una factura de
 * 40 hojas. La página 1 también le sirve al caller como imagen para visión
 * cuando el PDF no trae capa de texto.
 */
export async function rasterizarPdf(bytes: Uint8Array): Promise<PaginaRGBA[]> {
  const { PDFiumLibrary } = await import('npm:@hyzyla/pdfium@2.1.13');
  const lib = await PDFiumLibrary.init();
  try {
    const doc = await lib.loadDocument(bytes);
    try {
      const total = Math.min(2, doc.getPageCount());
      const paginas: PaginaRGBA[] = [];
      for (let i = 0; i < total; i++) {
        try {
          const pagina = doc.getPage(i);
          const img = await pagina.render({ scale: ESCALA_QR, render: 'bitmap' });
          paginas.push({
            data: new Uint8ClampedArray(img.data),
            width: img.width,
            height: img.height,
          });
        } catch {
          continue; // una página que no abre no invalida a las demás
        }
      }
      return paginas;
    } finally {
      doc.destroy();
    }
  } finally {
    lib.destroy();
  }
}

/**
 * Decodifica una foto (jpg/png) a RGBA para el lector de QR. En el server
 * zxing+PIL leían cualquier formato; acá webp/HEIC quedan sin decodificador —
 * el caller lo anota y sigue, que es el degradado correcto (una factura
 * impresa B01 tampoco trae QR y nadie la considera rota).
 */
export async function decodificarImagen(bytes: Uint8Array, ext: string): Promise<PaginaRGBA | null> {
  if (ext === 'jpg' || ext === 'jpeg') {
    const jpeg = await import('npm:jpeg-js@0.4.4');
    const img = jpeg.decode(bytes, {
      useTArray: true,
      maxResolutionInMP: 30,
      maxMemoryUsageInMB: 220,
    });
    let { width, height } = img;
    let data = new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength);
    // jsQR sobre una foto de iPhone completa (12MP+) quema el tope de CPU de
    // la plataforma: se muestrea 1 de cada 2 píxeles — el QR de un e-CF
    // sobrevive de sobra a la mitad de resolución.
    while (width * height > 6_000_000) {
      const w2 = Math.floor(width / 2);
      const h2 = Math.floor(height / 2);
      const d2 = new Uint8ClampedArray(w2 * h2 * 4);
      for (let y = 0; y < h2; y++) {
        for (let x = 0; x < w2; x++) {
          const desde = (y * 2 * width + x * 2) * 4;
          const hacia = (y * w2 + x) * 4;
          d2[hacia] = data[desde];
          d2[hacia + 1] = data[desde + 1];
          d2[hacia + 2] = data[desde + 2];
          d2[hacia + 3] = data[desde + 3];
        }
      }
      data = d2;
      width = w2;
      height = h2;
    }
    return { data, width, height };
  }
  if (ext === 'png') {
    const { decode } = await import('npm:fast-png@8.0.0');
    const img = decode(bytes);
    if (img.depth !== 8) return null;
    const canales = img.channels ?? 4;
    if (canales === 4) {
      return {
        data: new Uint8ClampedArray(img.data as Uint8Array),
        width: img.width,
        height: img.height,
      };
    }
    if (canales === 3) {
      const rgba = new Uint8ClampedArray(img.width * img.height * 4);
      const src = img.data as Uint8Array;
      for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
        rgba[j] = src[i];
        rgba[j + 1] = src[i + 1];
        rgba[j + 2] = src[i + 2];
        rgba[j + 3] = 255;
      }
      return { data: rgba, width: img.width, height: img.height };
    }
    return null;
  }
  return null;
}

/** PNG de una página rasterizada, para mandarla a visión como data URL. */
export async function paginaAPng(p: PaginaRGBA): Promise<Uint8Array> {
  const { encode } = await import('npm:fast-png@8.0.0');
  return encode({
    width: p.width,
    height: p.height,
    data: new Uint8Array(p.data.buffer, p.data.byteOffset, p.data.byteLength),
    channels: 4,
  });
}

// Sólo se acepta un QR que apunte a la consulta de timbre de DGII. Cualquier
// otra cosa dentro del QR de un documento de un tercero es una URL ajena y no
// se toca: no se sigue, no se guarda, no se muestra.
const HOST_DGII = 'ecf.dgii.gov.do';
const CAMPOS_QR: Array<[string, string, RegExp]> = [
  ['RncEmisor', 'rnc', /^\d{9}$|^\d{11}$/],
  ['RncComprador', 'rnc_comprador', /^\d{9}$|^\d{11}$/],
  ['ENCF', 'ncf', /^E\d{12}$/],
  ['FechaEmision', 'fecha', /^\d{2}-\d{2}-\d{4}$/],
  ['MontoTotal', 'monto', /^\d+(\.\d{1,2})?$/],
  ['FechaFirma', 'fecha_firma', /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/],
  ['CodigoSeguridad', 'codigo_seguridad', /^[A-Za-z0-9+/=]{6}$/],
];

export interface ResultadoQr {
  encontrado: boolean;
  campos?: Record<string, string>;
  motivo?: string;
}

// jsqr publica CJS y según el interop el callable queda en default o en
// default.default: se resuelve en runtime y se tipa a mano.
type FnJsQR = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;

async function cargarJsQR(): Promise<FnJsQR> {
  const mod = await import('npm:jsqr@1.4.0') as Record<string, unknown>;
  const def = mod.default;
  if (typeof def === 'function') return def as FnJsQR;
  const anidado = (def as Record<string, unknown> | undefined)?.default;
  if (typeof anidado === 'function') return anidado as FnJsQR;
  throw new Error('jsqr sin export callable');
}

/** Busca en las páginas un QR de timbre e-CF válido. */
export async function buscarTimbreEnQr(paginas: PaginaRGBA[]): Promise<ResultadoQr> {
  const jsQR = await cargarJsQR();
  for (const p of paginas) {
    let texto = '';
    try {
      const r = jsQR(p.data, p.width, p.height);
      if (!r || !r.data) continue;
      texto = String(r.data).trim();
    } catch {
      continue;
    }
    let u: URL;
    try {
      u = new URL(texto);
    } catch {
      continue;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    if (u.hostname.toLowerCase() !== HOST_DGII) continue;
    if (!/\/ConsultaTimbre(FC)?\/?$/i.test(u.pathname)) continue;
    const leidos: Record<string, string> = {};
    for (const [param, clave, patron] of CAMPOS_QR) {
      const v = (u.searchParams.get(param) ?? '').trim();
      if (v && patron.test(v)) leidos[clave] = v;
    }
    // Sin e-NCF no hay timbre que consultar: el QR no sirvió.
    if (!('ncf' in leidos)) continue;
    return { encontrado: true, campos: leidos };
  }
  return { encontrado: false };
}

/**
 * Fusión con lo que sacó el texto/visión. El QR pisa, y queda anotado QUÉ
 * pisó: sin ese rastro, un campo corregido y uno leído bien se ven igual, y el
 * contable no puede saber a cuál creerle si después no cuadran. Muta `ex`.
 */
export function fusionarQr(ex: Extraccion, camposQr: Record<string, string>): void {
  const corrigio: Record<string, { texto: unknown; qr: unknown }> = {};
  for (const [clave, crudo] of Object.entries(camposQr)) {
    let v: string | number = crudo;
    if (clave === 'fecha') {
      const [d, m, a] = crudo.split('-'); // el QR trae DD-MM-AAAA
      v = `${a}-${m}-${d}`;
    } else if (clave === 'monto') {
      v = parseFloat(crudo);
    }
    const previo = ex[clave];
    if (previo !== null && previo !== undefined && String(previo) !== String(v)) {
      corrigio[clave] = { texto: previo, qr: v };
    }
    ex[clave] = v;
  }
  ex.timbre_qr = true;
  if (Object.keys(corrigio).length > 0) ex.qr_corrigio = corrigio;

  // El QR pisa el monto, pero la aritmética ya venía calculada contra el del
  // TEXTO: sin recalcular, el dossier queda diciendo "no cuadra" por un dato
  // que este mismo bloque acaba de corregir, y el proponedor manda a sesión
  // LLM una factura sana (medido 2026-08-11: 9 de 84 mueren en esa compuerta,
  // 6 con timbre leído del QR).
  const arit = ex.aritmetica as Record<string, unknown> | undefined;
  if ('monto' in corrigio && arit && typeof arit === 'object' && typeof ex.monto === 'number') {
    const base = typeof arit.base_items === 'number' ? arit.base_items : 0;
    // el que se usó para cuadrar (renglones o cabecera), no el crudo
    let itbisItems = arit.itbis_cuadre;
    if (typeof itbisItems !== 'number') {
      itbisItems = typeof arit.itbis_items === 'number' ? arit.itbis_items : 0;
    }
    let propina = typeof arit.propina === 'number' ? arit.propina : 0;
    // Una propina INFERIDA salió del descuadre contra el monto viejo: con otro
    // monto esa inferencia ya no vale. Se descarta y se vuelve a intentar desde
    // cero con el mismo criterio del extractor (10% de la base, ±1 peso). Una
    // propina LEÍDA del papel no se toca.
    if (ex.propina_inferida) {
      propina = 0;
      delete ex.propina;
      delete ex.propina_inferida;
      delete arit.nota;
      const diff = round2(ex.monto - round2(base + (itbisItems as number)));
      if (diff > 0 && Math.abs(diff - round2(0.10 * base)) <= 1.0) {
        propina = diff;
        ex.propina = propina;
        ex.propina_inferida = true;
        arit.nota = 'propina legal 10% inferida del descuadre exacto; verificable en el documento';
      }
    }
    const calc = round2(base + (itbisItems as number) + propina);
    arit.propina = propina;
    arit.calculado = calc;
    arit.monto_documento = ex.monto;
    // Umbral 0.05: el MISMO que valida la web al aprobar.
    arit.cuadra = Math.abs(calc - ex.monto) <= 0.05;
    arit.recalculada_con_qr = true;
  }
}
