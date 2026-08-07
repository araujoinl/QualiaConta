# Pago de factura FP00001114 — ESTACION BELLA VISTA SRL (Visa 2414)

**Fecha:** 2026-08-06
**Aprobó:** Victor, por la mesa web
**Documento ADM:** PP00000782 (uuid `43c3eea7-13ae-48f6-363c-08def3752ab7`)
**Factura cancelada:** FP00001114 — ESTACION BELLA VISTA SRL (RNC 101744342)
**Monto:** RD$750.00
**Cuenta de caja:** Visa 2414 RD$ (cuenta número 407537XXXXXX2414-DOP)
**Tipo de pago:** Tarjeta de Crédito
**Referencia (banco_tx_id):** `bfd3def6-fb50-49c4-bef2-1b55b7b8c376`
**Estado ADM:** Autorizado; la factura FP00001114 queda saldada

## Qué se decidió

Victor enlazó el consumo de la Visa 2414 (movimiento `bfd3def6...` del banco, TOTAL BELLA VISTA, 2026-08-03) con la factura FP00001114 de ESTACION BELLA VISTA SRL y autorizó el pago por RD$750. El pago cubre la factura completa y el asiento lo derivó ADM: crédito a la cuenta de caja Visa 2414 y débito a Cuentas por Pagar Proveedores DOP. No se clasificó gasto — eso ya lo hizo la factura al registrarse.

## Alcance

Este criterio aplica a TODO pago de factura de proveedor (BillPayments) registrado por la mesa:
- **PaymentTypeID es obligatorio** y se infiere de la cuenta de caja: tarjeta → «Tarjeta de Crédito», cuenta bancaria → «Transferencia».
- **ExchangeRate en Documents[]** debe ser igual al de la factura que se cancela (1.0 en DOP, la del día en USD).
- **Reference** es el `banco_tx_id` del movimiento bancario, no el NCF de la factura.
- El script `registrar-pago-factura.py` es el camino único para registrar pagos.
