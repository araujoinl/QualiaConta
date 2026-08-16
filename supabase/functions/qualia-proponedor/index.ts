import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

/**
 * Edge Function: qualia-proponedor
 *
 * Port fiel de mesa/proponer-directo.py (el proponedor determinista del
 * 2026-08-07) al pipeline serverless — plan-salida-hermes §4 y §5-F2.
 *
 * Recibe {trabajo_id}, lee el dossier que qualia-preparador dejó en el caché
 * del bucket (NO lo rearma: sin dossier responde falta_preparador y el
 * re-poke vuelve después), corre las compuertas deterministas del fuente
 * EXACTAS y, si TODAS pasan, arma la propuesta con UNA llamada de
 * clasificación. Cualquier duda degrada a turno — preferimos el camino caro
 * al camino equivocado (regla del dueño 2026-08-02: el precedente es un
 * default POR ITEM, no un sello a ciegas).
 *
 * Modo (qualia_config 'modo', resuelto por empresa — y la empresa nace
 * SIEMPRE de qualia_trabajos.empresa_id, jamás del documento; §4.6):
 *   'server' → no se toca NADA ni se gasta cuota: el poller del server es el
 *              dueño del claim. Salida temprana.
 *   'sombra' → se calcula TODO (la llamada de clasificación incluida — gasto
 *              presupuestado al freno, plan §5-F2 letra b) pero lo único que
 *              se escribe es qualia_sombra con clave=trabajo_id, para diffear
 *              contra la propuesta real del server. La degradación a turno
 *              también se registra (degradado=true, motivo). Sin claim y sin
 *              guard de estado: la fila es del server y puede haber avanzado.
 *   'nube'   → claim atómico pendiente→analizando ANTES de la llamada,
 *              propuesta + evento con el guard de estado exacto del fuente,
 *              y soltar (best effort) si algo degrada después del claim.
 *
 * Body (POST, JSON): { trabajo_id: uuid }
 */

import { modo, sb } from '../_shared/db.ts';
import { autorizado } from '../_shared/auth.ts';
import { registrarSombra } from '../_shared/sombra.ts';
import {
  descargarJson,
  descargarJsonFresco,
  descargarTexto,
  RUTA_AGG_TIPO_GASTO,
  rutaAggPlanCuentas,
  rutaAggProveedorCuentas,
  rutaDossier,
  rutaMemoriaProveedores,
  rutaTexto,
  subirClasificacion,
} from './espejos.ts';
import {
  armarPropuesta,
  bloqueMemoria,
  buscarEnAgg,
  type Camino,
  compuertasDossier,
  type Dic,
  DOMINANTE_MIN,
  esDic,
  MUESTRA_MIN,
  nombresDeCuentas,
  NoPropone,
  numeroF,
  RATIO_INTRA_MIN,
  ratioIntraDocumento,
  tipoGastoDominante,
  validarLineas,
  VERSION,
} from './compuertas.ts';
import { clasificar, promptClasificacion } from './clasificacion.ts';

const FUNCION = 'qualia-proponedor';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (!(await autorizado(req))) {
    return json({ error: 'no autorizado' }, 401);
  }

  let body: Dic = {};
  try {
    body = ((await req.json()) ?? {}) as Dic;
  } catch {
    // sin body: el 400 de abajo lo dice mejor que un error de parseo
  }
  const trabajoId = String(body.trabajo_id ?? '');
  // Mismo cinturón del fuente: lo que no parece UUID no llega a una consulta.
  if (!/^[0-9a-f-]{36}$/.test(trabajoId)) {
    return json({ error: 'trabajo_id invalido: no es un UUID' }, 400);
  }

  // Sello de frescura del preparador (ver descargarJsonFresco): Storage no
  // garantiza leer-lo-recién-escrito y sin esto se analiza un dossier viejo.
  const dossierEn = typeof body.dossier_en === 'string' ? body.dossier_en : null;

  try {
    return await atender(trabajoId, dossierEn);
  } catch (e) {
    // El error duro del fuente (exit 1): también cae a sesión — quien re-poke
    // (trigger o barrido) lo ve como fallo y la fila queda donde estaba (o el
    // rescate de 'analizando' envejecido la suelta).
    const detalle = e instanceof Error ? e.message : String(e);
    console.error(`${FUNCION} ${trabajoId}: ${detalle}`);
    return json({ funcion: FUNCION, trabajo_id: trabajoId, error: detalle }, 500);
  }
});

