# Pago de factura MANAGE SRL — PP00000756

**Fecha:** 2026-07-31  
**Aprobó:** Victor, por la mesa web  
**Documento ADM:** BillPayments PP00000756 (uuid d077894b-3ee3-40c5-f834-08def2c88fdf)  
**Factura aplicada:** FP00001116 (MANAGE SRL, RNC 131674811, RD$1,629.99)  
**Banco:** Santa Cruz — Visa 2414 RD$ (cargo)  
**Movimiento banco:** 828d2b93-8cc3-4fed-a944-89b2cbd33838  
**Método de clasificación:** monto exacto contra una sola factura.

## Hecho

Pago de la factura FP00001116 de MANAGE SRL por RD$1,629.99, cargado a la
tarjeta Visa 2414 RD$ del Banco Santa Cruz el 2026-07-31. Registrado en ADM
como BillPayments PP00000756, con `Reference` = `828d2b93-…` (el uuid del
movimiento bancario) para distinguirlo de cargos gemelos.

## Alcance

Los pagos de tarjeta que cuadran por monto exacto contra una sola factura se
asignan directo a esa factura, sin partición. La `Reference` con el
`banco_tx_id` es la llave que distingue dos movimientos idénticos del mismo
día — se manda siempre en BillPayments.
