// qualia-contable/consultas.ts — las tres tools de lectura que no son ADM:
// dossier_completo (la gorda), consultar_banco y consultar_dgii.
//
// La regla de diseño del contrato (§5): una iteración cuesta ~11k de entrada,
// así que las tools son GORDAS — `dossier_completo` devuelve en UN viaje lo
// que el chasis viejo sacaba con cinco comandos (leer-contexto.sh: fila +
// propuesta + hilo + dossier del preparador + clasificación + precedente del
// proveedor + hijos del caso).
//
// Las rutas del bucket se declaran locales (espejos.ts) para no atar el bundle
// del turno al del preparador. Las TRES consultas a DGII sí se importan de
// `qualia-preparador/dgii.ts`, y es la excepción a esa regla: son ~340 líneas
// de scraping de ASP.NET WebForms (__VIEWSTATE, cookies, el %20 de FechaFirma)
// contra páginas que cambian de forma sin avisar. Duplicarlas es cómo se llega
// a tener una de las dos copias rota en silencio; una constante duplicada se
// nota, un parser duplicado no.

import {
  caparPropuesta,
  CtxTurno,
  delExamen,
  EventoExamen,
  FilaTrabajo,
  recortar,
  ResultadoTool,
  TOPE_EVENTO_CHARS,
  TOPE_TEXTO_CHARS,
} from './tipos.ts';
import { buscarPrecedente } from './precedentes.ts';
import {
  BUCKET_ESPEJOS,
  rutaClasificacion,
  rutaDossier,
  rutaTexto,
} from './espejos.ts';
import {
  consultaNcfImpreso,
  consultaPadronRnc,
  consultaTimbreEcf,
} from '../qualia-preparador/dgii.ts';

type Dic = Record<string, unknown>;

// Los topes del router, conservados (contrato §5): 5 eventos × 800 chars.
const EVENTOS_POR_DEFECTO = 5;
// El hilo entero tampoco es infinito: 60 eventos es más de lo que cualquier
// trabajo real tuvo (el más largo del corpus tiene 12).
const EVENTOS_TOPE_DURO = 60;

const dic = (v: unknown): Dic | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Dic) : null;

async function bajarTexto(ctx: CtxTurno, ruta: string): Promise<string | null> {
  const { data, error } = await ctx.db.storage.from(BUCKET_ESPEJOS).download(ruta);
  if (error || !data) return null;
  try {
    return await data.text();
  } catch {
    return null;
  }
}

async function bajarJson(ctx: CtxTurno, ruta: string): Promise<Dic | null> {
  const t = await bajarTexto(ctx, ruta);
  if (t === null) return null;
  try {
    return dic(JSON.parse(t) as unknown);
  } catch {
    return null;
  }
}

// ── dossier_completo ────────────────────────────────────────────────────────

