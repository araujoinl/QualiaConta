// _shared/cuadre.ts — port de cuadre.py (F4, precondición 9 del plan).
//
// La aritmética de ADM, verificada el 2026-08-05 contra FP00001113/1102/1095:
//
//     Net_i = redondear(Quantity_i × Price_i × (1 − Descuento_i/100))
//     Tax_i = redondear(Net_i × TaxPercent_i / 100)     sólo con schedule
//     Total = Σ (Net_i + Tax_i)
//
// redondeando MEDIO HACIA ARRIBA (ties away from zero). `Math.round` de JS NO
// sirve: es half-away pero sobre el double ya podrido (60.255 llega como
// 60.25499…, redondea a 60.25 y ADM guarda 60.26 — la mitad de los descuadres
// del histórico son exactamente esto). Por eso acá no hay UN solo redondeo
// sobre float: todo número entra como el string de su repr (el mismo que usa
// `Decimal(str(x))` en Python — JS y Python comparten el repr más corto del
// double), se escala a entero BigInt, y el half-up se hace sobre el cociente
// exacto. El banco de 63 casos reales (casos-cuadre.json) corre caso por caso
// contra la salida de cuadre.py: si este archivo y el Python divergen en un
// centavo, el test lo grita.
//
// El descuento entra ANTES del redondeo del neto: verificado en vivo el
// 2026-08-19 (FP00001122, 600.00 al 10% vía API — ADM recalculó Subtotal 600 /
// Descuento 60 / Neto 540 / Total 637.20 exactos).

export interface ItemCuadre {
  Quantity: number;
  Price: number;
  DiscountPercent?: number;
  TaxScheduleID?: string | null;
  TaxPercent?: number;
}

export interface AjusteCuadre {
  renglon: number;
  antes: string;
  despues: string;
  /** Cuánto se movió EL TOTAL (no el precio): objetivo − total de entrada. */
  movido: string;
}

/** Un decimal exacto: valor entero escalado y cuántos dígitos decimales. */
interface Escalado {
  v: bigint;
  e: number; // 10^e es el denominador
}

const POW10: bigint[] = [];
function pow10(e: number): bigint {
  while (POW10.length <= e) POW10.push(POW10.length === 0 ? 1n : POW10[POW10.length - 1] * 10n);
  return POW10[e];
}

/** Parsea el repr decimal de un número a entero escalado, sin pasar por float. */
function escalar(x: number | string): Escalado {
  const s = typeof x === 'number' ? String(x) : String(x ?? '0').trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(s || '0');
  if (!m) throw new Error(`no es un decimal: '${s}'`);
  const neg = m[1] === '-';
  const ent = m[2];
  const frac = m[3] ?? '';
  let v = BigInt(ent + frac);
  let e = frac.length;
  // Los repr con exponente (1e-7 y amigos) no aparecen en montos contables;
  // se soportan igual para que un caso raro no muera en el parser.
  const exp = m[4] ? parseInt(m[4], 10) : 0;
  if (exp > 0) v *= pow10(exp);
  else if (exp < 0) e += -exp;
  if (neg) v = -v;
  return { v, e };
}

/** Half-up (ties away from zero) del racional n/d a `dec` decimales, exacto. */
function halfUpRacional(n: bigint, d: bigint, dec: number): Escalado {
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const objetivo = n * pow10(dec);
  const neg = objetivo < 0n;
  const abs = neg ? -objetivo : objetivo;
  const q = (abs * 2n + d) / (2n * d); // floor((abs + d/2) / d) sin fracciones
  return { v: neg ? -q : q, e: dec };
}

function aString(x: Escalado): string {
  const neg = x.v < 0n;
  const abs = (neg ? -x.v : x.v).toString().padStart(x.e + 1, '0');
  const ent = abs.slice(0, abs.length - x.e) || '0';
  const frac = x.e > 0 ? '.' + abs.slice(abs.length - x.e) : '';
  return (neg ? '-' : '') + ent + frac;
}

function aNumber(x: Escalado): number {
  return Number(aString(x));
}

/** Redondeo half-up a 2 decimales, como `r2` de cuadre.py. */
export function r2(x: number | string): string {
  const s = escalar(x);
  return aString(halfUpRacional(s.v, pow10(s.e), 2));
}

