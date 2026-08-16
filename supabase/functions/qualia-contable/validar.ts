// qualia-contable/validar.ts — las validaciones duras de `proponer` y
// `abrir_trabajo` (contrato §2.3): las que hoy reparten la web, los guards del
// contrato de la mesa y el trigger de la base, juntas y ANTES de escribir.
//
// El porqué de que estén acá y no después: hoy `verificar_cuadre` frena recién
// en el registro, o sea después de que un humano aprobó. La tool frena antes
// de que el humano apruebe algo falso.
//
// Un error de esta lista NO es un ErrorGuard: vuelve al modelo como resultado
// de la tool para que corrija y reintente. El guard de ESTADO sí revienta —
// ése significa que la fila ya no es suya.

import { round2 } from './tipos.ts';
import { TIPOS_DOC } from './adm.ts';

type Dic = Record<string, unknown>;

// El umbral del contrato y de la web: 0,05.
export const UMBRAL_CUADRE = 0.05;

// Los documentos que se arman con líneas de ITEMS (como la pantalla de compras
// de ADM). El resto va en partida doble.
const DOC_ITEMS = new Set(['VendorBills', 'VendorCreditNotes']);
// Los que nacen en el banco y por eso llevan dirección explícita.
const DOC_BANCO = new Set(['BankCharges', 'BankBankTransfers']);
// Asientos de conciliación: los que exigen el segundo piso «Sostén:».
const DOC_CONCILIACION = new Set(['Journals', 'BankCharges', 'BankBankTransfers']);

// El catálogo 606 es 01-11, uno por documento (raw/expense-types.jsonl).
const RE_TIPO_GASTO = /^(0[1-9]|1[01])$/;

// Cuentas de CAJA del trigger `qualia_journal_no_toca_caja`, copiadas de su
// definición viva en la base: 101.xx y 102.xx son los bancos; 203.10 y 203.11
// son las dos tarjetas corporativas, que son caja en ADM aunque su código viva
// en el pasivo — el prefijo no las delata.
const RE_CUENTA_BANCO = /^(101|102)\./;
const CUENTAS_TARJETA = new Set(['203.10', '203.11']);

const dic = (v: unknown): Dic | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Dic) : null;

const numeroDe = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface ResultadoValidacion {
  errores: string[];
  avisos: string[];
}

export interface OpcionesValidacion {
  /** Un hijo de caso es asiento de conciliación aunque su tipo no lo sea. */
  hijoDeCaso?: boolean;
}

/**
 * Valida la forma de `propuesta` completa. Devuelve TODOS los errores juntos:
 * devolverlos de a uno cuesta una iteración (~11k) por cada corrección.
 */
