# Cargo bancario: Imp. 2×1000 Ley 30-26 — Santa Cruz Operaciones (CB00000184)

**Fecha:** 2026-07-21
**Documento ADM:** BankCharges CB00000184 (UUID 6bbfa62e-37be-4ac9-c9a0-08def10be22b)
**Monto:** RD$4.00 DOP
**Banco:** Santa Cruz — cuenta Operaciones (11122010023874), cuenta contable 101.06

## Asiento

| Cuenta | Descripción | Débito | Crédito |
|--------|-------------|--------|---------|
| 640.02 Cargos sobre cheques 0.15 | Imp. 2.0 Por 1000 S/Ley 30-26 | 4.00 | |
| 101.06 Banco Operaciones 874 | santacruz · Operaciones | | 4.00 |

## Clasificación

- **Tipo de gasto:** N/A (cargo bancario, no factura de proveedor — no genera 606)
- **Cuenta contable:** 640.02 (Cargos sobre cheques 0.15) — impuesto 2×1000 sobre cheques, Ley 30-26
- **Documento ADM:** BankCharges (cargo bancario)
- **Método:** script (`registrar-cargo-bancario.py`)
- **Confianza:** 0.80

## Origen

Transacción bancaria `30e85154-d369-401b-9954-ed5371be0aed` detectada en Supabase (openbanking), banco Santa Cruz, cuenta Operaciones. Impuesto 2 por 1000 sobre cheques de la Ley 30-26.

## Aprobó

C.Araujo, por la mesa web (aprobación en lote, 2026-08-03).

## Alcance

Aplica a todo cargo bancario del banco Santa Cruz (cuenta Operaciones o cualquier otra cuenta del mismo banco) cuya descripción calce «Imp. 2×1000» o «Imp. 2.0 Por 1000 S/Ley 30-26»: se registra como BankCharges con débito a 640.02 y crédito a la cuenta de banco correspondiente.
