# Consumo tarjeta ASADOR 21 — casó con factura existente

**Fecha:** 2026-08-04
**DocID ADM:** FP00001046 (preexistente, no se registró documento nuevo)
**Documento:** VendorBills (UUID 4d0cc225-6e77-4a77-cb34-08ded71d8747)
**Aprobó:** poller (registro automático, sin aprobación humana — sugerencia)
**Trabajo mesa:** 881939d5-9cdc-4566-bc72-cfa9238066df

## Hecho

Consumo con tarjeta Visa 1877 RD$ (cuenta 407537XXXXXX1877-DOP) del
2026-06-20 por RD$3,558.40, comercio ASADOR 21. El consumo casó por monto,
fecha y comercio con la factura FP00001046 de ASADOR 21MARE FLUMEN SRL ya
registrada en ADM. No se subió nada: la factura preexistente es el respaldo
del consumo.

Movimiento de banco: santacruz, banco_tx_id
86bf213b-c977-4e21-82ee-8a07d16d02ea, moneda DOP.

## Criterio

Sugerencia de cargo bancario resuelta por cruce con factura existente
(metodo=script, confianza 0.9). El consumo de tarjeta no generó registro
nuevo en ADM porque la factura del proveedor ya estaba registrada como
VendorBills FP00001046.

## Alcance

Aplica a futuros consumos de tarjeta que casen por monto, fecha y comercio
con una factura de proveedor ya registrada en ADM: se documenta la relación
(sin registro nuevo) y se referencia el DocID preexistente como respaldo.
