// qualia-espejo/destilar.ts — los dos destilados del espejo, portados de los
// scripts de Python que corrían en CodeBox y murieron con él el 2026-08-20:
//
//   empresas/<e>/hermes/memoria/scripts/generar-proveedor-cuentas.py
//   nucleo-contable/scripts/generar-rnc-tipo-gasto.py
//
// Los orquestaba `mesa/refrescar-precedentes.sh`, que además los subía al
// bucket. Al apagar el server nadie los volvió a correr: los agg quedaron
// clavados en la última corrida (2026-08-20T05:20Z) y el proponedor —que NO
// lee el bundle del contable, lee estos archivos— siguió clasificando con
// precedentes viejos. Sin error: elige la cuenta más parecida.
//
// Determinista y sin LLM: son agrupaciones sobre el espejo crudo. Funciones
// puras a propósito (entran textos, salen objetos) para poder probarlas contra
// el raw descargado sin tocar red ni bucket.
//
// Fidelidad al fuente: se conservan los desempates del Python (por código, no
// por orden de aparición) porque el destilado corre todas las noches y sin eso
// el JSON se reordena solo y el diff miente.

// deno-lint-ignore no-explicit-any
type Dic = Record<string, any>;

const digitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');
const rncValido = (s: string): boolean => s.length === 9 || s.length === 11;
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Cada línea del jsonl es {_id, docid, data} o el objeto pelado.
 *
 * Generador y no lista: el espejo de BlackBox son 22 MB y ~1.200 documentos de
 * 199 campos. Materializarlos revienta el límite de memoria de la function
 * (WORKER_RESOURCE_LIMIT, medido el 2026-08-22). Se parsea de a uno y se suelta. */
export function* iterJsonl(lineas: Iterable<string>): Generator<Dic> {
  for (const linea of lineas) {
    if (!linea.trim()) continue;
    try {
      const o = JSON.parse(linea);
      yield o?.data ?? o;
    } catch { /* línea rota: se saltea, igual que el Python */ }
  }
}

/** Atajo para texto suelto (pruebas y vendors.jsonl, que es chico). */
export function leerJsonl(texto: string): Dic[] {
  return [...iterJsonl(texto.split('\n'))];
}

/** vendors.jsonl → ID del suplidor → su RNC (FiscalID del maestro). */
export function indiceVendors(texto: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const v of leerJsonl(texto)) {
    const id = String(v.ID ?? '').trim();
    if (!id) continue;
    const fid = digitos(v.FiscalID);
    if (rncValido(fid)) m.set(id, fid);
  }
  return m;
}

