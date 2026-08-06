# 2026-08-05 — Cargo bancario CB00000231 (ahorro por compra Visa 1877)

**Tipo:** Cargo bancario (BankCharges) — crédito a la cuenta del banco.
**Documento ADM:** CB00000231 · UUID `1202e704-7481-49b1-40f4-08def10be22c`
**Fecha:** 2026-07-01 (registrado 2026-08-05)
**Monto:** RD$184.24 · Moneda DOP

## Asiento

| Cuenta | Denominación | Débito | Crédito |
|---|---|---:|---:|
| 203.10 | Tarjeta Corporativa 877 | 184.24 |  |
| 701.01 | Ingresos Menores |  | 184.24 |

Concepto del movimiento: `AHORRO POR COMPRA` en tarjeta Visa 1877 RD$ del
Banco Santa Cruz. El `banco_tx_id` `cab7683d-b7dc-4f9d-9538-21a4dac26f89`
viajó en `Reference` del cargo en ADM y volvió poblado (confirmado en el
readback), así que queda como llave de unicidad del movimiento.

## Cómo se clasificó

- **Método:** `script` — la conciliación banco↔ADM produce la sugerencia.
- **Cuenta de contrapartida (701.01 Ingresos Menores):** según el mapa de
  cargos del histórico de ADM para movimientos de «ahorro por compra» en
  la tarjeta 1877.
- **`documento_adm`:** `BankCharges` (cargo bancario, débito al banco).
- **Confianza:** 0.8.

## Aprobó

C.Araujo, por la mesa web.

## Alcance

Los movimientos de tarjeta Visa 1877 RD$ del Banco Santa Cruz cuyo concepto
del banco sea `AHORRO POR COMPRA` se registran como cargo bancario
(`BankCharges`) con débito a 203.10 Tarjeta Corporativa 877 y crédito a
701.01 Ingresos Menores. El `banco_tx_id` del movimiento se guarda en
`Reference` del cargo en ADM como llave de unicidad.
