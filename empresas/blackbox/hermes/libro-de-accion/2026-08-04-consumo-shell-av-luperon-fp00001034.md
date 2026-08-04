# Consumo con factura: SHELL AV LUPERON → FP00001034

**Fecha:** 2026-08-04
**Trabajo mesa:** 965582e1-75a8-4ffb-8239-958b4eceba3d
**Aprobó:** (sin nombre en la fila) por la mesa web

## Hecho

Consumo con tarjeta Visa Blackbox 2414 DOP, comercio SHELL AV LUPERON,
RD$750.00 del 2026-06-15 (movimiento bancario `banco_tx_id`
782f044d-d623-48c8-95af-b9192696866d).

## Decisión

El consumo ya tiene su factura en ADM: **FP00001034** de Shell La Lirá por
RD$750.00 del 2026-06-11 (VendorBills, UUID
8f0faddb-a478-4761-88a7-08ded71d577b). Casó por monto, fecha y comercio,
así que no se subió nada nuevo: el cargo bancario se espeja en la factura
existente.

**Método:** script (sugerencia de cargo bancario, `metodo='script'`).
**Confianza:** 0.90.

## Alcance

Consumos con tarjeta de la flotilla ya facturados por el proveedor y
presentes en ADM como VendorBills: la sugerencia los casa por monto + fecha
+ comercio y los marca con `registro_adm.docid` de la factura existente,
sin registrar un documento nuevo. Aplica a la cuenta Visa 2414 DOP de
Blackbox y, por analogía, a cualquier cargo bancario cuyo soporte ya esté
cargado en ADM.
