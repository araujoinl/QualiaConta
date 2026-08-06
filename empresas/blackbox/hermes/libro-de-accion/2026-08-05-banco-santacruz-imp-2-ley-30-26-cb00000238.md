# Cargo bancario — Imp. 2.0 Por 1000 S/Ley 30-26 (Banco Santa Cruz Operaciones)

**Registrada en ADM como:** CB00000238 (BankCharges, uuid eb9011f3-0493-4925-40fb-08def10be22c)
**Aprobó:** C.Araujo, por la mesa web (2026-08-05)
**Método:** script

## Documento

- **Banco/cuenta:** Banco Santa Cruz — 101.06 Banco Operaciones 874 (cuenta 11122010023874)
- **Fecha del cargo:** 2026-07-02
- **Fecha NCF:** 2026-07-03
- **Moneda/Monto:** DOP 117.55 (cargo — sale dinero del banco)
- **Descripción:** IMP. 2.0 POR 1000 S/LEY 30-26
- **NCF:** E310004271850
- **Transacciones banco (Supabase):** 3b89911d-a076-4fe7-9fe9-a747a454b9ec, c71e702f-4a2b-4387-b030-4962f152053b (2 movimientos)

## Asiento

Cargo bancario (BankCharges, DocType BANK_TRA). El banco va en CashAccountID
(cabecera); la contrapartida en Accounts[].

| Cuenta | Descripción | Débito | Crédito |
|---|---|---|---|
| 640.02 Cargos sobre cheques 0.15 | IMP. 2.0 POR 1000 S/LEY 30-26 | 117.55 | — |
| 101.06 Banco Operaciones 874 | santacruz · Operaciones (cabecera) | — | 117.55 |

TotalAmount = 117.55 DOP (positivo = débito: sale dinero del banco).
Reference = E310004271850 (NCF del cargo, persiste en ADM — confirmado `referencia_en_adm: true`).

## Alcance

Cargos del Banco Santa Cruz por impuesto del 2 por mil sobre cheques (Ley
30-26) en la cuenta 101.06 Banco Operaciones 874 (cuenta 11122010023874) se
registran como BankCharges (DocType BANK_TRA): CashAccountID = 101.06,
contrapartida 640.02 Cargos sobre cheques 0.15 (débito), TotalAmount positivo.
Cuando el cargo trae NCF (e-CF tipo 31), se envía como Reference para distinguir
movimientos gemelos del mismo día. El script `registrar-cargo-bancario.py`
resuelve este caso automáticamente.
