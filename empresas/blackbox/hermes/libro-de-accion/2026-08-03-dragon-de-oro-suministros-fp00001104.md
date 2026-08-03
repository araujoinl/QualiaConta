# Supermercado El Dragón de Oro — suministros de oficina (FP00001104)

**Fecha:** 2026-08-03
**Aprobó:** Victor, por la mesa web
**Documento ADM:** FP00001104 (VendorBills)
**e-NCF:** E310000031966 — DGII Aceptado

## Hecho

Factura del Supermercado El Dragón de Oro (RNC 101035129) por RD$1,464.01,
ITBIS 216.09, fecha 2026-07-17. Ocho renglones de suministros de oficina y
consumo (desinfectante, servilletas, café, golosinas, papel).

## Criterio

- **Cuenta:** 620.06 (Suministros de oficina y otros) en los 8 renglones, por
  precedente: 14 de 14 facturas históricas de este proveedor.
- **Tipo de gasto 606:** 02 (Gastos por Trabajos, Suministros y Servicios).
- **Tasa mixta de ITBIS:** el café molido (Cafe molido 1lbs 453g) va a tasa
  reducida de **16%** (Ley 253-12, Anexo I — productos alimenticios de la
  canasta); el resto de los renglones a **18%**. El TaxScheduleID de 16% es
  `26b690b9-cc2a-4ced-d30b-08dd66faeff4`. La base gravada total es 1,247.92,
  desglosada así:
  - 18%: base 821.20, ITBIS 147.81
  - 16%: base 426.72, ITBIS 68.28
  - Total ITBIS: 216.09 ✓

## Script

El `registrar-en-adm.py` se parchó para soportar multi-tasa: resuelve el
TaxScheduleID por línea desde `itbis/(cantidad×precio)`, con catálogo
{16%, 18%, 30%}. Sin esto, ADM recalcaba todo a 18% y la factura quedaba en
1,472.55 (8.54 de más), reclamando crédito fiscal que el proveedor no facturó.

## Alcance

Toda factura de supermercado o proveedor de alimentos con tasa mixta de ITBIS
(productos de la canasta a 16% + productos generales a 18%) se registra línea
por línea con su tasa efectiva. El schedule de 16%
(`26b690b9-cc2a-4ced-d30b-08dd66faeff4`) aplica a los productos del Anexo I
de la Ley 253-12. El de 30% (`264c13b2-286d-4b60-03b8-08dd34a31da8`) a
telecomunicaciones.
