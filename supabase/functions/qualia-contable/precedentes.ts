// qualia-contable/precedentes.ts — la tool buscar_precedente: port de
// memoria/scripts/buscar-precedente.py sobre los espejos agg del bucket
// qualia-espejos + qualia_libro.
//
// Lo que NO cambia del fuente, porque es contrato con el modelo (contrato §2.1):
// las CINCO etiquetas viajan literales —`PRECEDENTE`, `SIN CUENTA DOMINANTE`,
// `MUESTRA INSUFICIENTE`, `PARECIDOS DE NOMBRE`, `⚠ Coincidió por RNC`— más el
// `TIPO DE GASTO 606:`. Se leen literal y no se reinterpretan: «SIN CUENTA
// DOMINANTE» no es precedente citable, y el agg SÍ vale como precedente
// (excepción explícita del contrato al borrador).
//
// Lo que sí cambia: la salida es JSON estructurado y no texto impreso. El
// fuente imprimía para una terminal; acá cada iteración re-paga el prompt
// entero y el texto formateado costaba tokens sin agregar información. La
// instrucción aplicable de cada camino (el otro motivo por el que el script
// existía) viaja en `instruccion`.

import {
  CtxTurno,
  delExamen,
  recortar,
  ResultadoTool,
  soloDigitos,
} from './tipos.ts';
import {
  BUCKET_ESPEJOS,
  RUTA_AGG_TIPO_GASTO,
  rutaAggPlanCuentas,
  rutaAggProveedorCuentas,
} from './espejos.ts';

// Los dos umbrales del fuente, con su porqué: un 100% sacado de UNA factura no
// es un precedente, es una anécdota.
const DOMINANTE_MIN = 70.0;
const MUESTRA_MIN = 3;
const REF = 'agg:proveedor-cuentas.json';

type Dic = Record<string, unknown>;

interface CuentaProv {
  codigo: string;
  nombre: string;
  usos: number;
  pct: number;
}
interface Proveedor {
  nombre: string;
  rnc: string | null;
  rncs_alt: string[];
  facturas: number;
  cuentas: CuentaProv[];
}

/** norm() del fuente: minúsculas sin tildes — 'Viáticos' y 'viaticos' colisionan. */
function norm(s: unknown): string {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function json(ctx: CtxTurno, ruta: string): Promise<Dic | null> {
  const { data, error } = await ctx.db.storage.from(BUCKET_ESPEJOS).download(ruta);
  if (error || !data) return null;
  try {
    const v = JSON.parse(await data.text()) as unknown;
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Dic) : null;
  } catch {
    return null;
  }
}

function listar(d: Dic | null, clave: string): Dic[] {
  const v = d?.[clave];
  return Array.isArray(v) ? (v as Dic[]) : [];
}

function proveedoresDe(agg: Dic | null): Proveedor[] {
  return listar(agg, 'proveedores').map((p) => ({
    nombre: String(p.nombre ?? ''),
    rnc: p.rnc ? String(p.rnc) : null,
    rncs_alt: Array.isArray(p.rncs_alt) ? (p.rncs_alt as unknown[]).map(String) : [],
    facturas: num(p.facturas),
    cuentas: listar(p, 'cuentas').map((c) => ({
      codigo: String(c.codigo ?? ''),
      nombre: String(c.nombre ?? ''),
      usos: num(c.usos),
      pct: num(c.pct),
    })),
  }));
}

/**
 * El tipo de gasto del 606 sale de la libreta GENERAL (todas las empresas,
 * cruzada por RNC) y no del mapa de la empresa: es un eje de la DGII, uno por
 * DOCUMENTO — distinto de la cuenta contable, que es por RENGLÓN.
 */
