# Consumo con factura: TOTAL LAS LADERAS → FP00001054

**Fecha:** 2026-08-04
**Trabajo mesa:** 29cb1798-660e-440c-a92f-6d71f9bf74a1
**Aprobó:** (sin nombre en la fila) por la mesa web

## Hecho

Consumo con tarjeta Visa Blackbox 2414 DOP, comercio TOTAL LAS LADERAS,
RD$750.00 del 2026-06-22 (movimiento bancario `banco_tx_id`
21f095ce-1411-46e0-9384-6e99c742e327).

## Decisión

El consumo ya tiene su factura en ADM: **FP00001054** de TOTALENERGIES
LADERAS por RD$750.00 del 2026-06-22 (VendorBills, UUID
ec9a1aac-af02-4f6d-1fac-08ded758712a). Casó por monto, fecha y comercio,
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
