# Cargo bancario — Impuesto 2.0 por 1000 s/Ley 30-26 (Banco Santa Cruz, cuenta Operaciones)

**Fecha:** 2026-08-05
**Documento ADM:** CB00000233 (BankCharges, UUID 7aa95f85-2494-4a7f-40f6-08def10be22c)
**Aprobó:** C.Araujo, por la mesa web

## Hecho

Cargo del Banco Santa Cruz sobre la cuenta 11122010023874 (Banco Operaciones
874) por RD$301.05, concepto «IMP. 2.0 POR 1000 S/LEY 30-26», con NCF
E310004426534 del 2026-07-31. Ampara 7 movimientos del banco (7 cargos por
impuesto de Ley 30-26 del mismo período), agrupados en un solo cargo bancario
en ADM.

## Asiento

- Débito 640.02 (Cargos sobre cheques 0.15) — RD$301.05
- Crédito 101.06 (Banco Operaciones 874) — RD$301.05

## Criterio

Impuesto del 2 por mil sobre cheques (Ley 30-26) cobrado por el Banco Santa
Cruz, registrado como cargo bancario con NCF del banco: cuenta de gasto 640.02
(Cargos sobre cheques 0.15) al débito, cuenta de banco 101.06 al crédito.
Cuando el banco cobra varios cargos por Ley 30-26 del mismo período sobre la
misma cuenta, se agrupan en un único cargo bancario amparado por un solo NCF;
el `detalle` de la propuesta desglosa los movimientos individuales (7 en este
caso). `Reference` en ADM = `E310004426534` (NCF del cargo), que persistió en
el readback (`referencia_en_adm: true`).

## Alcance

Aplica a todo cargo del Banco Santa Cruz etiquetado como «IMP. 2.0 POR 1000
S/LEY 30-26» sobre la cuenta Banco Operaciones 874 (11122010023874): mismo
asiento, mismas cuentas (640.02 / 101.06), `Reference` = el NCF del comprobante,
sin re-preguntar. Cuando varios movimientos por Ley 30-26 del mismo período se
consolidan bajo un único NCF, se registran como un solo BankCharges.
