// qualia-contable/libro.ts — la tool escribir_libro.
//
// El orden de escritura es FIJO y es del plan §4.5: (1) fila en `qualia_libro`,
// (2) archivo NUEVO en git por API de GitHub, (3) `ref_git` en la fila. La
// tabla es la fuente del retry — nunca se re-crea el archivo a ciegas (ya pasó
// en miniatura: archivo duplicado cuando el insert falló y el barrido re-corrió).
//
// `qualia_libro` no tiene columna `estado`, así que el `pendiente_git` del plan
// se representa con `ref_git IS NULL` — que es exactamente lo que qualia-salud
// ya cuenta como pendiente en su cuadre del libro.
//
// El texto sale de la plantilla de mesa/escribir-libro.py: este código ORDENA
// lo que ya se decidió, no decide. Y por la enmienda 1 del contrato, el DocID y
// el «Aprobó» NO los pasa el modelo: nacen de la fila.
//
// Env (secretos de Supabase, plan §4.6 — token fine-grained de UN repo con
// contents:write, sin workflows):
//   QUALIA_GITHUB_TOKEN · QUALIA_GITHUB_REPO (owner/repo) ·
//   QUALIA_GITHUB_RAMA (default main) · QUALIA_LIBRO_PREFIJO (ruta del libro
//   dentro del repo).

import { CtxTurno, ErrorGuard, ResultadoTool, round2 } from './tipos.ts';
import { filaFresca, frenoDeEscritura, insertarEventos } from './bus.ts';

type Dic = Record<string, unknown>;

const PREFIJO_DEFECTO = 'empresas/blackbox/hermes/libro-de-accion';
const RAMA_DEFECTO = 'main';
// Append-only: si el nombre choca, la entrada nueva vive al lado. Nunca se pisa.
const MAX_SUFIJOS = 5;

const dic = (v: unknown): Dic | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Dic) : null;

export function slug(texto: string, tope = 40): string {
  const s = texto
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, tope).replace(/-+$/, '') || 'sin-titulo';
}

const fmt = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function moneda(p: Dic): string {
  const simbolo = p.moneda === 'USD' ? 'US$' : 'RD$';
  const m = Number(p.monto);
  return Number.isFinite(m) ? `${simbolo}${fmt(m)}` : `${simbolo}?`;
}

/** decision_de() del fuente: las líneas resumidas como decisión contable. */
function decisionDe(p: Dic): string {
  const lineas = Array.isArray(p.lineas) ? (p.lineas as unknown[]).map(dic) : [];
  const partes: string[] = [];
  if (lineas.length > 0 && lineas[0] && 'precio' in (lineas[0] as Dic)) {
    const porCuenta = new Map<string, number>();
    for (const l of lineas) {
      if (!l) continue;
      const base = Number(l.precio) * Number(l.cantidad);
      if (!Number.isFinite(base)) continue;
      const clave = `${l.cuenta ?? ''} ${l.cuenta_nombre ?? ''}`.trim();
      porCuenta.set(clave, round2((porCuenta.get(clave) ?? 0) + base));
    }
    for (const [cuenta, base] of [...porCuenta.entries()].sort()) {
      partes.push(`${fmt(base)} → ${cuenta}`);
    }
  } else {
    for (const l of lineas) {
      if (!l) continue;
      const deb = Number(l.debito);
      const lado = Number.isFinite(deb) && deb !== 0
        ? `débito ${fmt(deb)}`
        : `crédito ${fmt(Number(l.credito) || 0)}`;
      partes.push(`${lado} → ${l.cuenta ?? ''} ${l.cuenta_nombre ?? ''}`.trimEnd());
    }
  }
  const tg = dic(p.tipo_gasto);
  let cabeza = `${p.documento_adm ?? 'documento'} ${moneda(p)}`;
  if (tg?.codigo) cabeza += `, tipo de gasto 606: ${tg.codigo} ${tg.nombre ?? ''}`.trimEnd();
  return partes.length === 0 ? cabeza : `${cabeza}. Renglones: ${partes.join('; ')}`;
}

