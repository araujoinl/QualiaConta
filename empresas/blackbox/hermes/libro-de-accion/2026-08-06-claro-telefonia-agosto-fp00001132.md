# Factura Claro — Telecomunicaciones agosto 2026 (FP00001132)

**Fecha:** 2026-08-06
**Aprobó:** Victor, por la mesa web
**Documento ADM:** VendorBills FP00001132 (uuid 991fa71f-34e6-4fa3-4c05-08def3752ab7)

## Hecho

Factura e-CF de Claro (Compañía Dominicana de Teléfonos, S.A., RNC 101001577),
NCF E310016169496, **fecha de emisión 2026-08-04**, por servicios de telefonía e
internet del mes de agosto.

Monto del documento: **RD$6,182.56** (Total del Mes del e-CF). El Total por Pagar
del PDF (RD$6,310.42) incluye RD$127.86 de arrastre de facturaciones anteriores
que NO corresponden a esta e-CF; quedan pendientes como saldo a cancelar.

Reemplaza la **FP00001131**, registrada antes por error con la fecha de firma
digital (31-07) en lugar de la fecha de factura del encabezado (04-08), y anulada
por eso.

## Asiento registrado

| Línea | Cuenta | Descripción | Monto | ITBIS |
|---|---|---|---|---|
| 1 | 620.05 Comunicación | Servicios de telecomunicaciones (renta, datos, celular) | 4,755.81 | 856.04 |
| 2 | 620.09 Gasto de Impuesto Selectivo al Consumo | ISC 10% | 475.60 | 0 |
| 3 | 690.05 Otros Impuestos | CDT 2% | 95.11 | 0 |

Total: **RD$6,182.56**, ITBIS aprovechable: **856.04**.
Tipo de gasto 606: **02 Gastos por Trabajos, Suministros y Servicios**.

## Criterio aplicado

**Método: razonado** (sobre precedente de este proveedor). RNC 101001577,
agg:proveedor-cuentas.json#101001577 — 19 de 21 facturas históricas de CODETEL
usan 620.05. Tipo de gasto 02 por precedente del mismo proveedor. Las tres
cuentas (620.05 para los servicios gravados, 620.09 para el ISC y 690.05 para el
CDT) son las que Claro usa históricamente, igual que la entrada anterior
(FP00001131, ahora anulada) y la FP00001066 del 2026-08-03.

**Importe registrado:** solo el Total del Mes (6,182.56). El arrastre de
RD$127.86 NO se registra acá; si se paga, va como BillPayments que cancela el
saldo, no como gasto nuevo.

## DGII

e-CF E310016169496 marcado **no verificable** por el timbre en ConsultaTimbre
(DGII protege el endpoint con challenge Citrix; no accesible vía curl). El padrón
confirma que el RNC 101001577 pertenece a COMPANIA DOMINICANA DE TELEFONOS S A,
contribuyente activo, facturador electrónico. Claro es proveedor recurrente.

## Alcance

Este criterio aplica a **todas las facturas de Claro (RNC 101001577)** que
presenten la misma estructura: renglones de servicios de telecomunicaciones con
ITBIS al 18% (cuenta 620.05), más ISC 10% (620.09) y CDT 2% (690.05) como cargos
exentos separados. El monto a registrar es siempre el Total del Mes del e-CF,
no el Total por Pagar que arrastra saldos de meses anteriores.
