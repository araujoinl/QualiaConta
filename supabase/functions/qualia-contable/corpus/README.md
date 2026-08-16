# Corpus dorado — red de validación del turno nuevo (F3)

> Curado el 2026-08-16 desde `qualia_trabajos` + `qualia_eventos` + `qualia_libro`
> de la base de producción (Labs_Inv). **Nada acá es inventado**: cada archivo es
> un trabajo real, con su cronología real compactada y su desenlace real. Los
> montos y proveedores se conservan tal cual — el corpus es interno del repo.

## Para qué existe

El plan de salida de Hermes (§5-F3 de `docs/plan-salida-hermes.md`) establece
que **el replay histórico NO sirve como red** para validar `qualia-contable`:
el propio header de `replay-skill.py` declara que no puede medir un cambio de
envoltorio (system + tools + assembly a la vez). La red de F3 es este corpus
más un período de doble corrida.

## Cómo se usa

Por cada caso, el turno nuevo corre **en sombra**:

1. Se reconstruye el punto de entrada del caso: el trabajo con su estado, el
   dossier/propuesta previa y los eventos ANTERIORES al primer turno del
   contable (el array `eventos` trae la cronología completa; se corta en el
   punto que se quiera probar).
2. Se invoca `qualia-contable` con ese contexto y se captura su decisión
   (propuesta, pregunta, tool calls) SIN escribir al bus ni a ADM.
3. Se compara contra el desenlace real:
   - `estado_final` y `desenlace_adm` — qué pasó de verdad (documento, cuenta,
     tipo 606, o rechazo/anulación).
   - `propuesta_final` — el jsonb real que quedó en la fila.
   - `leccion` — la lista de conductas que el turno DEBE exhibir en este caso;
     es el checklist de evaluación, escrito desde los eventos reales.
4. Un caso pasa cuando la decisión del turno coincide en lo contable (cuenta,
   documento ADM, tipo 606, tratamiento del ITBIS) y en la conducta (pregunta
   cuando el histórico probó que había que preguntar; no re-registra tras una
   anulación muda; no inventa datos faltantes).

Los casos con `estado_final: esperando_respuesta` (Caso #5, Claro) no tienen
cierre: sirven para probar el estado intermedio — qué pregunta formula el turno
y si coincide con la que el contable real dejó abierta.

## Las cuatro ramas

| Rama | Carpeta | Casos | Qué prueba |
|---|---|---|---|
| Casos (hilos multi-paso) | `casos/` | 5 (los 5 únicos de producción) | abrir_trabajo por paso, descubrimiento de movimientos, conflicto criterio-vs-candado, anulaciones sin motivo, idempotencia entre corridas |
| Correcciones/respuestas del humano | `correcciones/` | 5 | incorporar el dato corregido y re-verificar, no repetirse, rechazo con motivo (legisla) vs rechazo mudo (no se aprende nada) |
| Facturas difíciles | `facturas-dificiles/` | 5 | USD multi-renglón, ITBIS que no es 18% (ISC embebido), proveedor nuevo sin precedente, total-del-mes vs total-por-pagar, renglón vs nota de layout |
| Criterios | `criterios/` | 5 | los trabajos donde nació un criterio ratificado que hoy vive en el libro: naturaleza del bien, corretaje≠arrendamiento, cashback, VendorCreditNotes, C-007 + cuenta agrupadora |

## Formato de cada archivo

```json
{
  "trabajo_id": "uuid real en qualia_trabajos",
  "rama": "casos | correcciones | facturas-dificiles | criterios",
  "resumen_humano": "qué pasó y por qué es un buen caso de prueba",
  "estado_final": "estado real de la fila al corte del corpus",
  "eventos": [{"fecha", "autor", "tipo", "texto"}],
  "propuesta_final": "el jsonb real de qualia_trabajos.propuesta",
  "desenlace_adm": "qué quedó (o no) en ADM, con DocIDs",
  "leccion": "qué debe hacer BIEN el turno nuevo en este caso"
}
```

Notas de fidelidad:

- `eventos` es la cronología real **compactada**: se recortaron textos largos a
  lo esencial y se omitieron repeticiones del preparador («leyendo la foto…»).
  El texto completo vive en `qualia_eventos` bajo el `trabajo_id`.
- En `pier17-flete-importacion-usd.json` los 15 renglones van resumidos en
  `lineas_resumen` (el detalle completo está en la propuesta de la fila).
- **El `estado_final` de la tabla puede mentir por sí solo**: hay filas
  `registrada` cuyo documento fue luego eliminado o anulado en ADM (cashback
  ED00000183, NC Claro NCP00000006). El corpus lo documenta en `desenlace_adm`;
  el turno nuevo también debe leer los eventos, no solo el estado.

## Advertencias de curaduría

- La rama **criterios** no sale de un tipo `criterio` del bus — ese
  tipo/estado no existe en producción todavía. Se curaron los trabajos cuyo
  desenlace estableció un criterio hoy asentado en `qualia_libro` (las
  entradas «Criterio: …», `precedente_ref: C-007`, etc.). Los bloques de
  preentrenamiento literales (C-00x) viven en git, en la memoria de empresa,
  no en las tablas.
- Hay solapes naturales y se asignó por el rasgo dominante: FREEWAY es también
  una corrección humana (está en criterios porque el criterio es lo citable);
  Suena-inversor también parió un criterio (está en correcciones porque el
  patrón de la doble corrección es lo valioso).
- `tipo='caso'` tiene exactamente 5 filas en producción; se usaron todas,
  incluida la que sigue en vuelo.
