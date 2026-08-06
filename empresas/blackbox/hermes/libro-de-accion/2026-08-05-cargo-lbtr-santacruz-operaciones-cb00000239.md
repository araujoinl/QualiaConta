# Cargo bancario — Comisión LBTR (Banco Santa Cruz, cuenta Operaciones)

**Fecha:** 2026-08-05
**Documento ADM:** CB00000239 (BankCharges, UUID 13ec32e4-27b7-4aa5-40fc-08def10be22c)
**Aprobó:** C.Araujo, por la mesa web

## Hecho

Cargo del Banco Santa Cruz sobre la cuenta 11122010023874 (Banco Operaciones
874) por RD$100.00, concepto «COMISION POR TRANSFERENCIA LBTR», con NCF
E310004275338 del 2026-07-06. Ampara 1 movimiento del banco (cargo del
2026-07-03).

## Asiento

- Débito 640.01 (Cargos Bancarios) — RD$100.00
- Crédito 101.06 (Banco Operaciones 874) — RD$100.00

## Criterio

Comisión bancaria por transferencia LBTR registrada como cargo bancario con NCF
del banco: cuenta de gasto 640.01 (Cargos Bancarios) al débito, cuenta de banco
101.06 al crédito. `Reference` en ADM = `E310004275338` (NCF del cargo), que
persistió en el readback (`referencia_en_adm: true`).

## Alcance

Aplica a todo cargo del Banco Santa Cruz etiquetado como «COMISION POR
TRANSFERENCIA LBTR» sobre la cuenta Banco Operaciones 874 (11122010023874):
mismo asiento, mismas cuentas (640.01 / 101.06), `Reference` = el NCF del
comprobante, sin re-preguntar. Cuando varios movimientos LBTR del mismo día se
consolidan bajo un único NCF, se registran como un solo BankCharges.
