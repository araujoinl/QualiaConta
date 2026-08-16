// qualia-preparador/vision.ts — la visión del prep (bloque 4, extraccion_imagen).
//
// UNA llamada a glm-4.6v con prompt fijo pidiendo SOLO JSON y temperatura 0.
// Port fiel del fuente con una diferencia deliberada: la cadena z.AI →
// OpenRouter, el thinking apagado, los timeouts por pierna y el registro de
// consumo ya NO viven acá — son de _shared/llm.ts, que es el único camino de
// las functions al LLM. Este módulo solo arma el mensaje y normaliza el JSON.

import { llamarLLM } from '../_shared/llm.ts';
import { Extraccion, ItemDoc, NOTA_EXTR, round2 } from './comun.ts';

// El prompt del fuente, literal. El DATO CLAVE del restaurante y la trampa de
// la fecha DIA/MES/AÑO pagaron incidentes reales (2026-08-02): no recortar.
const PROMPT =
  'Lee esta imagen de un comprobante fiscal dominicano y responde SOLO un JSON ' +
  '(sin markdown, sin texto extra). DATO CLAVE: si es de restaurante/bar, en ' +
  'Republica Dominicana el consumo lleva SIEMPRE DOS cargos: ITBIS 18% Y ' +
  'propina legal 10% (Ley 16-92) — busca AMBOS renglones, los dos estan ' +
  'impresos. Forma exacta: ' +
  '{"proveedor": str|null, "rnc": str|null (solo digitos del RNC del emisor), ' +
  '"ncf": str|null, ' +
  '"fecha_impresa": str|null (la fecha del documento COPIADA TAL CUAL esta ' +
  'impresa, sin reordenar ni convertir nada, por ejemplo "02/08/2026"), ' +
  '"fecha": "YYYY-MM-DD"|null (esa misma fecha en ISO; OJO: en Republica ' +
  'Dominicana se imprime DIA/MES/AÑO, el PRIMER numero es el DIA — ' +
  '"02/08/2026" es 2 de agosto = 2026-08-02, NUNCA 2026-02-08), ' +
  '"moneda": "DOP"|"USD"|null, ' +
  '"monto": number|null (total del documento), "itbis": number|null, ' +
  '"codigo_seguridad": str|null (6 caracteres, solo si es e-CF y se lee), ' +
  '"fecha_firma": "DD-MM-YYYY HH:MM:SS"|null (solo si se lee), ' +
  '"telefono": str|null (telefono del emisor IMPRESO en el documento), ' +
  '"numero_factura_suplidor": str|null (el numero PROPIO del proveedor, ' +
  'distinto del NCF: suele decir Factura No., No. Factura, Invoice, ' +
  'Documento o Pedido, y suele traer letras y guion como FTGAZ-025375), ' +
  '"items": [{"descripcion": str, "cantidad": number, "precio": number ' +
  '(unitario sin ITBIS), ' +
  '"itbis": number (ITBIS de ese renglon, 0 si exento)}] ' +
  '(un item por renglon de consumo del documento; null si no se leen), ' +
  '"propina": number|null (propina legal 10%: puede decir Propina, 10% Ley, ' +
  'Ley 16-92, Servicio, Service o Prop. — cualquier renglon de ~10% sobre el ' +
  'consumo), ' +
  '"confianza": "alta"|"media"|"baja"}. ' +
  'Usa null en lo que no puedas leer. No inventes valores ni renglones.';

function numero(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9 ? round2(v) : null;
}

export type ResultadoVision = { extr: Extraccion } | { fallo: string };

/**
 * Visión sobre una imagen ya armada como data URL. El caller decide QUÉ imagen
 * (la foto original, o la página 1 de un PDF escaneado rasterizada a PNG).
 */