async function atender(trabajoId: string, dossierEn: string | null = null): Promise<Response> {
  const fila = await leerFila(trabajoId);
  if (!fila) {
    return json(
      { funcion: FUNCION, trabajo_id: trabajoId, accion: 'sin_fila', motivo: 'sin fila para ese trabajo' },
      404,
    );
  }
  // §4.6 del plan: empresa_id nace SIEMPRE de la fila que escribió la web,
  // jamás de la salida del LLM ni del documento.
  const empresaId = fila.empresa_id;
  const m = await modo(empresaId, 'qualia-proponedor');
  const base = { funcion: FUNCION, trabajo_id: trabajoId, empresa_id: empresaId, modo: m };

  if (m === 'server') {
    // El server sigue siendo el dueño: esta function no toca nada.
    return json({ ...base, accion: 'ninguna' });
  }

  if (m === 'sombra') {
    // Dedup de la sombra: el barrido re-poke a 'pendiente' cada pocos minutos
    // mientras el server no reclame, y cada corrida acá gasta UNA llamada de
    // clasificación. En modo real ese papel lo cumple el claim atómico; en
    // sombra no hay claim, así que la propia fila de qualia_sombra (misma
    // clave = mismo trabajo) hace de candado. Si el check falla, se sigue:
    // el insert final es el producto y ése sí truena si no puede.
    const { data } = await sb()
      .from('qualia_sombra')
      .select('id')
      .eq('funcion', FUNCION)
      .eq('clave', trabajoId)
      .limit(1);
    if (data && data.length > 0) {
      return json({ ...base, accion: 'sombra_ya_registrada' });
    }
  }

  const salidaDebug: Dic = { version: VERSION, trabajo: trabajoId };
  try {
    if (fila.tipo !== 'factura') {
      throw new NoPropone(`tipo '${fila.tipo}': el proponedor solo sabe de facturas`);
    }
    // El guard de estado solo aplica cuando VAMOS a escribir (el fuente lo
    // salteaba en --simular; la sombra es ese mismo caso: la fila es del
    // server y pudo avanzar mientras tanto).
    if (m === 'nube' && fila.estado !== 'pendiente') {
      throw new NoPropone(`estado '${fila.estado}': solo se propone sobre pendiente`);
    }

    const d = await descargarJsonFresco(rutaDossier(trabajoId), dossierEn);
    if (!d) {
      // El dossier lo arma el preparador; este proponedor NO lo rearma.
      // 424: quien re-poke vuelve cuando el preparador haya corrido.
      return json(
        {
          ...base,
          accion: 'falta_preparador',
          motivo: `sin dossier legible en ${rutaDossier(trabajoId)}`,
        },
        424,
      );
    }

    // El rescate de texto_path del fuente, versión bucket: la ruta del
    // dossier es del contenedor del server; acá el equivalente es texto.txt
    // junto al dossier. Si el preparador dejó el texto inline (extr.texto),
    // también sirve. Si no hay nada, se quita: la compuerta de "sin renglones
    // ni texto" decide con la verdad.
    const extr0 = esDic(d.extraccion) ? d.extraccion : {};
    let texto: string | null = null;
    if (typeof extr0.texto === 'string' && extr0.texto !== '') {
      texto = extr0.texto;
    } else if (extr0.texto_path) {
      texto = await descargarTexto(rutaTexto(trabajoId));
    }

    const { extr, rnc } = compuertasDossier(d, texto !== null);

    const agg = await descargarJson(rutaAggProveedorCuentas(empresaId));
    if (!agg) throw new NoPropone('agg proveedor-cuentas.json no montado o ilegible');
    const prov = buscarEnAgg(agg, rnc);
    if (!prov) throw new NoPropone(`proveedor nuevo: RNC ${rnc} sin historico`);
    const facturas = Number(prov.facturas ?? 0);
    if (facturas < MUESTRA_MIN) {
      throw new NoPropone(`muestra insuficiente (${Math.trunc(facturas)} factura(s) historicas)`);
    }
    const cuentasProv = Array.isArray(prov.cuentas) ? (prov.cuentas as Dic[]) : [];
    if (cuentasProv.length === 0) throw new NoPropone('proveedor sin cuentas en el agg');
    let camino: Camino;
    if (Number(cuentasProv[0]?.pct ?? 0) >= DOMINANTE_MIN) {
      camino = 'precedente';
    } else if (ratioIntraDocumento(prov) >= RATIO_INTRA_MIN) {
      camino = 'multi';
    } else {
      // Sin dominante Y cada factura entera a una cuenta: el criterio de
      // reparto vive FUERA del documento (¿flete corriente o importación en
      // curso?) y ningún clasificador lo saca del papel. A sesión.
      throw new NoPropone(
        `multi entre documentos (ratio ${ratioIntraDocumento(prov).toFixed(2)}): ` +
          'el reparto depende de contexto que no esta en el papel',
      );
    }
    salidaDebug.camino = camino;
    salidaDebug.proveedor = prov.nombre ?? null;

    const memoriaMd = await descargarTexto(rutaMemoriaProveedores(empresaId));
    const memoria = bloqueMemoria(memoriaMd, rnc, prov.nombre);
    if (memoria && memoria.includes('AMBIGUO')) {
      throw new NoPropone('la memoria marca AMBIGUO a este proveedor: nunca en autonomo');
    }

    const tipoGasto = tipoGastoDominante(await descargarJson(RUTA_AGG_TIPO_GASTO), rnc);
    if (!tipoGasto) throw new NoPropone('tipo de gasto 606 sin dominante para este RNC');

    const nombres = nombresDeCuentas(await descargarJson(rutaAggPlanCuentas(empresaId)));
    if (Object.keys(nombres).length === 0) {
      throw new NoPropone('plan-cuentas.json no montado o ilegible');
    }

    // El claim va ANTES de la llamada (15-30s): mientras clasificamos, la web
    // muestra 'analizando' y nadie más toma la fila. Si de acá en adelante
    // algo degrada, se suelta y el poke sigue su camino de siempre.
    if (m === 'nube') {
      if (!(await claim(trabajoId, empresaId))) {
        // Otro proceso la tomó: no es un error nuestro, es la carrera
        // funcionando. Silencio y afuera.
        return json({ ...base, accion: 'claim_perdido' });
      }
    }

    let propuesta: Dic;
    let resumen: string;
    let conf: number;
    try {
      const propina = numeroF(extr.propina);
      const prompt = promptClasificacion(extr, prov, camino, memoria, propina, texto);
      const { datos, modeloUsado } = await clasificar(empresaId, prompt);
      const v = validarLineas(datos, prov, extr, nombres, camino);
      conf = v.conf;
      const armada = armarPropuesta(extr, prov, v.lineas, conf, camino, tipoGasto, modeloUsado, rnc);
      propuesta = armada.propuesta;
      resumen = armada.resumen;
    } catch (e) {
      if (m === 'nube' && e instanceof NoPropone) await soltar(trabajoId, empresaId);
      throw e;
    }

    if (m === 'sombra') {
      // El producto de la sombra: la propuesta que SE HABRÍA escrito, con la
      // clave de dedup del contrato (trabajo_id) para diffear contra la que
      // escriba el server. Si este insert falla, truena — una sombra callada
      // es el falso verde que la fase no se puede permitir.
      await registrarSombra(FUNCION, empresaId, trabajoId, {
        ...salidaDebug,
        propone: true,
        resumen,
        propuesta,
      });
      return json({ ...base, accion: 'propuso_sombra', camino, resumen });
    }

    const evento = `⚡ Propuesta armada sin sesión LLM (${
      camino === 'precedente' ? 'precedente' : 'reparto entre cuentas conocidas'
    }): ${resumen}. Renglones validados contra el histórico del proveedor; ` +
      `confianza ${conf.toFixed(2)}. Revisá el desglose y aprobá o corregí.`;
    await escribirPropuesta(trabajoId, empresaId, propuesta, resumen, evento);
    await subirClasificacion(trabajoId, { ...salidaDebug, propone: true });
    return json({ ...base, accion: 'propuso', camino, resumen });
  } catch (e) {
    if (!(e instanceof NoPropone)) throw e;
    // El NO_PROPONE del fuente (exit 3): que lo vea la sesión. La fila no se
    // toca (si hubo claim ya se soltó arriba).
    const motivos = [e.message];
    const salida: Dic = { ...salidaDebug, propone: false, motivos };
    if (m === 'sombra') {
      // La degradación también es dato del diff: el server debió degradar
      // igual, y una sombra sin esta fila se leería como "no corrió".
      await registrarSombra(FUNCION, empresaId, trabajoId, {
        ...salida,
        degradado: true,
        motivo: motivos.join('; '),
      });
    } else {
      // nube: el rastro para la sesión que herede el trabajo (cortesía, no
      // contrato — port de clasificacion.json en /tmp/mesa/<id>/).
      await subirClasificacion(trabajoId, salida);
    }
    return json({ ...base, accion: 'no_propone', motivos });
  }
}

