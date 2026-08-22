// qualia-espejo — el alimentador del espejo de ADM, portado del server
// (mesa/refrescar-recurrentes.sh + mesa/refrescar-precedentes.sh, muertos con
// CodeBox el 2026-08-20).
//
// Tres trabajos, no uno:
//
//  1. INCREMENTAL (cada hora) — trae al espejo las facturas que ADM tiene y el
//     espejo no. El detector de recurrentes (qualia-sugerencias) NO le pregunta
//     a ADM: lee `espejo-adm/<empresa>/vendor-bills-detalle.jsonl`. Sin esto la
//     caja diría «todavía no facturó» horas después de que la factura entró.
//
//  2. RELECTURA (de madrugada) — vuelve a leer el detalle de las facturas
//     recientes. El paso 1 es ciego a las CORRECCIONES: solo mira IDs que no
//     conoce, así que una factura que la contadora arregla en ADM se queda
//     vieja en el espejo para siempre. Pasó y costó caro: la comisión de
//     FREEWAY (FP00001068) se corrigió en ADM el 2026-08-20 y el espejo siguió
//     diciendo 611.02 dos días después. ADM no expone fecha de modificación
//     —solo CreationDate—, así que no hay «traeme lo que cambió»: se relee una
//     ventana por fecha del documento.
//
//  3. DESTILADO (de madrugada, después de la relectura) — regenera los agg que
//     lee el PROPONEDOR. Ojo: el proponedor no lee el bundle del contable, lee
//     estos archivos. Los destilaba el server y al apagarlo nadie los volvió a
//     correr: quedaron clavados en 2026-08-20T05:20Z. Ver destilar.ts.
//
// Por qué la madrugada: regla del dueño — todo escrito masivo va a las 02:00 RD
// (06:00 UTC), nunca en horario de uso. El cron ya existente es horario (`5 * *
// * *`), así que el modo completo se elige por la hora y NO hace falta tocar la
// base con otra migración.
//
// MEMORIA — la restricción que manda el diseño. El espejo de BlackBox son
// 22 MB / ~1.200 documentos de 199 campos, y la function tiene un techo que ya
// se golpeó (WORKER_RESOURCE_LIMIT, 2026-08-22): la primera versión guardaba el
// archivo entero tres veces (el texto bajado, una copia «antes» para comparar y
// el cuerpo a subir) y además materializaba los 1.200 documentos parseados.
// Ahora se guarda UNA lista de líneas más dos arreglos chicos alineados por
// posición (id y fecha), se marca si hubo cambios con un booleano en vez de
// comparar textos, y los destilados recorren las líneas con un generador que
// parsea de a un documento. No volver a introducir una copia completa.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { sb } from '../_shared/db.ts';
import { autorizado } from '../_shared/auth.ts';
import { AdmCliente } from '../_shared/adm.ts';
import type { CredAdm } from '../_shared/adm.ts';
import {
  type AcumTipoGasto,
  acumularTipoGasto,
  cerrarTipoGasto,
  crearAcumTipoGasto,
  destilarProveedorCuentas,
  indiceTipos,
  iterJsonl,
} from './destilar.ts';

// deno-lint-ignore no-explicit-any
type Dic = Record<string, any>;

const BUCKET = 'qualia-espejos';
const HORA_COMPLETA_UTC = 6; // 02:00 en RD
/** Ventana de relectura. 60 días cubre el ciclo fiscal donde se corrige de verdad. */
const VENTANA_DIAS = 60;
/** Tope de relecturas por corrida: una edge function no aguanta mil llamadas. */
const MAX_RELECTURAS = 150;

const rutaBills = (e: string) => `espejo-adm/${e}/vendor-bills-detalle.jsonl`;
const rutaVendors = (e: string) => `espejo-adm/${e}/vendors.jsonl`;
const rutaTipos = (e: string) => `espejo-adm/${e}/agg/expense-types.json`;
const rutaProveedorCuentas = (e: string) => `espejo-adm/${e}/agg/proveedor-cuentas.json`;
const RUTA_RNC_TIPO_GASTO = 'nucleo/agg/rnc-tipo-gasto.json';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function bajarTexto(ruta: string): Promise<string | null> {
  const { data } = await sb().storage.from(BUCKET).download(ruta);
  return data ? await data.text() : null;
}