function tipoGasto(general: Dic | null, p: Proveedor): Dic {
  const rncs = new Set([p.rnc, ...p.rncs_alt].filter(Boolean) as string[]);
  const fila = rncs.size === 0
    ? undefined
    : listar(general, 'suplidores').find((s) => rncs.has(String(s.rnc ?? '')));
  const tipos = listar(fila ?? null, 'tipos');
  if (tipos.length === 0) {
    const falta = !p.rnc
      ? 'el proveedor no tiene RNC'
      : !general
      ? 'la libreta general no está en el espejo'
      : 'sin historia en la libreta general';
    return {
      etiqueta: 'TIPO DE GASTO: sin precedente',
      motivo: falta,
      instruccion: 'elegilo del catálogo (buscar_precedente {tipos:true}) por la naturaleza del documento',
    };
  }
  const top = tipos[0];
  const usos = tipos.reduce((s, t) => s + num(t.usos), 0);
  const otros = tipos.slice(1, 4).map((t) => `${t.codigo} ${num(t.pct).toFixed(0)}%`);
  const dominante = usos >= MUESTRA_MIN && num(top.pct) >= DOMINANTE_MIN;
  return {
    etiqueta: dominante ? 'TIPO DE GASTO 606:' : 'TIPO DE GASTO 606: sin dominante claro',
    codigo: String(top.codigo ?? ''),
    nombre: String(top.nombre ?? ''),
    usos: num(top.usos),
    de: usos,
    pct: num(top.pct),
    tambien: otros,
    instruccion: dominante
      ? 'uno por documento; va en la cabecera de la propuesta'
      : 'confirmalo por la naturaleza del documento',
  };
}

function fichaProveedor(p: Proveedor, general: Dic | null, porRnc: boolean): Dic {
  const ficha: Dic = {
    proveedor: p.nombre,
    rnc: p.rnc,
    rncs_alt: p.rncs_alt,
    facturas_historicas: p.facturas,
    tipo_gasto: tipoGasto(general, p),
    cuentas: p.cuentas.slice(0, 4),
  };
  if (porRnc) {
    // El RNC impreso en una factura no siempre es el del proveedor que la
    // emitió: el aviso es literal porque el modelo lo tiene que leer literal.
    ficha.aviso = '⚠ Coincidió por RNC. CONFIRMÁ que ese nombre es el de tu documento; si no casa, buscá por nombre.';
  }
  if (p.cuentas.length === 0) {
    ficha.etiqueta = 'MUESTRA INSUFICIENTE';
    ficha.instruccion = 'el proveedor está en el histórico pero sin cuentas registradas: clasificá por la naturaleza del renglón';
    return ficha;
  }
  const top = p.cuentas[0];
  // El denominador son USOS de cuenta, no facturas: una factura toca varias.
  const usos = p.cuentas.reduce((s, c) => s + c.usos, 0);
  if (p.facturas < MUESTRA_MIN) {
    ficha.etiqueta = 'MUESTRA INSUFICIENTE';
    ficha.detalle = `${p.facturas} factura(s)`;
    ficha.instruccion = 'la primera cuenta es una SEÑAL, no un precedente citable: confirmala por la naturaleza del renglón';
  } else if (top.pct >= DOMINANTE_MIN) {
    ficha.etiqueta = 'PRECEDENTE';
    ficha.cuenta = `${top.codigo} ${top.nombre}`;
    ficha.detalle = `${top.usos} de ${usos} usos de cuenta (${top.pct.toFixed(1)}%) sobre ${p.facturas} facturas`;
    ficha.precedente_ref = `${REF}#${p.rnc || norm(p.nombre)}`;
    ficha.instruccion = 'es el default de arranque, no un sello: revisá renglón por renglón y mové el que contradiga la naturaleza de esa cuenta';
  } else {
    ficha.etiqueta = 'SIN CUENTA DOMINANTE';
    ficha.detalle = `ninguna llega a ${DOMINANTE_MIN.toFixed(0)}% sobre ${p.facturas} facturas`;
    ficha.instruccion = 'NO hay precedente citable: repartí cada renglón entre las cuentas de arriba según lo que sea, con metodo="razonado" y la explicación en detalle';
  }
  return ficha;
}

