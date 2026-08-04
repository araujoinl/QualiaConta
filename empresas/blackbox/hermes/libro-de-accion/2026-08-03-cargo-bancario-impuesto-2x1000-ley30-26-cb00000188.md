# Cargo bancario: Imp. 2.0 Por 1000 S/Ley 30-26 — RD$69.89 (CB00000188)

**Fecha:** 2026-08-03
**Documento ADM:** CB00000188 (uuid 911aa578-c5b7-419f-c9d3-08def10be22b)
**Tipo de documento:** BankCharges
**Aprobó:** C.Araujo, por la mesa web
**Método:** script (`registrar-cargo-bancario.py`)

## Hecho

Cargo bancario del 2026-07-15 detectado por conciliación con el Banco Santa
Cruz (cuenta Operaciones 874):

- **Banco (CashAccountID):** 101.06 — Banco Operaciones 874
- **Contrapartida (débito):** 640.02 — Cargos sobre cheques 0.15
- **Monto:** RD$69.89
- **Descripción bancaria:** "Imp. 2.0 Por 1000 S/Ley 30-26"

El banco cobra el Impuesto del 2 por mil sobre cheques (Ley 30-26) y lo debita
del saldo de la cuenta Operaciones. El asiento lo deriva ADM: el
`CashAccountID` acredita el banco y `Accounts[]` debita la cuenta de gasto.

## Alcance

Los cargos bancarios detectados por conciliación (openbanking) en cuentas de
Blackbox se registran en ADM como `BankCharges` con:
- `CashAccountID` = la cuenta de banco donde se debitó el cargo
- `Accounts[]` = la(s) contrapartida(s) según el mapa de cargos del histórico
  de ADM (en este caso 640.02 Cargos sobre cheques 0.15 para el ITBIS del 2‰
  Ley 30-26)
- `TotalAmount` = monto del cargo (positivo para cargos, negativo para créditos)
- `DocType` = `BANK_TRA`

La cuenta contable de cada cargo sale del mapa de cargos bancarios histórico
de ADM, no de una clasificación manual caso por caso. Aplica a todo cargo
bancario de Blackbox detectado por conciliación.
