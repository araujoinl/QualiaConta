import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { sb, modo } from '../_shared/db.ts';
import { autorizado } from '../_shared/auth.ts';
import { registrarSombra } from '../_shared/sombra.ts';

/**
 * Edge Function: qualia-salud
 *
 * Port fiel de dos scripts del server (F1 del plan de salida de Hermes):
 *   - mesa/alerta-salud.sh  — cola sin decidir, plata sin documento, archivos
 *     congelados. Nació de la auditoría del 2026-08-14: cuatro fallas
 *     independientes con cero alertas.
 *   - mesa/alerta-cuota.sh  — tope de cuota de z.AI por empresa y saldo del
 *     respaldo OpenRouter. Nació del tope mudo del 2026-08-03 (13:54–15:45).
 *
 * Reglas heredadas que NO se negocian:
 *   - Avisa SOLO en los cruces (sano→roto, roto→sano). Una cola vieja que dura
 *     una semana es UN mensaje, no siete. El que recibe cientos de mensajes
 *     iguales deja de leerlos.
 *   - Primera corrida de una clave: se registra el estado y no se avisa, para
 *     no disparar un WhatsApp por instalar la función.
 *   - No toca nada del bus: mira y avisa. Arreglar lo que encuentre es decisión
 *     de un humano.
 *   - El estado anterior (los archivos $ESTADO del server) pasa a
 *     qualia_config, empresa_id null, clave 'salud_estado' — un mapa plano
 *     clave→estado, mismo formato tabulado de los .sh pero en jsonb. Se
 *     reemplaza entero y sólo al final: si algo falló a mitad, el estado viejo
 *     sigue siendo el bueno y la próxima corrida reintenta.
 *   - El canal de aviso es EL MISMO del server: POST a WsNotify
 *     ${WSNOTIFY_BASE_URL}/v1/messages con el payload idéntico
 *     (priority high + bypass_window: es transaccional, no marketing).
 *
 * Los dos .sh tienen cadencias distintas A PROPÓSITO (un tope de cuota es un
 * evento y hay que saberlo al instante; una cola de nueve días es un estado y
 * preguntarle cada dos minutos manda cientos de mensajes iguales). Por eso el
 * body acepta `alcance`: 'salud' | 'cuota' | 'todo' (default 'todo'), para que
 * pg_cron pueda agendar la parte cuota más seguido que la diaria. NADA queda
 * agendado acá: el pg_cron lo agenda otra fase.
 *
 * MODO (qualia_config clave='modo'):
 *   server → no hace nada (el cron viejo del server sigue siendo el dueño;
 *            correr los dos duplicaría avisos).
 *   sombra → calcula todo y los avisos que MANDARÍA van a qualia_sombra.
 *   nube   → avisa de verdad por WsNotify.
 *
 * El log a archivo de los .sh pasa a los logs de la función (console).
 */

const FUNCION = 'qualia-salud';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Umbrales. Se cambian por secret/env sin tocar el archivo — mismos nombres y
// defaults que los .sh.
//
// 5 días para la cola: el p50 medido era 9 días y el objetivo son 48 horas, así
// que 5 avisa antes de que se vuelva crónico sin sonar por un fin de semana
// largo. 48 horas para los archivos: el refresco es diario, así que dos vueltas
// perdidas ya es un patrón y no un tropiezo. 3 dólares para el respaldo.
const COLA_DIAS = Number(Deno.env.get('QUALIA_COLA_DIAS') ?? 5);
const ARCHIVO_HORAS = Number(Deno.env.get('QUALIA_ARCHIVO_HORAS') ?? 48);
const SALDO_MINIMO = Number(Deno.env.get('OPENROUTER_SALDO_MINIMO') ?? 3);