export async function extraccionVision(
  empresaId: string,
  dataUrl: string,
  extras: Extraccion = {},
): Promise<ResultadoVision> {
  const r = await llamarLLM({
    empresaId,
    funcion: 'qualia-preparador',
    proposito: 'extraccion_documento',
    vision: true,
    temperature: 0,
    maxTokens: 3000,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: PROMPT },
      ],
    }],
  });
  if (!r.ok) {
    const partes = [r.error, r.codigo, r.detalle].filter(Boolean).join(' ');
    return { fallo: partes.slice(0, 120) || 'sin motivo' };
  }

  // El JSON puede venir en content o — si el respaldo gastó el tope pensando —
  // solo en reasoning_content: se buscan ambos, en ese orden (lección del fuente).
  let datos: Record<string, unknown> | null = null;
  for (const contenido of [r.contenido, r.razonamiento]) {
    const m = (contenido ?? '').match(/\{[\s\S]*\}/);
    if (!m) continue;
    try {
      datos = JSON.parse(m[0]) as Record<string, unknown>;
      break;
    } catch {
      continue;
    }
  }
  if (datos === null) return { fallo: 'la respuesta no trajo JSON parseable' };

  const out: Extraccion = {
    metodo: 'vision-glm4.6v',
    modelo_vision: r.modelo,
    nota: NOTA_EXTR,
    ...extras,
  };
  out.confianza = ['alta', 'media', 'baja'].includes(String(datos.confianza))
    ? datos.confianza
    : 'media';
  for (const clave of ['proveedor', 'rnc', 'ncf', 'fecha', 'moneda']) {
    const v = datos[clave];
    if (typeof v === 'string' && v.trim()) out[clave] = v.trim();
  }
  // La fecha se re-arma desde la impresa: en RD el documento dice DIA/MES/AÑO
  // y el modelo la voltea a la gringa (pasó el 2026-08-02 con un ticket de
  // restaurante). Con el literal en mano la conversión es nuestra; el "fecha"
  // del modelo queda de respaldo para las fechas escritas con letras.
  const impresa = String(datos.fecha_impresa ?? '').trim();
  let mf = impresa.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?!\d)/);
  if (mf) {
    const dd = Number(mf[1]);
    const mes = Number(mf[2]);
    let aa = Number(mf[3]);
    if (aa < 100) aa += 2000;
    if (dd >= 1 && dd <= 31 && mes >= 1 && mes <= 12) {
      out.fecha = `${String(aa).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
  } else {
    mf = impresa.match(/^(\d{4})-(\d{2})-(\d{2})(?!\d)/);
    if (mf) out.fecha = mf[0];
  }
  for (const clave of ['monto', 'itbis']) {
    const v = datos[clave];
    if (typeof v === 'number' && Number.isFinite(v)) out[clave] = v;
    else if (typeof v === 'string') {
      const n = parseFloat(v.replace(/,/g, ''));
      if (Number.isFinite(n)) out[clave] = n;
    }
  }
  if (out.ncf) out.ncf = String(out.ncf).toUpperCase().replace(/ /g, '');
  if (out.rnc) out.rnc = String(out.rnc).replace(/\D/g, '');
  // Extras del timbre e-CF, si la foto los trae (el bloque 5 los re-valida igual):
  const cs = String(datos.codigo_seguridad ?? '').trim();
  if (/^[A-Za-z0-9+/=]{6}$/.test(cs)) out.codigo_seguridad = cs;
  const ff = String(datos.fecha_firma ?? '').trim().replace(/\//g, '-');
  if (/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/.test(ff)) out.fecha_firma = ff;
  // Teléfono del emisor: SOLO el impreso en el documento (regla del dueño).
  const tel = String(datos.telefono ?? '').replace(/[^\d+]/g, '');
  if (tel.length >= 10 && tel.length <= 14) out.telefono = tel;
  const numSup = datos.numero_factura_suplidor;
  if (typeof numSup === 'string' && numSup.trim()) out.numero_factura_suplidor = numSup.trim();

  // Items del documento: validados uno a uno; ante cualquier cosa rara el
  // renglón se descarta (mejor tabla incompleta que inventada — el turno nota
  // el faltante por aritmética).
  const items: ItemDoc[] = [];
  for (const it of (Array.isArray(datos.items) ? datos.items : []).slice(0, 40)) {
    if (typeof it !== 'object' || it === null) continue;
    const fila = it as Record<string, unknown>;
    const desc = String(fila.descripcion ?? '').trim().slice(0, 80);
    const cant = numero(fila.cantidad);
    const prec = numero(fila.precio);
    const itb = numero(fila.itbis);
    if (desc && cant && prec !== null) {
      items.push({ descripcion: desc, cantidad: cant, precio: prec, itbis: itb ?? 0 });
    }
  }
  let prop = numero(datos.propina);
  if (items.length > 0) {
    out.items = items;
    if (prop) out.propina = prop;
    // Aritmética verificada acá, determinista: base + ITBIS + propina vs total.
    if (typeof out.monto === 'number') {
      const base = round2(items.reduce((s, i) => s + i.precio * i.cantidad, 0));
      const itbisItems = round2(items.reduce((s, i) => s + i.itbis, 0));
      // El ITBIS puede venir POR RENGLON o SOLO en la cabecera: cuando el papel
      // lo imprime una sola vez al pie, sumar solo renglones daba "no cuadra"
      // con el ITBIS bien leído al lado (6 de 22 descuadres reales medidos
      // 2026-08-11 eran restaurantes así). El renglón manda; la cabecera es respaldo.
      const itbisCabecera = out.itbis;
      let itbisCuadre = itbisItems;
      let itbisOrigen = 'renglones';
      if (itbisItems === 0 && typeof itbisCabecera === 'number' && itbisCabecera > 0) {
        itbisCuadre = round2(itbisCabecera);
        itbisOrigen = 'cabecera';
      }
      let calc = round2(base + itbisCuadre + (prop ?? 0));
      const diff = round2(out.monto - calc);
      // La visión a veces pierde el renglón de la propina aunque esté IMPRESO:
      // si el descuadre calza EXACTO con el 10% de la base (±1 peso), eso ES
      // la propina legal (regla del dueño 2026-08-02: lo obvio se resuelve solo).
      if (prop === null && diff > 0 && Math.abs(diff - round2(0.10 * base)) <= 1.0) {
        prop = diff;
        out.propina = prop;
        out.propina_inferida = true;
        calc = round2(base + itbisCuadre + prop);
      }
      // Umbral 0.05: el MISMO que valida la web al aprobar (QualiaContaTab
      // compara con < 0.05 estricto; aflojarlo reabre la zona muerta).
      out.aritmetica = {
        base_items: base, itbis_items: itbisItems,
        itbis_cuadre: itbisCuadre, itbis_origen: itbisOrigen,
        propina: prop ?? 0, calculado: calc,
        monto_documento: out.monto,
        cuadra: Math.abs(calc - out.monto) <= 0.05,
      };
      if (out.propina_inferida) {
        (out.aritmetica as Record<string, unknown>).nota =
          'propina legal 10% inferida del descuadre exacto; verificable en el documento';
      }
    }
  }
  return { extr: out };
}
