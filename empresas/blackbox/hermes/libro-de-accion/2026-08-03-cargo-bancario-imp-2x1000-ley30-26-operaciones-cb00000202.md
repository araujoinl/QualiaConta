# Cargo bancario — Imp. 2.0 Por 1000 S/Ley 30-26 (Banco Santa Cruz Operaciones)

**Registrada en ADM como:** CB00000202 (BankCharges, uuid 3922c561-dd88-43cc-cdfe-08def10be22b)
**Aprobó:** C.Araujo por la mesa web (2026-08-03)
**Método:** script (registrar-cargo-bancario.py)
**Origen:** Sugerencia automática de cargo bancario desde Supabase (banco_tx_id 3ba30dd7-502a-47ab-8a2e-f01cc89b479b)

## Hecho

Cargo bancario del Banco Santa Cruz, cuenta Operaciones (11122010023874), con
fecha 2026-07-31, descripción «Imp. 2.0 Por 1000 S/Ley 30-26», monto RD$30.00.
Impuesto del 2‰ por cada mil sobre cheques (Ley 30-26).

## Asiento

- Débito: 640.02 Cargos sobre cheques 0.15 — RD$30.00
- Crédito:  101.06 Banco Operaciones 874 — RD$30.00

## Alcance

Todo cargo bancario de Banco Santa Cruz cuyo concepto sea «Imp. 2.0 Por 1000
S/Ley 30-26» (impuesto del 2‰ sobre cheques, Ley 30-26), en cualquiera de sus
cuentas, se registra como BankCharges: débito a 640.02 (Cargos sobre cheques
0.15) y crédito a la cuenta bancaria origen. Consistente con las entradas
previas del mismo concepto (CB00000165, CB00000171, CB00000177, CB00000181,
CB00000185, CB00000189, CB00000194, CB00000196, CB00000198, CB00000201).
