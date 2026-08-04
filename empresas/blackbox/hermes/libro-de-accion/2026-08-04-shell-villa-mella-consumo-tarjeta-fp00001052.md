# Consumo tarjeta SHELL VILLA MELLA — ya facturado (FP00001052)

Fecha: 2026-08-04
Trabajo mesa: 05b30900-79ac-4cd8-8fd8-cb6f9050eb06
Tipo: sugerencia (conciliación banco ↔ ADM)

## Hecho
Consumo con tarjeta Visa 2414 RD$ de Blackbox en SHELL VILLA MELLA por
RD$750.00, mov. banco `471b0bc6-4be6-4fc8-839b-9335777b74f8` del 2026-06-25.

## Decisión
El consumo ya tenía su factura de proveedor en ADM Cloud: **FP00001052**
de SHELL VILLA MELLA I, RD$750.00, fechada 2026-06-29. Casó por monto,
fecha y comercio, así que **no se registró nada nuevo**: la sugerencia se
cierra sin movimiento contable adicional.

Documento ADM existente: VendorBills FP00001052 (uuid
3bdb98b9-d16a-4504-9a80-08ded71d577b).

Método: script (conciliación, `metodo='script'`).
Confianza: 0.90.

## Aprobó
(Registrada por el poller de aprobaciones — `aprobado_por_nombre` vacío en
la fila; aprobación automática de la mesa web.)

## Alcance
Consumos de tarjeta que ya tienen su factura de proveedor asociada en ADM:
se identifican por cruce monto + fecha + comercio (conciliación) y se
cierran como sugerencia sin generar documento nuevo. El DocID citado
(FP00001052) es la factura de proveedor preexistente, no un documento
creado por este trabajo.
