# Cargo bancario CB00000237 — Impuesto 2×1000 Ley 30-26

**Fecha:** 2026-07-01 (cargo), registrado en ADM el 2026-08-05
**Documento ADM:** BankCharges CB00000237 (uuid d8a16e1d-60fd-4fa9-40fa-08def10be22c)
**NCF / referencia:** E310004262885
**Monto:** RD$9.33 (DOP)
**Aprobó:** C.Araujo, por la mesa web

## Hecho

Banco Santa Cruz cobró el impuesto del 2 por mil (Ley 30-26) sobre la cuenta
Operaciones 874 (11122010023874), por un movimiento del 2026-07-01. El banco
emitó el e-CF E310004262885 como comprobante de ese cargo.

## Asiento

- Débito 640.02 Cargos sobre cheques 0.15 — RD$9.33
- Crédito 101.06 Banco Operaciones 874 — RD$9.33

## Método

`script` — conciliación automática de cargos bancarios contra el extracto de
Santa Cruz (Supabase). El script tomó el movimiento del banco y lo propuso como
cargo único.

## Alcance

Los cargos por impuesto 2×1000 (Ley 30-26) que Banco Santa Cruz emite como e-CF
E31 sobre la cuenta Operaciones se registran como `BankCharges` con débito a
640.02 y crédito al banco, agrupando los movimientos del día bajo el NCF del
banco. La referencia de ADM es el propio NCF, que el banco ya hace única por
emisor.