export function validarPropuesta(
  propuesta: unknown,
  opciones: OpcionesValidacion = {},
): ResultadoValidacion {
  const errores: string[] = [];
  const avisos: string[] = [];
  const p = dic(propuesta);
  if (!p) {
    return { errores: ['`propuesta` tiene que ser un objeto jsonb'], avisos };
  }

  // ── documento_adm ─────────────────────────────────────────────────────────
  const doc = String(p.documento_adm ?? '').trim();
  if (doc === '') {
    errores.push('falta `documento_adm`: es lo que decide con qué se registra, y lo elige el ROL del hecho (las 5 preguntas), no el NCF');
  } else if (!TIPOS_DOC.has(doc)) {
    errores.push(
      `\`documento_adm\` '${doc}' fuera del catálogo (${[...TIPOS_DOC].join(', ')}). ` +
        'Proponer un tipo que el registrador no conoce deja la fila viva simulando atención: si el hecho no entra en ninguno, la salida es preguntar_al_humano',
    );
  }

  // ── tipo_gasto: uno por documento, obligatorio en toda factura ────────────
  if (DOC_ITEMS.has(doc)) {
    const tg = dic(p.tipo_gasto);
    const codigo = String(tg?.codigo ?? '').trim();
    if (!tg || codigo === '') {
      errores.push('falta `tipo_gasto` {codigo, nombre}: es obligatorio en toda factura (catálogo 606 01-11, UNO por documento; no confundir con la cuenta, que es por renglón)');
    } else if (!RE_TIPO_GASTO.test(codigo)) {
      errores.push(`\`tipo_gasto.codigo\` '${codigo}' no es del catálogo 606 (01..11)`);
    }
  }

  // ── cuenta_destino: retirada el 2026-08-02 ────────────────────────────────
  if ('cuenta_destino' in p) {
    errores.push('`cuenta_destino` está PROHIBIDA (retirada 2026-08-02): la clasificación es por RENGLÓN, en lineas[].cuenta. Una cuenta de cabecera podía contradecir a sus propios renglones');
  }

  // ── lineas ────────────────────────────────────────────────────────────────
  const lineas = Array.isArray(p.lineas) ? (p.lineas as unknown[]).map((l) => dic(l)) : null;
  if (!lineas || lineas.length === 0) {
    errores.push('falta `lineas[]`: la propuesta se registra por renglones, y la mesa los muestra como tabla estilo ADM');
  } else if (lineas.some((l) => l === null)) {
    errores.push('cada elemento de `lineas[]` tiene que ser un objeto');
  } else if (doc !== '') {
    const filas = lineas as Dic[];
    if (DOC_ITEMS.has(doc)) {
      errores.push(...validarItems(filas, doc, p));
    } else {
      errores.push(...validarPartidaDoble(filas));
    }
  }

  // ── el candado de la base, adelantado ─────────────────────────────────────
  if (doc === 'Journals' && lineas && !lineas.some((l) => l === null)) {
    const caja = (lineas as Dic[])
      .map((l) => String(l.cuenta ?? '').trim())
      .filter((c) => RE_CUENTA_BANCO.test(c) || CUENTAS_TARJETA.has(c));
    if (caja.length > 0) {
      errores.push(
        `Un Journals no puede tocar una cuenta de caja (${[...new Set(caja)].join(', ')}): ` +
          'la conciliación no lee /api/Journals y el movimiento queda sin conciliar para siempre (lo revienta el trigger de la base). ' +
          'Y este error NO es permiso para re-etiquetar: si la contraparte NO es el banco, disfrazarlo de BankCharges es exactamente el CB00000258 ' +
          '(el depósito de un inquilino asentado como cargo bancario). H-12 vale sólo cuando la contraparte es el banco; si no, preguntá citando el hecho',
      );
    }
  }

  // ── dirección explícita en lo que nace en el banco ────────────────────────
  if (DOC_BANCO.has(doc) && !('direccion' in p)) {
    avisos.push('`direccion` ausente en un documento de banco: cargo = sale plata, credito = entra. Sin ella el registrador tiene que adivinar');
  }

  // ── cuadre ────────────────────────────────────────────────────────────────
  if (lineas && !lineas.some((l) => l === null) && DOC_ITEMS.has(doc)) {
    const filas = lineas as Dic[];
    const monto = numeroDe(p.monto);
    if (monto === null) {
      errores.push('falta `monto`: sin él no hay cuadre que verificar');
    } else {
      const base = filas.reduce(
        (s, l) => s + (numeroDe(l.precio) ?? 0) * (numeroDe(l.cantidad) ?? 0),
        0,
      );
      const itbis = filas.reduce((s, l) => s + (numeroDe(l.itbis) ?? 0), 0);
      const total = round2(base + itbis);
      if (Math.abs(total - monto) > UMBRAL_CUADRE) {
        errores.push(
          `no cuadra: sum(precio×cantidad)=${round2(base)} + sum(itbis)=${round2(itbis)} = ${total}, ` +
            `contra monto=${monto} (diferencia ${round2(Math.abs(total - monto))}, umbral ${UMBRAL_CUADRE}). ` +
            'NO prorratees ni despejes una tasa para que cierre: si la aritmética no da, el dato leído está mal — volvé al papel',
        );
      }
    }
  }

  // ── el segundo piso del detalle ───────────────────────────────────────────
  const detalle = String(p.detalle ?? '');
  const esConciliacion = DOC_CONCILIACION.has(doc) || opciones.hijoDeCaso === true;
  if (detalle.trim() === '') {
    errores.push('falta `detalle`: es donde vive el PORQUÉ. Un paso sin su porqué obliga al humano a confiar a ciegas o a rechazarlo');
  } else if (esConciliacion && !/(^|\n)\s*Sostén:/u.test(detalle)) {
    errores.push(
      'el `detalle` de un asiento de conciliación tiene dos pisos (regla del 2026-08-15): primero la explicación para quien aprueba —2-3 frases, con el nombre que ADM usa en SU pantalla, sin códigos ni siglas— ' +
        'y después una línea en blanco y el segundo piso arrancando con «Sostén:» (criterio o hecho citado, qué verificaste por P-001 y dónde, DocIDs, referencias y uuid). Sin sostén no entra',
    );
  }

  // ── borrador_libro ────────────────────────────────────────────────────────
  const borrador = dic(p.borrador_libro);
  if (borrador) {
    for (const prohibida of ['aprobo', 'aprobó', 'aprobado_por', 'aprobado_por_nombre', 'docid', 'DocID']) {
      if (prohibida in borrador) {
        errores.push(`\`borrador_libro.${prohibida}\` no va: el Aprobó y el DocID los pone la plantilla al materializar, y salen de la FILA`);
      }
    }
    if (!String(borrador.alcance ?? '').trim()) {
      avisos.push('`borrador_libro` sin `alcance`: sin alcance la entrada documenta pero no automatiza, y el contable vuelve a preguntar lo mismo');
    }
  }

  // ── el eje fiscal ─────────────────────────────────────────────────────────
  if (DOC_ITEMS.has(doc) && String(p.ncf ?? '').trim() !== '' && !('dgii' in p)) {
    avisos.push('factura con NCF y sin `dgii` en la propuesta: la verificación viene del dossier del preparador; si allá quedó ausente o «no verificable», usá consultar_dgii y copiá la salida tal cual');
  }
  if (String(p.metodo ?? '') !== 'razonado' && String(p.precedente_ref ?? '').trim() === '') {
    avisos.push('`metodo` distinto de "razonado" sin `precedente_ref`: el precedente citado es lo que vuelve auditable la decisión');
  }

  return { errores, avisos };
}

