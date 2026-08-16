// qualia-preparador/extraccion.ts — bloques 3 y 4 del fuente: tipo de
// documento, texto del PDF y campos por regex, y el XML e-CF con renglones.
//
// Port fiel de mesa/preparar-trabajo.sh. Cada regex rara de acá pagó su bug
// con un incidente real; antes de "mejorar" una, leer el comentario que tiene
// al lado en el fuente.

import { XMLParser, XMLValidator } from 'npm:fast-xml-parser@4.5.3';
import { Extraccion, ItemDoc, NOTA_EXTR, round2 } from './comun.ts';

// ───────────────────────── tipo de documento (bloque 3) ─────────────────────

export interface TipoDetectado {
  tipo: 'pdf' | 'imagen' | 'xml' | 'excel' | 'desconocido';
  esHeic: boolean;
}

const BRANDS_HEIC = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

// El `file -b --mime-type` del fuente, reducido a los sniffs que el prep usa.
function sniffMime(bytes: Uint8Array): string {
  const ascii = (desde: number, hasta: number) =>
    String.fromCharCode(...bytes.subarray(desde, Math.min(hasta, bytes.length)));
  if (ascii(0, 4) === '%PDF') return 'application/pdf';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && ascii(4, 8) === 'ftyp' && BRANDS_HEIC.has(ascii(8, 12).toLowerCase())) {
    return 'image/heic';
  }
  const inicio = new TextDecoder().decode(bytes.subarray(0, 200)).trimStart();
  if (inicio.startsWith('<?xml') || /^<[A-Za-z!]/.test(inicio)) return 'text/xml';
  return '';
}

export function tipoDocumento(ext: string, bytes: Uint8Array): TipoDetectado {
  switch (ext) {
    case 'pdf':
      return { tipo: 'pdf', esHeic: false };
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'webp': {
      // iPhone/WhatsApp renombran HEIC como .jpg al compartir: el CONTENIDO
      // manda — sin este sniff la visión recibía bytes HEIC como image/jpeg y
      // fallaba en silencio (hallazgo de auditoría del fuente).
      const mime = sniffMime(bytes);
      return { tipo: 'imagen', esHeic: mime === 'image/heic' };
    }
    case 'heic':
    case 'heif':
      return { tipo: 'imagen', esHeic: true };
    case 'xml':
      return { tipo: 'xml', esHeic: false };
    case 'xls':
    case 'xlsx':
      return { tipo: 'excel', esHeic: false };
    default: {
      // Extensión fuera de la lista blanca: se clasifica por contenido, y si
      // tampoco, queda desconocido sin extracción (mismo degradado del fuente).
      switch (sniffMime(bytes)) {
        case 'application/pdf': return { tipo: 'pdf', esHeic: false };
        case 'image/jpeg':
        case 'image/png':
        case 'image/webp': return { tipo: 'imagen', esHeic: false };
        case 'image/heic': return { tipo: 'imagen', esHeic: true };
        case 'text/xml': return { tipo: 'xml', esHeic: false };
        default: return { tipo: 'desconocido', esHeic: false };
      }
    }
  }
}

// ─────────────────────────── texto del PDF (unpdf) ──────────────────────────

/** Texto de todo el PDF. Vacío o solo espacios = escaneado (decide el caller). */
export async function extraerTextoPdf(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('npm:unpdf@1.8.1');
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: true });
  return typeof text === 'string' ? text : String(text ?? '');
}

// ────────────────── campos por regex sobre el texto (bloque 4) ──────────────

const RE_MONTO = /(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})/g;

function montosEn(linea: string): number[] {
  return (linea.match(RE_MONTO) ?? []).map((x) => parseFloat(x.replace(/,/g, '')));
}

/**
 * Regex prudentes sobre el texto (SPEC 6): NCF, RNC, montos con contexto
 * TOTAL/ITBIS, fecha, moneda, y los extras del e-CF impreso. Confianza media.
 */
