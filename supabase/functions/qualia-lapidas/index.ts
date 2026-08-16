import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { sb, modo, configGlobal, type Modo } from '../_shared/db.ts';
import { autorizado } from '../_shared/auth.ts';
import { registrarSombra } from '../_shared/sombra.ts';

/**
 * Edge Function: qualia-lapidas
 *
 * Port fiel de hermes/memoria/scripts/verificar-registros.py (cron 35 * * * *
 * del server): el barrido batch que verifica que los documentos registrados en
 * ADM sigan vigentes, para TODAS las filas con registro. El gemelo por click
 * sobre UNA fila es `admcloud-verificar-registro`; las reglas de lectura son
 * las mismas en los dos lados — si divergen, uno miente.
 *
 * Divergencia CONOCIDA con el fuente (anotada, no corregida): este port
 * trimea `documento_adm` antes de usarlo; el python usa el valor crudo, así
 * que un documento_adm de solo espacios allá cae en «tipo desconocido»
 * (indeterminado) y acá cae al fallback tipo='factura'→VendorBills. Riesgo
 * práctico mínimo; si aparece en el diff de sombra, es esto.
 *
 * Existe porque en ADM **revertir BORRA**: no queda Void=true ni lápida
 * auditable — el documento desaparece y su GET por UUID devuelve null (medido
 * 2026-08-02 con el asiento del Gate 0, y de nuevo el 2026-08-03 con la
 * FP00001063). Sin este chequeo la mesa seguiría diciendo "Subida" sobre algo
 * que ya no existe, y el libro citaría un número de documento fantasma.
 *
 * Dos formas de dejar de estar vigente, y NO son lo mismo:
 *   ELIMINADO  el documento desaparece; GET devuelve data:null. -> eliminado_en
 *   ANULADO    se conserva con Void=true, fuera de balances.    -> anulado_en
 *
 * Las cuatro guardas son el contrato — cada una nació de un incidente:
 *   1) Se pregunta por UUID, UNO POR UNO, contra el endpoint del tipo de cada
 *      fila. JAMÁS por listado: el listado no trae anulados ni todos los tipos
 *      (la versión por listado enterró 61 BankCharges VIVOS el 2026-08-04).
 *   2) Anulado (Void:true) ≠ eliminado (data:null): campos distintos.
 *   3) El ID devuelto debe ser EL PEDIDO: a esta API se le puede pasar un
 *      DocID o un NCF y responde OTRO documento con success:true — ese acierto
 *      casual es peor que un error.
 *   4) Lo que no se pudo verificar (red, HTTP raro) NO se marca: una lápida
 *      falsa cuesta más que un chequeo perdido.
 *
 * NO re-registra ni cambia el estado: qué hacer con un documento caído es una
 * decisión del humano, no de esta function.
 *
 * MODO (qualia_config, por empresa con default global):
 *   'server' -> no toca nada: el cron del server sigue siendo el dueño.
 *   'sombra' -> consulta ADM (lectura, inocua) pero la lápida que PONDRÍA va
 *               SOLO a qualia_sombra (clave = trabajo_id+uuid); ni
 *               qualia_trabajos ni qualia_eventos se tocan.
 *   'nube'   -> marca de verdad (lápida + nota en qualia_eventos).
 *
 * Body: { empresa_id? } — sin él barre la flota (qualia_activa=true).
 */

