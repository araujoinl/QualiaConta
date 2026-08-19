// _shared/brecha-itbis.ts — la brecha de ITBIS, en DOS TIEMPOS: primero se
// pregunta, y sólo después —y sólo con precedente ratificado por emisor— se
// absorbe (libro de acción, 2026-08-17, entrada que enmienda a «el ITBIS que se
// registra es el impreso»).
//
// LA LÁPIDA: factura B0100000600 de HUAYAO GROUP SRL (restaurante GUAN LAN, RNC
// 133542013), NCF VIGENTE. El papel decía subtotal 9.835,14 —suma exacta de sus
// 10 renglones—, %LEY 10% 983,51 e ITBIS 1.700,54, total 12.519,19, y la tarjeta
// cobró exactamente 12.519,19. El 18% del subtotal son 1.770,33: el restaurante
// facturó 69,79 de ITBIS DE MENOS (su POS embebe ISC en las bebidas). Era la
// SEGUNDA vez: el 2026-08-03 la FP00001063 del MISMO restaurante murió igual.
//
// POR QUÉ ESTO SE REFORMULÓ (decisión del dueño, tras DOS rechazos
// adversariales). La primera versión deducía la tasa del documento y decidía
// sola. No se puede: EL PAPEL NO DISTINGUE una factura legítima al 16% —la
// reducida del art. 343— de una al 18% con ISC embebido. En las dos la tasa
// efectiva cae entre 16 y 18, y deducir la tasa del MISMO número que se quiere
// verificar es circular. Se probó contra la FP00001063, que SÍ tenía ISC
// embebido y está documentado: el código dedujo 16% y concluyó «el proveedor
// cobró de MÁS», al revés de la realidad. Un criterio que se equivoca de signo
// en el caso que lo inspiró no es un criterio angosto: es un criterio ciego.
//
// EL DISEÑO, en dos tiempos:
//
//  1. SIEMPRE, sin excepción: se DETECTA la brecha, quedan los números, y se le
//     PREGUNTA al humano. Nunca se absorbe por cuenta propia. La pregunta pone
//     los dos escenarios sobre la mesa —cuánto sería el ITBIS a cada tasa legal
//     y cuánto se aparta del impreso— y NO recomienda: por el papel no se sabe.
//  2. SÓLO si existe PRECEDENTE RATIFICADO para ese emisor —una fila que el
//     humano mandó crear diciendo «este proveedor embebe selectivo, absorbé»—
//     se absorbe automáticamente, con la tasa QUE EL PRECEDENTE DECLARA, jamás
//     con una deducida.
//
// Así la decisión de tasa la toma SIEMPRE un humano: una vez por proveedor, no
// una vez por factura. Y el candado de la FP00001120 —no inventar una tasa para
// que la cabecera cuadre— sigue corriendo primero e intacto.
//
// Lo que el reparto mantiene, verificado al centavo antes de que esto corriera:
//
//  1. LA TASA NO SE DEDUCE NUNCA. En el camino de absorción sale del precedente
//     ratificado; en el de aviso, la que los renglones declaran viaja como DATO
//     con su nombre (`tasa_declarada`) y sin autoridad para decidir nada.
//  2. UN RENGLÓN QUE NO CALZA CON NINGÚN SCHEDULE FRENA, SIEMPRE. Allá el
//     registrador muere antes del POST; absorber la brecha de un documento que
//     igual va a morir es proponer un camino que no existe.
//  3. TODO RENGLÓN DEL PAPEL APARECE EN EL DOCUMENTO. El que la brecha se come
//     entero pierde el ITBIS, no el nombre ni la plata; el renglón de ajuste se
//     abre ADEMÁS, nunca en lugar de uno.
//  4. HAY UN TOPE DE MAGNITUD, y lo mueve el dueño desde `qualia_config` sin
//     desplegar: absorber 69,79 sobre 12.519 no es absorber media base.
//
// Y la regla que las cierra: la partición se propone SÓLO si reproduce, al
// centavo, el total del papel y el ITBIS impreso. Cualquier otra cosa se avisa.

// ── aritmética exacta de ADM ────────────────────────────────────────────────
//
// Se replica `cuadre.py` al centavo y con enteros, no con float: allá la cuenta
// va en `Decimal(str(x))` y redondea MEDIO HACIA ARRIBA, y ésa es justamente la
// diferencia que explica «la mitad de los descuadres» (334,75 × 18% = 60,255 →
// ADM sube a 60,26; el float de JS baja a 60,25 y la predicción deja de ser la
// de ADM). Todo lo que sigue trabaja en centavos enteros por la misma razón.

/** El número tal como lo escribe `str()` de Python, en unidades de 1e-8. */
function esc(x: number): bigint {
  const s = String(x);
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    throw new RangeError(`monto fuera del rango decimal de ADM: ${s}`);
  }
  const neg = s.startsWith('-');
  const [ent, frac = ''] = (neg ? s.slice(1) : s).split('.');
  if (frac.length > 8) {
    // 5 decimales de cantidad × 3 de precio es TODO lo que ADM guarda
    // (FP00001108: 2,21828 galones; FP00001032: precio 508,476).
    throw new RangeError(`${s} tiene más decimales de los que ADM puede guardar`);
  }
  const v = BigInt(ent + (frac + '00000000').slice(0, 8));
  return neg ? -v : v;
}

const CENT_EN_ESC16 = 10n ** 14n; // un centavo, en la escala del producto (1e16)

/** `Net_i = redondear(Quantity_i × Price_i)` de ADM, en centavos. */
export function netoCent(cantidad: number, precio: number): bigint {
  const prod = esc(cantidad) * esc(precio);
  if (prod < 0n) throw new RangeError('un renglón con neto negativo no es de este camino');
  return (2n * prod + CENT_EN_ESC16) / (2n * CENT_EN_ESC16);
}

/** `Tax_i = redondear(Net_i × TaxPercent_i)` de ADM, en centavos. */
export function itbisCent(neto: bigint, tasa: number): bigint {
  const p10 = BigInt(Math.round(tasa * 10));
  return (2n * neto * p10 + 1000n) / 2000n;
}

const aPesos = (c: bigint): number => Number(c) / 100;
const aCent = (x: number): number => Math.round(x * 100);

// ── catálogo de tasas ───────────────────────────────────────────────────────
//
// Espejo de TAX_SCHEDULES en registrar-en-adm.py: 18% general, 16% reducida del
// art. 343 (café, cacao, azúcar, mantequilla, yogurt), 30% telecomunicaciones.
// Si allá cambian, acá también — son LA definición de «tasa legal».
export const TASAS_LEGALES = [16.0, 18.0, 30.0] as const;

/** El umbral del contrato, de la web y del registrador. */
export const UMBRAL_CUADRE = 0.05;

/**
 * `resolver_tasa_linea()` del registrador: la tasa que ADM le va a aplicar a
 * este renglón. `null` = exento (itbis ≤ 0, que es como el registrador degrada
 * un renglón mal capturado); `undefined` = no calza con ningún schedule, que
 * allá es `morir()`.
 */
export function tasaDeRenglon(
  itbis: number,
  cantidad: number,
  precio: number,
): number | null | undefined {
  if (!(itbis > 0)) return null;
  const base = (cantidad || 1) * (precio || 0);
  if (base <= 0) return null;
  const tasa = Number(((itbis / base) * 100).toFixed(1));
  // Tolerancia de un punto y gana el schedule MÁS CERCANO, no el primero que
  // caiga adentro: con 17,0 el 16 y el 18 están ambos a un punto.
  const cerca = TASAS_LEGALES
    .map((t) => ({ t, d: Math.abs(tasa - t) }))
    .filter((c) => c.d <= 1.0)
    .sort((a, b) => a.d - b.d || a.t - b.t);
  return cerca.length > 0 ? cerca[0].t : undefined;
}

