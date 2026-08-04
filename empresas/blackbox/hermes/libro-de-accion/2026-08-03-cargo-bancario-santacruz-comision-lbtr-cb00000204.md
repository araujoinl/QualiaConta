# Cargo bancario — Comisión LBTR Banco Santa Cruz (Operaciones)

**Fecha:** 2026-08-03
**Documento ADM:** CB00000204 (BankCharges, uuid d4ce935a-4320-4785-ce16-08def10be22b)
**Registrado en ADM:** 2026-08-03

## Hecho

Cargo bancario del 2026-07-15: comisión por transferencia LBTR del Banco Santa
Cruz, cuenta Operaciones (101.06, nº 11122010023874), por RD$100.00.

## Asiento

- Débito 640.01 Cargos Bancarios — RD$100.00
- Crédito 101.06 Banco Operaciones 874 — RD$100.00

Documento ADM: `BankCharges` (DocType `BANK_TRA`). El banco va en `CashAccountID`
(cuenta 101.06); la contrapartida en `Accounts[]` (cuenta 640.01). Dirección:
cargo (TotalAmount positivo, sale dinero del banco).

## Método

`script` — la propuesta la armó el script de conciliación/cargos a partir del
mapa de cargos bancarios (histórico ADM) y la transacción de Supabase
(`banco_tx_id` 1058a3f3-c805-4a67-bbcb-43f5169766bf). Sin precedente de
proveedor: es un cargo bancario, no una factura.

## Aprobó

C.Araujo, por la mesa web (aprobación en lote, 2026-08-03 23:24 UTC).

## Alcance

Aplica a todo cargo bancario del Banco Santa Cruz cuenta Operaciones
(101.06 / nº 11122010023874) identificado por el script de conciliación como
comisión por transferencia LBTR, mismo banco y dirección cargo. La cuenta
640.01 Cargos Bancarios es la contrapartida por defecto para comisiones
bancarias de esta naturaleza.
