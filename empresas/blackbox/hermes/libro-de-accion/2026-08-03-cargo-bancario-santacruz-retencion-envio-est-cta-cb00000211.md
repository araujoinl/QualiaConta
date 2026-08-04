# Cargo bancario — Banco Santa Cruz, retención/envío estado de cuenta

**Fecha:** 2026-08-03
**Aprobó:** C.Araujo, por la mesa web
**Documento ADM:** CB00000211 (BankCharges)
**Banco:** Banco Santa Cruz — cuenta Ingresos 11121000000801 (101.04)
**Fecha del cargo:** 2026-07-31
**Monto:** RD$150.00 DOP

## Asiento

- Débito 640.01 Cargos Bancarios — RD$150.00 (Por Retencion/Envio Est. Cta.)
- Crédito 101.04 Banco Ingresos 801 — RD$150.00

## Origen del criterio

Propuesta generada por script (`metodo='script'`) a partir del mapa de cargos
bancarios del histórico de ADM. La cuenta 640.01 es la dominante para cargos
bancarios en Blackbox; la cuenta de banco sale de la transacción del openbanking
que originó la sugerencia (`banco_tx_id` en la propuesta).

## Alcance

Aplica a TODO cargo bancario del Banco Santa Cruz cuya descripción calce con
retención/envío de estado de cuenta y que se sugiera desde la conciliación
openbanking → ADM. La cuenta de gasto es 640.01 Cargos Bancarios y la cuenta de
banco la de la transacción origen. No requiere aprobación individual del
criterio contable; la aprobación de la fila en la mesa confirma el cargo.
