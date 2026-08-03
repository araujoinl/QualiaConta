# 2026-08-03 · Logistichause International R&M SRL — RD$14,000 transporte, exenta (RST)

**Registrada en ADM como:** FP00001091 (VendorBills, uuid d8d8269f-7168-4ab4-08a4-08def13e52a2)
**Documento:** Factura de crédito fiscal B0100000548, NCF VIGENTE en DGII (vigencia 31/12/2027)
**Proveedor:** LOGISTICHAUSE INTERNATIONAL R&M SRL · RNC 133124981 · estado ACTIVO · régimen RST
**Monto:** RD$14,000.00 (base 14,000, exenta — sin ITBIS facturado)
**Trabajo mesa:** 41020f7e-2de4-4f6c-8a4d-764112c60db8

## Decisión

Factura de Logistichause por **servicio de transporte** registrada en **130.02 Compras en Tránsito**, tipo de gasto **09 Compras y Gastos que Formarán parte del Costo de Venta**. El proveedor está acogido a **régimen RST**, por lo que la factura viene **exenta de ITBIS**: no hay crédito fiscal que tomar y no es gasto no admitido — el RST no cobra ITBIS por régimen, no porque el comprobante esté mal.

- Cuenta: 130.02 Compras en Tránsito
- Tipo de gasto 606: 09
- Línea: Transporte, 1 × 14,000 (Exento, ITBIS 0)
- Grupo de impuesto: Exento

## Origen

Precedente del agg `proveedor-cuentas.json#133124981`: 21 de 25 facturas históricas (84%) a 130.02. Tipo de gasto 09 en 21 de 24 (87.5%). El régimen RST del emisor sale del padrón DGII (`regimen_pagos: RST`).

**Aprobó:** Victor, por la mesa web.

## Alcance

Aplica a toda factura de Logistichause International R&M SRL (RNC 133124981) por servicios de transporte, gestión aduanal y despacho. La cuenta sigue siendo 130.02 mientras la carga esté en tránsito; al nacionalizarse, el costo transita al inventario/costo de venta correspondiente. Cuando el proveedor factura bajo RST, la factura viene exenta de ITBIS — se registra con grupo Exento, sin crédito fiscal, y no se trata como gasto no admitido.
