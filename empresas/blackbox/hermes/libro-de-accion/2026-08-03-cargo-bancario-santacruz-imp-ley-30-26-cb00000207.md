# Cargo bancario — Imp. 2.0 Por 1000 S/Ley 30-26

**Fecha:** 2026-07-07
**Monto:** RD$12.98
**Banco:** Santa Cruz — cuenta Operaciones (101.06, nº 11122010023874)
**Documento ADM:** CB00000207 (BankCharges, uuid 16811e29-eba8-4254-ce27-08def10be22b)
**Aprobó:** C.Araujo, por la mesa web (aprobación en lote, 2026-08-03)

## Asiento

| Cuenta | Débito | Crédito |
|---|---:|---:|
| 640.02 Cargos sobre cheques 0.15 | 12.98 | |
| 101.06 Banco Operaciones 874 | | 12.98 |

Impuesto del 2×1000 sobre cheques, Ley 30-26, debitado por Banco Santa Cruz el
2026-07-07 en la cuenta Operaciones.

## Alcance

Cargos por impuesto 2×1000 (Ley 30-26) debitados por el banco en cualquier
cuenta bancaria de Blackbox: van a **640.02 Cargos sobre cheques 0.15** como
contrapartida débito, con crédito a la cuenta de banco correspondiente, y se
registran en ADM como **BankCharges** (`DocType=BANK_TRA`). Aplica a cualquier
fecha y monto mientras la naturaleza del cargo sea el impuesto sobre cheques de
esa ley.

## Origen

Mesa de trabajo (sugerencia por script de conciliación bancaria), trabajo
`ff770244-29e8-4924-9f57-50917233c7df`. Cuenta 640.02 según el mapa de cargos
histórico de ADM; método script.
