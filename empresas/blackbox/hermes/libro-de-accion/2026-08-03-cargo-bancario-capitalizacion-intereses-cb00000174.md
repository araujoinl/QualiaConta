# Cargo bancario — capitalización de intereses (Banco Santa Cruz Operaciones 874)

**Registrada en ADM como:** CB00000174 (BankCharges, uuid b13899c0-8891-4af8-c8f2-08def10be22b)
**Aprobó:** C.Araujo, por la mesa web (2026-08-03)
**Método:** script

## Documento

- **Banco/cuenta:** Banco Santa Cruz — 101.06 Banco Operaciones 874 (cuenta 11122010023874)
- **Fecha:** 2026-07-31
- **Moneda/Monto:** DOP 55.29 (crédito — entra dinero al banco)
- **Descripción:** Capitalización De Intereses
- **Transacción banco (Supabase):** bdb960fd-df77-4ebf-a02c-3d7f9fe1f2c8

## Asiento

Cargo bancario (BankCharges, DocType BANK_TRA). El banco va en CashAccountID
(cabecera); la contrapartida en Accounts[].

| Cuenta | Descripción | Débito | Crédito |
|---|---|---|---|
| 101.06 Banco Operaciones 874 | santacruz · Operaciones (cabecera) | 55.29 | — |
| 700.01 Intereses Bancarios | Capitalización De Intereses | — | 55.29 |

TotalAmount = −55.29 DOP (negativo = crédito: entra dinero al banco).

## Alcance

Capitalizaciones de intereses del Banco Santa Cruz en cuentas DOP (101.xx) se
registran como BankCharges (DocType BANK_TRA): CashAccountID = la cuenta de
banco de la transacción, contrapartida 700.01 Intereses Bancarios (crédito),
TotalAmount negativo. El script `registrar-cargo-bancario.py` resuelve este
caso automáticamente.
