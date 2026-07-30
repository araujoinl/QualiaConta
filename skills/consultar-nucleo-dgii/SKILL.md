---
name: consultar-nucleo-dgii
description: "Busca una regla fiscal dominicana en el núcleo DGII: retenciones, ITBIS, comprobantes fiscales y remisión 606/607. Siempre con su norma y su vigencia."
version: 1.0.0
author: QualiaConta
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [Contabilidad, DGII, Fiscal, República Dominicana]
---

# Consultar el núcleo DGII

Las reglas fiscales dominicanas viven en `/nucleo-dgii`, de sólo lectura.

## Cómo buscar

Empieza **siempre** por el índice, que dice qué hay cargado y qué está marcado
para verificar:

```bash
cat /nucleo-dgii/INDEX.md
```

Después el tema que corresponda:

| Pregunta | Archivo |
|---|---|
| ¿Cuánto retengo de ISR a este proveedor? | `normas/retenciones-isr.md` |
| ¿Cuánto retengo de ITBIS? | `normas/retenciones-itbis.md` |
| ¿Qué tasa de ITBIS lleva esto? | `normas/itbis-tasas.md` |
| ¿Qué tipo de comprobante corresponde? | `normas/comprobantes-fiscales.md` |
| ¿Cómo tiene que quedar para el 606/607? | `normas/remision-606-607.md` |

Para buscar por palabra en todo el núcleo:

```bash
grep -ri "retención\|ITBIS\|NCF" /nucleo-dgii/normas/
```

## Las tres reglas al usar lo que encuentres

**1. Cita la norma, no el folleto.** Buena parte del núcleo viene del compendio
de la DGII *Retenciones de ISR y de ITBIS*, que se declara a sí mismo
"informativa sin validez legal". La autoridad es la norma que él cita — Ley
11-92, Ley 253-12, Norma 02-05, Norma 07-09, Norma 05-19 — y esa es la que
nombras cuando sostienes una decisión.

**2. Respeta la vigencia.** Toda regla dice desde cuándo aplica. Una factura de
2025 se juzga con las reglas de 2025. Antes de aplicar una regla, mira la fecha
del documento, no la de hoy.

**3. Lo marcado con ⚠️ no se usa sin confirmar.** Hoy hay cuatro cosas así, y la
más peligrosa es la escala de ISR de asalariados: es de **2020** y se ajusta por
inflación cada año, así que usarla en 2026 da un número equivocado que parece
correcto. Si la necesitas, avisa que hay que buscar la escala del año en curso.

## Si no está en el núcleo

**Dilo.** No completes con lo que creas recordar de la ley dominicana. El núcleo
cubre lo básico —retenciones, ITBIS, comprobantes, remisión— y nada más.

Cuando falte algo que se usa seguido, avísalo: eso es material para agregar al
núcleo, no para improvisar cada vez.

## Lo que el núcleo NO cubre a propósito

Los reportes a la DGII —606, 607, IT-1, declaraciones— los prepara y presenta la
empresa contable externa. El núcleo tiene el 606/607 sólo para que sepas **cómo
hay que registrar** para que después cuadren, no para que los armes tú.