// ── el renglón tal como viaja en la propuesta ───────────────────────────────

/**
 * Un renglón de items tal como viaja en `propuesta.lineas`:
 * `{descripcion, cantidad, precio, grupo_impuesto, itbis, cuenta, cuenta_nombre}`.
 *
 * Se tipa flojo a propósito: el MISMO detector corre sobre los renglones que
 * arma el proponedor (tipados) y sobre el jsonb crudo que manda el turno. Dos
 * copias de esta aritmética serían dos criterios.
 */
export type LineaItems = Record<string, unknown>;

/** Lo que ADM va a guardar, dados estos renglones. Port de `verificar_cuadre`. */
export interface PrediccionAdm {
  itbis: number;
  baseGravada: number;
  exento: number;
  total: number;
  /** Las tasas que ADM va a aplicar (sin las exentas ni las irresolubles). */
  tasas: number[];
  /** Renglones cuya tasa efectiva no calza con ningún schedule: allá es morir(). */
  sinSchedule: number[];
}

export function predecirAdm(lineas: LineaItems[]): PrediccionAdm {
  let itbis = 0n;
  let gravada = 0n;
  let exento = 0n;
  const tasas = new Set<number>();
  const sinSchedule: number[] = [];
  lineas.forEach((l, i) => {
    const neto = netoCent(Number(l.cantidad ?? 1), Number(l.precio ?? 0));
    const t = tasaDeRenglon(Number(l.itbis ?? 0), Number(l.cantidad ?? 1), Number(l.precio ?? 0));
    if (t === undefined) {
      sinSchedule.push(i + 1);
      exento += neto;
      return;
    }
    if (t === null) {
      exento += neto;
      return;
    }
    tasas.add(t);
    gravada += neto;
    itbis += itbisCent(neto, t);
  });
  return {
    itbis: aPesos(itbis),
    baseGravada: aPesos(gravada),
    exento: aPesos(exento),
    total: aPesos(gravada + exento + itbis),
    tasas: [...tasas].sort((a, b) => a - b),
    sinSchedule,
  };
}

/**
 * `lecturas_posibles()` del registrador: qué base y qué exento harían falta, en
 * cada tasa legal, para que la CABECERA cierre. Es el candado de la FP00001120 —
 * con total e ITBIS hay dos incógnitas y una ecuación, así que todas las tasas
 * suman bien; la única que es de verdad del documento es la que no necesita un
 * renglón exento que nadie leyó.
 */
export function lecturasPosibles(
  itbisPapel: number,
  totalPapel: number,
): { tasa: number; base: number; exento: number }[] {
  const posibles = [];
  for (const t of TASAS_LEGALES) {
    const base = itbisPapel / (t / 100);
    const exento = totalPapel - itbisPapel - base;
    if (exento < -UMBRAL_CUADRE) continue; // la base sola pasaría el total: imposible
    posibles.push({ tasa: t, base: Number(base.toFixed(2)), exento: Number(exento.toFixed(2)) });
  }
  return posibles.sort((a, b) => Math.abs(a.exento) - Math.abs(b.exento));
}

// ── el veredicto ────────────────────────────────────────────────────────────

/** El motivo, textual: viaja en el `Name` del ítem, que es el ÚNICO campo libre
 * que ADM guarda dentro del documento. Dice lo que es, y no dice «exento» —
 * llamar exento a un residuo que salió de una resta es la firma de la
 * FP00001120. Va SIEMPRE al principio del `Name` porque el registrador lo corta
 * a 200 caracteres (`registrar-en-adm.py:490`): si se pusiera al final, el
 * documento de ADM podía quedarse sin la única explicación que lleva adentro. */
export const MOTIVO_SIN_ITBIS =
  'ITBIS facturado de menos por el emisor (POS), no es exento art. 343/344';

/** El `Name` del renglón de ajuste NUEVO: el pedazo de base que se le sacó al
 * renglón bisagra y no tiene renglón propio en el papel. */
export const NOMBRE_RENGLON_AJUSTE = `Ajuste: ${MOTIVO_SIN_ITBIS}`;

/** El `Name` de un renglón DEL PAPEL que quedó sin ITBIS por el ajuste: sigue
 * siendo su renglón, con su plata y su nombre, y sólo se le antepone por qué
 * dejó de llevar ITBIS. Un renglón del papel jamás desaparece del documento. */
export const nombreRenglonSinItbis = (descripcion: unknown): string => {
  const d = String(descripcion ?? '').trim();
  return d === '' ? NOMBRE_RENGLON_AJUSTE : `Sin ITBIS — ${MOTIVO_SIN_ITBIS} — ${d}`;
};

/** La entrada VIGENTE: la que puso la decisión de tasa en manos del humano. */
export const CRITERIO_BRECHA =
  'libro-de-accion/2026-08-17-la-tasa-de-la-brecha-de-itbis-la-decide-un-humano.md';

/** La que aquélla enmienda. Sigue siendo la fuente del reparto y de la lápida;
 * lo que perdió es la facultad de elegir la tasa sola. */
export const CRITERIO_BRECHA_ENMENDADO =
  'libro-de-accion/2026-08-17-el-itbis-que-se-registra-es-el-impreso.md';

/** La que separa la pregunta de LECTURA de la de brecha: cuando el número que
 * no cierra es el reconstruido —no uno impreso—, no se ofrece absorber ni
 * reclamar (B0100006550 de PASTORIZA PLASTICS: papel limpio al 18%, pregunta de
 * brecha fabricada por una base de OCR que no estaba impresa en ningún lado). */
export const CRITERIO_LECTURA =
  'libro-de-accion/2026-08-19-una-brecha-solo-se-declara-sobre-numeros-impresos.md';

// ── el precedente por emisor ────────────────────────────────────────────────
//
// UNA fila de `qualia_config` por emisor, por empresa y con respaldo global:
//
//   clave  brecha_itbis:<rnc sólo dígitos>
//   valor  {"absorber": true, "tasa": 18, "motivo": "...",
//           "ratificado_por": "...", "en": "2026-08-17"}
//
// Es la ÚNICA cosa que autoriza a absorber sin preguntar, y la escribe el turno
// cuando el humano contesta «absorbé» — nunca el modelo por su cuenta, nunca
// este módulo. Si la fila no está, no hay precedente: se avisa.

/** La clave de `qualia_config` donde vive el precedente de un emisor. */
export const clavePrecedenteBrecha = (rnc: unknown): string =>
  `brecha_itbis:${String(rnc ?? '').replace(/\D/g, '')}`;

export interface PrecedenteBrecha {
  /** El RNC con el que se resolvió, sólo dígitos. */
  rnc: string;
  /** La tasa que el humano ratificó para este emisor. No se deduce jamás. */
  tasa: number;
  motivo: string;
  ratificado_por: string;
  en: string;
}

/**
 * El jsonb de `qualia_config` leído como precedente, o null.
 *
 * Todo lo dudoso devuelve null y eso significa PREGUNTAR: un precedente
 * ilegible, a medias o con una tasa que no es legal nunca abre la puerta —
 * mismo criterio fail-safe que el flag de modo y que el tope de magnitud.
 * `ratificado_por` es obligatorio a propósito: un precedente que nadie firmó no
 * es un precedente, es una fila.
 */
