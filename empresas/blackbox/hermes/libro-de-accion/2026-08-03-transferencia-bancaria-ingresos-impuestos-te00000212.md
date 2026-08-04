# Transferencia banco-a-banco: Ingresos → Impuestos (TE00000212)

**Fecha:** 2026-08-03
**Documento ADM:** TE00000212 (uuid 65bc7e9e-4b4e-4a46-c1d7-08def10be22b)
**Tipo de documento:** BankBankTransfers
**Aprobó:** Carlos Araujo, por la mesa web
**Método:** script (`registrar-transferencia-bancaria.py`)

## Hecho

Transferencia de RD$1,000,000.00 entre cuentas del Banco Santa Cruz:
- **Origen (crédito):** 101.04 — Banco Ingresos 801
- **Destino (débito):** 101.05 — Banco Impuestos 964
- **Referencia bancaria:** 15542541

Las dos patas del banco comparten la referencia 15542541, confirmando que es un
par real y no una coincidencia de monto.

## Alcance

Las transferencias entre cuentas de Blackbox detectadas por conciliación
bancaria (openbanking) se registran en ADM como `BankBankTransfers` con:
- `CashAccountID` = cuenta origen (sale el dinero)
- `DebitAccountID` = cuenta destino (entra el dinero)
- `TotalAmount` = monto transferido
- `Reference` = número de referencia bancaria cuando exista

El asiento lo deriva ADM: débito a la cuenta destino, crédito a la cuenta origen.
No se mandan líneas de Accounts[] — es una transferencia entre dos cuentas de
banco, no una partida doble con contrapartidas.

Aplica a toda transferencia banco-a-banco de Blackbox detectada por
conciliación, misma moneda, sin cambio de moneda.