/** Cuenta con desempate estable: primero por más usos, después por clave. */
function ordenarConteo(c: Map<string, number>): [string, number][] {
  return [...c.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
}

/** Como Counter.most_common del Python: por conteo, empate por orden de llegada. */
function masComunes(c: Map<string, number>): string[] {
  const orden = [...c.keys()];
  return orden.slice().sort(
    (a, b) => c.get(b)! - c.get(a)! || orden.indexOf(a) - orden.indexOf(b),
  );
}

// ── proveedor → cuentas (propio de CADA empresa) ─────────────────────────────
// La cuenta contable NO se comparte entre empresas: el mismo código significa
// cosas distintas (36 colisiones medidas entre BlackBox y Planchas el
// 2026-08-02; 620.11 es Combustible en una y Otros gastos en la otra).
export function destilarProveedorCuentas(
  bills: Iterable<Dic>,
  rawVendors: string,
): Dic {
  const vendors = indiceVendors(rawVendors);

  type P = {
    nombre: string;
    relationship_id: string | null;
    rnc: string | null;
    facturas: number;
    rncsDoc: Map<string, number>;
    cuentas: Map<string, number>;
    nombres: Map<string, string>;
  };
  const proveedores = new Map<string, P>();
  let nFacturas = 0, nSinCuenta = 0;

  for (const d of bills) {
    const rid = String(d.RelationshipID ?? '').trim();
    const nombre = String(d.RelationshipName ?? '').trim();
    if (!rid && !nombre) continue;
    nFacturas++;
    const clave = rid || nombre.toLowerCase();
    let p = proveedores.get(clave);
    if (!p) {
      p = {
        nombre,
        relationship_id: rid || null,
        rnc: null,
        facturas: 0,
        rncsDoc: new Map(),
        cuentas: new Map(),
        nombres: new Map(),
      };
      proveedores.set(clave, p);
    }
    p.facturas++;
    const delMaestro = vendors.get(rid);
    if (delMaestro) p.rnc = delMaestro;

    // El RNC impreso en la factura no siempre es el del maestro: hay 10
    // facturas de 5 proveedores donde difieren, y en un caso el impreso es el
    // del maestro de OTRO proveedor. Se guardan todos los vistos, para que
    // buscar por el RNC del documento no caiga en el proveedor vecino.
    const rncDoc = digitos(d.FiscalID);
    if (rncValido(rncDoc)) {
      p.rncsDoc.set(rncDoc, (p.rncsDoc.get(rncDoc) ?? 0) + 1);
    }

    // La cuenta sale de Items[] (la clasificación del gasto). Si la factura no
    // trae Items se cae a Accounts[] con débito > 0, salteando ITBIS adelantado
    // (118*) y CxP (2*): son mecánica del asiento, no clasificación.
    // El par viaja como JSON y no concatenado: los nombres de cuenta llevan
    // espacios y cualquier separador plano los parte.
    const delDoc = new Set<string>();
    for (const it of (d.Items ?? []) as Dic[]) {
      const cod = String(it?.AccountCode ?? '').trim();
      if (cod) {
        delDoc.add(JSON.stringify([cod, String(it?.AccountName ?? '').trim()]));
      }
    }
    if (delDoc.size === 0) {
      for (const a of (d.Accounts ?? []) as Dic[]) {
        const deb = Number(a?.Debit ?? 0);
        const cod = String(a?.AccountCode ?? '').trim();
        if (
          Number.isFinite(deb) && deb > 0 && cod &&
          !cod.startsWith('118') && !cod.startsWith('2')
        ) {
          delDoc.add(
            JSON.stringify([cod, String(a?.AccountName ?? '').trim()]),
          );
        }
      }
    }
    if (delDoc.size === 0) nSinCuenta++;
    for (const par of delDoc) {
      const [cod, nom] = JSON.parse(par) as [string, string];
      p.cuentas.set(cod, (p.cuentas.get(cod) ?? 0) + 1);
      if (nom) p.nombres.set(cod, nom);
    }
  }

  const lista: Dic[] = [];
  for (const p of proveedores.values()) {
    let total = 0;
    for (const n of p.cuentas.values()) total += n;
    const cuentas = total
      ? ordenarConteo(p.cuentas).map(([cod, usos]) => ({
        codigo: cod,
        nombre: p.nombres.get(cod) ?? '',
        usos,
        pct: round1(100 * usos / total),
      }))
      : [];
    const vistos = masComunes(p.rncsDoc);
    const rnc = p.rnc ?? (vistos[0] ?? null);
    lista.push({
      nombre: p.nombre,
      relationship_id: p.relationship_id,
      rnc,
      rncs_alt: vistos.filter((r) => r !== rnc),
      facturas: p.facturas,
      cuentas,
    });
  }
  lista.sort((a, b) => b.facturas - a.facturas);

  // Índice invertido. Sin esto, un proveedor ausente obliga al contable a
  // improvisar una "categoría" que no existe en ADM: acá ve la cuenta real, su
  // nombre exacto y qué proveedores comparables la usan.
  const idx = new Map<string, Dic>();
  for (const p of lista) {
    for (const c of p.cuentas as Dic[]) {
      let e = idx.get(c.codigo);
      if (!e) {
        e = { codigo: c.codigo, nombre: c.nombre, usos: 0, proveedores: [] };
        idx.set(c.codigo, e);
      }
      if (c.nombre && !e.nombre) e.nombre = c.nombre;
      e.usos += c.usos;
      e.proveedores.push({ nombre: p.nombre, usos: c.usos });
    }
  }
  const cuentasIdx = [...idx.values()].sort((a, b) => b.usos - a.usos);
  for (const e of cuentasIdx) {
    e.proveedores.sort((a: Dic, b: Dic) => b.usos - a.usos);
    e.n_proveedores = e.proveedores.length;
    e.proveedores = e.proveedores.slice(0, 12);
  }

  return {
    _meta: {
      generado: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      n_proveedores: lista.length,
      n_facturas: nFacturas,
      n_facturas_sin_cuenta: nSinCuenta,
      n_con_rnc: lista.filter((x) => x.rnc).length,
      n_con_rnc_alterno: lista.filter((x) => (x.rncs_alt as string[]).length).length,
      n_cuentas: cuentasIdx.length,
      fuente: 'raw/vendor-bills-detalle.jsonl + raw/vendors.jsonl',
    },
    proveedores: lista,
    cuentas: cuentasIdx,
  };
}

// ── RNC → tipo de gasto 606 (GENERAL, de la DGII) ────────────────────────────
// Este sí se comparte entre empresas: el catálogo 01-11 es nacional y un
// suplidor no cambia de naturaleza según quién le compre.
export const DOMINANTE_MIN = 70.0;
export const MUESTRA_MIN = 3;

/** Acumulador entre empresas: se pliega una empresa por vez y se sueltan sus
 * textos. Guardar el jsonl de cada empresa para juntarlas al final es lo que
 * hacía estallar la memoria de la function. */
/** expense-types del bucket: {"02": {adm_id, nombre}} -> adm_id -> [codigo, nombre]. */
export function indiceTipos(
  json: string,
): { porId: Map<string, [string, string]>; catalogo: Map<string, string> } {
  const porId = new Map<string, [string, string]>();
  const catalogo = new Map<string, string>();
  let d: Dic;
  try {
    d = JSON.parse(json);
  } catch {
    return { porId, catalogo };
  }
  for (const [codigo, v] of Object.entries(d ?? {})) {
    const nombre = String((v as Dic)?.nombre ?? '').trim();
    const admId = String((v as Dic)?.adm_id ?? '').trim();
    if (!codigo) continue;
    if (admId) porId.set(admId, [codigo, nombre]);
    if (!catalogo.has(codigo)) catalogo.set(codigo, nombre);
  }
  return { porId, catalogo };
}

export type AcumTipoGasto = {
  porRnc: Map<string, Map<string, number>>;
  nombres: Map<string, Map<string, number>>;
  nEmpresas: number;
  nFacturas: number;
  nSinRnc: number;
  nSinTipo: number;
};

export const crearAcumTipoGasto = (): AcumTipoGasto => ({
  porRnc: new Map(),
  nombres: new Map(),
  nEmpresas: 0,
  nFacturas: 0,
  nSinRnc: 0,
  nSinTipo: 0,
});

export function acumularTipoGasto(
  acc: AcumTipoGasto,
  bills: Iterable<Dic>,
  rawVendors: string,
  tipos: Map<string, [string, string]>,
): void {
  acc.nEmpresas++;
  const maestro = indiceVendors(rawVendors);
  for (const d of bills) {
    acc.nFacturas++;
    let rnc = maestro.get(String(d.RelationshipID ?? '').trim()) ?? '';
    if (!rnc) rnc = digitos(d.FiscalID);
    if (!rncValido(rnc)) {
      acc.nSinRnc++;
      continue;
    }
    const tipo = tipos.get(String(d.ExpenseTypeID ?? ''));
    if (!tipo) {
      acc.nSinTipo++;
      continue;
    }
    let c = acc.porRnc.get(rnc);
    if (!c) {
      c = new Map();
      acc.porRnc.set(rnc, c);
    }
    c.set(tipo[0], (c.get(tipo[0]) ?? 0) + 1);
    const nom = String(d.RelationshipName ?? '').trim();
    if (nom) {
      let n = acc.nombres.get(rnc);
      if (!n) {
        n = new Map();
        acc.nombres.set(rnc, n);
      }
      n.set(nom, (n.get(nom) ?? 0) + 1);
    }
  }
}

export function cerrarTipoGasto(
  acc: AcumTipoGasto,
  catalogo: Map<string, string>,
): Dic {
  const suplidores: Dic[] = [];
  for (const [rnc, cuenta] of acc.porRnc) {
    let total = 0;
    for (const n of cuenta.values()) total += n;
    const tiposL = ordenarConteo(cuenta).map(([cod, n]) => ({
      codigo: cod,
      nombre: catalogo.get(cod) ?? '',
      usos: n,
      pct: round1(100 * n / total),
    }));
    const top = tiposL[0];
    const nm = acc.nombres.get(rnc);
    suplidores.push({
      rnc,
      // El nombre es orientativo, para que un humano reconozca la fila.
      nombre: nm ? (masComunes(nm)[0] ?? '') : '',
      facturas: total,
      dominante: (total >= MUESTRA_MIN && top.pct >= DOMINANTE_MIN) ? top.codigo : null,
      tipos: tiposL,
    });
  }
  suplidores.sort((a, b) => b.facturas - a.facturas);

  const idx = new Map<string, number>();
  const provs = new Map<string, number>();
  for (const s of suplidores) {
    for (const t of s.tipos as Dic[]) {
      idx.set(t.codigo, (idx.get(t.codigo) ?? 0) + t.usos);
      provs.set(t.codigo, (provs.get(t.codigo) ?? 0) + 1);
    }
  }

  return {
    _meta: {
      generado: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      alcance: 'GENERAL (DGII) \u2014 vale para cualquier empresa; el tipo de gasto 606 no ' +
        'depende de qui\u00e9n compra. La cuenta contable NO se comparte: vive en cada empresa.',
      n_empresas_aportantes: acc.nEmpresas,
      n_suplidores: suplidores.length,
      n_facturas: acc.nFacturas,
      n_sin_rnc: acc.nSinRnc,
      n_sin_tipo_gasto: acc.nSinTipo,
      n_con_dominante: suplidores.filter((s) => s.dominante).length,
    },
    catalogo: [...catalogo.keys()]
      .sort((a, b) => (idx.get(b) ?? 0) - (idx.get(a) ?? 0))
      .map((c) => ({
        codigo: c,
        nombre: catalogo.get(c) ?? '',
        usos: idx.get(c) ?? 0,
        n_suplidores: provs.get(c) ?? 0,
      })),
    suplidores,
  };
}
