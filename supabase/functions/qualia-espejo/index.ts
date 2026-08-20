// qualia-espejo — el alimentador del espejo de facturas, portado del server
// (mesa/refrescar-recurrentes.sh, muerto con CodeBox el 2026-08-20).
//
// El detector de recurrentes (qualia-sugerencias) NO le pregunta a ADM: lee
// `qualia-espejos/espejo-adm/<empresa>/vendor-bills-detalle.jsonl` del bucket.
// Sin refresco, la caja diría «todavía no facturó» durante horas después de
// que la factura ya entró. Este cron lo mantiene fresco: baja el jsonl, mira
// qué facturas de ADM no están, les trae el DETALLE (una por una — el listado
// no trae Items) y resube con upsert. Incremental a propósito: re-bajar el
// detalle completo enterró 61 cargos vivos una vez (otra pieza, misma moraleja).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { sb } from '../_shared/db.ts';
import { autorizado } from '../_shared/auth.ts';
import { AdmCliente } from '../_shared/adm.ts';
import type { CredAdm } from '../_shared/adm.ts';

// deno-lint-ignore no-explicit-any
type Dic = Record<string, any>;

const BUCKET = 'qualia-espejos';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function refrescarEmpresa(empresaId: string): Promise<Dic> {
  const { data: emp, error } = await sb()
    .from('admcloud_empresas')
    .select('codigo, api_role, api_appid, api_username, api_password')
    .eq('id', empresaId)
    .single();
  if (error || !emp) throw new Error(`sin credenciales ADM: ${error?.message ?? 'sin fila'}`);
  const adm = new AdmCliente(emp as CredAdm);

  const ruta = `espejo-adm/${empresaId}/vendor-bills-detalle.jsonl`;
  const { data: archivo } = await sb().storage.from(BUCKET).download(ruta);
  const lineas: string[] = archivo ? (await archivo.text()).split('\n').filter((l) => l.trim()) : [];
  const conocidos = new Set<string>();
  for (const l of lineas) {
    try {
      const d = JSON.parse(l);
      if (d?.ID) conocidos.add(String(d.ID));
    } catch { /* línea rota: se conserva igual, no es nuestra pelea */ }
  }

  // Del más nuevo al más viejo: se corta apenas una página entera ya es conocida.
  // deno-lint-ignore no-explicit-any
  const listado = await adm.paginar('VendorBills', (lote: any[]) =>
    lote.every((f) => conocidos.has(String(f?.ID ?? ''))));
  const nuevas = listado.filter((f) => f?.ID && !conocidos.has(String(f.ID)));

  let agregadas = 0;
  for (const f of nuevas) {
    try {
      const det = await adm.readback('VendorBills', String(f.ID));
      lineas.push(JSON.stringify(det));
      agregadas++;
    } catch (e) {
      // Una factura ilegible no frena el espejo; la próxima corrida reintenta.
      console.error(`espejo: no pude leer ${f.DocID}: ${(e as Error).message}`);
    }
  }

  if (agregadas > 0 || !archivo) {
    const cuerpo = lineas.join('\n') + '\n';
    const { error: eUp } = await sb().storage.from(BUCKET)
      .upload(ruta, new Blob([cuerpo], { type: 'application/octet-stream' }), { upsert: true });
    if (eUp) throw new Error(`no pude subir el espejo: ${eUp.message}`);
  }

  return { empresa_id: empresaId, conocidas: conocidos.size, agregadas };
}

Deno.serve(async (req: Request) => {
  if (!(await autorizado(req))) return json({ error: 'no autorizado' }, 401);

  let empresaPedida: string | null = null;
  try {
    const body = await req.json();
    if (body?.empresa_id) empresaPedida = String(body.empresa_id);
  } catch { /* sin body: barre la flota */ }

  const { data: empresas, error } = empresaPedida
    ? { data: [{ id: empresaPedida }], error: null }
    : await sb().from('admcloud_empresas').select('id').eq('qualia_activa', true);
  if (error) return json({ error: error.message }, 500);

  const corridas = [];
  for (const e of empresas ?? []) {
    const id = (e as { id: string }).id;
    try {
      corridas.push(await refrescarEmpresa(id));
    } catch (err) {
      corridas.push({ empresa_id: id, error: (err as Error).message.slice(0, 200) });
    }
  }
  return json({ corridas });
});
