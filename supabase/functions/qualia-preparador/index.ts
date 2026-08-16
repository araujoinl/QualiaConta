import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { sb, modo } from '../_shared/db.ts';
import { autorizado } from '../_shared/auth.ts';
import { registrarSombra } from '../_shared/sombra.ts';
import { Extraccion, conPlazo, fragNinguno, sha256hex, aBase64 } from './comun.ts';
import {
  extraccionXml,
  extraerCamposTexto,
  extraerTextoPdf,
  tipoDocumento,
} from './extraccion.ts';
import { extraccionVision } from './vision.ts';
import {
  PaginaRGBA,
  buscarTimbreEnQr,
  decodificarImagen,
  fusionarQr,
  paginaAPng,
  rasterizarPdf,
} from './qr.ts';
import { BUCKET_CACHE, buscarDuplicados, gcCache, rutaCache } from './dedup.ts';

/**
 * Edge Function: qualia-preparador
 *
 * Port de mesa/preparar-trabajo.sh (1.705 líneas; los números de bloque de los
 * comentarios de abajo son los del fuente). Pre-procesador determinista de la
 * mesa: por cada trabajo 'pendiente' con archivo, baja el documento del bucket
 * y deja un dossier masticado (texto extraído, campos, QR del e-CF,
 * verificación DGII, duplicados) para que el proponedor/turno no gaste turnos
 * en pasos mecánicos. Si el dossier no llega a armarse, el turno sigue su
 * protocolo completo: por eso acá TODO paso falla suave (queda en errores_prep)
 * salvo la descarga, que es el único caso fatal.
 *
 * Contrato duro (SPEC del fuente — no negociable):
 *   - NO reclama nada: el claim pendiente→analizando es del proponedor/turno.
 *   - NO cambia estado, salvo descarga imposible → estado='error' con guard
 *     `estado='pendiente'` — y eso SOLO en modo nube.
 *   - Deja UN evento de progreso (autor='contable') con resumen humano corto.
 *     Sin URLs, sin cuerpos de API.
 *   - Idempotente: dossier vigente del MISMO documento (sha256+versión) se
 *     reusa sin re-leer.
 *
 * Diferencias deliberadas con el server (anotadas, no accidentales):
 *   - El documento baja del bucket `qualia-conta` por archivo_path (la URL
 *     firmada queda de respaldo para filas viejas sin path).
 *   - El workdir /tmp/mesa se reemplaza por el cache del bucket
 *     `qualia-espejos` bajo dossier-cache/<trabajo_id>/ (dossier.json +
 *     texto.txt). Los paths del dossier son rutas de bucket, no de disco.
 *   - Un PDF sin capa de texto YA NO queda sin extracción: se rasteriza la
 *     página 1 (pdfium, el mismo raster del QR) y va a visión — en el server
 *     esa visión la hacía el agente en sesión (§4.4 del plan).
 *   - La visión sale por _shared/llm.ts (cadena z.AI→OpenRouter, freno de
 *     cuota, registro en qualia_llm_uso) — nunca fetch directo.
 *   - HEIC se convierte con el TRANSFORMADOR de Storage (no hay decodificador
 *     razonable en Deno); si esa vía falla, degrada a
 *     metodo='ninguno' con nota, que era el mismo degradado del fuente cuando
 *     la conversión fallaba.
 *
 * MODO (qualia_config, por empresa con default global):
 *   'server' → no toca NADA (ni el cache): el sidecar del server es el dueño.
 *   'sombra' → calcula todo; escribe SOLO qualia_sombra y su cache propio del
 *              bucket. Nada de qualia_trabajos/eventos — una URL vencida vista
 *              desde acá NO le roba la fila al poller (letra chica (a) de F2).
 *   'nube'   → escribe de verdad, con los MISMOS guards de estado del fuente.
 *
 * Responde 202 de inmediato y sigue con EdgeRuntime.waitUntil: el poke de
 * pg_net/barrido no espera (idle timeout de la plataforma) y el estado vive
 * SIEMPRE en el bus + cache, nunca en la memoria del worker.
 */

const FUNCION = 'qualia-preparador';

// Versión del dossier = versión de la lógica de extracción. Un dossier de otra
// versión se considera vencido y se re-prepara aunque el documento sea el
// mismo. Se mantiene la numeración del fuente (v3: renglones del XML e-CF con
// aritmética verificada) para que el diff de sombra compare versiones iguales.
const PREP_VERSION = 3;

