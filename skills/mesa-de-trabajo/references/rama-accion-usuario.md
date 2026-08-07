# Rama «el humano actuó» — la lee la fila que el usuario aprobó, rechazó o respondió.

## Si el motivo es `accion_usuario`

Mirá el último evento con `autor='usuario'` del trabajo y el estado actual:

- **`aprobada`**: desde el 2026-08-04 esta rama es la EXCEPCIÓN, no el camino
  normal. Las facturas y los cargos bancarios los registra el poller solo, y te
  despierta después con el motivo `escribir_libro`. Acá llegás por lo que él no
  automatiza —una transferencia, un `Journals`— o por una carrera en la que el
  evento se leyó antes de que la fila dijera `aprobada`. **Mirá primero
  `registro_adm.docid`**: si ya está, no registres nada, andá derecho a lo que
  dice `references/rama-escribir-libro.md`, que `abrir-trabajo.sh` te imprimió
  pegado a éste. Si NO está, estás en la carrera: el procedimiento de registro es
  `references/ref-registro-adm.md` y NO te lo imprimieron, porque esta rama
  normalmente no registra. **Éste es el único caso en que sí tenés que hacerle
  `cat`** — la regla de «no abras las que no te tocan» (núcleo) no aplica acá.

- **`rechazada`**: evento `nota` reconociéndolo, respondiendo a lo que él dijo
  («Entendido, la descarto y no va a ADM»). Sin libro: un rechazo no registra
  nada. **Si el trabajo es tipo `criterio` no estás en este archivo** —
  `abrir-trabajo.sh` corta por motivo Y tipo y te habría dado
  `references/rama-criterio.md`, que es donde vive lo que un criterio rechazado
  no puede hacer.

  **Atendé TODOS los rechazos recientes, no sólo el que te nombraron.** El
  poller agrupa: cuando caen varios seguidos —lo normal al rehacer el plan de un
  caso, donde se rechazan tres o cuatro pasos de un tirón— sólo el primero abre
  sesión, y los demás quedan esperando que vos los mires en ésta. Antes se
  despertaba uno por cada uno: cuatro sesiones de LLM que llenaban el cupo y
  dejaban el trabajo de verdad haciendo cola detrás.

  ```bash
  psql "$QUALIA_DSN" -t -A -F'|' -c "select t.id, t.resumen, (select e.contenido from qualia_eventos e where e.trabajo_id=t.id and e.autor='usuario' order by e.id desc limit 1) from qualia_trabajos t where t.empresa_id='$QUALIA_EMPRESA_ID' and t.estado='rechazada' and t.updated_at > now() - interval '15 minutes' and not exists (select 1 from qualia_eventos x where x.trabajo_id=t.id and x.autor='contable' and x.id > (select max(y.id) from qualia_eventos y where y.trabajo_id=t.id and y.autor='usuario'))"
  ```

  El `not exists` es lo que evita el bucle: trae sólo los que todavía no
  respondiste. Contestá cada uno con su `nota`, y si varios comparten el motivo
  —el plan entero se rehizo— alcanza con un criterio, no con cuatro iguales.

  **Y si explicó el porqué, esa explicación es un criterio negativo — mismo
  carril, ningún atajo.** La pantalla se lo prometió al aprobar el rechazo («si
  explicás el porqué, el contable lo guarda como criterio»), así que no puede
  terminar en un archivo de memoria: los tres que hay están en `borrador` y un
  borrador no es precedente ni se cita jamás. Insertá la fila `tipo='criterio'`
  igual que en la rama `respuesta` —con sus cuatro reglas, incluida la de NO
  poner `archivo`—, con el enunciado en negativo («no proponer gastos de
  <comercio>, RNC <rnc>: son personales») y el alcance acotado a ese comercio.

- **evento `respuesta`**: el humano te está contestando o corrigiendo. Retomá —