export function leerPrecedente(valor: unknown, rnc: unknown): PrecedenteBrecha | null {
  const digitos = String(rnc ?? '').replace(/\D/g, '');
  if (digitos === '') return null;
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return null;
  const v = valor as Record<string, unknown>;
  if (v.absorber !== true) return null;
  const tasa = typeof v.tasa === 'number' ? v.tasa : Number(v.tasa);
  if (!Number.isFinite(tasa) || !(TASAS_LEGALES as readonly number[]).includes(tasa)) return null;
  const ratificadoPor = String(v.ratificado_por ?? '').trim();
  if (ratificadoPor === '') return null;
  return {
    rnc: digitos,
    tasa,
    motivo: String(v.motivo ?? '').trim(),
    ratificado_por: ratificadoPor,
    en: String(v.en ?? '').trim(),
  };
}

/**
 * Tope de MAGNITUD de la brecha, en % del total del papel (decisión del dueño,
 * 2026-08-17): absorber 69,79 sobre 12.519,19 (0,56%) no es lo mismo que
 * absorber media base. Por encima del tope va al humano aunque pase todo lo
 * demás. Se lee de `qualia_config` clave `tope_brecha_itbis_pct` para poder
 * moverlo sin desplegar; 0 apaga la absorción por completo.
 */
export const CLAVE_TOPE_BRECHA = 'tope_brecha_itbis_pct';
export const TOPE_BRECHA_PCT_DEFAULT = 2;

/**
 * El tope que de verdad se aplica. Un valor ausente, ilegible o fuera de rango
 * cae al default y NUNCA abre la puerta más de lo que el dueño autorizó — mismo
 * criterio fail-safe que el flag de modo.
 */
export function topeEfectivo(pct: number | undefined | null): number {
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
    return TOPE_BRECHA_PCT_DEFAULT;
  }
  return pct;
}

/**
 * Los números de la brecha SIN decidir nada: lo que el papel dice, lo que
 * saldría a cada tasa legal, y a qué distancia queda el impreso de cada una.
 *
 * Es lo que viaja al humano cuando no hay precedente, y es a propósito una foto
 * y no un veredicto: `tasa_declarada` es lo que el clasificador le puso a los
 * renglones —un dato, no una prueba— y `escenarios` está justamente para que la
 * pregunta no llegue con la respuesta adentro. Deducir la tasa del mismo número
 * que se quiere verificar es lo que hizo que la FP00001063 se leyera al revés.
 */
export interface EscenarioTasa {
  tasa: number;
  /** El ITBIS que ADM cobraría con TODA la base gravada a esa tasa. */
  itbis: number;
  /** `itbis` − el impreso. Positivo = el papel cobró de menos a esa tasa. */
  brecha: number;
}

export interface NumerosBrecha {
  /** El emisor: es la llave del precedente, y por eso viaja siempre. */
  rnc: string;
  itbis_impreso: number;
  total_papel: number;
  base_gravada: number;
  /** La que los renglones traen puesta. NO decide: por el papel, una factura al
   * 16% legítima y una al 18% con ISC embebido caen las dos en el medio. */
  tasa_declarada: number | null;
  /** itbis_impreso ÷ base_gravada. El número que delata que algo no cierra. */
  tasa_efectiva: number | null;
  /** A la tasa DECLARADA, para que el humano vea de dónde salió el aviso. */
  itbis_esperado: number | null;
  brecha: number | null;
  brecha_pct: number | null;
  tope_pct: number;
  /** Una fila por tasa legal: es lo que vuelve la pregunta no circular. */
  escenarios: EscenarioTasa[];
  criterio: string;
}

/** Los números del criterio tal como quedan en `propuesta.brecha_itbis` cuando
 * SÍ se absorbió (misma forma con que C-008 anota `propuesta.conversion`). */
export interface DatosBrecha {
  itbis_impreso: number;
  itbis_esperado: number;
  brecha: number;
  /** La base que quedó SIN ITBIS de verdad en el documento emitido, no el
   * nominal despejado: la base bisagra se BUSCA (el redondeo por renglón no es
   * continuo) y puede caer unos centavos al lado. El número de la nota y el del
   * documento tienen que ser el mismo. */
  base_sin_gravar: number;
  tasa: number;
  base_gravada: number;
  /** La plata sin ITBIS por cuenta: los renglones de ajuste nuevos MÁS los
   * renglones del papel que quedaron sin ITBIS. Suma exactamente
   * `base_sin_gravar`. */
  renglones_ajuste: { cuenta: string; monto: number }[];
  /** Qué tan grande es la brecha contra el total del papel, y contra qué tope
   * se la midió (decisión del dueño, `qualia_config` `tope_brecha_itbis_pct`). */
  brecha_pct: number;
  tope_pct: number;
  /** La tasa que los renglones declaraban y la efectiva del papel: quedan como
   * dato para poder auditar después qué tan lejos estaba la deducción vieja. */
  tasa_declarada: number | null;
  tasa_efectiva: number | null;
  /** QUIÉN autorizó esta tasa y cuándo. Sin esto, el jsonb no dice de dónde
   * salió el 18 y la absorción vuelve a parecer una deducción del sistema. */
  precedente: PrecedenteBrecha;
  criterio: string;
  caso: string;
}

export type Veredicto =
  /** La aritmética de ADM ya cae en el papel: acá no hay nada que hacer. */
  | { estado: 'sin_brecha'; prediccion: PrediccionAdm }
  /**
   * Hay algo que un humano tiene que mirar y NO hay precedente que lo cubra:
   * los números, la pregunta en llano y el motivo técnico. Nunca se absorbe por
   * acá — ni cuando «se ve claro», porque en el papel no se ve.
   */
  | {
    estado: 'avisar';
    pregunta: number;
    motivo: string;
    numeros: NumerosBrecha | null;
    texto: string;
  }
  /** Se absorbe: hay precedente ratificado para este emisor. Renglones
   * repartidos a la tasa que el precedente declara, y los números para la nota. */
  | { estado: 'absorbida'; lineas: LineaItems[]; brecha: DatosBrecha };

export interface EntradaBrecha {
  /** Sólo `VendorBills`: en notas de crédito esto NO se midió (alcance (f)). */
  documento: string;
  lineas: LineaItems[];
  /** El total del papel, que es el que se pagó. */
  monto: number;
  /** El ITBIS IMPRESO en el comprobante. Sin él no hay criterio que aplicar. */
  itbis: number | null;
  /** El RNC del EMISOR: la llave del precedente. Sin RNC no hay precedente
   * posible y el veredicto es avisar, aunque todo lo demás pase. */
  rnc?: unknown;
  /** El precedente ratificado de ese emisor, ya leído de `qualia_config` por el
   * caller (`clavePrecedenteBrecha` + `leerPrecedente`). Ausente o null = no hay
   * precedente = se pregunta. Este módulo NO sale a la base: es una función pura
   * y una sola en las dos superficies. */
  precedente?: PrecedenteBrecha | null;
  /** Tope de magnitud en % del total, de `qualia_config`. Ausente = el default
   * del módulo (2%). */
  topePct?: number | null;
}

/** Un renglón gravado, con su neto ya en centavos y su índice en el papel. */
interface Gravada {
  i: number;
  l: LineaItems;
  neto: bigint;
}

/**
 * La tasa que los renglones DECLARAN, si declaran una sola y legal. Es un dato
 * para la foto —y el insumo del candado—, nunca la autoridad para absorber: el
 * clasificador reparte el ITBIS impreso entre los renglones, así que su tasa
 * efectiva es la del papel disfrazada de dato del renglón. Deducir de ahí es la
 * circularidad que la FP00001063 dejó probada.
 */
