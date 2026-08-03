# MECARI SRL (Estación Axxon El Millón) — combustible exento de ITBIS

**Fecha:** 2026-08-03
**Aprobó:** Victor, por la mesa web
**Trabajo mesa:** d4cdec4a-9fd3-47f8-9c3d-5aaf30a22078
**Documento ADM:** VendorBills FP00001101

## Hecho

Factura de combustible de la Estación Axxon El Millón (RNC 101767766, razón
social DGII **MECARI SRL**), NCF **B0100595457**, vigente hasta 31/12/2026.
Gasolina premium, 2.22 gal × RD$337.84 = **RD$750.00**, ITBIS 0 (combustible
exento en RD).

## Criterio

- **Proveedor nuevo** — sin precedente histórico en el agg (no aparece en las
  1,050 facturas destiladas). Clasificado por naturaleza del renglón.
- **Cuenta 620.11 Combustible** — 42 proveedores de combustible la usan en el
  histórico; es la cuenta dominante del rubro.
- **Tipo de gasto 02** (Gastos por Trabajos, Suministros y Servicios).
- **ITBIS 0 / Exento**: la gasolina está exenta de ITBIS en RD; no hay crédito
  fiscal que tomar. Línea con `grupo_impuesto: "Exento"`, `itbis: 0`.

## Alcance

Aplica a **toda factura de MECARI SRL / Estación Axxon** y, por extensión, a
**toda estación de combustible cuyo ITBIS impreso sea 0** (gasolina regular y
premium en RD son exentas): cuenta **620.11 Combustible**, tipo de gasto **02**,
línea exenta sin crédito fiscal. El diesel y otros productos gravados se tratan
según lo que imprima el documento.

## Nota de registro

El NCF impreso en la foto es `B0100595457` (11 caracteres). La propuesta
original de la mesa lo transcribió con un dígito de más (`B01000595457`, 12
caracteres), lo que ADM rechazó por longitud. Corregido a `B0100595457` —
verificado vigente contra DGII — y registrado sin novedad.
