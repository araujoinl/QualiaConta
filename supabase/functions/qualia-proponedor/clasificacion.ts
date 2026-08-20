// qualia-proponedor/clasificacion.ts — la ÚNICA llamada al modelo del camino
// directo: el prompt fijo del fuente y la extracción del JSON de la respuesta.
//
// El modelo NO elige cuentas libres: se le da la lista cerrada de candidatas
// (dominante + resto del histórico) y la instrucción de marcar
// contradiccion=true cuando un renglón no encaja en NINGUNA — capitalizable,
// mercancía para revender, o algo que simplemente no es de este proveedor.
// Esa marca es la implementación de la regla POR ITEM: acá no se fuerza.
//
// La llamada va SIEMPRE por llamarLLM de _shared/llm.ts (jamás fetch directo):
// ahí viven el selector de modelo, el freno de cuota, el gate de concurrencia,
// el respaldo OpenRouter y el registro en qualia_llm_uso.

import { llamarLLM } from '../_shared/llm.ts';
import { type Camino, cuentasCandidatas, type Dic, NoPropone } from './compuertas.ts';

/**
 * json.dumps de Python con sus separadores default (', ' y ': ') para objetos
 * PLANOS: el prompt debe salir lo más parecido posible al del server — la
 * sombra diffea propuestas, y cada byte distinto del prompt es una fuente de
 * diffs que no son del port. Divergencia conocida e inevitable: un float
 * entero se imprime 45200 acá y 45200.0 en Python.
 */
