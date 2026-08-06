# 2026-08-05 — Crédito por pago total Visa 2414 — CB00000232

## Hecho
Movimiento bancario de la tarjeta Visa 2414 RD$ (Banco Santa Cruz) del
2026-07-02, concepto «CREDITO POR PAGO TOTAL», monto RD$389.74. Es un
crédito/refund de la tarjeta de crédito corporativa, sin NCF ni ITBIS.

## Asiento registrado en ADM Cloud
Documento: **BankCharges CB00000232** (UUID 57313e8f-0f1e-4d71-40f5-08def10be22c)
- Reference: `84e78fc3-62a9-47d3-a8f2-d2b7a9c26498` (banco_tx_id del movimiento)
- DocDate: 2026-07-02, moneda DOP

| Cuenta | Descripción | Débito | Crédito |
|--------|-------------|-------:|--------:|
| 203.11 Tarjeta Corporativa 414 | santacruz · Visa 2414 RD$ — CREDITO POR PAGO TOTAL | 389.74 | — |
| 701.01 Ingresos Menores | CREDITO POR PAGO TOTAL | — | 389.74 |

Total: 389.74 / 389.74 — cuadra.

## Criterio
El «CREDITO POR PAGO TOTAL» de la tarjeta Visa 2414 se trata como ingreso
no operacional (701.01 Ingresos Menores) con débito a la cuenta de la
tarjeta (203.11) que reduce el saldo del pasivo. Sin NCF, sin ITBIS, sin
crédito fiscal. Método: script (sugerencia generada por el conciliador
bancario, basada en el mapa de cargos del histórico de ADM). Documento
ADM: BankCharges con dirección crédito (la cuenta de banco acredita).

## Aprobó
C.Araujo (por la mesa web), 2026-08-05.

## Alcance
Aplica a todo movimiento bancario de la tarjeta Visa 2414 RD$ cuyo concepto
sea «CREDITO POR PAGO TOTAL» (o refund/crédito similar de la tarjeta):
BankCharges con débito a 203.11 y crédito a 701.01, Reference =
banco_tx_id del movimiento. Sin NCF ni ITBIS. Si el concepto cambia o el
movimiento corresponde a otro tipo de reembolso, re-evaluar.
