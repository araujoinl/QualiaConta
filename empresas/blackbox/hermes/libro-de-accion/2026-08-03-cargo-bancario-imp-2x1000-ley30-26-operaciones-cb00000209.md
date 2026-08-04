# Cargo bancario — Imp. 2.0 Por 1000 S/Ley 30-26 (Banco Santa Cruz Operaciones)

**Registrada en ADM como:** CB00000209 (BankCharges, uuid e53a8d7b-988d-475e-ce38-08def10be22b)
**Aprobó:** C.Araujo, por la mesa web (2026-08-03, aprobación en lote)
**Método:** script

## Documento

- **Banco/cuenta:** Banco Santa Cruz — 101.06 Banco Operaciones 874 (cuenta 11122010023874)
- **Fecha:** 2026-07-03
- **Moneda/Monto:** DOP 130.79 (cargo — sale dinero del banco)
- **Descripción:** Imp. 2.0 Por 1000 S/Ley 30-26
- **Transacción banco (Supabase):** c584c2f9-0248-462c-8905-e1f1e9fbedcf

## Asiento

Cargo bancario (BankCharges, DocType BANK_TRA). El banco va en CashAccountID
(cabecera); la contrapartida en Accounts[].

| Cuenta | Descripción | Débito | Crédito |
|---|---|---|---|
| 640.02 Cargos sobre cheques 0.15 | Imp. 2.0 Por 1000 S/Ley 30-26 | 130.79 | — |
| 101.06 Banco Operaciones 874 | santacruz · Operaciones (cabecera) | — | 130.79 |

TotalAmount = 130.79 DOP (positivo = débito: sale dinero del banco).

## Alcance

Cargos del Banco Santa Cruz por impuesto del 2 por mil sobre cheques (Ley
30-26) en la cuenta 101.06 Banco Operaciones 874 (cuenta 11122010023874) se
registran como BankCharges (DocType BANK_TRA): CashAccountID = 101.06,
contrapartida 640.02 Cargos sobre cheques 0.15 (débito), TotalAmount positivo.
El script `registrar-cargo-bancario.py` resuelve este caso automáticamente.