/** buscar_proveedores() del fuente: exacto por RNC; si no, fuertes y débiles. */
function buscar(
  provs: Proveedor[],
  termino: string,
): { fuertes: Proveedor[]; debiles: Proveedor[]; porRnc: boolean } {
  const t = norm(termino);
  const digitos = soloDigitos(termino);
  if (digitos.length === 9 || digitos.length === 11) {
    const exactos = provs.filter((p) => p.rnc === digitos || p.rncs_alt.includes(digitos));
    if (exactos.length > 0) return { fuertes: exactos, debiles: [], porRnc: true };
  }
  const tokens = t.split(' ').filter((x) => x.length >= 4);
  const fuertes: Proveedor[] = [];
  const debiles: Proveedor[] = [];
  for (const p of provs) {
    const n = norm(p.nombre);
    // La separación no es cosmética: 'fc gestion' contra 'Gulfstream Petroleum
    // GESTIONES' es colisión de substring, y mezclarla haría que un restaurante
    // se registre como combustible.
    if ((t !== '' && n.includes(t)) || (tokens.length >= 2 && tokens.every((x) => n.includes(x)))) {
      fuertes.push(p);
    } else if (tokens.some((x) => x.length >= 5 && n.includes(x))) {
      debiles.push(p);
    }
  }
  const porFacturas = (a: Proveedor, b: Proveedor) => b.facturas - a.facturas;
  return { fuertes: fuertes.sort(porFacturas), debiles: debiles.sort(porFacturas), porRnc: false };
}

/**
 * El libro de acción, que es precedente de PRIMERA CLASE (por encima del agg,
 * que se re-destila todas las noches). En examen se excluye la entrada del
 * propio trabajo: es literalmente el desenlace que el examen mide.
 */
async function delLibro(ctx: CtxTurno, termino: string): Promise<Dic[]> {
  if (termino.trim() === '') return [];
  // ilike con el término escapado: los comodines de PostgREST (% _ , .) salen
  // del texto del modelo y no pueden ampliar la búsqueda por su cuenta.
  const patron = `%${termino.replace(/[%_,.()*]/g, ' ').trim()}%`;
  let q = ctx.db
    .from('qualia_libro')
    .select('entrada, metodo, precedente_ref, aprobado_por_nombre, ref_git, created_at, trabajo_id')
    .eq('empresa_id', ctx.empresaId)
    .ilike('entrada', patron)
    .order('created_at', { ascending: false })
    .limit(4);
  if (ctx.modo === 'examen') q = q.neq('trabajo_id', ctx.trabajoId);
  const { data, error } = await q;
  if (error || !data) return [];
  return data.map((f) => ({
    entrada: recortar(String(f.entrada ?? ''), 1_200),
    metodo: f.metodo,
    precedente_ref: f.precedente_ref,
    aprobo: f.aprobado_por_nombre,
    ref_git: f.ref_git,
    fecha: f.created_at,
  }));
}

export interface ArgsBuscarPrecedente {
  termino?: unknown;
  rnc?: unknown;
  cuenta?: unknown;
  plan?: unknown;
  tipos?: unknown;
}