function tasaDeclaradaUnica(gravadas: Gravada[]): number | null {
  const declaradas = new Set<number>();
  for (const g of gravadas) {
    const t = tasaDeRenglon(Number(g.l.itbis ?? 0), Number(g.l.cantidad ?? 1), Number(g.l.precio ?? 0));
    if (typeof t !== 'number') return null;
    declaradas.add(t);
  }
  return declaradas.size === 1 ? [...declaradas][0] : null;
}

/** La foto de la brecha: los números del papel y qué daría cada tasa legal. */
function fotoDeLaBrecha(
  rnc: string,
  itbisPapel: number,
  monto: number,
  gravadas: Gravada[],
  baseGravadaCent: bigint,
  tasaDeclarada: number | null,
  topePct: number,
): NumerosBrecha {
  const itbisPapelCent = BigInt(aCent(itbisPapel));
  const escenarios: EscenarioTasa[] = TASAS_LEGALES.map((t) => {
    const itbisT = gravadas.reduce((s, g) => s + itbisCent(g.neto, t), 0n);
    return { tasa: t, itbis: aPesos(itbisT), brecha: aPesos(itbisT - itbisPapelCent) };
  });
  const delDeclarado = tasaDeclarada === null
    ? undefined
    : escenarios.find((x) => x.tasa === tasaDeclarada);
  const brecha = delDeclarado ? delDeclarado.brecha : null;
  return {
    rnc,
    itbis_impreso: aPesos(itbisPapelCent),
    total_papel: monto,
    base_gravada: aPesos(baseGravadaCent),
    tasa_declarada: tasaDeclarada,
    tasa_efectiva: baseGravadaCent > 0n
      ? Number(((Number(itbisPapelCent) / Number(baseGravadaCent)) * 100).toFixed(2))
      : null,
    itbis_esperado: delDeclarado ? delDeclarado.itbis : null,
    brecha,
    brecha_pct: brecha !== null && monto > 0 ? Number(((brecha / monto) * 100).toFixed(3)) : null,
    tope_pct: topePct,
    escenarios,
    criterio: CRITERIO_BRECHA,
  };
}

/**
 * La cadena del libro, en el orden en que se pregunta, con el precedente por
 * emisor como última puerta.
 *
 * Sale `avisar` en cuanto una respuesta corta la cadena Y también cuando la
 * corta nada: sin precedente ratificado para ese RNC, una brecha limpia y chica
 * TAMBIÉN se pregunta. Absorber sin precedente es elegir la tasa, y la tasa no
 * se elige acá — eso es lo que esta reformulación existe para impedir.
 */
/**
 * LA ABSORCIÓN AUTOMÁTICA ESTÁ APAGADA (2026-08-17).
 *
 * Tres revisiones adversariales seguidas la rechazaron, cada una por un agujero
 * distinto y real: (1) el reparto elegía la tasa legal más baja que encajaba —
 * inventar una tasa por la puerta de atrás; (2) con la tasa tomada de lo que el
 * renglón declara, la FP00001063 daba «el proveedor cobró de MÁS», al revés de
 * la realidad, porque la tasa se deduce del mismo número que se quiere
 * verificar; (3) el camino se podía ESQUIVAR — si el turno escribe él mismo los
 * renglones ya partidos, la evaluación dice «todo cuadra» antes de mirar si hay
 * precedente, o sea el modelo se auto-autoriza lo que debía autorizar el dueño.
 *
 * Lo que SÍ corre y es imposible de esquivar porque no decide nada: DETECTAR la
 * brecha, dejar la nota y preguntarle al humano con los números sobre la mesa.
 *
 * Para reactivarla hace falta anclar la tasa en un dato que NO venga del papel
 * (el dueño declarando "este emisor factura al 18% con selectivo embebido" como
 * atributo del proveedor) y mover la compuerta ANTES de cualquier evaluación de
 * cuadre, no después. Mientras tanto, esto en true es un riesgo conocido.
 */
export const ABSORCION_AUTOMATICA_HABILITADA = false;