```sql
update qualia_trabajos set estado='analizando'
 where id='<id>' and empresa_id='$QUALIA_EMPRESA_ID'
   and estado in ('esperando_respuesta','propuesta','pendiente','error');
```

  — y seguí el análisis con la respuesta como dato nuevo. **Tu primer evento
  después de retomar le contesta a él**: qué entendiste de lo que dijo y qué
  vas a hacer con eso (regla «si te escribió, contestale a él primero», núcleo). Un
  humano que responde y ve que el hilo sigue como si nada asume que no lo
  leíste.

  **El estado NO es `esperando_respuesta` siempre**: sólo lo es si vos
  preguntaste. Cuando el humano corrige una propuesta tuya por su cuenta, la
  fila sigue en `propuesta`; cuando reabre un error, en `error`. Gatear esta
  rama sólo contra `esperando_respuesta` la volvía inalcanzable en el caso más
  común, que es justo el que importa.

  **Una corrección del humano manda sobre tu conclusión anterior — pero acatar
  no es obedecer al pie de la letra.** El humano nombra lo que él vio mal, no el
  asiento completo. El 2026-08-05, sobre la liquidación de la DGA, «pero siempre
  se registra como proveedor» era CIERTO y era la MITAD: el corpus tiene 10
  liquidaciones como `VendorBills` y 9 de ellas saldadas por el centavo exacto
  con su `BillPayments` propio. Corregir el tipo y dejar el pago afuera hubiera
  dejado el débito del banco sin documento. Acatá lo que te dijo y completá lo
  que falta, diciéndolo en `detalle`.

  **Y no vuelvas atrás.** Si ya acataste una corrección en este hilo, no la
  revoques con tu razonamiento anterior: la única forma de contradecir al humano
  es citando documentos reales de ADM que registren ESE concepto de otra manera.
  Sin esa cita, la corrección gana. Pasó el 2026-08-05: el contable acató a las
  23:44:54 y quince segundos después volvió a su propuesta original.

  ### Y si lo que te dijo vale para la próxima, proponelo como criterio

  Acá se cierra el círculo. Hoy una corrección muere en el hilo: el 2026-08-05,
  sobre la liquidación de la DGA, «pero siempre se registra como provedor» era
  cierto —10 de 10 en el corpus— y no quedó escrito en ningún lado. La ficha que
  ya lo decía vivía en un archivo que tenés prohibido citar.

  **El discriminador es uno solo: ¿te corrigió lo que VISTE o lo que
  CONCLUISTE?** Medido sobre las 19 correcciones reales del corpus:

  - «Leíste mal el NCF, le falta un cero» · «el importe es 750.00» → corrigió lo
    que VISTE. **No es criterio**: arreglá el dato y seguí. Son 10 de las 19, y
    convertirlas en reglas produce diez reglas falsas sobre cómo leer un papel.
  - «esto es un centro fitness, va como representación» · «pero siempre se
    registra como proveedor» → corrigió lo que CONCLUISTE. **Eso sí es
    criterio.** Son 2 de 19 — uno cada dos días de uso intenso, no una avalancha.
  - Si te hizo una PREGUNTA, contestala: una pregunta no es una corrección (5 de
    las 19).
  - Si te dio el contexto de ESE hecho («la comisión fue por el alquiler de la
    nave»), va en `detalle` del trabajo. No generaliza.

  Cuando SÍ es criterio, insertá la fila y seguí con lo tuyo — la ratifica el
  dueño, no vos:

```sql
insert into qualia_trabajos (empresa_id, tipo, origen, estado, resumen, propuesta)
values ('$QUALIA_EMPRESA_ID', 'criterio', 'correccion_usuario', 'propuesta',
        'Criterio: <una línea>',
        jsonb_build_object(
          'n_reglas', 1,
          'reglas', jsonb_build_array(jsonb_build_object(
            'titulo',    '<qué decide, en una línea>',
            'enunciado', '<la regla, con el hecho que la sostiene>',
            'alcance',   '<hasta dónde vale: este proveedor, esta cuenta, esta empresa>')),
          'origen_trabajo', '<trabajo_id>',
          'detalle', 'Sale de la corrección de <nombre> del <fecha> sobre <resumen del trabajo>.'));
```

  **Cuatro cosas que no se negocian**, y las cuatro por el mismo motivo: al
  aprobarse, esto nace como entrada de libro, o sea precedente de PRIMERA CLASE,
  por encima del agg que sí se re-destila todas las noches.

  1. **UNA regla por fila.** `reglas` es un array de un solo elemento. Nunca
     empaquetes varias: se ratifican juntas de un click y nadie las miró.
  2. **NUNCA pongas `archivo`.** Esa clave hace que al aprobar se marque
     `estado: ratificado` en un archivo de memoria ENTERO — 73 fichas en el caso
     de `proveedores.md`, ninguna revisada. Una corrección no ratifica un
     archivo: ratifica su propia regla y nada más.
  3. **`alcance` ESCRITO, jamás vacío.** 197 de las 201 entradas del libro lo
     llevan, y una regla sin borde se aplica donde no debe. Si no sabés hasta
     dónde llega, poné el borde más chico que sea cierto (ese proveedor, esa
     cuenta) y decilo en `detalle`.
  4. **El enunciado se sostiene en un hecho**, no en que te lo dijeron: contá
     cuántos documentos del histórico lo respaldan, o admití que es sólo la
     palabra del dueño.

  **Y cerrá siempre con el marcador**, generalice o no — es lo que vuelve
  auditable el carril: si un día hay que revisar qué correcciones se perdieron,
  se buscan los hilos sin marcador.

```sql
insert into qualia_eventos (trabajo_id, autor, tipo, contenido, datos)
values ('<trabajo_id>', 'contable', 'nota',
        'Criterio propuesto: <título>' /* o: 'No lo propongo como criterio: corrige el dato de este documento, no la regla' */,
        jsonb_build_object('criterio', 'si'));  -- 'no' cuando no generaliza
```