// Claves de la sección salud (las del archivo .qualia-alerta-salud del server).
// Las de la sección cuota son UUIDs de empresa + '__saldo_or__' (las del
// archivo .qualia-alerta-cuota): no pueden colisionar entre sí.
const CLAVES_SALUD = [
  'cola_vieja',
  'movimientos_huerfanos',
  'precedentes_congelados',
  'cuentas_congeladas',
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esClaveCuota = (k: string) => k === '__saldo_or__' || UUID_RE.test(k);

type Modo = 'server' | 'sombra' | 'nube';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Idéntico al tr del .sh: sin backslash, sin comillas dobles, saltos de línea a
// espacio. En TS el JSON.stringify ya protege, pero el texto se sanea igual
// para que el mensaje sea byte a byte el mismo que manda el server — es lo que
// permite diffear la sombra contra su log.
function sanear(texto: string): string {
  return texto.replace(/[\\"]/g, '').replace(/\n/g, ' ');
}

// Hora dominicana para el mensaje: el que lo recibe no piensa en UTC.
function horaRd(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Santo_Domingo',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// Aviso por WhatsApp vía WsNotify — el mecanismo exacto de los .sh, con los
// mismos secrets. bypass_window: el humano necesita saberlo AHORA, no en la
// ventana de envío. La API key jamás se loggea.
async function avisarWhatsApp(texto: string): Promise<'enviado' | 'sin_config' | 'error'> {
  const base = Deno.env.get('WSNOTIFY_BASE_URL');
  const apiKey = Deno.env.get('WSNOTIFY_API_KEY');
  const destino = Deno.env.get('WSNOTIFY_OTP_DESTINO');
  if (!base || !apiKey || !destino) {
    console.log('no puedo avisar: faltan WSNOTIFY_* en los secrets');
    return 'sin_config';
  }
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: destino,
        sender: 'QualiaConta',
        text: texto,
        priority: 'high',
        bypass_window: true,
        origin: 'trigger',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.log(`ERROR: no pude enviar el aviso (http ${res.status})`);
      return 'error';
    }
    console.log(`aviso enviado: ${texto}`);
    return 'enviado';
  } catch (e) {
    console.log(`ERROR: no pude enviar el aviso (${(e as Error).message})`);
    return 'error';
  }
}

// PostgREST corta en ~1000 filas por default; sin esto un listado grande se
// trunca EN SILENCIO y el conteo sale bajo — justo el tipo de mentira que esta
// función existe para evitar.
// deno-lint-ignore no-explicit-any
async function paginar<T>(arma: (desde: number, hasta: number) => any): Promise<T[]> {
  const PAGINA = 1000;
  const filas: T[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await arma(desde, desde + PAGINA - 1);
    if (error) throw new Error(error.message ?? String(error));
    filas.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGINA) break;
  }
  return filas;
}

/**
 * El vigía: acumula el estado nuevo y habla sólo en los cruces. Equivalente a
 * revisar() del .sh, generalizado para que sirva a los estados si/no de salud
 * y a los libre/topado de cuota.
 */
class Vigia {
  nuevo: Record<string, string> = {};
  avisos: Array<{ clave: string; de: string; a: string; via: string }> = [];

  constructor(
    private previo: Record<string, string>,
    private modoActual: Modo,
  ) {}

  async cruce(
    clave: string,
    estado: string,
    textos: Partial<Record<string, string>>,
    empresaId: string | null = null,
  ): Promise<void> {
    const antes = this.previo[clave];
    this.nuevo[clave] = estado;

    // Primera corrida: se registra y no se avisa.
    if (antes === undefined) {
      console.log(`estado inicial de ${clave}: ${estado}`);
      return;
    }
    if (antes === estado) return;

    const texto = textos[estado];
    if (texto) {
      const seguro = sanear(texto);
      if (this.modoActual === 'nube') {
        const via = await avisarWhatsApp(seguro);
        this.avisos.push({ clave, de: antes, a: estado, via });
      } else {
        // sombra: el aviso que MANDARÍA va a qualia_sombra. La clave de dedup
        // identifica el cruce y el día — el mismo cruce visto dos veces en el
        // día colapsa, y contra el log del server se diffea por texto.
        const dia = new Date().toISOString().slice(0, 10);
        await registrarSombra(FUNCION, empresaId, `${dia}:${clave}:${antes}->${estado}`, {
          clave,
          de: antes,
          a: estado,
          texto: seguro,
        });
        this.avisos.push({ clave, de: antes, a: estado, via: 'sombra' });
      }
    }
    console.log(`${clave}: ${antes} -> ${estado}`);
  }

  // Cuando un chequeo no pudo correr, su clave arrastra el valor anterior en
  // vez de olvidarlo: sin esto un fallo transitorio borra la memoria y el
  // aviso del cruce nunca sale. (Es el principio declarado de los .sh; ojo:
  // alerta-salud.sh tenía el accidente de que un psql caído caía en la rama
  // "sano" — acá se porta el principio, no el accidente.)
  arrastrar(claves: string[]): void {
    for (const k of claves) {
      if (k in this.previo && !(k in this.nuevo)) this.nuevo[k] = this.previo[k];
    }
  }
}

// ---------------------------------------------------------------- sección salud

// deno-lint-ignore no-explicit-any
async function revisarCola(supabase: any, v: Vigia): Promise<Record<string, unknown>> {
  // Propuestas sin decidir y su antigüedad. El monto va en el mensaje porque es
  // lo que convierte "hay cosas pendientes" en "hay dos millones y medio
  // parados". Se trae la lista y se agrega acá (PostgREST no agrega libre);
  // redondeos calcados del SQL original: ::int y round() = mitad hacia arriba.
  try {
    const filas = await paginar<{ created_at: string; monto: string | null }>(
      (desde, hasta) =>
        supabase
          .from('qualia_trabajos')
          .select('created_at, monto:propuesta->>monto')
          .eq('estado', 'propuesta')
          .range(desde, hasta),
    );
    const ahora = Date.now();
    const n = filas.length;
    const dias = n === 0 ? 0 : Math.round(
      Math.max(...filas.map((f) => (ahora - new Date(f.created_at).getTime()) / 1000)) / 86400,
    );
    const monto = Math.round(
      filas.reduce((s, f) => s + Math.abs(Number(f.monto ?? 0) || 0), 0),
    );

    if (dias >= COLA_DIAS) {
      await v.cruce('cola_vieja', 'si', {
        si: `Hay ${n} propuestas esperando decisión en la mesa; la más vieja lleva ${dias} días y entre todas suman RD$${monto}. Nada se registra hasta que las decidas.`,
      });
    } else {
      await v.cruce('cola_vieja', 'no', {
        no: `La cola de la mesa volvió a estar al día: nada esperando más de ${COLA_DIAS} días.`,
      });
    }
    return { n, dias, monto };
  } catch (e) {
    console.log(`cola: consulta falló (${(e as Error).message}); arrastro el estado previo`);
    v.arrastrar(['cola_vieja']);
    return { error: 'consulta fallida' };
  }
}

// deno-lint-ignore no-explicit-any
async function revisarHuerfanos(supabase: any, v: Vigia): Promise<Record<string, unknown>> {
  // Plata que se cayó de ADM y quedó sola. El aviso NO es "se anuló un
  // documento": anular es normal y casi siempre es el paso previo a registrar
  // bien. Lo que importa es el movimiento que quedó SIN ningún documento vivo
  // que lo ampare — ahí sí hay plata fuera de la contabilidad. La distinción se
  // midió el 2026-08-14: de 55 movimientos de trabajos con documento muerto,
  // los 55 ya estaban amparados por el consolidado que los reemplazó.
  //
  // Es el CTE del .sh partido en dos pasos (trabajos muertos → sus movimientos
  // → cuáles siguen sin qualia_trabajo_id). Fiel al fuente: sólo mira las
  // llaves `banco_tx_id` y `movimientos[]` de la propuesta — NO las otras tres
  // formas de reclamo del contrato de la mesa (origen/destino, banco_tx_ids[]).
  // TODO: confirmar con Carlos si una transferencia muerta (que reclama por
  // banco_tx_ids[]) debería entrar acá; el .sh no la miraba.
  try {
    const muertos = await paginar<{
      registro: { anulado_en?: string; eliminado_en?: string } | null;
      banco_tx_id: string | null;
      movimientos: unknown;
    }>((desde, hasta) =>
      supabase
        .from('qualia_trabajos')
        .select('registro:propuesta->registro_adm, banco_tx_id:propuesta->>banco_tx_id, movimientos:propuesta->movimientos')
        .not('propuesta->registro_adm', 'is', null)
        .range(desde, hasta)
    );

    const txs = new Set<string>();
    for (const m of muertos) {
      const r = m.registro ?? {};
      if (!(r.anulado_en || r.eliminado_en)) continue; // vivo: sigue reclamando
      if (m.banco_tx_id) txs.add(m.banco_tx_id);
      if (Array.isArray(m.movimientos)) {
        for (const tx of m.movimientos) if (typeof tx === 'string') txs.add(tx);
      }
    }

    // El SQL original casteaba tx::uuid y un valor basura reventaba la consulta
    // ENTERA (y el fallo se leía como sano). Acá lo basura se filtra y se
    // loggea, que es lo que el cast quería decir.
    const validos = [...txs].filter((tx) => UUID_RE.test(tx));
    if (validos.length < txs.size) {
      console.log(`huerfanos: ${txs.size - validos.length} tx con id no-uuid ignorados`);
    }

    let huerfanos = 0;
    for (let i = 0; i < validos.length; i += 200) {
      const { count, error } = await supabase
        .from('openbanking_transactions')
        .select('id', { count: 'exact', head: true })
        .in('id', validos.slice(i, i + 200))
        .is('qualia_trabajo_id', null);
      if (error) throw new Error(error.message);
      huerfanos += count ?? 0;
    }

    if (huerfanos > 0) {
      await v.cruce('movimientos_huerfanos', 'si', {
        si: `Se cayeron documentos de ADM y ${huerfanos} movimiento(s) del banco quedaron sin ningún papel que los cubra. Esa plata está fuera de la contabilidad hasta que se rehaga.`,
      });
    } else {
      await v.cruce('movimientos_huerfanos', 'no', {
        no: 'Ya no queda plata del banco sin documento por documentos caídos.',
      });
    }
    return { huerfanos };
  } catch (e) {
    console.log(`huerfanos: consulta falló (${(e as Error).message}); arrastro el estado previo`);
    v.arrastrar(['movimientos_huerfanos']);
    return { error: 'consulta fallida' };
  }
}

// deno-lint-ignore no-explicit-any
async function revisarRefrescos(supabase: any, v: Vigia): Promise<Record<string, unknown>> {
  // Los archivos que se enfrían. Un archivo que deja de actualizarse no rompe
  // nada visible: el contable sigue contestando, sólo que con datos viejos. Es
  // la falla más cara de detectar y la más barata de vigilar.
  //
  // En el server esto era la fecha de modificación de dos archivos del volumen
  // de Hermes. En la nube no hay filesystem: la marca pasa a qualia_config
  // (empresa null) — claves 'refresco_precedentes' y 'refresco_cuentas', valor
  // {"en": "<iso>"}. Marca ausente = roto, igual que archivo inexistente.
  //
  // TODO: las functions que porten refrescar-precedentes.sh y el espejo del
  // plan de cuentas (misma F1) deben escribir su marca al terminar en verde.
  // Hasta que existan, esto queda en "si" desde la primera corrida y NO avisa
  // (regla de primera corrida); al arrancar los refrescadores va a salir UN
  // aviso de "volvió a actualizarse" — benigno y de una sola vez.
  // TODO multiempresa (F5): la marca es global; con dos empresas el agregado de
  // precedentes es por empresa y la clave necesitará empresa_id.
  try {
    const { data, error } = await supabase
      .from('qualia_config')
      .select('clave, valor')
      .is('empresa_id', null)
      .in('clave', ['refresco_precedentes', 'refresco_cuentas']);
    if (error) throw new Error(error.message);

    const marcas: Record<string, string | null> = {};
    for (const fila of data ?? []) marcas[fila.clave] = fila.valor?.en ?? null;

    const edadHoras = (iso: string | null): number | null => {
      if (!iso) return null;
      const t = new Date(iso).getTime();
      if (Number.isNaN(t)) return null;
      return Math.floor((Date.now() - t) / 3_600_000);
    };
    const vencido = (edad: number | null) => edad === null || edad >= ARCHIVO_HORAS;

    const edadPrec = edadHoras(marcas['refresco_precedentes'] ?? null);
    await v.cruce('precedentes_congelados', vencido(edadPrec) ? 'si' : 'no', {
      si: `La libreta de precedentes del contable lleva ${edadPrec ?? '?'} horas sin actualizarse. De ahí saca la cuenta de cada factura: con la libreta vieja, un proveedor nuevo le sale como desconocido aunque ya tenga historia en ADM.`,
      no: 'La libreta de precedentes volvió a actualizarse.',
    });

    const edadCtas = edadHoras(marcas['refresco_cuentas'] ?? null);
    await v.cruce('cuentas_congeladas', vencido(edadCtas) ? 'si' : 'no', {
      si: `El espejo del plan de cuentas lleva ${edadCtas ?? '?'} horas sin refrescarse. El contable no puede proponer una cuenta creada después de esa fecha, y el síntoma es el peor: no falla, elige la más parecida.`,
      no: 'El espejo del plan de cuentas volvió a refrescarse.',
    });
    return { precedentes_horas: edadPrec, cuentas_horas: edadCtas };
  } catch (e) {
    console.log(`refrescos: consulta falló (${(e as Error).message}); arrastro el estado previo`);
    v.arrastrar(['precedentes_congelados', 'cuentas_congeladas']);
    return { error: 'consulta fallida' };
  }
}

// deno-lint-ignore no-explicit-any
async function revisarLibro(supabase: any): Promise<Record<string, unknown>> {
  // Chequeo nuevo del plan §4.5: cuadre diario del libro — conteo y refs de
  // qualia_libro contra el árbol real del repo. En F1 todavía no hay API de
  // GitHub en la nube, así que acá sólo se levanta el lado tabla (conteo total
  // y filas sin ref_git) y se deja el gancho listo.
  try {
    const { count: total, error: e1 } = await supabase
      .from('qualia_libro')
      .select('id', { count: 'exact', head: true });
    if (e1) throw new Error(e1.message);
    const { count: sinRef, error: e2 } = await supabase
      .from('qualia_libro')
      .select('id', { count: 'exact', head: true })
      .is('ref_git', null);
    if (e2) throw new Error(e2.message);

    // TODO F3: cuadre real contra git. Cuando exista el token fine-grained
    // (§4.6) y el escritor del libro por API de GitHub, esto compara el conteo
    // y cada ref_git contra el árbol del repo y cruza como los demás chequeos:
    //
    // const arbol = await listarArbolLibro(); // GET /repos/{repo}/git/trees/... (contents:read)
    // const refs = await paginar(... select ref_git not null ...);
    // const faltanEnGit = refs.filter((r) => !arbol.has(r));
    // const faltanEnTabla = [...arbol].filter((r) => !refs.includes(r));
    // await v.cruce('libro_descuadrado',
    //   (faltanEnGit.length || faltanEnTabla.length || (sinRef ?? 0) > 0) ? 'si' : 'no', {
    //   si: `El libro de acción no cuadra con git: ${faltanEnGit.length} entrada(s) de la tabla sin archivo y ${faltanEnTabla.length} archivo(s) sin fila. La auditoría por diff está incompleta hasta cuadrarlo.`,
    //   no: 'El libro de acción volvió a cuadrar con git.',
    // });

    return { total: total ?? 0, sin_ref_git: sinRef ?? 0, cuadre_git: 'TODO F3' };
  } catch (e) {
    console.log(`libro: consulta falló (${(e as Error).message})`);
    return { error: 'consulta fallida' };
  }
}

// ---------------------------------------------------------------- sección cuota

// deno-lint-ignore no-explicit-any
async function revisarCuota(supabase: any, v: Vigia): Promise<Record<string, unknown>> {
  // NO vuelve a sondear a z.AI: la fila de qualia_servicio es la única fuente
  // de verdad de "estamos topados". Dos detectores del mismo hecho se
  // contradicen. (Hoy la escribe el poller del server; en F2 la hereda el freno
  // central de _shared/llm.ts — esta función no cambia.)
  const { data, error } = await supabase
    .from('qualia_servicio')
    .select('empresa_id, cuota_bloqueada_hasta');

  if (error || !data || data.length === 0) {
    // Igual que el .sh: sin filas no se cambia nada — se arrastra TODA la
    // sección para no borrar la memoria de los cruces.
    console.log('la consulta de cuota no devolvió filas (¿base inalcanzable?); no cambio nada');
    v.arrastrar(Object.keys(vPrevio(v)).filter(esClaveCuota));
    return { error: 'sin filas' };
  }

  const ahora = Date.now();
  const estados: Record<string, string> = {};
  for (const fila of data as Array<{ empresa_id: string; cuota_bloqueada_hasta: string | null }>) {
    if (!fila.empresa_id) continue;

    // Topado = hay hora Y todavía no llegó. Una hora ya vencida es libre: el
    // dueño de la fila la limpia en su próximo ciclo, pero el aviso no espera.
    let estado = 'libre';
    if (fila.cuota_bloqueada_hasta) {
      const hasta = new Date(fila.cuota_bloqueada_hasta).getTime();
      if (!Number.isNaN(hasta) && hasta > ahora) estado = 'topado';
    }
    estados[fila.empresa_id] = estado;

    // El mensaje NO dice "está caído" a propósito: desde que la cadena termina
    // en OpenRouter, un tope de z.AI ya no detiene nada — ni el chat ni la cola
    // de facturas. Lo único que cambia es que la inferencia pasa a cobrarse por
    // token, y eso es exactamente lo que hay que avisar. Un aviso que exagera
    // el problema se termina ignorando.
    await v.cruce(fila.empresa_id, estado, {
      topado: `z.AI se topó hasta las ${horaRd(fila.cuota_bloqueada_hasta ?? '')}. El contable sigue trabajando normal —chat y facturas— pero por el respaldo de OpenRouter, que se cobra por token. No hay nada que hacer; es sólo para que sepas que ese rato cuesta.`,
      libre: 'z.AI volvió. El contable salió del respaldo pagado.',
    }, fila.empresa_id);
  }
  return { empresas: estados };
}

async function revisarSaldoOpenRouter(v: Vigia): Promise<Record<string, unknown>> {
  // El saldo de OpenRouter es el respaldo: si llega a cero, la red de seguridad
  // no existe y nadie se entera hasta el próximo tope de z.AI. Se consulta
  // SIEMPRE, no sólo durante un tope: enterarse de que el respaldo está vacío
  // justo cuando hace falta es enterarse tarde.
  let saldo: number | null = null;
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (apiKey) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/credits', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const d = (await res.json())?.data;
        if (d && typeof d.total_credits === 'number' && typeof d.total_usage === 'number') {
          saldo = Math.round((d.total_credits - d.total_usage) * 10_000) / 10_000;
        }
      }
    } catch {
      // se maneja abajo como lectura fallida
    }
  }

  if (saldo === null) {
    // Si no se pudo leer, se arrastra el valor anterior en vez de olvidarlo:
    // sin esto una lectura que falla borra la memoria y el aviso del cruce
    // nunca sale.
    console.log('no pude leer el saldo de OpenRouter');
    v.arrastrar(['__saldo_or__']);
    return { saldo: null };
  }

  const bajo = saldo < SALDO_MINIMO ? 'si' : 'no';
  await v.cruce('__saldo_or__', bajo, {
    si: `El respaldo de OpenRouter va quedando corto: quedan US$${saldo}. Si llega a cero, el próximo tope de z.AI deja al contable mudo otra vez.`,
    no: `Respaldo de OpenRouter recargado: US$${saldo} disponibles.`,
  });
  return { saldo, bajo };
}

