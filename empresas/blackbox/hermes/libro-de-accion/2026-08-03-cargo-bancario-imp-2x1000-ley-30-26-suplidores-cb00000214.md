# Cargo bancario — Imp. 2.0 Por 1000 S/Ley 30-26 (Banco Santa Cruz Suplidores)

**Registrada en ADM como:** CB00000214 (BankCharges, uuid 96eb5a26-d348-41e7-ce91-08def10be22b)
**Aprobó:** C.Araujo, por la mesa web (2026-08-03)
**Método:** script

## Documento

- **Banco/cuenta:** Banco Santa Cruz — 102.01 Banco Suplidores USD 404 (cuenta 21122020001404)
- **Fecha:** 2026-07-23
- **Moneda/Monto:** USD 2.25 (cargo — sale dinero del banco)
- **Descripción:** Imp. 2.0 Por 1000 S/Ley 30-26
- **Transacción banco (Supabase):** 88877657-9ef4-4673-8ad4-883f765fd430

## Asiento

Cargo bancario (BankCharges, DocType BANK_TRA). El banco va en CashAccountID
(cabecera); la contrapartida en Accounts[].

| Cuenta | Descripción | Débito | Crédito |
|---|---|---|---|
| 640.02 Cargos sobre cheques 0.15 | Imp. 2.0 Por 1000 S/Ley 30-26 | 2.25 | — |
| 102.01 Banco Suplidores USD 404 | santacruz · Suplidores (cabecera) | — | 2.25 |

TotalAmount = 2.25 USD (positivo = débito: sale dinero del banco).
Tasa de cambio: 58.3111 DOP/USD.

## Alcance

Cargos del Banco Santa Cruz por impuesto del 2 por mil sobre cheques (Ley
30-26) en la cuenta 102.01 Banco Suplidores USD 404 (cuenta 21122020001404) se
registran como BankCharges (DocType BANK_TRA): CashAccountID = 102.01,
contrapartida 640.02 Cargos sobre cheques 0.15 (débito), TotalAmount positivo.
El script `registrar-cargo-bancario.py` resuelve este caso automáticamente.
