# Jade Teriyaki SRL - restaurante dieta a 611.17 (Gastos de Representación)

**Aprobó:** Victor, por la mesa web (trabajo 8a1b6bde).
**Fecha:** 2026-08-03
**Registrada en ADM:** FP00001117 (VendorBills, uuid e5b15f62-ece1-44aa-bbe3-08def10be22b)
**Proveedor:** JADE TERIYAKI SRL — RNC 130389586
**Comprobante:** e-NCF E310000397946, 31/07/2026, RD$2,090.13. Padrón DGII: ACTIVO, facturador electrónico. Timbre e-CF no verificable (curl bloqueado por Citrix NS; código de seguridad ilegible en la imagen). No bloqueante: padrón confirma emisor.

## Hecho

Factura de restaurante (Jade Teriyaki). 9 renglones de comida/bebida — todos a
**611.17 Dieta y Viáticos** por item. Base gravada 1,771.30 + ITBIS 318.83 =
2,090.13. Sin propina legal impresa: el documento cuadra sin ella y no se inventa.
ITBIS por línea = 18% del precio (verificado: 1,771.30 × 0.18 = 318.83).

## Criterio aplicado

- **Cuenta 611.17 Dieta y Viáticos** por precedente del agg
  (`agg:proveedor-cuentas.json#130389586`): 3 de 3 facturas históricas del
  proveedor usan esta cuenta.
- **Tipo de gasto 05 Gastos de Representación** por naturaleza del documento
  (restaurante): 61 facturas de 40 suplidores en el histórico con ese tipo.
- Método: `razonado` (muestra insuficiente del agg para citar precedente firme:
  3 facturas).

## Alcance

Aplica a **toda factura de restaurante de Jade Teriyaki SRL** (y por extensión,
a facturas de restaurantes con la misma anatomía: consumo de comida/bebida sin
propina legal impresa). El consumo va íntegro a 611.17 Dieta y Viáticos; el
tipo de gasto del 606 es 05 Gastos de Representación. Si una factura futura
trajera propina legal del 10% impresa, esa propina va como renglón separado a
su cuenta propia (690.06 Propina Legal) con ITBIS 0.

## Nota fiscal

e-NCF E31 no verificado por timbre (DGII bloquea curl directo y el código de
seguridad no se lee en la imagen). El padrón confirma al emisor ACTIVO y
facturador electrónico. Si el humano lo solicita, se puede verificar el timbre
manualmente desde la web de DGII con el código de seguridad del QR impreso.