async function subirTexto(
  ruta: string,
  cuerpo: string,
  tipo = 'application/octet-stream',
) {
  const { error } = await sb().storage.from(BUCKET)
    .upload(ruta, new Blob([cuerpo], { type: tipo }), { upsert: true });
  if (error) throw new Error(`no pude subir ${ruta}: ${error.message}`);
}

// El espejo sembrado por el server envuelve cada factura como
// {_id, docid, data}. La primera versión en la nube leía `d.ID` del nivel de
// arriba —que en esas líneas NO existe— así que el set de conocidas quedaba
// VACÍO: cada corrida repaginaba ADM entero, pedía el detalle de las ~1.100
// facturas, se pasaba del límite y moría sin subir nada. El espejo no se movió
// entre el 2026-08-20 y el 2026-08-22 con el cron corriendo cada hora, y se
// habían acumulado 17 facturas sin espejar. Se lee el ID de los dos lugares y
// se escribe SIEMPRE envuelto, para que el archivo quede homogéneo.
const idDe = (o: Dic): string => String(o?.data?.ID ?? o?.ID ?? '');
const fechaDe = (o: Dic): string => String((o?.data ?? o)?.DocDate ?? '').slice(0, 10);

// Los adjuntos vienen con URL firmada de Azure (SAS): la firma se regenera en
// CADA llamada y vence. Guardarla tal cual tiene dos costos: la comparacion de
// la relectura ve «cambio» en toda factura con adjunto —111 de 117 en la
// medicion del 2026-08-22— y el espejo reescribe 22 MB todas las noches sin que
// haya cambiado un dato; y ademas deja un token de acceso vencido dentro de un
// archivo que no lo necesita (nadie lee Files[].URI del espejo; el adjunto se
// pide fresco a ADM). Se guarda la URL sin la query, que identifica el blob
// igual y es estable.
function limpiarFirmas(det: Dic): Dic {
  const files = det?.Files;
  if (!Array.isArray(files)) return det;
  const sinQuery = (v: unknown): unknown =>
    typeof v === 'string' && v.includes('?') ? v.slice(0, v.indexOf('?')) : v;
  return {
    ...det,
    Files: files.map((f: Dic) =>
      f && typeof f === 'object'
        ? { ...f, URI: sinQuery(f.URI), URI_Original: sinQuery(f.URI_Original) }
        : f
    ),
  };
}

const envolver = (det: Dic): string => {
  const limpio = limpiarFirmas(det);
  return JSON.stringify({
    _id: String(limpio?.ID ?? ''),
    docid: String(limpio?.DocID ?? ''),
    data: limpio,
  });
};

/** Las líneas crudas más dos índices chicos alineados por posición. */
type Espejo = {
  lineas: string[];
  ids: string[];
  fechas: string[];
  mutado: boolean;
};

async function cargarEspejo(empresaId: string): Promise<Espejo> {
  const txt = (await bajarTexto(rutaBills(empresaId))) ?? '';
  const lineas = txt.split('\n').filter((l) => l.trim());
  const ids: string[] = [];
  const fechas: string[] = [];
  for (const l of lineas) {
    try {
      const o = JSON.parse(l);
      ids.push(idDe(o));
      fechas.push(fechaDe(o));
    } catch {
      // Línea rota: se conserva tal cual. No es nuestra pelea y borrarla pierde datos.
      ids.push('');
      fechas.push('');
    }
  }
  return { lineas, ids, fechas, mutado: false };
}

function poner(esp: Espejo, i: number, det: Dic) {
  esp.lineas[i] = envolver(det);
  esp.ids[i] = String(det?.ID ?? '');
  esp.fechas[i] = String(det?.DocDate ?? '').slice(0, 10);
  esp.mutado = true;
}

