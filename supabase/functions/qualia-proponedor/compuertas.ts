// qualia-proponedor/compuertas.ts — las compuertas deterministas y la
// validación post-clasificador, port fiel de mesa/proponer-directo.py.
//
// Regla de este archivo: NADA se le confía al modelo. Cada validación es una
// compuerta y fallar cualquiera es NoPropone (degradar a turno), nunca un
// ajuste silencioso — despejar números para que la aritmética cierre es
// exactamente el modo de falla (FP00001120) que este camino no puede tener.

import { type DatosBrecha, netoCent, textoDetalleBrecha } from '../_shared/brecha-itbis.ts';

export type Dic = Record<string, unknown>;
export type Camino = 'precedente' | 'multi';

// Umbrales espejo de buscar-precedente.py: si allá cambian, acá también — son
// LA definición de "precedente citable" y no puede haber dos. (Y del fuente:
// si proponer-directo.py cambia, este port cambia con él.)
export const DOMINANTE_MIN = 70.0;
export const MUESTRA_MIN = 3;
export const CONFIANZA_MIN = 0.90;
// La web y el validador de la nube cuadran sum(neto por renglón: half-up de
// cantidad×precio×(1−descuento/100), con netoCent) + sum(itbis) contra monto
// con este umbral; proponer algo que la web pintaría en rojo sería trabajo
// muerto.
export const UMBRAL_CUADRE = 0.05;
export const RATIO_INTRA_MIN = 1.5;
// Espejo de TASA_USD_PISO de qualia-contable/validar.ts (las functions no se
// importan entre carpetas hermanas): tasa_usd 1.0 es la FP00001118 (US$2,306.15
// asentados como RD$2,306), no una tasa.
export const TASA_USD_PISO = 5;

// La MISMA versión que el fuente, a propósito: en sombra la propuesta se
// diffea campo a campo contra la que escribió el server, y un version propio
// fabricaría un diff permanente que no es del port. El origen real de cada
// fila queda en el sobre de qualia_sombra (columna funcion), no acá adentro.
export const VERSION = 1;

/** La excepción de "esto va a sesión": se registra como motivo, jamás adivina. */
export class NoPropone extends Error {}

export const esDic = (v: unknown): v is Dic =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

// ── numérica estilo Python ──────────────────────────────────────────────────
// pyRound/pyRoundN copiados de qualia-sugerencias/comun.ts: las functions no
// se importan entre carpetas hermanas (el deploy empaqueta función + _shared).

/** round() de Python: al entero más cercano, empates AL PAR. */
function pyRound(x: number): number {
  const piso = Math.floor(x);
  const resto = x - piso;
  if (resto < 0.5) return piso;
  if (resto > 0.5) return piso + 1;
  return piso % 2 === 0 ? piso : piso + 1;
}

/** round(x, n) de Python: redondeo decimal del valor binario real (toFixed);
 * la única divergencia es el empate diádico exacto, imposible en montos que
 * ya vienen con 2 decimales. */
export function pyRoundN(x: number, n: number): number {
  if (n === 0) return pyRound(x);
  return Number(x.toFixed(n));
}

/**
 * numero() del fuente: float tolerante, redondeo a 2, rango [0, tope).
 * OJO con Number(): '' / null / [] serían 0, y un 0 inventado es un despeje
 * silencioso — se replica float() de Python, que ahí revienta (→ null).
 */
export function numeroF(v: unknown, tope = 1e9): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const f = Number(v);
  if (!Number.isFinite(f)) return null;
  if (f < 0 || f >= tope) return null;
  return pyRoundN(f, 2);
}

/** norm() del fuente: NFKD, sin marcas combinantes, minúsculas, espacios
 * colapsados. Para comparar nombres sin que una tilde decida. */
