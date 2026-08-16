// qualia-contable/adm.ts — la tool leer_adm: GET de SOLO LECTURA contra la API
// de ADM Cloud, con el patrón verificado de docs/admcloud-conexion.md y el
// paginado del fuente (registrar-en-adm.py: «skip es obligatorio y take se
// ignora; ADM devuelve 50 por página SIEMPRE; se avanza por lo devuelto»).
//
// Prohibiciones heredadas con lápida:
// - `?Reference=` / `?DocID=` JAMÁS se mandan: mienten (contrato §2.1). Todo
//   filtro es LOCAL, sobre lo que la API devolvió.
// - El listado no trae anulados (CB00000169): un docid que no aparece NO es
//   prueba de que el documento murió.

import {
  CtxTurno,
  delExamen,
  ErrorGuard,
  recortar,
  ResultadoTool,
  soloDigitos,
} from './tipos.ts';

const BASE = 'https://api.admcloud.net';
// El paginar() del fuente cortaba a las 60 páginas (~3.000 filas).
const MAX_PAGINAS = 60;

// Los tipos de documento que la mesa conoce — la MISMA lista de qualia-lapidas
// y del case de registro del poller (se desincronizan solas; ya pasó 3 veces).
export const TIPOS_DOC = new Set([
  'VendorBills',
  'VendorCreditNotes',
  'BankCharges',
  'BankBankTransfers',
  'BillPayments',
  'AccountPayments',
  'Journals',
]);

interface CredAdm {
  codigo: string;
  api_role: string;
  api_appid: string;
  api_username: string;
  api_password: string;
}

// TODO(F4 §4.6 del plan): partir admcloud_empresas — credenciales a Vault y
// select por columnas. Hoy la fila viva es esta; el punto único de cambio es acá.
async function credenciales(ctx: CtxTurno): Promise<CredAdm> {
  const { data, error } = await ctx.db
    .from('admcloud_empresas')
    .select('codigo, api_role, api_appid, api_username, api_password')
    .eq('id', ctx.empresaId)
    .single();
  if (error || !data) {
    throw new ErrorGuard(`sin credenciales ADM para la empresa (${error?.message ?? 'sin fila'})`);
  }
  return data as CredAdm;
}