/** Renglones estilo item: los de VendorBills y VendorCreditNotes. */
function validarItems(filas: Dic[], doc: string, p: Dic): string[] {
  const errores: string[] = [];
  filas.forEach((l, i) => {
    const n = i + 1;
    if (String(l.descripcion ?? '').trim() === '') errores.push(`línea ${n}: falta \`descripcion\``);
    const precio = numeroDe(l.precio);
    const cantidad = numeroDe(l.cantidad);
    if (precio === null) errores.push(`línea ${n}: falta \`precio\` (sin ITBIS)`);
    if (cantidad === null) errores.push(`línea ${n}: falta \`cantidad\``);
    if (String(l.cuenta ?? '').trim() === '') {
      errores.push(`línea ${n}: falta \`cuenta\` — la clasificación es POR RENGLÓN, con cuentas EXACTAS del plan vivo`);
    }
    if (String(l.cuenta_nombre ?? '').trim() === '') {
      errores.push(`línea ${n}: falta \`cuenta_nombre\` (el nombre exacto de la cuenta en el plan)`);
    }
    if (doc === 'VendorCreditNotes' && precio !== null && precio < 0) {
      errores.push(`línea ${n}: en una nota de crédito los precios van POSITIVOS — el signo lo pone el tipo de documento, no el renglón`);
    }
    if ('debito' in l || 'credito' in l) {
      errores.push(`línea ${n}: ${doc} lleva renglones de ITEMS (descripcion/cantidad/precio/itbis/cuenta), no partida doble`);
    }
  });
  const itbisCabecera = numeroDe(p.itbis);
  const itbisLineas = round2(filas.reduce((s, l) => s + (numeroDe(l.itbis) ?? 0), 0));
  if (itbisCabecera !== null && Math.abs(itbisCabecera - itbisLineas) > UMBRAL_CUADRE) {
    errores.push(
      `el ITBIS de cabecera (${itbisCabecera}) no coincide con la suma de los renglones (${itbisLineas}). ` +
        'El ITBIS no se prorratea: cada renglón lleva el suyo, y un exento que sale de una resta es señal de tasa mal despejada (FP00001120)',
    );
  }
  return errores;
}

