# Cargo bancario — Comisión LBTR CB00000164

**Fecha:** 2026-08-03
**Aprobó:** C.Araujo, por la mesa web (aprobación en lote)
**Documento ADM:** CB00000164 (BankCharges, uuid a7182006-4b6a-4094-c726-08def10be22b)

## Hecho

Comisión Por Transferencia LBTR del Banco Santa Cruz, cuenta Operaciones
(11122010023874), RD$100.00 DOP, fecha 03/08/2026.

## Asiento

| Cuenta | Descripción | Débito | Crédito |
|--------|-------------|--------|---------|
| 640.01 Cargos Bancarios | Comision Por Transferencia Lbtr | 100.00 | — |
| 101.06 Banco Operaciones 874 | santacruz · Operaciones | — | 100.00 |

## Origen

- Sugerencia automática de cargo bancario desde Supabase (banco_tx_id
  779045e5-7a25-4b90-a0d5-d0b1e89b8598).
- Cuenta 640.01 por mapa de cargos bancarios (histórico ADM).
- Método: script (conciliación banco → ADM).

## Alcance

Todo cargo bancario detectado en Supabase para la cuenta 101.06 Banco
Operaciones 874 (Banco Santa Cruz) con concepto "Comisión Por Transferencia
LBTR" se registra como BankCharges con débito a 640.01 Cargos Bancarios y
crédito a 101.06. Aplica mientras el concepto y la cuenta coincidan.
