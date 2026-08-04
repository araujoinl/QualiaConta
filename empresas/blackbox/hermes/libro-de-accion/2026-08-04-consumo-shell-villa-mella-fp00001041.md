# Consumo con factura: SHELL VILLA MELLA → FP00001041

**Fecha:** 2026-08-04
**Trabajo mesa:** cd9ef048-878b-4b89-a3c7-bd1fe91f2706
**Aprobó:** (sin nombre en la fila) por la mesa web

## Hecho

Consumo con tarjeta Visa Blackbox 2414 DOP, comercio SHELL VILLA MELLA,
RD$750.00 del 2026-06-15 (movimiento bancario `banco_tx_id`
68a28cb0-4ce0-4483-bc59-46b314b63e07).

## Decisión

El consumo ya tiene su factura en ADM: **FP00001041** de SHELL VILLA MELLA I
por RD$750.00 del 2026-06-15 (VendorBills, UUID
425844b4-3288-4aab-0e95-08ded758712a). Casó por monto, fecha y comercio,
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
