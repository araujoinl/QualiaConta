# Isla Dominicana de Petróleo — gasolina regular exenta → 620.11

**Fecha:** 2026-08-03
**Aprobó:** C.Araujo, por la mesa web
**Documento origen:** e-NCF E310002645619, ISLA DOMINICANA DE PETROLEO CORPORATION (RNC 101008172)
**Registrada en ADM como:** FP00001106

## Hecho

Factura por RD$750.00 (gasolina regular, 2.48 gal, estación Villa Mella), sin
ITBIS desglosado (itbis = 0.00). Timbre DGII no verificable (endpoint
ecf.dgii.gov.do caído, HTTP 0.9); RNC emisor confirmado ACTIVO en padrón,
facturador electrónico SI.

## Criterio

Gasolina regular: exenta de ITBIS con ISC incluido en el precio. La cuenta es
**620.11 Combustible**, no 801.01 — el ITBIS cero por ISC no convierte el gasto
en no admitido.

Precedente: 94 de 96 facturas históricas de este proveedor van a 620.11
(`agg:proveedor-cuentas.json#101008172`); tipo de gasto 606 = 02
(100% histórico).

Criterio ya ratificado el mismo día en
`2026-08-03-combustible-exento-isc-62011.md` (estación H E Nuevo Milenio).

## Alcance

Aplica a **toda factura de estación de servicio / venta de combustible** donde
el ITBIS sea cero por estar el ISC incluido en el precio: gasolina, gasoil,
GLP, diésel. La cuenta es 620.11 y el tipo de gasto 606 es 02. No se clasifica
como gasto no admitido por el solo hecho de no traer ITBIS desglosado.