const ADMCLOUD_BASE = 'https://api.admcloud.net';
const FUNCION = 'qualia-lapidas';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Tope de consultas ADM por corrida: el fuente no tenía (corría cada hora sin
// apuro); acá el wall-clock de la function es finito y cada UUID es un GET
// secuencial. Knob: env QUALIA_LAPIDAS_LOTE > qualia_config global
// 'lapidas_lote' > 50.
const LOTE_DEFAULT = 50;

// Los documentos que la mesa sabe registrar. El endpoint es el mismo nombre
// que `propuesta.documento_adm`, que es lo que escribe el contable.
//
// Este set y el `case` de script_de_registro en mesa/poller.sh son la MISMA
// lista escrita dos veces, y se desincronizan solas — ya pasó TRES veces:
// - VendorCreditNotes: sin él, la NCP caía a «tipo desconocido» y no se
//   verificaba NUNCA; y con documento_adm mintiendo (VendorBills sobre una
//   NCP) el GET devolvía data:null y se lapidaba algo VIVO (NCP00000006,
//   2026-08-07).
// - BillPayments: 34 pagos (PP00000751…) sin circuito de vuelta hasta el
//   2026-08-07.
// - AccountPayments: tercero con el mismo agujero, entró el 2026-08-14 por
//   auditoría (sondeado contra el PC00000339: readback con Void, GUID
//   inexistente contesta data:null).
// Al agregar un tipo allá, se agrega acá.
const ENDPOINTS = new Set([
  'VendorBills',
  'VendorCreditNotes',
  'BankCharges',
  'BankBankTransfers',
  'BillPayments',
  'AccountPayments',
  'Journals',
]);

type Estado = 'vigente' | 'anulado' | 'eliminado' | 'indeterminado';

interface Credenciales {
  codigo: string;
  api_role: string;
  api_appid: string;
  api_username: string;
  api_password: string;
}

interface Fila {
  id: string;
  tipo: string | null;
  resumen: string | null;
  docid: string | null;
  uuid: string | null;
  eliminado_en: string | null;
  anulado_en: string | null;
  documento_adm: string | null;
  proveedor: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * [estado, detalle] para un documento nuestro.
 *
 * 'indeterminado' es un NO SE SABE, no un no: es lo que devuelve cuando la API
 * no contesta o contesta algo que no entendemos, y su único efecto es que la
 * fila no se toca.
 */
async function estadoEnAdm(
  cred: Credenciales,
  documento: string,
  uuid: string,
): Promise<[Estado, string]> {
  if (!ENDPOINTS.has(documento)) {
    return ['indeterminado', `tipo de documento desconocido: '${documento}'`];
  }
  if (!uuid) {
    return ['indeterminado', 'la fila no guardó el uuid del documento'];
  }

  const u = new URL(`${ADMCLOUD_BASE}/api/${documento}/${encodeURIComponent(uuid)}`);
  u.searchParams.set('company', cred.codigo);
  u.searchParams.set('role', cred.api_role);
  u.searchParams.set('appid', cred.api_appid);

  let cuerpo: unknown;
  try {
    const r = await fetch(u.toString(), {
      headers: {
        Authorization: `Basic ${btoa(`${cred.api_username}:${cred.api_password}`)}`,
        Accept: 'application/json',
      },
      // El mismo timeout=60 del fuente.
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      // 404 es la respuesta honesta de "no está", pero esta API no la usa para
      // esto (devuelve 200 + data null): un 404 acá es más probable que sea la
      // ruta mal armada que un documento borrado.
      await r.body?.cancel();
      return ['indeterminado', `HTTP ${r.status}`];
    }
    cuerpo = await r.json();
  } catch (e) {
    // Red, timeout, JSON roto: no se concluye nada.
    return ['indeterminado', e instanceof Error ? e.name : 'error de red'];
  }

  const d = (cuerpo as Record<string, unknown> | null)?.data;
  if (typeof d !== 'object' || d === null || Array.isArray(d)) {
    // Eliminado y uuid-que-no-existe dan lo mismo: success true, data null.
    return ['eliminado', 'el documento ya no existe en ADM'];
  }
  const doc = d as Record<string, unknown>;
  // Guarda 3: si el ID devuelto no es el pedido (o no vino), la API resolvió
  // otra cosa. Tratarlo como eliminado sería inventar; lo que corresponde es
  // no concluir.
  if (String(doc.ID ?? '').toLowerCase() !== uuid.toLowerCase()) {
    return ['indeterminado', `el readback devolvió otro documento (${doc.DocID ?? '?'})`];
  }
  return doc.Void ? ['anulado', 'Void=true'] : ['vigente', ''];
}

/**
 * Pone la lápida de verdad (modo 'nube'). El fuente usaba jsonb_set — atómico
 * sobre la sola clave; PostgREST no lo tiene, así que se emula: releer la fila
 * fresca, re-verificar la idempotencia y escribir con guard optimista sobre
 * updated_at (el mismo del gemelo por click). 'carrera' = otro escribió en el
 * medio: no se pisa nada, la próxima corrida horaria la agarra igual.
 */
async function marcar(
  db: ReturnType<typeof sb>,
  empresaId: string,
  trabajoId: string,
  campo: 'eliminado_en' | 'anulado_en',
  texto: string,
  errores: string[],
): Promise<'marcado' | 'ya_estaba' | 'carrera' | 'error'> {
  const { data: fresca, error: eLee } = await db
    .from('qualia_trabajos')
    .select('propuesta, updated_at')
    .eq('id', trabajoId)
    .eq('empresa_id', empresaId)
    .single();
  if (eLee || !fresca) {
    errores.push(`releyendo ${trabajoId}: ${eLee?.message ?? 'sin fila'}`);
    return 'error';
  }

  const propuesta = (fresca.propuesta ?? {}) as Record<string, unknown>;
  const registro = (propuesta.registro_adm ?? null) as Record<string, unknown> | null;
  if (!registro) {
    // El registro desapareció entre el barrido y esta escritura: sin dónde
    // anclar la lápida, no se inventa.
    errores.push(`marcando ${trabajoId}: la fila ya no tiene registro_adm`);
    return 'error';
  }
  if (registro.eliminado_en || registro.anulado_en) return 'ya_estaba';

  // Fecha sola, sin hora: el formato que escribe el fuente (now()::date) y lo
  // que la mesa lee para tachar la fila.
  const hoy = new Date().toISOString().slice(0, 10);
  const { data: escrito, error: eUpd } = await db
    .from('qualia_trabajos')
    .update({ propuesta: { ...propuesta, registro_adm: { ...registro, [campo]: hoy } } })
    .eq('id', trabajoId)
    .eq('empresa_id', empresaId)
    .eq('updated_at', fresca.updated_at)
    .select('id');
  if (eUpd) {
    errores.push(`marcando ${trabajoId}: ${eUpd.message}`);
    return 'error';
  }
  if (!escrito || escrito.length === 0) return 'carrera';

  // La nota con el motivo, como el fuente. Solo si la lápida quedó escrita:
  // anotar algo que no se hizo sería mentir en el hilo.
  const { error: eEv } = await db.from('qualia_eventos').insert({
    trabajo_id: trabajoId,
    autor: 'contable',
    tipo: 'nota',
    contenido: texto,
  });
  if (eEv) {
    // La lápida quedó; la nota no. No se revierte (la lápida es el dato), pero
    // tampoco se calla.
    errores.push(`nota de ${trabajoId}: ${eEv.message}`);
  }
  return 'marcado';
}

async function correrEmpresa(
  db: ReturnType<typeof sb>,
  empresaId: string,
  presupuesto: { restante: number },
  errores: string[],
): Promise<Record<string, unknown>> {
  const m: Modo = await modo(empresaId, 'qualia-lapidas');
  if (m === 'server') {
    // El cron del server sigue siendo el dueño: esta function no compite.
    return { modo: 'server', accion: 'ninguna' };
  }

  const { data: cred, error: eCred } = await db
    .from('admcloud_empresas')
    .select('codigo, api_role, api_appid, api_username, api_password')
    .eq('id', empresaId)
    .single();
  if (eCred || !cred) {
    // Sin credenciales no se puede verificar NADA — y lo inverificable no se
    // marca, así que la empresa entera queda intacta.
    errores.push(`empresa ${empresaId}: sin credenciales ADM (${eCred?.message ?? 'sin fila'})`);
    return { modo: m, error: 'sin credenciales ADM', accion: 'ninguna' };
  }

  // Las mismas columnas del SELECT del fuente. `documento_adm` es lo que el
  // contable declaró registrar; el fallback tipo='factura' -> VendorBills
  // cubre las filas viejas, nacidas antes de ese campo, cuando el tipo solo
  // podía ser una factura.
  const { data: filas, error: eFilas } = await db
    .from('qualia_trabajos')
    .select(
      'id, tipo, resumen, ' +
        'docid:propuesta->registro_adm->>docid, ' +
        'uuid:propuesta->registro_adm->>uuid, ' +
        'eliminado_en:propuesta->registro_adm->>eliminado_en, ' +
        'anulado_en:propuesta->registro_adm->>anulado_en, ' +
        'documento_adm:propuesta->>documento_adm, ' +
        'proveedor:propuesta->>proveedor',
    )
    .eq('empresa_id', empresaId)
    .not('propuesta->registro_adm->>docid', 'is', null)
    .order('propuesta->registro_adm->>docid', { ascending: true });
  if (eFilas) {
    errores.push(`empresa ${empresaId}: leyendo registrados: ${eFilas.message}`);
    return { modo: m, error: 'no se pudo leer la mesa', accion: 'ninguna' };
  }

  const registrados = (filas ?? []) as unknown as Fila[];

  // Idempotencia del fuente: sobre una lápida ya puesta no se vuelve a
  // preguntar — un documento caído no resucita.
  const yaMarcados = registrados.filter(
    (f) => (f.eliminado_en ?? '') !== '' || (f.anulado_en ?? '') !== '',
  );
  const pendientes = registrados.filter(
    (f) => (f.eliminado_en ?? '') === '' && (f.anulado_en ?? '') === '',
  );

  // Presupuesto por corrida. Si no alcanza, se toma una VENTANA que rota con
  // la hora: con orden fijo por docid, un recorte naif verificaría siempre los
  // mismos N primeros y el resto no se miraría NUNCA — el mismo agujero de
  // «no se verifica nunca, ni vivo ni muerto» que ya se pagó tres veces con
  // los tipos. Sin estado en la base, la hora es el cursor: en
  // ceil(n/cupo) corridas horarias la vuelta cubre todo el set.
  let aVerificar = pendientes;
  let sinPresupuesto = 0;
  if (pendientes.length > presupuesto.restante) {
    const cupo = presupuesto.restante;
    if (cupo <= 0) {
      aVerificar = [];
    } else {
      const ventanas = Math.ceil(pendientes.length / cupo);
      const idx = Math.floor(Date.now() / 3_600_000) % ventanas;
      aVerificar = pendientes.slice(idx * cupo, idx * cupo + cupo);
    }
    sinPresupuesto = pendientes.length - aVerificar.length;
  }
  presupuesto.restante -= aVerificar.length;

  const conteo = { vigentes: 0, anulados: 0, eliminados: 0, indeterminados: 0 };
  let sombras = 0;
  let marcados = 0;
  let carreras = 0;
  const caidos: Array<Record<string, unknown>> = [];
  const reporte: Array<Record<string, unknown>> = [];

  for (const fila of aVerificar) {
    const docid = fila.docid ?? '';
    const uuid = (fila.uuid ?? '').trim();
    const documento = (fila.documento_adm ?? '').trim() !== ''
      ? (fila.documento_adm as string).trim()
      : fila.tipo === 'factura'
      ? 'VendorBills'
      : '';
    // El «quién» del reporte del fuente: proveedor, o el arranque del resumen.
    const quien = ((fila.proveedor ?? '').trim() !== ''
      ? (fila.proveedor as string)
      : fila.resumen ?? '').slice(0, 40);

    const [estado, detalle] = await estadoEnAdm(cred as Credenciales, documento, uuid);
    reporte.push({ docid, quien, estado, ...(detalle ? { detalle } : {}) });

    if (estado === 'vigente') {
      conteo.vigentes++;
      continue;
    }
    if (estado === 'indeterminado') {
      // Guarda 4: no se sabe ≠ no está. La fila no se toca, ni en sombra.
      conteo.indeterminados++;
      continue;
    }

    // Los textos EXACTOS del fuente: son lo que el humano lee en el hilo.
    const campo = estado === 'eliminado' ? ('eliminado_en' as const) : ('anulado_en' as const);
    const texto = estado === 'eliminado'
      ? `El documento ${docid} ya no existe en ADM Cloud: fue eliminado. ` +
        'El trabajo queda sin registro.'
      : `El documento ${docid} fue ANULADO en ADM Cloud: se conserva con ` +
        'marca de anulado y fuera de balances.';
    if (estado === 'eliminado') conteo.eliminados++;
    else conteo.anulados++;

    if (m === 'sombra') {
      // La lápida que PONDRÍA, a qualia_sombra y a NINGÚN otro lado. Una
      // sombra que no se pudo escribir no aborta el barrido, pero tampoco se
      // calla: sin la fila, el diff contra el server mentiría por omisión.
      try {
        await registrarSombra(FUNCION, empresaId, `${fila.id}+${uuid}`, {
          accion: 'poner_lapida',
          trabajo_id: fila.id,
          docid,
          uuid,
          documento,
          estado,
          campo,
          nota: texto,
        });
        sombras++;
        caidos.push({ trabajo_id: fila.id, docid, campo, resultado: 'sombra' });
      } catch (e) {
        errores.push(`sombra ${fila.id}+${uuid}: ${e instanceof Error ? e.message : String(e)}`);
      }
      continue;
    }

    // modo 'nube': la lápida de verdad.
    const resultado = await marcar(db, empresaId, fila.id, campo, texto, errores);
    if (resultado === 'marcado') marcados++;
    else if (resultado === 'carrera') carreras++;
    caidos.push({ trabajo_id: fila.id, docid, campo, resultado });
  }

  return {
    modo: m,
    registrados: registrados.length,
    ya_marcados: yaMarcados.length,
    verificados: aVerificar.length,
    sin_presupuesto: sinPresupuesto,
    ...conteo,
    caidos,
    sombra: sombras,
    marcados,
    carreras,
    reporte,
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido' }, 405);
  if (!(await autorizado(req))) return json({ ok: false, error: 'No autorizado' }, 401);

  const t0 = Date.now();
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // Entrada externa: se valida antes de usarse. empresa_id opcional acota a
    // una empresa; sin él, barre la flota.
    let soloEmpresa: string | null = null;
    if (body.empresa_id !== undefined && body.empresa_id !== null) {
      if (typeof body.empresa_id !== 'string' || !UUID_RE.test(body.empresa_id)) {
        return json({ ok: false, error: 'empresa_id inválido' }, 400);
      }
      soloEmpresa = body.empresa_id;
    }

    const db = sb();

    // El knob del lote: env manda, después la config global, después 50.
    let lote = LOTE_DEFAULT;
    const deEnv = Number(Deno.env.get('QUALIA_LAPIDAS_LOTE') ?? NaN);
    if (Number.isInteger(deEnv) && deEnv > 0) {
      lote = deEnv;
    } else {
      const cfg = await configGlobal('lapidas_lote');
      const v = typeof cfg === 'number' ? cfg : (cfg as { lote?: unknown } | null)?.lote;
      if (typeof v === 'number' && Number.isInteger(v) && v > 0) lote = v;
    }

    let empresas: string[];
    if (soloEmpresa) {
      empresas = [soloEmpresa];
    } else {
      const { data, error } = await db
        .from('admcloud_empresas')
        .select('id')
        .eq('qualia_activa', true);
      if (error) {
        return json({ ok: false, error: `no pude listar empresas activas: ${error.message}` }, 500);
      }
      empresas = (data ?? []).map((f) => String(f.id));
      if (empresas.length === 0) {
        return json({ ok: true, funcion: FUNCION, empresas: 0, accion: 'ninguna' });
      }
    }

    // El presupuesto es de la CORRIDA, no de cada empresa: el wall-clock que
    // protege es uno solo. Y la rotación horaria aplica también ENTRE
    // empresas (v2, hallazgo del revisor): con orden fijo, una empresa cuyos
    // pendientes sean múltiplo exacto del cupo se comería TODAS las corridas
    // y las siguientes no verificarían nunca — mismo cursor, cero estado.
    if (empresas.length > 1) {
      const giro = Math.floor(Date.now() / 3_600_000) % empresas.length;
      empresas = [...empresas.slice(giro), ...empresas.slice(0, giro)];
    }
    const presupuesto = { restante: lote };
    const errores: string[] = [];
    const resultados: Record<string, unknown> = {};
    for (const empresaId of empresas) {
      resultados[empresaId] = await correrEmpresa(db, empresaId, presupuesto, errores);
    }

    return json({
      ok: true,
      funcion: FUNCION,
      empresa_id: soloEmpresa,
      lote,
      empresas: empresas.length,
      resultados,
      errores,
      duracion_ms: Date.now() - t0,
    });
  } catch (e) {
    return json(
      {
        ok: false,
        funcion: FUNCION,
        error: e instanceof Error ? e.message : String(e),
        duracion_ms: Date.now() - t0,
      },
      500,
    );
  }
});
