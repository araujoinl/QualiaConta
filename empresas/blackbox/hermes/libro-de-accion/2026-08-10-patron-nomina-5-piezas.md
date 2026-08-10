# Patrón de nómina — 5 piezas (3 asientos + 2 pagos)

**Fecha:** 2026-08-10
**Aprobó:** Carlos Araujo, por chat
**Documento ADM:** ED00000170, ED00000177, ED00000178, ED00000179, ED00000180, ED00000181 (Journals nómina jun–jul 2026) · PC00000266, PC00000335, PC00000336 (AccountPayments)
**Cuenta:** 611.01/02/04/08/09/1/11 · 210.04/08/09/1 · 220.01 · 101.05/06

## Hecho

La nómina mensual de Blackbox no es un asiento: son **3 asientos de devengo
(Journal, fin de mes) más 2 patas de pago (AccountPayment)**. El módulo PR
nativo de ADM está vacío por diseño; todo vive como Journals + AccountPayments.

Las 5 piezas:

1. `NOMINA <MES> <AÑO>` — Dr 611.01 Sueldos + 611.02 Comisiones (+611.04
   Incentivos si hay) · Cr 210.04 ISR + 210.08 TSS-empleado (SFS y AFP en dos
   líneas, misma cuenta) + 220.01 neto.
2. `REG. TSS EMPLEADOR <YYYYMM>` — Dr 611.08 + 611.09 + 611.1 · Cr 210.09.
3. `REG.INFOTEP EMPLEADOR <YYYYMM>` — Dr 611.11 · Cr 210.1.
4. Pago a empleados — un AccountPayment por empleado: Dr 220.01 / Cr 101.06, con
   `Reference N<DD><MM><AA> <Empleado>` (~15 = 1era Q, ~30 = 2da Q).
5. Pago de obligaciones — un AccountPayment "Pago TSS" (Dr 210.08+210.09 / Cr
   101.05) y uno "Pago INFOTEP" (Dr 210.1 / Cr 101.05).

## Criterio

Verificado contra los 6 Journals de nómina de jun–jul 2026 y los
AccountPayments reales del histórico (corte 2026-08-02). Las subdivisiones de
cuenta (210.04 ISR · 210.08 TSS-empleado · 210.09 TSS-patrón · 210.1 INFOTEP ·
611.01/02/04/08/09/1/11) y los bancos (101.06 operativa para empleados, 101.05
impuestos para obligaciones) son observación de los libros, no juicio contable.

La nómina **jamás es autónoma** (SPEC §5 y plan-encendido-escritura §3.4):
QualiaConta arma la propuesta con preview línea a línea + Excel adjunto y el
humano aprueba. Cualquier Journal o PC que toque 611.x, 210.04–210.10, 220.x o
cuya Reference matchee `nomina|tss|infotep|sueldo` es no-autonomizable.

## Alcance

Aplica a toda nómina mensual de Blackbox. El patrón (5 piezas, cuentas y
References) está ratificado; los **montos** se toman del Excel del mes y la
carga patronal (TSS + INFOTEP) del cálculo correspondiente. Items abiertos
(`220.01` sin debitar en jun/jul, ajuste manual 801.03 de julio, Reference de
TSS mal etiquetada P-005, columna "Total" del Excel inválida) viven en
`memoria/nomina.md` y deben revisarse al registrar cada mes.
