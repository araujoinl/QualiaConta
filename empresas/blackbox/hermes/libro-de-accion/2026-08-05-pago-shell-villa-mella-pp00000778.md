# Pago FP00001098 — Shell Villa Mella (PP00000778)

**Fecha:** 2026-07-16
**Aprobó:** Victor, por la mesa web
**Documento ADM:** BillPayments PP00000778 (uuid 039a2aa9-a9dd-4928-5f18-08def10be22c)
**Factura pagada:** VendorBills FP00001098 (uuid 2c34b784-7ea2-4fca-0c5b-08def13e52a2)

## Hecho

Pago de RD$750.00 a Isla Dominicana De Petroleo Corporation (RNC 101008172,
"Shell Villa Mella") aplicado a la factura de compra FP00001098, emitida el
2026-07-16 por el mismo monto. Pago cargado a la tarjeta Visa 2414 RD$
(407537XXXXXX2414-DOP) del Banco Santa Cruz.

## Asiento

- Débito: Cuentas por Pagar (Isla Dominicana De Petroleo) — RD$750.00
- Crédito: Banco Santa Cruz / Visa 2414 RD$ — RD$750.00

Pago a factura única, monto exacto, sin retención. El `banco_tx_id`
(`a932f80f-c4b4-42bf-98a8-6ccc9a6b6bc7`) viaja en `Reference` del BillPayment
como trazabilidad del movimiento bancario.

## Alcance

Los pagos de factura vía sugerencia bancaria —cuando el movimiento del banco
calza por monto y fecha con una factura de proveedor vigente— se registran
como BillPayments aplicando el pago a la factura correspondiente, con
`Reference` = `banco_tx_id` para mantener la trazabilidad banco ↔ ADM. No
requieren revisión contable adicional cuando el cruce es exacto (una factura,
monto al peso).
