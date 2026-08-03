# Combustible flotilla — Shell Villa Mella (Isla Dominicana de Petróleo)

**Aprobó:** Victor, por la mesa web
**Fecha:** 2026-08-03
**Documento ADM:** FP00001098 (VendorBills, uuid 2c34b784-7ea2-4fca-0c5b-08def13e52a2)

## Hecho

Factura e-CF E310002630406 del 2026-07-16, Shell Villa Mella I (Isla Dominicana
de Petróleo Corporation, RNC 101008172). Gasolina regular, 2.48 gal × RD$302.42
= RD$750.00. Combustible exento de ITBIS general (paga ISC, no ITBIS).

## Criterio

- **Cuenta 620.11 (Combustible)** por precedente: 94 de 96 facturas históricas
  de este proveedor (agg:proveedor-cuentas.json#101008172).
- **ITBIS 0** correcto: gasolina regular es exenta de ITBIS general.
- **Timbre e-CF no verificable** en DGII ("No fue encontrada la factura"), pero
  padrón confirma RNC 101008172 ACTIVO y facturador electrónico SI. Shell es
  marca operada por Isla Dominicana de Petróleo.

## Alcance

Toda factura de Shell / Isla Dominicana de Petróleo por gasolina o combustible
de flotilla se clasifica a **620.11 Combustible**, ITBIS 0 (exento), tipo de
gasto **02 Gastos por Trabajos, Suministros y Servicios**. Precedente
agg:proveedor-cuentas.json#101008172.
