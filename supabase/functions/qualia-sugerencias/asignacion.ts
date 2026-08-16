// Asignación de pagos a facturas — port fiel de
// empresas/blackbox/hermes/scripts/sugerir-asignacion.sh (cron de Hermes,
// CERO tokens).
//
// El banco muestra que salió plata y NUNCA dice a quién. Lo que agrega valor
// es decir CONTRA QUÉ FACTURAS de ADM va ese pago: cuando lo logra, la fila
// deja de ser un misterio y pasa a ser un BillPayment listo para registrar.
//
// SÓLO HABLA CUANDO TIENE ALGO QUE DECIR. Un pago que no casa con nada no
// genera sugerencia — es lo que evita sembrar las ~47 salidas mensuales que el
// humano sube a ADM por rutina.
//
// EL ALGORITMO, y por qué estos cuatro intentos y no otros:
//   1.  una factura sola que dé el monto exacto;
//   2.  suma corrida desde la MÁS VIEJA — es como se paga de verdad, y es UNA
//       pasada, no una explosión combinatoria (TUPAQ tiene 47 abiertas: probar
//       subconjuntos serían 2^47);
//   2b. la corrida menos UNA del medio — «todas menos la que estaba en disputa»;
//   3.  corte por mes calendario — se paga el mes cerrado.
//
// LO QUE LO HACE SEGURO NO ES EL ALGORITMO, ES NO ELEGIR CUANDO HAY EMPATE.
// Backtest sobre los 729 pagos históricos (memoria/scripts/
// backtest-asignacion.py): 593 aciertos con candidato único, 20 ambiguos —y en
// los 20 la factura real estaba entre las listadas— y CERO equivocados. Sin la
// regla de ambigüedad se equivocaba en 7, TODOS de Isla Dominicana y Mecari:
// los que facturan montos redondos y repetidos, donde varias facturas
// distintas dan el mismo total. Si alguien saca esa regla, vuelven los 7 pagos
// aplicados a la factura equivocada.
//
// El saldo pendiente sale del espejo: TotalAmount - AppliedPayments de
// vendor-bills-detalle.jsonl. Si el refresco del espejo se rompe, las facturas
// ya pagadas vuelven a verse abiertas — es la falla a vigilar.

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
  filasJsonlEstricta,
  fmtMonto,
  Modo,
  paginar,
} from './comun.ts';

// Desde cuándo se miran las salidas del banco (mismo default del fuente:
// QUALIA_DESDE=2026-06-01, el piso de data bancaria completa).
const DESDE_DEFAULT = '2026-06-01';

// Los cargos del propio banco tienen su detector (cargos.ts) y su comprobante
// fiscal: no son pagos a proveedor y no se buscan acá.
const RE_CARGO_BANCO = /comisi|imp\.|manejo|mantenimiento|retenci|norma dgii|sobregiro/i;
// El pago de la tarjeta tampoco es un pago a proveedor: es la pata de una
// transferencia contra 203.11 Tarjeta Corporativa, y la mesa ya la empareja
// del lado de la tarjeta. Sin esta línea el algoritmo le encontraba 17 cargas
// de gasolina de 750 pesos que sumaban los 15.000 justos.
const RE_PAGO_TARJETA = /pago\s+(de\s+)?tarjeta/i;

interface Factura {
  docid: string;
  fecha: string;
  monto: number;
  moneda: string;
}

interface Grupo {
  metodo: string;
  facturas: Factura[];
}

/**
 * Lo que hace confiable una suma corrida NO es cuántas facturas son sino que
 * sus montos sean IRREGULARES: quince facturas de 282,66 / 706,68 / 220,76 que
 * cierran al centavo no pueden ser casualidad, pero veinte de RD$750 que dan
 * RD$15.000 cierran de mil maneras distintas y no prueban nada. Caso real: el
 * pago de la tarjeta casó con 17 cargas de gasolina de AXXON, todas de RD$750.
 * Un grupo así no se propone ni siquiera como candidato, porque no hay forma
 * de que el humano lo verifique.
 */