export function evaluarBrechaItbis(e: EntradaBrecha): Veredicto {
  const topePct = topeEfectivo(e.topePct);
  const rnc = String(e.rnc ?? '').replace(/\D/g, '');
  const mudo = (pregunta: number, motivo: string): Veredicto => ({
    estado: 'avisar',
    pregunta,
    motivo,
    numeros: null,
    texto: `⚠️ El ITBIS de esta factura no se sostiene y no pude ni sacarle los números: ${motivo}. ` +
      'La factura queda parada esperando que la mires.',
  });

  if (e.documento !== 'VendorBills') {
    // Alcance (f): en `VendorCreditNotes` esto no se midió, y ahí el signo y el
    // `abs()` de la puerta del registrador cambian toda la aritmética.
    return { estado: 'sin_brecha', prediccion: predecirAdm([]) };
  }

  let prediccion: PrediccionAdm;
  try {
    prediccion = predecirAdm(e.lineas);
  } catch (err) {
    return mudo(2, `no puedo predecir lo que ADM cobraría: ${err instanceof Error ? err.message : String(err)}`);
  }

  const itbisPapel = e.itbis;
  const monto = e.monto;
  if (itbisPapel === null || !Number.isFinite(itbisPapel) || !Number.isFinite(monto)) {
    return { estado: 'sin_brecha', prediccion };
  }

  // ¿Ya cae en el papel? Es el 49 de 63 del histórico: nada que hacer. Un
  // renglón sin schedule NO es «ya cuadra» aunque los números sumen: allá el
  // registrador muere antes de mandar el POST.
  const cuadraItbis = Math.abs(prediccion.itbis - itbisPapel) <= UMBRAL_CUADRE;
  const cuadraTotal = Math.abs(prediccion.total - monto) <= UMBRAL_CUADRE;
  if (cuadraItbis && cuadraTotal && prediccion.sinSchedule.length === 0) {
    return { estado: 'sin_brecha', prediccion };
  }

  // Gravado es el renglón que LLEVA ITBIS, no el que sabe decir a qué tasa: es
  // el mismo `itbis <= 0 -> exento` del registrador. La tasa efectiva de un
  // renglón suelto no decide nada acá, porque el reparto del ITBIS entre
  // renglones lo hizo el clasificador y no el papel — el papel imprime UN ITBIS.
  const gravadas: Gravada[] = e.lineas
    .map((l, i) => ({ i, l, neto: netoCent(Number(l.cantidad ?? 1), Number(l.precio ?? 0)) }))
    .filter((g) => Number(g.l.itbis ?? 0) > 0 && g.neto > 0n);
  const baseGravadaCent = gravadas.reduce((s, g) => s + g.neto, 0n);
  const tasaDeclarada = tasaDeclaradaUnica(gravadas);

  // La foto se saca UNA vez y viaja en toda salida de aviso: la pregunta al
  // humano lleva siempre los mismos números, corte donde corte la cadena.
  const numeros = fotoDeLaBrecha(
    rnc,
    itbisPapel,
    monto,
    gravadas,
    baseGravadaCent,
    tasaDeclarada,
    topePct,
  );
  // La pregunta 2 es «MI lectura no reproduce el papel»: ahí las salidas de
  // brecha (absorber/reclamar) deciden sobre la propia resta del clasificador,
  // no sobre el papel — absorber dejaría precedente de emisor por un error de
  // OCR. La B0100006550 de PASTORIZA lo probó (libro 2026-08-19).
  const avisar = (pregunta: number, motivo: string): Veredicto => ({
    estado: 'avisar',
    pregunta,
    motivo,
    numeros,
    texto: pregunta === 2
      ? textoPreguntaLectura(numeros, motivo)
      : textoPreguntaBrecha(numeros, motivo),
  });

  // ── el renglón que no calza con ningún schedule: frena SIEMPRE ────────────
  //
  // El registrador muere ahí («la linea no calza con ningun schedule conocido»,
  // resolver_tasa_linea) y no llega a mandar el POST. Absorber la brecha de un
  // documento que igual va a morir en el registro es proponer un camino que no
  // existe: el gate va ANTES de repartir nada, y vale aunque haya precedente.
  if (prediccion.sinSchedule.length > 0) {
    return avisar(
      3,
      `el renglón ${prediccion.sinSchedule.join(', ')} lleva ITBIS a una tasa que no calza con ningún schedule ` +
        `legal (${TASAS_LEGALES.join('%, ')}%): el registrador muere ahí antes del POST`,
    );
  }

  // ── 2. la cabecera del papel cierra consigo misma ─────────────────────────
  //
  // subtotal + conceptos no gravados impresos + ITBIS = total. Si no cierra, lo
  // que está mal es la LECTURA del documento, no el POS del emisor.
  const baseTotal = prediccion.baseGravada + prediccion.exento;
  if (Math.abs(baseTotal + itbisPapel - monto) > UMBRAL_CUADRE) {
    return avisar(
      2,
      `la cabecera del papel no cierra consigo misma: renglones ${baseTotal.toFixed(2)} + ITBIS impreso ` +
        `${itbisPapel.toFixed(2)} = ${(baseTotal + itbisPapel).toFixed(2)} contra un total de ${monto.toFixed(2)}`,
    );
  }

  if (!(itbisPapel > 0) || baseGravadaCent <= 0n) {
    return avisar(2, 'sin ITBIS impreso o sin base gravada no hay brecha que medir');
  }
  const montoCent = BigInt(aCent(monto));
  if (montoCent <= 0n) {
    return avisar(2, 'el total del papel no es un monto positivo: no hay contra qué medir la brecha');
  }

  // ── 3. el candado de tasa (FP00001120), primero e intacto ─────────────────
  //
  // Si OTRA tasa legal cierra la cabecera sin residuo, la tasa está mal leída y
  // manda el candado — casi siempre la reducida del art. 343. Vale AUNQUE haya
  // precedente: un precedente autoriza una tasa para las brechas de ese emisor,
  // no a pasar por encima de una lectura que cierra sola.
  const limpia = lecturasPosibles(itbisPapel, monto).find((l) => Math.abs(l.exento) <= UMBRAL_CUADRE);
  if (limpia) {
    return avisar(
      3,
      `al ${limpia.tasa.toFixed(0)}% la cabecera cierra SOLA (base ${limpia.base.toFixed(2)}, exentos 0.00): ` +
        'eso es tasa mal leída y sigue bajo el candado de la FP00001120, no es brecha del emisor',
    );
  }

  // El documento ya desglosado en dos tasas sabe lo que hace, y ahí el exento es
  // dato leído y no residuo: este criterio no lo toca.
  if (prediccion.tasas.length > 1) {
    return avisar(
      3,
      `el documento trae ${prediccion.tasas.length} tasas en juego (${prediccion.tasas.join('%, ')}%): ` +
        'con más de una, lo que sobra es dato leído del papel y no residuo de una resta',
    );
  }
  if (tasaDeclarada === null) {
    return avisar(
      3,
      `los renglones gravados no declaran UNA tasa legal (${TASAS_LEGALES.join('%, ')}%): ` +
        'con el reparto del ITBIS entre renglones así, no hay ni foto que sacar',
    );
  }

  // ── el precedente del emisor: la única puerta que absorbe ─────────────────
  //
  // Acá es donde la versión vieja elegía la tasa sola. Ya no: si no hay una fila
  // que un humano mandó crear para ESTE RNC, se pregunta — con los dos
  // escenarios y sin recomendación, porque por el papel una factura al 16% del
  // art. 343 y una al 18% con ISC embebido son indistinguibles.
  const precedente = e.precedente ?? null;
  if (!precedente) {
    return avisar(
      7,
      rnc === ''
        ? 'la factura no trae RNC del emisor y el precedente de brecha es POR EMISOR: sin RNC no hay precedente posible'
        : `no hay precedente ratificado para el RNC ${rnc} (qualia_config \`${clavePrecedenteBrecha(rnc)}\`): ` +
          'la tasa de una brecha la decide un humano, una vez por proveedor',
    );
  }
  if (precedente.rnc !== rnc) {
    // Cinturón: el precedente que se leyó tiene que ser el de ESTE emisor.
    return avisar(
      7,
      `el precedente que llegó es del RNC ${precedente.rnc} y esta factura es del ${rnc}: no se aplica cruzado`,
    );
  }

  // ── la tasa: la que el PRECEDENTE declara, jamás una deducida ─────────────
  const tasa = precedente.tasa;

  // ── 5. ¿el ITBIS impreso es MAYOR al que sale a la tasa del precedente? ───
  //
  // Ahí el proveedor cobró de MÁS y tomar ese crédito es riesgo propio ante la
  // DGII: al humano, sin excepción (alcance (a)). El precedente autoriza a
  // absorber lo que falta, nunca a quedarse con lo que sobra.
  const itbisTeoricoCent = gravadas.reduce((s, g) => s + itbisCent(g.neto, tasa), 0n);
  const itbisPapelCent = BigInt(aCent(itbisPapel));
  const brechaCent = itbisTeoricoCent - itbisPapelCent;
  if (brechaCent < 0n) {
    return avisar(
      5,
      `el ITBIS impreso (${itbisPapel.toFixed(2)}) es MAYOR al que sale de aplicar el ${tasa.toFixed(0)}% ` +
        `del precedente a la base (${aPesos(itbisTeoricoCent).toFixed(2)}): el emisor cobró de más y ese crédito ` +
        'es riesgo propio, que es justo lo que el precedente NO cubre',
    );
  }
  if (brechaCent === 0n) {
    // A la tasa del precedente el papel sale exacto: lo que descuadra es cómo
    // el clasificador repartió el ITBIS entre renglones. Re-tasar el documento
    // por eso sería arreglar el papel, no la brecha.
    return avisar(
      2,
      `al ${tasa.toFixed(0)}% del precedente el ITBIS del papel sale exacto: lo que descuadra es cómo está ` +
        'repartido el ITBIS entre los renglones, no el documento',
    );
  }

  // ── 4. ¿un renglón, o una suma de renglones, explica la base sin gravar? ──
  //
  // Si sí, es exento IDENTIFICABLE de los arts. 343/344 y se marca ESE renglón:
  // no es este criterio (alcance (b)).
  const baseSinGravarCent = baseGravadaCent - BigInt(Math.round((itbisPapel / (tasa / 100)) * 100));
  const explicado = subconjuntoQueSuma(
    gravadas.map((g) => Number(g.neto)),
    Number(baseSinGravarCent),
    aCent(UMBRAL_CUADRE),
  );
  if (explicado === 'indeterminado') {
    return avisar(
      4,
      `la base sin gravar (${aPesos(baseSinGravarCent).toFixed(2)}) es demasiado grande para descartar ` +
        'que un renglón o una suma de renglones la explique: eso sería un exento identificable y va al humano',
    );
  }
  if (explicado) {
    return avisar(
      4,
      `hay renglones que suman exactamente la base sin gravar (${aPesos(baseSinGravarCent).toFixed(2)}): ` +
        'eso es un exento identificable de los arts. 343/344 y se registra marcando ESE renglón, no absorbiendo',
    );
  }

  // ── tope de magnitud (decisión del dueño, 2026-08-17) ────────────────────
  //
  // Absorber 69,79 sobre 12.519,19 —el 0,56%— no es lo mismo que absorber media
  // base. Por encima del tope va al humano AUNQUE haya precedente: el
  // precedente dice a qué tasa factura el emisor, no cuánta plata se absorbe sin
  // que nadie mire.
  const limiteCent = (montoCent * BigInt(Math.round(topePct * 1000))) / 100_000n;
  const brechaPct = Number(((Number(brechaCent) / Number(montoCent)) * 100).toFixed(3));
  if (brechaCent > limiteCent) {
    return avisar(
      6,
      `la brecha (${aPesos(brechaCent).toFixed(2)}, el ${brechaPct.toFixed(2)}% del total del papel) pasa el tope ` +
        `del ${topePct}% (${aPesos(limiteCent).toFixed(2)}) que el dueño autorizó a absorber ` +
        `(qualia_config \`${CLAVE_TOPE_BRECHA}\`): una brecha de este tamaño la mira un humano`,
    );
  }

  // ── 6. sobrevivió a todo y hay precedente: se absorbe ────────────────────
  return repartir(e, gravadas, tasa, itbisPapelCent, brechaCent, baseSinGravarCent, {
    baseGravadaCent,
    brechaPct,
    topePct,
    precedente,
    numeros,
  });
}

