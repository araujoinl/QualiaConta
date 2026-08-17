import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

/**
 * Edge Function: qualia-padron-dgii
 *
 * Carga el padrón de contribuyentes de la DGII desde su archivo público y lo
 * deja en `dgii_rnc`, para que la pregunta "¿de quién es este RNC y está
 * activo?" se conteste desde la base en milisegundos en vez de contra un
 * formulario ASP.NET que tarda segundos y a veces no contesta.
 *
 * Lo que NO carga, y por eso el preparador sigue consultando online: la validez
 * del COMPROBANTE (NCF/e-CF). Eso es por documento y la DGII no lo publica en
 * bloque.
 *
 * CÓMO entra en un worker de 256 MB con un archivo de 90 MB: no se guarda nada
 * entero. El ZIP se lee como stream, se descomprime al vuelo
 * (DecompressionStream deflate-raw sobre el contenido del único miembro), se
 * parte en líneas y cada LOTE se manda a la base y se descarta. El pico de
 * memoria es un lote, no el archivo.
 *
 * AUTÓNOMA a propósito: no importa `_shared`. Es un cargador de catálogo que
 * corre solo, una vez al mes, y no comparte nada con el camino de la factura;
 * mantenerlo suelto evita que un cambio del pipeline lo rompa.
 *
 * Agenda: mensual por pg_cron. El archivo se publica cada pocos días; mensual
 * alcanza para lo que decide (un RNC no cambia de dueño) y no castiga a la
 * DGII. Si una corrida no termina dentro del wall clock, responde
 * `continuar_desde` y la siguiente reanuda: el upsert es idempotente.
 *
 * Body opcional: { desde_linea?: number }
 */

const FUNCION = 'qualia-padron-dgii';
const URL_ZIP = 'https://dgii.gov.do/app/WebApps/Consultas/RNC/DGII_RNC.zip';
// La DGII responde 403 a un cliente sin navegador (verificado 2026-08-17).
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const LOTE = 5000;
// Presupuesto propio, por debajo del wall clock de la plataforma: cortar solo
// y dejar dicho por dónde iba es mejor que morir mudo a mitad.
const PLAZO_MS = 320_000;

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Mismo criterio que `_shared/auth.ts`: el bearer de los crons vive en la base
 * (qualia_config, clave `cron_bearer`) y el env manda si existe. Va inline
 * porque esta function es autónoma.
 */
async function autorizado(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return false;
  const presentado = auth.slice(7);
  const env = Deno.env.get('QUALIA_CRON_BEARER');
  if (env) return presentado === env;
  const { data, error } = await db
    .from('qualia_config')
    .select('valor')
    .is('empresa_id', null)
    .eq('clave', 'cron_bearer')
    .single();
  if (error || !data) return false;
  const valor = (data.valor as { bearer?: string }).bearer;
  return typeof valor === 'string' && valor !== '' && presentado === valor;
}

interface Fila {
  rnc: string;
  nombre: string | null;
  nombre_comercial: string | null;
  actividad: string | null;
  estado: string | null;
  regimen: string | null;
}

/**
 * El ZIP trae UN solo miembro (TMP/DGII_RNC.TXT) en deflate. Se lee la cabecera
 * local para saber dónde arranca el contenido y se devuelve el resto del stream
 * ya descomprimido. No se usa una librería de zip porque todas quieren el
 * archivo entero en memoria — que es justo lo que no entra.
 */
async function streamDelZip(resp: Response): Promise<ReadableStream<Uint8Array>> {
  const lector = resp.body!.getReader();
  let buffer = new Uint8Array(0);

  const juntar = (a: Uint8Array, b: Uint8Array) => {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  };

  // La cabecera local son 30 bytes fijos + nombre + extra.
  while (buffer.length < 30) {
    const { value, done } = await lector.read();
    if (done) throw new Error('el zip se cortó antes de la cabecera');
    buffer = juntar(buffer, value!);
  }
  const dv = new DataView(buffer.buffer, buffer.byteOffset);
  if (dv.getUint32(0, true) !== 0x04034b50) throw new Error('no parece un zip');
  const metodo = dv.getUint16(8, true);
  if (metodo !== 8) throw new Error(`compresión ${metodo} no soportada (se esperaba deflate)`);
  const largoNombre = dv.getUint16(26, true);
  const largoExtra = dv.getUint16(28, true);
  const inicio = 30 + largoNombre + largoExtra;
  while (buffer.length < inicio) {
    const { value, done } = await lector.read();
    if (done) throw new Error('el zip se cortó dentro de la cabecera');
    buffer = juntar(buffer, value!);
  }
  const resto = buffer.slice(inicio);

  const comprimido = new ReadableStream<Uint8Array>({
    start(controller) {
      if (resto.length > 0) controller.enqueue(resto);
    },
    async pull(controller) {
      const { value, done } = await lector.read();
      if (done) controller.close();
      else controller.enqueue(value!);
    },
    cancel() {
      lector.cancel();
    },
  });
  return comprimido.pipeThrough(new DecompressionStream('deflate-raw'));
}

