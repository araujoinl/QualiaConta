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

import { RE_UUID, round2, soloDigitos } from './tipos.ts';
import { TIPOS_DOC } from './adm.ts';

type Dic = Record<string, unknown>;

// El umbral del contrato y de la web: 0,05.
export const UMBRAL_CUADRE = 0.05;

// Los documentos que se arman con líneas de ITEMS (como la pantalla de compras
// de ADM). El resto va en partida doble.
const DOC_ITEMS = new Set(['VendorBills', 'VendorCreditNotes']);
// El ÚNICO que se registra sin `lineas[]`: `registrar-pago-factura.py` no lee
// `p["lineas"]` en ninguna línea del archivo —arma `Documents[]` desde
// `asignacion.facturas` y manda el payload SIN `Accounts[]`, «el asiento lo
// deriva ADM de la cuenta de caja y de la cuenta por pagar de la factura»—.
// AccountPayments sí las exige («no hay lineas en la propuesta»,
// registrar-pago-cuenta.py:188-190), así que no entra acá.
const DOC_SIN_LINEAS = new Set(['BillPayments']);
// Asientos de conciliación: los que exigen el segundo piso «Sostén:».
const DOC_CONCILIACION = new Set(['Journals', 'BankCharges', 'BankBankTransfers']);

// El catálogo 606 es 01-11, uno por documento (nucleo/agg/rnc-tipo-gasto.json).
const RE_TIPO_GASTO = /^(0[1-9]|1[01])$/;
// El código del `TIPO_GASTO_DEFECTO` de `registrar-en-adm.py:105`
// (`dcda501b-… # 02 Trabajos y Servicios`): es el que ADM recibe cuando la
// propuesta no trae el GUID, y por eso es el único código que puede viajar sin
// `adm_id` sin mentir.
const CODIGO_TIPO_GASTO_DEFECTO = '02';

// Los que nacen de un pago: el único par de scripts que exige monto > 0.
const DOC_PAGOS = new Set(['BillPayments', 'AccountPayments']);

// El formato que `registrar-pago-factura.py:398-400` y
// `registrar-pago-cuenta.py:184-186` exigen literalmente antes del POST
// (`^\d{4}-\d{2}-\d{2}$` sobre los 10 primeros caracteres); los otros cuatro
// scripts no la validan y la mandan cruda a DocDate.
const RE_FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

// Las DOS respuestas de DGII con las que `registrar-en-adm.py` da por bueno el
// comprobante (`comprobante_ok`). Todo lo demás —incluido «no verificable»—
// obliga a que el respaldo venga por la otra vía, el padrón de RNC.
const DGII_VERIFICA = new Set(['VIGENTE', 'ACEPTADO']);

// La lista `SIN_RNC` de `registrar-en-adm.py`: las entidades que se resuelven
// por NOMBRE porque no tienen RNC que buscar. Si crece allá, crece acá.
const SIN_RNC = new Set(['DGA ADUANAS']);

/** El `nombre_plano()` del script: colapsa espacios y sube a mayúsculas. */
const nombrePlano = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * Comparación de estados de DGII: sin tildes, sin mayúsculas, sin espacios de
 * más. «Aceptado» y «ACEPTADO» son el mismo estado; copiar la ficha del dossier
 * no puede fallar por un acento.
 */
const normEstado = (v: unknown): string =>
  String(v ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** El estado con el que el preparador rotula «no pude verificar». */
const NO_VERIFICABLE = 'no verificable';

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
  /**
   * Los campos del jsonb que faltan o que no se pueden dar por buenos, por
   * NOMBRE. Van aparte de `errores` porque son la otra mitad del mensaje:
   * `proponer` los devuelve nombrados para que la salida sea preguntar por
   * ELLOS, y no que el turno rellene el molde para que la validación pase.
   */
  faltantes: string[];
}

export interface OpcionesValidacion {
  /** Un hijo de caso es asiento de conciliación aunque su tipo no lo sea. */
  hijoDeCaso?: boolean;
  /**
   * El dossier del preparador (dossier.json del cache), tal cual lo sirve
   * `dossier_completo`. Es la ÚNICA procedencia verificable del eje fiscal:
   * `propuesta.dgii` y `propuesta.rnc_padron` los escribe el modelo, y sin nada
   * contra qué contrastarlos «verificado» es una afirmación suya. Cuando el
   * dossier trae su propia consulta del MISMO comprobante, la compuerta las
   * compara y rechaza la contradicción.
   */
  dossier?: Dic | null;
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
  const faltantes: string[] = [];
  const p = dic(propuesta);
  if (!p) {
    return { errores: ['`propuesta` tiene que ser un objeto jsonb'], avisos, faltantes };
  }

  // ── documento_adm ─────────────────────────────────────────────────────────
  const doc = String(p.documento_adm ?? '').trim();
  if (doc === '') {
    faltantes.push('documento_adm');
    errores.push('falta `documento_adm`: es lo que decide con qué se registra, y lo elige el ROL del hecho (las 5 preguntas), no el NCF');
  } else if (!TIPOS_DOC.has(doc)) {
    errores.push(
      `\`documento_adm\` '${doc}' fuera del catálogo (${[...TIPOS_DOC].join(', ')}). ` +
        'Proponer un tipo que el registrador no conoce deja la fila viva simulando atención: si el hecho no entra en ninguno, la salida es preguntar_al_humano',
    );
  }