/** Neto de UN renglón en centavos (entero), con el descuento antes del redondeo. */
function netoCentavos(it: ItemCuadre): bigint {
  const q = escalar(it.Quantity ?? 0);
  const p = escalar(it.Price ?? 0);
  const d = escalar(it.DiscountPercent ?? 0);
  // q*p*(1 - d/100) = q.v*p.v*(100*10^d.e - d.v) / (10^(q.e+p.e+d.e) * 100)
  const n = q.v * p.v * (100n * pow10(d.e) - d.v);
  const den = pow10(q.e + p.e + d.e) * 100n;
  return halfUpRacional(n, den, 2).v;
}

/** El neto de un renglón como string "540.00" — para quien loguea o compara. */
export function netoLinea(it: ItemCuadre): string {
  return aString({ v: netoCentavos(it), e: 2 });
}

/** Lo que ADM va a guardar como total, en centavos exactos. */
function totalCentavos(items: ItemCuadre[]): bigint {
  let total = 0n;
  for (const it of items) {
    const net = netoCentavos(it);
    let tax = 0n;
    if (it.TaxScheduleID) {
      const pct = escalar(it.TaxPercent ?? 0);
      // net(centavos) * pct / 100 → centavos
      tax = halfUpRacional(net * pct.v, pow10(pct.e) * 100n, 0).v;
    }
    total += net + tax;
  }
  return total;
}

/** Total según ADM como string "637.20". */
export function totalSegunAdm(items: ItemCuadre[]): string {
  return aString({ v: totalCentavos(items), e: 2 });
}

// Con cuántos decimales se prueba el precio, en orden — igual que el Python:
// dos primero (lo que dice el papel), tres cuando dos no alcanzan (ADM ya
// guarda precios de 3 decimales: FP00001032 tiene 508,476).
const DECIMALES_PRECIO = [2, 3];

/**
 * Ajusta el precio de UN renglón para que la cuenta de ADM caiga en el total
 * del papel. Espejo de cuadrar_items() de cuadre.py, barrido idéntico:
 * precisión → paso → renglón → signo, exentos primero y dentro de eso el neto
 * más grande. Si no encuentra arreglo dentro del margen NO rompe: devuelve los
 * items como estaban (un centavo de diferencia es preferible a no registrar).
 */
export function cuadrarItems(
  items: ItemCuadre[],
  totalPapel: number | string,
  margenCentavos = 25,
): { items: ItemCuadre[]; ajuste: AjusteCuadre | null } {
  const objetivoEsc = escalar(r2(totalPapel));
  const objetivo = objetivoEsc.v; // centavos
  if (!items.length || objetivo <= 0n) return { items, ajuste: null };
  const totalAntes = totalCentavos(items);
  if (totalAntes === objetivo) return { items, ajuste: null };

  // Exentos primero (mueven el total uno a uno, sin ITBIS que se mueva atrás);
  // después por neto descontado, del más grande al más chico. sort es estable,
  // como sorted() de Python: el desempate lo da el orden de los renglones.
  const orden = items.map((_, i) => i).sort((a, b) => {
    const ta = items[a].TaxScheduleID ? 1 : 0;
    const tb = items[b].TaxScheduleID ? 1 : 0;
    if (ta !== tb) return ta - tb;
    const na = netoCentavos(items[a]);
    const nb = netoCentavos(items[b]);
    const absA = na < 0n ? -na : na;
    const absB = nb < 0n ? -nb : nb;
    return absA === absB ? 0 : absA > absB ? -1 : 1;
  });

  for (const decimales of DECIMALES_PRECIO) {
    for (let paso = 1; paso <= margenCentavos; paso++) {
      for (const idx of orden) {
        const original = escalar(items[idx].Price);
        for (const signo of [1n, -1n]) {
          // candidato = half-up(original ± paso·10^-decimales, decimales)
          const base = halfUpRacional(original.v, pow10(original.e), decimales);
          const candidato: Escalado = { v: base.v + signo * BigInt(paso), e: decimales };
          if (candidato.v <= 0n) continue;
          const candidatoNum = aNumber(candidato);
          if (candidatoNum === items[idx].Price) continue;
          const prueba = items.map((x) => ({ ...x }));
          prueba[idx].Price = candidatoNum;
          if (totalCentavos(prueba) === objetivo) {
            return {
              items: prueba,
              ajuste: {
                renglon: idx,
                antes: aString(original),
                despues: aString(candidato),
                // Cuánto se movió EL TOTAL: derivado de la misma aritmética
                // que decidió el ajuste, sin fórmula aparte que mantener.
                movido: aString({ v: objetivo - totalAntes, e: 2 }),
              },
            };
          }
        }
      }
    }
  }
  return { items, ajuste: null };
}
