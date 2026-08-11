---
estado: borrador
aprobo:
evidencia: tasas y cuentas verificadas 2026-08-10 contra asientos reales (ED00000170/177/178/179/180/181, PC00000266/335/336). El flujo del día 30 es PROPUESTA de procedimiento, pendiente de confirmar en la primera corrida real de fin de mes.
---

# Proceso nómina — cierre del día 30

Cómo se asienta la nómina cada mes. La nómina **se sube el día 30**; para
entonces las dos quincenas ya se pagaron en efectivo (salieron del banco). El
trabajo del día 30 es **devengar + conciliar el cash que ya salió + pagar las
obligaciones**, en ese orden. Nómina **jamás es autónoma**: todo es propuesta
con preview línea a línea y OK humano (SPEC §5, plan-encendido §3.4).

Ver también [`nomina.md`](nomina.md) para el asiento tipo ratificado.

## Línea de tiempo del mes

| Día | Qué pasa (realidad) | Dónde se ve |
|---|---|---|
| ~15 | 1era quincena pagada a empleados (cash sale de 101.06) | banco (openbanking) |
| ~30 | 2da quincena pagada a empleados (cash sale de 101.06) | banco (openbanking) |
| **30** | **Se sube el Excel de nómina → QualiaConta arma las 5 piezas** | mesa |

## Flujo del día 30

**Paso 0 — Entrada.** Se sube el Excel de nómina del mes a la mesa. Débito del
asiento = `SUM(Sueldos + Comisiones + Otras remuneraciones)`; la columna "Total"
del Excel **no sirve** (resta 35.000, ver `nomina.md`).

**Paso 1 — Devengo.** Propone 3 `Journals` con fecha día 30:
1. `NOMINA <MES> <AÑO>` — Dr 611.01/02/(04) · Cr 210.04 + 210.08×2 + 220.01.
2. `REG. TSS EMPLEADOR <YYYYMM>` — Dr 611.08/09/1 · Cr 210.09.
3. `REG.INFOTEP EMPLEADOR <YYYYMM>` — Dr 611.11 · Cr 210.1.

**Paso 2 — Conciliación de pagos (detecta el cash que ya salió).** Lee
`openbanking_transactions` de **101.06 Banco Operaciones 874** del mes,
identifica los pagos a empleados (tandas ~15 y ~30 por beneficiario+monto) y los
cruza contra el neto del Excel partido en 1era Q / 2da Q. Para cada pago bancario
que matchea un empleado propone un `AccountPayment`:

| Cuenta | Debe | Haber |
|---|---|---|
| 220.01 Nómina por Pagar | neto del empleado | |
| 101.06 Banco Operaciones 874 | | neto del empleado |

Reference `N15<MM><AA> <empleado>` (1era Q) o `N30<MM><AA> <empleado>` (2da Q).
Esto **liquida el 220.01** (devengado en paso 1) contra el cash real. Se usa el
neto **real del banco**, no el 50/50 del Excel (algunos empleados cobran todo en
una quincena).

**Paso 3 — Diferencias (lo que no cuadra se reporta, no se forcea).**
- Empleado en Excel sin pago en el banco → nómina devengada no pagada (220.01
  abierto). Bandera roja.
- Pago en el banco sin empleado en el Excel → pago sin devengo. Bandera.
- Monto bancario ≠ neto Excel → investigar (ej. el +20,89 a 801.03 de julio, o
  ajustes manuales).

**Paso 4 — Pago de obligaciones.** Propone 2 `AccountPayment` con fecha día 30
(o el vencimiento del mes):
- `Pago TSS` — Dr 210.08 (TSS empleado) + Dr 210.09 (TSS patrón) / Cr 101.05.
- `Pago INFOTEP` — Dr 210.1 / Cr 101.05.

**Paso 5 — Aprobación humana.** Preview línea a línea + Excel adjunto.
Carlos/Victor aprueban cada pieza en la mesa.

**Paso 6 — Libro de acción.** Una entrada append-only por decisión aprobada.

## Impuestos — qué se hace con cada uno

| Impuesto | Componente | Paga | Tasa | Cuenta gasto | Cuenta pasivo | Se paga a | Banco |
|---|---|---|---|---|---|---|---|
| TSS · SFS (Salud) | retención | empleado | 3.04% | — | 210.08 | TSS | 101.05 |
| TSS · SFS (Salud) | aporte | empleador | 7.10% | 611.08 | 210.09 | TSS | 101.05 |
| TSS · AFP (Pensiones) | retención | empleado | 2.87% | — | 210.08 | TSS | 101.05 |
| TSS · AFP (Pensiones) | aporte | empleador | 7.10% | 611.09 | 210.09 | TSS | 101.05 |
| TSS · SRL (Riesgo Laboral) | aporte | empleador | ~1.15% (riesgo Blackbox) | 611.1 | 210.09 | TSS | 101.05 |
| INFOTEP | aporte | empleador | 1.00% | 611.11 | 210.1 | INFOTEP | 101.05 |
| ISR salarios | retención | empleado | escala DGII | — | 210.04 | DGII | **a verificar** |

**TSS sale en un solo pago:** el `AccountPayment` "Pago TSS" debita juntos
`210.08` (lo retenido al empleado: SFS+AFP) y `210.09` (el aporte patronal:
SFS+AFP+SRL) y acredita `101.05`. Tasas patronales verificadas contra junio
(base 322.508): SFS 7.10%, AFP 7.10%, SRL ~1.15%, INFOTEP 1.00%.

## Items abiertos (a confirmar en la primera corrida real)

1. **ISR empleado (210.04).** No se encontró `Pago ISR` en el histórico. ¿Se
   liquida vía DGII (IR-3 retenciones) fuera de ADM, o lo maneja el contador
   externo? Mientras no se sepa, 210.04 acumula.
2. **Timing de obligaciones.** Los `Pago TSS`/`Pago INFOTEP` van día 30 o al
   vencimiento del mes siguiente. Confirmar contra el calendario DGII.
3. **Matching banco↔empleado.** Definir cómo se identifica al beneficiario en
   `openbanking_transactions` (¿por RNC/cuenta del empleado, por monto exacto?).
4. **Quincena real vs 50/50.** Algunos empleados cobran todo en una quincena
   (ej. Carlos ene: un solo PC de 50.000 el 15). El PC sigue al cash del banco,
   no al split del Excel.
