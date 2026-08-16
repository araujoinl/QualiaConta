// qualia-preparador/dedup.ts — bloque 7 del fuente: duplicados (solo con NCF),
// más el GC del cache que en el server vivía antes de la descarga.
//
// El prep NUNCA marca error por duplicado (SPEC 8): reporta en el dossier y el
// que decide es el proponedor/turno con su regla existente. Nota deliberada
// heredada del fuente: el prep NO habla con la API de ADM Cloud — el listado
// de VendorBills viene con NCF:null y su `search` no filtra (verificado
// 2026-08-02), así que consultarla sería una verificación falsa. Los
// duplicados contra ADM se resuelven con el histórico espejado
// (vendor-bills*.jsonl / bank-charges*.jsonl, que SÍ traen NCF).

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

export const BUCKET_CACHE = 'qualia-espejos';
export const PREFIJO_CACHE = 'dossier-cache';
export const rutaCache = (trabajoId: string, archivo: string) =>
  `${PREFIJO_CACHE}/${trabajoId}/${archivo}`;

const RE_UUID = /^[0-9a-f-]{36}$/;
// El fuente iteraba TODO /tmp/mesa. Acá el listado se PAGINA (v2 del port: el
// tope fijo de 200 dejaba el dedup «no verificado» para siempre en cuanto el
// cache creciera) y solo la lectura de dossiers ajenos queda acotada.
const PAGINA_LISTADO = 1000;
const MAX_CARPETAS_TOTAL = 5000;
const MAX_DOSSIERS_LEIDOS = 60;
// Port del `find -mtime +35` del fuente: la carpeta de un trabajo CERRADO
// (su fila sigue viva, así que el barrido de huérfanas no la ve) se poda a los
// 35 días de su último cambio — para entonces su NCF ya vive en el espejo ADM.
const ESTADOS_CERRADOS = new Set(['aprobada', 'registrada', 'rechazada']);
const DIAS_PODA = 35;

async function listarCarpetasCache(
  db: SupabaseClient,
): Promise<{ carpetas: string[]; truncado: boolean } | null> {
  const nombres: string[] = [];
  for (let desde = 0; desde < MAX_CARPETAS_TOTAL; desde += PAGINA_LISTADO) {
    const { data, error } = await db.storage
      .from(BUCKET_CACHE)
      .list(PREFIJO_CACHE, { limit: PAGINA_LISTADO, offset: desde });
    if (error) return null;
    const lote = data ?? [];
    for (const f of lote) if (RE_UUID.test(f.name)) nombres.push(f.name);
    if (lote.length < PAGINA_LISTADO) return { carpetas: nombres, truncado: false };
  }
  return { carpetas: nombres, truncado: true };
}

/**
 * GC del cache, invocable SIN NCF (v2: en el fuente el GC corría en TODA
 * corrida, antes de la descarga; el port v1 lo tenía atrapado dentro del dedup
 * que solo corre con NCF). Barre carpetas huérfanas (fila borrada en la web) y
 * poda carpetas de trabajos cerrados con más de 35 días sin cambios. Devuelve
 * el mapa de vivos para que el dedup lo reuse sin segundo viaje.
 */
export async function gcCache(
  db: SupabaseClient,
  log: (m: string) => void,
  exceptoTrabajoId?: string,
): Promise<
  { carpetas: string[]; vivos: Map<string, { empresa: string; estado: string }>; truncado: boolean } | null
> {
  const listado = await listarCarpetasCache(db);
  if (listado === null) return null;
  const carpetas = listado.carpetas.filter((n) => n !== exceptoTrabajoId);

  const vivos = new Map<string, { empresa: string; estado: string }>();
  if (carpetas.length === 0) return { carpetas: [], vivos, truncado: listado.truncado };

  const { data: filas, error } = await db
    .from('qualia_trabajos')
    .select('id, empresa_id, estado, updated_at')
    .in('id', carpetas);
  if (error) return null;

  const corte = Date.now() - DIAS_PODA * 86_400_000;
  const podar: string[] = [];
  for (const f of filas ?? []) {
    const id = f.id as string;
    const estado = String(f.estado ?? '');
    if (ESTADOS_CERRADOS.has(estado) && Date.parse(String(f.updated_at ?? '')) < corte) {
      podar.push(id);
      continue; // cerrada y vieja: se poda, no entra a vivos ni al 7b
    }
    vivos.set(id, { empresa: f.empresa_id as string, estado });
  }
  const huerfanas = carpetas.filter((c) => !vivos.has(c) && !podar.includes(c));
  const aBorrar = [...huerfanas, ...podar];
  if (aBorrar.length > 0) {
    const rutas = aBorrar.flatMap((c) => [
      rutaCache(c, 'dossier.json'),
      rutaCache(c, 'texto.txt'),
      rutaCache(c, 'clasificacion.json'),
    ]);
    const { error: eRm } = await db.storage.from(BUCKET_CACHE).remove(rutas);
    if (!eRm) {
      for (const c of huerfanas) log(`GC: carpeta huerfana ${c} barrida (trabajo borrado en la web)`);
      for (const c of podar) log(`GC: carpeta ${c} podada (cerrada hace >${DIAS_PODA} dias)`);
    }
  }
  return { carpetas: carpetas.filter((c) => vivos.has(c)), vivos, truncado: listado.truncado };
}

export interface ResultadoDedup {
  mesa: Array<{ id: string; estado: string }>;
  adm: string[];
  verificado: boolean;
  motivo?: string;
}

