import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { sb, modo } from '../_shared/db.ts';
import { autorizado, bearerCron } from '../_shared/auth.ts';
import { registrarSombra } from '../_shared/sombra.ts';

/**
 * Edge Function: qualia-barrido
 *
 * Heredero de los 4 rescates de mesa/poller.sh (bloques 1, 2b, 3 y 4). El
 * trigger pg_net es fire-and-forget: si el poke muere (cold start con error,
 * deploy a mitad, worker de pg_net caido), nadie reintenta. Este barrido corre
 * por pg_cron cada 1-2 min y recoge lo que se cayo. Sin el, "el retry la
 * retoma" del plan no tiene sujeto.
 *
 * La regla general detras de los barridos, portada tal cual del poller: TODO
 * estado que le pertenece al contable —pendiente, analizando,
 * aprobada-sin-docid, registrada-sin-libro— necesita su red. Los que le
 * pertenecen al humano —propuesta, esperando_respuesta— no se tocan nunca, y
 * los terminales —rechazada, error— tampoco. El CASO cerrado queda sin red A
 * SABIENDAS (bloque 3 del poller): un caso no le debe nada a ADM y su hilo
 * queda escrito igual; "no cubierto" es distinto de "sin resolver". Si algun
 * dia se agrega un estado del contable, hay que preguntarse quien lo rescata.
 *
 * Rescates:
 *   1) 're_poke'            pendiente sin claim > 300s  -> poke al preparador
 *   2) 'reserva_muerta'     analizando > 20 min         -> vuelve a pendiente
 *   3) 'registro_reintento' aprobada sin docid          -> F1: SOLO detecta
 *   4) 'sin_libro'          registrada/criterio sin libro -> F1: SOLO detecta
 *
 * MODO (qualia_config, por empresa con default global):
 *   'server' -> no toca nada: el poller del server sigue siendo el dueno.
 *   'sombra' -> calcula todo pero SOLO escribe qualia_sombra
 *               (clave = trabajo_id+rescate, para diffear contra el server).
 *   'nube'   -> escribe de verdad (libera reservas, dispara pokes).
 *
 * Esta function NO queda agendada aca: el pg_cron lo agenda otra fase.
 */

// ── Umbrales — EXACTOS a los del poller, cada uno pagado con un incidente ────

// Bloque 1: re-aviso de 'pendiente' a los 5 min. En el poller el aviso
// inmediato lo daba el mismo loop; aca el inmediato es el trigger INSERT de
// pg_net y el barrido solo rescata lo que quedo sin claim pasado el umbral.
const UMBRAL_PENDIENTE_S = 300;

// Bloque 2b: 20 minutos. Un analisis normal tarda 1-4 min (foto conflictiva
// incluida): el margen es 5x el peor caso legitimo. Nacio del 2026-08-03,
// cuando 464 respuestas 429 mataron turnos a mitad del analisis y las filas
// quedaron en 'analizando' sin nadie que las mirara.
const UMBRAL_ANALIZANDO_S = 20 * 60;

// Bloque 3: 10 min de gracia (un registro normal tarda ~45s: no pisa un turno
// lento y el sistema se entera antes que el humano).
const UMBRAL_APROBADA_S = 10 * 60;

// Bloque 4: 5 min de gracia para no pisar al turno que esta escribiendo el
// libro ahora mismo.
const UMBRAL_LIBRO_S = 5 * 60;

// Tope de 12 horas, parejo en los barridos del poller: cubre de sobra la
// ventana de 5h del plan de z.AI. Lo que sigue trabado despues de eso no es
// transitorio (falta un dato, el proveedor no se puede crear) y el camino
// correcto es 'error' con motivo — reintentar para siempre daria el mismo
// fallo sin arreglar nada. En el bloque 4 ademas evita despertar por el
// historico entero (las cuatro primeras facturas nunca tuvieron libro).
const TOPE_S = 12 * 3600;

// Contrapresion del bloque 1: cuantos analisis puede tener el contable a la
// vez. Medido el 2026-08-03: con 1 la factura sale en ~3 min; con 3 termina
// una y las otras dos se arrastran; con 18 z.AI devolvio 464 respuestas 429.
// Mismo nombre de knob que el poller para que la calibracion viaje.
const MAX_ANALIZANDO = Number(Deno.env.get('MESA_MAX_ANALIZANDO') ?? '2');

// El poller limitaba cada barrido a 3 filas por tick (limit 3 en los cuatro
// queries): el rescate es goteo, no estampida. Se conserva por empresa.
const LOTE_POR_EMPRESA = 3;

