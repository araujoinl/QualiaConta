# Transferencia banco-a-banco: Ingresos → Operaciones (TE00000214)

**Fecha:** 2026-08-03
**Documento ADM:** TE00000214 (uuid 71eebf7f-e9fc-4543-c43e-08def10be22b)
**Tipo de documento:** BankBankTransfers
**Aprobó:** C.Araujo, por la mesa web
**Método:** script (`registrar-transferencia-bancaria.py`)

## Hecho

Transferencia de RD$663,434.96 entre cuentas del Banco Santa Cruz:
- **Origen (crédito):** 101.04 — Banco Ingresos 801
- **Destino (débito):** 101.06 — Banco Operaciones 874
- **Referencia bancaria:** 15542569

Las dos patas del banco comparten la referencia 15542569, confirmando que es un
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
