// qualia-cuadre — el cron de cuadre 1:1 (plan-f4-registrador.md §7).
//
// Es el detector de TODOS los modos de fallo de escritura, y por eso corre en
// verde 14 días sobre la escritura del SERVER antes de que el registrador de
// la nube escriba su primer documento. Después queda para siempre.
//
// Qué cruza, cada día, por empresa activa y por tipo registrable:
//   - huérfano: documento de la ventana SIN trabajo que lo reclame. Si además
//     su Reference calza con una llave de la mesa (NCF/banco_tx/uuid de un
//     trabajo), es ROJO: escribimos algo que la mesa no sabe que escribió.
//     Sin llave nuestra es AMARILLO (`sin_reclamar`): ADM no expone el autor
//     (sondeado 2026-08-20: ni el listado ni el detalle traen CreatedBy), así
//     que un documento a mano de la contable es indistinguible por autoría.
//   - descuadre: TotalAmount de ADM ≠ monto de la propuesta (tolerancia 0.05,
//     en valor absoluto — los CB en crédito viajan negativos).
//   - nómina fuera de protocolo: un Journal de la ventana tocando cuentas de
//     nómina (611.x / 210.04-210.10 / 220.0x). La nómina jamás es autónoma.
//   - deriva de la API: el listado cambió de shape → hallazgo ROJO ruidoso.
//
// Los FANTASMAS (trabajo `registrada` sin documento) no se miran acá: los
// barre qualia-lapidas cada hora, por UUID y con las cuatro guardas medidas.
// Duplicarlo por listado sería repetir el error del 2026-08-04 (el listado no
// trae anulados y enterró 61 cargos vivos).
//
// GET-only contra ADM: esta function no escribe un byte allá. Verde = sin
// hallazgos rojos; los amarillos se listan pero no rompen el verde.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { sb } from '../_shared/db.ts';
import { autorizado } from '../_shared/auth.ts';
import { AdmCliente } from '../_shared/adm.ts';
import type { CredAdm } from '../_shared/adm.ts';

const VENTANA_DIAS = 3;

interface Hallazgo {
  nivel: 'rojo' | 'amarillo';
  tipo: string;
  documento_adm: string;
  docid?: string;
  detalle: string;
}