const BUCKET_DOCS = 'qualia-conta';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Presupuesto de reloj del prep entero (el poller envolvía el fuente en
// `timeout 180`; acá el tope real es el wall clock de 400s de la plataforma).
// Pasado esto, las consultas externas que falten se saltean con motivo — mejor
// dossier parcial que morir sin dossier (lección del caso 8457baa4).
const PLAZO_PREP_MS = 340_000;

const MAX_BYTES_VISION = 10_000_000; // mismo tope de 10 MB del fuente

type ModoActivo = 'sombra' | 'nube';

interface Fila {
  empresa_id: string;
  estado: string;
  updated_at: string;
  archivo_nombre: string | null;
  archivo_path: string | null;
  archivo_url: string | null;
}

interface Ctx {
  db: ReturnType<typeof sb>;
  id: string;
  empresaId: string;
  m: ModoActivo;
  fila: Fila;
  motivo: string;
  backtest: boolean;
  t0: number;
  errores: string[];
  suprimidas: string[];
  log: (msg: string) => void;
  anotar: (e: string) => void;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────── helpers de cache ────────────────────────────────

interface DossierPrevio {
  version: number;
  sha: string;
  rowUpd: string;
  preparadoEn: string;
  dossier: Record<string, unknown>;
}

async function leerDossierPrevio(ctx: Ctx): Promise<DossierPrevio | null> {
  const { data } = await ctx.db.storage
    .from(BUCKET_CACHE)
    .download(rutaCache(ctx.id, 'dossier.json'));
  if (!data) return null;
  try {
    const d = JSON.parse(await data.text()) as Record<string, unknown>;
    if (typeof d !== 'object' || d === null) return null;
    const archivo = (d.archivo ?? {}) as Record<string, unknown>;
    return {
      version: Number(d.version ?? 0),
      sha: String(archivo.sha256 ?? ''),
      rowUpd: String(d.row_updated_at ?? ''),
      preparadoEn: String(d.preparado_en ?? ''),
      dossier: d,
    };
  } catch {
    return null;
  }
}

async function subirCache(
  ctx: Ctx,
  archivo: string,
  contenido: string,
  contentType: string,
): Promise<boolean> {
  const { error } = await ctx.db.storage
    .from(BUCKET_CACHE)
    .upload(rutaCache(ctx.id, archivo), contenido, {
      contentType,
      upsert: true,
      cacheControl: '0', // el dossier se reescribe y se lee en el mismo segundo
    });
  if (error) {
    ctx.log(`no pude subir ${archivo} al cache: ${error.message}`);
    return false;
  }
  return true;
}

// ─────────────────────────── eventos y estado ────────────────────────────────

async function insertarEvento(ctx: Ctx, tipo: string, contenido: string): Promise<void> {
  if (ctx.m === 'sombra') {
    // En sombra el evento NO se escribe: queda en el payload de la sombra para
    // diffear contra el que dejó el server.
    ctx.suprimidas.push(`evento_${tipo}`);
    return;
  }
  const { error } = await ctx.db.from('qualia_eventos').insert({
    trabajo_id: ctx.id,
    autor: 'contable',
    tipo,
    contenido,
  });
  if (error) ctx.log(`no pude insertar el evento de ${tipo}: ${error.message}`);
}

/**
 * ÚNICO caso en que el prep toca el estado (bloque 2 del fuente). El guard
 * `estado='pendiente'` respeta el claim: si alguien tomó el trabajo entre
 * medio, acá no se escribe nada. En sombra NO SE HACE: se registra en la
 * sombra — una URL vencida vista desde la nube le robaría la fila al poller.
 */
async function marcarErrorDescarga(ctx: Ctx, det: string): Promise<void> {
  if (ctx.m === 'sombra') {
    ctx.log(`descarga imposible; en sombra no toco estado (${det.slice(0, 80)})`);
    await registrarSombra(FUNCION, ctx.empresaId, ctx.id, {
      fase: 'descarga',
      accion_suprimida: 'marcar_error',
      detalle: det,
      motivo_poke: ctx.motivo || null,
    });
    return;
  }
  const { data: marcado, error } = await ctx.db
    .from('qualia_trabajos')
    .update({ estado: 'error', error_detalle: det })
    .eq('id', ctx.id)
    .eq('empresa_id', ctx.empresaId)
    .eq('estado', 'pendiente')
    .select('id');
  if (error) {
    ctx.log(`no pude marcar el error de descarga: ${error.message}`);
    return;
  }
  if (marcado && marcado.length > 0) {
    await insertarEvento(ctx, 'nota', det);
    ctx.log('descarga imposible: trabajo marcado en error');
  } else {
    ctx.log('descarga imposible, pero el trabajo ya no esta pendiente; no toco nada');
  }
}

// ─────────────────────────── descarga (bloque 2) ─────────────────────────────

type Descarga =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; fatal: boolean; detalle: string };

async function descargarDocumento(ctx: Ctx): Promise<Descarga> {
  const { archivo_path, archivo_url } = ctx.fila;
  if (archivo_path) {
    const { data, error } = await ctx.db.storage.from(BUCKET_DOCS).download(archivo_path);
    if (error || !data) {
      const err = (error ?? {}) as { message?: string; status?: number; statusCode?: number | string };
      const st = err.status ?? Number(err.statusCode ?? NaN);
      const noExiste = st === 400 || st === 404 || /not.?found/i.test(err.message ?? '');
      if (noExiste) {
        return {
          ok: false,
          fatal: true,
          detalle:
            'No se pudo descargar el documento del bucket (el objeto no está en Storage). ' +
            'Si se borró, re-subir el archivo desde la web crea el trabajo de nuevo.',
        };
      }
      // Storage con hipo: transitorio — el re-aviso del barrido reintenta.
      return { ok: false, fatal: false, detalle: err.message ?? 'descarga fallo' };
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (bytes.length < 100) {
      return {
        ok: false,
        fatal: true,
        detalle: `No se pudo descargar el documento (0 útiles, ${bytes.length} bytes en el bucket).`,
      };
    }
    return { ok: true, bytes };
  }

  // Filas viejas sin archivo_path: el mismo camino del fuente, por la URL
  // firmada. La URL solo vive en esta variable — jamás en logs ni dossier.
  let r: Response;
  try {
    r = await fetch(archivo_url as string, { signal: AbortSignal.timeout(75_000) });
  } catch {
    // curl matado o red caída: transitorio — NO se marca error.
    return { ok: false, fatal: false, detalle: 'descarga cortada (red)' };
  }
  const cuerpo = new Uint8Array(await r.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (r.status !== 200 || cuerpo.length < 100) {
    return {
      ok: false,
      fatal: true,
      detalle:
        `No se pudo descargar el documento (HTTP ${r.status}, ${cuerpo.length} bytes). ` +
        'La URL firmada dura 30 días; si venció, abrir «Ver original» en la web la regenera.',
    };
  }
  return { ok: true, bytes: cuerpo };
}

// ─────────────────────────── config por empresa ──────────────────────────────

/** RNC comprador de la empresa (el QUALIA_EMPRESA_RNC del .env del server). */
async function rncEmpresa(ctx: Ctx): Promise<string> {
  const { data, error } = await ctx.db
    .from('qualia_config')
    .select('valor')
    .eq('clave', 'empresa_rnc')
    .eq('empresa_id', ctx.empresaId)
    .limit(1);
  if (error || !data || data.length === 0) return '';
  const v = data[0].valor;
  const rnc = typeof v === 'string' ? v : String((v as { rnc?: unknown } | null)?.rnc ?? '');
  return /^\d{9}$|^\d{11}$/.test(rnc) ? rnc : '';
}

/**
 * HEIC → JPEG por el transformador de imágenes de Storage (`render/image`).
 * Es la única vía que entra en los límites del worker: la conversión ocurre
 * del lado de Storage y acá solo llega el JPEG ya hecho. `width` acota el
 * tamaño para no pasarse del tope de visión.
 */
async function heicAJpeg(ctx: Ctx): Promise<Uint8Array | null> {
  const path = ctx.fila.archivo_path;
  if (!path) return null;
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!base || !key) return null;
  const url = `${base}/storage/v1/render/image/authenticated/${BUCKET_DOCS}/${
    path.split('/').map(encodeURIComponent).join('/')
  }?width=1800&quality=82`;
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      ctx.log(`transformador de Storage: HTTP ${r.status}`);
      await r.body?.cancel();
      return null;
    }
    const buf = new Uint8Array(await r.arrayBuffer());
    // Sello JPEG: si el transformador devolvió otra cosa, mejor degradar.
    if (buf.length < 1000 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    ctx.log(`HEIC convertido por Storage (${Math.floor(buf.length / 1024)} KB)`);
    return buf;
  } catch (e) {
    ctx.log(`transformador de Storage fallo: ${e instanceof Error ? e.name : 'error'}`);
    return null;
  }
}

// ─────────────────────────── poke al proponedor ──────────────────────────────

/**
 * En el server, tras el prep el poke al webhook lo daba el poller. Acá no hay
 * poller: el preparador avisa al proponedor con el mismo contrato de body.
 * Fallar es suave: la fila sigue 'pendiente' y el re-poke del barrido rearma
 * la cadena — esa ES la red.
 */
async function pokeProponedor(ctx: Ctx, dossierEn?: string): Promise<void> {
  const base = Deno.env.get('QUALIA_FUNCTIONS_URL') ??
    `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1`;
  let bearer = Deno.env.get('QUALIA_CRON_BEARER') ?? '';
  if (!bearer) {
    const { data } = await ctx.db
      .from('qualia_config')
      .select('valor')
      .is('empresa_id', null)
      .eq('clave', 'cron_bearer')
      .single();
    const b = (data?.valor as { bearer?: string } | null)?.bearer;
    bearer = typeof b === 'string' ? b : '';
  }
  if (!base || !bearer) {
    ctx.log('sin URL o bearer para el poke al proponedor; lo recoge el barrido');
    return;
  }
  try {
    const r = await fetch(`${base}/qualia-proponedor`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trabajo_id: ctx.id,
        motivo: 'dossier_listo',
        intento: String(Math.floor(Date.now() / 1000)),
        // Sello de frescura: Storage NO garantiza que lo recién subido se lea
        // al instante (medido 2026-08-16: el proponedor leyó la copia anterior
        // 1s después de subir). El proponedor reintenta hasta ver ESTE sello.
        dossier_en: dossierEn ?? null,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    await r.body?.cancel();
    if (!r.ok) ctx.log(`poke al proponedor: HTTP ${r.status}`);
  } catch (e) {
    ctx.log(`poke al proponedor fallo: ${e instanceof Error ? e.name : 'error'}`);
  }
}

// ─────────────────────────── el prep completo ────────────────────────────────

async function preparar(ctx: Ctx): Promise<void> {
  const { db, id, empresaId, m, fila, anotar, log, t0 } = ctx;
  const quedaReloj = () => Date.now() - t0 < PLAZO_PREP_MS;

  // ── Idempotencia (bloque 2 del fuente). La copia vale mientras el DOCUMENTO
  // sea el mismo, no mientras la fila no se toque: responder un mensaje reabre
  // el trabajo a 'pendiente' y con la clave vieja (updated_at) CADA pregunta
  // del humano tiraba el dossier y repetía visión + DGII (bug de SUENA
  // ELECTRONICA). Acá el atajo barato por updated_at; el de verdad, por sha.
  const previo = await leerDossierPrevio(ctx);

  // El humano puede decir «leíste mal el documento» desde la web: ese chip —y
  // sólo ése— marca su mensaje con datos.forzar_relectura y bota la copia. Se
  // mira si el pedido es POSTERIOR a la preparación: uno viejo ya se atendió.
  let forzar = ctx.backtest; // el backtest siempre re-lee: mide el camino entero
  if (!forzar && previo?.preparadoEn) {
    const { data: pedido } = await db
      .from('qualia_eventos')
      .select('id')
      .eq('trabajo_id', id)
      .eq('autor', 'usuario')
      .eq('datos->>forzar_relectura', 'true')
      .gt('created_at', previo.preparadoEn)
      .limit(1);
    if (pedido && pedido.length > 0) {
      forzar = true;
      log('el humano pidio releer el documento; la copia anterior no se usa');
    }
  }

  if (!forzar && previo && previo.version === PREP_VERSION &&
    previo.rowUpd && previo.rowUpd === fila.updated_at) {
    log('dossier vigente (la fila no cambio); nada que hacer');
    await pokeProponedor(ctx);
    return;
  }

  // ── Descarga (único paso fatal) ──────────────────────────────────────────
  const descarga = await descargarDocumento(ctx);
  if (!descarga.ok) {
    if (descarga.fatal) {
      await marcarErrorDescarga(ctx, descarga.detalle);
    } else {
      log(`descarga cortada (${descarga.detalle.slice(0, 80)}); fallo suave, sin tocar estado`);
    }
    return;
  }
  const bytes = descarga.bytes;
  log(`descargado (${Math.floor(bytes.length / 1024)} KB)`);

  // ── ¿Mismo documento? Entonces el dossier de antes sirve (bloque 2b) ─────
  // El sha se calcula sobre el archivo, no sobre la URL firmada, que se
  // regenera sola sin que el documento cambie. Lo que NO se refresca al
  // reusar: el dedup — aceptable, ADM frena los duplicados por claves propias.
  const sha = await sha256hex(bytes);
  if (!forzar && previo && previo.version === PREP_VERSION && previo.sha === sha) {
    // Sella el updated_at nuevo para que la próxima corte en el atajo barato.
    previo.dossier.row_updated_at = fila.updated_at;
    await subirCache(ctx, 'dossier.json', JSON.stringify(previo.dossier, null, 2), 'application/json');
    log(`mismo documento (sha ${sha.slice(0, 12)}); reuso el dossier, no re-leo`);
    await pokeProponedor(ctx);
    return;
  }

  // ── Tipo de documento (bloque 3) ─────────────────────────────────────────
  // Nombre saneado: basename + lista blanca de caracteres — es lo único del
  // documento que viaja a rutas y al dossier antes de validarse.
  let base = (fila.archivo_nombre ?? 'documento').split('/').pop()!.split('\\').pop()!;
  base = base.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^\./, '');
  if (!base) base = 'documento';
  if (base === 'dossier.json' || base === 'texto.txt') base = `doc-${base}`;
  if (base.length > 140) base = base.slice(-140); // cola: conserva la extensión
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : '';

  const { tipo, esHeic } = tipoDocumento(ext, bytes);
  if (tipo === 'desconocido') {
    anotar(`extension '.${ext}' fuera de la lista blanca; sin extraccion`);
  }

  // ── Extracción por tipo (bloque 4) ───────────────────────────────────────
  let extr: Extraccion;
  let texto: string | null = null;
  let paginas: PaginaRGBA[] = [];

  const visionSobre = async (dataUrl: string, extras: Extraccion): Promise<Extraccion> => {
    const r = await extraccionVision(empresaId, dataUrl, extras);
    if ('extr' in r) return r.extr;
    // El motivo nunca puede salir vacío: un «aviso: vision:» pelado no le dice
    // nada a quien audita después (pasó el 2026-08-10 en el server).
    anotar(`vision: ${r.fallo || 'sin motivo'}`);
    return fragNinguno('vision fallo en el prep; el agente aplica vision');
  };

  switch (tipo) {
    case 'xml': {
      try {
        const r = extraccionXml(bytes);
        extr = r.extr;
        texto = r.texto;
      } catch (e) {
        anotar(`parseo XML fallo: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`);
        extr = fragNinguno('XML no parseable; el agente sigue el protocolo completo');
      }
      break;
    }
    case 'pdf': {
      // El QR exige rasterizar TODO PDF, también los que traen capa de texto
      // (§4.4 del plan): el raster se hace una vez y sirve para QR y visión.
      try {
        paginas = await conPlazo(rasterizarPdf(bytes), 120_000, 'raster del PDF');
      } catch (e) {
        anotar(`raster del PDF fallo: ${e instanceof Error ? e.name : 'error'}`);
      }
      try {
        texto = await conPlazo(extraerTextoPdf(bytes), 60_000, 'texto del PDF');
      } catch {
        anotar('no pude extraer texto del PDF (unpdf)');
        texto = null;
      }
      if (texto && /\S/.test(texto)) {
        try {
          extr = extraerCamposTexto(texto, 'unpdf');
        } catch {
          anotar('extraccion de campos del texto fallo');
          extr = fragNinguno('sin extraccion automatica; el agente sigue el protocolo completo');
        }
      } else {
        // PDF sin capa de texto: en el server esto quedaba metodo='ninguno' y
        // la visión la hacía el agente; acá el raster ya está en la mano y la
        // visión es del prep (decisión F2, §4.4).
        texto = null;
        if (paginas.length === 0) {
          extr = fragNinguno('PDF sin capa de texto y sin raster; el agente decide si aplica vision');
        } else {
          await insertarEvento(ctx, 'progreso', '⚙️ Preparador: leyendo el documento escaneado…');
          const png = await paginaAPng(paginas[0]);
          if (png.length > MAX_BYTES_VISION) {
            anotar('raster mayor a 10 MB; sin vision en el prep');
            extr = fragNinguno('imagen muy grande para el prep; el agente aplica vision');
          } else {
            extr = await visionSobre(
              `data:image/png;base64,${aBase64(png)}`,
              { rasterizado_de_pdf: true },
            );
          }
        }
      }
      break;
    }
    case 'imagen': {
      if (esHeic) {
        // HEIC (fotos de iPhone, 1 de cada 3 documentos): ni el decodificador
        // WASM entra en el límite de cómputo ni z.AI acepta el formato crudo
        // (medido 2026-08-16: WORKER_RESOURCE_LIMIT y error 1210). Lo resuelve
        // el TRANSFORMADOR de Storage, que sirve el mismo objeto ya convertido
        // a JPEG — misma nube, sin pasar por el navegador ni por el server.
        const jpeg = await heicAJpeg(ctx);
        if (!jpeg) {
          anotar('HEIC: la conversion del transformador de Storage fallo; sin vision en el prep');
          extr = fragNinguno('HEIC sin convertir; el turno decide con el documento a la vista');
          break;
        }
        await insertarEvento(ctx, 'progreso', '⚙️ Preparador: leyendo la foto…');
        extr = await visionSobre(`data:image/jpeg;base64,${aBase64(jpeg)}`, { convertido_de_heic: true });
        break;
      }
      if (bytes.length > MAX_BYTES_VISION) {
        anotar('imagen mayor a 10 MB; sin vision en el prep');
        extr = fragNinguno('imagen muy grande para el prep; el agente aplica vision');
        break;
      }
      // Las fotos son el único camino lento del prep (~20-30s): se avisa al
      // hilo que ya se está leyendo, para que la espera no parezca cola muerta.
      await insertarEvento(ctx, 'progreso', '⚙️ Preparador: leyendo la foto…');
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      extr = await visionSobre(`data:${mime};base64,${aBase64(bytes)}`, {});
      try {
        // El decodificador se elige por CONTENIDO, no por el nombre: la misma
        // trampa del HEIC renombrado aplica a un png que se llama .jpg.
        const extDecode = bytes[0] === 0xff && bytes[1] === 0xd8
          ? 'jpg'
          : bytes[0] === 0x89
          ? 'png'
          : ext === 'jpeg'
          ? 'jpg'
          : ext;
        const pagina = await decodificarImagen(bytes, extDecode);
        if (pagina) paginas = [pagina];
        else anotar(`QR: sin decodificador para ${extDecode || 'ese formato'} en la nube`);
      } catch {
        anotar('lectura del QR fallo o excedio el tiempo');
      }
      break;
    }
    case 'excel':
      extr = fragNinguno('Excel: la nomina u hoja la razona el agente (sin extraccion en el prep)');
      break;
    default:
      extr = fragNinguno('tipo desconocido; el agente sigue el protocolo completo');
  }

  // ── 4b. El QR del e-CF manda sobre lo que diga el texto ──────────────────
  if ((tipo === 'pdf' || tipo === 'imagen') && paginas.length > 0) {
    try {
      const qr = await conPlazo(buscarTimbreEnQr(paginas), 60_000, 'lectura del QR');
      if (qr.encontrado && qr.campos) {
        fusionarQr(extr, qr.campos);
        log('timbre e-CF tomado del QR (pisa lo leido del texto)');
      }
      // Que no haya QR legible NO es un problema del documento: las facturas
      // impresas (B01) no llevan, y una foto torcida puede no darlo.
    } catch {
      anotar('lectura del QR fallo o excedio el tiempo');
    }
  }
  paginas = []; // los bitmaps no hacen falta más: que el GC recupere los MB

  // ── 5. Campos extraídos, re-validados antes de usarse ────────────────────
  // TODO valor que salió del documento es input hostil (SPEC seguridad): solo
  // entra a URLs o queries si pasa su regex acá.
  const campo = (clave: string): unknown => extr[clave];
  const texted = (clave: string): string => {
    const v = campo(clave);
    return v === null || v === undefined ? '' : String(v);
  };

  let NCF = texted('ncf');
  if (!/^(B\d{10}|E\d{12})$/.test(NCF)) NCF = '';
  let RNC = texted('rnc');
  if (!/^(\d{9}|\d{11})$/.test(RNC)) RNC = '';

  // Número propio del suplidor (el `Reference` de ADM, no el NCF). Formato
  // libre entre proveedores: solo se acota largo y juego de caracteres.
  let NUM_SUPLIDOR = texted('numero_factura_suplidor');
  if (!/^[A-Za-z0-9][A-Za-z0-9./-]{1,39}$/.test(NUM_SUPLIDOR)) NUM_SUPLIDOR = '';
  if (!NUM_SUPLIDOR && texto) {
    // Si la visión no lo sacó pero hay texto (los e-CF en PDF se leen por
    // texto), se busca impreso: "Factura No.: FTGAZ-025375" y sus variantes.
    const m = texto.match(
      /(factura|invoice|documento|pedido)\s*(no\.?|num(ero)?\.?|#)?\s*:?\s*[A-Za-z0-9][A-Za-z0-9./-]{2,39}/i,
    );
    if (m) {
      const cola = m[0].match(/[A-Za-z0-9][A-Za-z0-9./-]{2,39}$/);
      NUM_SUPLIDOR = cola ? cola[0] : '';
      if (!/^[A-Za-z0-9][A-Za-z0-9./-]{1,39}$/.test(NUM_SUPLIDOR)) NUM_SUPLIDOR = '';
      // El NCF no es el número del suplidor: si el regex agarró el NCF, fuera.
      if (NUM_SUPLIDOR === NCF) NUM_SUPLIDOR = '';
    }
  }

  const NCF_CRUDO = texted('ncf');
  let NCF_RESCATADO = '';
  let dgiiRescate: Record<string, unknown> | null = null;
  if (!NCF && RNC && /^B\d{11}$/.test(NCF_CRUDO) && quedaReloj()) {
    const { rescatarNcf } = await import('./dgii.ts');
    const rescate = await rescatarNcf(NCF_CRUDO, RNC);
    if (rescate) {
      NCF = rescate.ncf;
      NCF_RESCATADO = rescate.ncf;
      dgiiRescate = rescate.respuesta;
      log(`NCF rescatado: lei ${NCF_CRUDO} (formato invalido) -> ${NCF} VIGENTE en DGII`);
    }
  }

  let FECHA = texted('fecha');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(FECHA)) FECHA = '';
  const montoCrudo = campo('monto');
  const MONTO_FMT = typeof montoCrudo === 'number' && Number.isFinite(montoCrudo) && montoCrudo >= 0
    ? montoCrudo.toFixed(2)
    : '';
  let CODIGO = texted('codigo_seguridad');
  if (!/^[A-Za-z0-9+/=]{6}$/.test(CODIGO)) CODIGO = '';
  let FFIRMA = texted('fecha_firma');
  if (!/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/.test(FFIRMA)) FFIRMA = '';
  let RNCC = texted('rnc_comprador');
  if (!/^(\d{9}|\d{11})$/.test(RNCC)) RNCC = '';
  if (!RNCC) RNCC = await rncEmpresa(ctx);

  // ── 6. Verificación DGII ─────────────────────────────────────────────────
  const noVerificable = (motivo: string): Record<string, unknown> => ({
    estado: 'no verificable',
    motivo,
  });

  let dgii: Record<string, unknown>;
  if (!NCF) {
    // Distinguir "no había NCF" de "lo leí mal" evita que el turno concluya
    // que el documento no lo trae y vuelva a la imagen con visión.
    dgii = NCF_CRUDO
      ? noVerificable(
        `se leyó un NCF con formato inválido (${NCF_CRUDO.length} posiciones; el impreso lleva 11 y el e-CF 13): confirmá el número contra el documento antes de descartarlo`,
      )
      : noVerificable('sin NCF extraído');
  } else if (NCF.startsWith('B')) {
    if (NCF_RESCATADO && NCF === NCF_RESCATADO && dgiiRescate) {
      // Ya la contestó DGII durante el rescate, y con VIGENTE: no se repite.
      dgii = dgiiRescate;
      log('DGII: reuso la respuesta VIGENTE del rescate (no repito la consulta)');
    } else if (!RNC) {
      dgii = noVerificable('NCF impreso sin RNC emisor extraído; verificar manualmente');
    } else if (!quedaReloj()) {
      anotar('sin reloj para la consulta DGII del NCF impreso');
      dgii = noVerificable('el prep se quedo sin tiempo para la consulta a DGII');
    } else {
      try {
        const { consultaNcfImpreso } = await import('./dgii.ts');
        dgii = await conPlazo(consultaNcfImpreso(RNC, NCF), 45_000, 'consulta DGII');
      } catch {
        anotar('consulta DGII del NCF impreso fallo o excedio el tiempo');
        dgii = noVerificable('la consulta a DGII fallo o excedio el tiempo');
      }
    }
  } else {
    // e-CF: SOLO si del documento salieron código de seguridad y fecha de
    // firma (SPEC 7); además el timbre exige RNCs, fecha y monto exactos.
    if (!CODIGO || !FFIRMA) {
      dgii = noVerificable('faltan codigo/fecha firma; verificar timbre manualmente');
    } else if (!RNC || !RNCC || !FECHA || !MONTO_FMT) {
      dgii = noVerificable(
        'faltan datos para armar la consulta del timbre (RNC emisor/comprador, fecha o monto); verificar manualmente',
      );
    } else if (!quedaReloj()) {
      anotar('sin reloj para la consulta del timbre e-CF');
      dgii = noVerificable('el prep se quedo sin tiempo para la consulta del timbre');
    } else {
      try {
        const { consultaTimbreEcf } = await import('./dgii.ts');
        dgii = await conPlazo(
          consultaTimbreEcf({
            rncEmisor: RNC,
            rncComprador: RNCC,
            encf: NCF,
            fechaEmisionIso: FECHA,
            monto: MONTO_FMT,
            fechaFirma: FFIRMA,
            codigo: CODIGO,
          }),
          40_000,
          'timbre e-CF',
        );
      } catch {
        anotar('consulta del timbre e-CF fallo o excedio el tiempo');
        dgii = noVerificable('la consulta del timbre fallo o excedio el tiempo');
      }
    }
  }

  // ── 6b. Padrón de RNC: de quién es el RNC del emisor ─────────────────────
  // Pregunta distinta a la del bloque 6 (¿el comprobante vale?) y por eso vive
  // en su propia clave del dossier. Corre SIEMPRE que haya RNC: el contraste
  // "razón social de DGII contra el proveedor que leí" lo necesita, y es el
  // fallback que rescata al e-CF sin código de seguridad legible.
  let padron: Record<string, unknown> | null = null;
  if (RNC) {
    if (!quedaReloj()) {
      anotar('sin reloj para la consulta del padron de RNC');
      padron = noVerificable('el prep se quedo sin tiempo para el padron de RNC');
    } else {
      try {
        const { consultaPadronRnc } = await import('./dgii.ts');
        padron = await conPlazo(consultaPadronRnc(RNC), 45_000, 'padron RNC');
      } catch {
        anotar('consulta del padron de RNC fallo o excedio el tiempo');
        padron = noVerificable('la consulta al padron de RNC fallo o excedio el tiempo');
      }
    }
  }

  // ── 7. Duplicados (solo con NCF); el GC del cache corre SIEMPRE ──────────
  // (v2: en el fuente el GC era de toda corrida — sin esto, las carpetas
  // huérfanas solo se barrían cuando el documento traía NCF.)
  let dup: { mesa: Array<{ id: string; estado: string }>; adm: string[]; verificado: boolean; motivo?: string };
  if (NCF) {
    dup = await buscarDuplicados({ db, empresaId, trabajoId: id, ncf: NCF, anotar, log });
  } else {
    await gcCache(db, log, id);
    dup = {
      mesa: [],
      adm: [],
      verificado: false,
      motivo: NCF_CRUDO
        ? 'NCF leído con formato inválido: no se pudo buscar duplicados'
        : 'sin NCF extraído',
    };
  }

  // ── 9. Dossier (atómico en el cache) + evento de progreso ────────────────
  if (NUM_SUPLIDOR) extr.numero_factura_suplidor = NUM_SUPLIDOR;
  if (texto) {
    const subido = await subirCache(ctx, 'texto.txt', texto, 'text/plain; charset=utf-8');
    if (subido) extr.texto_path = `${BUCKET_CACHE}/${rutaCache(id, 'texto.txt')}`;
  } else {
    // El texto de una corrida anterior no debe contaminar esta re-lectura.
    await db.storage.from(BUCKET_CACHE).remove([rutaCache(id, 'texto.txt')]);
  }

  const preparadoEn = new Date().toISOString();
  const dossier: Record<string, unknown> = {
    version: PREP_VERSION,
    trabajo_id: id,
    row_updated_at: fila.updated_at,
    preparado_en: preparadoEn,
    archivo: {
      bucket: BUCKET_DOCS,
      path: fila.archivo_path ?? '',
      nombre: base,
      bytes: bytes.length,
      sha256: sha,
      tipo,
      convertido_de_heic: esHeic && extr.metodo !== 'ninguno',
    },
    extraccion: extr,
    dgii,
  };
  if (padron && 'estado' in padron) dossier.rnc_emisor = padron;
  if (NCF_CRUDO && !NCF) {
    // Se leyó algo pero no pasó el formato y tampoco se pudo rescatar: el
    // turno tiene que saber que el número EXISTE en el documento — le queda
    // corregirlo desde el texto, no re-descubrirlo con visión.
    dossier.ncf_invalido = {
      leido: NCF_CRUDO.slice(0, 20),
      posiciones: NCF_CRUDO.length,
      esperado: '11 el impreso (B + 10 dígitos), 13 el e-CF (E + 12)',
    };
  }
  if (NCF_RESCATADO) {
    dossier.ncf_rescatado = {
      leido_por_vision: NCF_CRUDO,
      corregido: NCF_RESCATADO,
      como: 'un digito de mas; se probaron los borrados de un digito y DGII confirmo este como VIGENTE',
    };
  }
  dossier.duplicados = dup;
  dossier.errores_prep = ctx.errores;
  dossier.duracion_seg = Math.floor((Date.now() - t0) / 1000);

  const dossierJson = JSON.stringify(dossier, null, 2);
  const dossierSubido = await subirCache(ctx, 'dossier.json', dossierJson, 'application/json');
  if (dossierSubido) log('dossier listo');
  else log('no pude subir el dossier; el contable seguira el protocolo completo');

  // Resumen humano para el evento de progreso (SPEC 4). Solo campos ya
  // re-validados: nada de URLs ni crudos sin filtro (hallazgo de auditoría).
  const quien = extr.proveedor ? String(extr.proveedor).slice(0, 120) : `archivo ${tipo}`;
  const partes: string[] = [quien];
  if (NCF) partes.push(`${NCF.startsWith('E') ? 'e-NCF' : 'NCF'} ${NCF}`);
  if (MONTO_FMT) {
    const simbolo = extr.moneda === 'USD' ? 'US$' : 'RD$';
    partes.push(
      `${simbolo}${Number(MONTO_FMT).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    );
  }
  if (NCF_RESCATADO) partes.push(`NCF corregido (la foto se leia ${NCF_CRUDO.slice(0, 20)})`);
  else if (dossier.ncf_invalido) partes.push(`NCF ilegible (lei ${NCF_CRUDO.slice(0, 20)})`);
  partes.push(`DGII: ${String(dgii.estado ?? 'no verificable')}`);
  // Si el comprobante no se pudo verificar pero el padrón sí dio el nombre,
  // decilo: es la diferencia entre "no sé nada" y "sé de quién es la factura".
  const razonPadron = padron?.razon_social;
  if (razonPadron && !['Aceptado', 'VIGENTE'].includes(String(dgii.estado))) {
    partes.push(`padrón RNC: ${String(razonPadron).slice(0, 120)}`);
  }
  const nDup = dup.mesa.length + dup.adm.length;
  if (nDup > 0) partes.push(`posible duplicado (mesa: ${dup.mesa.length}, ADM: ${dup.adm.length})`);
  else if (dup.verificado) partes.push('sin duplicados');
  else partes.push('duplicados no verificados');
  let evento = `⚙️ Preparador: documento listo. ${partes.join(', ')}.`;
  if (ctx.errores.length > 0) evento += ` Prep parcial (${ctx.errores.length} paso(s) fallaron).`;
  evento += ' Analizando…';

  if (dossierSubido) await insertarEvento(ctx, 'progreso', evento);

  await pokeProponedor(ctx, preparadoEn);

  // ── Sombra: el producto de esta fase es la fila del diff ─────────────────
  if (m === 'sombra') {
    const arit = extr.aritmetica as Record<string, unknown> | undefined;
    await registrarSombra(FUNCION, empresaId, id, {
      fase: 'dossier',
      motivo_poke: ctx.motivo || null,
      dossier_sha256: await sha256hex(new TextEncoder().encode(dossierJson)),
      version: PREP_VERSION,
      archivo: { sha256: sha, tipo, bytes: bytes.length },
      campos: {
        metodo: extr.metodo ?? null,
        confianza: extr.confianza ?? null,
        ncf: NCF || null,
        ncf_crudo: NCF !== NCF_CRUDO ? NCF_CRUDO || null : null,
        rnc: RNC || null,
        monto: MONTO_FMT || null,
        fecha: FECHA || null,
        moneda: extr.moneda ?? null,
        timbre_qr: extr.timbre_qr === true,
        cuadra: arit ? arit.cuadra ?? null : null,
      },
      dgii_estado: dgii.estado ?? null,
      padron_estado: padron?.estado ?? null,
      duplicados: { mesa: dup.mesa.length, adm: dup.adm.length, verificado: dup.verificado },
      errores_prep: ctx.errores,
      evento,
      acciones_suprimidas: ctx.suprimidas,
      duracion_seg: dossier.duracion_seg,
    });
  }

  log(
    `listo en ${Math.floor((Date.now() - t0) / 1000)}s (tipo=${tipo}, ncf=${NCF || 'no'}, dgii=${
      String(dgii.estado ?? 'no')
    })`,
  );
}

// ─────────────────────────── el handler ──────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Metodo no permitido' }, 405);
  if (!(await autorizado(req))) return json({ ok: false, error: 'No autorizado' }, 401);

  const t0 = Date.now();
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    // trabajo_id viaja a queries y rutas del cache: se valida ANTES de todo.
    const id = typeof body.trabajo_id === 'string' ? body.trabajo_id.toLowerCase() : '';
    if (!UUID_RE.test(id)) return json({ ok: false, error: 'trabajo_id invalido' }, 400);
    // motivo/intento son informativos (la forma del webhook del poller); se
    // sanean y no viajan a ningún lado sin filtro.
    const motivo = typeof body.motivo === 'string'
      ? body.motivo.replace(/[^a-z0-9_ -]/gi, '').slice(0, 40)
      : '';
    // Backtest: re-preparar una fila YA resuelta para diffear la nube contra lo
    // que el server hizo de verdad. Vale SOLO en sombra (se re-chequea abajo,
    // cuando el modo ya está resuelto): en nube el portón de 'pendiente' manda.
    const backtest = body.backtest === true;

    const db = sb();
    const { data: filas, error: eFila } = await db
      .from('qualia_trabajos')
      .select('empresa_id, estado, updated_at, archivo_nombre, archivo_path, archivo_url')
      .eq('id', id)
      .limit(1);
    if (eFila) throw new Error(`leyendo el trabajo: ${eFila.message}`);
    if (!filas || filas.length === 0) {
      return json({ ok: true, accion: 'ninguna', motivo: 'sin fila para ese id; nada que preparar' });
    }
    const fila = filas[0] as Fila;

    // El prep solo trabaja sobre 'pendiente'. Cualquier otro estado significa
    // que el contable o el usuario ya están en eso: no se toca nada.
    if (fila.estado !== 'pendiente' && !backtest) {
      return json({ ok: true, accion: 'ninguna', estado: fila.estado, motivo: 'no es pendiente; no toco nada' });
    }
    // Sin archivo no hay nada que masticar (sugerencias y bloques de criterios
    // no pasan por acá).
    if (!fila.archivo_path && !fila.archivo_url) {
      return json({ ok: true, accion: 'ninguna', motivo: 'el trabajo no tiene archivo; nada que preparar' });
    }

    const m = await modo(fila.empresa_id, 'qualia-preparador');
    if (m === 'server') {
      // No tocar NADA: ni cache, ni eventos, ni sombra — el sidecar es el dueño.
      return json({ ok: true, modo: 'server', accion: 'ninguna' });
    }
    if (backtest && m !== 'sombra') {
      return json({ ok: false, error: 'backtest solo corre en modo sombra' }, 409);
    }

    const id8 = id.slice(0, 8);
    const ctx: Ctx = {
      db,
      id,
      empresaId: fila.empresa_id,
      m,
      fila,
      motivo,
      backtest,
      t0,
      errores: [],
      suprimidas: [],
      log: (msg) => console.log(`[prep ${id8}] ${msg}`),
      anotar: (e) => {
        ctx.errores.push(e);
        console.log(`[prep ${id8}] aviso: ${e}`);
      },
    };

    // 202-style: el poke no espera el prep entero. El estado vive en el bus y
    // el cache; si este worker muere a mitad, el re-poke del barrido rearma.
    const tarea = preparar(ctx).catch((e) => {
      console.error(`[prep ${id8}] prep fallo: ${e instanceof Error ? e.message : String(e)}`);
    });
    const edge = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
      .EdgeRuntime;
    if (edge?.waitUntil) edge.waitUntil(tarea);

    return json({ ok: true, aceptado: true, funcion: FUNCION, trabajo_id: id, modo: m, motivo }, 202);
  } catch (e) {
    return json({
      ok: false,
      funcion: FUNCION,
      error: e instanceof Error ? e.message : String(e),
      duracion_ms: Date.now() - t0,
    }, 500);
  }
});
