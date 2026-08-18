// Facturas recurrentes — port fiel de
// empresas/blackbox/hermes/scripts/sugerir-recurrentes.sh (cron de Hermes,
// CERO tokens).
//
// Reporta el ESTADO del mes de cada proveedor que factura todos los meses: la
// que llegó y la que no. El riesgo de la caja es AVISAR DE MÁS: si avisa por
// el supermercado, se aprende a ignorarla y deja de servir para el caso que
// importa. Por eso los cortes siguen intactos y el rechazo es para siempre.
//
// LOS DOS CORTES, calibrados contra las 1.103 facturas reales (2026-08-04):
//   facturas por mes <= 1,3   Un servicio factura una vez al mes; la gasolina
//                             factura cinco. Sólo mata a SHELL (5,26), AXXON
//                             (4,84), TUPAQ (6,30) y los restaurantes.
//   dispersión del día <= 7   El supermercado pasa el corte anterior (1,25)
//                             pero cae acá con 7,7: comprás cualquier día del
//                             mes. Un servicio cae siempre en la misma fecha.
// LO QUE NO SIRVE COMO FILTRO: la regularidad del monto. Humano Seguros varía
// un 50% mes a mes porque cambia la nómina, y es el recurrente más claro.
//
// APRENDE DEL RECHAZO: si avisó por algo que no correspondía y lo rechazaste,
// ese proveedor no vuelve a aparecer nunca. Y DESDE EL 2026-08-06 APRENDE DEL
// ALTA: los de `qualia_proveedores_vigilados` se saltean LOS TRES cortes
// (Emprendia factura la regencia todos los meses y falla DOS de los tres).
//
// Y LOS CORTES SÓLO SE APLICAN UNA VEZ. Un proveedor que ya entró a la caja no
// se vuelve a juzgar: sale de ahí por el rechazo y por nada más. Son cortes
// para DESCUBRIR; usados todos los días, el proveedor desaparece en silencio
// en cuanto una factura rara le mueve la estadística (Claro, 2026-08-06: 20
// meses facturando el día 4, afuera por una anulada del 31/07).
//
// LA IDENTIDAD ES EL RelationshipID, NUNCA EL NOMBRE: Claro aparece con SIETE
// grafías distintas. El nombre es etiqueta, no llave.
//
// CORRE TODOS LOS DÍAS y es idempotente: una fila por proveedor y período; si
// el estado cambió (llegó, se pagó, moneda) la fila se ACTUALIZA — sin eso, un
// «no llegó» de principio de mes se quedaba mintiendo hasta fin de mes.

import { registrarSombra } from '../_shared/sombra.ts';
import {
  Cliente,
  ConteoDetector,
  conteoVacio,
  descargarEspejo,
  filasJsonlEstricta,
  fmtMonto,
  hoyRD,
  Modo,
  paginar,
  pyRound,
  pyRoundN,
} from './comun.ts';

const MESES_MINIMOS = 6; // sin media docena de meses no hay patrón, hay casualidad
const MAX_POR_MES = 1.3;
const MAX_DISPERSION = 7.0;

const c2 = (x: unknown): number => pyRoundN(Number(x ?? 0), 2);

interface FacturaMes {
  fecha: string;
  monto: number;
  moneda: string;
  docid: string | null;
  uuid: string | null;
  pagada: boolean;
  aplicado: number;
}

const mediana = (xs: number[]): number => {
  const orden = [...xs].sort((a, b) => a - b);
  const mitad = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[mitad] : (orden[mitad - 1] + orden[mitad]) / 2;
};

// statistics.pstdev: desviación estándar POBLACIONAL (divide por N).
const pstdev = (xs: number[]): number => {
  const media = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - media) ** 2, 0) / xs.length);
};

