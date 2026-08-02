---
name: mesa-de-trabajo
description: "Atiende la mesa de trabajo web: facturas que suben desde Labs_Inv, propuesta de registro, aprobaciones y libro. Lee y escribe la cola qualia_* por SQL. Se activa por el webhook mesa."
version: 1.0.0
author: QualiaConta
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [Contabilidad, Mesa, Facturas, Registro]
prerequisites:
  env: [QUALIA_DSN, QUALIA_EMPRESA_ID]
  commands: [psql, curl]
---

# La mesa de trabajo

## Protocolo — sin desvíos

En este canal NO hay humano esperando: te despertó un poller. Reglas duras:

1. **Todo se hace por TERMINAL** con `psql "$QUALIA_DSN"` y `curl`. Nada más.
2. **PROHIBIDO `clarify`** o cualquier pregunta interactiva: acá nadie contesta.
   Tus preguntas van como evento `tipo='pregunta'` en la base (ver abajo) y el
   humano las responde desde la web.
3. **PROHIBIDO `vision_analyze` sobre URLs o PDFs.** Si el documento es imagen,
   primero bajala con `curl` a un archivo local y recién ahí podés mirarla. Los
   PDF se leen con herramientas de texto/PDF locales, no con visión sobre URL.
4. No pidas permiso ni confirmación. Ejecutá los comandos y anotá en la base.
5. **Tu PRIMER comando es siempre leer la fila** (está abajo). Ningún otro tool
   antes de eso.

La mesa es la pantalla web donde tu gente arrastra facturas y aprueba lo que
proponés. Vive en tres tablas (`qualia_trabajos`, `qualia_eventos`,
`qualia_libro`) de la misma base del banco. Se opera con:

```bash
psql "$QUALIA_DSN" -c "..."
```

El contrato completo (columnas, estados, quién mueve qué) está en
`docs/mesa-de-trabajo.md` del repo QualiaConta; lo esencial está acá.
Trabajás SOLO con filas de tu empresa: `empresa_id = $QUALIA_EMPRESA_ID`,
siempre, en toda consulta.

Un webhook te despierta con `trabajo_id` y `motivo`. El payload es un puntero,
nada más: **la base es la única verdad**. Lo primero es leer la fila y decidir
según su estado real, no según el mensaje que te despertó.

```bash
psql "$QUALIA_DSN" -t -A -c "select estado, tipo, archivo_url, archivo_nombre, resumen from qualia_trabajos where id='<trabajo_id>' and empresa_id='$QUALIA_EMPRESA_ID'"
```

## Si está `pendiente`: analizalo

1. **Claim atómico** — si no devuelve fila, otro proceso lo tomó o ya no está
   pendiente: PARÁ ahí, sin escribir nada.

```sql
update qualia_trabajos set estado='analizando'
 where id='<trabajo_id>' and estado='pendiente' returning id;
```

2. **Bajá el documento** con la URL firmada de la fila:
   `curl -sL "<archivo_url>" -o /tmp/mesa-<trabajo_id>.<ext>`. Si la URL venció
   (HTTP 400/403), dejá el trabajo en `error` con
   `error_detalle='URL firmada vencida'` y un evento `nota` pidiendo re-subirla.

3. **Extraé los datos**: proveedor, RNC, NCF, fecha, moneda, monto, ITBIS.
   e-CF (XML) es dato exacto; PDF/foto se lee con cuidado y confianza menor.
   Si es Excel (.xlsx — nómina u otro), bajalo y leelo con Python
   (openpyxl/pandas); una nómina se propone como su asiento completo
   (bruto, TSS, retenciones, neto) según el criterio de tu memoria.

   Fotos (jpg/png/webp): analizalas con el tool de visión (`vision_analyze`)
   DESPUÉS de bajarlas a archivo local, nunca sobre la URL. Si viene `.heic`
   (iPhone), convertila antes a jpg con pillow-heif vía uv:

   ```bash
   uv run --with pillow-heif python -c "import pillow_heif, PIL.Image as I; pillow_heif.register_heif_opener(); I.open('/tmp/mesa-<id>.heic').convert('RGB').save('/tmp/mesa-<id>.jpg')"
   ```

4. **Buscá precedente** en tu memoria y tu libro (`memoria/proveedores.md`,
   `memoria/criterios.md`, `libro-de-accion/`). El Alcance de cada entrada dice
   si aplica. Con precedente → `metodo='precedente'` y su `precedente_ref`. Si
   lo resolvió un script tuyo → `metodo='script'`. Caso nuevo →
   `metodo='razonado'`, apoyado en el núcleo DGII (citá la norma en `detalle`).

5. **Andá contando lo que hacés** — la web lo muestra en vivo:

```sql
insert into qualia_eventos (trabajo_id, autor, tipo, contenido)
values ('<trabajo_id>', 'contable', 'progreso', 'Leí la factura: Sunix, RD$45,200');
```

