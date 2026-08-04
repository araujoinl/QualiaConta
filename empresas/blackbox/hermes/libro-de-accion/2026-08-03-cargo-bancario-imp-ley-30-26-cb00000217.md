# Cargo bancario: Imp. 2.0 Por 1000 S/Ley 30-26 — CB00000217

**Fecha:** 2026-08-03
**Registrada en ADM Cloud como:** CB00000217 (BankCharges, uuid d8da2025-e77c-4e24-cef5-08def10be22b)
**Aprobó:** C.Araujo, por la mesa web (aprobación en lote del 2026-08-03)
**Documento ADM:** BankCharges
**Monto:** RD$45.19 (DOP)

## Asiento

| Cuenta | Descripción | Débito | Crédito |
|---|---|---:|---:|
| 640.02 — Cargos sobre cheques 0.15 | Imp. 2.0 Por 1000 S/Ley 30-26 | 45.19 | |
| 101.06 — Banco Operaciones 874 | santacruz · Operaciones | | 45.19 |

## Origen

- Transacción bancaria `827ef81c-8372-4a36-9121-af40327465c2` del banco Santa Cruz, cuenta Operaciones 11122010023874, fecha 2026-07-30.
- `metodo='script'` — la propuesta nace del pipeline de conciliación bancaria (cruce Supabase ↔ ADM), que clasifica el cargo contra el mapa de cuentas de cargo histórico de ADM.
- `confianza: 0.8`.

## Alcance

Aplica a los cargos bancarios del Banco Santa Cruz (cuenta Operaciones 101.06) que correspondan a «Imp. 2.0 Por 1000 S/Ley 30-26»: se registran como BankCharges con débito a 640.02 (Cargos sobre cheques 0.15) y crédito al banco. La cuenta 640.02 es la que el histórico de ADM usa para este impuesto, y es el default del mapa de cargos para ese concepto.
