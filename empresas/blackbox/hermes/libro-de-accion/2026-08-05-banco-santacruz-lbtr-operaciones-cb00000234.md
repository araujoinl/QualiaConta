# Cargo bancario — Comisión LBTR (Banco Santa Cruz, cuenta Operaciones)

**Fecha:** 2026-08-05
**Documento ADM:** CB00000234 (BankCharges, UUID 9e55361b-b1e9-4c0e-40f7-08def10be22c)
**Aprobó:** C.Araujo, por la mesa web

## Hecho

Cargo del Banco Santa Cruz sobre la cuenta 11122010023874 (Banco Operaciones
874) por RD$600.00, concepto «COMISION POR TRANSFERENCIA LBTR», con NCF
E310004334864 del 2026-07-16. Ampara 6 movimientos del banco (6 comisiones LBTR
del mismo día), agrupados en un solo cargo bancario en ADM.

## Asiento

- Débito 640.01 (Cargos Bancarios) — RD$600.00
- Crédito 101.06 (Banco Operaciones 874) — RD$600.00

## Criterio

Comisión bancaria por transferencia LBTR registrada como cargo bancario con NCF
del banco: cuenta de gasto 640.01 (Cargos Bancarios) al débito, cuenta de banco
101.06 al crédito. Cuando el banco cobra varias comisiones LBTR del mismo día
sobre la misma cuenta, se agrupan en un único cargo bancario amparado por un
solo NCF; el `detalle` de la propuesta desglosa los movimientos individuales.
`Reference` en ADM = `E310004334864` (NCF del cargo), que persistió en el
readback (`referencia_en_adm: true`).

## Alcance

Aplica a todo cargo del Banco Santa Cruz etiquetado como «COMISION POR
TRANSFERENCIA LBTR» sobre la cuenta Banco Operaciones 874 (11122010023874):
mismo asiento, mismas cuentas (640.01 / 101.06), `Reference` = el NCF del
comprobante, sin re-preguntar. Cuando varios movimientos LBTR del mismo día se
consolidan bajo un único NCF, se registran como un solo BankCharges.
