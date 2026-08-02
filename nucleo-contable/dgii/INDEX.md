# Índice del núcleo DGII

Qué hay cargado, con su vigencia y su estado de verificación. Este archivo es lo
primero que consulta el contable para saber si tiene base para responder o si
tiene que decir que no sabe.

## Normas

| Tema | Archivo | Cubre | Revisado |
|---|---|---|---|
| Retenciones de ISR | [normas/retenciones-isr.md](normas/retenciones-isr.md) | Quién retiene, tabla general, servicios profesionales (10%) y técnicos (2%), asalariados | 2026-07-30 |
| Retenciones de ITBIS | [normas/retenciones-itbis.md](normas/retenciones-itbis.md) | 100% a Persona Física, 30% entre sociedades, comprobante de compras, RST, pago a cuenta | 2026-07-30 |
| ITBIS — tasas | [normas/itbis-tasas.md](normas/itbis-tasas.md) | 18% general, 16% reducida, dónde viven las exenciones | 2026-07-30 |
| Comprobantes fiscales | [normas/comprobantes-fiscales.md](normas/comprobantes-fiscales.md) | Tipos 31 a 47, formato e-CF, calendario de migración | 2026-07-30 |
| Remisión 606 / 607 / 608 | [normas/remision-606-607.md](normas/remision-606-607.md) | Qué reporta cada uno, plazo, qué exige del registro | 2026-07-30 |

## Interpretaciones

Todavía ninguna. Cuando entren boletínes de EY, Deloitte o PwC van en
`interpretaciones/<fuente>/` y se marcan como tales: ayudan a entender, no
mandan.

## Marcado para verificar

Lo que está cargado pero **no se puede usar sin confirmar primero**. Está
señalado dentro de cada archivo con ⚠️; acá está la lista para no perderlo de
vista.

| Qué | Por qué | Dónde |
|---|---|---|
| Escala de ISR de asalariados | Los tramos son de **2020** y se ajustan por inflación cada año. Usarlos en 2026 da un número equivocado | retenciones-isr.md |
| Clasificación de e-CF de cada empresa | El plazo de migración depende del tamaño del contribuyente. El de pequeñas, micro y no clasificadas vence el **15-nov-2026** | comprobantes-fiscales.md |
| Lista de exenciones de ITBIS | Es larga, tiene matices por grado de procesamiento y se modifica por ley. Acá está el criterio, no el catálogo | itbis-tasas.md |
| Estructura de columnas del 606 y 607 | Falta contrastar contra el instructivo oficial vigente | remision-606-607.md |

## Cómo se mantiene

Hoy se carga a mano. El vigilante semanal que raspa la DGII y actualiza esto
solo se construye en la **entrega 4**.

Toda regla lleva **rango** (norma, interpretación) y **vigencia**. Sin las dos,
no entra — una factura de 2025 se juzga con las reglas de 2025.

## Nota sobre la fuente principal

Buena parte de las retenciones sale del compendio de la DGII *Retenciones de ISR
y de ITBIS* (julio 2025). Ese documento **se declara a sí mismo "publicación
informativa sin validez legal"**, así que la autoridad de cada regla es la norma
que él cita —Ley 11-92, Ley 253-12, Normas 02-05, 07-07, 07-09, 01-11, 05-19,
06-23, y las demás anotadas en cada tabla— y no el folleto.

Cuando el contable sostenga una decisión, cita la norma, no el compendio.
