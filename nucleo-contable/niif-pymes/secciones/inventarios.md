# Inventarios — costo, fórmulas y rebaja

- **Rango:** norma
- **Fuente:** NIIF para las PYMES, Sección 13 — Inventarios; rebaja por
  deterioro en Sección 27 (edición 2015, IASB)
- **Vigente desde:** 2017-01-01
- **Revisado:** 2026-08-15

Aplica a los artículos: mercancía para la venta, en proceso, y materiales.

## La regla madre (13.4)

Inventario se mide al **menor** entre:

- el **costo**, y
- el **precio de venta estimado menos** los costos de terminación y venta.

## Qué entra al costo (13.5–13.6)

Precio de compra + aranceles + otros impuestos **no recuperables** + transporte
+ manipulación, **menos** descuentos comerciales y rebajas.

- Los descuentos **bajan el costo del artículo**, no son un ingreso aparte.
- El ITBIS aprovechable como crédito fiscal es impuesto *recuperable*: **no**
  entra al costo. El que no se puede aprovechar, sí.
- Compra con pago aplazado que esconde financiación: costo = precio de contado;
  la diferencia es gasto por intereses (13.7).

## Qué NO entra al costo (13.13)

Desperdicio anormal, almacenamiento posterior (salvo el necesario entre etapas
de producción), gastos administrativos generales, costos de venta — y los
intereses de financiar el inventario (Sección 25: a gasto).

## Fórmulas de costo (13.17–13.18)

- Artículos **no intercambiables** o de proyectos específicos: identificación
  específica.
- Todo lo demás: **PEPS** (primero en entrar, primero en salir) **o costo
  promedio ponderado**. La misma fórmula para inventarios de naturaleza
  similar.
- **UEPS (LIFO) está prohibido** por la norma, explícitamente.

> **⚠️ Verificar qué fórmula tiene configurada ADM Cloud** para los artículos.
> Tiene que ser una de las dos permitidas; cuál es, define cómo se lee el
> costo de venta que ADM calcula.

## Rebaja por deterioro (13.19 → 27.2–27.4)

Al cierre, si el importe en libros de un artículo no se va a recuperar —
dañado, obsoleto, o el precio de venta cayó — se **rebaja** al precio de venta
menos costos de terminación y venta, y la pérdida va a resultados en ese
período. Si en un período posterior las circunstancias mejoran, la rebaja se
**revierte** hasta el nuevo valor (nunca por encima del costo original).

## Al vender (13.20)

El importe en libros del artículo vendido se reconoce como **costo de venta
del mismo período** en que se reconoce el ingreso. Ingreso sin su costo en el
mismo período es un margen inflado.

## Cruce fiscal

> **⚠️ El eje fiscal del inventario no está cargado en `../../dgii/normas/`:**
> qué método de valuación acepta la DGII y si una rebaja por deterioro es
> deducible sin autorización. Una rebaja contable **no implica** deducción
> fiscal — verificar antes de proponer un ajuste con efecto en el ISR.

## Lo que hay que verificar todavía

- Números de párrafo contra el PDF oficial.
- La fórmula de costo configurada en ADM Cloud.
- El régimen fiscal de valuación y de rebajas, para `dgii/normas/`.
