# Cargo bancario — Banco Santa Cruz, comisión LBTR RD$100

**Fecha:** 2026-08-03
**Aprobó:** C.Araujo (por la mesa web, aprobación en lote)
**Documento ADM:** CB00000182 (UUID f4be629c-8e11-4bc3-c995-08def10be22b)
**Trabajo mesa:** 3336a959-913f-412f-a021-c9b678e2774f
**Origen:** sugerencia del script de conciliación bancaria (metodo=script)

## Hecho
Banco Santa Cruz cobró comisión por transferencia LBTR el 2026-07-30, RD$100.00 DOP,
en la cuenta 101.06 Banco Operaciones 874 (nro. 11122010023874).

## Criterio
Cargo bancario registrado como `BankCharges` (ADM, DocType BANK_TRA):
- Débito 640.01 Cargos Bancarios — RD$100.00
- Crédito 101.06 Banco Operaciones 874 — RD$100.00

`direccion=cargo` (TotalAmount +100.00, banca sale). Cuenta 640.01 por el mapa
de cargos bancarios del histórico ADM (no es factura de proveedor: no hay NCF
ni ITBIS).

## Alcance
Todo cargo bancario del Santa Cruz (comisiones LBTR, mantenimiento, IVM, etc.)
que llegue por la conciliación se registra por esta vía: `BankCharges` con
débito a 640.01 Cargos Bancarios y crédito a la cuenta de banco que lo sufrió.
La cuenta de gasto puede variar si el cargo corresponde a otra naturaleza (p.ej.
intereses de capitalización → 700.01 Intereses Bancarios como contrapartida),
pero el documento ADM y la mecánica son los mismos.
