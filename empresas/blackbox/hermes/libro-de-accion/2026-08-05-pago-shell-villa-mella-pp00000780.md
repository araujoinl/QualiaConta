# Pago FP00001106 — Shell Villa Mella (PP00000780)

**Fecha:** 2026-07-23
**Aprobó:** Victor, por la mesa web
**Documento ADM:** BillPayments PP00000780 (uuid af8162b0-e0ea-4628-5f24-08def10be22c)
**Factura pagada:** VendorBills FP00001106 (uuid 5c13bd63-b18b-420d-b2d9-08def10be22b)

## Hecho

Pago de RD$750.00 a Isla Dominicana De Petroleo Corporation (RNC 101008172,
"Shell Villa Mella") aplicado a la factura de compra FP00001106, emitida el
2026-07-23 por el mismo monto. Pago cargado a la tarjeta Visa 2414 RD$
(407537XXXXXX2414-DOP) del Banco Santa Cruz.

## Asiento

- Débito: Cuentas por Pagar (Isla Dominicana De Petroleo) — RD$750.00
- Crédito: Banco Santa Cruz / Visa 2414 RD$ — RD$750.00

Pago a factura única, monto exacto, sin retención. El `banco_tx_id`
(`739cf525-69bd-4a7c-9534-a8c83f636eae`) viaja en `Reference` del BillPayment
como trazabilidad del movimiento bancario.

## Alcance

Los pagos de factura vía sugerencia bancaria —cuando el movimiento del banco
calza por monto y fecha con una factura de proveedor vigente— se registran
como BillPayments aplicando el pago a la factura correspondiente, con
`Reference` = `banco_tx_id` para mantener la trazabilidad banco ↔ ADM. No
requieren revisión contable adicional cuando el cruce es exacto (una factura,
monto al peso).
