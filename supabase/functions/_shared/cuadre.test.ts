// Banco de cuadre (F4, precondición 9): los 63 casos reales de
// casos-cuadre.json corren por cuadre.ts y se comparan CASO POR CASO contra la
// salida de cuadre.py (cuadre-esperado.json, generado por
// dump-cuadre-esperado.py). No contra el "esperado" del fixture: contra lo que
// el Python de producción hace de verdad — la precondición lo exige así.
//
// Correr:  deno test --allow-read supabase/functions/_shared/cuadre.test.ts
// Regenerar el esperado:  deploy/generar-banco-cuadre.sh

import { assertEquals } from 'jsr:@std/assert@1';
import { cuadrarItems, netoLinea, r2, totalSegunAdm } from './cuadre.ts';
import type { ItemCuadre } from './cuadre.ts';

interface Esperado {
  docid: string;
  monto: string;
  items: ItemCuadre[];
  total_antes: string;
  total_despues: string;
  precios_finales: number[];
  ajuste: { renglon: number; antes: string; despues: string; movido: string } | null;
}

const esperados: Esperado[] = JSON.parse(
  await Deno.readTextFile(new URL('./cuadre-esperado.json', import.meta.url)),
);

Deno.test('las trampas del redondeo half-up, una por una', () => {
  // La mitad de los descuadres del histórico: ADM sube 60.255 a 60.26 y
  // Math.round de JS lo baja (60.255 llega como 60.25499…).
  assertEquals(r2('60.255'), '60.26');
  // FP00001095: 2.48 gal × 302.41 = 749.9768 → ADM guarda 749.98.
  assertEquals(totalSegunAdm([{ Quantity: 2.48, Price: 302.41, TaxScheduleID: null, TaxPercent: 0 }]), '749.98');
  // El caso float-vs-Decimal del review: 3 × 111.10 al 5% = 316.635 exacto → 316.64.
  assertEquals(netoLinea({ Quantity: 3, Price: 111.10, DiscountPercent: 5 }), '316.64');
  // FP00001122 en vivo (2026-08-19): 600 al 10% + 18% = 637.20 exacto.
  assertEquals(
    totalSegunAdm([{ Quantity: 1, Price: 600, DiscountPercent: 10, TaxScheduleID: 'x', TaxPercent: 18 }]),
    '637.20',
  );
});

Deno.test(`banco de cuadre: ${esperados.length} casos reales contra cuadre.py`, () => {
  const fallas: string[] = [];
  for (const c of esperados) {
    const antes = totalSegunAdm(c.items);
    if (Number(antes) !== Number(c.total_antes)) {
      fallas.push(`${c.docid}: total_antes ${antes} != ${c.total_antes}`);
    }
    const { items: ajustados, ajuste } = cuadrarItems(c.items, c.monto);
    const despues = totalSegunAdm(ajustados);
    if (Number(despues) !== Number(c.total_despues)) {
      fallas.push(`${c.docid}: total_despues ${despues} != ${c.total_despues}`);
    }
    const precios = ajustados.map((i) => i.Price);
    if (JSON.stringify(precios) !== JSON.stringify(c.precios_finales)) {
      fallas.push(`${c.docid}: precios ${JSON.stringify(precios)} != ${JSON.stringify(c.precios_finales)}`);
    }
    if ((ajuste === null) !== (c.ajuste === null)) {
      fallas.push(`${c.docid}: ajuste ${JSON.stringify(ajuste)} != ${JSON.stringify(c.ajuste)}`);
    } else if (ajuste && c.ajuste) {
      if (
        ajuste.renglon !== c.ajuste.renglon ||
        Number(ajuste.antes) !== Number(c.ajuste.antes) ||
        Number(ajuste.despues) !== Number(c.ajuste.despues) ||
        Number(ajuste.movido) !== Number(c.ajuste.movido)
      ) {
        fallas.push(`${c.docid}: ajuste ${JSON.stringify(ajuste)} != ${JSON.stringify(c.ajuste)}`);
      }
    }
  }
  assertEquals(fallas, []);
});