export async function detectarRecurrentes(
  cliente: Cliente,
  empresaId: string,
  modo: Modo,
  opciones: { hoy?: string } = {},
): Promise<ConteoDetector> {
  // El día se mira en hora de RD: el contenedor corría en UTC y después de las
  // 20:00 AST `date +%F` daba el día siguiente — y acá el día del mes decide
  // si ya toca avisar. `opciones.hoy` es el QUALIA_HOY del fuente (probar).
  const hoy = opciones.hoy ?? hoyRD();
  const periodo = hoy.slice(0, 7);
  const diaHoy = Number(hoy.slice(8, 10));
  const avisos: string[] = [];

  // ── Lo ya emitido y lo ya rechazado ───────────────────────────────────────
  // El rechazo es PARA SIEMPRE y por proveedor, no por mes. `emitidas` trae el
  // id y el estado guardado para poder ACTUALIZAR la fila cuando la factura
  // llega después de reportada como ausente. Se indexa por proveedor_id, la
  // llave estable; las filas viejas no lo tienen y se reconocen por nombre.
  const filasEmitidas = await paginar<{ id: string; propuesta: Record<string, unknown>; estado: string }>(
    (d, h) =>
      cliente
        .from('qualia_trabajos')
        .select('id, propuesta, estado')
        .eq('empresa_id', empresaId)
        .eq('propuesta->>clase', 'factura_faltante')
        .order('id')
        .range(d, h),
  );

  const rechazados = new Set<string>();
  // Todos los que ALGUNA VEZ entraron a la caja, de cualquier período: los
  // cortes no tienen nada que decidir sobre ellos — eso ya se decidió. De la
  // caja se sale por UNA sola puerta, que es el rechazo tuyo.
  const conocidos = new Set<string>();
  const emitidas = new Map<string, {
    id: string;
    llego: boolean;
    pagada: boolean;
    moneda: string;
    aldia: boolean;
  }>();
  for (const fila of filasEmitidas) {
    const p = fila.propuesta ?? {};
    const prov = ((p.proveedor_id ?? p.proveedor) as string) ?? null;
    if (fila.estado === 'rechazada') {
      if (prov != null) rechazados.add(prov);
      continue;
    }
    if (prov == null) continue;
    conocidos.add(prov);
    if (p.periodo === periodo) {
      emitidas.set(prov, {
        id: fila.id,
        llego: Boolean(p.llego),
        pagada: Boolean(p.pagada),
        moneda: (p.moneda as string) ?? 'DOP',
        // `propuesta ? 'monto_tipico'`: PRESENCIA de la llave, aunque sea null
        // — distingue las filas de la versión vieja que sólo emitía ausencias.
        aldia: 'monto_tipico' in p,
      });
    }
  }

  const filasVigilados = await paginar<{ proveedor_id: string }>((d, h) =>
    cliente
      .from('qualia_proveedores_vigilados')
      .select('proveedor_id')
      .eq('empresa_id', empresaId)
      .order('proveedor_id')
      .range(d, h)
  );
  const vigilados = new Set(filasVigilados.map((v) => v.proveedor_id));

  // ── El nombre CANÓNICO sale del catálogo, no de la factura ────────────────
  // El Beneficiary es texto libre y cambia entre facturas del mismo proveedor.
  // Sin catálogo se sigue con el Beneficiary: peor nombre, no menos filas.
  const canonicos = new Map<string, string>();
  const textoVendors = await descargarEspejo(cliente, empresaId, 'vendors.jsonl');
  if (textoVendors !== null) {
    for (const fila of filasJsonlEstricta(textoVendors)) {
      const d = ((fila.data ?? fila) as Record<string, unknown>);
      const ident = (d.ID ?? d.RelationshipID) as string | undefined;
      const nombre = String(d.Name ?? '').trim();
      if (ident && nombre) canonicos.set(ident, nombre);
    }
  }

  // ── Las facturas del histórico ────────────────────────────────────────────
  const textoBills = await descargarEspejo(cliente, empresaId, 'vendor-bills-detalle.jsonl');
  if (textoBills === null) {
    throw new Error('no puedo leer el espejo vendor-bills-detalle.jsonl del bucket');
  }
  const facturas = new Map<string | null, FacturaMes[]>();
  const nombres = new Map<string | null, string>();
  let sinFecha = 0;
  for (const fila of filasJsonlEstricta(textoBills)) {
    // Borrada en ADM: no existe más, y contarla es contar una factura que
    // nadie puede abrir. Es distinto de anulada (ésa sigue en ADM con Void).
    // La FP00001120 se borró el 2026-08-04 y seguía contando acá.
    if (fila._eliminado) continue;
    const d = ((fila.data ?? {}) as Record<string, unknown>);
    if (d.Void) continue;
    // Una línea puede quedar sin fecha: cuando ADM contesta un sobre de error
    // o un detalle vacío, la línea se escribe igual sin los campos que este
    // loop daba por seguros. Fallar acá no saltearía UN documento: mataba el
    // detector entero, que quedaba mostrando la corrida anterior — o sea
    // diciendo «no llegó» sobre una factura que ya llegó, justo la mentira que
    // esta caja existe para evitar (pasó dos veces la noche del 2026-08-06).
    const fecha = d.DocDate;
    if (typeof fecha !== 'string' || fecha.length < 10) {
      sinFecha++;
      continue;
    }
    const p = (d.RelationshipID as string) ?? null;
    if (!nombres.has(p)) nombres.set(p, (d.Beneficiary as string) || '?');
    const total = c2(d.TotalAmount);
    const aplicado = c2(d.AppliedPayments);
    const lista = facturas.get(p) ?? [];
    lista.push({
      fecha: fecha.slice(0, 10),
      monto: total,
      // TotalAmount viene en la moneda del documento, no en pesos: la
      // FP00001122 de Account One son US$637,20 y la caja mostraba RD$637,20.
      moneda: (d.CurrencyID as string) || 'DOP',
      docid: (d.DocID as string) ?? null,
      // El DocID es para leer, el UUID es para linkear: abre el documento en
      // ADM y engancha sus adjuntos en Storage (ahí se llama TransactionID).
      uuid: (d.ID as string) ?? null,
      // Pagada = lo aplicado cubre el total. Los centavos se toleran porque el
      // total sale de un numeric y el aplicado se acumula pago a pago. En 0 es
      // impaga, no «sin dato»: el campo viene poblado en 890 de las 1.103.
      pagada: total > 0 && aplicado >= total - 0.005,
      aplicado,
    });
    facturas.set(p, lista);
  }
  // Se dice el número aunque salteando uno no pase nada: uno es la respuesta
  // rara de ADM que se repara sola; cuarenta es el volcado roto y una caja
  // calculada sobre la mitad de las facturas — que se ve igual de sana.
  if (sinFecha) avisos.push(`${sinFecha} documento(s) sin fecha en el volcado, salteado(s)`);

  // Un vigilado recién puesto puede no tener NINGUNA factura en el histórico
  // (un contrato que arranca este mes): se le crea la entrada vacía para que
  // el loop lo vea.
  for (const prov of vigilados) {
    if (!facturas.has(prov)) facturas.set(prov, []);
  }

  // ── La caja ───────────────────────────────────────────────────────────────
  const inserts: { prov: string | null; resumen: string; propuesta: Record<string, unknown> }[] = [];
  const updates: { prov: string | null; id: string; resumen: string; propuesta: Record<string, unknown> }[] = [];

  for (const [prov, fs] of facturas) {
    const nombre = (prov != null ? canonicos.get(prov) : undefined) ?? nombres.get(prov) ?? '?';
    // PONERLO A VIGILAR PERDONA EL RECHAZO, y por eso se mira primero. Rechazar
    // borra el vigilado en la misma acción (la mesa lo hace al confirmar), así
    // que un vigilado vivo sólo puede haberse puesto DESPUÉS del rechazo: es la
    // decisión más reciente y la más explícita de las dos. Sin esto el rechazo
    // era una puerta sin retorno que ninguna pantalla mostraba — el 2026-08-18
    // se rechazó a Claro, se lo volvió a vigilar 15 segundos después, y el
    // detector siguió salteándolo en silencio.
    const vigilado = prov != null && vigilados.has(prov);
    if (!vigilado && ((prov != null && rechazados.has(prov)) || rechazados.has(nombre))) {
      continue; // dijiste que no. Nunca más — salvo que lo pongas a vigilar.
    }
    // Ya está en la caja: entró alguna vez y no lo rechazaste. Vale lo mismo
    // que el alta a mano, y por eso se saltea los tres cortes igual.
    const conocido = (prov != null && conocidos.has(prov)) || conocidos.has(nombre);
    const meses = [...new Set(fs.map((f) => f.fecha.slice(0, 7)))].sort();
    const dias = fs.map((f) => Number(f.fecha.slice(8, 10)));
    const dispersion = dias.length > 1 ? pstdev(dias) : 0.0;

    // Los tres cortes existen para DESCUBRIR un patrón donde nadie lo declaró.
    // Sobre un vigilado o un conocido no tienen nada que decidir. Se saltean
    // los tres y no sólo el de meses, porque el caso que motivó todo (Emprendia)
    // falla dos.
    if (!vigilado && !conocido) {
      if (meses.length < MESES_MINIMOS) continue;
      if (fs.length / meses.length > MAX_POR_MES) continue; // factura seguido: es compra, no servicio
      if (dispersion > MAX_DISPERSION) continue;            // cae cualquier día: no es un contrato
    }

    fs.sort((a, b) => a.fecha.localeCompare(b.fecha));
    const delmes = fs.filter((f) => f.fecha.slice(0, 7) === periodo);
    const llego = delmes.length > 0;

    // Sin una sola factura previa no hay día ni monto que estimar, y NO se
    // inventan: con dia_habitual en null la fila nunca se declara vencida.
    const diaHabitual = dias.length ? pyRound(mediana(dias)) : null;
    const margen = Math.max(3, pyRound(dispersion));
    // El margen YA NO decide si la fila existe, sino si la ausencia es un
    // problema: los recurrentes se muestran desde el día 1 y el margen se
    // guarda en `vencido` (false = todavía puede llegar).
    const vencido = diaHabitual !== null && diaHoy >= Math.min(28, diaHabitual + margen);

    // La fila va con la fecha en que ESTE proveedor factura, no con la de la
    // corrida. Se recorta al último día del mes (quien factura el 31 no tiene
    // 31 en febrero); sin día conocido, el último del mes — ordena la fila al
    // final de la caja y no la da por atrasada.
    const [anio, mes] = [Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7))];
    const ultimoDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    const diaEsperado = diaHabitual ? Math.min(diaHabitual, ultimoDelMes) : ultimoDelMes;
    const fechaEsperada = `${periodo}-${String(diaEsperado).padStart(2, '0')}`;

    // En qué moneda factura: la de su última factura. Convertir a pesos no es
    // opción: el volcado no trae la tasa del día de cada factura.
    const moneda = fs.length ? fs[fs.length - 1].moneda : 'DOP';
    const sig = moneda === 'USD' ? 'US$' : 'RD$';

    // Lo que suele costar: mediana-alta de los últimos seis, no promedio (un
    // mes atípico —la nómina de diciembre en Humano— corre el promedio). Sólo
    // los de SU moneda: una mediana entre 637 dólares y 19.000 pesos no es un
    // monto típico de nada.
    const montos = fs.filter((f) => f.moneda === moneda).map((f) => f.monto).slice(-6)
      .sort((a, b) => a - b);
    const tipico = montos.length ? montos[Math.floor(montos.length / 2)] : null;

    const propuesta: Record<string, unknown> = {
      clase: 'factura_faltante',
      metodo: 'script',
      proveedor: nombre,
      proveedor_id: prov,
      periodo,
      fecha: fechaEsperada,
      fecha_esperada: fechaEsperada,
      moneda,
      direccion: 'cargo',
      confianza: 0.7,
      llego,
      vencido,
      // Quién lo puso en la caja: al descubierto se le cree el patrón, a éste
      // lo sostiene una persona — dos cosas distintas frente a una fila que sobra.
      vigilado_manual: vigilado,
      dia_habitual: diaHabitual,
      // SIEMPRE presente —también en la que ya llegó—: es contra esto que se
      // mira si el monto de este mes se salió de lo normal. Y su PRESENCIA es
      // la marca de fila al día (`aldia`).
      monto_tipico: tipico,
      // La fila la escribe el proveedor y la lee la pantalla: el nombre no se
      // repite en `descripcion` (antes el mismo dato se veía dos veces).
      descripcion: nombre,
      historial: {
        meses: meses.length,
        facturas: fs.length,
        por_mes: meses.length ? pyRoundN(fs.length / meses.length, 2) : 0,
        dia_habitual: diaHabitual,
        dispersion_dia: pyRoundN(dispersion, 1),
      },
    };

    let resumen: string;
    if (llego) {
      const u = delmes[delmes.length - 1];
      Object.assign(propuesta, {
        // La que llegó vale por el día en que facturó de verdad: ahí ya no hay
        // nada que estimar.
        fecha: u.fecha,
        monto: u.monto,
        pagada: u.pagada,
        // Cuánto se salió de lo normal, con signo. Se guarda el número y no el
        // veredicto para que el umbral se pueda mover en la pantalla sin
        // re-emitir las filas ya escritas.
        desvio: tipico ? pyRoundN((u.monto - tipico) / tipico, 4) : 0,
        factura: {
          docid: u.docid, uuid: u.uuid, fecha: u.fecha,
          monto: u.monto, moneda: u.moneda, pagada: u.pagada,
        },
        detalle: `Ya facturó ${periodo}: ${u.docid} del ${u.fecha} por ` +
          `${sig}${fmtMonto(u.monto)} (${u.pagada ? 'pagada' : 'sin pagar'}). ` +
          `Suele costar ${sig}${fmtMonto(tipico!)}. Factura ${meses.length} de los últimos ` +
          `meses, siempre alrededor del día ${diaHabitual}.`,
      });
      resumen = `${nombre} facturó ${periodo} (${u.docid})`;
    } else if (vencido) {
      Object.assign(propuesta, {
        monto: tipico,
        detalle: `Facturó ${meses.length} de los últimos meses, siempre alrededor del día ` +
          `${diaHabitual}, por unos ${sig}${fmtMonto(tipico!)}. De ${periodo} no hay ninguna y ` +
          `hoy es ${diaHoy}. Si no corresponde, rechazala con el motivo: no vuelvo ` +
          `a avisar por este proveedor.`,
      });
      resumen = `No llegó la factura de ${nombre} (${periodo})`;
    } else if (fs.length === 0) {
      // Vigilado a mano y sin una sola factura en todo el histórico: la fila
      // existe para que veas que lo estás siguiendo, y dice eso y nada más.
      Object.assign(propuesta, {
        monto: null,
        detalle: `Lo pusiste a vigilar y todavía no tiene ninguna factura registrada en ` +
          `ADM, así que no hay con qué estimarle el día ni el monto habitual. ` +
          `De ${periodo} tampoco hay ninguna.`,
      });
      resumen = `${nombre} todavía no facturó nunca`;
    } else {
      // Todavía en ventana. Se muestra igual pero NO se pide decidir nada: no
      // hay ausencia que reclamar sobre una factura que aún no debía llegar.
      Object.assign(propuesta, {
        monto: tipico,
        detalle: `Factura ${meses.length} de los últimos meses, alrededor del día ` +
          `${diaHabitual}, por unos ${sig}${fmtMonto(tipico!)}. De ${periodo} todavía no hay ` +
          `ninguna, pero hoy es ${diaHoy}: está dentro de su fecha habitual.`,
      });
      resumen = `${nombre} todavía no facturó ${periodo}`;
    }
    resumen = resumen.slice(0, 200);

    const ya = (prov != null ? emitidas.get(prov) : undefined) ?? emitidas.get(nombre);
    if (ya === undefined) {
      inserts.push({ prov, resumen, propuesta });
    } else if (
      ya.llego !== llego ||
      ya.pagada !== Boolean(propuesta.pagada) ||
      ya.moneda !== moneda ||
      !ya.aldia
    ) {
      // Cuando el estado CAMBIÓ, o cuando la fila viene de la versión que sólo
      // emitía ausencias (sin `monto_tipico`). Fuera de esos casos no se toca:
      // reescribirla todos los días movería updated_at sin que haya pasado
      // nada y la mesa lo leería como actividad del contable.
      // PAGARLA TAMBIÉN ES UN CAMBIO DE ESTADO: la factura llega impaga y se
      // paga días después (la FP00001076 de Humano seguía mostrándose impaga).
      // Y la MONEDA está acá para que las filas escritas cuando el script la
      // clavaba en pesos se corrijan solas, sin ir a tocarlas a mano.
      updates.push({ prov, id: ya.id, resumen, propuesta });
    }
  }

  if (inserts.length === 0 && updates.length === 0) return conteoVacio(avisos);

  if (modo === 'sombra') {
    // Sólo qualia_sombra: la llave natural es proveedor + período.
    for (const f of inserts) {
      await registrarSombra('qualia-sugerencias', empresaId,
        `recurrentes:${f.prov ?? '?'}:${periodo}`,
        { accion: 'insertar', resumen: f.resumen, propuesta: f.propuesta });
    }
    for (const f of updates) {
      await registrarSombra('qualia-sugerencias', empresaId,
        `recurrentes:${f.prov ?? '?'}:${periodo}`,
        { accion: 'actualizar', id: f.id, resumen: f.resumen, propuesta: f.propuesta });
    }
    return {
      detectadas: inserts.length + updates.length,
      sembradas: 0,
      actualizadas: 0,
      avisos,
    };
  }

  if (inserts.length) {
    const { error } = await cliente.from('qualia_trabajos').insert(
      inserts.map((f) => ({
        empresa_id: empresaId,
        tipo: 'sugerencia',
        origen: 'cron_conciliacion',
        estado: 'propuesta',
        resumen: f.resumen,
        propuesta: f.propuesta,
      })),
    );
    if (error) throw new Error(`insert qualia_trabajos: ${error.message}`);
  }
  for (const f of updates) {
    const { error } = await cliente
      .from('qualia_trabajos')
      .update({ resumen: f.resumen, propuesta: f.propuesta })
      .eq('id', f.id);
    if (error) throw new Error(`update qualia_trabajos ${f.id}: ${error.message}`);
  }

  return {
    detectadas: inserts.length + updates.length,
    sembradas: inserts.length,
    actualizadas: updates.length,
    avisos,
  };
}