  // ── tipo_gasto: uno por documento, obligatorio en toda factura ────────────
  //
  // Se validan los DOS campos porque son dos cosas distintas: `codigo` es lo
  // que la mesa muestra y lo que el humano aprueba; `adm_id` es lo ÚNICO que
  // viaja al POST —`"ExpenseTypeID": (p.get("tipo_gasto") or {}).get("adm_id")
  // or TIPO_GASTO_DEFECTO` (registrar-en-adm.py:537)—. Validar sólo `codigo`
  // dejaba pasar la mentira más barata del jsonb: declarar 07 y registrar 02,
  // que es el GUID del default (registrar-en-adm.py:105, «02 Trabajos y
  // Servicios»), sin una línea de log que lo diga.
  if (DOC_ITEMS.has(doc)) {
    const tg = dic(p.tipo_gasto);
    const codigo = String(tg?.codigo ?? '').trim();
    const admId = String(tg?.adm_id ?? '').trim();
    if (!tg || codigo === '') {
      errores.push('falta `tipo_gasto` {codigo, nombre}: es obligatorio en toda factura (catálogo 606 01-11, UNO por documento; no confundir con la cuenta, que es por renglón)');
    } else if (!RE_TIPO_GASTO.test(codigo)) {
      errores.push(`\`tipo_gasto.codigo\` '${codigo}' no es del catálogo 606 (01..11)`);
    }
    if (admId !== '' && !RE_UUID.test(admId)) {
      errores.push(`\`tipo_gasto.adm_id\` '${admId}' no es un GUID: es el ExpenseTypeID que viaja al POST y ADM rechaza cualquier otra cosa`);
    } else if (admId === '' && RE_TIPO_GASTO.test(codigo) && codigo !== CODIGO_TIPO_GASTO_DEFECTO) {
      // El GUID NO se le pide al modelo: es un dato de catálogo, no un juicio
      // contable, y exigirlo rechazaba toda factura con 606 ≠ 02 (cuatro del
      // corpus dorado, todas registradas de verdad) sin que nadie —ni el
      // humano desde la mesa— tuviera de dónde sacarlo. Lo resuelve el caller
      // contra el espejo `agg/expense-types.json` ANTES de validar; si esa
      // resolución falló, queda AVISO: el default silencioso del registrador
      // es una deuda vieja (registrar-en-adm.py:537) y taparla frenando
      // propuestas legítimas cambia un problema por uno peor.
      avisos.push(
        `\`tipo_gasto.codigo\` dice ${codigo} y no se pudo resolver su \`adm_id\` contra el catálogo: ` +
          `si el registrador no lo tiene, el documento entra al 606 como ${CODIGO_TIPO_GASTO_DEFECTO}`,
      );
    }
  }

  // ── cuenta_destino: retirada el 2026-08-02 ────────────────────────────────
  if ('cuenta_destino' in p) {
    errores.push('`cuenta_destino` está PROHIBIDA (retirada 2026-08-02): la clasificación es por RENGLÓN, en lineas[].cuenta. Una cuenta de cabecera podía contradecir a sus propios renglones');
  }

