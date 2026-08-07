# Factura Claro — Telecomunicaciones julio 2026 (FP00001131)

**Fecha:** 2026-08-06
**Aprobó:** C.Araujo, por la mesa web
**Documento ADM:** VendorBills FP00001131 (uuid 370ef9af-2c18-40ec-9b9c-08def3a3c707)

## Hecho

Factura e-CF de Claro (Compañía Dominicana de Teléfonos, S.A., RNC 101001577),
NCF E310016169496, fecha 2026-07-31, por servicios de telefonía e internet del
mes de julio.

Monto del documento: **RD$6,182.56** (Total del Mes del e-CF). El Total por Pagar
del PDF (RD$6,310.42) incluye RD$127.86 de arrastre de facturaciones anteriores
que NO corresponden a esta e-CF; quedan pendientes como saldo a cancelar.

## Asiento registrado

| Línea | Cuenta | Descripción | Monto | ITBIS |
|---|---|---|---|---|
| 1 | 620.05 Comunicación | Renta Otros Servicios | 2,138.55 | 384.94 |
| 2 | 620.05 Comunicación | Renta Servicios De Datos | 1,896.15 | 341.31 |
| 3 | 620.05 Comunicación | Renta Mensual | 558.76 | 100.58 |
| 4 | 620.05 Comunicación | Llamadas A Celulares | 162.35 | 29.22 |
| 5 | 690.05 Otros Impuestos | CDT 2% | 95.11 | 0 |
| 6 | 620.09 Gasto de Impuesto Selectivo al Consumo | ISC 10% | 475.60 | 0 |

Total: **RD$6,182.56**, ITBIS aprovechable: **856.04**.
Tipo de gasto 606: **02 Gastos por Trabajos, Suministros y Servicios**.

## Criterio aplicado

**Método: precedente.** RNC 101001577, agg:proveedor-cuentas.json#101001577
(19 de 21 facturas históricas de CODETEL usan 620.05). Tipo de gasto 02 por
precedente del mismo proveedor. Las tres cuentas (620.05 para los servicios
gravados, 620.09 para el ISC y 690.05 para el CDT) son las que Claro usa
históricamente para sus cargos, igual que la entrada del 2026-08-03 (FP00001066).

**Importe registrado:** solo el Total del Mes (6,182.56). El arrastre de
RD$127.86 NO se registra acá; si se paga, va como BillPayments que cancela el
saldo, no como gasto nuevo.

## DGII

e-CF E310016169496 marcado **no verificable** por el timbre en ConsultaTimbre
(se probó con ambos montos del documento y la fecha de firma del PDF; DGII no
devolvió la factura). El padrón confirma que el RNC 101001577 pertenece a
COMPANIA DOMINICANA DE TELEFONOS S A, contribuyente activo. Claro es proveedor
recurrente.

## Alcance

Este criterio aplica a **todas las facturas de Claro (RNC 101001577)** que
presenten la misma estructura: renglones de servicios de telecomunicaciones con
ITBIS al 18% (cuenta 620.05), más ISC 10% (620.09) y CDT 2% (690.05) como cargos
exentos separados. El monto a registrar es siempre el Total del Mes del e-CF,
no el Total por Pagar que arrastra saldos de meses anteriores.