// Techo del SELECT global (el poller era mono-empresa; aca se trae un lote
// razonable y se recorta a LOTE_POR_EMPRESA en memoria).
const LIMITE_SELECT = 200;

const FUNCION = 'qualia-barrido';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Modo = 'server' | 'sombra' | 'nube';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const hace = (segundos: number) => new Date(Date.now() - segundos * 1000).toISOString();
const edadSegundos = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 1000);

// Escalonado del bloque 3: 1a hora cada 10 min, hasta las 4h cada 30 min,
// despues cada hora. Nacio del estreno contra un 1308 ("Usage limit reached
// for 5 hour"): probar cada 10 min y rendirse a las 2h habria quemado diez
// turnos y abandonado las filas justo antes de que la cuota volviera.
function esperaSegunEdad(edadS: number): number {
  if (edadS < 3600) return 600;
  if (edadS < 14400) return 1800;
  return 3600;
}

// Agrupa candidatos por empresa y recorta cada grupo al lote del poller.
function porEmpresa<T extends { empresa_id: string }>(filas: T[]): Map<string, T[]> {
  const grupos = new Map<string, T[]>();
  for (const f of filas) {
    const g = grupos.get(f.empresa_id) ?? [];
    if (g.length < LOTE_POR_EMPRESA) g.push(f);
    grupos.set(f.empresa_id, g);
  }
  return grupos;
}

/**
 * Despierta al turno para una fila que quedó sin dueño. Se usa cuando el
 * registro en ADM se NIEGA: el script del server rechaza el documento y, sin
 * Hermes, nadie más se entera. Falla suave — el próximo barrido reintenta.
 */
