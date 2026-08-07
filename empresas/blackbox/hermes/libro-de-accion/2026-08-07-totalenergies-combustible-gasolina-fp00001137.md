# TotalEnergies — combustible gasolina RD$750 (E310005072587) a 620.11

**Aprobó:** Victor, por la mesa web (trabajo 0d2c60ae).
**Fecha:** 2026-08-07
**Proveedor:** TOTALENERGIES MARKETING DOMINICANA SA — RNC 101068744
**Documento ADM:** FP00001137 (VendorBills, UUID d0f4afbd-025f-43be-a5c8-08def3752ab7)
**Comprobante:** e-NCF E310005072587, fecha emisión 06/08/2026, timbre no verificable en DGII (consultado con código de seguridad y hora de firma del QR; DGII devolvió "No fue encontrada" — posiblemente no indexado al momento de la verificación). RNC activo en el padrón (ACTIVO, razon social confirmada).
**Monto:** RD$750.00 (ITBIS RD$0.00)

## Criterio

Combustible de flotilla (gasolina Excellium). Registrada como VendorBill
íntegramente a **620.11 Combustible**, exenta de ITBIS: el combustible tiene
régimen especial (ITBIS embebido en el precio del galón), por lo que el
comprobante no desglosa crédito fiscal y el ITBIS va en cero. Es así como se
registran las 38 facturas anteriores del histórico de este proveedor, todas con
TaxAmount=0.

Método: **precedente** — 37 de 38 facturas históricas de TotalEnergies a esa
cuenta (agg:proveedor-cuentas.json#101068744).

## Asiento

| Cuenta | Descripción | Débito | Crédito |
|---|---|---:|---:|
| 620.11 Combustible | gasolina Excellium flotilla | 750.00 | |
| CxP TotalEnergies Marketing Dominicana | total a crédito | | 750.00 |

## Alcance

Aplica a **toda factura de TotalEnergies Marketing Dominicana** (y estaciones
del mismo RNC 101068744) por combustible para flotilla — gasoil o gasolina —
con e-NCF E31. El ITBIS va siempre en cero por el régimen especial del
combustible; no se toma crédito fiscal.

Tipo de gasto 606: **02 Gastos por Trabajos, Suministros y Servicios**.