export function norm(s: unknown): string {
  return String(s || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** format(x, ",.2f") de Python — el resumen que ve el humano. */
const FMT_MONTO = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export const fmtMonto = (x: number): string => FMT_MONTO.format(x);

// ── el agg del proveedor ────────────────────────────────────────────────────

/** Match EXACTO por RNC (o rncs_alt), como buscar-precedente.py. Por nombre
 * no se busca a propósito: el proponedor corre sin humano que confirme una
 * coincidencia parcial, y 'fc gestion' vs 'GESTIONES Operativas' ya mordió. */
export function buscarEnAgg(agg: Dic, rnc: string): Dic | null {
  const provs = Array.isArray(agg.proveedores) ? agg.proveedores : [];
  for (const p of provs) {
    if (!esDic(p)) continue;
    const alt = Array.isArray(p.rncs_alt) ? p.rncs_alt : [];
    if (p.rnc === rnc || alt.includes(rnc)) return p;
  }
  return null;
}

/**
 * Las cuentas del proveedor que son OPCIONES reales, no ruido histórico.
 *
 * El backtest del 2026-08-07 lo enseñó con TUPAQ: una cuenta con 1-2 usos es
 * la anécdota de una excepción, no un destino elegible; el mismo piso de
 * muestra que vale para citar un precedente (MUESTRA_MIN) vale para ofrecer
 * una cuenta.
 */
export function cuentasCandidatas(prov: Dic): Dic[] {
  const cuentas = Array.isArray(prov.cuentas) ? prov.cuentas : [];
  return cuentas.filter((c): c is Dic =>
    esDic(c) && (Number(c.usos ?? 0) >= MUESTRA_MIN || Number(c.pct ?? 0) >= 5.0)
  );
}

/**
 * usos-de-cuenta / facturas: cuántas cuentas toca UNA factura típica.
 * ~1.0 = mezcla ENTRE facturas (el criterio vive fuera del papel — a sesión);
 * ≥1.5 = varias cuentas POR factura (estructura del documento — repartible).
 */
export function ratioIntraDocumento(prov: Dic): number {
  const facturas = Number(prov.facturas ?? 0);
  if (!facturas) return 0.0;
  const cuentas = Array.isArray(prov.cuentas) ? prov.cuentas : [];
  const usos = cuentas.reduce(
    (s: number, c: unknown) => s + (esDic(c) ? Number(c.usos ?? 0) : 0),
    0,
  );
  return usos / facturas;
}

// ── memoria, tipo de gasto y plan ───────────────────────────────────────────

/** La sección del proveedor en proveedores.md, si el espejo existe. Se
 * inyecta al prompt (el tratamiento típico matiza al agg crudo) y su marca
 * AMBIGUO es compuerta dura: 'NUNCA se clasifica en autónomo' (regla escrita
 * en el propio archivo). */
export function bloqueMemoria(
  textoMd: string | null,
  rnc: string,
  nombre: unknown,
): string | null {
  if (textoMd === null) return null;
  for (const seccion of textoMd.split('\n## ')) {
    const cuerpo = seccion.startsWith('#') ? seccion : '## ' + seccion;
    if (
      cuerpo.includes(`RNC: ${rnc}`) ||
      (nombre ? norm(cuerpo.slice(0, 120)).includes(norm(nombre)) : false)
    ) {
      return cuerpo.trim().slice(0, 2500);
    }
  }
  return null;
}

export interface TipoGasto {
  codigo: string;
  nombre: string;
}

/** El tipo de gasto del 606, determinista por RNC de la libreta general. Es
 * 'el más firme de los dos ejes' (SKILL): dominante >=70% con usos >=3 se
 * fija sin preguntarle al modelo. Sin dominante no se adivina: NoPropone. */
export function tipoGastoDominante(g: Dic | null, rnc: string): TipoGasto | null {
  if (!g) return null;
  const suplidores = Array.isArray(g.suplidores) ? g.suplidores : [];
  const fila = suplidores.find((s: unknown) => esDic(s) && s.rnc === rnc);
  const tipos = esDic(fila) && Array.isArray(fila.tipos) ? fila.tipos : [];
  if (tipos.length === 0) return null;
  const top = tipos[0];
  if (!esDic(top)) return null;
  const usos = tipos.reduce(
    (s: number, t: unknown) => s + (esDic(t) ? Number(t.usos ?? 0) : 0),
    0,
  );
  if (usos >= MUESTRA_MIN && Number(top.pct ?? 0) >= DOMINANTE_MIN) {
    return { codigo: String(top.codigo), nombre: String(top.nombre) };
  }
  return null;
}

/** codigo -> nombre EXACTO del plan (la propuesta lleva cuenta_nombre y la
 * web lo muestra tal cual; un nombre inventado se nota y desconfía). */
export function nombresDeCuentas(plan: Dic | null): Record<string, string> {
  const nombres: Record<string, string> = {};
  const cuentas = plan && Array.isArray(plan.cuentas) ? plan.cuentas : [];
  for (const c of cuentas) {
    if (esDic(c) && c.codigo) nombres[String(c.codigo)] = String(c.nombre || '');
  }
  return nombres;
}

// ── compuertas del dossier ──────────────────────────────────────────────────

/**
 * Todo lo que tiene que estar VERIFICADO antes de gastar la llamada.
 * El orden va de lo barato a lo caro y es el del fuente EXACTO; el primer
 * motivo corta (y en sombra ese motivo se diffea contra el del server, así
 * que el orden también es contrato).
 */
export function compuertasDossier(
  d: Dic,
  textoDisponible: boolean,
): { extr: Dic; rnc: string } {
  const extr = esDic(d.extraccion) ? d.extraccion : {};
  const metodo = extr.metodo;
  if (metodo === null || metodo === undefined || metodo === 'ninguno') {
    throw new NoPropone('dossier sin extraccion');
  }
  const rnc = String(extr.rnc ?? '');
  if (!/^(?:\d{9}|\d{11})$/.test(rnc)) {
    throw new NoPropone('sin RNC valido en el dossier');
  }
  const ncf = String(extr.ncf ?? '');
  if (!/^(?:B\d{10}|E\d{12})$/.test(ncf)) {
    // Sin NCF no hubo dedup verificable ni DGII: existe el caso legitimo
    // (45 de 1.109 historicas) pero es minoria y lo razona la sesion.
    throw new NoPropone('sin NCF valido: dedup y DGII no verificables');
  }
  if (!extr.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(String(extr.fecha))) {
    throw new NoPropone('sin fecha valida en el dossier');
  }
  if (numeroF(extr.monto) === null) {
    throw new NoPropone('sin monto en el dossier');
  }

  const dup = esDic(d.duplicados) ? d.duplicados : {};
  if (!dup.verificado) {
    throw new NoPropone(
      `duplicados no verificados: ${String(dup.motivo || 'sin motivo').slice(0, 120)}`,
    );
  }
  const dupMesa = Array.isArray(dup.mesa) ? dup.mesa : [];
  const dupAdm = Array.isArray(dup.adm) ? dup.adm : [];
  if (dupMesa.length || dupAdm.length) {
    throw new NoPropone(`posible duplicado (mesa: ${dupMesa.length}, ADM: ${dupAdm.length})`);
  }

  const dgii = esDic(d.dgii) ? d.dgii : {};
  const estado = String(dgii.estado || '');
  // e-CF exige timbre Aceptado; impreso exige VIGENTE. 'Aceptado Condicional',
  // 'no verificable' o cualquier otra cosa la pondera la sesión, no esto.
  if (ncf.startsWith('E') && estado !== 'Aceptado') {
    throw new NoPropone(`timbre e-CF no Aceptado (estado: ${estado || '?'})`);
  }
  if (ncf.startsWith('B') && estado !== 'VIGENTE') {
    throw new NoPropone(`NCF impreso no VIGENTE en DGII (estado: ${estado || '?'})`);
  }

  // El fuente evalúa `arit and not arit.get("cuadra")` con truthiness de
  // Python: un dict VACÍO es falsy y NO gatilla la compuerta — se replica.
  const arit = extr.aritmetica;
  if (esDic(arit) && Object.keys(arit).length > 0 && !arit.cuadra) {
    throw new NoPropone('la aritmetica del dossier no cuadra');
  }
  const items = extr.items;
  const hayItems = Array.isArray(items) && items.length > 0;
  if (!hayItems && !textoDisponible) {
    throw new NoPropone('sin renglones ni texto: no hay que clasificar');
  }
  return { extr, rnc };
}

// ── validación post-clasificador ────────────────────────────────────────────

// Alias de objeto y no `interface`: así el renglón entra tal cual en el
// detector de brecha de ITBIS de `_shared`, que trabaja sobre el jsonb crudo.
export type Linea = {
  descripcion: string;
  cantidad: number;
  precio: number;
  /** % 0-99.99 del papel, con el `precio` BRUTO — nunca el monto descontado ni
   * el neto aplastado (rama-facturas-1, «El papel manda tres datos más»). Sólo
   * viaja cuando el papel trae la columna. */
  descuento?: number;
  grupo_impuesto: string;
  itbis: number;
  cuenta: string;
  cuenta_nombre: string;
};

/**
 * Las validaciones que NO se le confían al modelo. Cada una es una compuerta:
 * fallar cualquiera es NoPropone, nunca un ajuste silencioso.
 */
export function validarLineas(
  datos: Dic,
  prov: Dic,
  extr: Dic,
  nombres: Record<string, string>,
  camino: Camino,
): { lineas: Linea[]; conf: number } {
  if (datos.contradiccion) {
    throw new NoPropone(
      `el clasificador marco contradiccion: ${
        String(datos.contradiccion_detalle || 'sin detalle').slice(0, 200)
      }`,
    );
  }
  const conf = numeroF(datos.confianza, 1.01);
  if (conf === null || conf < CONFIANZA_MIN) {
    throw new NoPropone(
      `confianza ${(conf ?? -1).toFixed(2)} del clasificador, piso ${CONFIANZA_MIN.toFixed(2)}`,
    );
  }

  // El MISMO filtro de sustancia que armó el menú del prompt: validar contra
  // el histórico crudo dejaría pasar la cuenta-anécdota que el menú excluyó.
  const historico = new Set(cuentasCandidatas(prov).map((c) => String(c.codigo)));
  const lineas: Linea[] = [];
  const crudas = Array.isArray(datos.lineas) ? datos.lineas : [];
  for (const it of crudas.slice(0, 40)) {
    if (!esDic(it)) throw new NoPropone('renglon no es objeto');
    const desc = String(it.descripcion || '').trim().slice(0, 120);
    const cant = numeroF(it.cantidad);
    const prec = numeroF(it.precio);
    const itb = numeroF(it.itbis);
    const cuenta = String(it.cuenta || '').trim();
    if (!desc || !cant || prec === null || itb === null) {
      throw new NoPropone(`renglon incompleto (${desc.slice(0, 40) || 'sin descripcion'})`);
    }
    // El mismo guard del validador de la nube (validarItems): `descuento` es el
    // PORCENTAJE 0-99.99 del papel, jamás el monto descontado — y el precio
    // viaja BRUTO. Acá no hay nota de crédito (sólo facturas), así que no hay
    // abs() que aplicar. Un valor ilegible no se despeja: NoPropone.
    let descuento = 0;
    if (it.descuento !== undefined && it.descuento !== null && String(it.descuento).trim() !== '') {
      const dNum = numeroF(it.descuento, 100);
      if (dNum === null) {
        throw new NoPropone(
          `descuento '${String(it.descuento).slice(0, 20)}' no es un porcentaje 0-99.99 (${
            desc.slice(0, 40)
          })`,
        );
      }
      descuento = dNum;
    }
    if (!historico.has(cuenta)) {
      // El mueble en la gasolinera: la cuenta correcta NO está en el
      // histórico del proveedor. Ese caso es EXACTAMENTE el que merece la
      // sesión — acá sólo se registra lo cien veces visto.
      throw new NoPropone(`cuenta ${cuenta.slice(0, 12)} fuera del historico del proveedor`);
    }
    if (camino === 'multi' && /^2\d\d\./.test(cuenta)) {
      // Pasivos (préstamos, leasing): partir la cuota en capital e interés
      // pide la tabla de amortización, que no está en el sistema (ROADMAP
      // 2b.4). Sin ella cualquier reparto está mal.
      throw new NoPropone(
        `reparto hacia pasivo ${cuenta.slice(0, 12)}: pide la tabla de amortizacion, va a sesion`,
      );
    }
    if (!(cuenta in nombres)) {
      throw new NoPropone(`cuenta ${cuenta.slice(0, 12)} sin nombre en el plan`);
    }
    lineas.push({
      descripcion: desc,
      cantidad: cant,
      precio: prec,
      // El campo sólo viaja cuando hay descuento real: así el jsonb de un papel
      // sin columna de descuento queda byte a byte como siempre.
      ...(descuento > 0 ? { descuento } : {}),
      grupo_impuesto: itb ? 'ITBIS' : 'EXENTO',
      itbis: itb,
      cuenta,
      cuenta_nombre: nombres[cuenta],
    });
  }
  if (lineas.length === 0) throw new NoPropone('el clasificador no devolvio renglones');

  const monto = numeroF(extr.monto);
  if (monto === null) throw new NoPropone('dossier sin monto');
  // La base de cada renglón es la DESCONTADA y se redondea half-up POR RENGLÓN
  // antes de sumar, con la misma aritmética exacta del validador de la nube
  // (validar.ts, cuadre con netoCent): sumar los productos sin redondear
  // acumula hasta medio centavo por renglón. numeroF ya acotó cantidad, precio
  // y descuento; si igual un renglón no fuera representable, cae al producto
  // en float como hace el validador.
  const base = pyRoundN(
    lineas.reduce((s, l) => {
      try {
        return s + Number(netoCent(l.cantidad, l.precio, l.descuento ?? 0)) / 100;
      } catch {
        return s + l.precio * l.cantidad * (1 - (l.descuento ?? 0) / 100);
      }
    }, 0),
    2,
  );
  const itbisLineas = pyRoundN(lineas.reduce((s, l) => s + l.itbis, 0), 2);
  const calc = pyRoundN(base + itbisLineas, 2);
  if (Math.abs(calc - monto) > UMBRAL_CUADRE) {
    throw new NoPropone(
      `aritmetica no cuadra: lineas ${calc.toFixed(2)} vs documento ${monto.toFixed(2)}`,
    );
  }
  return { lineas, conf };
}

// ── la propuesta ────────────────────────────────────────────────────────────

/** Arma la propuesta jsonb con la MISMA forma que la web espera
 * (docs/mesa-de-trabajo.md, VendorBills con líneas de items). */
export function armarPropuesta(
  extr: Dic,
  prov: Dic,
  lineas: Linea[],
  conf: number,
  camino: Camino,
  tipoGasto: TipoGasto,
  modeloUsado: string,
  rnc: string,
  brecha: DatosBrecha | null = null,
): { propuesta: Dic; resumen: string } {
  const itbisLineas = pyRoundN(lineas.reduce((s, l) => s + l.itbis, 0), 2);
  const cuentasUsadas = [...new Set(lineas.map((l) => l.cuenta))].sort();
  const cuentasProv = Array.isArray(prov.cuentas) ? (prov.cuentas as Dic[]) : [];
  const dominante: Dic = cuentasProv[0] ?? {};
  const facturas = Math.trunc(Number(prov.facturas ?? 0));

  let metodo: string;
  let detalle: string;
  if (camino === 'precedente') {
    metodo = 'precedente';
    const usos = cuentasProv.reduce((s, c) => s + Number(c.usos ?? 0), 0);
    detalle = `Cuenta ${dominante.codigo} por precedente: ${
      Math.trunc(Number(dominante.usos ?? 0))
    } de ${usos} usos de cuenta sobre ${facturas} facturas históricas de este proveedor. ` +
      'Renglones validados uno a uno por el clasificador (sin contradicciones).';
  } else {
    metodo = 'razonado';
    detalle = `Proveedor conocido sin cuenta dominante (${facturas} facturas históricas): ` +
      `reparto por renglón entre sus cuentas de siempre (${cuentasUsadas.join(', ')}), ` +
      'validado contra el histórico.';
  }
  detalle += ` Propuesto sin sesión LLM (proponedor v${VERSION}).`;
  // ADM no tiene campo de nota en `VendorBills`: dentro del documento la brecha
  // sólo queda escrita en el `Name` del renglón de ajuste. Acá, en el detalle,
  // es donde la lee quien aprueba.
  if (brecha) detalle += ` ${textoDetalleBrecha(brecha)}`;

  const p: Dic = {
    proveedor: (prov.nombre || extr.proveedor) ?? null,
    rnc,
    ncf: extr.ncf ?? null,
    fecha: extr.fecha ?? null,
    moneda: extr.moneda || 'DOP',
    monto: numeroF(extr.monto),
    itbis: extr.itbis !== null && extr.itbis !== undefined ? numeroF(extr.itbis) : itbisLineas,
    tipo_gasto: tipoGasto,
    documento_adm: 'VendorBills',
    lineas,
    metodo,
    confianza: conf,
    detalle,
    proponedor: { version: VERSION, camino, modelo: modeloUsado },
  };
  // ── tasa_usd: la exigencia del validador de la nube, adelantada ───────────
  // Para VendorBills en moneda extranjera el validador exige `tasa_usd` (la
  // IMPRESA en el papel, piso TASA_USD_PISO) y el registrador sin ella cae a la
  // tasa de sistema avisando sólo por consola — la FP00001118 quedó asentada
  // por RD$2,306 siendo ~RD$134,000. Si el dossier la trae plausible se
  // propaga; si no, esto degrada a turno: proponer un documento en USD sin
  // tasa es proponer algo que la web pintaría en rojo.
  if (String(p.moneda).toUpperCase() !== 'DOP') {
    const tasaUsd = numeroF(extr.tasa_usd);
    if (tasaUsd === null || tasaUsd < TASA_USD_PISO) {
      throw new NoPropone(
        `documento en ${String(p.moneda)} sin tasa_usd plausible en el dossier ` +
          `(piso ${TASA_USD_PISO}): la tasa impresa la confirma la sesion`,
      );
    }
    p.tasa_usd = tasaUsd;
  }
  // Los cuatro números del criterio, con la misma forma con que C-008 anota
  // `propuesta.conversion`: es el rastro que la mesa muestra y el que queda en
  // la fila para siempre.
  if (brecha) p.brecha_itbis = brecha;
  if (camino === 'precedente') p.precedente_ref = `agg:proveedor-cuentas.json#${rnc}`;
  if (extr.numero_factura_suplidor) p.numero_factura_suplidor = extr.numero_factura_suplidor;

  const moneda = p.moneda === 'USD' ? 'US$' : 'RD$';
  const resumen = `Factura ${String(p.proveedor).slice(0, 60)} — ${moneda}${
    fmtMonto(Number(p.monto ?? 0))
  }`;
  return { propuesta: p, resumen };
}