export async function buscarPrecedente(
  ctx: CtxTurno,
  args: ArgsBuscarPrecedente,
): Promise<ResultadoTool> {
  const snap = delExamen(ctx, 'buscar_precedente', {
    termino: args.termino,
    rnc: args.rnc,
    cuenta: args.cuenta,
    plan: args.plan,
    tipos: args.tipos,
  });
  if (snap !== null) return snap;

  // --plan del fuente: el plan COMPLETO (215 cuentas), no sólo las que se usan.
  if (typeof args.plan === 'string' && args.plan.trim() !== '') {
    const plan = await json(ctx, rutaAggPlanCuentas(ctx.empresaId));
    if (!plan) return { error: 'el espejo del plan de cuentas no está en el bucket; usá leer_adm{plan_cuentas} contra el plan VIVO' };
    const t = norm(args.plan);
    const hits = listar(plan, 'cuentas')
      .filter((c) => t !== '' && norm(c.nombre).includes(t))
      .slice(0, 25)
      .map((c) => ({ codigo: c.codigo, nombre: c.nombre, tipo: c.tipo }));
    return {
      plan: hits,
      nota: hits.length === 0
        ? `ninguna cuenta del plan tiene "${args.plan}" en el nombre. Ojo con las palabras: 'viaje' no encuentra 'Dieta y Viáticos'`
        : 'el espejo puede estar viejo: la cuenta que vayas a citar, confirmala con leer_adm{plan_cuentas} — el plan VIVO manda',
    };
  }

  const agg = await json(ctx, rutaAggProveedorCuentas(ctx.empresaId));
  const general = await json(ctx, RUTA_AGG_TIPO_GASTO);

  if (args.tipos === true) {
    const catalogo = listar(general, 'catalogo');
    if (catalogo.length === 0) {
      return { error: 'la libreta general de tipos de gasto no está en el espejo; el catálogo 606 es 01-11 y se elige por la naturaleza del documento' };
    }
    return { tipos_gasto_606: catalogo, nota: 'uno por DOCUMENTO (cabecera). La cuenta contable es otro eje, por renglón' };
  }

  if (typeof args.cuenta === 'string' && args.cuenta.trim() !== '') {
    const codigo = args.cuenta.trim();
    const c = listar(agg, 'cuentas').find((x) => String(x.codigo ?? '') === codigo);
    if (!c) {
      return {
        cuenta: codigo,
        usada: false,
        nota: `la cuenta ${codigo} no aparece usada en el histórico`,
        cuentas_en_uso: listar(agg, 'cuentas').map((x) => ({ codigo: x.codigo, nombre: x.nombre, usos: x.usos })),
      };
    }
    return { cuenta: c };
  }

  const termino = String(args.rnc ?? args.termino ?? '').trim();
  if (termino === '') {
    return { error: 'buscar_precedente necesita termino, rnc, cuenta, plan o tipos:true' };
  }
  if (!agg) {
    return {
      error: 'el espejo agg de proveedores no está en el bucket: sin él NO hay precedente que citar',
      instruccion: 'no inventes una categoría (ADM no las tiene): clasificá por la naturaleza del renglón contra el plan VIVO (leer_adm{plan_cuentas}) con metodo="razonado"',
      libro: await delLibro(ctx, termino),
    };
  }

  const { fuertes, debiles, porRnc } = buscar(proveedoresDe(agg), termino);
  const libro = await delLibro(ctx, termino);

  if (fuertes.length > 0) {
    return {
      proveedores: fuertes.slice(0, 5).map((p) => fichaProveedor(p, general, porRnc)),
      mas: Math.max(0, fuertes.length - 5),
      libro,
    };
  }

  const meta = (agg._meta ?? {}) as Dic;
  const salida: ResultadoTool = {
    etiqueta: 'SIN PRECEDENTE',
    termino,
    nota: `no aparece en las ${num(meta.n_facturas)} facturas históricas`,
    instruccion: 'no inventes una categoría: ADM no las tiene. Clasificá por la naturaleza del renglón eligiendo de las cuentas en uso (metodo="razonado") y el tipo de gasto del catálogo 606',
    cuentas_en_uso: listar(agg, 'cuentas').map((c) => ({
      codigo: c.codigo,
      nombre: c.nombre,
      usos: c.usos,
      n_proveedores: c.n_proveedores,
    })),
    libro,
  };
  if (debiles.length > 0) {
    salida.parecidos = {
      etiqueta: 'PARECIDOS DE NOMBRE',
      nota: 'NO son precedente, sólo comparten una palabra. Ignoralos salvo que sea el mismo negocio',
      proveedores: debiles.slice(0, 5).map((p) => ({
        nombre: p.nombre,
        facturas: p.facturas,
        cuenta: p.cuentas[0]?.codigo ?? null,
      })),
    };
  }
  return salida;
}