export function extraerCamposTexto(texto: string, metodo: string): Extraccion {
  const out: Extraccion = { metodo, confianza: 'media', nota: NOTA_EXTR };

  // NCF: regex del SPEC, validado a largo exacto (B+10 / E+12)
  for (const m of texto.match(/\b[BE]\d{10,12}\b/g) ?? []) {
    if (/^(B\d{10}|E\d{12})$/.test(m)) { out.ncf = m; break; }
  }

  // RNC: con contexto. El primero etiquetado se asume del emisor (encabeza el
  // documento); el segundo distinto, del comprador — habilita el timbre e-CF.
  const rncs: string[] = [];
  for (const m of texto.matchAll(/RNC[^0-9]{0,20}(\d[\d.\- ]{6,14}\d)/gi)) {
    const limpio = m[1].replace(/\D/g, '');
    if ((limpio.length === 9 || limpio.length === 11) && !rncs.includes(limpio)) rncs.push(limpio);
  }
  if (rncs.length === 0) {
    const m = texto.match(/\b(\d{9})\b/); // último recurso: 9 dígitos sueltos
    if (m) rncs.push(m[1]);
  }
  if (rncs.length > 0) out.rnc = rncs[0];
  if (rncs.length > 1) out.rnc_comprador = rncs[1];

  const tot: number[] = [];
  const itb: number[] = [];
  for (const linea of texto.split('\n')) {
    if (/\bITBIS\b/i.test(linea)) itb.push(...montosEn(linea));
    if (/\bTOTAL\b/i.test(linea) && !/SUB\s*-?\s*TOTAL/i.test(linea)) tot.push(...montosEn(linea));
  }
  if (tot.length > 0) out.monto = Math.max(...tot); // el total final es el mayor de las líneas TOTAL
  if (itb.length > 0) {
    const cand = itb.filter((x) => typeof out.monto !== 'number' || x <= (out.monto as number));
    if (cand.length > 0) out.itbis = Math.max(...cand);
  }

  const mFecha =
    texto.match(/Fecha\s*(?:de\s*)?Emisi[oó]n[^0-9]{0,20}(\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2})/i) ??
    texto.match(/\bFecha\b[^0-9]{0,20}(\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2})/i);
  if (mFecha) {
    const f = mFecha[1].replace(/\//g, '-');
    const mm = f.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    out.fecha = mm
      ? `${mm[3]}-${String(Number(mm[2])).padStart(2, '0')}-${String(Number(mm[1])).padStart(2, '0')}`
      : f;
  }

  const usd = /US\$|\bUSD\b/.test(texto);
  const dop = /RD\$|\bDOP\b/.test(texto);
  if (dop !== usd) out.moneda = dop ? 'DOP' : 'USD';

  // Teléfono del emisor, SOLO si viene impreso (regla del dueño: el contacto
  // sale del documento o de ningún lado).
  const mTel = texto.match(/(?:Tel[eé]?f?o?n?o?|TEL)\.?\s*:?\s*(\+?[\d\- ().]{7,20}\d)/i);
  if (mTel) {
    const tel = mTel[1].replace(/[^\d+]/g, '');
    if (tel.length >= 10 && tel.length <= 14) out.telefono = tel;
  }

  // Extras del e-CF: sirven para verificar el timbre (SPEC 7)
  const mCod = texto.match(/C[oó]digo\s+de\s+Seguridad[^A-Za-z0-9+/=]{0,15}([A-Za-z0-9+/=]{6})/i);
  if (mCod) out.codigo_seguridad = mCod[1];
  const mFf = texto.match(/Fecha\s*(?:de\s*)?Firma[^0-9]{0,20}(\d{1,2}[-/]\d{1,2}[-/]\d{4}\s+\d{1,2}:\d{2}:\d{2})/i);
  if (mFf) {
    const v = mFf[1].replace(/\//g, '-');
    const mm = v.match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
    if (mm) {
      out.fecha_firma = `${mm[1].padStart(2, '0')}-${mm[2].padStart(2, '0')}-${mm[3]} ${mm[4].padStart(2, '0')}:${mm[5]}:${mm[6]}`;
    }
  }

  return out;
}

// ───────────────────────── XML e-CF (bloque 4, camino exacto) ───────────────

interface ElementoXml {
  tag: string;
  texto: string;
  hijos: Array<Record<string, unknown>>;
}

// fast-xml-parser con preserveOrder devuelve el documento como árbol de nodos
// {tag: hijos[]} en orden. Este walker replica el arbol.iter() de ElementTree:
// todos los elementos, en orden de documento — de eso depende el "primer valor
// gana" (el encabezado va antes que los items).
function* elementos(nodos: Array<Record<string, unknown>>): Generator<ElementoXml> {
  for (const nodo of nodos) {
    for (const [clave, valor] of Object.entries(nodo)) {
      if (clave === ':@' || clave === '#text') continue;
      const hijos = Array.isArray(valor) ? (valor as Array<Record<string, unknown>>) : [];
      const texto = hijos
        .filter((h) => '#text' in h)
        .map((h) => String((h as { '#text': unknown })['#text']))
        .join('')
        .trim();
      yield { tag: clave.split(':').pop() ?? clave, texto, hijos };
      yield* elementos(hijos);
    }
  }
}

function hijosDirectos(el: ElementoXml): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const h of elementosDirectos(el.hijos)) {
    if (!(h.tag in mapa)) mapa[h.tag] = h.texto;
  }
  return mapa;
}

