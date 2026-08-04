# Consumo con factura: AXXON EL MILLON → FP00001038

**Fecha:** 2026-08-04
**Trabajo mesa:** f9812120-421b-4e5a-8093-b80939c69882
**Aprobó:** (sin nombre en la fila) por la mesa web

## Hecho

Consumo con tarjeta Visa Blackbox 2414 DOP, comercio AXXON EL MILLON,
RD$750.00 del 2026-06-18 (movimiento bancario `banco_tx_id`
10bf4c99-008e-4bcc-95c8-ddfbf9d1a90b).

## Decisión

El consumo ya tiene su factura en ADM: **FP00001038** de ESTACION AXXONEL
MILLON por RD$750.00 del 2026-06-18 (VendorBills, UUID
92d57335-606d-4474-8b35-08ded7523e7c). Casó por monto, fecha y comercio,
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