function urlAdm(cred: CredAdm, ruta: string, params?: Record<string, string>): string {
  const u = new URL(`${BASE}/api/${ruta}`);
  u.searchParams.set('company', cred.codigo);
  u.searchParams.set('role', cred.api_role);
  u.searchParams.set('appid', cred.api_appid);
  for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

async function admGet(
  cred: CredAdm,
  ruta: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const r = await fetch(urlAdm(cred, ruta, params), {
    headers: {
      Authorization: `Basic ${btoa(`${cred.api_username}:${cred.api_password}`)}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) {
    // El cuerpo como texto, no como JSON: el error puede no serlo (conexion.md).
    const cuerpo = await r.text().catch(() => '');
    throw new Error(`ADM respondio HTTP ${r.status} en /${ruta}: ${recortar(cuerpo, 200)}`);
  }
  return await r.json();
}

/**
 * La cascada de desenvoltura de admcloud-conexion.md: arreglo pelado, o
 * envuelto en Data/data/Items/items, o el primer arreglo no vacío del objeto.
 * Asumir una forma fija «funciona hasta que se cambia de endpoint».
 */
function desenvolverLista(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    for (const k of ['Data', 'data', 'Items', 'items']) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
    }
    for (const v of Object.values(o)) {
      if (Array.isArray(v) && v.length > 0) return v;
    }
  }
  return [];
}

/** El detalle por UUID llega como objeto pelado o como {data: {...}}. */
function desenvolverObjeto(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  for (const k of ['data', 'Data']) {
    const v = o[k];
    if (v === null) return null; // ADM dice «no está» con 200 + data:null
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  }
  return o;
}

/**
 * Paginado del fuente: skip avanza por lo realmente devuelto, corta con la
 * página vacía. `alto(lote)` permite cortar temprano (búsqueda por docid).
 */
async function paginarAdm(
  cred: CredAdm,
  recurso: string,
  alto?: (lote: unknown[]) => boolean,
): Promise<{ filas: unknown[]; truncado: boolean }> {
  const filas: unknown[] = [];
  let skip = 0;
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const lote = desenvolverLista(await admGet(cred, recurso, { skip: String(skip) }));
    if (lote.length === 0) return { filas, truncado: false };
    filas.push(...lote);
    if (alto && alto(lote)) return { filas, truncado: false };
    skip += lote.length;
  }
  return { filas, truncado: true };
}

// Proyección para listados: las filas crudas de ADM traen decenas de campos y
// cada iteración del turno re-paga el prompt entero — se conservan los campos
// que identifican y montan, y `_claves` avisa qué más existe (el detalle por
// uuid trae todo).
const RE_CAMPO_UTIL =
  /^(id|.*docid.*|.*reference.*|.*ncf.*|.*date.*|.*fecha.*|.*amount.*|.*total.*|.*balance.*|.*monto.*|.*name.*|.*nombre.*|.*fiscal.*|.*vendor.*|.*status.*|.*currency.*|.*descr.*|.*comment.*|code)$/i;

function compactarFila(f: unknown): Record<string, unknown> {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return { valor: f };
  const o = f as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const otras: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined) continue;
    if (RE_CAMPO_UTIL.test(k) && (typeof v !== 'object' || Array.isArray(v) === false)) {
      if (typeof v === 'object') continue;
      out[k] = typeof v === 'string' ? recortar(v, 160) : v;
    } else {
      otras.push(k);
    }
  }
  if (otras.length > 0) out._claves = otras.join(',');
  return out;
}

const campo = (f: unknown, k: string): string => {
  if (!f || typeof f !== 'object') return '';
  return String((f as Record<string, unknown>)[k] ?? '').trim();
};

export interface ArgsLeerAdm {
  modo?: unknown;
  tipo_doc?: unknown;
  uuid?: unknown;
  docid?: unknown;
  rnc?: unknown;
  serie?: unknown;
  pagina?: unknown;
}

export async function leerAdm(ctx: CtxTurno, args: ArgsLeerAdm): Promise<ResultadoTool> {
  const modo = String(args.modo ?? '');
  const argsClave: Record<string, unknown> = {
    modo,
    tipo_doc: args.tipo_doc,
    uuid: args.uuid,
    docid: args.docid,
    rnc: args.rnc,
    serie: args.serie,
    pagina: args.pagina,
  };
  // En examen: del snapshot si está; si no, a la API real — es solo lectura.
  const snap = delExamen(ctx, 'leer_adm', argsClave);
  if (snap !== null) return snap;

  const cred = await credenciales(ctx);

  switch (modo) {
    case 'documento': {
      const tipo = String(args.tipo_doc ?? '');
      if (!TIPOS_DOC.has(tipo)) {
        return { error: `tipo_doc '${tipo}' fuera del catalogo: ${[...TIPOS_DOC].join(', ')}` };
      }
      const uuid = String(args.uuid ?? '').trim();
      const docid = String(args.docid ?? '').trim();
      if (uuid) {
        const doc = desenvolverObjeto(await admGet(cred, `${tipo}/${encodeURIComponent(uuid)}`));
        if (doc === null) {
          return {
            documento: null,
            nota: 'ADM devolvio data:null — con este uuid no hay documento vivo (asi responde tambien a un GUID inexistente)',
          };
        }
        return { documento: doc };
      }
      if (docid) {
        // Enmienda 4 del contrato: resolución por listado + filtro LOCAL —
        // el `?DocID=` de la API miente y sigue prohibido.
        const { filas, truncado } = await paginarAdm(
          cred,
          tipo,
          (lote) => lote.some((f) => campo(f, 'DocID') === docid),
        );
        const hallado = filas.find((f) => campo(f, 'DocID') === docid);
        if (!hallado) {
          return {
            documento: null,
            nota: `'${docid}' no aparece en el listado de ${tipo}` +
              (truncado ? ' (listado truncado en el tope de paginas)' : '') +
              ' — OJO: el listado no trae anulados; ausencia NO prueba que el documento murio',
          };
        }
        // El listado puede venir incompleto (Balance null, etc.): si trae ID,
        // se relee el detalle por UUID, que es la forma vigente del documento.
        const id = campo(hallado, 'ID');
        if (id) {
          const doc = desenvolverObjeto(await admGet(cred, `${tipo}/${encodeURIComponent(id)}`));
          if (doc) return { documento: doc, resuelto_por: 'listado + detalle por uuid' };
        }
        return { documento: hallado, resuelto_por: 'listado (sin detalle: la fila no trajo ID)' };
      }
      return { error: 'modo documento: falta uuid o docid' };
    }

    case 'listado': {
      const tipo = String(args.tipo_doc ?? '');
      if (!TIPOS_DOC.has(tipo)) {
        return { error: `tipo_doc '${tipo}' fuera del catalogo: ${[...TIPOS_DOC].join(', ')}` };
      }
      const pagina = Math.max(0, Math.trunc(Number(args.pagina ?? 0)) || 0);
      const lote = desenvolverLista(await admGet(cred, tipo, { skip: String(pagina * 50) }));
      return {
        tipo_doc: tipo,
        pagina,
        filas: lote.map(compactarFila),
        hay_mas: lote.length >= 50,
        nota: 'ADM pagina de a 50; el filtro es LOCAL (Reference/DocID como parametro mienten) y el listado NO trae anulados',
      };
    }

    case 'ap_saldo': {
      // /api/AP es LA UNICA fuente del saldo abierto (Balance viene null en el
      // listado y el detalle de VendorBills; lapida de registrar-pago-factura).
      const { filas, truncado } = await paginarAdm(cred, 'AP');
      const rnc = soloDigitos(args.rnc);
      const docid = String(args.docid ?? '').trim();
      let out = filas;
      if (docid) out = out.filter((f) => campo(f, 'DocID') === docid);
      else if (rnc) out = out.filter((f) => soloDigitos(campo(f, 'FiscalID')) === rnc);
      return {
        partidas: out.map(compactarFila),
        total_abiertas: filas.length,
        truncado,
        nota: 'AP lista SOLO las cuentas por pagar ABIERTAS: la factura que no aparece ya se pago',
      };
    }

    case 'vendor': {
      const rnc = soloDigitos(args.rnc);
      if (!rnc) return { error: 'modo vendor: falta rnc' };
      // El `search` de /api/Vendors no filtra (verificado 2026-08-02): se
      // pagina entero y el match es por FiscalID EXACTO, local.
      const { filas, truncado } = await paginarAdm(cred, 'Vendors');
      const matches = filas.filter((f) => soloDigitos(campo(f, 'FiscalID')) === rnc);
      if (matches.length === 0) {
        return {
          vendors: [],
          truncado,
          nota: `ningun vendor con FiscalID ${rnc}. OJO: hay proveedores sin FiscalID que se resuelven por nombre exacto — el alta es de la pieza que registra, no tuya`,
        };
      }
      return { vendors: matches.map(compactarFila), truncado };
    }

    case 'plan_cuentas': {
      // El plan VIVO por serie: el vecindario COMPLETO, nunca un keyword
      // suelto — adivinar un codigo esta prohibido (comun-asientos).
      const { filas, truncado } = await paginarAdm(cred, 'Accounts');
      // En /api/Accounts el campo del codigo es `Code`; AccountCode viene null.
      const plan = filas
        .map((f) => ({
          codigo: campo(f, 'Code') || campo(f, 'AccountCode'),
          nombre: campo(f, 'Name') || campo(f, 'Description'),
          id: campo(f, 'ID'),
        }))
        .filter((c) => c.codigo !== '');
      const serie = String(args.serie ?? '').trim().replace(/\.x$/i, '').replace(/\.$/, '');
      if (!serie) {
        return { cuentas: plan.map(({ codigo, nombre }) => ({ codigo, nombre })), truncado };
      }
      const vecindario = plan.filter(
        (c) => c.codigo === serie || c.codigo.startsWith(`${serie}.`),
      );
      return {
        serie,
        cuentas: vecindario,
        truncado,
        nota: vecindario.length === 0
          ? `la serie ${serie} no existe en el plan vivo — sin cuenta utilizable la salida es preguntar_al_humano citando el hecho, no inventar`
          : 'el plan manda sobre cualquier papel',
      };
    }

    default:
      return {
        error: `modo '${modo}' desconocido: documento | listado | ap_saldo | vendor | plan_cuentas`,
      };
  }
}