function* elementosDirectos(nodos: Array<Record<string, unknown>>): Generator<ElementoXml> {
  for (const nodo of nodos) {
    for (const [clave, valor] of Object.entries(nodo)) {
      if (clave === ':@' || clave === '#text') continue;
      const hijos = Array.isArray(valor) ? (valor as Array<Record<string, unknown>>) : [];
      const texto = hijos
        .filter((h) => '#text' in h)
        .map((h) => String((h as { '#text': unknown })['#text']))
        .join('')
        .trim();
      yield { tag: clave.split(':').pop() ?? clave, texto, hijos };
    }
  }
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function fechaIso(v: string): string {
  const m = (v ?? '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
}

/**
 * e-CF en XML: datos exactos (SPEC 6). Devuelve además el texto "tag: valor"
 * por línea para que el turno lea sin re-parsear. Lanza si el XML no parsea —
 * el caller anota y degrada a metodo='ninguno', como el fuente.
 */
export function extraccionXml(bytes: Uint8Array): { extr: Extraccion; texto: string } {
  const xml = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const valido = XMLValidator.validate(xml);
  if (valido !== true) {
    throw new Error(`XML invalido: ${String(valido.err?.msg ?? 'sin detalle').slice(0, 80)}`);
  }
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: true, parseTagValue: false });
  const arbol = parser.parse(xml) as Array<Record<string, unknown>>;

  const campos: Record<string, string> = {};
  const lineas: string[] = [];
  const items: ItemDoc[] = [];

  for (const el of elementos(arbol)) {
    if (el.texto) {
      lineas.push(`${el.tag}: ${el.texto}`);
      if (!(el.tag in campos)) campos[el.tag] = el.texto; // primer valor gana
    }
    if (el.tag === 'Item') {
      const hijo = hijosDirectos(el);
      const desc = (hijo.NombreItem ?? hijo.DescripcionItem ?? '').trim();
      const cant = num(hijo.CantidadItem);
      let prec = num(hijo.PrecioUnitarioItem);
      let montoItem = num(hijo.MontoItem);
      if (prec === null && montoItem !== null && cant) prec = round2(montoItem / cant);
      if (!desc || !cant || prec === null) continue; // renglón ilegible: mejor tabla incompleta que inventada
      if (montoItem === null) montoItem = round2(prec * cant);
      // El ITBIS por renglón no viene en el item: viene el IndicadorFacturacion
      // del emisor (1=18%, 2=16%, 3=tasa 0, 4=exento). Se calcula según lo
      // DECLARADO — no se adivina.
      const TASA: Record<string, number> = { '1': 0.18, '2': 0.16, '3': 0.0, '4': 0.0 };
      const itb = round2(montoItem * (TASA[hijo.IndicadorFacturacion ?? ''] ?? 0.0));
      items.push({ descripcion: desc.slice(0, 80), cantidad: cant, precio: prec, itbis: itb });
    }
  }

  const out: Extraccion = { metodo: 'xml', confianza: 'alta', nota: NOTA_EXTR };
  const mapa: Array<[string, string]> = [
    ['RNCEmisor', 'rnc'], ['RazonSocialEmisor', 'proveedor'],
    ['eNCF', 'ncf'], ['ENCF', 'ncf'], ['FechaEmision', 'fecha'],
    ['TipoMoneda', 'moneda'], ['MontoTotal', 'monto'],
    ['TotalITBIS', 'itbis'], ['RNCComprador', 'rnc_comprador'],
    ['FechaHoraFirma', 'fecha_firma'],
  ];
  for (const [tag, clave] of mapa) {
    if (tag in campos && !(clave in out)) out[clave] = campos[tag];
  }
  if ('monto' in out) out.monto = num(out.monto);
  if ('itbis' in out) out.itbis = num(out.itbis);
  if ('fecha' in out) out.fecha = fechaIso(String(out.fecha));
  if (!('moneda' in out)) out.moneda = 'DOP'; // el e-CF omite TipoMoneda cuando es peso dominicano
  if (out.ncf) out.ncf = String(out.ncf).trim().toUpperCase();
  for (const clave of ['rnc', 'rnc_comprador']) {
    if (out[clave]) out[clave] = String(out[clave]).replace(/\D/g, '');
  }

  if (items.length > 0) {
    // El residuo de redondeo contra el TotalITBIS se ajusta en el renglón
    // mayor hasta 1 peso; un descuadre más grande queda tal cual y lo frena la
    // aritmética de abajo (cuadra=false ⇒ el proponedor no propone).
    const totalItbis = out.itbis;
    const itbisItemsCrudo = round2(items.reduce((s, i) => s + i.itbis, 0));
    if (typeof totalItbis === 'number') {
      const dif = round2(totalItbis - itbisItemsCrudo);
      if (dif !== 0 && Math.abs(dif) <= 1.0) {
        const mayor = items.reduce((a, b) => (b.itbis > a.itbis ? b : a));
        mayor.itbis = round2(mayor.itbis + dif);
      }
    }
    out.items = items.slice(0, 40);
    // La propina legal del e-CF de restaurante, si el emisor la declaró.
    let prop: number | null = null;
    for (const tag of ['MontoPropinaLegal', 'PropinaLegal', 'MontoPropina']) {
      prop = num(campos[tag]);
      if (prop) break;
    }
    if (prop) out.propina = prop;
    // La MISMA aritmética (y la misma inferencia de propina por descuadre
    // exacto del 10%) que el camino de visión: un solo criterio de cuadre.
    if (typeof out.monto === 'number') {
      const listaItems = out.items as ItemDoc[];
      const base = round2(listaItems.reduce((s, i) => s + i.precio * i.cantidad, 0));
      const itbisItems = round2(listaItems.reduce((s, i) => s + i.itbis, 0));
      // Mismo respaldo de ITBIS de cabecera que el camino de visión: el
      // criterio de cuadre es uno solo para todos los canales.
      const itbisCabecera = out.itbis;
      let itbisCuadre = itbisItems;
      let itbisOrigen = 'renglones';
      if (itbisItems === 0 && typeof itbisCabecera === 'number' && itbisCabecera > 0) {
        itbisCuadre = round2(itbisCabecera);
        itbisOrigen = 'cabecera';
      }
      let calc = round2(base + itbisCuadre + (prop ?? 0));
      const diff = round2((out.monto as number) - calc);
      if (prop === null && diff > 0 && Math.abs(diff - round2(0.10 * base)) <= 1.0) {
        prop = diff;
        out.propina = prop;
        out.propina_inferida = true;
        calc = round2(base + itbisCuadre + prop);
      }
      out.aritmetica = {
        base_items: base, itbis_items: itbisItems,
        itbis_cuadre: itbisCuadre, itbis_origen: itbisOrigen,
        propina: prop ?? 0, calculado: calc,
        monto_documento: out.monto,
        cuadra: Math.abs(calc - (out.monto as number)) <= 0.05,
      };
      if (out.propina_inferida) {
        (out.aritmetica as Record<string, unknown>).nota =
          'propina legal 10% inferida del descuadre exacto; verificable en el documento';
      }
    }
  }

  for (const [k, v] of Object.entries(out)) {
    if (v === null || v === undefined || v === '') delete out[k];
  }
  return { extr: out, texto: lineas.join('\n') + '\n' };
}
