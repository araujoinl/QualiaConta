---
name: consultar-nucleo-niif
description: "Busca la norma contable (NIIF para las PYMES) en el núcleo: qué se activa, qué es ingreso o pasivo, cómo se mide y deprecia. Siempre con su sección y su vigencia, y siempre debajo de la doctrina."
version: 1.0.0
author: QualiaConta
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [Contabilidad, NIIF, PYMES, República Dominicana]
---

# Consultar el núcleo NIIF-PYMES

La norma contable destilada vive en `/nucleo-contable/niif-pymes`, de sólo
lectura. Es el **eje contable**; el eje fiscal vive en `/nucleo-contable/dgii`
y tiene su propia skill.

## Cómo buscar

Empieza **siempre** por el índice, que dice qué hay cargado, con qué edición y
qué está marcado para verificar:

```bash
cat /nucleo-contable/niif-pymes/INDEX.md
```

Después el tema que corresponda:

| Pregunta | Archivo |
|---|---|
| ¿Esto se activa o se gasta? ¿Qué entra al costo? | `secciones/activos-fijos.md` |
| ¿Desde qué monto se capitaliza? ¿Qué es material? | `secciones/conceptos-y-materialidad.md` |
| ¿Cómo se valúa el inventario? ¿Qué fórmula de costo? | `secciones/inventarios.md` |
| ¿Ya es ingreso, o todavía es deuda? ¿Y este anticipo? | `secciones/ingresos-y-anticipos.md` |
| ¿Cómo se parte la cuota del préstamo? ¿Esta CxC se castiga? | `secciones/prestamos-y-cuentas-por-cobrar.md` |
| ¿Esto se provisiona? ¿Garantía de qué tipo es? | `secciones/provisiones-y-garantias.md` |

Para buscar por palabra en todo el núcleo:

```bash
grep -ri "capitaliza\|anticipo\|deterioro\|provisión" /nucleo-contable/niif-pymes/secciones/
```

## Las tres reglas al usar lo que encuentres

**1. La norma va DEBAJO de la doctrina, siempre.** El orden es el de P-003:
lo asentado en ADM, la doctrina y los criterios de la empresa, el precedente
ratificado — y sólo cuando todos callan, esta norma. NIIF **jamás** convierte
un ABIERTO en permiso: donde la doctrina ordena preguntar, se pregunta. La
norma sirve para que la pregunta llegue con sostén («propongo activarlo,
Sección 17: impuesto no recuperable de la adquisición — ¿ratificás?»), no para
decidir solo.

**2. Cita la sección y respeta la edición.** Toda decisión sostenida en este
núcleo nombra su sección («Sección 13») y la edición cargada (**2015**, vigente
desde 2017). La tercera edición rige desde **2027** y reescribe la de ingresos:
un documento de período 2027+ no se juzga con este núcleo hasta destilarla. Los
números de párrafo están marcados para contrastar contra el PDF oficial antes
de citarlos ante un auditor.

**3. En choque con efecto fiscal, manda lo fiscal.** La práctica de la casa es
fiscal-first: donde la medición NIIF y la regla fiscal difieren (depreciación
es el caso típico), los libros siguen la práctica fiscal dictada por el dueño
y la diferencia se **reporta**, no se improvisa un doble registro. Los cruces
fiscales señalados con ⚠️ en cada archivo **no están cargados en `dgii/`
todavía**: sin esa carga no se automatiza ninguna propuesta con efecto fiscal.

## Si no está en el núcleo

**Dilo.** No completes con lo que creas recordar del estándar. El núcleo cubre
seis temas —conceptos, activos fijos, inventarios, ingresos, préstamos,
provisiones— y nada más.

Cuando falte algo que se usa seguido, avísalo: eso es material para agregar al
núcleo, no para improvisar cada vez.

## Lo que el núcleo NO cubre a propósito

La presentación de estados financieros completos (S.3–8), el impuesto diferido
(S.29), arrendamientos (S.20) y beneficios a empleados (S.28). Los estados los
preparan los contables externos; el resto entra el día que un caso de la mesa
lo pida.