interface CtxDedup {
  db: SupabaseClient;
  empresaId: string;
  trabajoId: string;
  ncf: string; // ya validado por el bloque 5
  anotar: (e: string) => void;
  log: (m: string) => void;
}

export async function buscarDuplicados(ctx: CtxDedup): Promise<ResultadoDedup> {
  const { db, empresaId, trabajoId, ncf, anotar, log } = ctx;
  const mesa: Array<{ id: string; estado: string }> = [];
  const adm: string[] = [];
  let verificado = true;
  const motivos: string[] = [];
  const agregarMotivo = (m: string) => {
    verificado = false;
    motivos.push(m);
  };

  // ── 7a. En la mesa: trabajos con ese NCF ya en su propuesta ───────────────
  const { data: enMesa, error: eMesa } = await db
    .from('qualia_trabajos')
    .select('id, estado')
    .eq('empresa_id', empresaId)
    .eq('propuesta->>ncf', ncf)
    .neq('id', trabajoId);
  if (eMesa) {
    agregarMotivo('mesa: consulta fallo');
    anotar('duplicados en la mesa: consulta fallo');
  } else {
    for (const f of enMesa ?? []) mesa.push({ id: f.id as string, estado: f.estado as string });
  }

  // ── GC + 7b. Dossiers de otros trabajos en el cache ───────────────────────
  //
  // El GC vive en gcCache() (v2: corre en TODA corrida desde index.ts, con o
  // sin NCF, como en el fuente — el fantasma del 2026-08-02, "2 duplicados en
  // mesa" que eran carpetas de trabajos borrados, motivó el barrido); acá se
  // reusa su mapa de vivos para el 7b. Query fallida = base caída = no tocar
  // nada, como el fuente.
  const gc = await gcCache(db, log, trabajoId);
  if (gc === null) {
    agregarMotivo('cache: listado fallo');
    anotar('duplicados en cache: listado fallo');
  } else {
    if (gc.truncado) agregarMotivo('cache: listado truncado');

    // 7b: cubre pendientes que aún no tienen propuesta pero cuyo prep ya
    // extrajo ese NCF (SPEC 8, el otro lado de guardar el NCF en el dossier).
    // El cache es compartido entre empresas — en el server /tmp/mesa era por
    // contenedor y este filtro era implícito.
    const propias = gc.carpetas
      .filter((c) => gc.vivos.get(c)?.empresa === empresaId)
      .slice(0, MAX_DOSSIERS_LEIDOS);
    for (const otro of propias) {
      const { data: blob, error: eDoss } = await db.storage
        .from(BUCKET_CACHE)
        .download(rutaCache(otro, 'dossier.json'));
      if (eDoss || !blob) continue; // sin dossier todavía: nada que comparar
      const crudo = await blob.text();
      if (crudo.includes(`"${ncf}"`)) mesa.push({ id: otro, estado: 'dossier' });
    }
  }

  // ── 7c. Contra ADM, por el HISTÓRICO espejado ─────────────────────────────
  //
  // `bank-charges*.jsonl` entra desde el 2026-08-14: un NCF no vive sólo en
  // una factura de proveedor (la nota de crédito del 2x1000 es un BankCharges
  // y mirando sólo vendor-bills el mismo papel se cargaba dos veces). El shape
  // es el mismo (`NCF` y `DocID` en la raíz), y por si el espejo viaja con
  // sobre {data: …} se mira también adentro.
  const prefijoEspejo = `espejo-adm/${empresaId}`;
  const { data: espejoLista, error: eEspejo } = await db.storage
    .from(BUCKET_CACHE)
    .list(prefijoEspejo, { limit: 100 });
  if (eEspejo) {
    agregarMotivo('historico ADM (espejos) ilegible');
    anotar('duplicados historico ADM: listado del espejo fallo');
  } else {
    const archivos = (espejoLista ?? [])
      .map((f) => f.name)
      .filter((n) => /^(vendor-bills|bank-charges)[^/]*\.jsonl$/.test(n));
    if (archivos.length === 0) {
      agregarMotivo('historico ADM (preentrenamiento) no montado');
    } else {
      for (const archivo of archivos) {
        const { data: blob, error: eArch } = await db.storage
          .from(BUCKET_CACHE)
          .download(`${prefijoEspejo}/${archivo}`);
        if (eArch || !blob) {
          agregarMotivo('historico ADM: lectura fallo');
          anotar(`duplicados historico ADM: no pude leer ${archivo}`);
          continue;
        }
        try {
          const texto = await blob.text();
          if (!texto.includes(`"${ncf}"`)) continue; // el grep -F del fuente
          for (const linea of texto.split('\n')) {
            if (!linea.includes(ncf)) continue;
            let obj: Record<string, unknown>;
            try {
              obj = JSON.parse(linea) as Record<string, unknown>;
            } catch {
              continue;
            }
            const candidatos = [obj, obj?.data as Record<string, unknown> | undefined];
            for (const d of candidatos) {
              if (!d || typeof d !== 'object') continue;
              if (String(d.NCF ?? '').trim().toUpperCase() !== ncf) continue;
              const doc = String(d.DocID ?? d.ID ?? '').trim();
              if (doc && !adm.includes(doc)) adm.push(doc);
            }
          }
        } catch {
          agregarMotivo('historico ADM: parseo fallo');
          anotar('duplicados historico ADM: parseo fallo');
        }
      }
    }
  }

  const out: ResultadoDedup = { mesa, adm, verificado };
  if (motivos.length > 0) out.motivo = motivos.join('; ');
  return out;
}
