# Combustible exento de ITBIS (ISC incluido) → cuenta 620.11

**Fecha:** 2026-08-03
**Aprobó:** Victor, por la mesa web
**Documento origen:** NCF B0100861293, ESTACION DE SERVICIOS H E NUEVO MILENIO SRL (RNC 101830719)
**Registrada en ADM como:** FP00001105

## Hecho

Factura de estación de servicio por RD$750.00 (gasolina premium, 2.19 gal),
sin ITBIS desglosado (itbis = 0.00). DGII confirma el NCF VIGENTE hasta
31/12/2026 y el emisor ACTIVO.

## Criterio

La gasolina en RD está exenta de ITBIS y lleva el Impuesto Selectivo al Consumo
(ISC) incluido en el precio. La ausencia de ITBIS en la factura **no** convierte
el gasto en "no admitido": es la anatomía normal del combustible. La cuenta
correcta es **620.11 Combustible**, no 801.01 (gasto no admitido).

Precedente: 51 de 53 facturas históricas de este proveedor van a 620.11
(`agg:proveedor-cuentas.json#101830719`).

## Alcance

Aplica a **toda factura de estación de servicio / venta de combustible** donde
el ITBIS sea cero por estar el ISC incluido en el precio: gasolina, gasoil,
GLP, diésel. La cuenta es 620.11 y el tipo de gasto 606 es 02 (Gastos por
Trabajos, Suministros y Servicios). No se clasifica como gasto no admitido por
el solo hecho de no traer ITBIS desglosado.
