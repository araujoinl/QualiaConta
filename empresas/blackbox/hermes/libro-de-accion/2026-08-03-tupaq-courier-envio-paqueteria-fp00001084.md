# TUPAQ Cargo & Courier — envío paquetería TP-007675 — FP00001084

**Aprobó:** Victor, por la mesa web (trabajo 96c937a4).
**Fecha:** 2026-08-03
**Proveedor:** TUPAQ CARGO & COURIER SRL — RNC 132942248
**Documento de respaldo:** NCF B0100065334, RD$163.26, VIGENTE según DGII (venc. 31/12/2027, FACTURA DE CRÉDITO FISCAL). Factura suplidor TP-007675.
**Registrada en ADM como:** FP00001084 (VendorBills, uuid cdbd3096-f62a-4ff3-03bf-08def13e52a2).

## Criterio aplicado

Precedente del libro: entrada «TUPAQ Cargo & Courier — flete/courier corriente a
620.10 con ITBIS» (2026-08-02) y `agg:proveedor-cuentas.json#132942248` (117 de 118
facturas históricas a 620.10). Caso idéntico al alcance: envío/courier corriente,
NCF válido, monto operativo pequeño.

Los componentes del envío van como items separados, precio sin ITBIS, grupo de
impuesto correcto. ITBIS aprovechable: solo el artículo personal (RD$59.04) y
servicios DGA (RD$7.38) están gravados → base 66.42 × 18% = 11.96. Airport fee,
combustible y flete aéreo priority son exentos (gasto deducible sin crédito).

## Asiento

| Cuenta | Descripción | Debito | Credito |
|---|---|---:|---:|
| 620.10 Envios y Correspondencias | TUMIA000820631 - LBS 0.30 ART PERSONAL | 59.04 | |
| 620.10 Envios y Correspondencias | FLETE AEREO PRIORITY (Exento) | 10.46 | |
| 620.10 Envios y Correspondencias | AIRPORT FEE (Exento) | 66.42 | |
| 620.10 Envios y Correspondencias | COMBUSTIBLE (Exento) | 8.00 | |
| 620.10 Envios y Correspondencias | SERVICIOS DGA | 7.38 | |
| 1180-02 ITBIS adelantado | crédito fiscal 18% | 11.96 | |
| CxP TUPAQ Cargo y Courier | total a crédito | | 175.22 |

Suma items: 151.30 + ITBIS 11.96 = 163.26 = monto. Cuadra.

## Alcance

Aplica a **toda factura de TUPAQ Cargo y Courier** por envío/courier corriente
(naturaleza operativa recurrente, monto pequeño), con NCF válido verificado en
DGII. No aplica cuando el envío acompaña una importación en curso (va a
130.02 Compras en Tránsito).
