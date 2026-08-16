// qualia-contable/tipos.ts — tipos y helpers compartidos por las tools del
// turno (docs/contrato-turno.md). Vive aparte de tools.ts para que los módulos
// (adm, precedentes, consultas, libro, validar) no importen en círculo.

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

export const FUNCION = 'qualia-contable';

// El modo del pipeline (server|sombra|nube, _shared/db.ts) más 'examen': el
// runner del corpus dorado invoca el turno con CERO escrituras a cualquier
// tabla y CERO pokes — toda escritura se devuelve en la respuesta HTTP como
// {simulado: true, efecto}.
export type ModoTurno = 'server' | 'sombra' | 'nube' | 'examen';

// La fila de qualia_trabajos que el harness reclamó ANTES de invocar al
// modelo. Los identificadores del turno (trabajo_id, empresa_id, docid,
// aprobado_por_nombre) nacen SIEMPRE de acá, jamás de la salida del LLM.
export interface FilaTrabajo {
  id: string;
  empresa_id: string;
  tipo: string;
  origen: string;
  estado: string;
  archivo_nombre?: string | null;
  resumen?: string | null;
  propuesta?: Record<string, unknown> | null;
  aprobado_por_nombre?: string | null;
  error_detalle?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Evento del hilo tal como lo manda el corpus (qualia-examen/index.ts). */
export interface EventoExamen {
  fecha?: string;
  autor: string;
  tipo: string;
  texto: string;
}

/**
 * Snapshot que el runner del corpus pasa en modo examen para reconstruir el
 * punto de entrada histórico. `dossier` reemplaza entera la respuesta de
 * dossier_completo; `respuestas` mapea claveExamen(nombre, args) → respuesta
 * de una tool de LECTURA (leer_adm, consultar_banco, buscar_precedente,
 * consultar_dgii). Una lectura sin entrada en el snapshot va a la fuente real
 * (todas son solo-lectura); una ESCRITURA en examen jamás toca nada.
 *
 * `trabajo_id`/`rama`/`estado`/`eventos` los manda qualia-examen y los sirve
 * dossier_completo: en examen el hilo NO se relee de la base — la fila
 * histórica ya tiene el desenlace adentro, y leerla sería copiarse la
 * respuesta del examen.
 */
export interface SnapshotExamen {
  trabajo_id?: string;
  rama?: string;
  estado?: string;
  eventos?: EventoExamen[];
  dossier?: Record<string, unknown> | null;
  respuestas?: Record<string, unknown>;
}

export interface CtxTurno {
  db: SupabaseClient;
  empresaId: string;
  trabajoId: string;
  fila: FilaTrabajo;
  modo: ModoTurno;
  examen?: SnapshotExamen;
}

export type ResultadoTool = Record<string, unknown>;

/**
 * Guard de estado que NO matcheó: la tool revienta con el motivo en vez del
 * «UPDATE 0» silencioso (la trampa que ya mordió dos veces, contrato §2). El
 * harness lo trata como fatal — «si perdiste el claim, PARÁ» — a diferencia de
 * un ResultadoTool con `error`, que vuelve al modelo para que corrija.
 */
export class ErrorGuard extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'ErrorGuard';
  }
}

/** Clave canónica del snapshot de examen: nombre + args con claves ordenadas. */
export function claveExamen(nombre: string, args: Record<string, unknown>): string {
  const claves = Object.keys(args).filter((k) => args[k] !== undefined).sort();
  const orden: Record<string, unknown> = {};
  for (const k of claves) orden[k] = args[k];
  return `${nombre}:${JSON.stringify(orden)}`;
}

/** Lectura servida del snapshot si está; null = no está, andá a la fuente. */
export function delExamen(
  ctx: CtxTurno,
  nombre: string,
  args: Record<string, unknown>,
): ResultadoTool | null {
  if (ctx.modo !== 'examen' || !ctx.examen?.respuestas) return null;
  const v = ctx.examen.respuestas[claveExamen(nombre, args)];
  return v === undefined ? null : (v as ResultadoTool);
}

// ── topes de volcado (los del router, contrato §5) ──────────────────────────

export const TOPE_PROPUESTA_BYTES = 4_000;
export const TOPE_EVENTO_CHARS = 800;
export const TOPE_TEXTO_CHARS = 12_000; // texto.txt del cache; ~3k tokens

export function recortar(s: string, tope: number): string {
  if (s.length <= tope) return s;
  return `${s.slice(0, tope)}… [recortado: ${s.length} chars]`;
}

/**
 * La propuesta capada a 4.000 bytes «con claves y tamaño si excede» (tope del
 * router). Para no dejar ciego al modelo (la propuesta de un caso trae el plan
 * entero), las claves chicas viajan con su valor y solo las gordas quedan como
 * marcador de tamaño.
 */
export function caparPropuesta(p: unknown): unknown {
  if (p === null || p === undefined) return null;
  const s = JSON.stringify(p);
  if (s.length <= TOPE_PROPUESTA_BYTES) return p;
  if (typeof p !== 'object' || Array.isArray(p)) {
    return { _recortada: true, _bytes: s.length };
  }
  const capada: Record<string, unknown> = {
    _recortada: true,
    _bytes: s.length,
    _nota: `propuesta > ${TOPE_PROPUESTA_BYTES} bytes (tope del armador): las claves gordas van como "<recortada: N bytes>"`,
  };
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    const vs = JSON.stringify(v) ?? 'null';
    capada[k] = vs.length <= 1_200 ? v : `<recortada: ${vs.length} bytes>`;
  }
  return capada;
}

export const round2 = (x: number): number =>
  Math.round((x + Number.EPSILON) * 100) / 100;

export const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Solo los dígitos de un RNC/cédula, para comparar como compara ADM. */
export const soloDigitos = (s: unknown): string => String(s ?? '').replace(/\D/g, '');
