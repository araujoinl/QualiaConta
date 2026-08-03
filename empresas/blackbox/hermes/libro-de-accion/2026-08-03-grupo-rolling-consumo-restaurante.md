# Consumo en restaurante GRUPO ROLLING — regla de los dos cargos (ITBIS + propina legal)

**Aprobó:** C. Araujo, por la mesa web
**Fecha:** 2026-08-03
**Documento:** Factura B0100162970 de GRUPO ROLLING SRL (RNC 131508006), 2026-07-27
**Registrada en ADM como:** FP00001081 (UUID 8464185c-5261-48e6-8e87-08def10be22b)

## Hecho
Consumo en restaurante (picaría, soda y otros), pagado con tarjeta. Total
RD$1,145.00 = base gravada 894.53 + ITBIS 18% (161.02) + propina legal 10%
(89.45, Ley 16-92). Aritmética verificada: ITBIS/0.18 = 894.56 y
propina/0.10 = 894.50, ambos corroboran la base gravada.

## Criterio
- **Cuenta del consumo:** 611.17 Dieta y Viáticos (item gravado, ITBIS 18%).
- **Cuenta de la propina legal:** 690.06 Propina Legal (item exento, sin ITBIS).
- **Tipo de gasto 606:** 05 Gastos de Representación (consumo en restaurante).
- La factura se estructura con DOS cargos adicionales al precio base: ITBIS 18%
  y propina legal 10%, ambos impresos — esa es la anatomía normal de un documento
  de restaurante dominicano, no un descuadre.
- Cada cargo va como item propio porque cada uno se clasifica contablemente
  distinto. Nunca se suma la propina al consumo ni se omite.

## Alcance
Aplica a **toda factura de restaurante** de BlackBox donde la diferencia entre
total y (base + ITBIS 18%) calce con el 10% de la base gravada (±1 peso): la
propina legal se imputa a 690.06 Propina Legal y el consumo a 611.17 Dieta y
Viáticos, con tipo de gasto 05 Representación. No requiere relectura del
documento ni pregunta al humano cuando el patrón calza exacto.

## Método
`razonado`. El proveedor figura con 611.17 y 690.06 en 3 facturas históricas
(50/50), patrón normal de restaurante.
