# Cargo bancario — Capitalización de Intereses Banco Impuestos 964 CB00000172

**Fecha:** 2026-08-03
**Aprobó:** C.Araujo, por la mesa web (aprobación en lote)
**Documento ADM:** CB00000172 (BankCharges, uuid 18e3ef60-235d-4a23-c8aa-08def10be22b)

## Hecho

Capitalización de intereses del Banco Santa Cruz, cuenta Impuestos
(11122010014964), RD$126.79 DOP, fecha 31/07/2026. Crédito bancario
(entrada de dinero al banco).

## Asiento

| Cuenta | Descripción | Débito | Crédito |
|--------|-------------|--------|---------|
| 101.05 Banco Impuestos 964 | santacruz · Impuestos | 126.79 | — |
| 700.01 Intereses Bancarios | Capitalizacion De Intereses | — | 126.79 |

## Origen

- Sugerencia automática de cargo bancario desde Supabase (banco_tx_id
  8f049129-ed45-4eaf-a428-639e02819f72).
- Cuenta 700.01 por mapa de cargos bancarios (histórico ADM): capitalización
  de intereses → ingreso financiero.
- Método: script (conciliación banco → ADM).

## Alcance

Todo crédito bancario detectado en Supabase para la cuenta 101.05 Banco
Impuestos 964 (Banco Santa Cruz) con concepto "Capitalizacion De Intereses"
se registra como BankCharges (dirección crédito) con débito a 101.05 y
crédito a 700.01 Intereses Bancarios. Aplica mientras el concepto y la
cuenta coincidan.
