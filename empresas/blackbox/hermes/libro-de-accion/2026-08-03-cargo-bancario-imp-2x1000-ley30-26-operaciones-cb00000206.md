# Cargo bancario — Imp. 2.0 Por 1000 S/Ley 30-26 (Banco Santa Cruz Operaciones)

**Registrada en ADM como:** CB00000206 (BankCharges, uuid 44a12372-3122-45e5-ce20-08def10be22b)
**Aprobó:** C.Araujo, por la mesa web (2026-08-03)
**Método:** script

## Documento

- **Banco/cuenta:** Banco Santa Cruz — 101.06 Banco Operaciones 874 (cuenta 11122010023874)
- **Fecha:** 2026-07-09
- **Moneda/Monto:** DOP 180.00 (cargo — sale dinero del banco)
- **Descripción:** Imp. 2.0 Por 1000 S/Ley 30-26
- **Transacción banco (Supabase):** 1792c21c-b0b7-4d07-a221-c6efa3d730b0

## Asiento

Cargo bancario (BankCharges, DocType BANK_TRA). El banco va en CashAccountID
(cabecera); la contrapartida en Accounts[].

| Cuenta | Descripción | Débito | Crédito |
|---|---|---|---|
| 640.02 Cargos sobre cheques 0.15 | Imp. 2.0 Por 1000 S/Ley 30-26 | 180.00 | — |
| 101.06 Banco Operaciones 874 | santacruz · Operaciones (cabecera) | — | 180.00 |

TotalAmount = 180.00 DOP (positivo = débito: sale dinero del banco).

## Alcance

Cargos del Banco Santa Cruz por impuesto del 2 por mil sobre cheques (Ley
30-26) en la cuenta 101.06 Banco Operaciones 874 (cuenta 11122010023874) se
registran como BankCharges (DocType BANK_TRA): CashAccountID = 101.06,
contrapartida 640.02 Cargos sobre cheques 0.15 (débito), TotalAmount positivo.
El script `registrar-cargo-bancario.py` resuelve este caso automáticamente.
