// _shared/adm.ts — EL ÚNICO cliente HTTP de ADM Cloud (F4, precondición 2).
//
// Acá vive el candado que el rol de ADM no da: la firma e-CF no se recorta por
// rol (2026-08-02) y los Void de VendorBills/BankCharges/Journals PASAN con el
// rol actual (re-sondeado 2026-08-14). Hasta hoy la prohibición vivía en un
// `approvals.deny` gitignoreado en un volumen que no sobrevive recreaciones;
// desde acá vive en el cliente, ANTES de armar el request: una ruta fuera de la
// lista blanca tira excepción sin que salga un solo byte a la red.
//
// Todo el que hable con ADM desde la nube importa esto. Un `fetch` directo a
// api.admcloud.net fuera de este archivo es un bug de revisión.

export interface CredAdm {
  codigo: string; // company
  api_role: string; // OJO: "Contabilidad Digital" CON espacio — sin encodear da HTTP 000
  api_appid: string;
  api_username: string;
  api_password: string;
}

const BASE = 'https://api.admcloud.net';
// El paginar() histórico cortaba a las 60 páginas (~3.000 filas).
const MAX_PAGINAS = 60;
const TIMEOUT_MS = 90_000;

/** Ruta bloqueada por el candado. Verla en un log ES el incidente. */
export class ErrorListaBlanca extends Error {
  constructor(metodo: string, ruta: string, motivo: string) {
    super(`ruta bloqueada por la lista blanca: ${metodo} ${ruta} (${motivo})`);
    this.name = 'ErrorListaBlanca';
  }
}

// PERMITIDO (y nada más) — plan-f4 §3.1. `Vendors` está SOLO para el alta con
// respaldo DGII; los demás maestros (Items, Accounts, PaymentTypes…) los crea
// un humano en la UI (regla 6 del repo).
const POST_PERMITIDO = new Set([
  'VendorBills',
  'VendorCreditNotes',
  'BankCharges',
  'BankBankTransfers',
  'Journals',
  'BillPayments',
  'AccountPayments',
  'Vendors',
  'Storage',
]);
const PUT_PERMITIDO = new Set([
  'BillPayments/Authorize',
  'AccountPayments/Authorize',
]);

// NEGADO por patrón, ADEMÁS de por la blanca: si alguien agrega una ruta a la
// lista de arriba, estos patrones la siguen frenando. Redundancia a propósito.
const PATRONES_NEGADOS: [RegExp, string][] = [
  [/\bvoid\b/i, 'anular es del humano, siempre'],
  [/electronicsign/i, 'la firma e-CF no se recorta por rol: el candado es este'],
  [/removesign/i, 'la firma e-CF no se recorta por rol: el candado es este'],
  [/customreports\/execute/i, 'query arbitrario disfrazado de lectura'],
  [/savebankfeeds/i, 'fuera del alcance del registrador'],
  [/bankfileimport/i, 'fuera del alcance del registrador'],
  [/^(creditinvoices|cashinvoices|customer|quotes|salesorders)/i, 'AR completo fuera del alcance'],
];

/**
 * El juicio de la lista blanca, expuesto para el test unitario: la
 * precondición 2 exige probar las rutas negadas SIN mock de HTTP — si esta
 * función deja pasar algo que no debe, el test lo ve sin tocar la red.
 */
export function verificarRuta(metodo: string, ruta: string): void {
  const m = metodo.toUpperCase();
  const r = ruta.replace(/^\/+|\/+$/g, '');
  for (const [patron, motivo] of PATRONES_NEGADOS) {
    if (patron.test(r)) throw new ErrorListaBlanca(m, ruta, motivo);
  }
  if (m === 'GET') return; // lectura libre
  if (m === 'DELETE') throw new ErrorListaBlanca(m, ruta, 'DELETE no existe para este cliente');
  if (m === 'POST') {
    // POST VendorBills sí; POST VendorBills/loquesea no: un sufijo es otra
    // operación (ADM cuelga acciones de la ruta del recurso).
    if (POST_PERMITIDO.has(r)) return;
    throw new ErrorListaBlanca(m, ruta, 'POST fuera de la lista blanca');
  }
  if (m === 'PUT') {
    if (PUT_PERMITIDO.has(r)) return;
    throw new ErrorListaBlanca(m, ruta, 'PUT fuera de la lista blanca (solo los dos Authorize)');
  }
  throw new ErrorListaBlanca(m, ruta, 'método desconocido');
}

