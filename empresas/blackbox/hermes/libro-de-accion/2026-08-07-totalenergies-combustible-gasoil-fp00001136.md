# TotalEnergies — combustible gasoil Excellium RD$750 (E310005840572) a 620.11

**Aprobó:** Victor, por la mesa web (trabajo 5d4be99e).
**Fecha:** 2026-08-07
**Proveedor:** TOTALENERGIES MARKETING DOMINICANA SA — RNC 101068744
**Documento ADM:** FP00001136 (VendorBills, UUID 48cc05b3-b1f4-44f0-9ecf-08def3752ab7)
**Comprobante:** e-NCF E310005840572, fecha emisión 30/07/2026, Aceptado en DGII (timbre verificado).
**Monto:** RD$750.00 (ITBIS RD$0.00)

## Criterio

Combustible de flotilla (gasoil Excellium, estación Libertadores). Registrada
como VendorBill íntegramente a **620.11 Combustible**, exenta de ITBIS: el
combustible tiene régimen especial (ITBIS embebido en el precio del galón), por
lo que el comprobante no desglosa crédito fiscal y el ITBIS va en cero. Es así
como se registran las 38 facturas anteriores del histórico de este proveedor,
todas con TaxAmount=0.

Método: **precedente** — 37 de 38 facturas históricas de TotalEnergies a esa
cuenta (agg:proveedor-cuentas.json#101068744).

## Asiento

| Cuenta | Descripción | Débito | Crédito |
|---|---|---:|---:|
| 620.11 Combustible | gasoil Excellium flotilla | 750.00 | |
| CxP TotalEnergies Marketing Dominicana | total a crédito | | 750.00 |

## Alcance

Aplica a **toda factura de TotalEnergies Marketing Dominicana** (y estaciones
del mismo RNC 101068744) por combustible para flotilla — gasoil o gasolina —
con e-NCF E31 aceptado en DGII. El ITBIS va siempre en cero por el régimen
especial del combustible; no se toma crédito fiscal.

Tipo de gasto 606: **02 Gastos por Trabajos, Suministros y Servicios**.