  // ── lineas ────────────────────────────────────────────────────────────────
  //
  // BillPayments queda afuera de punta a punta: su registrador NO lee
  // `p["lineas"]` ni una vez —lo que aplica sale de `asignacion.facturas`— y el
  // payload va deliberadamente sin `Accounts[]` («Mandar lineas aca seria
  // volver a clasificar un gasto que ya esta clasificado»,
  // registrar-pago-factura.py). Exigírselas frenaba propuestas legítimas, y
  // validar como partida doble unas líneas que nadie va a leer es peor: le pide
  // al turno que invente un asiento para que la compuerta lo deje pasar.
  const lineas = Array.isArray(p.lineas) ? (p.lineas as unknown[]).map((l) => dic(l)) : null;
  const sinLineas = DOC_SIN_LINEAS.has(doc);
  if (!lineas || lineas.length === 0) {
    if (!sinLineas) {
      errores.push('falta `lineas[]`: la propuesta se registra por renglones, y la mesa los muestra como tabla estilo ADM');
    }
  } else if (lineas.some((l) => l === null)) {
    errores.push('cada elemento de `lineas[]` tiene que ser un objeto');
  } else if (doc !== '' && !sinLineas) {
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

  // La `direccion` del cargo bancario NO se avisa acá: es un obligatorio duro y
  // vive en `huecosDeCargoBancario`. Los avisos viajan DESPUÉS de escribir.

  // ── cuadre ────────────────────────────────────────────────────────────────
  //
  // En VendorCreditNotes se compara en valor ABSOLUTO: `normalizar_nota_credito`
  // endereza monto, itbis y cada precio con `abs()` en la puerta del registrador
  // (registrar-en-adm.py:431-435), así que una nota capturada entera en negativo
  // —como la NC de Claro que quedó registrada en NCP00000006— cuadra igual.
  if (lineas && !lineas.some((l) => l === null) && DOC_ITEMS.has(doc)) {
    const filas = lineas as Dic[];
    const monto = numeroDe(p.monto);
    const abs = doc === 'VendorCreditNotes';
    if (monto === null) {
      errores.push('falta `monto`: sin él no hay cuadre que verificar');
    } else {
      const base = filas.reduce(
        (s, l) => s + (numeroDe(l.precio) ?? 0) * (numeroDe(l.cantidad) ?? 0),
        0,
      );
      const itbis = filas.reduce((s, l) => s + (numeroDe(l.itbis) ?? 0), 0);
      const total = round2(base + itbis);
      const dif = abs ? Math.abs(Math.abs(total) - Math.abs(monto)) : Math.abs(total - monto);
      if (dif > UMBRAL_CUADRE) {
        errores.push(
          `no cuadra: sum(precio×cantidad)=${round2(base)} + sum(itbis)=${round2(itbis)} = ${total}, ` +
            `contra monto=${monto} (diferencia ${round2(dif)}, umbral ${UMBRAL_CUADRE}). ` +
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

  if (String(p.metodo ?? '') !== 'razonado' && String(p.precedente_ref ?? '').trim() === '') {
    avisos.push('`metodo` distinto de "razonado" sin `precedente_ref`: el precedente citado es lo que vuelve auditable la decisión');
  }

  // ── la compuerta de SUFICIENCIA ───────────────────────────────────────────
  const suf = huecosDeRegistro(
    doc,
    p,
    lineas && !lineas.some((l) => l === null) ? (lineas as Dic[]) : null,
    dic(opciones.dossier ?? null),
  );
  errores.push(...suf.errores);
  avisos.push(...suf.avisos);
  faltantes.push(...suf.faltantes);

  return { errores, avisos, faltantes };
}

// ═════════════════════════════════════════════ la compuerta de SUFICIENCIA
//
// Hasta el 2026-08-16 el cierre estaba gateado por la CONSISTENCIA INTERNA del
// objeto —catálogo, forma de las líneas, cuadre— y jamás por si el objeto
// estaba COMPLETO. Un jsonb bien formado al que le faltaba la fecha pasaba
// igual, y el hueco recién aparecía en el `morir()` del script de registro,
// meses después y con el humano ya habiendo aprobado. Peor: el único canal que
// nombraba huecos eran los `avisos`, y ése es MUDO por construcción —`proponer`
// escribe primero y devuelve el aviso después, pasado el punto de no retorno.
//
// Acá abajo están portados, uno por uno, los obligatorios que los scripts de
// registro exigen ANTES del POST. Ninguno es invención: cada regla cita la
// línea del script que la sostiene, y esa línea es de una de DOS clases —
//
//   1. un `morir()`: sin el campo el registro no ocurre y el trabajo se para;
//   2. un DEFAULT EN SILENCIO (`p.get("x") or "…"`): sin el campo el registro
//      ocurre igual, pero registra OTRA COSA que la que el humano aprobó. Son
//      los peores: no dejan rastro. `moneda` (USD registrado en pesos),
//      `direccion` del cargo bancario (plata que salió, asentada como entrada)
//      y el `adm_id` del tipo de gasto (606 declarado 09, registrado 02) son
//      los tres que hay, y los tres se frenan igual que un `morir()`.
//
// Lo que NO se pide es todo lo demás: si ningún registrador lo lee, no es un
// hueco — un rechazo falso cuesta lo mismo que un hueco, sólo que del otro
// lado. Por eso BillPayments no lleva `lineas[]` y Journals no lleva `monto`.
// La compuerta frena HUECOS, no decisiones — una propuesta con todos sus campos
// pasa aunque el criterio sea discutible (el caso suena-inversor: e-NCF que
// DGII no pudo verificar, proveedor con precedente, y el humano lo aprobó y se
// registró sin fricción).

interface Huecos {
  errores: string[];
  avisos: string[];
  faltantes: string[];
}

function huecosDeRegistro(
  doc: string,
  p: Dic,
  filas: Dic[] | null,
  dossier: Dic | null,
): Huecos {
  const errores: string[] = [];
  const avisos: string[] = [];
  const faltantes: string[] = [];
  // Sin `documento_adm` válido no hay tabla que aplicar: el error ya se dio.
  if (doc === '' || !TIPOS_DOC.has(doc)) return { errores, avisos, faltantes };

  const falta = (campo: string, motivo: string) => {
    faltantes.push(campo);
    errores.push(motivo);
  };

  // ── fecha: los SEIS scripts la necesitan ──────────────────────────────────
  // Es el DocDate. Cuatro mueren sin ella: `registrar-pago-factura.py` y
  // `registrar-pago-cuenta.py` con «la propuesta no trae una fecha valida»,
  // `registrar-asiento-diario.py:201-202` y
  // `registrar-transferencia-bancaria.py:203-204` con «falta la fecha del
  // documento»; los otros dos (`registrar-en-adm.py`,
  // `registrar-cargo-bancario.py`) la mandan cruda a DocDate y ADM rechaza.
  // Lápida: la propuesta de 90k del caso Formax salió a la mesa SIN fecha y el
  // humano la rechazó — el hueco era visible desde acá y nadie lo miraba.
  const fecha = String(p.fecha ?? '').trim();
  if (fecha === '') {
    falta('fecha', 'falta `fecha`: es el DocDate del documento y ningún script de registro arma el payload sin ella. Si el papel no la dice, no la deduzcas: preguntá');
  } else if (!RE_FECHA_ISO.test(fecha.slice(0, 10))) {
    falta('fecha', `\`fecha\` '${fecha}' no es AAAA-MM-DD, que es lo único que el registrador acepta. Ojo con la inversión DD/MM (el dossier de Guan Lan trajo 2026-01-08 por 2026-08-01)`);
  }

  // ── moneda ────────────────────────────────────────────────────────────────
  // Los seis scripts caen a `p.get("moneda") or "DOP"`: ausente y DOP son
  // indistinguibles para ellos, así que una factura en USD (PIER 17, flete de
  // importación) quedaría registrada en pesos sin que nadie se entere.
  if (String(p.moneda ?? '').trim() === '') {
    falta('moneda', 'falta `moneda`: el registrador cae a "DOP" en silencio, y un documento en USD registrado en pesos no se descubre hasta la conciliación');
  }

  // ── monto ─────────────────────────────────────────────────────────────────
  //
  // Journals es la excepción y no es un descuido del script: `TotalAmount` sale
  // de las líneas (`total_amount = sum_d`, registrar-asiento-diario.py), y
  // `p["monto"]` no se lee NUNCA en ese archivo. Exigirlo frenaba asientos
  // legítimos. Lo que sí se hace es cruzarlo cuando viene: un `monto` que no es
  // la suma de los débitos es la tarjeta de la mesa contando otra cosa que el
  // asiento, y el humano aprueba la tarjeta.
  const monto = numeroDe(p.monto);
  if (doc === 'Journals') {
    if (monto !== null && filas) {
      const debitos = round2(filas.reduce((s, l) => s + (numeroDe(l.debito) ?? 0), 0));
      if (Math.abs(debitos - monto) > UMBRAL_CUADRE) {
        errores.push(
          `\`monto\` dice ${monto} y los débitos del asiento suman ${debitos} (umbral ${UMBRAL_CUADRE}): en un Journals el TotalAmount lo arma el registrador desde las líneas, ` +
            'así que ese `monto` sólo lo ve el humano que aprueba — y le está contando otra cosa que el asiento',
        );
      }
    }
  } else if (monto === null) {
    falta('monto', 'falta `monto`: es el total del documento, contra el que cuadra el registrador');
  } else if (monto === 0) {
    falta('monto', '`monto` en 0: un documento de cero no registra nada');
  } else if (DOC_PAGOS.has(doc) && monto < 0) {
    errores.push('`monto` negativo en un pago: «un pago de cero o negativo no es un pago» (registrar-pago-factura.py). El sentido lo da el documento, no el signo');
  } else if (doc === 'VendorBills' && monto < 0) {
    errores.push(
      '`monto` negativo en VendorBills: el signo negativo es de la NOTA DE CRÉDITO, y el registrador la enruta por el NCF (E34 → VendorCreditNotes), no por este campo. ' +
        'Es exactamente la NC de Claro del 2026-08-07, donde el modelo escribió VendorBills y mandó los montos en negativo',
    );
  }

  switch (doc) {
    case 'VendorBills':
    case 'VendorCreditNotes':
      huecosDeFactura(p, dossier, falta, errores, avisos, faltantes);
      break;
    case 'BankCharges':
      huecosDeCargoBancario(p, filas, monto, falta, errores);
      break;
    case 'BankBankTransfers':
      // `registrar-transferencia-bancaria.py` deduce origen y destino de las
      // líneas (débito = destino, crédito = origen) y muere con «no puedo
      // determinar origen/destino». Las dos patas son cuentas de caja: acá NO
      // se exige contrapartida, a diferencia del cargo bancario.
      if (filas && !filas.some((l) => (numeroDe(l.debito) ?? 0) > 0)) {
        falta('lineas[].debito', 'la transferencia no trae ninguna línea con `debito`: ésa es la cuenta DESTINO, y sin ella el registrador no sabe adónde entró la plata');
      }
      if (filas && !filas.some((l) => (numeroDe(l.credito) ?? 0) > 0)) {
        falta('lineas[].credito', 'la transferencia no trae ninguna línea con `credito`: ésa es la cuenta ORIGEN, y sin ella el registrador no sabe de dónde salió la plata');
      }
      break;
    case 'BillPayments': {
      // De qué cuenta sale la plata. `cuenta_de_caja()` lo lee literal —
      // `numero = str(p.get("cuenta_numero") or "").strip()`
      // (registrar-pago-factura.py:204)— y si no está en TARJETAS ni en
      // CUENTAS_BANCO muere con «no se de que cuenta de ADM sale este pago»
      // (líneas 216-220). No hay default: sin este campo el pago no se registra.
      // Es el NÚMERO del banco o de la tarjeta (el de `mapa-cuentas.yaml`), no
      // el código contable ni el GUID.
      if (String(p.cuenta_numero ?? '').trim() === '') {
        falta(
          'cuenta_numero',
          'falta `cuenta_numero`: es el número de la cuenta de banco o de la tarjeta de la que sale el pago, y con él el registrador resuelve la cuenta de caja de ADM. ' +
            'Sin él muere con «no se de que cuenta de ADM sale este pago» — y no lo adivina desde `cuenta_banco`, que es sólo el nombre para el humano',
        );
      }
      // «la propuesta no dice que factura cierra este pago: `asignacion.facturas`
      // viene vacia. Un pago a proveedor sin documento al que aplicarse queda
      // como anticipo, que no es lo que nadie quiso» (registrar-pago-factura.py).
      const asignacion = dic(p.asignacion);
      const facturas = Array.isArray(asignacion?.facturas) ? (asignacion!.facturas as unknown[]) : [];
      if (facturas.length === 0) {
        falta('asignacion.facturas', 'falta `asignacion.facturas[]`: un pago a proveedor sin la factura a la que se aplica queda como anticipo, que no es lo que nadie quiso');
      } else {
        facturas.forEach((cruda, i) => {
          const f = dic(cruda);
          if (!f || String(f.docid ?? '').trim() === '') {
            falta(`asignacion.facturas[${i + 1}].docid`, `la factura #${i + 1} de \`asignacion\` no trae \`docid\`: el registrador la busca por ese DocID, no por monto`);
          }
        });
        if (facturas.length > 1) {
          const sinMonto = facturas.filter((c) => numeroDe(dic(c)?.monto) === null).length;
          if (sinMonto > 0) {
            falta('asignacion.facturas[].monto', `\`asignacion\` trae ${facturas.length} facturas y ${sinMonto} sin su \`monto\`: repartir un pago entre varias es una decisión contable —cuál se salda entera y cuál queda abierta—, no un \`for\``);
          }
        }
      }
      break;
    }
    case 'AccountPayments':
      // «la propuesta no trae banco_id (GUID de la cuenta de caja/banco). El
      // sugeridor o el humano lo debe poner; sin eso no se de que banco sale.»
      if (!RE_UUID.test(String(p.banco_id ?? '').trim())) {
        falta('banco_id', 'falta `banco_id` (el GUID de la cuenta de caja en ADM): sin él el registrador no sabe de qué banco sale la plata, y no lo adivina');
      }
      break;
  }

  return { errores, avisos, faltantes };
}

/**
 * Los obligatorios de `registrar-en-adm.py`, que es el que arma VendorBills y
 * VendorCreditNotes. Cada uno con el `morir()` que lo pide.
 */
function huecosDeFactura(
  p: Dic,
  dossier: Dic | null,
  falta: (campo: string, motivo: string) => void,
  errores: string[],
  avisos: string[],
  faltantes: string[],
): void {
  const proveedor = String(p.proveedor ?? '').trim();
  if (proveedor === '') {
    falta('proveedor', 'falta `proveedor`: es el `Beneficiary` del documento y el único camino para las entidades sin RNC');
  }

  // El match del proveedor es por RNC EXACTO, nunca por nombre («los nombres se
  // escriben de veinte formas»). Sin 9 u 11 dígitos el script cae al camino de
  // SIN_RNC, que resuelve por nombre SOLO para las entidades de esa lista y si
  // no, muere: «la propuesta no trae un RNC valido: no busco ni creo el proveedor».
  const rnc = soloDigitos(p.rnc);
  if (rnc.length !== 9 && rnc.length !== 11) {
    if (SIN_RNC.has(nombrePlano(proveedor))) {
      avisos.push(`«${proveedor}» va sin RNC por la lista SIN_RNC del registrador: se BUSCA por nombre y jamás se crea (así quedó la FP00001133, la única evidencia de que ADM lo acepta)`);
    } else {
      falta('rnc', `\`rnc\` ${rnc === '' ? 'ausente' : `'${String(p.rnc)}' (${rnc.length} dígitos)`}: el proveedor se busca por RNC exacto (9 u 11 dígitos), nunca por nombre. Sin uno válido el registrador ni busca ni crea el proveedor`);
    }
  }

  // ADM frena un duplicado por DOS claves independientes —el NCF y la
  // referencia del proveedor— y sin NINGUNA deja pasar el mismo documento
  // cuantas veces se lo manden, callado. Un papel sin NCF no es raro (el Estado
  // no emite comprobante fiscal); lo que no puede faltar entonces es la
  // referencia. Las 1.120 facturas del histórico traen una u otra.
  const ncf = String(p.ncf ?? '').trim();
  const referencia = String(p.numero_factura_suplidor ?? '').trim();
  if (ncf === '' && referencia === '') {
    falta(
      'ncf | numero_factura_suplidor',
      'el documento no trae `ncf` ni `numero_factura_suplidor`, y ésas son las DOS claves con las que ADM frena un duplicado: sin ninguna, la misma plata se puede registrar dos veces sin que nadie se entere. ' +
        'En una liquidación de aduana, la referencia es el número de DUA',
    );
  }

  const dgii = dic(p.dgii);
  const estado = String(dgii?.estado ?? '').trim();
  if (ncf !== '') {
    // Antes esto era un AVISO, y el aviso viaja después de escribir: nadie lo
    // leía nunca. Una factura con NCF y sin `dgii` es una verificación que no
    // se hizo, no una que salió mal.
    if (!dgii || estado === '') {
      falta('dgii', 'la factura trae NCF y no hay `dgii` con su `estado`: el comprobante no está verificado. Pedí la verificación con consultar_dgii y copiá la salida TAL CUAL; si vuelve sin poder verificar, eso también se copia');
    } else {
      // El caso nuevo-milenio: el humano corrigió el NCF por chat y el turno lo
      // copió al jsonb dejando abajo la verificación del NCF viejo. Un dato
      // copiado y uno re-verificado son indistinguibles… salvo cuando el propio
      // bloque `dgii` dice que verificó OTRO comprobante. Ahí sí se ve.
      const ncfVerificado = String(dgii.ncf ?? dgii.encf ?? '').trim().toUpperCase();
      if (ncfVerificado !== '' && ncfVerificado !== ncf.toUpperCase()) {
        faltantes.push('dgii');
        errores.push(`el bloque \`dgii\` verificó ${ncfVerificado} y la propuesta dice \`ncf\` ${ncf}: estás firmando con la verificación de OTRO comprobante. Re-verificá el NCF que vas a registrar`);
      }
      const rncVerificado = soloDigitos(dgii.rnc_emisor);
      if (rncVerificado !== '' && rnc !== '' && rncVerificado !== rnc) {
        faltantes.push('dgii');
        errores.push(`el bloque \`dgii\` verificó al emisor ${rncVerificado} y la propuesta dice \`rnc\` ${rnc}: o el RNC está mal copiado o la verificación es de otro documento`);
      }
    }
  }

  // ── procedencia del eje fiscal ────────────────────────────────────────────
  //
  // Hasta acá TODO el eje fiscal lo escribió el modelo: `dgii.estado` es una
  // frase suya, y la compuerta le creía. La única contraparte verificable es el
  // dossier del preparador (`dossier.dgii`, la ficha que él trajo de DGII), que
  // es además el que hace que re-consultar esté PROHIBIDO cuando ya trae estado
  // —el predicado `yaVerificado` de consultas.ts—: si el dossier verificó y el
  // turno no podía volver a preguntar, lo que viaja en la propuesta tiene que
  // ser esa misma ficha copiada. Cualquier otra cosa la escribió el modelo.
  //
  // Se compara SÓLO cuando el dossier verificó el MISMO comprobante y su estado
  // no es «no verificable» — que son exactamente las dos puertas por las que el
  // turno sí puede consultar y traer un estado nuevo (el caso nuevo-milenio: el
  // humano corrigió el NCF por chat y la ficha del dossier es del viejo).
  const fichaDossier = dic(dossier?.dgii);
  const estadoDossier = String(fichaDossier?.estado ?? '').trim();
  const ncfDossier = String(fichaDossier?.ncf ?? fichaDossier?.encf ?? '').trim().toUpperCase();
  if (
    ncf !== '' && estado !== '' &&
    estadoDossier !== '' && normEstado(estadoDossier) !== NO_VERIFICABLE &&
    ncfDossier !== '' && ncfDossier === ncf.toUpperCase() &&
    normEstado(estado) !== normEstado(estadoDossier)
  ) {
    faltantes.push('dgii');
    errores.push(
      `el dossier del preparador verificó ${ncfDossier} y DGII contestó '${estadoDossier}', pero la propuesta dice \`dgii.estado\` '${estado}'. ` +
        'Con el dossier verificado no podías re-consultar (consultar_dgii lo rechaza), así que ese estado no salió de DGII: salió de vos. ' +
        'Copiá la ficha del dossier TAL CUAL — y si creés que está mal, eso se pregunta, no se reescribe',
    );
  }

  // El respaldo del ALTA del proveedor, portado de `asegurar_proveedor()`: si
  // el comprobante no verifica Y el padrón tampoco lo reconoce, el script muere
  // con «No doy de alta un proveedor sin respaldo». Sólo aplica cuando el
  // proveedor puede ser NUEVO — con precedente citado, el proveedor ya existe
  // en ADM y el script nunca llega a preguntar. Por eso suena-inversor (e-NCF
  // no verificable, precedente del proveedor) pasa, y big-apple (proveedor
  // nuevo, timbre no verificable) sólo pasó porque traía el padrón.
  const comprobanteOk = DGII_VERIFICA.has(estado.toUpperCase());
  const padron = dic(p.rnc_padron);
  const padronOk = String(padron?.estado ?? '').trim().toUpperCase() === 'ENCONTRADO' &&
    String(padron?.razon_social ?? '').trim() !== '';
  const citaPrecedente = String(p.precedente_ref ?? '').trim() !== '';

  // El mismo contraste, sobre el padrón: `rnc_padron` es lo que abre el ALTA de
  // un proveedor nuevo, así que un «ENCONTRADO» escrito por el modelo vale una
  // creación en el libro oficial. El preparador consulta el padrón SIEMPRE que
  // haya RNC y lo deja en `dossier.rnc_emisor`; si esa ficha dice otra cosa
  // sobre el MISMO RNC, la que manda es la del dossier.
  const padronDossier = dic(dossier?.rnc_emisor);
  const estadoPadronDossier = String(padronDossier?.estado ?? '').trim();
  const rncPadronDossier = soloDigitos(padronDossier?.rnc_consultado ?? padronDossier?.rnc);
  if (
    padron && String(padron.estado ?? '').trim() !== '' &&
    estadoPadronDossier !== '' && normEstado(estadoPadronDossier) !== NO_VERIFICABLE &&
    rncPadronDossier !== '' && rnc !== '' && rncPadronDossier === rnc &&
    normEstado(padron.estado) !== normEstado(estadoPadronDossier)
  ) {
    faltantes.push('rnc_padron');
    errores.push(
      `el dossier consultó el padrón del RNC ${rncPadronDossier} y quedó en '${estadoPadronDossier}', y la propuesta dice \`rnc_padron.estado\` '${String(padron.estado)}'. ` +
        'El padrón es lo que habilita dar de alta al proveedor en ADM: si difiere del dossier, no es una copia — y el alta se apoyaría en algo que DGII no dijo',
    );
  }
  if (ncf !== '' && estado !== '' && !comprobanteOk && !padronOk && !citaPrecedente) {
    falta(
      'rnc_padron',
      `el comprobante quedó en '${estado}' y no hay precedente que pruebe que el proveedor ya existe en ADM: sin respaldo del padrón el registrador NO da de alta al proveedor y el trabajo muere ahí. ` +
        'Consultá el padrón de RNC (consultar_dgii modo padron) y copiá la salida a `rnc_padron`; si tampoco lo reconoce, el emisor es lo que hay que preguntar',
    );
  }
}

/**
 * Los obligatorios de `registrar-cargo-bancario.py`. El cargo bancario tiene
 * una forma que la partida doble sola no garantiza: UNA pata es la cuenta de
 * caja (va como CashAccountID, fuera de Accounts[]) y el resto es la
 * contrapartida, que el script cuadra contra `monto`.
 */
function huecosDeCargoBancario(
  p: Dic,
  filas: Dic[] | null,
  monto: number | null,
  falta: (campo: string, motivo: string) => void,
  errores: string[],
): void {
  // ── direccion: el obligatorio que estaba en el canal MUDO ─────────────────
  //
  // `direccion = p.get("direccion") or "credito"` (registrar-cargo-bancario.py:
  // 257), y con eso `total_amount = -abs(monto) if direccion == "credito" else
  // abs(monto)` (línea 321). O sea: AUSENTE significa «entró plata», y un cargo
  // real —plata que SALIÓ— registrado sin este campo entra al libro con el
  // signo invertido. No hay `morir()` que lo frene: es el default silencioso
  // más caro de los seis scripts. Como aviso no servía de nada — los avisos
  // viajan después de escribir, y para entonces la fila ya está propuesta.
  //
  // Cualquier valor que no sea exactamente 'credito' cae en la rama del cargo
  // (líneas 321 y 331): un 'salida' o un 'debito' inventado se registra como
  // cargo sin que nadie lo note, así que el enum se valida acá.
  const direccion = String(p.direccion ?? '').trim();
  if (direccion === '') {
    falta(
      'direccion',
      'falta `direccion` en un cargo bancario: cargo = SALIÓ plata, credito = ENTRÓ. Ausente no es neutro — el registrador la da por "credito" y manda el TotalAmount en negativo, ' +
        'así que un cargo real entraría al libro al revés. Sale del estado de cuenta (el signo del movimiento), no del criterio',
    );
  } else if (direccion !== 'cargo' && direccion !== 'credito') {
    falta(
      'direccion',
      `\`direccion\` '${direccion}' no es ninguno de los dos valores que el registrador entiende (cargo | credito): todo lo que no sea exactamente "credito" lo trata como cargo, en silencio`,
    );
  }

  if (!filas || filas.length === 0) return; // el error de `lineas` ya se dio

  const esCaja = (l: Dic) => {
    const c = String(l.cuenta ?? '').trim();
    return RE_CUENTA_BANCO.test(c) || CUENTAS_TARJETA.has(c);
  };
  // El script NO netea las cuentas de caja: toma la PRIMERA línea que matchea
  // como CashAccountID (`banco_idx`, con su `break`) y TODAS las demás van a
  // `Accounts[]`. Copiar esa elección importa — con dos líneas de caja, netear
  // daba un número que el registrador nunca calcula.
  const idxCaja = filas.findIndex(esCaja);
  if (idxCaja < 0) {
    falta(
      'lineas[].cuenta',
      'ninguna línea es cuenta de caja (101.xx, 102.xx o una tarjeta 203.10/203.11): el registrador la necesita para el CashAccountID y muere sin ella. Si la cuenta es nueva, va primero a mapa-cuentas.yaml',
    );
    return;
  }
  const contra = filas.filter((_, i) => i !== idxCaja);
  if (contra.length === 0) {
    falta(
      'lineas[]',
      'el cargo trae UNA sola línea, la del banco: no queda contrapartida que registrar y el script muere con «no hay lineas de contrapartida (todas eran el banco?)». Falta el renglón del gasto o del ingreso',
    );
    return;
  }
  if (contra.every(esCaja)) {
    errores.push(
      'todas las líneas son cuentas de caja: la primera va como CashAccountID y las otras quedarían DENTRO de Accounts[], o sea un movimiento de banco que la conciliación de esa cuenta nunca ve. ' +
        'Un traspaso entre bancos propios es BankBankTransfers, no un cargo',
    );
  }

  // El cuadre del script no es débitos = créditos: es la CONTRAPARTIDA contra
  // `monto`, el importe que el banco movió, y con el signo que dice la
  // dirección — `dif = sum_c - sum_d - monto` si es crédito y
  // `sum_d - sum_c - monto` si es cargo (registrar-cargo-bancario.py:329-336).
  // Sin esto, un cargo cuadrado internamente pero por otro importe que el del
  // estado de cuenta pasa limpio y deja el movimiento sin conciliar.
  if (monto === null) return;
  const sumD = round2(contra.reduce((s, l) => s + (numeroDe(l.debito) ?? 0), 0));
  const sumC = round2(contra.reduce((s, l) => s + (numeroDe(l.credito) ?? 0), 0));
  if (direccion === 'credito' || direccion === 'cargo') {
    const dif = direccion === 'credito' ? sumC - sumD - monto : sumD - sumC - monto;
    if (Math.abs(dif) > UMBRAL_CUADRE) {
      const lado = direccion === 'credito' ? 'al crédito' : 'al débito';
      errores.push(
        `la contrapartida da ${round2(direccion === 'credito' ? sumC - sumD : sumD - sumC)} ${lado} y \`monto\` dice ${monto} ` +
          `(diferencia ${round2(Math.abs(dif))}, umbral ${UMBRAL_CUADRE}): el registrador cuadra exactamente eso y muere con «no cuadra». ` +
          `Si el signo está al revés, el que está mal es \`direccion\` o el lado de los renglones — con "${direccion}" la contrapartida va ${lado}. ` +
          'El monto es el del estado de cuenta, no el que haga cerrar el asiento',
      );
    }
  } else {
    // Sin dirección válida no se puede saber de qué lado va la contrapartida,
    // pero el importe se chequea igual: es el del estado de cuenta.
    if (Math.abs(Math.abs(sumD - sumC) - Math.abs(monto)) > UMBRAL_CUADRE) {
      errores.push(
        `la contrapartida mueve ${Math.abs(round2(sumD - sumC))} y \`monto\` dice ${Math.abs(monto)} (umbral ${UMBRAL_CUADRE}): el registrador cuadra la contrapartida contra el monto del banco y muere con «no cuadra»`,
      );
    }
  }
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
    if ('debito' in l || 'credito' in l) {
      errores.push(`línea ${n}: ${doc} lleva renglones de ITEMS (descripcion/cantidad/precio/itbis/cuenta), no partida doble`);
    }
  });

  // La nota de crédito NO exige precios positivos, y exigirlos era un rechazo
  // falso probado: la NC de Claro (E340009998496) llegó con las tres líneas, el
  // monto y el ITBIS en negativo y quedó REGISTRADA como NCP00000006. El
  // registrador la endereza en la puerta con `abs()` («Se endereza UNA vez y en
  // la puerta», normalizar_nota_credito, registrar-en-adm.py). Lo que sí lo
  // mata, y por eso es lo único que se frena acá, son los signos MEZCLADOS:
  // «No la enderezo: eso inventaria plata. Volve al documento y capturala
  // entera con un solo signo» (líneas 423-429).
  if (doc === 'VendorCreditNotes') {
    const precios = filas.map((l) => numeroDe(l.precio) ?? 0).filter((v) => v !== 0);
    const signos = new Set(precios.map((v) => (v > 0 ? 1 : -1)));
    if (signos.size > 1) {
      errores.push(
        `la nota de crédito trae los precios con signos MEZCLADOS (${precios.join(', ')}): el registrador no la endereza —«eso inventaria plata»— y muere. ` +
          'Una nota con líneas de los dos signos es una lectura a medias: volvé al documento y capturala entera con un solo signo',
      );
    }
  }

  // El ITBIS también se compara en absoluto en la nota de crédito: el
  // registrador hace `p["itbis"] = abs(...)` y `itbis=abs(...)` por línea antes
  // de cuadrar nada.
  const itbisCabecera = numeroDe(p.itbis);
  const abs = doc === 'VendorCreditNotes';
  const itbisLineas = round2(filas.reduce((s, l) => s + (numeroDe(l.itbis) ?? 0), 0));
  const difItbis = itbisCabecera === null
    ? 0
    : abs
    ? Math.abs(Math.abs(itbisCabecera) - Math.abs(itbisLineas))
    : Math.abs(itbisCabecera - itbisLineas);
  if (itbisCabecera !== null && difItbis > UMBRAL_CUADRE) {
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
    return { errores, avisos, faltantes: ['resumen'] };
  }
  if (r.length > 160) avisos.push(`\`resumen\` de ${r.length} caracteres: la tarjeta lo trunca, dejalo corto`);
  if (/\(?\s*caso\s*#\s*\d+\s*\)?/i.test(r)) {
    errores.push('el «(Caso #N)» no va en el `resumen`: los pasos se muestran DENTRO de su caso y la traza ya vive en `propuesta.caso_id`');
  }
  if (/\b(101|102|203|220|611|690)\.\d/.test(r)) {
    avisos.push('el `resumen` lleva códigos de cuenta: van en los renglones, no en el título');
  }
  return { errores, avisos, faltantes: [] };
}