/** La decisión de un criterio ratificado: su regla, que es lo que se aprobó. */
function decisionDeCriterio(p: Dic): string {
  const reglas = Array.isArray(p.reglas) ? (p.reglas as unknown[]).map(dic) : [];
  const r = reglas[0];
  if (!r) return 'Criterio ratificado por la mesa.';
  return `Criterio ratificado — ${r.titulo ?? ''}: ${r.enunciado ?? ''}`.trim();
}

// ── GitHub ──────────────────────────────────────────────────────────────────

function base64(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

interface SalidaGit {
  ref_git: string | null;
  nombre: string | null;
  error: string | null;
}

/**
 * Crea el archivo en git. NUNCA actualiza uno existente: el PUT va sin `sha`,
 * así que si el path ya existe GitHub responde 422 y acá se prueba el nombre
 * siguiente. Editar una entrada del libro es un error, no un cambio (regla 2
 * del repo), y por eso ni se implementa.
 */
async function crearEnGit(nombreBase: string, entrada: string, mensaje: string): Promise<SalidaGit> {
  const token = Deno.env.get('QUALIA_GITHUB_TOKEN');
  const repo = Deno.env.get('QUALIA_GITHUB_REPO');
  if (!token || !repo) {
    return {
      ref_git: null,
      nombre: null,
      error: 'sin QUALIA_GITHUB_TOKEN/QUALIA_GITHUB_REPO: la entrada queda en la tabla como pendiente_git (ref_git null) y el barrido la reintenta',
    };
  }
  const prefijo = (Deno.env.get('QUALIA_LIBRO_PREFIJO') ?? PREFIJO_DEFECTO).replace(/\/+$/, '');
  const rama = Deno.env.get('QUALIA_GITHUB_RAMA') ?? RAMA_DEFECTO;

  for (let n = 1; n <= MAX_SUFIJOS; n++) {
    const nombre = n === 1 ? `${nombreBase}.md` : `${nombreBase}-${n}.md`;
    const ruta = `${prefijo}/${nombre}`;
    let r: Response;
    try {
      r = await fetch(
        `https://api.github.com/repos/${repo}/contents/${ruta.split('/').map(encodeURIComponent).join('/')}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: mensaje, content: base64(entrada), branch: rama }),
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch (e) {
      return { ref_git: null, nombre: null, error: `GitHub no respondió: ${e instanceof Error ? e.name : 'error'}` };
    }
    if (r.ok) return { ref_git: `libro-de-accion/${nombre}`, nombre, error: null };
    // 422 = el path ya existe. Cualquier otro código es un problema real
    // (permiso, repo, rama) y reintentar con otro nombre solo lo esconde.
    const cuerpo = (await r.text().catch(() => '')).slice(0, 200);
    if (r.status !== 422) {
      return { ref_git: null, nombre: null, error: `GitHub HTTP ${r.status}: ${cuerpo}` };
    }
  }
  return { ref_git: null, nombre: null, error: `los ${MAX_SUFIJOS} nombres candidatos ya existen en el libro` };
}

// ── el orden de escritura, para todo el que escriba libro ───────────────────

export interface EntradaLibro {
  /**
   * El trabajo que esta entrada cierra, o null cuando la entrada NO cierra un
   * trabajo (el precedente de brecha de ITBIS: nace de una respuesta del humano
   * sobre una factura que sigue viva y que después tendrá su propia entrada).
   *
   * No es un detalle: el barrido de «registrada sin libro» marca cerrado por la
   * EXISTENCIA de una fila con ese `trabajo_id`, así que colgarle el precedente
   * al trabajo le robaría al documento su entrada de verdad.
   */
  trabajoId: string | null;
  entrada: string;
  nombreBase: string;
  mensajeCommit: string;
  metodo: string;
  precedenteRef: string | null;
  aprobadoPor: string;
}

/**
 * El orden FIJO del plan §4.5: (1) fila en `qualia_libro`, (2) archivo NUEVO en
 * git, (3) `ref_git` en la fila. La tabla es la fuente del retry — nunca se
 * re-crea el archivo a ciegas.
 */
export async function guardarEntrada(
  ctx: CtxTurno,
  e: EntradaLibro,
): Promise<{ libro_id: unknown; ref_git: string | null; pendiente_git: boolean; aviso: string | null }> {
  const { data: inserta, error: eIns } = await ctx.db
    .from('qualia_libro')
    .insert({
      empresa_id: ctx.empresaId,
      trabajo_id: e.trabajoId,
      entrada: e.entrada,
      metodo: e.metodo,
      precedente_ref: e.precedenteRef,
      aprobado_por_nombre: e.aprobadoPor,
      ref_git: null, // = pendiente_git
    })
    .select('id')
    .single();
  if (eIns || !inserta) {
    throw new ErrorGuard(`no pude insertar la entrada en qualia_libro: ${eIns?.message ?? 'sin fila'}`);
  }

  const git = await crearEnGit(e.nombreBase, e.entrada, e.mensajeCommit);
  if (git.ref_git) {
    const { error: eUpd } = await ctx.db
      .from('qualia_libro')
      .update({ ref_git: git.ref_git })
      .eq('id', inserta.id);
    if (eUpd) {
      console.error(`libro ${inserta.id}: archivo creado pero ref_git no se guardó (${eUpd.message})`);
    }
  }
  return {
    libro_id: inserta.id,
    ref_git: git.ref_git,
    pendiente_git: git.ref_git === null,
    aviso: git.error,
  };
}

// ── la tool ─────────────────────────────────────────────────────────────────

export interface ArgsLibro {
  titulo?: unknown;
  caso?: unknown;
  por_que?: unknown;
  sosten?: unknown;
  alcance?: unknown;
}

export async function escribirLibro(ctx: CtxTurno, args: ArgsLibro): Promise<ResultadoTool> {
  const fila = await filaFresca(ctx);

  // Guard duro: el caso es la PREGUNTA, no el asiento. Jamás va al libro.
  if (fila.tipo === 'caso') {
    throw new ErrorGuard('escribir_libro con tipo=caso: el caso no va al libro JAMÁS — es la pregunta, no el asiento');
  }

  const titulo = String(args.titulo ?? '').trim();
  const por_que = String(args.por_que ?? '').trim();
  const sosten = String(args.sosten ?? '').trim();
  const alcance = String(args.alcance ?? '').trim();
  const faltan = [
    titulo === '' ? 'titulo' : null,
    por_que === '' ? 'por_que' : null,
    sosten === '' ? 'sosten' : null,
    alcance === '' ? 'alcance' : null,
  ].filter(Boolean);
  if (faltan.length > 0) {
    return {
      error: `faltan campos de la entrada: ${faltan.join(', ')}`,
      nota: 'sin alcance la entrada documenta pero no automatiza, y el contable vuelve a preguntar lo mismo (SPEC 3)',
    };
  }

  // Idempotencia por trabajo_id: el barrido de «registrada sin libro»
  // re-dispara esto, y el segundo pase tiene que ser inofensivo.
  if (ctx.modo !== 'examen') {
    const { data: ya } = await ctx.db
      .from('qualia_libro')
      .select('id, ref_git')
      .eq('trabajo_id', ctx.trabajoId)
      .limit(1);
    if (ya && ya.length > 0) {
      return {
        ok: true,
        idempotente: true,
        ref_git: ya[0].ref_git,
        nota: ya[0].ref_git
          ? 'el libro YA tiene la entrada de este trabajo: no hago nada'
          : 'el libro YA tiene la fila pero sin ref_git (pendiente_git): el archivo lo reintenta el barrido, no se re-crea acá a ciegas',
      };
    }
  }

  const propuesta = dic(fila.propuesta) ?? {};
  const registro = dic(propuesta.registro_adm) ?? {};
  const docid = String(registro.docid ?? '').trim();
  const aprobo = String(fila.aprobado_por_nombre ?? '').trim();
  const esCriterio = fila.tipo === 'criterio';

  // Enmienda 1: el docid y el aprobó SIEMPRE de la fila, jamás del modelo.
  if (!aprobo) {
    return {
      error: 'la fila no tiene `aprobado_por_nombre`: el campo Aprobó no es decorativo (SPEC 19) y es lo único que permite reconstruir de dónde salió un criterio',
    };
  }
  if (!esCriterio && !docid) {
    return {
      error: 'la fila no tiene `registro_adm.docid`: sin documento no hay entrada — una entrada sin documento es peor que ninguna',
      instruccion: 'cerrá con responder avisando que falta el registro; el DocID lo pone la pieza que registra, no vos',
    };
  }
  // El estado que cada tipo tiene cuando le toca libro: registrada para lo que
  // se asienta en ADM; aprobada para el criterio, que no tiene DocID ni lo va a
  // tener (el CHECK de la base impide marcarlo registrada) y va al libro POR
  // REGLA al ratificarse (contrato §3.1).
  const estadoEsperado = esCriterio ? 'aprobada' : 'registrada';
  if (fila.estado !== estadoEsperado) {
    return {
      error: `la fila está en '${fila.estado}' y la entrada de libro de un ${fila.tipo} se escribe desde '${estadoEsperado}'`,
    };
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const proveedor = String(propuesta.proveedor ?? fila.resumen ?? 'documento');
  const caso = String(args.caso ?? '').trim() ||
    String(fila.resumen ?? `${propuesta.documento_adm ?? 'documento'} de ${proveedor}`);
  const decision = esCriterio
    ? decisionDeCriterio(propuesta)
    : `${decisionDe(propuesta)} DocID ${docid}.`;

  const entrada = `# ${titulo}

- **Fecha:** ${hoy}
- **Caso:** ${caso}
- **Decisión:** ${decision}
- **Por qué:** ${por_que}
- **Sostén:** ${sosten}
- **Aprobó:** ${aprobo}, por la mesa web
- **Alcance:** ${alcance}
- **Deroga:** —
`;

  const nombreBase = esCriterio
    ? `${hoy}-criterio-${slug(titulo)}`
    : `${hoy}-${slug(proveedor)}-${slug(docid, 20)}`;

  const freno = await frenoDeEscritura(ctx, 'escribir_libro', {
    tabla: 'qualia_libro',
    trabajo_id: ctx.trabajoId,
    entrada,
    metodo: propuesta.metodo ?? (esCriterio ? 'criterio' : 'razonado'),
    precedente_ref: propuesta.precedente_ref ?? null,
    aprobado_por_nombre: aprobo,
    archivo_git: `${nombreBase}.md`,
    docid: docid || null,
  });
  if (freno) return freno;

  const guardada = await guardarEntrada(ctx, {
    trabajoId: ctx.trabajoId,
    entrada,
    nombreBase,
    mensajeCommit: `libro(${esCriterio ? 'criterio' : docid}): ${titulo.slice(0, 60)}`,
    metodo: String(propuesta.metodo ?? (esCriterio ? 'criterio' : 'razonado')),
    precedenteRef: (propuesta.precedente_ref as string | null | undefined) ?? null,
    aprobadoPor: aprobo,
  });

  await insertarEventos(ctx, ctx.trabajoId, [{
    tipo: 'progreso',
    contenido: guardada.ref_git
      ? `📖 Entrada del libro escrita: ${guardada.ref_git}`
      : '📖 Entrada del libro guardada en la mesa; el archivo en git queda pendiente',
    datos: { libro_id: guardada.libro_id, ref_git: guardada.ref_git },
  }]);

  return { ok: true, ...guardada };
}
