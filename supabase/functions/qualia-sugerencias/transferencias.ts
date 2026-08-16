// Sugerencias de transferencias entre cuentas propias — port fiel de
// empresas/blackbox/hermes/scripts/sugerir-transferencias.sh (cron de Hermes,
// CERO tokens). Hermano de cargos.ts.
//
// Mover plata de una cuenta propia a otra no es ingreso ni gasto, pero SÍ es
// un documento que la contabilidad tiene que registrar: en ADM es una
// "Transferencia Banco a Banco" (BankBankTransfers). El banco la reporta como
// DOS movimientos —un débito en la cuenta que da y un crédito en la que
// recibe— y la mesa los muestra como UNA sola fila.
//
// LA SEÑAL: las dos patas comparten el `nro_referencia` del banco. No se
// empareja por monto y fecha (eso confunde dos pagos iguales del mismo día);
// sólo se acepta una referencia que describa UN movimiento: exactamente una
// salida, exactamente una entrada, en dos cuentas distintas. Una referencia
// con más patas es otra cosa (un cargo y su impuesto comparten referencia en
// Santa Cruz) y se descarta entera.
//
// ANTI-DUPLICADO, dos capas:
//   1) contra la mesa: ninguna de las dos patas puede estar ya reclamada por
//      un trabajo (las 5 llaves de reclamo — ver clavesReclamadas).
//   2) contra ADM: el espejo de BankBankTransfers dice qué transferencias ya
//      están registradas. Sin esta capa el detector propondría de nuevo lo que
//      la contabilidad ya asentó — medido el 2026-08-03: 8 de 11 pares del mes
//      ya estaban en ADM. Si el espejo falta, se AVISA y no se siembra nada
//      (mejor callado que duplicando).
//
// Aprobar NO registra en ADM todavía: asienta la decisión en el libro.

import { registrarSombra } from '../_shared/sombra.ts';
import {
  c2,
  cargarMapaCuentas,
  clavesReclamadas,
  Cliente,
  ConteoDetector,
  conteoVacio,
  CuentaMapa,
  descargarEspejo,
  difDias,
  filasJsonlTolerante,
  fmtMonto,
  fmtTasa,
  hoyUTC,
  Modo,
  paginar,
  pyRoundN,
  restarDias,
  stripNulls,
} from './comun.ts';

// Días hacia atrás que se miran. Las patas se leen con margen extra: una
// transferencia cuyo crédito cae un día después del corte quedaría con una
// sola pata visible y la referencia se descartaría por "incompleta".
const DIAS_DEFAULT = 30;
const MARGEN = 5;

interface Pata {
  id: string;
  accountId: string;
  numero: string;
  cuentaBanco: string | null;
  moneda: string | null;
  banco: string | null;
  fecha: string;
  monto: number;
  descripcion: string | null;
  ref: string;
}

