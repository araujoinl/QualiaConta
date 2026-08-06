# Pago a factura — Supermercado El Dragon de Oro (PP00000765)

**Fecha:** 2026-07-17 (pago), 2026-08-05 (registro en ADM)
**Aprobó:** Victor, por la mesa web
**Documento ADM:** BillPayments PP00000765 (UUID 61234afa-19bf-413a-5ec1-08def10be22c)
**Factura pagada:** FP00001104 (UUID 6c79bec5-2698-4c7a-0f2e-08def13e52a2)
**Monto:** RD$1,464.01
**Banco:** Santa Cruz — Visa 2414 RD$ (407537XXXXXX2414-DOP)
**Movimiento del banco:** 8b010e7e-a7c7-462c-b7aa-3618c83d21f9

## Hecho

Pago de la factura FP00001104 del Supermercado El Dragon de Oro S.A. (RNC
101035129) por RD$1,464.01, cargado a la tarjeta Visa 2414 RD$ el 2026-07-17.
Registrado en ADM como BillPayment PP00000765, con `Reference` = el
`banco_tx_id` del movimiento bancario (8b010e7e…).

## Alcance

Aplica a los pagos de factura sugeridos por la mesa que se registren como
`BillPayments` en ADM: el `banco_tx_id` del movimiento del banco va siempre en
`Reference` para distinguir movimientos gemelos del mismo proveedor el mismo
día. Sin esa referencia no se puede probar que el documento ADM corresponde a
este movimiento y no a otro idéntico.
