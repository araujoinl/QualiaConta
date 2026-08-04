# Cargo bancario — Banco Santa Cruz, comisión LBTR (2026-07-30)

**Fecha:** 2026-08-03
**Aprobó:** C.Araujo, por la mesa web
**Documento ADM:** CB00000218 (BankCharges)
**Banco:** Banco Santa Cruz — cuenta Operaciones 11122010023874 (101.06)
**Fecha del cargo:** 2026-07-30
**Monto:** RD$100.00 DOP

## Asiento

- Débito 640.01 Cargos Bancarios — RD$100.00 (Comisión Por Transferencia LBTR)
- Crédito 101.06 Banco Operaciones 874 — RD$100.00

## Origen del criterio

Propuesta generada por script (`metodo='script'`) a partir del mapa de cargos
bancarios del histórico de ADM. La cuenta 640.01 es la dominante para cargos
bancarios en Blackbox; la cuenta de banco sale de la transacción del openbanking
que originó la sugerencia (`banco_tx_id` en la propuesta).

## Alcance

Aplica a TODO cargo bancario del Banco Santa Cruz cuya descripción calce con
una comisión por transferencia (LBTR u otra transferencia bancaria) y que se
sugiera desde la conciliación openbanking → ADM. La cuenta de gasto es 640.01
Cargos Bancarios y la cuenta de banco la de la transacción origen. No requiere
aprobación individual del criterio contable; la aprobación de la fila en la
mesa confirma el cargo.
