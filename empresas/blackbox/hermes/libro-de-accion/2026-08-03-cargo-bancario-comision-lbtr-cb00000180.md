# Cargo bancario — Comisión por transferencia LBTR

**Fecha:** 2026-07-30
**Documento ADM:** CB00000180 (BankCharges)
**Monto:** RD$100.00 DOP
**Banco:** Banco Santa Cruz — Operaciones (cuenta 11122010023874, 101.06)
**Aprobó:** C.Araujo, por la mesa web (aprobación en lote)

## Asiento

| Cuenta | Descripción | Débito | Crédito |
|--------|-------------|--------|---------|
| 640.01 Cargos Bancarios | Comisión Por Transferencia LBTR | 100.00 | — |
| 101.06 Banco Operaciones 874 | Banco Santa Cruz · Operaciones | — | 100.00 |

## Detalle

Cargo bancario detectado por conciliación (banco_tx_id cfb1ebf6). Comisión por transferencia LBTR del 30/07. Clasificación por script de conciliación (`metodo='script'`), cuenta 640.01 según mapa de cargos del histórico ADM.

## Alcance

Todo cargo bancario de Banco Santa Cruz con concepto "Comisión por Transferencia LBTR" se registra como BankCharges con débito a 640.01 Cargos Bancarios y crédito al banco origen.