/** Partida doble: Journals, BankCharges, BankBankTransfers, pagos. */
function validarPartidaDoble(filas: Dic[]): string[] {
  const errores: string[] = [];
  let debitos = 0;
  let creditos = 0;
  filas.forEach((l, i) => {
    const n = i + 1;
    if (String(l.cuenta ?? '').trim() === '') {
      errores.push(`línea ${n}: falta \`cuenta\` (código EXACTO del plan vivo; adivinar un código está prohibido)`);
    }
    if (String(l.cuenta_nombre ?? '').trim() === '') {
      errores.push(`línea ${n}: falta \`cuenta_nombre\``);
    }
    if ('precio' in l || 'cantidad' in l) {
      errores.push(`línea ${n}: este documento va en partida doble ({cuenta, cuenta_nombre, descripcion, debito, credito}), no en items`);
    }
    const d = numeroDe(l.debito) ?? 0;
    const c = numeroDe(l.credito) ?? 0;
    if (d === 0 && c === 0) errores.push(`línea ${n}: sin \`debito\` ni \`credito\``);
    if (d !== 0 && c !== 0) errores.push(`línea ${n}: una línea es débito O crédito, nunca las dos`);
    if (d < 0 || c < 0) errores.push(`línea ${n}: los importes van positivos; el lado lo dice la columna`);
    debitos += d;
    creditos += c;
  });
  if (Math.abs(round2(debitos) - round2(creditos)) > UMBRAL_CUADRE) {
    errores.push(
      `la partida doble no cuadra: débitos ${round2(debitos)} contra créditos ${round2(creditos)} ` +
        `(diferencia ${round2(Math.abs(debitos - creditos))}, umbral ${UMBRAL_CUADRE})`,
    );
  }
  return errores;
}

/**
 * El título de la tarjeta (regla del 2026-08-15): dice sólo QUÉ ES. El monto
 * vive en su campo, el documento en el cintillo y las cuentas en los renglones
 * — repetirlos ahí lo vuelve una ristra truncada.
 *
 * Sólo el «(Caso #N)» se rechaza duro: la traza vive en `propuesta.caso_id`,
 * que es el campo. Lo demás va como aviso porque el `resumen` de una factura
 * del proponedor determinista SÍ lleva monto («Factura Sunix — RD$45,200») y
 * romperlo acá partiría en dos el formato de la mesa.
 */
export function validarResumen(resumen: string): ResultadoValidacion {
  const errores: string[] = [];
  const avisos: string[] = [];
  const r = resumen.trim();
  if (r === '') {
    errores.push('`resumen` vacío: es el título de la tarjeta en la mesa');
    return { errores, avisos };
  }
  if (r.length > 160) avisos.push(`\`resumen\` de ${r.length} caracteres: la tarjeta lo trunca, dejalo corto`);
  if (/\(?\s*caso\s*#\s*\d+\s*\)?/i.test(r)) {
    errores.push('el «(Caso #N)» no va en el `resumen`: los pasos se muestran DENTRO de su caso y la traza ya vive en `propuesta.caso_id`');
  }
  if (/\b(101|102|203|220|611|690)\.\d/.test(r)) {
    avisos.push('el `resumen` lleva códigos de cuenta: van en los renglones, no en el título');
  }
  return { errores, avisos };
}
