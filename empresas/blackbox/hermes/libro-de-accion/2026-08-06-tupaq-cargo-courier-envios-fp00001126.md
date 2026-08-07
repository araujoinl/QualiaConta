# 2026-08-06 — Tupaq Cargo & Courier SRL — FP00001126

**Fecha:** 2026-08-06
**Documento ADM:** FP00001126 (VendorBills)
**Proveedor:** TUPAQ CARGO & COURIER SRL · RNC 132942248
**NCF:** E310000002031 (e-CF E31, no verificable: sin código de seguridad ni fecha de firma legibles)
**Fecha factura:** 2026-07-31
**Monto:** RD$851.13 (DOP) · ITBIS RD$65.11
**Aprobó:** Victor, por la mesa web

## Hecho

Factura de envíos aéreos de Tupaq Cargo & Courier del 2026-07-31 por RD$851.13.
Cinco envíos (TUMIA000873115, 873955, 873993, 874008, 874085), cada uno con cinco
renglones: flete aéreo priority, airport fee, combustible, servicios DGA y tasa
DGA-AERODOM. Aritmética cuadra exacta: base 786.02 + ITBIS 65.11 = 851.13.

## Criterio

- **Tipo de documento:** VendorBills (factura de proveedor).
- **Clasificación:** los 25 renglones a 620.10 (Envíos y Correspondencias),
  cuenta dominante por precedente (125 de 129 usos sobre 126 facturas
  históricas de Tupaq). Los renglones exentos (airport fee, combustible,
  servicios DGA) van sin ITBIS; los gravados (flete, tasa DGA-AERODOM) con ITBIS.
- **Tipo de gasto 606:** 02 (Gastos por Trabajos, Suministros y Servicios).
- **Método:** precedente (`agg:proveedor-cuentas.json#132942248`).
- **DGII:** e-CF E31 no verificable — el documento escaneado no trae código de
  seguridad ni fecha de firma legibles. Padrón confirma a TUPAQ CARGO & COURIER
  SRL como contribuyente ACTIVO y facturador electrónico. Se registró con el
  ITBIS como crédito fiscal, según lo aprobado por el humano.

## Alcance

Aplica a facturas de TUPAQ CARGO & COURIER SRL (RNC 132942248): cuenta 620.10
(Envíos y Correspondencias) por precedente, tipo de gasto 02. Los renglones
exentos (airport fee, combustible, servicios DGA) van con grupo_impuesto
"Exento"; los gravados (flete, tasa DGA-AERODOM) con ITBIS al 18%. Si el e-CF
no trae timbre legible, el comprobante queda no verificable pero el padrón
suple la razón social para el proveedor en ADM.
