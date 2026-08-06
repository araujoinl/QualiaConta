# Cargo bancario — Comisión LBTR (Banco Santa Cruz, cuenta Impuestos) — reemplazo del CB00000226 anulado

**Fecha:** 2026-08-05
**Documento ADM:** CB00000229 (BankCharges, UUID 6947df42-040b-41c0-40f2-08def10be22c)
**Reemplaza:** CB00000226 (UUID 227195d0-18fb-4485-40ef-08def10be22c), anulado el 2026-08-05
**Aprobó:** C.Araujo, por la mesa web

## Hecho

Cargo del Banco Santa Cruz sobre la cuenta 11122010014964 (Banco Impuestos 964)
por RD$100.00, concepto «COMISION POR TRANSFERENCIA LBTR», con NCF E310004477185
del 2026-08-03. Es la comisión por una transferencia LBTR cobrada por el banco.

El primer registro de este cargo (CB00000226) fue anulado el 2026-08-05 y
reemplazado por CB00000229, que es el documento vigente que ampara este gasto.

## Asiento

- Débito 640.01 (Cargos Bancarios) — RD$100.00
- Crédito 101.05 (Banco Impuestos 964) — RD$100.00

## Criterio

Comisión bancaria por transferencia LBTR registrada como cargo bancario con NCF
del banco: cuenta de gasto 640.01 (Cargos Bancarios) al débito, cuenta de banco
101.05 al crédito. `Reference` en ADM = `E310004477185` (el NCF del comprobante),
que persistió en el readback (`referencia_en_adm: true`).

Nota: el CB00000226 anulado usaba como `Reference` el `banco_tx_id`
(b3a8107c-fdfb-4e23-8f87-4cd76c3ffd67); el CB00000229 vigente usa el NCF. La
llave para distinguir cargos gemelos del mismo día y monto sigue siendo el
`Reference` poblado en ADM; cuando el cargo trae NCF propio del banco, ese NCF
sirve igual de bien que el `banco_tx_id`.

## Alcance

Aplica a todo cargo del Banco Santa Cruz etiquetado como «COMISION POR
TRANSFERENCIA LBTR» sobre la cuenta Banco Impuestos 964 (11122010014964): mismo
asiento, mismas cuentas, `Reference` = el `banco_tx_id` del movimiento o el NCF
del comprobante (el que quede persistido en el readback), sin re-preguntar.
