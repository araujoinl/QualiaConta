# Pago de factura FP00001121 — Carrefour Market DTC (Visa 1877)

**Fecha:** 2026-08-04
**Aprobó:** Victor, por la mesa web
**Documento ADM:** PP00000785 (uuid `deca76ba-de54-48d1-3652-08def3752ab7`)
**Factura cancelada:** FP00001121 — Compañía Dominicana de Hipermercados CDH S A S (RNC 101802456)
**Monto:** RD$374.95
**Cuenta de caja:** Visa 1877 RD$ (407537XXXXXX1877-DOP)
**Tipo de pago:** Tarjeta de Crédito
**Referencia (banco_tx_id):** `f2c55a5a-c2db-4174-b7e9-05eeca95a1fb`
**Estado ADM:** Autorizado; la factura FP00001121 queda saldada

## Qué se decidió

Victor enlazó el consumo de la Visa 1877 (movimiento `f2c55a5a...` del banco,
CARREFOUR MARKET DTC, 2026-08-04) con la factura FP00001121 y autorizó el pago.

El pago cubre la factura completa (RD$374.95 sobre un saldo de RD$374.95 en
Cuentas por Pagar). El asiento lo derivó ADM: crédito a la cuenta de caja
Visa 1877 y débito a Cuentas por Pagar Proveedores DOP. No se clasificó gasto
— eso ya lo hizo la factura al registrarse.

## Detalle técnico

- `Reference` = `banco_tx_id` del movimiento bancario (`f2c55a5a-c2db-4174-b7e9-05eeca95a1fb`). Es la única llave que distingue dos pagos gemelos: no hay NCF en un BillPayment.
- `ExchangeRate` en `Documents[]` se copia de la factura (1.0 en DOP).
- `PaymentTypeID` se infiere de la cuenta: tarjeta → «Tarjeta de Crédito».

## Alcance

Aplica el Alcance de la entrada 2026-08-05-pago-fp00001102-megasuply-pp00000754: todo pago de factura de proveedor (BillPayments) registrado por la mesa lleva `PaymentTypeID` inferido de la cuenta de caja, `ExchangeRate` igual al de la factura, y `Reference` = `banco_tx_id` del movimiento bancario.
