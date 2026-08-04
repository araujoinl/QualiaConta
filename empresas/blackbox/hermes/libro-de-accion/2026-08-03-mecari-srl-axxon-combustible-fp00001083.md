# 2026-08-03 — MECARI SRL (Estación Axxon El Millón) — Combustible — FP00001083

**Aprobó:** Victor, por la mesa web
**Fecha:** 2026-08-03

## Hecho

Factura de crédito fiscal B0100593251, emitida por MECARI SRL (RNC 101767766,
Estación Axxon El Millón) con fecha 2026-07-06, por RD$750.00 (ITBIS exento,
monto impreso exento). Gasolina Premium, 2.22 galones.

Registrada en ADM Cloud como **FP00001083** (VendorBills, uuid
`bc8ecc84-5037-489a-0390-08def13e52a2`), con adjunto subido.

## Criterio

- **Cuenta contable:** 620.11 Combustible, por precedente del proveedor (86 de
  88 facturas históricas de Mecari SRL, 97.7%).
- **Tipo de gasto 606:** 02 — Gastos por Trabajos, Suministros y Servicios.
- **ITBIS:** 0.00 (impreso exento en el documento). No se toma crédito fiscal.
- **Método:** precedente (`agg:proveedor-cuentas.json#101767766`).

## Alcance

Facturas de combustible de MECARI SRL (Estación Axxon El Millón, RNC 101767766)
se registran en la cuenta 620.11 Combustible, tipo de gasto 606 código 02,
mientras no se registre un criterio que la cambie. El ITBIS va según lo
impreso en el documento (esta factura salió exenta; otras del mismo proveedor
sí traen ITBIS al 18%).