export function montosIrregulares(grupo: Factura[]): boolean {
  if (grupo.length < 3) return true;
  return new Set(grupo.map((f) => f.monto)).size / grupo.length >= 0.5;
}

/**
 * Todos los grupos que dan el objetivo, en orden de preferencia. Se devuelven
 * TODOS y no el primero: el empate es la información que hace segura la
 * propuesta, y descartarlo sería elegir por el humano.
 */
export function gruposQueCierran(facturas: Factura[], objetivo: number): Grupo[] {
  const salida: Grupo[] = [];
  const vistos = new Set<string>();

  const sumar = (metodo: string, grupo: Factura[]) => {
    const clave = grupo.map((f) => f.docid).sort().join('|');
    if (vistos.has(clave) || grupo.length === 0 || !montosIrregulares(grupo)) return;
    vistos.add(clave);
    salida.push({ metodo, facturas: grupo });
  };

  for (const f of facturas) {                              // 1 · exacta
    if (Math.abs(f.monto - objetivo) < 0.005) sumar('exacta', [f]);
  }

  let acc = 0;                                             // 2 · suma corrida
  const grupo: Factura[] = [];
  for (const f of facturas) {
    acc = c2(acc + f.monto);
    grupo.push(f);
    if (Math.abs(acc - objetivo) < 0.005) {
      sumar('corrida', [...grupo]);
      break;
    }
    if (acc > objetivo + 0.005) {
      for (const quitar of grupo.slice(0, -1)) {           // 2b · menos una
        if (Math.abs(c2(acc - quitar.monto) - objetivo) < 0.005) {
          sumar('corrida', grupo.filter((x) => x !== quitar));
        }
      }
      break;
    }
  }

  const meses = new Map<string, Factura[]>();              // 3 · corte por mes
  for (const f of facturas) {
    const mes = f.fecha.slice(0, 7);
    meses.set(mes, [...(meses.get(mes) ?? []), f]);
  }
  for (const mes of [...meses.keys()].sort()) {
    const g = meses.get(mes)!;
    if (Math.abs(c2(g.reduce((a, f) => a + f.monto, 0)) - objetivo) < 0.005) {
      sumar('periodo', g);
    }
  }
  return salida;
}