/** El precedente del proveedor, servido de oficio: el turno no lo pide. */
async function precedenteDelDossier(ctx: CtxTurno, dossier: Dic | null): Promise<unknown> {
  const extr = dic(dossier?.extraccion) ?? {};
  const termino = String(extr.rnc ?? '') || String(extr.proveedor ?? '') ||
    String((dic(dossier?.propuesta) ?? {}).proveedor ?? '');
  if (termino.trim() === '') return null;
  try {
    return await buscarPrecedente(ctx, { termino });
  } catch (e) {
    return { error: `precedente no disponible: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Los hijos que el caso YA tiene. Van precargados SIEMPRE (contrato §1):
 * Mtk Designs abrió 4 hijos duplicados en 12 segundos por no mirarlos.
 */
async function hijosDelCaso(ctx: CtxTurno): Promise<unknown[]> {
  const { data, error } = await ctx.db
    .from('qualia_trabajos')
    .select('id, estado, resumen, propuesta, created_at')
    .eq('empresa_id', ctx.empresaId)
    .eq('propuesta->>caso_id', ctx.trabajoId)
    .order('created_at', { ascending: true })
    .limit(40);
  if (error || !data) return [];
  return data.map((h) => {
    const p = dic(h.propuesta) ?? {};
    return {
      trabajo_id: h.id,
      estado: h.estado,
      resumen: h.resumen,
      documento_adm: p.documento_adm ?? null,
      monto: p.monto ?? null,
      banco_tx_id: p.banco_tx_id ?? null,
      registro_adm: p.registro_adm ?? null,
      creado: h.created_at,
    };
  });
}

export interface ArgsDossier {
  hilo_completo?: unknown;
}

export async function dossierCompleto(ctx: CtxTurno, args: ArgsDossier): Promise<ResultadoTool> {
  const completo = args.hilo_completo === true;

  // En examen el hilo y los hechos salen del snapshot y la base NI SE TOCA: la
  // fila histórica ya tiene el desenlace adentro (propuesta final, estado
  // final), y releerla sería copiarse la respuesta del examen.
  if (ctx.modo === 'examen') {
    const s = ctx.examen ?? {};
    const eventos = (s.eventos ?? []) as EventoExamen[];
    return {
      fila: {
        id: ctx.trabajoId,
        empresa_id: ctx.empresaId,
        tipo: ctx.fila.tipo,
        origen: ctx.fila.origen,
        estado: s.estado ?? ctx.fila.estado,
        resumen: ctx.fila.resumen ?? null,
        archivo_nombre: ctx.fila.archivo_nombre ?? null,
        aprobado_por_nombre: ctx.fila.aprobado_por_nombre ?? null,
      },
      propuesta: caparPropuesta(ctx.fila.propuesta ?? null),
      hilo: eventos.map((e) => ({
        autor: e.autor,
        tipo: e.tipo,
        fecha: e.fecha ?? null,
        contenido: recortar(String(e.texto ?? ''), completo ? TOPE_TEXTO_CHARS : TOPE_EVENTO_CHARS),
      })),
      dossier: s.dossier ?? null,
      rama: s.rama ?? null,
      modo: 'examen',
      nota: 'modo examen: hechos y hilo salen del snapshot del corpus. Ninguna tool escribe nada en esta corrida',
    };
  }

  const { data: fila, error } = await ctx.db
    .from('qualia_trabajos')
    .select(
      'id, empresa_id, tipo, origen, estado, archivo_nombre, resumen, propuesta, ' +
        'aprobado_por_nombre, error_detalle, created_at, updated_at',
    )
    .eq('id', ctx.trabajoId)
    .eq('empresa_id', ctx.empresaId)
    .maybeSingle();

  // La relectura falla o no trae fila: se sigue con la foto del claim y se
  // AVISA. Un dossier mudo es peor que uno viejo, pero un dossier viejo que se
  // presenta como fresco es lo que hace que el turno decida sobre un estado
  // que ya cambió.
  const f = (fila as FilaTrabajo | null) ?? ctx.fila;
  const notaFila = fila
    ? null
    : `no pude releer la fila (${error?.message ?? 'sin fila'}); esta es la foto del claim`;

  const nEventos = completo ? EVENTOS_TOPE_DURO : EVENTOS_POR_DEFECTO;
  const { data: eventos } = await ctx.db
    .from('qualia_eventos')
    .select('id, autor, tipo, contenido, datos, created_at')
    .eq('trabajo_id', ctx.trabajoId)
    .order('id', { ascending: false })
    .limit(nEventos);

  const hilo = (eventos ?? [])
    .slice()
    .reverse()
    .map((e) => ({
      id: e.id,
      autor: e.autor,
      tipo: e.tipo,
      fecha: e.created_at,
      datos: e.datos ?? null,
      contenido: recortar(String(e.contenido ?? ''), completo ? TOPE_TEXTO_CHARS : TOPE_EVENTO_CHARS),
    }));

  const dossier = await bajarJson(ctx, rutaDossier(ctx.trabajoId));
  const texto = await bajarTexto(ctx, rutaTexto(ctx.trabajoId));
  const clasificacion = await bajarJson(ctx, rutaClasificacion(ctx.trabajoId));

  const salida: ResultadoTool = {
    fila: {
      id: f.id,
      tipo: f.tipo,
      origen: f.origen,
      estado: f.estado,
      archivo_nombre: f.archivo_nombre ?? null,
      resumen: f.resumen ?? null,
      aprobado_por_nombre: f.aprobado_por_nombre ?? null,
      error_detalle: f.error_detalle ?? null,
      created_at: f.created_at ?? null,
      updated_at: f.updated_at ?? null,
    },
    propuesta: caparPropuesta(f.propuesta ?? null),
    hilo,
    hilo_recortado: !completo && hilo.length >= EVENTOS_POR_DEFECTO,
    dossier,
    clasificacion_proponedor: clasificacion,
    // El precedente del proveedor viaja PRECARGADO: pedirlo aparte costaría
    // otra iteración (~11k). buscar_precedente es para OTRA búsqueda.
    precedente_proveedor: await precedenteDelDossier(ctx, dossier),
  };
  if (texto !== null) salida.texto_documento = recortar(texto, TOPE_TEXTO_CHARS);
  if (dossier === null) {
    salida.aviso_dossier =
      'no hay dossier en el cache: la visión y la DGII de primera pasada son del preparador (F2), NO tuyas. Si hacen falta, decilo y pará — no re-leas la imagen';
  } else if (f.updated_at && dossier.row_updated_at && dossier.row_updated_at !== f.updated_at) {
    salida.aviso_dossier =
      `el dossier se preparó sobre otra versión de la fila (dossier ${dossier.row_updated_at} vs fila ${f.updated_at}): puede estar vencido`;
  }
  if (notaFila) salida.aviso_fila = notaFila;
  if (f.tipo === 'caso') salida.hijos_del_caso = await hijosDelCaso(ctx);
  return salida;
}

// ── consultar_banco ─────────────────────────────────────────────────────────

// Las columnas REALES de openbanking_transactions, en español. Traducirlas al
// inglés es el error que esta tool mata: acá se tipan una vez y el modelo las
// recibe con el nombre que tienen en la base. `raw` queda afuera a propósito
// (es el volcado crudo del colector y pesa más que todo lo demás junto).
const COLUMNAS_TX =
  'id, fecha_posteo, fecha_efectiva, nro_referencia, nro_cheque, descripcion, monto, ' +
  'balance, estado_conciliacion, conciliada_at, conciliada_orden_id, banco, cuenta_numero, ' +
  'cuenta_origen, nombre_origen, qualia_trabajo_id, account_id, ' +
  'cuenta:openbanking_accounts!inner(numero, nombre, banco, moneda, tipo, empresa_id)';

const TOPE_FILAS_BANCO = 60;
// Sin ventana, un filtro por monto barrería la tabla entera: 120 días cubre
// con holgura lo que un trabajo de la mesa puede estar buscando.
const DIAS_POR_DEFECTO = 120;

function restarDias(dias: number): string {
  return new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);
}

export interface ArgsBanco {
  tx_id?: unknown;
  cuenta?: unknown;
  desde?: unknown;
  hasta?: unknown;
  monto?: unknown;
  texto?: unknown;
}

export async function consultarBanco(ctx: CtxTurno, args: ArgsBanco): Promise<ResultadoTool> {
  const snap = delExamen(ctx, 'consultar_banco', {
    tx_id: args.tx_id,
    cuenta: args.cuenta,
    desde: args.desde,
    hasta: args.hasta,
    monto: args.monto,
    texto: args.texto,
  });
  if (snap !== null) return snap;

  // El guard de empresa es un !inner join sobre openbanking_accounts: la
  // consulta no puede salirse de las cuentas de ESTA empresa aunque el modelo
  // mande otra cuenta.
  let q = ctx.db
    .from('openbanking_transactions')
    .select(COLUMNAS_TX)
    .eq('cuenta.empresa_id', ctx.empresaId);

  const txId = String(args.tx_id ?? '').trim();
  if (txId !== '') {
    q = q.eq('id', txId);
  } else {
    const cuenta = String(args.cuenta ?? '').trim();
    if (cuenta !== '') q = q.eq('cuenta.numero', cuenta);
    const desde = String(args.desde ?? '').trim();
    const hasta = String(args.hasta ?? '').trim();
    q = q.gte('fecha_posteo', desde !== '' ? desde : restarDias(DIAS_POR_DEFECTO));
    if (hasta !== '') q = q.lte('fecha_posteo', hasta);
    const texto = String(args.texto ?? '').trim();
    // Los comodines del texto del modelo se neutralizan: el ilike lo arma la
    // tool, no la cadena que venga.
    if (texto !== '') q = q.ilike('descripcion', `%${texto.replace(/[%_,]/g, ' ').trim()}%`);
  }

  const { data, error } = await q
    .order('fecha_posteo', { ascending: false })
    .order('id', { ascending: true })
    .limit(TOPE_FILAS_BANCO * 4);
  if (error) return { error: `openbanking_transactions: ${error.message}` };

  let filas = (data ?? []) as unknown as Dic[];
  // El monto se filtra LOCAL y por valor absoluto: en la tabla el signo dice
  // la dirección (negativo = salió plata) y el papel casi nunca lo trae.
  const montoPedido = Number(args.monto);
  if (Number.isFinite(montoPedido) && String(args.monto ?? '') !== '') {
    const objetivo = Math.abs(montoPedido);
    filas = filas.filter((f) => Math.abs(Number(f.monto ?? 0) - objetivo) <= 0.05);
  }

  return {
    movimientos: filas.slice(0, TOPE_FILAS_BANCO),
    hay_mas: filas.length > TOPE_FILAS_BANCO,
    columnas: 'fecha_posteo, monto (negativo = salió plata), descripcion, nro_referencia, estado_conciliacion, cuenta.*',
    nota: txId !== ''
      ? 'un movimiento con estado_conciliacion distinto de "pendiente" o con qualia_trabajo_id ya está reclamado'
      : 'monto+fecha NO prueban identidad (FP00001114/1115): sin referencia o concepto que ate, preguntá. Y el banco impreso en el papel no es la cuenta de origen',
  };
}

// ── consultar_dgii ──────────────────────────────────────────────────────────

/** Lo que el dossier ya trae verificado, para no re-consultar (rama-facturas-1). */
function yaVerificado(dossier: Dic | null, modo: string): { hecho: boolean; ficha: unknown } {
  if (!dossier) return { hecho: false, ficha: null };
  const ficha = modo === 'padron' ? dic(dossier.rnc_emisor) : dic(dossier.dgii);
  if (!ficha) return { hecho: false, ficha: null };
  const estado = String(ficha.estado ?? '').toLowerCase();
  // 'no verificable' (y el campo ausente) son las DOS únicas puertas: con
  // campo presente y verificado, re-consultar está prohibido.
  const hecho = estado !== '' && estado !== 'no verificable';
  return { hecho, ficha };
}

export interface ArgsDgii {
  modo?: unknown;
  rnc?: unknown;
  ncf?: unknown;
  url_qr?: unknown;
}

export async function consultarDgii(ctx: CtxTurno, args: ArgsDgii): Promise<ResultadoTool> {
  const modo = String(args.modo ?? '');
  const snap = delExamen(ctx, 'consultar_dgii', {
    modo,
    rnc: args.rnc,
    ncf: args.ncf,
    url_qr: args.url_qr,
  });
  if (snap !== null) return snap;

  // El guard del contrato: la consulta SOLO existe para el hueco. El dossier
  // del preparador ya pagó esta llamada; repetirla quema segundos y a veces
  // devuelve peor información que la que ya está en la fila.
  const dossier = ctx.modo === 'examen'
    ? dic(ctx.examen?.dossier ?? null)
    : await bajarJson(ctx, rutaDossier(ctx.trabajoId));
  const { hecho, ficha } = yaVerificado(dossier, modo);
  if (hecho) {
    return {
      error: 'el dossier YA trae esta verificación: re-consultar con campo presente está prohibido (rama-facturas-1)',
      ya_verificado: ficha,
    };
  }

  try {
    switch (modo) {
      case 'ncf': {
        const rnc = String(args.rnc ?? '').trim();
        const ncf = String(args.ncf ?? '').trim();
        if (!rnc || !ncf) return { error: 'modo ncf: faltan rnc y ncf' };
        return { dgii: await consultaNcfImpreso(rnc, ncf), copiar_a: 'propuesta.dgii' };
      }
      case 'timbre': {
        // La URL del QR entera: sus parámetros SON el request del timbre.
        const crudo = String(args.url_qr ?? '').trim();
        if (!crudo) return { error: 'modo timbre: falta url_qr (la URL completa del QR del e-CF)' };
        let u: URL;
        try {
          u = new URL(crudo);
        } catch {
          return { error: 'url_qr no es una URL válida' };
        }
        if (!/(^|\.)dgii\.gov\.do$/i.test(u.hostname)) {
          // La URL sale de un documento de un tercero: solo se le pega a DGII.
          return { error: `url_qr apunta a ${u.hostname}, no a dgii.gov.do: no la consulto` };
        }
        const p = u.searchParams;
        const fe = (p.get('FechaEmision') ?? '').split('-'); // DD-MM-AAAA en el QR
        const iso = fe.length === 3 ? `${fe[2]}-${fe[1]}-${fe[0]}` : '';
        return {
          dgii: await consultaTimbreEcf({
            rncEmisor: p.get('RncEmisor') ?? String(args.rnc ?? ''),
            rncComprador: p.get('RncComprador') ?? '',
            encf: p.get('ENCF') ?? String(args.ncf ?? ''),
            fechaEmisionIso: iso,
            monto: p.get('MontoTotal') ?? '',
            fechaFirma: p.get('FechaFirma') ?? '',
            codigo: p.get('CodigoSeguridad') ?? '',
          }),
          copiar_a: 'propuesta.dgii',
          nota: 'el timbre del QR pisa al texto del papel (E310016169496), y su FechaFirma manda sobre la fecha impresa',
        };
      }
      case 'padron': {
        const rnc = String(args.rnc ?? '').trim();
        if (!rnc) return { error: 'modo padron: falta rnc' };
        return { dgii: await consultaPadronRnc(rnc), copiar_a: 'propuesta.rnc_padron' };
      }
      default:
        return { error: `modo '${modo}' desconocido: ncf | timbre | padron` };
    }
  } catch (e) {
    // Jamás inventar el resultado: si DGII no contestó, eso es el resultado.
    return {
      dgii: { estado: 'no verificable', motivo: e instanceof Error ? e.message : String(e) },
      nota: 'DGII no contestó. NO inventes el resultado: dejalo como "no verificable" y decilo en la propuesta',
    };
  }
}