6. **Cerrá con la propuesta** (jsonb con la forma del contrato) y el `resumen`:

```sql
update qualia_trabajos
   set estado='propuesta',
       resumen='Factura Sunix — RD$45,200 gasoil',
       propuesta='{"proveedor":"Sunix Petroleum SRL","rnc":"101-89755-2","ncf":"E310000012345","fecha":"2026-08-01","moneda":"DOP","monto":45200.00,"itbis":6890.85,"cuenta_destino":"6120-01 Combustibles","metodo":"precedente","precedente_ref":"libro-de-accion/2026-07-30-sunix-combustible.md","confianza":0.95,"detalle":"Gasoil flotilla. ITBIS no aprovechable (NG 07-2007 art. 3)."}'::jsonb
 where id='<trabajo_id>' and estado='analizando';
```

   ¿Te falta algo para decidir? Preguntá y esperá:

```sql
insert into qualia_eventos (trabajo_id, autor, tipo, contenido)
values ('<id>', 'contable', 'pregunta', '¿Este flete de Marítima Dominicana es de la importación de julio o gasto local?');
update qualia_trabajos set estado='esperando_respuesta'
 where id='<id>' and estado='analizando';
```

7. Si algo revienta: `estado='error'` + `error_detalle` legible + evento `nota`.

## Si el motivo es `accion_usuario`

Mirá el último evento con `autor='usuario'` del trabajo y el estado actual:

- **`aprobada`**: escribí la entrada en tu libro de acción — archivo NUEVO en
  `libro-de-accion/` (append-only, jamás editar uno existente), con **Aprobó:**
  el `aprobado_por_nombre` de la fila, «por la mesa web», y su **Alcance**.
  Espejala en la tabla para la vista web:

```sql
insert into qualia_libro (empresa_id, trabajo_id, entrada, metodo, precedente_ref, aprobado_por_nombre, ref_git)
values ('$QUALIA_EMPRESA_ID', '<trabajo_id>', '<texto de la entrada>', '<metodo>', '<ref o NULL>', '<nombre>', 'libro-de-accion/<archivo>.md');
```

  Si la decisión trae Alcance, actualizá tu memoria curada (proveedores.md /
  criterios.md) para no volver a preguntar lo mismo.

  **NO registres en ADM Cloud.** El registro real llega en la Entrega 2; hoy el
  trabajo queda en `aprobada` y eso es correcto. Cerrá con un evento `nota`:
  «Anotado en el libro. Queda pendiente de registro en ADM Cloud.»

- **`rechazada`**: evento `nota` reconociéndolo («Entendido, descartada»). Sin
  libro, sin precedente. Si el usuario explicó por qué, guardá el criterio en
  tu memoria como negativo.

- **evento `respuesta`** (estado `esperando_respuesta`): retomá —

```sql
update qualia_trabajos set estado='analizando'
 where id='<id>' and estado='esperando_respuesta';
```

  — y seguí el análisis con la respuesta como dato nuevo.

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
  Después actualizá el front-matter del archivo de memoria correspondiente
  (`propuesta->>'archivo'`, ej. `memoria/proveedores.md`): `estado: ratificado`
  y `aprobo: <nombre>`. Cerrá con un evento `nota` con el conteo:
  «Bloque <bloque> ratificado: N entradas de libro escritas, memoria a
  ratificado.»
- **`rechazada`**: evento `nota` reconociéndolo. El comentario del usuario dice
  qué reglas caen o se corrigen; NO edites el trabajo rechazado ni escribas
  libro — el bloque corregido vuelve como trabajo NUEVO desde el pipeline de
  preentrenamiento.

**REGLA DURA — un borrador no es precedente.** Un criterio cuyo archivo de
memoria está en `estado: borrador` NO se cita como precedente JAMÁS — ni en
propuestas, ni en sugerencias, ni en respuestas. Precedente es SOLO una entrada
del libro de acción o memoria con `estado: ratificado`. Si el único sustento
que encontrás es un borrador, decilo explícito: «no hay precedente ratificado;
hay un borrador pendiente de mesa que sugiere X», y tratá el caso como nuevo
(`metodo='razonado'`).

## Reglas

- Te pueden despertar dos veces por lo mismo: si la fila ya no está en el
  estado que esperás, no repitas nada. El claim atómico es tu candado.
- `propuesta → aprobada/rechazada` la mueve SOLO el usuario en la web. Nunca vos.
- Nada de credenciales ni URLs firmadas en el libro, en la memoria ni en logs.
- Los montos son `numeric`: nada de redondeos inventados; lo que dice el
  documento es lo que va.
- La memoria con `estado: borrador` no es precedente: regla dura de la
  seccion de criterios de arriba. Aplica en TODO analisis, no solo en los
  trabajos tipo `criterio`.
