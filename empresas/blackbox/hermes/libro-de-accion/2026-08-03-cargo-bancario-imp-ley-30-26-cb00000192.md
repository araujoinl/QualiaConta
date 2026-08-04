# Cargo bancario — Imp. 2.0 Por 1000 S/Ley 30-26 (CB00000192)

**Aprobó:** C. Araujo, por la mesa web (trabajo 4678fc3f).
**Fecha:** 2026-08-03
**Documento ADM:** BankCharges CB00000192 (UUID 65732033-c029-430e-c9df-08def10be22b)
**Banco:** Banco Santa Cruz — Operaciones 874 (cuenta 101.06)
**Fecha del cargo:** 2026-07-30
**Monto:** RD$29.53 DOP

## Asiento

| Cuenta | Descripción | Débito | Crédito |
|--------|-------------|--------|---------|
| 640.02 Cargos sobre cheques 0.15 | Imp. 2.0 Por 1000 S/Ley 30-26 | 29.53 | |
| 101.06 Banco Operaciones 874 | Imp. 2.0 Por 1000 S/Ley 30-26 | | 29.53 |

## Alcance

Los cargos bancarios por impuesto del 2‰ sobre cheques (Ley 30-26) se registran
como **BankCharges** en ADM Cloud: débito a **640.02 Cargos sobre cheques 0.15**,
crédito a la cuenta bancaria correspondiente. Aplica a todo cargo de este impuesto
que aparezca en cualquier cuenta bancaria de BlackBox SRL.

El impuesto del 2‰ sobre cheques es un tributo municipal establecido por la
Ley 30-26 (reforma al Código Tributario municipal). No genera crédito fiscal
(ITBIS) ni es gasto deducible del ISR — va a cuenta de gasto no admitido si
aplica, pero por precedente histórico de BlackBox se registra en 640.02 como
cargo bancario operativo.

## Origen

- Propuesta automática por script de conciliación bancaria (Supabase → ADM).
- `metodo='script'`, `documento_adm='BankCharges'`.
- Transacción bancaria: `632431f3-32f7-4384-9335-648d24244bf6` (santacruz · Operaciones).
