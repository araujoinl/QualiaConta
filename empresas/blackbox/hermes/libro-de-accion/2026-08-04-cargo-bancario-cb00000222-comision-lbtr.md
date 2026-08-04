# Cargo bancario CB00000222 — Comisión Lbtr US$5.00

**Fecha:** 2026-07-31 (transacción) · 2026-08-04 (registro)
**Documento ADM:** BankCharges CB00000222 (uuid 0817fe0e-8c08-43bd-cf3e-08def10be22b)
**Aprobó:** C.Araujo, por la mesa web (aprobación en lote 2026-08-03)
**Método:** script (`registrar-cargo-bancario.py`)
**Moneda:** USD · Tasa 58.3111

## Asiento

| Cuenta | Código | Débito | Crédito | Descripción |
|---|---|---|---|---|
| Cargos Bancarios | 640.01 | 5.00 | — | Comisión Por Transferencia Lbtr |
| Banco Suplidores USD 404 | 102.01 | — | 5.00 | santacruz · Suplidores |

Total: 5.00 USD. Cuadra.

## Alcance

Los cargos bancarios del Banco Santa Cruz detectados por conciliación con
Supabase (openbanking) se registran como BankCharges en ADM: débito a la cuenta
de gasto 640.01 Cargos Bancarios, crédito a la cuenta bancaria correspondiente
según el mapa de cuentas. La moneda, la tasa y la cuenta bancaria salen del
mapa de cargos histórico de ADM. Aplica a todo cargo bancario de BlackBox SRL
identificado automáticamente por el script de conciliación.

## Origen

Sugerencia de la conciliación banco-ADM (script), aprobada en lote por
C.Araujo el 2026-08-03. Reintento por `registro_pendiente` resuelto el
2026-08-04.