async function clienteAdm(empresaId: string): Promise<AdmCliente> {
  const { data: emp, error } = await sb()
    .from('admcloud_empresas')
    .select('codigo, api_role, api_appid, api_username, api_password')
    .eq('id', empresaId)
    .single();
  if (error || !emp) {
    throw new Error(`sin credenciales ADM: ${error?.message ?? 'sin fila'}`);
  }
  return new AdmCliente(emp as CredAdm);
}

/** 1 · Trae lo que ADM tiene y el espejo no. Incremental de verdad. */
async function refrescar(adm: AdmCliente, esp: Espejo): Promise<Dic> {
  const conocidos = new Set(esp.ids.filter(Boolean));

  // Del más nuevo al más viejo: se corta apenas una página entera ya es conocida.
  // deno-lint-ignore no-explicit-any
  const listado = await adm.paginar(
    'VendorBills',
    (lote: any[]) => lote.length > 0 && lote.every((f) => conocidos.has(String(f?.ID ?? ''))),
  );
  const nuevas = listado.filter((f) => f?.ID && !conocidos.has(String(f.ID)));

  let agregadas = 0, fallidas = 0;
  for (const f of nuevas) {
    try {
      const det = await adm.readback('VendorBills', String(f.ID)) as Dic;
      esp.lineas.push('');
      esp.ids.push('');
      esp.fechas.push('');
      poner(esp, esp.lineas.length - 1, det);
      agregadas++;
    } catch (e) {
      // Una factura ilegible no frena el espejo; la próxima corrida reintenta.
      esp.lineas.pop();
      esp.ids.pop();
      esp.fechas.pop();
      fallidas++;
      console.error(`espejo: no pude leer ${f.DocID}: ${(e as Error).message}`);
    }
  }
  return {
    conocidas: conocidos.size,
    nuevas: nuevas.length,
    agregadas,
    fallidas,
  };
}

/** 2 · Relee la ventana reciente para que las CORRECCIONES lleguen. */
async function relerVentana(
  adm: AdmCliente,
  esp: Espejo,
  hoy: Date,
): Promise<Dic> {
  const corte = new Date(hoy.getTime() - VENTANA_DIAS * 86400_000).toISOString()
    .slice(0, 10);
  const candidatas: number[] = [];
  for (let i = 0; i < esp.lineas.length; i++) {
    if (esp.ids[i] && esp.fechas[i] && esp.fechas[i] >= corte) {
      candidatas.push(i);
    }
  }
  candidatas.sort((
    a,
    b,
  ) => (esp.fechas[a] < esp.fechas[b] ? 1 : esp.fechas[a] > esp.fechas[b] ? -1 : 0));

  const aRelear = candidatas.slice(0, MAX_RELECTURAS);
  const sinMirar = candidatas.length - aRelear.length;
  let releidas = 0, cambiadas = 0, fallidas = 0;

  for (const i of aRelear) {
    const previo = esp.lineas[i];
    try {
      const det = await adm.readback('VendorBills', esp.ids[i]) as Dic;
      releidas++;
      if (envolver(det) !== previo) {
        poner(esp, i, det);
        cambiadas++;
      }
    } catch (e) {
      // Se conserva la línea vieja: mejor un dato viejo que un hueco.
      fallidas++;
      console.error(
        `espejo: relectura falló ${esp.ids[i]}: ${(e as Error).message}`,
      );
    }
  }
  // Nunca callado: un tope que recorta cobertura sin decirlo se lee como
  // «revisé todo» cuando no fue.
  if (sinMirar > 0) {
    console.log(
      `espejo: ${sinMirar} facturas de la ventana quedaron sin releer (tope ${MAX_RELECTURAS})`,
    );
  }
  return {
    ventana_dias: VENTANA_DIAS,
    candidatas: candidatas.length,
    releidas,
    cambiadas,
    fallidas,
    sin_releer: sinMirar,
  };
}

