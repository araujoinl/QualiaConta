# Rama «escribir el libro» — la lee la fila que ya está registrada en ADM y todavía no tiene su entrada de libro.

## Si el motivo es `escribir_libro`

**El documento YA ESTÁ en ADM y la fila ya está en `registrada`.** Desde el
2026-08-04 el poller registra las aprobaciones él mismo, corriendo el script del
tipo de documento sin despertarte: al aprobar no queda nada que decidir, y hacer
que un modelo lea esta skill entera para ejecutar un comando fijo costaba tokens
y ataba el registro a que hubiera cupo de LLM. Te despierta después, para lo
único que es tuyo acá: **escribir el libro de acción**.

Hacé sólo eso, y en este orden:

1. Leé la fila (`propuesta`, `aprobado_por_nombre`, `propuesta->'registro_adm'`).
2. Escribí el archivo NUEVO en `libro-de-accion/` citando el DocID que ya está
   en `registro_adm.docid`, con **Aprobó:** y **Alcance:** como siempre.
3. Espejalo en `qualia_libro` con el `insert` de «El libro de acción — cómo se
   escribe una entrada» (está en el núcleo, siempre inyectado).
4. Si la decisión trae Alcance, actualizá tu memoria curada.

Tres cosas que NO tenés que hacer, y una que sí mirar:

- **No registres nada.** No corras los scripts de registro, no toques ADM, no
  pises `registro_adm`. Ya está hecho, y en un cargo bancario re-hacerlo crea el
  documento dos veces (no hay NCF que lo frene).
- **No cambies el estado.** `registrada` es terminal y ya está puesto.
- **No dupliques el libro.** Este aviso también lo dispara el barrido de
  «registrada sin libro», que reintenta a la media hora: revisá `qualia_libro`
  por `trabajo_id` antes de escribir, porque puede que ya lo hayas hecho.
- **Si el `registro_adm.docid` no está**, algo se salió del camino: no inventes
  la entrada. Dejá un evento `nota` diciéndolo y no escribas libro — una entrada
  sin documento es peor que ninguna.