interface Reclamo {
  trabajo_id: string;
  docid: string;
  uuid: string | null;
  reference: string | null;
  documento: string | null;
  monto: number | null;
  ncf: string | null;
  banco_tx_id: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const RE_CUENTA_NOMINA = /^(611\.|210\.(0[4-9]|10)$|220\.0)/;

async function reclamosDe(empresaId: string): Promise<Reclamo[]> {
  const { data, error } = await sb()
    .from('qualia_trabajos')
    .select('id, propuesta')
    .eq('empresa_id', empresaId)
    .not('propuesta->registro_adm->>docid', 'is', null);
  if (error) throw new Error(`qualia_trabajos ilegible: ${error.message}`);
  const filas: Reclamo[] = [];
  for (const f of data ?? []) {
    // deno-lint-ignore no-explicit-any
    const p = (f as any).propuesta ?? {};
    const reg = p.registro_adm ?? {};
    if (reg.eliminado_en || reg.anulado_en) continue; // reclamo muerto
    filas.push({
      trabajo_id: (f as { id: string }).id,
      docid: String(reg.docid ?? ''),
      uuid: reg.uuid ?? null,
      reference: reg.reference != null ? String(reg.reference) : null,
      documento: reg.documento ?? p.documento_adm ?? null,
      monto: p.monto != null ? Number(p.monto) : null,
      ncf: p.ncf != null ? String(p.ncf) : null,
      banco_tx_id: p.banco_tx_id != null ? String(p.banco_tx_id) : null,
    });
  }
  return filas;
}

async function cuadrarEmpresa(empresaId: string): Promise<{ verde: boolean; hallazgos: Hallazgo[]; resumen: string }> {
  const { data: emp, error } = await sb()
    .from('admcloud_empresas')
    .select('codigo, api_role, api_appid, api_username, api_password')
    .eq('id', empresaId)
    .single();
  if (error || !emp) throw new Error(`sin credenciales ADM (${error?.message ?? 'sin fila'})`);
  const adm = new AdmCliente(emp as CredAdm);

  const { data: tipos, error: e2 } = await sb()
    .from('qualia_tipos_registrables')
    .select('documento_adm, verificable')
    .eq('verificable', true);
  if (e2 || !tipos?.length) throw new Error(`qualia_tipos_registrables ilegible: ${e2?.message ?? 'vacía'}`);

  const reclamos = await reclamosDe(empresaId);
  const porDocid = new Map(reclamos.map((r) => [r.docid, r]));
  // Toda llave que la mesa conoce: si un documento sin reclamar lleva una de
  // éstas en su Reference o su NCF, lo escribió nuestra cañería.
  const llavesNuestras = new Set<string>();
  for (const r of reclamos) {
    for (const k of [r.reference, r.ncf, r.banco_tx_id, r.trabajo_id]) {
      if (k) llavesNuestras.add(String(k));
    }
  }

  const desde = new Date(Date.now() - VENTANA_DIAS * 24 * 3600 * 1000);
  const corte = desde.toISOString().slice(0, 10);

  const hallazgos: Hallazgo[] = [];
  let vistos = 0;

  for (const t of tipos) {
    const doc = t.documento_adm as string;
    // El listado viene del más nuevo al más viejo: se corta al salir de la
    // ventana (mismo truco medido del barrido de duplicados: 1.5s vs 9s).
    // deno-lint-ignore no-explicit-any
    const filas = await adm.paginar(doc, (lote: any[]) =>
      lote.some((f) => String(f?.CreationDate ?? '9999') < corte));

    if (filas.length) {
      const f0 = filas[0] ?? {};
      // El listado de Journals NO trae TotalAmount (medido 2026-08-20): su
      // monto se verifica sobre el detalle, en el mismo loop de nómina.
      const esperados = doc === 'Journals'
        ? ['DocID', 'ID', 'DocDate']
        : ['DocID', 'ID', 'DocDate', 'TotalAmount'];
      for (const campo of esperados) {
        if (!(campo in f0)) {
          hallazgos.push({
            nivel: 'rojo',
            tipo: 'deriva_api',
            documento_adm: doc,
            detalle: `el listado de ${doc} ya no trae '${campo}': la API cambió de shape — el cuadre se rompe ANTES que el registro`,
          });
        }
      }
    }

    const enVentana = filas.filter((f) => String(f?.CreationDate ?? '') >= corte);
    vistos += enVentana.length;

    for (const f of enVentana) {
      const docid = String(f.DocID ?? '');
      const reclamo = porDocid.get(docid);

      if (!reclamo) {
        const refs = [f.Reference, f.NCF].map((x) => (x == null ? '' : String(x))).filter(Boolean);
        const conLlave = refs.find((r) => llavesNuestras.has(r));
        if (conLlave) {
          hallazgos.push({
            nivel: 'rojo',
            tipo: 'huerfano',
            documento_adm: doc,
            docid,
            detalle: `${docid} lleva la llave '${conLlave}' de la mesa pero ningún trabajo vivo lo reclama: ` +
              `se escribió algo que la mesa no sabe que escribió`,
          });
        } else {
          hallazgos.push({
            nivel: 'amarillo',
            tipo: 'sin_reclamar',
            documento_adm: doc,
            docid,
            detalle: `${docid} (${String(f.CreationDate ?? '').slice(0, 10)}, ${Number(f.TotalAmount ?? 0)}) ` +
              `no tiene trabajo en la mesa — ADM no dice quién lo creó; si fue a mano, está bien`,
          });
        }
        continue;
      }

      // Journals no trae TotalAmount en el listado: su monto se compara sobre
      // el detalle, en el loop de nómina de abajo.
      if (reclamo.monto != null && f.TotalAmount !== undefined) {
        const admMonto = Math.abs(Number(f.TotalAmount ?? 0));
        const nuestro = Math.abs(reclamo.monto);
        if (Math.abs(admMonto - nuestro) > 0.05) {
          hallazgos.push({
            nivel: 'rojo',
            tipo: 'descuadre',
            documento_adm: doc,
            docid,
            detalle: `${docid}: ADM guarda ${admMonto.toFixed(2)} y la propuesta decía ${nuestro.toFixed(2)}`,
          });
        }
      }
    }

    // Nómina fuera de protocolo: sólo Journals, sólo los de la ventana, y con
    // detalle porque las cuentas no viajan en el listado.
    if (doc === 'Journals') {
      for (const f of enVentana) {
        try {
          const det = await adm.readback('Journals', String(f.ID));
          // El monto del Journal vive en su detalle, no en el listado.
          const reclamo = porDocid.get(String(f.DocID ?? ''));
          if (reclamo?.monto != null && det.TotalAmount !== undefined) {
            const admMonto = Math.abs(Number(det.TotalAmount ?? 0));
            const nuestro = Math.abs(reclamo.monto);
            if (Math.abs(admMonto - nuestro) > 0.05) {
              hallazgos.push({
                nivel: 'rojo',
                tipo: 'descuadre',
                documento_adm: doc,
                docid: String(f.DocID ?? ''),
                detalle: `${f.DocID}: ADM guarda ${admMonto.toFixed(2)} y la propuesta decía ${nuestro.toFixed(2)}`,
              });
            }
          }
          // deno-lint-ignore no-explicit-any
          const cuentas: string[] = ((det.Accounts ?? []) as any[])
            .map((a) => String(a?.AccountCode ?? a?.Code ?? ''))
            .filter(Boolean);
          const tocadas = cuentas.filter((c) => RE_CUENTA_NOMINA.test(c));
          if (tocadas.length) {
            hallazgos.push({
              nivel: 'rojo',
              tipo: 'nomina_fuera_de_protocolo',
              documento_adm: doc,
              docid: String(f.DocID ?? ''),
              detalle: `el asiento toca cuentas de nómina (${tocadas.join(', ')}): la nómina jamás va autónoma (plan-f4 §6)`,
            });
          }
        } catch (e) {
          hallazgos.push({
            nivel: 'amarillo',
            tipo: 'journal_ilegible',
            documento_adm: doc,
            docid: String(f.DocID ?? ''),
            detalle: `no pude leer el detalle para el chequeo de nómina: ${(e as Error).message}`,
          });
        }
      }
    }
  }

  const rojos = hallazgos.filter((h) => h.nivel === 'rojo').length;
  const amarillos = hallazgos.length - rojos;
  return {
    verde: rojos === 0,
    hallazgos,
    resumen: `${vistos} documentos en ventana de ${VENTANA_DIAS} días · ${rojos} rojos · ${amarillos} amarillos`,
  };
}

Deno.serve(async (req: Request) => {
  if (!(await autorizado(req))) return json({ error: 'no autorizado' }, 401);

  let empresaPedida: string | null = null;
  try {
    const body = await req.json();
    if (body?.empresa_id) empresaPedida = String(body.empresa_id);
  } catch {
    // sin body: barre la flota
  }

  const { data: empresas, error } = empresaPedida
    ? { data: [{ id: empresaPedida }], error: null }
    : await sb().from('admcloud_empresas').select('id').eq('qualia_activa', true);
  if (error) return json({ error: `flota ilegible: ${error.message}` }, 500);

  const corridas = [];
  for (const e of empresas ?? []) {
    const empresaId = (e as { id: string }).id;
    try {
      const r = await cuadrarEmpresa(empresaId);
      const hasta = new Date();
      const desde = new Date(hasta.getTime() - VENTANA_DIAS * 24 * 3600 * 1000);
      const { error: e3 } = await sb().from('qualia_cuadre_corridas').insert({
        empresa_id: empresaId,
        ventana_desde: desde.toISOString().slice(0, 10),
        ventana_hasta: hasta.toISOString().slice(0, 10),
        verde: r.verde,
        hallazgos: r.hallazgos,
        resumen: r.resumen,
      });
      if (e3) throw new Error(`no pude guardar la corrida: ${e3.message}`);
      corridas.push({ empresa_id: empresaId, verde: r.verde, resumen: r.resumen });
    } catch (err) {
      // Una empresa rota no calla a las demás, pero SU corrida queda en rojo:
      // un cuadre que no pudo correr jamás cuenta como verde.
      const detalle = (err as Error).message;
      await sb().from('qualia_cuadre_corridas').insert({
        empresa_id: empresaId,
        ventana_desde: null,
        ventana_hasta: null,
        verde: false,
        hallazgos: [{ nivel: 'rojo', tipo: 'corrida_rota', documento_adm: '-', detalle }],
        resumen: `corrida rota: ${detalle}`,
      });
      corridas.push({ empresa_id: empresaId, verde: false, resumen: `corrida rota: ${detalle}` });
    }
  }
  return json({ corridas });
});