async function pokearContable(trabajoId: string, motivo: string): Promise<boolean> {
  const base = Deno.env.get('QUALIA_FUNCTIONS_URL') ??
    `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1`;
  const bearer = await bearerCron();
  if (!base || !bearer) return false;
  try {
    const r = await fetch(`${base}/qualia-contable`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trabajo_id: trabajoId,
        motivo,
        intento: String(Math.floor(Date.now() / 1000)),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    await r.body?.cancel();
    return r.ok;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Metodo no permitido' }, 405);
  if (!(await autorizado(req))) return json({ ok: false, error: 'No autorizado' }, 401);

  const t0 = Date.now();
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    // Entrada externa: se valida antes de usarse. empresa_id opcional acota el
    // barrido a una empresa (util para pruebas); sin el, barre la flota.
    let soloEmpresa: string | null = null;
    if (body.empresa_id !== undefined && body.empresa_id !== null) {
      if (typeof body.empresa_id !== 'string' || !UUID_RE.test(body.empresa_id)) {
        return json({ ok: false, error: 'empresa_id invalido' }, 400);
      }
      soloEmpresa = body.empresa_id;
    }

    const db = sb();

    // El modo se resuelve UNA vez por empresa y por corrida: que una fila del
    // mismo barrido se procese en 'sombra' y la siguiente en 'nube' porque el
    // flag cambio a mitad seria imposible de diffear.
    const modos = new Map<string, Modo>();
    const modoDe = async (empresaId: string): Promise<Modo> => {
      let m = modos.get(empresaId);
      if (!m) {
        m = await modo(empresaId, 'qualia-barrido');
        modos.set(empresaId, m);
      }
      return m;
    };

    // Con empresa explicita en modo server se sale sin leer nada mas: el
    // poller del server es el dueno y esta function no compite con el.
    if (soloEmpresa && (await modoDe(soloEmpresa)) === 'server') {
      return json({ modo: 'server', accion: 'ninguna', empresa_id: soloEmpresa });
    }

    const errores: string[] = [];
    const sombraSegura = async (empresaId: string, clave: string, payload: unknown) => {
      // Una sombra que no se pudo escribir no aborta el barrido, pero tampoco
      // se calla: sin la fila, el diff contra el server mentiria por omision.
      try {
        await registrarSombra(FUNCION, empresaId, clave, payload);
        return true;
      } catch (e) {
        errores.push(`sombra ${clave}: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      }
    };

    // ── Rescate 1: 'pendiente' sin claim mas viejo que el umbral ─────────────
    //
    // Portado del bloque 1 del poller. El aviso de la fila recien nacida lo da
    // el trigger INSERT; aca solo se rescata la que quedo sin claim (el poke
    // murio, o volvio a 'pendiente' por el rescate 2 — el trigger es de INSERT
    // y no la ve). La clave del anti-spam del poller incluia updated_at ("si
    // vuelve a pendiente es una peticion nueva"): por eso el umbral va sobre
    // updated_at, no created_at.
    const rePoke = { candidatos: 0, excluidos_por_evento: 0, sin_cupo: 0, pokes_ok: 0, pokes_fallidos: 0, sombra: 0 };

    let q1 = db.from('qualia_trabajos')
      .select('id, empresa_id, updated_at, created_at')
      .eq('estado', 'pendiente')
      .lt('updated_at', hace(UMBRAL_PENDIENTE_S))
      .order('created_at', { ascending: true })
      .limit(LIMITE_SELECT);
    if (soloEmpresa) q1 = q1.eq('empresa_id', soloEmpresa);
    const { data: pendientes, error: e1 } = await q1;
    if (e1) throw new Error(`leyendo pendientes: ${e1.message}`);

    // Exclusion del bloque 1: una fila con una accion del usuario sin atender
    // NO es trabajo nuevo — la despierta el camino de eventos con motivo
    // accion_usuario. Sin esto salian DOS avisos con segundos de diferencia y
    // corrian dos turnos ciegos entre si (liquidacion DGA fb0c5c71,
    // 2026-08-05). El poller la media contra su watermark en RAM; aca no hay
    // watermark, asi que se aproxima: evento de usuario dentro de la ventana
    // del umbral = el camino de eventos todavia es el responsable. Y
    // `forzar_relectura` NO excluye, a proposito: pedir que vuelva a MIRAR el
    // documento es justo lo que necesita al preparador.
    // TODO(duda): la ventana del poller era "hasta que el evento se entrego"
    // (watermark), no un tiempo fijo; 300s es una aproximacion sin estado. Si
    // en F2 el trigger de eventos deja marca de entrega en la base, cambiar
    // esta exclusion a esa marca.
    let excluidos = new Set<string>();
    if (pendientes && pendientes.length > 0) {
      const ids = pendientes.map((p) => p.id);
      const { data: eventos, error: eEv } = await db.from('qualia_eventos')
        .select('trabajo_id, datos')
        .eq('autor', 'usuario')
        .gte('created_at', hace(UMBRAL_PENDIENTE_S))
        .in('trabajo_id', ids);
      if (eEv) throw new Error(`leyendo eventos de usuario: ${eEv.message}`);
      excluidos = new Set(
        (eventos ?? [])
          .filter((ev) => !(ev.datos && (ev.datos as Record<string, unknown>).forzar_relectura === true))
          .map((ev) => ev.trabajo_id as string),
      );
    }

    const funcionesUrl = Deno.env.get('QUALIA_FUNCTIONS_URL') ?? '';
    const bearer = await bearerCron(); // env o base: el secreto no viaja al deploy

    // La exclusion va ANTES del lote, como en el poller (su not-exists vivia
    // en el SQL): una fila excluida no le come el turno a una elegible.
    const elegibles = (pendientes ?? []).filter((p) => {
      if (excluidos.has(p.id)) { rePoke.excluidos_por_evento++; return false; }
      return true;
    });

    for (const [empresaId, filas] of porEmpresa(elegibles)) {
      const m = await modoDe(empresaId);
      if (m === 'server') continue;

      // Contrapresion del bloque 1: cada poke termina abriendo una llamada al
      // modelo y del otro lado no hay tope. Lo que no entra en el cupo se
      // queda en 'pendiente', que es exactamente donde el proximo barrido lo
      // vuelve a tomar: se pierde velocidad de pico y se gana que TODAS
      // salgan. El conteo de 'analizando' sale fresco de la base; la ventana
      // `despertado` del poller (los pokes en vuelo que aun no reclamaron) no
      // se puede portar sin estado — el claim atomico absorbe el doble aviso,
      // igual que absorbia los del poller.
      const { count, error: eCount } = await db.from('qualia_trabajos')
        .select('id', { count: 'exact', head: true })
        .eq('empresa_id', empresaId)
        .eq('estado', 'analizando');
      if (eCount) throw new Error(`contando analizando: ${eCount.message}`);
      let cupo = Math.max(0, MAX_ANALIZANDO - (count ?? 0));

      for (const fila of filas) {
        rePoke.candidatos++;
        if (cupo <= 0) { rePoke.sin_cupo++; continue; }
        cupo--;

        // El sello 'intento' viene del poke del poller: el webhook viejo tenia
        // cache de idempotencia y dos POST identicos colapsaban en uno — un
        // reintento que se pierde en silencio es lo contrario de un reintento.
        // TODO(duda): el contrato del body con qualia-preparador (F2) hereda
        // la forma del webhook ({trabajo_id, motivo, intento}); confirmarlo
        // cuando el preparador exista.
        const poke = {
          trabajo_id: fila.id,
          motivo: 'trabajo_nuevo',
          intento: String(Math.floor(Date.now() / 1000)),
        };

        if (m === 'sombra') {
          if (await sombraSegura(empresaId, `${fila.id}+re_poke`, {
            rescate: 're_poke',
            trabajo_id: fila.id,
            empresa_id: empresaId,
            edad_s: edadSegundos(fila.updated_at),
            accion: 'poke_preparador',
            poke,
          })) rePoke.sombra++;
          continue;
        }

        // modo 'nube': el poke real, con el mismo timeout que el curl -m 15
        // del poller. Un poke fallido no es error del barrido: la fila sigue
        // 'pendiente' y el proximo barrido la reintenta — esa ES la red.
        if (!funcionesUrl || !bearer) {
          rePoke.pokes_fallidos++;
          errores.push('falta QUALIA_FUNCTIONS_URL o QUALIA_CRON_BEARER para el poke');
          continue;
        }
        try {
          const resp = await fetch(`${funcionesUrl}/qualia-preparador`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${bearer}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(poke),
            signal: AbortSignal.timeout(15_000),
          });
          if (resp.ok) rePoke.pokes_ok++;
          else {
            rePoke.pokes_fallidos++;
            errores.push(`poke ${fila.id}: HTTP ${resp.status}`);
          }
          // El body no se usa: el preparador contesta rapido y trabaja atras.
          await resp.body?.cancel();
        } catch (e) {
          rePoke.pokes_fallidos++;
          errores.push(`poke ${fila.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    // ── Rescate 2: reservas muertas ('analizando' > 20 min) ──────────────────
    //
    // Portado del bloque 2b. Si el turno muere despues del claim, la fila sale
    // del alcance del rescate 1 —que solo mira 'pendiente'— y nadie la toca.
    // Se devuelve a 'pendiente' en vez de avisar al contable, porque el
    // contable es justamente lo que acaba de fallar: el rescate 1 la
    // re-prepara con maquinaria que ya sabemos que funciona.
    //
    // Aca el barrido SI escribe estado — soltar una reserva muerta es
    // infraestructura, no contabilidad — y el UPDATE lleva el MISMO guard de
    // estado + umbral en el WHERE que el poller: hace imposible pisar un turno
    // que revivio mientras tanto. 0 filas actualizadas = otro llego primero,
    // no es error.
    const reservas = { candidatos: 0, liberadas: 0, ya_tomadas: 0, sombra: 0 };

    let q2 = db.from('qualia_trabajos')
      .select('id, empresa_id, updated_at')
      .eq('estado', 'analizando')
      .lt('updated_at', hace(UMBRAL_ANALIZANDO_S))
      .gte('updated_at', hace(TOPE_S))
      .order('updated_at', { ascending: true })
      .limit(LIMITE_SELECT);
    if (soloEmpresa) q2 = q2.eq('empresa_id', soloEmpresa);
    const { data: muertas, error: e2 } = await q2;
    if (e2) throw new Error(`leyendo analizando: ${e2.message}`);

    for (const [empresaId, filas] of porEmpresa(muertas ?? [])) {
      const m = await modoDe(empresaId);
      if (m === 'server') continue;

      for (const fila of filas) {
        reservas.candidatos++;
        const edadMin = Math.floor(edadSegundos(fila.updated_at) / 60);

        if (m === 'sombra') {
          if (await sombraSegura(empresaId, `${fila.id}+reserva_muerta`, {
            rescate: 'reserva_muerta',
            trabajo_id: fila.id,
            empresa_id: empresaId,
            edad_min: edadMin,
            accion: 'volver_a_pendiente',
          })) reservas.sombra++;
          continue;
        }

        const { data: soltada, error: eUpd } = await db.from('qualia_trabajos')
          .update({ estado: 'pendiente' })
          .eq('id', fila.id)
          .eq('empresa_id', empresaId)
          .eq('estado', 'analizando')
          .lt('updated_at', hace(UMBRAL_ANALIZANDO_S))
          .select('id');
        if (eUpd) { errores.push(`liberando ${fila.id}: ${eUpd.message}`); continue; }
        if (soltada && soltada.length > 0) reservas.liberadas++;
        else reservas.ya_tomadas++;
      }
    }

    // ── Rescate 3: 'aprobada' sin docid (reintento escalonado) ───────────────
    //
    // Portado del bloque 3. El agujero que tapa: el aviso llego, el watermark
    // avanzo, y el turno murio DESPUES (2026-08-03: rafaga de 18 aprobaciones,
    // 429 de z.AI, cuatro filas en 'aprobada' sin docid y sin error_detalle —
    // fuera del alcance de todo, destrabadas a mano).
    //
    // En F1 el registrador NO existe: este rescate SOLO detecta y reporta —
    // nada dispara un registro. TODO(F4): cablear el disparo a
    // qualia-registrador cuando nazca, con el claim de registro en la fila
    // (§5-F4) como memoria del ultimo intento; el escalonado del poller vivia
    // en RAM (mapa `avisado`) y sin ese claim el barrido no tiene donde anclar
    // "ya lo intente hace N min". Aca el tier se calcula y viaja en el reporte
    // para que el cableado de F4 herede los numeros exactos.
    //
    // criterio y caso quedan AFUERA como en el poller: viven en 'aprobada' sin
    // docid para siempre (el CHECK de la base exige un DocID que ninguno tiene
    // ni va a tener); sin este corte caerian aca cada 10 minutos durante 12
    // horas pidiendo un registro que no existe. La red del criterio es el
    // rescate 4, por su pata propia; el caso no tiene red, a sabiendas.
    const registro = {
      candidatos: 0,
      sombra: 0,
      pokes_ok: 0,
      pokes_fallidos: 0,
      detectadas: [] as Array<{ trabajo_id: string; empresa_id: string; edad_min: number; espera_min: number }>,
    };

    let q3 = db.from('qualia_trabajos')
      .select('id, empresa_id, tipo, updated_at')
      .eq('estado', 'aprobada')
      .not('tipo', 'in', '("criterio","caso")')
      .is('propuesta->registro_adm->>docid', null)
      .lt('updated_at', hace(UMBRAL_APROBADA_S))
      .gte('updated_at', hace(TOPE_S))
      .order('updated_at', { ascending: true })
      .limit(LIMITE_SELECT);
    if (soloEmpresa) q3 = q3.eq('empresa_id', soloEmpresa);
    const { data: sinDocid, error: e3 } = await q3;
    if (e3) throw new Error(`leyendo aprobadas sin docid: ${e3.message}`);

    for (const [empresaId, filas] of porEmpresa(sinDocid ?? [])) {
      const m = await modoDe(empresaId);
      if (m === 'server') continue;

      for (const fila of filas) {
        registro.candidatos++;
        const edadS = edadSegundos(fila.updated_at);
        const esperaS = esperaSegunEdad(edadS);
        registro.detectadas.push({
          trabajo_id: fila.id,
          empresa_id: empresaId,
          edad_min: Math.floor(edadS / 60),
          espera_min: Math.floor(esperaS / 60),
        });

        if (m === 'sombra') {
          if (await sombraSegura(empresaId, `${fila.id}+registro_reintento`, {
            rescate: 'registro_reintento',
            trabajo_id: fila.id,
            empresa_id: empresaId,
            tipo: fila.tipo,
            edad_s: edadS,
            espera_s: esperaS,
            accion: 'reintentar_registro_adm', // lo que hace el poller hoy; en la nube recien en F4
          })) registro.sombra++;
        } else if (esperaS > 0 && edadS >= esperaS) {
          // NUBE: el registro en ADM sigue siendo del poller (F4 lo mueve acá),
          // pero cuando su script se NIEGA —"no cuadra con el documento", un
          // proveedor sin RNC, una cuenta que no existe— la fila queda en
          // 'aprobada' sin docid y sin dueño: el poller ya no despierta a nadie
          // (Hermes no existe) y el turno no se entera solo.
          //
          // Pasó con la factura de Guan Lan el 2026-08-17: aprobada, el
          // registrador la rechazó por 69,79 de diferencia en el ITBIS, y se
          // quedó quieta hasta que un humano la miró. Acá se le avisa al turno,
          // que es quien puede corregir las líneas o preguntar.
          if (await pokearContable(fila.id, 'registro_pendiente')) registro.pokes_ok++;
          else registro.pokes_fallidos++;
        }
      }
    }

    // ── Rescate 4: 'registrada' / criterio ratificado sin entrada de libro ───
    //
    // Portado del bloque 4, la contracara del registro directo: 'registrada'
    // es terminal y ningun otro barrido la mira nunca mas, pero el libro es lo
    // unico que quedo del lado del contable y se pierde igual que se perdia un
    // registro — en la web la fila se ve perfecta y la decision no quedo
    // asentada en ningun lado.
    //
    // El criterio entra por su pata propia (estado 'aprobada'): su terminal no
    // es 'registrada' —el CHECK exige un DocID que una regla no tiene— y sin
    // esta pata un precedente que el dueno cree haber ratificado no existe en
    // ningun lado. Fallar aca es fail-safe: la memoria pasa a 'ratificado'
    // recien al final, asi que una ratificacion que no se escribio deja el
    // archivo en 'borrador' — y un borrador no se cita jamas.
    //
    // La marca de cierre es la fila en qualia_libro — no una clave inventada
    // dentro de propuesta: un is-null que nadie apaga no es condicion de
    // salida, es un bucle.
    //
    // En F1 los remedios no existen (la plantilla del libro llega con el
    // registrador en F4; el poke al contable por criterio, con qualia-contable
    // en F3): SOLO detecta y reporta. TODO(F3/F4): cablear plantilla_libro y
    // poke accion_usuario; el throttle de 30 min por fila del poller (mapa
    // `avisado` en RAM) se hereda en ese cableado, no aca.
    const libro = {
      candidatos: 0,
      sombra: 0,
      detectadas: [] as Array<{ trabajo_id: string; empresa_id: string; tipo: string }>,
    };

    let q4 = db.from('qualia_trabajos')
      .select('id, empresa_id, tipo, estado, updated_at')
      .or('and(tipo.neq.criterio,estado.eq.registrada),and(tipo.eq.criterio,estado.eq.aprobada)')
      .lt('updated_at', hace(UMBRAL_LIBRO_S))
      .gte('updated_at', hace(TOPE_S))
      .order('updated_at', { ascending: true })
      .limit(LIMITE_SELECT);
    if (soloEmpresa) q4 = q4.eq('empresa_id', soloEmpresa);
    const { data: cerradas, error: e4 } = await q4;
    if (e4) throw new Error(`leyendo registradas/criterios: ${e4.message}`);

    // El not-exists contra qualia_libro, en dos pasos (PostgREST no anti-junta).
    let conLibro = new Set<string>();
    if (cerradas && cerradas.length > 0) {
      const { data: entradas, error: eLib } = await db.from('qualia_libro')
        .select('trabajo_id')
        .in('trabajo_id', cerradas.map((c) => c.id));
      if (eLib) throw new Error(`leyendo qualia_libro: ${eLib.message}`);
      conLibro = new Set((entradas ?? []).map((l) => l.trabajo_id as string));
    }
    const sinLibro = (cerradas ?? []).filter((c) => !conLibro.has(c.id));

    for (const [empresaId, filas] of porEmpresa(sinLibro)) {
      const m = await modoDe(empresaId);
      if (m === 'server') continue;

      for (const fila of filas) {
        libro.candidatos++;
        libro.detectadas.push({ trabajo_id: fila.id, empresa_id: empresaId, tipo: fila.tipo });

        if (m === 'sombra') {
          if (await sombraSegura(empresaId, `${fila.id}+sin_libro`, {
            rescate: 'sin_libro',
            trabajo_id: fila.id,
            empresa_id: empresaId,
            tipo: fila.tipo,
            // El criterio pide accion_usuario y NO escribir_libro: esa rama
            // arranca afirmando "el documento YA ESTA en ADM", que es la
            // descripcion exacta de lo que un criterio no es (bloque 4).
            accion: fila.tipo === 'criterio' ? 'poke_contable_accion_usuario' : 'plantilla_libro',
          })) libro.sombra++;
        }
      }
    }

    // ── Resumen ──────────────────────────────────────────────────────────────
    const modosResueltos: Record<string, Modo> = {};
    for (const [k, v] of modos) modosResueltos[k] = v;

    return json({
      ok: true,
      funcion: FUNCION,
      empresa_id: soloEmpresa,
      modos: modosResueltos,
      rescates: {
        re_poke: rePoke,
        reservas_muertas: reservas,
        registro_reintento: registro,
        sin_libro: libro,
      },
      errores,
      duracion_ms: Date.now() - t0,
    });
  } catch (e) {
    return json({
      ok: false,
      funcion: FUNCION,
      error: e instanceof Error ? e.message : String(e),
      duracion_ms: Date.now() - t0,
    }, 500);
  }
});