// ── la fila en el bus ───────────────────────────────────────────────────────

async function leerFila(
  trabajoId: string,
): Promise<{ estado: string; tipo: string; empresa_id: string } | null> {
  const { data, error } = await sb()
    .from('qualia_trabajos')
    .select('estado, tipo, empresa_id')
    .eq('id', trabajoId)
    .limit(1);
  if (error) throw new Error(`leyendo qualia_trabajos: ${error.message}`);
  if (!data || data.length === 0) return null;
  return data[0] as { estado: string; tipo: string; empresa_id: string };
}

/** Claim atómico pendiente→analizando, guard exacto del fuente. */
async function claim(trabajoId: string, empresaId: string): Promise<boolean> {
  const { data, error } = await sb()
    .from('qualia_trabajos')
    .update({ estado: 'analizando' })
    .eq('id', trabajoId)
    .eq('empresa_id', empresaId)
    .eq('estado', 'pendiente')
    .select('id');
  if (error) throw new Error(`claim de ${trabajoId}: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Devuelve la fila a pendiente si el claim era nuestro. Best effort: si esto
 * falla, la red de reservas muertas (>20 min, hoy poller y qualia-barrido) la
 * rescata. */
async function soltar(trabajoId: string, empresaId: string): Promise<void> {
  try {
    const { error } = await sb()
      .from('qualia_trabajos')
      .update({ estado: 'pendiente' })
      .eq('id', trabajoId)
      .eq('empresa_id', empresaId)
      .eq('estado', 'analizando');
    if (error) console.error(`soltar ${trabajoId}: ${error.message}`);
  } catch (e) {
    console.error(`soltar ${trabajoId}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** analizando→propuesta con la propuesta y el resumen, y el evento de
 * progreso para la web — guard de estado exacto del fuente. */
async function escribirPropuesta(
  trabajoId: string,
  empresaId: string,
  propuesta: Dic,
  resumen: string,
  evento: string,
): Promise<void> {
  const { data, error } = await sb()
    .from('qualia_trabajos')
    .update({ estado: 'propuesta', propuesta, resumen })
    .eq('id', trabajoId)
    .eq('empresa_id', empresaId)
    .eq('estado', 'analizando')
    .select('id');
  if (error) throw new Error(`escribiendo propuesta: ${error.message}`);
  if ((data ?? []).length === 0) {
    // El morir() del fuente: error duro, no un motivo de sesión — la fila
    // cambió de manos a mitad del claim y acá no se pisa nada.
    throw new Error('la fila cambio de estado a mitad del claim: no escribo');
  }
  const { error: errEvento } = await sb()
    .from('qualia_eventos')
    .insert({ trabajo_id: trabajoId, autor: 'contable', tipo: 'progreso', contenido: evento });
  if (errEvento) {
    // La propuesta (la sustancia) ya quedó escrita; el fuente moría acá con
    // el mismo efecto observable. El retry no duplica: el claim ya no matchea.
    throw new Error(`propuesta escrita pero el evento fallo: ${errEvento.message}`);
  }
}