// El Vigia guarda `previo` privado; para arrastrar la sección cuota entera hace
// falta ver sus claves. Accessor mínimo en vez de exponer el campo.
function vPrevio(v: Vigia): Record<string, string> {
  // deno-lint-ignore no-explicit-any
  return (v as any).previo ?? {};
}

// -------------------------------------------------------------------- handler

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!(await autorizado(req))) return json({ error: 'no autorizado' }, 401);
  if (req.method !== 'POST') return json({ error: 'Metodo no permitido' }, 405);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const alcance = String(body.alcance ?? 'todo');
    if (!['todo', 'salud', 'cuota'].includes(alcance)) {
      return json({ error: `alcance invalido: ${alcance}` }, 400);
    }

    // El modo se lee del default global (empresa null): la salud vigila el
    // sistema entero, no una empresa — igual que los .sh, que corrían una vez
    // para todas. En 'server' no se hace NADA, ni siquiera leer estado: el cron
    // viejo del server sigue siendo el único dueño de los avisos.
    const modoActual = await modo(null);
    if (modoActual === 'server') {
      return json({ modo: 'server', accion: 'ninguna' });
    }

    const supabase = sb();

    // Estado anterior. En sombra TAMBIÉN se persiste al final: sin memoria
    // propia no hay cruce que registrar en qualia_sombra ni nada que diffear
    // contra el server — y la clave 'salud_estado' es memoria exclusiva de esta
    // función, no toca el bus. Al pasar a nube, los cruces ya vienen calibrados.
    const { data: filaEstado, error: errEstado } = await supabase
      .from('qualia_config')
      .select('id, valor')
      .is('empresa_id', null)
      .eq('clave', 'salud_estado')
      .maybeSingle();
    if (errEstado) throw new Error(`leyendo salud_estado: ${errEstado.message}`);

    const previo: Record<string, string> = {};
    if (filaEstado?.valor && typeof filaEstado.valor === 'object') {
      for (const [k, val] of Object.entries(filaEstado.valor as Record<string, unknown>)) {
        if (typeof val === 'string') previo[k] = val;
      }
    }

    const v = new Vigia(previo, modoActual);
    const salida: Record<string, unknown> = {};

    if (alcance === 'todo' || alcance === 'salud') {
      salida.cola = await revisarCola(supabase, v);
      salida.huerfanos = await revisarHuerfanos(supabase, v);
      salida.refrescos = await revisarRefrescos(supabase, v);
      salida.libro = await revisarLibro(supabase);
    } else {
      v.arrastrar(CLAVES_SALUD);
    }

    if (alcance === 'todo' || alcance === 'cuota') {
      salida.cuota = await revisarCuota(supabase, v);
      salida.saldo_openrouter = await revisarSaldoOpenRouter(v);
    } else {
      v.arrastrar(Object.keys(previo).filter(esClaveCuota));
    }

    // Se reemplaza entero y sólo al final: si algo reventó antes de llegar acá,
    // el estado viejo sigue siendo el bueno y la próxima corrida reintenta.
    const ahoraIso = new Date().toISOString();
    if (filaEstado?.id) {
      const { error } = await supabase
        .from('qualia_config')
        .update({ valor: v.nuevo, actualizado_en: ahoraIso, actualizado_por: FUNCION })
        .eq('id', filaEstado.id);
      if (error) throw new Error(`guardando salud_estado: ${error.message}`);
    } else {
      const { error } = await supabase
        .from('qualia_config')
        .insert({ empresa_id: null, clave: 'salud_estado', valor: v.nuevo, actualizado_por: FUNCION });
      if (error) throw new Error(`guardando salud_estado: ${error.message}`);
    }

    console.log(
      `revisión terminada (alcance=${alcance}, modo=${modoActual}, avisos=${v.avisos.length})`,
    );
    return json({ modo: modoActual, alcance, avisos: v.avisos, salida });
  } catch (e) {
    console.log(`ERROR: ${(e as Error).message}`);
    return json({ error: (e as Error).message }, 500);
  }
});