export async function detectarTransferencias(
  cliente: Cliente,
  empresaId: string,
  modo: Modo,
  opciones: { dias?: number } = {},
): Promise<ConteoDetector> {
  const dias = opciones.dias ?? DIAS_DEFAULT;
  const hoy = hoyUTC(); // el fuente comparaba contra current_date de Postgres (UTC)

  // ── Cuenta contable de cada cuenta bancaria (mapa-cuentas.yaml) ───────────
  const bloque = await cargarMapaCuentas(cliente, empresaId);
  const bancosGl = new Map<string, { gl: string; nombre: string | null }>();
  for (const cta of (bloque.cuentas as CuentaMapa[] | undefined) ?? []) {
    if (cta.numero && cta.cuenta_contable) {
      bancosGl.set(String(cta.numero), {
        gl: cta.cuenta_contable,
        nombre: cta.cuenta_nombre ?? cta.alias ?? null,
      });
    }
  }

  // ── Lo que ADM ya tiene registrado (capa 2 del anti-duplicado) ────────────
  // Sin espejo no se siembra: proponer a ciegas duplica asientos, y un asiento
  // duplicado en el banco no lo frena nadie (ADM no valida transferencias
  // repetidas). Se aborta con aviso, igual que el exit 2 del fuente.
  const textoCuentas = await descargarEspejo(cliente, empresaId, 'accounts.jsonl');
  const textoEspejo = await descargarEspejo(cliente, empresaId, 'bank-transfers-detalle.jsonl');
  if (textoCuentas === null || textoEspejo === null) {
    return conteoVacio([
      'no puedo leer el espejo de transferencias de ADM (accounts.jsonl / ' +
      'bank-transfers-detalle.jsonl en el bucket); no siembro nada',
    ]);
  }

  const codigoDeCuenta = new Map<string, string | null>();
  for (const d of filasJsonlTolerante(textoCuentas)) {
    if (d.ID) codigoDeCuenta.set(String(d.ID), (d.Code as string) ?? null);
  }

  const registradas: {
    fecha: string;
    montoOrigen: number;
    montoDestino: number;
    ctaOrigen: string | null;
    ctaDestino: string | null;
  }[] = [];
  for (const d of filasJsonlTolerante(textoEspejo)) {
    const fecha = String(d.DocDate ?? '').slice(0, 10);
    if (!fecha || d.Void) continue;
    registradas.push({
      fecha,
      montoOrigen: c2(d.TotalAmount),
      montoDestino: c2(d.ToAmount),
      ctaOrigen: codigoDeCuenta.get(String(d.CashAccountID)) ?? null,
      ctaDestino: codigoDeCuenta.get(String(d.DebitAccountID)) ?? null,
    });
  }
  if (registradas.length === 0) {
    return conteoVacio(['el espejo de transferencias de ADM está vacío; no siembro nada']);
  }

  // ── Las patas: movimientos con referencia, ventana con margen ─────────────
  const crudas = await paginar<Record<string, unknown>>((desde, hasta) =>
    cliente
      .from('openbanking_transactions')
      .select(
        'id, account_id, fecha_posteo, monto, descripcion, nro_referencia, ' +
          'cuenta:openbanking_accounts!inner(numero, nombre, moneda, banco, empresa_id)',
      )
      .eq('cuenta.empresa_id', empresaId)
      .gte('fecha_posteo', restarDias(hoy, dias + MARGEN))
      .not('nro_referencia', 'is', null)
      .order('id')
      .range(desde, hasta)
  );

  const patas: Pata[] = [];
  for (const t of crudas) {
    const ref = String(t.nro_referencia ?? '').trim();
    if (!ref) continue; // nullif(trim(...), '') del fuente
    const cta = t.cuenta as Record<string, unknown>;
    const desc = t.descripcion == null ? null : String(t.descripcion).trim();
    patas.push({
      id: String(t.id),
      accountId: String(t.account_id),
      numero: String(cta.numero ?? ''),
      cuentaBanco: (cta.nombre as string) ?? null,
      moneda: (cta.moneda as string) ?? null,
      banco: (cta.banco as string) ?? null,
      fecha: String(t.fecha_posteo),
      monto: Number(t.monto),
      descripcion: desc,
      ref,
    });
  }

  // Una referencia sirve sólo si describe UN movimiento entre DOS cuentas.
  const porRef = new Map<string, Pata[]>();
  for (const p of patas) {
    const grupo = porRef.get(p.ref) ?? [];
    grupo.push(p);
    porRef.set(p.ref, grupo);
  }

  const corte = restarDias(hoy, dias);
  const reclamadas = await clavesReclamadas(cliente, empresaId);

  const pares = [];
  for (const grupo of porRef.values()) {
    const salidas = grupo.filter((p) => p.monto < 0);
    const entradas = grupo.filter((p) => p.monto > 0);
    const cuentas = new Set(grupo.map((p) => p.accountId));
    if (salidas.length !== 1 || entradas.length !== 1 || cuentas.size !== 2) continue;
    const [s, e] = [salidas[0], entradas[0]];
    if (s.fecha < corte || Math.abs(difDias(e.fecha, s.fecha)) > 3) continue;

    // Capa 1: ninguna de las dos patas puede estar ya reclamada.
    if (reclamadas.has(s.id) || reclamadas.has(e.id)) continue;

    const origenGl = bancosGl.get(s.numero) ?? null;
    const destinoGl = bancosGl.get(e.numero) ?? null;
    const montoOrigen = Math.abs(s.monto);
    const montoDestino = e.monto;
    const cambiaMoneda = s.moneda !== e.moneda; // is distinct from (los null cuentan)
    // El asiento se escribe en pesos: si un lado es DOP, ése manda.
    const montoAsiento = s.moneda === 'DOP'
      ? montoOrigen
      : e.moneda === 'DOP'
      ? montoDestino
      : montoOrigen;
    // La tasa es aritmética, no criterio: pesos entre dólares. Denominador 0
    // deja la tasa en null (el nullif del fuente).
    let tasa: number | null = null;
    if (cambiaMoneda) {
      const dop = s.moneda === 'DOP' ? montoOrigen : montoDestino;
      const otra = s.moneda === 'DOP' ? montoDestino : montoOrigen;
      tasa = otra === 0 ? null : pyRoundN(dop / otra, 4);
    }
    pares.push({
      salida: s, entrada: e,
      origenGl, destinoGl, montoOrigen, montoDestino, cambiaMoneda, montoAsiento, tasa,
    });
  }

  // Capa 2: fuera lo que ADM ya asentó (fecha ±5, montos al centavo, y las
  // cuentas sólo cuando los DOS lados las conocen).
  const nuevos = pares
    .filter((p) =>
      !registradas.some((r) =>
        Math.abs(difDias(r.fecha, p.salida.fecha)) <= 5 &&
        Math.abs(r.montoOrigen - p.montoOrigen) < 0.01 &&
        Math.abs(r.montoDestino - p.montoDestino) < 0.01 &&
        (r.ctaOrigen == null || p.origenGl == null || r.ctaOrigen === p.origenGl.gl) &&
        (r.ctaDestino == null || p.destinoGl == null || r.ctaDestino === p.destinoGl.gl)
      )
    )
    .sort((a, b) => a.salida.fecha.localeCompare(b.salida.fecha))
    .slice(0, 40);

  // ── Armar las filas ───────────────────────────────────────────────────────
  const filas = nuevos.map((n) => {
    const s = n.salida;
    const e = n.entrada;
    const origenEtiqueta = s.cuentaBanco ?? s.numero;
    const destinoEtiqueta = e.cuentaBanco ?? e.numero;
    const sigOrigen = s.moneda === 'USD' ? 'US$' : 'RD$';
    const sigDestino = e.moneda === 'USD' ? 'US$' : 'RD$';
    const [dd, mm] = [s.fecha.slice(8, 10), s.fecha.slice(5, 7)];

    const resumen =
      `Transferencia entre cuentas ${dd}/${mm}: ${origenEtiqueta} → ${destinoEtiqueta}` +
      ` — ${sigOrigen}${fmtMonto(n.montoOrigen)}` +
      (n.cambiaMoneda ? ` → ${sigDestino}${fmtMonto(n.montoDestino)}` : '') +
      ` (${s.banco ?? ''})`;

    let detalle: string | null;
    if (n.origenGl == null || n.destinoGl == null) {
      detalle =
        `FALTA UNA CUENTA EN EL MAPA — la cuenta bancaria ` +
        `${n.origenGl == null ? s.numero : e.numero} no está en mapa-cuentas.yaml, ` +
        `así que no se puede armar el asiento. Completala y volvé a correr el detector.`;
    } else if (n.cambiaMoneda) {
      // Si la tasa quedó null (destino en 0), el fuente dejaba el detalle en
      // null por propagación del || de SQL; se respeta.
      detalle = n.tasa == null ? null :
        `Se registrará en ADM como Transferencia Banco a Banco con cambio de moneda: ` +
        `sale ${fmtMonto(n.montoOrigen)} ${s.moneda} de ${n.origenGl.gl} ${n.origenGl.nombre} ` +
        `y entran ${fmtMonto(n.montoDestino)} ${e.moneda} a ${n.destinoGl.gl} ${n.destinoGl.nombre}. ` +
        `Tasa implícita del banco: ${fmtTasa(n.tasa)} RD$ por US$ — verificala contra la tasa ` +
        `del libro antes de aprobar; si difieren, la diferencia cambiaria es una partida aparte.`;
    } else {
      detalle =
        `Se registrará en ADM como Transferencia Banco a Banco: débito a ` +
        `${n.destinoGl.gl} ${n.destinoGl.nombre}, crédito a ${n.origenGl.gl} ${n.origenGl.nombre}. ` +
        `Las dos patas del banco comparten la referencia ${s.ref}, ` +
        `así que el par no es una coincidencia de monto.`;
    }

    const propuesta = stripNulls({
      documento_adm: 'BankBankTransfers',
      banco_tx_ids: [s.id, e.id],
      nro_referencia: s.ref,
      fecha: s.fecha,
      banco: s.banco,
      // Cabecera: lo que salió. Es lo que la tabla de la mesa ordena y suma.
      monto: n.montoOrigen,
      moneda: s.moneda,
      descripcion: `Transferencia ${origenEtiqueta} → ${destinoEtiqueta}`,
      origen: {
        cuenta_banco: s.cuentaBanco ?? '',
        cuenta_numero: s.numero,
        moneda: s.moneda,
        monto: n.montoOrigen,
        cuenta: n.origenGl?.gl ?? null,
        cuenta_nombre: n.origenGl?.nombre ?? null,
        descripcion: s.descripcion,
        banco_tx_id: s.id,
      },
      destino: {
        cuenta_banco: e.cuentaBanco ?? '',
        cuenta_numero: e.numero,
        moneda: e.moneda,
        monto: n.montoDestino,
        cuenta: n.destinoGl?.gl ?? null,
        cuenta_nombre: n.destinoGl?.nombre ?? null,
        descripcion: e.descripcion,
        banco_tx_id: e.id,
      },
      cambio_moneda: n.cambiaMoneda,
      tasa: n.tasa,
      metodo: 'script',
      confianza: n.origenGl == null || n.destinoGl == null ? 0.4 : n.cambiaMoneda ? 0.6 : 0.9,
      // Partida doble en pesos: entra la cuenta que recibe, sale la que da.
      lineas: n.origenGl != null && n.destinoGl != null
        ? [
          {
            cuenta: n.destinoGl.gl,
            cuenta_nombre: n.destinoGl.nombre,
            descripcion: `Entra a ${destinoEtiqueta}`,
            debito: n.montoAsiento,
            credito: 0,
          },
          {
            cuenta: n.origenGl.gl,
            cuenta_nombre: n.origenGl.nombre,
            descripcion: `Sale de ${origenEtiqueta}`,
            debito: 0,
            credito: n.montoAsiento,
          },
        ]
        : null,
      detalle,
    });

    return { salidaId: s.id, entradaId: e.id, resumen, propuesta };
  });

  if (filas.length === 0) return conteoVacio();

  if (modo === 'sombra') {
    // Sólo qualia_sombra: la llave natural del par son sus dos patas.
    for (const f of filas) {
      await registrarSombra(
        'qualia-sugerencias',
        empresaId,
        `transferencias:${f.salidaId}:${f.entradaId}`,
        { resumen: f.resumen, propuesta: f.propuesta },
      );
    }
    return { detectadas: filas.length, sembradas: 0, actualizadas: 0, avisos: [] };
  }

  const { error } = await cliente.from('qualia_trabajos').insert(
    filas.map((f) => ({
      empresa_id: empresaId,
      tipo: 'sugerencia',
      origen: 'cron_conciliacion',
      estado: 'propuesta',
      resumen: f.resumen,
      propuesta: f.propuesta,
    })),
  );
  if (error) throw new Error(`insert qualia_trabajos: ${error.message}`);

  return { detectadas: filas.length, sembradas: filas.length, actualizadas: 0, avisos: [] };
}
