# Cargo bancario — capitalización de intereses (Banco Ganancia USD 181)

**Registrada en ADM como:** CB00000163 (BankCharges, uuid d5ee1032-6df6-4a41-be79-08def10be22b)
**Aprobó:** C.Araujo, por la mesa web (2026-08-03)
**Método:** script

## Documento

- **Banco/cuenta:** Banco Santa Cruz — 102.02 Banco Ganancia USD 181 (cuenta 21122020002181)
- **Fecha:** 2026-07-31
- **Moneda/Monto:** USD 0.04 (crédito — entra dinero al banco)
- **Descripción:** Capitalización de intereses
- **Transacción banco (Supabase):** 3018cfd0-f3ac-4fdb-a5df-0fe7dad06173

## Asiento

Cargo bancario (BankCharges, DocType BANK_TRA). El banco va en CashAccountID
(cabecera); la contrapartida en Accounts[].

| Cuenta | Descripción | Débito | Crédito |
|---|---|---|---|
| 102.02 Banco Ganancia USD 181 | santacruz · Ganancias (cabecera) | 0.04 | — |
| 700.01 Intereses Bancarios | Capitalización De Intereses | — | 0.04 |

TotalAmount = −0.04 USD (negativo = crédito: entra dinero al banco).
Tasa de cambio: 58.3111 (configurada en ADM para USD).

## Alcance

Capitalizaciones de intereses del Banco Santa Cruz en la cuenta 102.02 Banco
Ganancia USD 181 (cuenta 21122020002181) se registran como BankCharges (DocType
BANK_TRA): CashAccountID = 102.02, contrapartida 700.01 Intereses Bancarios
(crédito), TotalAmount negativo. Para montos que generen retención del 1%
(Norma 07-19, cuenta 150.06), se agrega una línea de débito por la retención.
El script `registrar-cargo-bancario.py` resuelve este caso automáticamente.
