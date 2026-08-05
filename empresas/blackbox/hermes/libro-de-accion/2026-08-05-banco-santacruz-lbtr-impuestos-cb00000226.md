# Cargo bancario — Comisión LBTR (Banco Santa Cruz, cuenta Impuestos)

**Fecha:** 2026-08-05
**Documento ADM:** CB00000226 (BankCharges, UUID 227195d0-18fb-4485-40ef-08def10be22c)
**Aprobó:** C.Araujo, por la mesa web

## Hecho

Cargo del Banco Santa Cruz sobre la cuenta 11122010014964 (Banco Impuestos 964)
por RD$100.00, concepto «COMISION POR TRANSFERENCIA LBTR», con NCF E310004477185
del 2026-08-03. Es la comisión por una transferencia LBTR (Liquidación Bruta de
Transferencias Interbancarias) cobrada por el banco.

## Asiento

- Débito 640.01 (Cargos Bancarios) — RD$100.00
- Crédito 101.05 (Banco Impuestos 964) — RD$100.00

## Criterio

Comisión bancaria por transferencia LBTR registrada como cargo bancario con NCF
del banco: cuenta de gasto 640.01 (Cargos Bancarios) al débito, cuenta de banco
101.05 al crédito. `Reference` en ADM = `banco_tx_id` del movimiento del banco
(b3a8107c-fdfb-4e23-8f87-4cd76c3ffd67), que persistió en el readback y es la
llave que distingue dos cargos gemelos del mismo día y monto.

## Alcance

Aplica a todo cargo del Banco Santa Cruz etiquetado como «COMISION POR
TRANSFERENCIA LBTR» sobre la cuenta Banco Impuestos 964 (11122010014964): mismo
asiento, mismas cuentas, `Reference` = el `banco_tx_id` del movimiento, sin
re-preguntar.