export async function detectarAsignacion(
  cliente: Cliente,
  empresaId: string,
  modo: Modo,
  opciones: { desde?: string } = {},
): Promise<ConteoDetector> {
  const desde = opciones.desde ?? DESDE_DEFAULT;

  // ── La cuenta contable del banco que pagó (mapa-cuentas.yaml) ─────────────
  // Es la ÚNICA que hay que confirmar: en las 671 registradas, ADM debita
  // "Cuentas por Pagar Proveedores" —que deriva del proveedor y no tiene
  // código en el plan— y acredita el banco. Inventarle un código al debe sería
  // adivinar; el haber sí es una decisión, y por eso viaja.
  // El número NO es siempre dígitos: las tarjetas entran como
  // "407537XXXXXX1877-DOP" — se toma el token entero, jamás un prefijo.
  const bloque = await cargarMapaCuentas(cliente, empresaId);
  const bancos = new Map<string, string>();
  for (const cta of (bloque.cuentas as CuentaMapa[] | undefined) ?? []) {
    if (cta.numero && cta.cuenta_contable) bancos.set(String(cta.numero), cta.cuenta_contable);
  }

  // ── Los candidatos: salidas pendientes que ninguna propuesta reclamó ──────
  // Las llaves de reclamo son tipos de documento distintos y hay que mirarlas
  // TODAS (las 5 del contrato F1) — con sólo `banco_tx_id` se colaban las que
  // ampara un NCF y las dos patas de una transferencia.
  const reclamadas = await clavesReclamadas(cliente, empresaId);
  const crudos = await paginar<Record<string, unknown>>((d, h) =>
    cliente
      .from('openbanking_transactions')
      .select(
        'id, fecha_posteo, monto, descripcion, nro_referencia, ' +
          'cuenta:openbanking_accounts!inner(banco, nombre, numero, moneda, tipo, empresa_id)',
      )
      .eq('cuenta.empresa_id', empresaId)
      .eq('estado_conciliacion', 'pendiente')
      .lt('monto', 0)
      .gte('fecha_posteo', desde)
      .order('id')
      .range(d, h)
  );

  const candidatos = [];
  for (const t of crudos) {
    const cta = t.cuenta as Record<string, unknown>;
    if (cta.tipo === 'tarjeta') continue; // is distinct from: el tipo null pasa
    // En SQL `null !~* ...` excluye la fila: sin descripción no hay candidato.
    if (t.descripcion == null) continue;
    const desc = String(t.descripcion);
    if (RE_CARGO_BANCO.test(desc) || RE_PAGO_TARJETA.test(desc)) continue;
    if (reclamadas.has(String(t.id))) continue;
    candidatos.push({
      id: String(t.id),
      fecha: String(t.fecha_posteo),
      monto: Math.abs(Number(t.monto)),
      descripcion: desc,
      referencia: (t.nro_referencia as string) ?? null,
      banco: (cta.banco as string) ?? null,
      cuentaBanco: (cta.nombre as string) ?? null,
      cuentaNumero: cta.numero == null ? null : String(cta.numero),
      moneda: (cta.moneda as string) ?? null,
    });
  }
  if (candidatos.length === 0) return conteoVacio();

  // ── Las facturas que siguen abiertas, por proveedor ───────────────────────
  // Parser ESTRICTO a propósito: en el fuente una línea rota mataba el script
  // y no se sembraba nada. Un espejo a medias puede convertir un empate en
  // "candidato único" y proponer con confianza algo sin verificar.
  const textoBills = await descargarEspejo(cliente, empresaId, 'vendor-bills-detalle.jsonl');
  if (textoBills === null) {
    throw new Error('no puedo leer el espejo vendor-bills-detalle.jsonl del bucket');
  }
  // Map y no objeto: el orden de inserción (el del archivo) decide quién es
  // `mejor` cuando hay un solo grupo — igual que el dict de Python.
  const abiertas = new Map<string | null, Factura[]>();
  const nombreProv = new Map<string | null, string>();
  for (const fila of filasJsonlEstricta(textoBills)) {
    const d = fila.data as Record<string, unknown> | null | undefined;
    if (d == null) throw new Error('línea del espejo sin `data`'); // KeyError del fuente
    if (d.Void) continue;
    const pendiente = c2(c2(d.TotalAmount) - c2(d.AppliedPayments));
    if (pendiente <= 0.005) continue;
    const prov = (d.RelationshipID as string) ?? null;
    if (!nombreProv.has(prov)) nombreProv.set(prov, (d.Beneficiary as string) ?? '');
    const lista = abiertas.get(prov) ?? [];
    // KeyError del fuente: una factura sin DocID/DocDate mata el detector
    // entero — un espejo a medias puede convertir un empate en "candidato
    // único" y sembrar con confianza algo sin verificar.
    if (d.DocID == null || d.DocDate == null) {
      throw new Error('factura sin DocID/DocDate en el espejo vendor-bills-detalle.jsonl');
    }
    lista.push({
      docid: String(d.DocID),
      fecha: String(d.DocDate).slice(0, 10),
      monto: pendiente,
      moneda: (d.CurrencyID as string) || 'DOP',
    });
    abiertas.set(prov, lista);
  }
  for (const lista of abiertas.values()) {
    lista.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.docid.localeCompare(b.docid));
  }

  // ── El cruce ──────────────────────────────────────────────────────────────
  const filas = [];
  for (const mov of candidatos) {
    const objetivo = c2(mov.monto);
    const hallados = [];
    for (const [prov, facturas] of abiertas) {
      // Sólo facturas ANTERIORES al pago y de la misma moneda: pagar una
      // factura que todavía no existía es imposible, y cruzar monedas sin
      // tasa sería inventar el monto.
      const cands = facturas.filter(
        (f) => f.fecha <= mov.fecha && f.moneda === (mov.moneda || 'DOP'),
      );
      for (const g of gruposQueCierran(cands, objetivo)) {
        hallados.push({
          proveedor: (nombreProv.get(prov) ?? '').slice(0, 60),
          metodo: g.metodo,
          suma: c2(g.facturas.reduce((a, f) => a + f.monto, 0)),
          facturas: g.facturas.map((f) => ({ docid: f.docid, fecha: f.fecha, monto: f.monto })),
        });
      }
    }
    if (hallados.length === 0) continue; // silencio: sin nada que decir no se siembra

    // Un solo grupo → propuesta con nombre y apellido. Varios → se listan y el
    // humano elige; la web no deja aprobar hasta entonces.
    const mejor = hallados[0];
    const ambiguo = hallados.length > 1;
    const asignacion: Record<string, unknown> = { ...mejor };
    if (ambiguo) asignacion.candidatos = hallados;

    const detalle = ambiguo
      ? `Cuadran ${hallados.length} combinaciones distintas de facturas por este mismo monto, ` +
        'así que la fecha y el importe no alcanzan para elegir: mirá las opciones y decidí cuál es.'
      : `Parece pagar ${mejor.facturas.length} factura(s) de ${mejor.proveedor} ` +
        `por RD$${fmtMonto(mejor.suma)} (${mejor.metodo}). Verificá contra el comprobante antes de aprobar.`;

    const propuesta: Record<string, unknown> = {
      clase: 'pago_sin_asignar',
      documento_adm: 'BillPayments',
      metodo: 'script',
      banco: mov.banco,
      fecha: mov.fecha,
      monto: objetivo,
      moneda: mov.moneda || 'DOP',
      direccion: 'cargo',
      descripcion: mov.descripcion,
      referencia_banco: mov.referencia,
      cuenta_banco: mov.cuentaBanco,
      cuenta_numero: mov.cuentaNumero,
      banco_tx_id: mov.id,
      confianza: ambiguo ? 0.5 : 0.9,
      detalle,
      asignacion,
    };
    const gl = bancos.get(String(mov.cuentaNumero ?? '').trim());
    if (gl) {
      propuesta.cuenta_contable = { codigo: gl, nombre: `Banco ${mov.cuentaBanco}` };
      propuesta.lineas = [
        {
          cuenta: 'CxP',
          cuenta_nombre: 'Cuentas por Pagar Proveedores',
          debito: objetivo,
          credito: 0,
          descripcion: ambiguo ? 'Pago a proveedor' : `Pago a ${mejor.proveedor}`,
        },
        {
          cuenta: gl,
          cuenta_nombre: `Banco ${mov.cuentaBanco}`,
          debito: 0,
          credito: objetivo,
          descripcion: `${mov.banco} · ${mov.cuentaBanco}`,
        },
      ];
    } else {
      propuesta.detalle += ' OJO: la cuenta contable de este banco no esta en'
        + ' el mapa, asi que no se puede aprobar hasta agregarla.';
    }
    const resumen = (`Pago sin asignar: ${mov.descripcion} — ` +
      `${ambiguo ? 'varios candidatos' : mejor.proveedor}`).slice(0, 200);
    filas.push({ bancoTxId: mov.id, resumen, propuesta });
  }

  if (filas.length === 0) return conteoVacio();

  if (modo === 'sombra') {
    // Sólo qualia_sombra: la llave natural es el movimiento bancario.
    for (const f of filas) {
      await registrarSombra('qualia-sugerencias', empresaId, `asignacion:${f.bancoTxId}`, {
        resumen: f.resumen,
        propuesta: f.propuesta,
      });
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
