# 2026-08-05 — Crédito por pago total Visa 2414 — CB00000254

## Hecho
Movimiento bancario de la tarjeta Visa 2414 RD$ (Banco Santa Cruz) del
2026-06-25, concepto «CREDITO POR PAGO TOTAL», monto RD$414.73. Es un
crédito/refund de la tarjeta de crédito corporativa, sin NCF ni ITBIS.

## Asiento registrado en ADM Cloud
Documento: **BankCharges CB00000254** (UUID a0e92b63-ebde-4da1-5e70-08def10be22c)
- Reference: `62546599-bb1e-4998-b1c8-3eb0c6936fbe` (banco_tx_id del movimiento)
- DocDate: 2026-06-25, moneda DOP

| Cuenta | Descripción | Débito | Crédito |
|--------|-------------|-------:|--------:|
| 203.11 Tarjeta Corporativa 414 | santacruz · Visa 2414 RD$ — CREDITO POR PAGO TOTAL | 414.73 | — |
| 701.01 Ingresos Menores | CREDITO POR PAGO TOTAL | — | 414.73 |

Total: 414.73 / 414.73 — cuadra.

## Criterio
El «CREDITO POR PAGO TOTAL» de la tarjeta Visa 2414 se trata como ingreso
no operacional (701.01 Ingresos Menores) con débito a la cuenta de la
tarjeta (203.11) que reduce el saldo del pasivo. Sin NCF, sin ITBIS, sin
crédito fiscal. Método: script (sugerencia generada por el conciliador
bancario, basada en el mapa de cargos del histórico de ADM). Documento
ADM: BankCharges con dirección crédito (la cuenta de banco acredita).

## Aprobó
Victor (por la mesa web), 2026-08-05.

## Alcance
Aplica a todo movimiento bancario de la tarjeta Visa 2414 RD$ cuyo concepto
sea «CREDITO POR PAGO TOTAL» (o refund/crédito similar de la tarjeta):
BankCharges con débito a 203.11 y crédito a 701.01, Reference =
banco_tx_id del movimiento. Sin NCF ni ITBIS. Si el concepto cambia o el
movimiento corresponde a otro tipo de reembolso, re-evaluar.
