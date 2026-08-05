# Cargo bancario CB00000240 — Impuesto 2×1000 Ley 30-26

**Fecha:** 2026-07-03 (cargo), registrado en ADM el 2026-08-05
**Documento ADM:** BankCharges CB00000240 (uuid c344694c-ac7f-413a-40fd-08def10be22c)
**NCF / referencia:** E310004278242
**Monto:** RD$264.91 (DOP)
**Aprobó:** C.Araujo, por la mesa web

## Hecho

Banco Santa Cruz cobró el impuesto del 2 por mil (Ley 30-26) sobre la cuenta
Operaciones 874 (11122010023874), por tres movimientos del 2026-07-03. El banco
emitidió el e-CF E310004278242 como comprobante de ese cargo.

## Asiento

- Débito 640.02 Cargos sobre cheques 0.15 — RD$264.91
- Crédito 101.06 Banco Operaciones 874 — RD$264.91

## Método

`script` — conciliación automática de cargos bancarios contra el extracto de
Santa Cruz (Supabase). El script agrupó los 3 movimientos del banco bajo el
mismo NCF y propuso el cargo único.

## Alcance

Los cargos por impuesto 2×1000 (Ley 30-26) que Banco Santa Cruz emite como e-CF
E31 sobre la cuenta Operaciones se registran como `BankCharges` con débito a
640.02 y crédito al banco, agrupando los movimientos del día bajo el NCF del
banco. La referencia de ADM es el propio NCF, que el banco ya hace única por
emisor.