/** Quita la company de cualquier texto que vaya a un log o a un error. */
export function sanear(texto: string, cred: Pick<CredAdm, 'codigo'>): string {
  if (!cred.codigo) return texto;
  return texto.split(cred.codigo).join('<company>');
}

export interface RespuestaAdm {
  success?: boolean;
  message?: string | null;
  // deno-lint-ignore no-explicit-any
  data?: any;
}

export class AdmCliente {
  #cred: CredAdm;
  #fetch: typeof fetch;

  /** `fetchImpl` existe para los tests; producción no lo pasa. */
  constructor(cred: CredAdm, fetchImpl: typeof fetch = fetch) {
    this.#cred = cred;
    this.#fetch = fetchImpl;
  }

  #url(ruta: string, params?: Record<string, string | number>): string {
    const u = new URL(`${BASE}/api/${ruta.replace(/^\/+/, '')}`);
    u.searchParams.set('company', this.#cred.codigo);
    u.searchParams.set('role', this.#cred.api_role);
    u.searchParams.set('appid', this.#cred.api_appid);
    for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, String(v));
    return u.toString();
  }

  async llamar(
    metodo: 'GET' | 'POST' | 'PUT',
    ruta: string,
    cuerpo?: unknown,
    params?: Record<string, string | number>,
  ): Promise<RespuestaAdm> {
    verificarRuta(metodo, ruta); // el candado va ANTES de armar el request
    const r = await this.#fetch(this.#url(ruta, params), {
      method: metodo,
      headers: {
        Authorization: `Basic ${btoa(`${this.#cred.api_username}:${this.#cred.api_password}`)}`,
        Accept: 'application/json',
        ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const texto = await r.text();
    if (!r.ok) {
      throw new Error(sanear(`ADM ${r.status} en ${ruta}: ${texto.slice(0, 300)}`, this.#cred));
    }
    try {
      return JSON.parse(texto) as RespuestaAdm;
    } catch {
      throw new Error(sanear(`ADM devolvió no-JSON en ${ruta}: ${texto.slice(0, 200)}`, this.#cred));
    }
  }

  get(ruta: string, params?: Record<string, string | number>) {
    return this.llamar('GET', ruta, undefined, params);
  }

  /**
   * Paginado del fuente: `skip` es obligatorio y `take` se ignora; ADM
   * devuelve 50 por página SIEMPRE y se avanza por lo devuelto. `cortar`
   * permite parar temprano (el barrido de duplicados corta a 6 meses).
   *
   * La tupla de BankBankTransfers, medida el 2026-08-20 contra producción:
   * `data` NO es la lista — es `{Item1: [filas], Item2: <total>}`. La primera
   * versión de esto asumía tupla POR FILA y desanidaba `f.Item1` de cada
   * elemento: el cuadre gritó deriva_api en su corrida inaugural.
   */
  // deno-lint-ignore no-explicit-any
  async paginar(ruta: string, cortar?: (lote: any[]) => boolean): Promise<any[]> {
    // deno-lint-ignore no-explicit-any
    const filas: any[] = [];
    let skip = 0;
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const d = await this.get(ruta, { skip });
      let lote = d.data ?? [];
      if (!Array.isArray(lote)) {
        lote = lote && typeof lote === 'object' && Array.isArray(lote.Item1) ? lote.Item1 : [lote];
      }
      if (!lote.length) break;
      filas.push(...lote);
      if (cortar && cortar(lote)) break;
      if (lote.length < 50) break;
      skip += lote.length;
    }
    return filas;
  }

  /**
   * Readback verificado: GET del detalle DESPUÉS de escribir, con el recurso
   * CORRECTO. Preguntarle a VendorBills por el UUID de una NCP devuelve
   * success:true con data:null — indistinguible de un documento borrado
   * (🪦 NCP00000006: el cron le puso lápida a una nota viva). `data:null` acá
   * es error, no ausencia.
   */
  // deno-lint-ignore no-explicit-any
  async readback(recurso: string, uuid: string): Promise<any> {
    const d = await this.get(`${recurso}/${uuid}`);
    // Algunos recursos anidan: data.data (visto en Journals).
    const doc = d.data && typeof d.data === 'object' && 'data' in d.data && d.data.data
      ? d.data.data
      : d.data;
    if (!doc) {
      throw new Error(
        `readback vacío: ${recurso}/${uuid} respondió sin data — o el documento no existe, ` +
          `o el recurso está equivocado (¿NCP leída como VendorBills?)`,
      );
    }
    return doc;
  }
}
