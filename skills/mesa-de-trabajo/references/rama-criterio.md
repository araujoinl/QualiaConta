# Rama «trabajo tipo `criterio`» — la lee todo trabajo con `tipo='criterio'`, sea cual sea el motivo del webhook.

## Si el trabajo es tipo `criterio`

Bloques de reglas destiladas del preentrenamiento (los crea
`memoria/scripts/bloques-criterios.py` con `origen='preentrenamiento'`). Nacen
ya en `propuesta`: no hay archivo que bajar ni análisis que hacer — la
`propuesta` trae `{bloque, archivo, n_reglas, reglas: [{titulo, enunciado,
evidencia, alcance}], detalle}`. Solo te despiertan cuando el usuario actúa
(`accion_usuario`), y el estado real de la fila manda, como siempre.

- **`aprobada`**: escribí UNA entrada de libro de acción POR CADA regla del
  bloque — archivo NUEVO `libro-de-accion/AAAA-MM-DD-<slug-de-la-regla>.md`
  (append-only, jamás editar uno existente), con **Aprobó:** el
  `aprobado_por_nombre` de la fila, «por la mesa web»; **Alcance:** el de la
  regla (si la regla no trae uno propio, el del bloque; si el comentario de
  aprobación lo editó, ese manda); y la **evidencia citada** de la regla
  (n docs + DocIDs). Espejá cada entrada en `qualia_libro` como siempre.
  **Si —y SÓLO si— la fila trae `propuesta->>'archivo'`**, actualizá el
  front-matter de ESE archivo de memoria (ej. `memoria/proveedores.md`):
  `estado: ratificado` y `aprobo: <nombre>`. Cerrá con un evento `nota` con el
  conteo: «Bloque <bloque> ratificado: N entradas de libro escritas, memoria a
  ratificado.»

  **Sin `archivo` no ratificás ningún archivo, y es el caso normal.** Un criterio
  nacido de una corrección del dueño (`origen='correccion_usuario'`) trae UNA
  regla y ningún archivo detrás: lo único que se escribe es su entrada de libro,
  y con eso ya es precedente citable. Marcar un archivo entero desde ahí
  ratificaría de un saque 73 fichas que nadie revisó — el 2026-08-06 se midió que
  6 de ellas tienen la cuenta principal invertida. **Si la fila no trae
  `archivo`, no toques `memoria/` en absoluto.**
- **`rechazada`**: evento `nota` reconociéndolo. El comentario del usuario dice
  qué reglas caen o se corrigen; NO edites el trabajo rechazado ni escribas
  libro — el bloque corregido vuelve como trabajo NUEVO desde el pipeline de
  preentrenamiento. Y un criterio rechazado JAMÁS engendra otro criterio: se
  muerde la cola.

