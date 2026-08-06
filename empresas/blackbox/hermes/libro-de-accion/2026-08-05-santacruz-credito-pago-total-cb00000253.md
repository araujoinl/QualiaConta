# Cargo bancario CB00000253 — Crédito por pago total Visa 1877

**Fecha:** 2026-06-25 (crédito del banco), registrado en ADM el 2026-08-05
**Documento ADM:** BankCharges CB00000253 (uuid 34b42381-68e6-4e19-5e6e-08def10be22c)
**Referencia ADM:** bff0e64c-6350-40a8-9f12-ca26433a9b45 (banco_tx_id)
**Monto:** RD$1,574.22 (DOP)
**Aprobó:** Victor, por la mesa web

## Hecho

Banco Santa Cruz abonó a BlackBox un crédito por pago total sobre la tarjeta
corporativa Visa 1877 RD$ (cuenta 407537XXXXXX1877-DOP) el 2026-06-25, por
RD$1,574.22. Es un ingreso menor de la tarjeta que se reconoce contablemente.

## Asiento

- Débito 203.10 Tarjeta Corporativa 877 — RD$1,574.22
- Crédito 701.01 Ingresos Menores — RD$1,574.22

## Método

`script` — conciliación automática de cargos bancarios contra el extracto de
Santa Cruz (Supabase). La dirección es crédito (entrada a la cuenta) y la
cuenta contable sale del mapa de cargos del histórico de ADM.

## Alcance

Los créditos por pago total que Banco Santa Cruz abona sobre las tarjetas
corporativas se registran como `BankCharges` con dirección crédito: débito a
la cuenta de la tarjeta (203.10) y crédito a 701.01 Ingresos Menores. La
referencia de ADM es el `banco_tx_id` del movimiento, que ya se confirmó como
llave persistente (`referencia_en_adm: true`).
