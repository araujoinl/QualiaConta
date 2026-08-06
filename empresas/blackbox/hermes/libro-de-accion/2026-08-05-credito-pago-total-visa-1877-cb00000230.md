# CB00000230 — Crédito por pago total, Visa 1877 RD$

- **Fecha:** 2026-07-02 (transacción del banco; registrada en ADM 2026-08-05)
- **Documento ADM:** BankCharges `CB00000230` (uuid `c84a08f7-d5ab-4b0b-40f3-08def10be22c`)
- **Reference:** `a37e639d-cfdf-4be1-a6df-c3a4274c4266` (banco_tx_id, persistido en ADM)
- **Monto:** RD$1,314.65 (DOP)
- **Aprobó:** C. Araujo, por la mesa web

## Hecho

Crédito por pago total abonado a la tarjeta Visa 1877 RD$ (cuenta 407537XXXXXX1877-DOP) del Banco Santa Cruz, movimiento del 2026-07-02.

## Asiento

| Cuenta | Nombre | Débito | Crédito |
|--------|--------|-------:|--------:|
| 203.10 | Tarjeta Corporativa 877 | 1,314.65 | — |
| 701.01 | Ingresos Menores | — | 1,314.65 |

Cuadra: débitos 1,314.65 = créditos 1,314.65.

## Método

`script` — cargo bancario generado por la conciliación de openbanking. La cuenta de cargo (203.10) sale del mapa histórico de cargos de ADM para el banco Santa Cruz; la contrapartida 701.01 (Ingresos Menores) es el destino del crédito "PAGO TOTAL" de la tarjeta. Confianza 0.8.

## Alcance

Los créditos por pago total de la Visa 1877 RD$ del Santa Cruz que suban desde openbanking se proponen con el mismo asiento: débito a 203.10 Tarjeta Corporativa 877, crédito a 701.01 Ingresos Menores, monto según el movimiento, y `banco_tx_id` como `Reference` para distinguir movimientos gemelos.