/**
 * El reparto: la brecha se descuenta del renglón gravado de mayor monto y se
 * abre el renglón de ajuste en SU MISMA cuenta; si la brecha supera a ese
 * renglón, se sigue por monto descendente, un renglón de ajuste por cuenta
 * afectada. Un solo renglón de ajuste y no un prorrateo entre todos los
 * gravados: cuando todos van a la misma cuenta —el caso del restaurante, que es
 * donde esto aparece— da exactamente lo mismo y no multiplica renglones.
 *
 * REGLA DURA: todo renglón del papel aparece en el documento de ADM. Un renglón
 * que la brecha se come entero NO se borra ni se funde en el renglón de ajuste
 * —eso hacía desaparecer del documento el nombre de lo que se compró—: se emite
 * con su plata y su nombre, y pierde sólo el ITBIS, con el motivo al frente del
 * `Name`. El renglón de ajuste se abre ADEMÁS, para el pedazo que se le sacó al
 * bisagra y no tiene renglón propio en el papel; nunca en lugar de uno.
 */
function repartir(
  e: EntradaBrecha,
  gravadas: Gravada[],
  tasa: number,
  itbisPapelCent: bigint,
  brechaCent: bigint,
  baseSinGravarCent: bigint,
  ctx: {
    baseGravadaCent: bigint;
    brechaPct: number;
    topePct: number;
    precedente: PrecedenteBrecha;
    numeros: NumerosBrecha;
  },
): Veredicto {
  // Un reparto que no cierra NO es un reparto peor: es la misma pregunta al
  // humano, con los mismos números que si la cadena se hubiera cortado arriba.
  const humano = (pregunta: number, motivo: string): Veredicto => ({
    estado: 'avisar',
    pregunta,
    motivo,
    numeros: ctx.numeros,
    texto: textoPreguntaBrecha(ctx.numeros, motivo),
  });

  // Por monto descendente, y a igualdad de monto por orden del papel: el reparto
  // tiene que ser el mismo cada vez que se corra sobre el mismo documento.
  const orden = [...gravadas].sort((a, b) => (b.neto === a.neto ? a.i - b.i : b.neto > a.neto ? 1 : -1));

  // Los que quedan sin ITBIS ENTEROS: siguen siendo su renglón, con su monto.
  const enteros = new Set<number>();
  let porQuitar = baseSinGravarCent;
  let k = 0;
  while (k < orden.length && orden[k].neto < porQuitar) {
    enteros.add(orden[k].i);
    porQuitar -= orden[k].neto;
    k++;
  }
  if (k >= orden.length) {
    return humano(6, 'la brecha se come toda la base gravada del documento');
  }

  // El renglón bisagra absorbe el resto. Su base NO se despeja: se busca —como
  // hace `cuadrar_items`— la que hace que la cuenta de ADM caiga exactamente en
  // el ITBIS impreso, porque el redondeo por renglón hace que el total no sea
  // una función continua de la base.
  const bisagra = orden[k];
  const intactas = orden.slice(k + 1);
  const restoItbis = intactas.reduce((s, g) => s + itbisCent(g.neto, tasa), 0n);
  const objetivoBisagra = itbisPapelCent - restoItbis;
  if (objetivoBisagra <= 0n) {
    return humano(6, 'el reparto dejaría al renglón bisagra sin ITBIS que llevar');
  }

  const idealCent = bisagra.neto - porQuitar;
  const arranque = BigInt(Math.round((Number(objetivoBisagra) / tasa) * 100));
  let baseBisagra: bigint | null = null;
  let precioBisagra = 0;
  const cantidadBisagra = Number(bisagra.l.cantidad ?? 1) || 1;
  for (const b of candidatasBase(arranque, idealCent, bisagra.neto)) {
    if (itbisCent(b, tasa) !== objetivoBisagra) continue;
    const precio = precioParaNeto(cantidadBisagra, b);
    if (precio === null) continue;
    baseBisagra = b;
    precioBisagra = precio;
    break;
  }
  if (baseBisagra === null) {
    return humano(6, 'no encontré una base del renglón bisagra que reproduzca el ITBIS impreso al centavo');
  }
  const quitaBisagra = bisagra.neto - baseBisagra;

  // ── los renglones ────────────────────────────────────────────────────────
  //
  // Dos mapas y no uno: `ajustePorCuenta` son los renglones NUEVOS (sólo el
  // pedazo del bisagra, que no tiene renglón propio en el papel) y
  // `sinItbisPorCuenta` es TODA la plata que quedó sin ITBIS —los renglones
  // enteros incluidos—, que es lo que la nota y el trabajo tienen que decir.
  const lineas: LineaItems[] = [];
  const ajustePorCuenta = new Map<string, { cuenta: string; cuenta_nombre?: string; cent: bigint }>();
  const sinItbisPorCuenta = new Map<string, bigint>();
  const anotarSinItbis = (cuenta: string, cent: bigint) => {
    sinItbisPorCuenta.set(cuenta, (sinItbisPorCuenta.get(cuenta) ?? 0n) + cent);
  };
  for (let i = 0; i < e.lineas.length; i++) {
    const l = e.lineas[i];
    const cuenta = String(l.cuenta ?? '');
    if (enteros.has(i)) {
      // Su plata y su nombre se quedan donde estaban; lo único que pierde es el
      // ITBIS, y el `Name` dice por qué. No se rotula «exento»: el residuo salió
      // de una resta y llamarlo exento contamina la lectura para siempre
      // (FP00001120).
      const neto = netoCent(Number(l.cantidad ?? 1), Number(l.precio ?? 0));
      lineas.push({
        ...l,
        descripcion: nombreRenglonSinItbis(l.descripcion),
        itbis: 0,
        grupo_impuesto: 'SIN ITBIS',
      });
      anotarSinItbis(cuenta, neto);
      continue;
    }
    if (i === bisagra.i) {
      lineas.push({
        ...l,
        cantidad: cantidadBisagra,
        precio: precioBisagra,
        itbis: aPesos(itbisCent(baseBisagra, tasa)),
        grupo_impuesto: 'ITBIS',
      });
      if (quitaBisagra > 0n) {
        const acc = ajustePorCuenta.get(cuenta) ??
          { cuenta, cuenta_nombre: l.cuenta_nombre as string | undefined, cent: 0n };
        acc.cent += quitaBisagra;
        ajustePorCuenta.set(cuenta, acc);
        anotarSinItbis(cuenta, quitaBisagra);
      }
      continue;
    }
    lineas.push({ ...l });
  }
  // Los que quedaron gravados llevan el ITBIS que ADM les va a cobrar, ni uno
  // más: el ITBIS de cabecera y la suma de los renglones tienen que ser el
  // mismo número o la compuerta de la mesa lo pinta en rojo.
  for (const l of lineas) {
    if (!(Number(l.itbis ?? 0) > 0)) continue;
    l.itbis = aPesos(itbisCent(netoCent(Number(l.cantidad ?? 1), Number(l.precio ?? 0)), tasa));
    l.grupo_impuesto = 'ITBIS';
  }
  for (const a of ajustePorCuenta.values()) {
    if (a.cent <= 0n) continue;
    lineas.push({
      descripcion: NOMBRE_RENGLON_AJUSTE,
      cantidad: 1,
      precio: aPesos(a.cent),
      itbis: 0,
      cuenta: a.cuenta,
      cuenta_nombre: a.cuenta_nombre ?? '',
      grupo_impuesto: 'SIN ITBIS',
    });
  }
  const renglonesAjuste = [...sinItbisPorCuenta.entries()]
    .filter(([, cent]) => cent > 0n)
    .map(([cuenta, cent]) => ({ cuenta, monto: aPesos(cent) }));
  const sinGravarEmitidoCent = [...sinItbisPorCuenta.values()].reduce((s, c) => s + c, 0n);

  // ── el total del papel manda: si la partición no lo reproduce, no se propone ─
  let verif: PrediccionAdm;
  try {
    verif = predecirAdm(lineas);
  } catch (err) {
    return humano(6, `la partición no es representable en ADM: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (aCent(verif.itbis) !== Number(itbisPapelCent) || aCent(verif.total) !== aCent(e.monto)) {
    return humano(
      6,
      `la partición no reproduce el papel al centavo (ADM cobraría total ${verif.total.toFixed(2)} / ITBIS ` +
        `${verif.itbis.toFixed(2)} contra ${e.monto.toFixed(2)} / ${aPesos(itbisPapelCent).toFixed(2)})`,
    );
  }
  // Y el número que se REPORTA es el emitido. La base bisagra se busca, así que
  // lo sin gravar puede caer unos centavos al lado del nominal despejado
  // (`baseSinGravarCent`): si la nota dijera el nominal, el papel de la mesa y
  // el documento de ADM hablarían de dos números distintos. Se cruza contra lo
  // que ADM va a dejar de gravar, y una diferencia acá es un error de reparto,
  // no algo que se redondea.
  const dejoDeGravarCent = ctx.baseGravadaCent - BigInt(aCent(verif.baseGravada));
  if (sinGravarEmitidoCent !== dejoDeGravarCent) {
    return humano(
      6,
      `el reparto no cierra contra sí mismo: los renglones sin ITBIS suman ` +
        `${aPesos(sinGravarEmitidoCent).toFixed(2)} y ADM deja de gravar ${aPesos(dejoDeGravarCent).toFixed(2)}`,
    );
  }

  if (!ABSORCION_AUTOMATICA_HABILITADA) {
    // Todo el reparto se calculó y cuadró; igual NO se propone solo. El humano
    // decide, con los números ya hechos delante.
    return humano(
      7,
      'la absorción automática está apagada: el reparto cuadra, pero la tasa la ' +
        'ratifica el dueño (ver ABSORCION_AUTOMATICA_HABILITADA)',
    );
  }

  return {
    estado: 'absorbida',
    lineas,
    brecha: {
      itbis_impreso: aPesos(itbisPapelCent),
      itbis_esperado: aPesos(itbisPapelCent + brechaCent),
      brecha: aPesos(brechaCent),
      base_sin_gravar: aPesos(sinGravarEmitidoCent),
      tasa,
      base_gravada: verif.baseGravada,
      renglones_ajuste: renglonesAjuste,
      brecha_pct: ctx.brechaPct,
      tope_pct: ctx.topePct,
      tasa_declarada: ctx.numeros.tasa_declarada,
      tasa_efectiva: ctx.numeros.tasa_efectiva,
      precedente: ctx.precedente,
      criterio: CRITERIO_BRECHA,
      caso: 'GUAN LAN / HUAYAO GROUP SRL B0100000600 (2026-08-17) y FP00001063 (2026-08-03)',
    },
  };
}

/** Bases candidatas para el renglón bisagra, de la más cercana al ideal hacia
 * afuera: hay un rango de bases que producen el mismo ITBIS redondeado y se
 * elige la que menos mueve el renglón. */
function* candidatasBase(arranque: bigint, ideal: bigint, tope: bigint): Generator<bigint> {
  const vistas = new Set<string>();
  for (const centro of [ideal, arranque]) {
    for (let d = 0n; d <= 8n; d++) {
      for (const b of d === 0n ? [centro] : [centro - d, centro + d]) {
        if (b <= 0n || b > tope) continue;
        const clave = b.toString();
        if (vistas.has(clave)) continue;
        vistas.add(clave);
        yield b;
      }
    }
  }
}

/**
 * El precio que hace que ADM guarde exactamente este neto, con los decimales
 * que ADM guarda de verdad: dos primero —lo que dice el papel y lo que se ve en
 * su pantalla— y tres cuando dos no alcanzan (la FP00001032 tiene 508,476). Se
 * BUSCA en vez de despejar, por la misma razón que `cuadrar_items`: el redondeo
 * hace que el neto no sea una función continua del precio.
 */
function precioParaNeto(cantidad: number, objetivo: bigint): number | null {
  const ideal = Number(objetivo) / 100 / cantidad;
  for (const decimales of [2, 3]) {
    const paso = 10 ** -decimales;
    const centro = Number(ideal.toFixed(decimales));
    for (let d = 0; d <= 25; d++) {
      for (const p of d === 0 ? [centro] : [centro - d * paso, centro + d * paso]) {
        const precio = Number(p.toFixed(decimales));
        if (precio <= 0) continue;
        try {
          if (netoCent(cantidad, precio) === objetivo) return precio;
        } catch {
          continue;
        }
      }
    }
  }
  return null;
}

/** Tope del barrido de subconjuntos: RD$50.000 de base sin gravar. Por encima
 * se responde 'indeterminado' y la factura va al humano — no poder descartar un
 * exento identificable es motivo para preguntar, nunca para absorber. */
const TOPE_SUBCONJUNTO_CENT = 5_000_000;

/**
 * ¿Hay un renglón, o una suma de renglones, que dé exactamente el objetivo?
 * Barrido de sumas alcanzables con un bitset (un bit por centavo): con 40
 * renglones son 40 corrimientos, y responder «no» tiene que ser exacto porque de
 * ese «no» depende que la factura se registre sola.
 */
export function subconjuntoQueSuma(
  netos: number[],
  objetivo: number,
  tolerancia: number,
): boolean | 'indeterminado' {
  if (objetivo <= tolerancia) return false;
  const techo = objetivo + tolerancia;
  if (techo > TOPE_SUBCONJUNTO_CENT) return 'indeterminado';
  const mascara = (1n << BigInt(techo + 1)) - 1n;
  let alcanzables = 1n;
  for (const n of netos) {
    if (n <= 0 || n > techo) continue;
    alcanzables |= (alcanzables << BigInt(n)) & mascara;
  }
  for (let v = Math.max(1, objetivo - tolerancia); v <= techo; v++) {
    if ((alcanzables >> BigInt(v)) & 1n) return true;
  }
  return false;
}

// ── los textos que ve el humano ─────────────────────────────────────────────

const plata = (x: number, moneda = 'RD$'): string =>
  `${moneda}${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * LA PREGUNTA: la que se le hace al dueño cuando hay brecha y no hay
 * precedente. Pone los dos escenarios y NO recomienda ninguno, a propósito —
 * por el papel, una factura al 16% del art. 343 y una al 18% con ISC embebido
 * dan las dos una tasa efectiva en el medio, y la vez que el sistema eligió
 * solo, eligió al revés (FP00001063).
 *
 * Ofrece las DOS salidas con nombre, porque una pregunta sin salidas es una
 * factura parada: absorber (y dejar el precedente del emisor) o reclamar el
 * comprobante corregido.
 */
export function textoPreguntaBrecha(n: NumerosBrecha, motivo: string, moneda = 'RD$'): string {
  const escenarios = n.escenarios
    .map((x) =>
      `• al ${x.tasa.toFixed(0)}% el ITBIS sería ${plata(x.itbis, moneda)} → ${
        x.brecha > 0
          ? `te facturaron ${plata(x.brecha, moneda)} de MENOS`
          : x.brecha < 0
          ? `te cobraron ${plata(-x.brecha, moneda)} de MÁS`
          : 'da exacto'
      }`
    )
    .join('\n');
  const efectiva = n.tasa_efectiva === null ? 'no se puede calcular' : `${n.tasa_efectiva.toFixed(2)}%`;
  return `⚠️ El ITBIS de esta factura no cae en ninguna tasa legal y NO lo decido yo.\n\n` +
    `Te cobraron ${plata(n.itbis_impreso, moneda)} de ITBIS sobre ${plata(n.base_gravada, moneda)} ` +
    `de base gravada (total del papel ${plata(n.total_papel, moneda)}): eso da una tasa efectiva de ${efectiva}.\n` +
    `${escenarios}\n\n` +
    `Por el papel NO se distingue una factura legítima a la tasa reducida del art. 343 de una al 18% con ISC ` +
    `embebido en el precio: las dos caen en el medio, y deducir la tasa del mismo número que quiero verificar ` +
    `es dar vueltas en círculo. Detalle técnico: ${motivo}.\n\n` +
    `Decidís vos, UNA vez para este proveedor${n.rnc ? ` (RNC ${n.rnc})` : ''}:\n` +
    `A) ABSORBER — decime a qué tasa factura este emisor y registro el ITBIS IMPRESO, partiendo la base para ` +
    `que ADM llegue al mismo total del papel. Dejo el precedente y sus próximas facturas salen solas.\n` +
    `B) RECLAMAR — la factura queda parada y le pedís al proveedor un comprobante corregido.\n\n` +
    `Criterio: ${n.criterio}.`;
}

/**
 * LA OTRA PREGUNTA: la de la pregunta 2, cuando lo que no cierra es LA LECTURA
 * y no el papel (libro 2026-08-19). No ofrece absorber ni reclamar — las dos
 * presuponen que el papel dice lo que se leyó, y acá eso es justo lo que está
 * en duda: absorber dejaría un precedente de emisor fabricado por un error de
 * OCR, y reclamar manda a pelear con un proveedor que pudo haber facturado
 * bien. Los únicos números que afirma son IMPRESOS (total e ITBIS del papel) o
 * restas de impresos; los reconstruidos viajan sólo dentro del `motivo`, como
 * lo que son: la resta que no cerró.
 */
export function textoPreguntaLectura(n: NumerosBrecha, motivo: string, moneda = 'RD$'): string {
  const baseImplicita = n.total_papel - n.itbis_impreso;
  const limpia = lecturasPosibles(n.itbis_impreso, n.total_papel)
    .find((l) => Math.abs(l.exento) <= UMBRAL_CUADRE);
  return `⚠️ Mi lectura de esta factura no reproduce el papel, y sobre una lectura dudosa no se declara ` +
    `ninguna brecha de ITBIS.\n\n` +
    `Detalle técnico: ${motivo}.\n\n` +
    `Con los números impresos solos, el papel implica una base de ${plata(baseImplicita, moneda)} ` +
    `(total ${plata(n.total_papel, moneda)} − ITBIS impreso ${plata(n.itbis_impreso, moneda)}), y mi ` +
    `reconstrucción de los renglones no reproduce esa cuenta.` +
    (limpia
      ? `\nAl ${limpia.tasa.toFixed(0)}% la cabecera impresa cierra SOLA (base ${plata(limpia.base, moneda)}): ` +
        `todo apunta a que el papel está BIEN y el error es mío al reconstruir los renglones.`
      : '') +
    `\n\nNo te ofrezco absorber ni reclamar: las dos decidirían sobre MI resta, no sobre el papel. ` +
    `Revisá el documento contra lo que leí — confirmame los números impresos (renglones, subtotal, ITBIS, ` +
    `total) o marcá que leí mal el documento — y lo vuelvo a analizar de cero.\n\n` +
    `Criterio: ${CRITERIO_LECTURA}.`;
}

/** La nota que queda en el hilo cuando SÍ se absorbió, en llano y con los
 * números — incluido quién autorizó la tasa, que es lo que la vuelve auditable. */
export function textoNotaBrecha(b: DatosBrecha, moneda = 'RD$'): string {
  const n = (x: number) => plata(x, moneda);
  const cuentas = b.renglones_ajuste.map((r) => `${n(r.monto)} en ${r.cuenta}`).join(', ');
  return `⚠️ El proveedor facturó MENOS ITBIS del que le tocaba y lo registré igual, con el ITBIS impreso. ` +
    `Te cobró ${n(b.itbis_impreso)}; al ${b.tasa.toFixed(0)}% —la tasa que VOS ratificaste para este emisor` +
    `${b.precedente.en ? ` el ${b.precedente.en}` : ''}${
      b.precedente.motivo ? `: «${b.precedente.motivo}»` : ''
    }— habrían sido ${n(b.itbis_esperado)}, o sea ${n(b.brecha)} de menos — el ${b.brecha_pct.toFixed(2)}% del ` +
    `total, por debajo del ${b.tope_pct}% que autorizaste a absorber. Ese ITBIS impreso es el que va al 606 y ` +
    `es el único que podés tomar de crédito fiscal; quien responde ante la DGII por la diferencia es el ` +
    `proveedor. Para que ADM llegue al mismo total del papel, ${n(b.base_sin_gravar)} de la compra quedan sin ` +
    `ITBIS (${cuentas}) — misma cuenta, mismo gasto, todos los renglones del papel siguen ahí, y NO es exento. ` +
    `Criterio: ${b.criterio}.`;
}

/** El párrafo que se agrega al `detalle` de la propuesta: mientras ADM no tenga
 * un campo de nota en `VendorBills`, el detalle y el `Name` del renglón de
 * ajuste son los dos únicos lugares donde esto queda escrito. */
export function textoDetalleBrecha(b: DatosBrecha): string {
  return `ITBIS impreso ${b.itbis_impreso.toFixed(2)} contra ${b.itbis_esperado.toFixed(2)} al ` +
    `${b.tasa.toFixed(0)}% del precedente ratificado del emisor (${b.precedente.ratificado_por}` +
    `${b.precedente.en ? `, ${b.precedente.en}` : ''}): el emisor facturó ${b.brecha.toFixed(2)} de menos ` +
    `(${b.brecha_pct.toFixed(2)}% del total, tope ${b.tope_pct}%). La tasa NO se dedujo del documento. ` +
    `Se registra el ITBIS IMPRESO (es el que se toma de crédito fiscal en el 606; responde el proveedor). ` +
    `Base gravada ${b.base_gravada.toFixed(2)} y ${b.base_sin_gravar.toFixed(2)} sin ITBIS en las mismas ` +
    `cuentas — NO es exento de los arts. 343/344. Sostén: ${b.criterio}.`;
}