function jsonPlanoEstiloPython(obj: Dic): string {
  const partes = Object.entries(obj).map(
    ([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`,
  );
  return `{${partes.join(', ')}}`;
}

/**
 * Prompt fijo, port de prompt_clasificacion() del fuente. Los textos se
 * copian byte a byte — incluido el "10%%" de la línea de propina, que en el
 * fuente nunca pasa por el operador % y llega así, doblado, al modelo — con
 * UNA divergencia deliberada: la instrucción de descuento por línea, que el
 * fuente no conoce (el sistema la aprendió después del port; en sombra ese
 * pedazo del prompt es un diff que SÍ es de esta versión, no del port).
 */
export function promptClasificacion(
  extr: Dic,
  prov: Dic,
  camino: Camino,
  memoria: string | null,
  propina: number | null,
  texto: string | null,
): string {
  const cuentas = cuentasCandidatas(prov);
  const candidatas = cuentas
    .slice(0, 8)
    .map((c) =>
      `  - ${c.codigo} ${c.nombre} (${Math.trunc(Number(c.usos ?? 0))} usos, ${
        Number(c.pct ?? 0).toFixed(1)
      }%)`
    )
    .join('\n');

  let regla: string;
  if (camino === 'precedente') {
    regla = 'La cuenta dominante es el DEFAULT de cada renglón, y los ' +
      'cargos accesorios del servicio principal (fuel surcharge, ' +
      'manejo, seguro del envío) van CON el servicio, no a cuentas ' +
      'propias. Movés un renglón a OTRA cuenta de la lista sólo si ' +
      'su descripción claramente pertenece a ella. Si un renglón ' +
      'no encaja en NINGUNA cuenta de la lista (un mueble, un ' +
      'equipo, algo capitalizable, mercancía para revender), NO lo ' +
      'fuerces: marcá contradiccion=true y explicá cuál.';
  } else {
    regla = 'Este proveedor se registra con VARIAS cuentas según el ' +
      'concepto de cada renglón (caso típico: consumo de ' +
      'restaurante y propina legal van a cuentas distintas). ' +
      'Asigná cada renglón a la cuenta de la lista que corresponda ' +
      'a su naturaleza. Si alguno no encaja en NINGUNA, marcá ' +
      'contradiccion=true y explicá cuál.';
  }

  const items = extr.items;
  const hayItems = Array.isArray(items) && items.length > 0;
  let renglones: string;
  let origen: string;
  if (hayItems) {
    renglones = JSON.stringify(items, null, 1);
    origen = 'Renglones leídos del documento (verificados aritméticamente):';
  } else {
    renglones = (texto ?? '').slice(0, 4000);
    origen = 'No hay renglones estructurados: este es el TEXTO extraído ' +
      'del documento. Armá los renglones desde él, sin inventar ' +
      'ninguno.';
  }

  const encabezado: Dic = {};
  for (const k of ['proveedor', 'rnc', 'ncf', 'fecha', 'moneda', 'monto', 'itbis']) {
    if (extr[k] !== null && extr[k] !== undefined) encabezado[k] = extr[k];
  }
  if (propina) encabezado.propina_legal = propina;

  const partes: string[] = [
    'Sos el clasificador contable de facturas de proveedor de una empresa ' +
    'dominicana. Respondé SOLO un JSON (sin markdown, sin texto extra).',
    '',
    'FACTURA: ' + jsonPlanoEstiloPython(encabezado),
    '',
    origen,
    renglones,
    '',
    `CUENTAS CANDIDATAS (histórico real de este proveedor, ${
      Math.trunc(Number(prov.facturas ?? 0))
    } facturas):`,
    candidatas,
    '',
    regla,
  ];
  if (memoria) {
    partes.push(
      '',
      'MEMORIA DE LA EMPRESA sobre este proveedor (matiza al histórico crudo):',
      memoria,
    );
  }
  partes.push(
    '',
    'Si el documento trae propina legal (10%%, Ley 16-92), va como renglón ' +
    'propio con itbis 0, en la cuenta de propinas de la lista si existe.',
    // Divergencia deliberada del fuente (rama-facturas-1, «El papel manda tres
    // datos más»): el camino determinista aprendió descuento por línea después
    // del port y el prompt del server no lo pide.
    'Si el papel trae columna de descuento, cada renglón lleva el precio ' +
    'BRUTO en "precio" y el porcentaje en "descuento" (número 0-99.99, no el ' +
    'monto descontado); nunca aplastes el neto en el precio. Si no hay ' +
    'columna de descuento, no pongas el campo.',
    'Forma exacta de la respuesta: ' +
    '{"lineas": [{"descripcion": str, "cantidad": number, ' +
    '"precio": number (unitario BRUTO, SIN ITBIS), ' +
    '"descuento": number (% 0-99.99, sólo si el papel lo trae), ' +
    '"itbis": number (del renglón, ' +
    '0 si exento), "cuenta": "codigo de la lista", "razon": str corta}], ' +
    '"contradiccion": true|false, ' +
    '"contradiccion_detalle": str|null, ' +
    '"confianza": number 0-1 (qué tan seguro estás del reparto COMPLETO)}. ' +
    'La suma de precio*cantidad*(1-descuento/100) + itbis de todos los ' +
    'renglones debe igualar el monto del documento. No inventes renglones ni ' +
    'valores.',
  );
  return partes.join('\n');
}

/**
 * Una llamada de clasificación por llamarLLM y el JSON de vuelta.
 *
 * Port de llamar_modelo() del fuente con dos diferencias del contrato F2:
 * la cadena z.AI→OpenRouter, el timeout y el registro ya viven en _shared
 * (acá no se duplican). El thinking va APAGADO como en el fuente
 * (llamar_modelo, thinking:{type:'disabled'}): las compuertas validan antes y
 * después, esa es la red — la prohibición de apagar razonamiento aplica al
 * TURNO (F3), no a esta llamada determinista (v2, fidelidad al fuente).
 *
 * El JSON se busca también en el razonamiento porque el respaldo piensa y a
 * veces lo entrega ahí (lección del fuente y de preparar-trabajo.sh).
 */
export async function clasificar(
  empresaId: string,
  prompt: string,
): Promise<{ datos: Dic; modeloUsado: string }> {
  const r = await llamarLLM({
    empresaId,
    funcion: 'qualia-proponedor',
    proposito: 'clasificacion',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 4000,
    temperature: 0,
    reasoningEffort: 'disabled',
  });
  if (!r.ok) {
    // Mismo destino que el fuente ante red/cuota/llave: a sesión, con el
    // código para quien herede (jamás el cuerpo — puede traer la llave).
    throw new NoPropone(`la llamada de clasificacion fallo (${r.codigo ?? r.error})`);
  }
  for (const contenido of [r.contenido, r.razonamiento]) {
    const m = contenido.match(/\{[\s\S]*\}/);
    if (!m) continue;
    try {
      const v = JSON.parse(m[0]) as unknown;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        return { datos: v as Dic, modeloUsado: r.modelo };
      }
    } catch {
      continue;
    }
  }
  throw new NoPropone('la clasificacion no trajo JSON parseable');
}
