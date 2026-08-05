# Cargo bancario — Impuesto 2×1000 Ley 30-26 (Banco Santa Cruz, cuenta Operaciones)

**Fecha:** 2026-08-05
**Documento ADM:** CB00000227 (BankCharges, UUID 45eb0189-87b3-40ab-40f0-08def10be22c)
**Aprobó:** C.Araujo, por la mesa web

## Hecho

Cargo del Banco Santa Cruz sobre la cuenta 11122010023874 (Banco Operaciones 874)
por RD$115.48, concepto «IMP. 2.0 POR 1000 S/LEY 30-26», con NCF E310004480197 del
2026-08-03. Son tres movimientos del banco sumados en un solo cargo; corresponde al
impuesto del 2×1000 sobre cheques de la Ley 30-26.

## Asiento

- Débito 640.02 (Cargos sobre cheques 0.15) — RD$115.48
- Crédito 101.06 (Banco Operaciones 874) — RD$115.48

## Criterio

Impuesto bancario 2×1000 (Ley 30-26) registrado como cargo bancario con NCF del banco:
cuenta de gasto 640.02 al débito, cuenta de banco al crédito. `Reference` en ADM =
NCF del comprobante (E310004480197), que persistió en el readback. Cuando varios
movimientos del banco comparten el mismo NCF, se agrupan en un único cargo por el
monto total y se registran de una sola vez (no un cargo por movimiento).

## Alcance

Aplica a todo cargo del Banco Santa Cruz etiquetado como «IMP. 2.0 POR 1000 S/LEY 30-26»
(impuesto 2×1000 de la Ley 30-26) sobre la cuenta de banco Operaciones
(11122010023874): mismo asiento, mismas cuentas, sin re-preguntar. Aplica también
a los cargos del mismo concepto sobre la cuenta Ingresos (11121000000801), cambiando
únicamente la cuenta de crédito a 101.04 — ver entrada CB00000225 del mismo día.
