# Pago de factura FP00001064 — EL RAMERO SOLITARIO SRL (Visa 1877)

**Fecha:** 2026-08-02
**Aprobó:** C.Araujo, por la mesa web
**Documento ADM:** PP00000755 (uuid `efcb35e6-dbb1-4ea8-f7a6-08def2c88fdf`)
**Factura cancelada:** FP00001064 — EL RAMERO SOLITARIO SRL (RNC 132068793)
**Monto:** RD$2,112.00
**Cuenta de caja:** Visa 1877 RD$ (407537XXXXXX1877-DOP)
**Tipo de pago:** Tarjeta de Crédito
**Referencia (banco_tx_id):** `4da3efe1-8fca-4fcc-847a-80e916310433`
**Estado ADM:** Autorizado; la factura FP00001064 queda saldada

## Qué se decidió

C.Araujo enlazó el consumo de la Visa 1877 (movimiento `4da3efe1...` del banco, EL RAMERO SOLITARIO, 2026-08-02) con la factura FP00001064 y autorizó el pago.

El pago cubre la factura completa (RD$2,112.00 sobre un saldo de RD$2,112.00 en Cuentas por Pagar). El asiento lo derivó ADM: crédito a la cuenta de caja Visa 1877 y débito a Cuentas por Pagar Proveedores DOP. No se clasificó gasto — eso ya lo hizo la factura al registrarse (entrada 2026-08-03-el-ramero-solitario-restaurante-representacion).

## Detalle técnico

- `Reference` = `banco_tx_id` del movimiento bancario (`4da3efe1-8fca-4fcc-847a-80e916310433`). Es la única llave que distingue dos pagos gemelos: no hay NCF en un BillPayment.
- `ExchangeRate` en `Documents[]` se copia de la factura (1.0 en DOP).
- `PaymentTypeID` se infiere de la cuenta: tarjeta → «Tarjeta de Crédito».

## Alcance

Aplica el Alcance de la entrada 2026-08-05-pago-fp00001102-megasuply-pp00000754: todo pago de factura de proveedor (BillPayments) registrado por la mesa lleva `PaymentTypeID` inferido de la cuenta de caja, `ExchangeRate` igual al de la factura, y `Reference` = `banco_tx_id` del movimiento bancario.
