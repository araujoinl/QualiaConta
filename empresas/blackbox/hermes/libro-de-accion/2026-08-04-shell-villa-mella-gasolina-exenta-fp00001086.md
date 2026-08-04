# Factura Shell Villa Mella — gasolina regular exenta

**Fecha:** 2026-08-04
**DocID ADM:** FP00001086
**Documento:** VendorBills (UUID b4dfed61-e8dc-4b94-03f0-08def13e52a2)
**Aprobó:** Victor, por la mesa web
**Trabajo mesa:** b63881b2-01d8-4dda-a5ff-5f12bce7a4a8

## Hecho

Factura electrónica E310002617692 de SHELL VILLA MELLA I (RNC 101008172 — ISLA
DOMINICANA DE PETROLEO CORPORATION (SUCURSAL), padrón DGII ACTIVO), fecha
2026-07-10, monto total RD$750.00, ITBIS RD$0.00 (gasolina regular exenta). e-CF
sin código de seguridad legible: timbre no verificable, pero RNC del emisor
confirmado en padrón y nombre coincide con el proveedor impreso.

## Criterio

Gasolina regular exenta de ITBIS (combustible). Cuenta contable 620.11
"Combustible" por precedente (agg:proveedor-cuentas.json#101008172: 94 de 96
facturas históricas, 97.9%). Renglón único, todo el total a esa cuenta.

Tipo de gasto 606: 02 Gastos por Trabajos, Suministros y Servicios (catálogo
fijo DGII).

## Línea registrada

| Renglón | Cuenta | Precio | ITBIS | Grupo |
|---|---|---|---|---|
| Gasolina regular 2.45 galones | 620.11 Combustible | 750.00 | 0 | Exento |

Suma items: 750.00 + ITBIS 0 = 750.00 — cuadra con el documento.

## Alcance

Aplica a futuras facturas de SHELL VILLA MELLA I / ISLA DOMINICANA DE PETROLEO
CORPORATION (RNC 101008172): combustible (gasolina regular, gasoil, etc.) va a
620.11 "Combustible" con grupo Exento cuando el renglón no grave ITBIS. Tipo de
gasto 606 = 02 para este suplidor. La falta de código de seguridad del e-CF no
bloquea el registro mientras el RNC del emisor esté confirmado en el padrón DGII
y el nombre case con el proveedor impreso.
