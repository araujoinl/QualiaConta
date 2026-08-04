# Cargo bancario — Impuesto 2.0 por 1000 s/Ley 30-26 (CB00000215)

**Fecha:** 2026-08-03
**Documento ADM:** CB00000215 (BankCharges, uuid `bf603c4e-a126-457b-cea2-08def10be22b`)
**Banco:** santacruz · Operaciones (cuenta 11122010023874, cuenta contable 101.06 Banco Operaciones 874)
**Fecha del cargo:** 2026-07-30
**Monto:** RD$32.93 (DOP)

## Asiento

| Cuenta | Denominación | Débito | Crédito |
|---|---|---:|---:|
| 640.02 | Cargos sobre cheques 0.15 | 32.93 | — |
| 101.06 | Banco Operaciones 874 | — | 32.93 |

Débito a 640.02 (impuesto del 2 por mil s/Ley 30-26), crédito al banco 101.06.

## Criterio

Cargo bancario: impuesto 2.0 por 1000 sobre saldos, Ley 30-26. Cuenta 640.02
según el mapa de cargos del histórico de ADM. Dirección: cargo (sale dinero
del banco). `metodo='script'` — resuelto por `registrar-cargo-bancario.py`.

## Aprobó

C.Araujo, por la mesa web (aprobación en lote, 2026-08-03 23:24 UTC).

## Alcance

Todo cargo bancario del Banco Santa Cruz (cuenta Operaciones 874, 101.06)
identificado como **impuesto 2.0 por 1000 s/Ley 30-26** se registra como
BankCharges con débito a 640.02 (Cargos sobre cheques 0.15) y crédito al banco.
Aplica mientras el cargo conserve esa denominación y no supere la diferencia
tolerada del mapa de cargos.