function parsear(linea: string): Fila | null {
  // 11 campos separados por barra; los del medio vienen vacíos.
  const c = linea.split('|');
  if (c.length < 11) return null;
  const rnc = c[0].trim();
  if (!/^\d{9}$|^\d{11}$/.test(rnc)) return null;
  const limpio = (v: string) => {
    const t = v.trim();
    return t === '' ? null : t.slice(0, 200);
  };
  return {
    rnc,
    nombre: limpio(c[1]),
    nombre_comercial: limpio(c[2]),
    actividad: limpio(c[3]),
    estado: limpio(c[9]),
    regimen: limpio(c[10]),
  };
}

Deno.serve(async (req: Request) => {
  if (!(await autorizado(req))) return json({ error: 'no autorizado' }, 401);

  const t0 = Date.now();
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const desdeLinea = Number(body.desde_linea ?? 0) || 0;

  let leidas = 0;
  let cargadas = 0;
  let lotes = 0;
  let cortadoEn: number | null = null;

  try {
    const resp = await fetch(URL_ZIP, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(120_000),
    });
    if (!resp.ok || !resp.body) {
      return json({ ok: false, funcion: FUNCION, error: `DGII respondió HTTP ${resp.status}` }, 502);
    }

    const texto = (await streamDelZip(resp)).pipeThrough(new TextDecoderStream('latin1'));

    let resto = '';
    let pendientes: Fila[] = [];

    const volcar = async () => {
      if (pendientes.length === 0) return;
      const { error } = await db.from('dgii_rnc').upsert(pendientes, { onConflict: 'rnc' });
      if (error) throw new Error(`upsert falló: ${error.message}`);
      cargadas += pendientes.length;
      lotes++;
      pendientes = [];
    };

    bucle: for await (const trozo of texto) {
      resto += trozo;
      const lineas = resto.split('\n');
      resto = lineas.pop() ?? '';
      for (const cruda of lineas) {
        leidas++;
        if (leidas <= desdeLinea) continue;
        const fila = parsear(cruda);
        if (fila) pendientes.push(fila);
        if (pendientes.length >= LOTE) {
          await volcar();
          if (Date.now() - t0 > PLAZO_MS) {
            cortadoEn = leidas;
            break bucle;
          }
        }
      }
    }
    if (cortadoEn === null) {
      const ultima = parsear(resto);
      if (ultima) pendientes.push(ultima);
      await volcar();
    }

    // La marca de frescura solo se pone cuando el archivo se terminó: un padrón
    // a medias con marca fresca es el falso verde que qualia-salud existe para
    // evitar.
    if (cortadoEn === null) {
      await db.from('qualia_config')
        .update({
          valor: { en: new Date().toISOString(), filas: cargadas },
          actualizado_por: FUNCION,
          actualizado_en: new Date().toISOString(),
        })
        .is('empresa_id', null)
        .eq('clave', 'refresco_padron_dgii');
    }

    return json({
      ok: true,
      funcion: FUNCION,
      leidas,
      cargadas,
      lotes,
      completo: cortadoEn === null,
      continuar_desde: cortadoEn,
      duracion_seg: Math.round((Date.now() - t0) / 1000),
    });
  } catch (e) {
    return json({
      ok: false,
      funcion: FUNCION,
      error: e instanceof Error ? e.message : String(e),
      leidas,
      cargadas,
      duracion_seg: Math.round((Date.now() - t0) / 1000),
    }, 500);
  }
});