Deno.serve(async (req: Request) => {
  if (!(await autorizado(req))) return json({ error: 'no autorizado' }, 401);

  let empresaPedida: string | null = null;
  let modoPedido: string | null = null;
  try {
    const body = await req.json();
    if (body?.empresa_id) empresaPedida = String(body.empresa_id);
    if (body?.modo) modoPedido = String(body.modo);
  } catch { /* sin body: barre la flota en modo automático */ }

  const ahora = new Date();
  // 'completo' se puede forzar a mano; si no, lo decide la hora.
  const completo = modoPedido === 'completo' ||
    (modoPedido !== 'incremental' && ahora.getUTCHours() === HORA_COMPLETA_UTC);

  const { data: empresas, error } = empresaPedida
    ? { data: [{ id: empresaPedida }], error: null }
    : await sb().from('admcloud_empresas').select('id').eq(
      'qualia_activa',
      true,
    );
  if (error) return json({ error: error.message }, 500);

  const corridas: Dic[] = [];
  // El agg de tipo de gasto es GENERAL (DGII): se pliega empresa por empresa y
  // se escribe una sola vez, fuera del bucle. El acumulador es chico; los
  // textos de cada empresa se sueltan al terminar su vuelta.
  const acum: AcumTipoGasto = crearAcumTipoGasto();
  let catalogoTipos: Map<string, string> | null = null;

  for (const e of empresas ?? []) {
    const id = (e as { id: string }).id;
    try {
      const adm = await clienteAdm(id);
      const esp = await cargarEspejo(id);

      const paso1 = await refrescar(adm, esp);
      const paso2 = completo ? await relerVentana(adm, esp, ahora) : null;

      if (esp.mutado) {
        await subirTexto(rutaBills(id), esp.lineas.join('\n') + '\n');
      }

      let paso3: Dic | null = null;
      if (completo) {
        const vendors = (await bajarTexto(rutaVendors(id))) ?? '';
        const agg = destilarProveedorCuentas(iterJsonl(esp.lineas), vendors);
        await subirTexto(
          rutaProveedorCuentas(id),
          JSON.stringify(agg, null, 1),
          'application/json',
        );
        paso3 = {
          proveedores: agg._meta.n_proveedores,
          cuentas: agg._meta.n_cuentas,
          facturas: agg._meta.n_facturas,
        };

        const tiposTxt = (await bajarTexto(rutaTipos(id))) ?? '';
        const { porId, catalogo } = indiceTipos(tiposTxt);
        if (porId.size > 0) {
          acumularTipoGasto(acum, iterJsonl(esp.lineas), vendors, porId);
          if (!catalogoTipos) catalogoTipos = catalogo;
        } else {
          console.error(
            `espejo: ${id} sin catálogo de tipos de gasto; no aporta al agg general`,
          );
        }
      }

      corridas.push({
        empresa_id: id,
        incremental: paso1,
        relectura: paso2,
        destilado: paso3,
      });
    } catch (err) {
      corridas.push({
        empresa_id: id,
        error: (err as Error).message.slice(0, 200),
      });
    }
  }

  let tipoGasto: Dic | null = null;
  if (completo && acum.nEmpresas > 0 && catalogoTipos) {
    try {
      const agg = cerrarTipoGasto(acum, catalogoTipos);
      await subirTexto(
        RUTA_RNC_TIPO_GASTO,
        JSON.stringify(agg, null, 1),
        'application/json',
      );
      tipoGasto = {
        suplidores: agg._meta.n_suplidores,
        con_dominante: agg._meta.n_con_dominante,
        empresas: agg._meta.n_empresas_aportantes,
      };
    } catch (err) {
      tipoGasto = { error: (err as Error).message.slice(0, 200) };
    }
  }

  return json({
    modo: completo ? 'completo' : 'incremental',
    corridas,
    rnc_tipo_gasto: tipoGasto,
  });
});
