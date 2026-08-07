# Pago a TotalEnergies — cancelación de FP00001136 (PP00000803)

**Aprobó:** C.Araujo, por la mesa web (trabajo 2440d4a5).
**Fecha:** 2026-07-30
**Proveedor:** TOTALENERGIES MARKETING DOMINICANA SA — RNC 101068744
**Documento ADM:** PP00000803 (BillPayments, UUID b8516936-e2c3-4612-3b08-08def46d0428)
**Factura cancelada:** FP00001136 (combustible gasoil Excellium, RD$750.00)
**Movimiento banco:** Santa Cruz — Visa 2414 RD$ (tx 0610a24d-4a20-447d-b645-b9a55c6615f2)

## Criterio

Pago de la factura FP00001136 por RD$750.00, cargado a la tarjeta corporativa
Visa 2414 RD$ del Banco Santa Cruz. Es un BillPayments: debita Cuentas por
Pagar y acredita la tarjeta — no crea gasto, sólo cancela la obligación que la
factura ya registró. La referencia del movimiento bancario quedó en
`registro_adm.reference` para el cruce de conciliación.

## Asiento

| Cuenta | Descripción | Débito | Crédito |
|---|---|---:|---:|
| CxP TotalEnergies Marketing Dominicana | cancelación FP00001136 | 750.00 | |
| Banco — Visa 2414 RD$ (Santa Cruz) | pago con tarjeta | | 750.00 |

## Alcance

Aplica a **todo pago de factura a TotalEnergies Marketing Dominicana** (y
proveedores en general) originado en un cargo de la tarjeta corporativa o de
cualquier cuenta bancaria de BlackBox. El pago se registra como BillPayments
contra la factura con saldo abierto, nunca como gasto: el gasto lo creó la
factura.
