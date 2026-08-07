# Pago de factura FP00001119 — Sabores del Desierto SRL (Visa 1877)

**Fecha:** 2026-08-04
**Aprobó:** Victor, por la mesa web
**Documento ADM:** PP00000784 (uuid `394e1779-9eda-47ae-880e-08def3a3c707`)
**Factura cancelada:** FP00001119 — Sabores del Desierto SRL (RNC 131925375)
**Monto:** RD$760.00
**Cuenta de caja:** Visa 1877 RD$ (407537XXXXXX1877-DOP)
**Tipo de pago:** Tarjeta de Crédito
**Referencia (banco_tx_id):** `cb57e0e9-75c5-4ef3-9803-e73dfa3e5375`
**Estado ADM:** Autorizado; la factura FP00001119 queda saldada

## Qué se decidió

Victor enlazó el consumo de la Visa 1877 (movimiento `cb57e0e9...` del banco,
HUMMUS DOWNTOWN CENTER, 2026-08-04) con la factura FP00001119 y autorizó el pago.

El pago cubre la factura completa (RD$760.00 sobre un saldo de RD$760.00 en
Cuentas por Pagar). El asiento lo derivó ADM: crédito a la cuenta de caja
Visa 1877 y débito a Cuentas por Pagar Proveedores DOP. No se clasificó gasto
— eso ya lo hizo la factura al registrarse (entrada
2026-08-04-fp00001119-hummus-sabores-del-desierto).

## Detalle técnico

- `Reference` = `banco_tx_id` del movimiento bancario (`cb57e0e9-75c5-4ef3-9803-e73dfa3e5375`). Es la única llave que distingue dos pagos gemelos: no hay NCF en un BillPayment.
- `ExchangeRate` en `Documents[]` se copia de la factura (1.0 en DOP).
- `PaymentTypeID` se infiere de la cuenta: tarjeta → «Tarjeta de Crédito».

## Alcance

Aplica el Alcance de la entrada 2026-08-05-pago-fp00001102-megasuply-pp00000754: todo pago de factura de proveedor (BillPayments) registrado por la mesa lleva `PaymentTypeID` inferido de la cuenta de caja, `ExchangeRate` igual al de la factura, y `Reference` = `banco_tx_id` del movimiento bancario.
