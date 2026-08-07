# 2026-08-06 — DGA (Dirección General de Aduanas) — FP00001133

**Fecha:** 2026-08-06
**Documento ADM:** FP00001133 (VendorBills)
**Proveedor:** DGA ADUANAS · UUID 6be5b016-11db-4aa2-0866-08dd5015f9c4 (sin FiscalID)
**NCF:** N/A — la DGA emite recibo de liquidación, no factura fiscal
**Fecha factura:** 2026-08-03
**Monto:** RD$939,118.86 (DOP) · ITBIS RD$0.00
**Aprobó:** Victor, por la mesa web

## Hecho

Liquidación de la Dirección General de Aduanas por impuestos de importación
(DUA 10030-CL11-2608-000077), pagada el 2026-08-03 por RD$939,118.86.

Seis renglones:
- Tasa por Servicio Aduanero: RD$5,182.16 → 130.02 Compras en Tránsito
- Impuestos Arancelarios: RD$197,446.46 → 130.02 Compras en Tránsito
- ITBIS de importación: RD$736,231.98 → 150.04 ITBIS Adelantado
- Declaración del Valor: RD$0.00 → 130.02 Compras en Tránsito
- DUA-D: RD$258.26 → 130.02 Compras en Tránsito
- Recargo Art.374 Ley 168-21 (declaración tardía): RD$0.00 → 130.02 Compras en Tránsito

Aritmética: 5,182.16 + 197,446.46 + 736,231.98 + 0 + 258.26 + 0 = 939,118.86. ✓

## Criterio

- **Tipo de documento:** VendorBills (factura de proveedor). La DGA es un
  proveedor: 10 de 10 liquidaciones históricas (FP00000049 … FP00001018) van
  como factura de proveedor.
- **Proveedor:** DGA ADUANAS, ya existente en ADM sin FiscalID (entidad
  gubernamental, no emite comprobante fiscal). Registrada por `relationship_id`
  directo — override del script cuando el comprobante no trae el RNC del emisor.
- **Todas las líneas van exentas:** el impuesto aduanero ya está pagado en la
  liquidación y no se recalcula como ITBIS de línea.
- **El ITBIS de importación (RD$736,231.98) va a 150.04 ITBIS Adelantado**, no
  como crédito fiscal del período: se reclama cuando la mercancía se nacionaliza
  y se transfiere de Compras en Tránsito (130.02) al inventario.
- **Tipo de gasto 606:** 09 (Compras y Gastos que Formarán parte del Costo de
  Venta).
- **Método:** precedente (`agg:proveedor-cuentas.json#DGA ADUANAS`).
- **Referencia:** 10030-CL11-2608-000077 (número del DUA).

## Pendiente

El pago de la liquidación (débito del banco) quedó pendiente de identificar.
El PDF trae "BANCO MULTIPLE PROMERICA DE LA REPUBLICA DOMINICANA" como banco
adquirente (quien recibió), no como cuenta de origen. El pago se registra como
BillPayments cuando se identifique el movimiento del banco.

## Script fix

El proveedor DGA ADUANAS existe en ADM sin FiscalID, y el script
`registrar-en-adm.py` moría exigiendo RNC. Se parcheó el script para aceptar
`relationship_id` como override cuando el comprobante no trae RNC del emisor
(caso de entidades gubernamentales).

## Alcance

Liquidaciones de la DGA (impuestos de importación): siempre VendorBills a
DGA ADUANAS (UUID 6be5b016...), exentas, con arancel+tasa a 130.02 Compras en
Tránsito e ITBIS de importación a 150.04 ITBIS Adelantado. El pago del banco
va como BillPayments aparte.
