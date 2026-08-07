# TUPAQ Cargo — flete aéreo 5 renglones (B0100062393) a 620.10

**Aprobó:** Victor, por la mesa web (trabajo 3accdde0).
**Fecha:** 2026-08-07
**Proveedor:** TUPAQ CARGO and COURIER SRL — RNC 132942248
**Documento ADM:** FP00001135 (VendorBills, UUID d538c026-a1d6-4851-8e0f-08def3752ab7)
**Comprobante:** NCF B0100062393, fecha emisión 10/06/2026, VIGENTE en DGII hasta 31/12/2027.
**Monto:** RD$238.59 (ITBIS RD$23.13)

## Criterio

Factura de envío de TUPAQ con 5 renglones — flete aéreo priority, airport fee,
combustible, servicios DGA y tasa DGA-Aerodom — registrada como VendorBill
íntegramente a **620.10 Envíos y Correspondencias**. Son componentes de un mismo
envío del courier, no gastos individuales; van como items separados, cada uno con
su precio sin ITBIS y su grupo de impuesto (ITBIS o Exento).

Método: **precedente** — 127 de 128 facturas históricas de TUPAQ a esa cuenta
(agg:proveedor-cuentas.json#132942248). Consistente con la entrada del
2026-08-02 sobre el mismo proveedor.

## Asiento

| Cuenta | Descripción | Débito | Crédito |
|---|---|---:|---:|
| 620.10 Envíos y Correspondencias | base (5 renglones) | 215.46 | |
| ITBIS Operativo | crédito fiscal (flete + tasa Aerodom) | 23.13 | |
| CxP TUPAQ Cargo and Courier | total a crédito | | 238.59 |

## Alcance

Aplica a **toda factura de TUPAQ Cargo and Courier** por envío/courier corriente
(componentes de un mismo despacho: flete, airport fee, combustible, DGA, Aerodom),
con NCF B01 válido y verificado en DGII. NO aplica cuando el envío acompaña una
importación en curso (va a 130.02 Compras en Tránsito).

Tipo de gasto 606: **02 Gastos por Trabajos, Suministros y Servicios**.
