# MECARI SRL — combustible a cuenta 620.11

**Fecha:** 2026-08-03
**Documento:** Factura B0100593938 del 2026-07-13, RD$750.00 (2.48 gal gasolina regular, ITBIS exento)
**Registrada en ADM:** VendorBills FP00001095
**Aprobó:** Victor, por la mesa web

## Criterio

Facturas de MECARI SRL (RNC 101767766, estación Axxón El Millón) se registran como
VendorBills, cuenta **620.11 Combustible**, tipo de gasto **02 Gastos por Trabajos,
Suministros y Servicios**. El combustible es venta exenta de ITBIS en estación de
servicio — el renglón va con `grupo_impuesto: "Exento"`, sin crédito fiscal.

## Precedente

agg:proveedor-cuentas.json#101767766 — 86 de 88 usos de cuenta sobre 88 facturas
históricas. NCF B0100593938 vigente hasta 31/12/2026; padrón DGII ACTIVO.

## Alcance

Aplica a toda factura de combustible de MECARI SRL mientras la actividad económica
del proveedor sea venta de combustible (estación de servicio). Si la factura
incluye un renglón de naturaleza distinta (lubricante capitalizable, accesorio,
servicio), ese renglón se clasifica por su naturaleza, no por este precedente.
