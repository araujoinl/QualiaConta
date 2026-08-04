# JSP EMPRESAS DR — gasolina premium exenta → 620.11

**Fecha:** 2026-08-03
**Aprobó:** Victor, por la mesa web
**Documento origen:** e-NCF E310000008373, JSP EMPRESAS DR SRL (RNC 133375338)
**Registrada en ADM como:** FP00001108

## Hecho

Factura por RD$750.00 (gasolina premium, 2.218279 gal × 338.10, estación La
Feria), sin ITBIS desglosado (itbis = 0.00). Timbre DGII verificado Aceptado:
monto 750.00 cuadra, RNC comprador BLACKBOX SRL (131188648). RNC emisor
confirmado ACTIVO en padrón, facturador electrónico SI.

## Criterio

Gasolina premium: exenta de ITBIS con ISC incluido en el precio. La cuenta es
**620.11 Combustible**, no 801.01 — el ITBIS cero por ISC no convierte el gasto
en no admitido.

Precedente: 11 de 11 facturas históricas de JSP EMPRESAS DR van a 620.11
(`agg:proveedor-cuentas.json#133375338`); tipo de gasto 606 = 02.

Criterio ya ratificado el mismo día en
`2026-08-03-combustible-exento-isc-62011.md`.

## Alcance

Aplica a **toda factura de estación de servicio / venta de combustible** donde
el ITBIS sea cero por estar el ISC incluido en el precio: gasolina, gasoil,
GLP, diésel. La cuenta es 620.11 y el tipo de gasto 606 es 02. No se clasifica
como gasto no admitido por el solo hecho de no traer ITBIS desglosado.
