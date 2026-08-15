<!-- Rama servida por scripts/abrir-trabajo.sh — motivo accion_usuario: respuestas,
correcciones, aprobaciones, rechazos. También la sirve para registro_pendiente (su
rama aprobada es la mecánica de registro). Tajada verbatim de a14c7d0. -->

## Si el motivo es `accion_usuario`

Contexto completo en una corrida (sin `--claim`: acá no hay claim que ganar):

```bash
bash /opt/data/memoria/scripts/leer-contexto.sh <trabajo_id>
```

Mirá el último evento con `autor='usuario'` del trabajo y el estado actual:

- **`aprobada`**: desde el 2026-08-04 esta rama es la EXCEPCIÓN, no el camino
  normal. Las facturas y los cargos bancarios los registra el poller solo, y te
  despierta después con el motivo `escribir_libro`. Acá llegás por lo que él no
  automatiza —una transferencia, un `Journals`— o por una carrera en la que el
  evento se leyó antes de que la fila dijera `aprobada`. **Mirá primero
  `registro_adm.docid`**: si ya está, no registres nada, andá derecho a lo que
  dice `escribir_libro`.

  Escribí la entrada en tu libro de acción — archivo NUEVO en
  `libro-de-accion/` (append-only, jamás editar uno existente), con **Aprobó:**
  el `aprobado_por_nombre` de la fila, «por la mesa web», y su **Alcance**.
  Espejala en la tabla para la vista web:

```sql
insert into qualia_libro (empresa_id, trabajo_id, entrada, metodo, precedente_ref, aprobado_por_nombre, ref_git)
values ('$QUALIA_EMPRESA_ID', '<trabajo_id>', '<texto de la entrada>', '<metodo>', '<ref o NULL>', '<nombre>', 'libro-de-accion/<archivo>.md');
```

  Si la decisión trae Alcance, actualizá tu memoria curada (proveedores.md /
  criterios.md) para no volver a preguntar lo mismo.

  **REGISTRÁ EN ADM CLOUD.** Encendido el 2026-08-02 con la primera factura real
  (TUPAQ → `FP00001061`). El orden no se negocia: **ADM primero, libro después**,
  para que la entrada nazca con su número. Si el registro falla, el libro NO se
  escribe: el trabajo queda en `error` y se reintenta. Jamás una entrada de libro
  sin el documento que la generó.

  ### Un solo comando hace todo

  ```bash
  python3 /opt/data/memoria/scripts/registrar-en-adm.py --trabajo <trabajo_id>
  ```

  Crea el proveedor si no existe, chequea duplicado, registra, lee de vuelta,
  guarda el DocID en la fila y te dice el número. **Agregá `--simular` para ver
  el payload sin escribir nada** — hacelo la primera vez con cada proveedor nuevo.

  **Usá el script, no armes los `curl` a mano.** No es comodidad: cada `curl`
  que pipeás a `python3 -c` para leer la respuesta despierta al guardián de
  comandos, que consulta a otro modelo y tarda 15-30 segundos — el 2026-08-03 el
  registro quedó atascado ahí más de un minuto. Además el script trae escritas
  las trampas de esta API (el ITBIS sobre cantidad×precio, el término de pago
  obligatorio, el readback que devuelve documentos ajenos) para que no las
  re-deduzcas en cada factura.

  Si el script muere, **leé su mensaje**: dice exactamente qué falta. Los casos
  previstos son proveedor sin RNC válido, cuenta contable que no existe en el
  catálogo, factura ya registrada y NCF que no verifica en DGII. Ninguno se
  resuelve insistiendo: o falta un dato de la propuesta o hay que preguntarle al
  humano.

  **El adjunto ya lo sube el script** (desde el 2026-08-03): baja el documento,
  lo adjunta a la transacción y lo anota en `registro_adm.adjunto`. Solo si te
  dice «ADJUNTO FALLÓ» lo subís a mano:

  ```bash
  ruta=$(bash /opt/data/memoria/scripts/bajar-documento.sh <trabajo_id>)
  curl -s -H "Authorization: Basic $(printf '%s:%s' "$ADMCLOUD_REG_USER" "$ADMCLOUD_REG_PASSWORD" | base64 -w0)" \
       -F "file=@$ruta" \
       "https://api.admcloud.net/api/Storage?transactionID=<uuid>&company=$ADMCLOUD_COMPANY&role=Contabilidad%20Digital&appid=$ADMCLOUD_APPID"
  ```

  **Fijate en el `%20`**: `$ADMCLOUD_REG_ROLE` vale «Contabilidad Digital», con
  espacio, y si lo interpolás crudo en la URL el curl devuelve HTTP 000. Eso
  costó 31 segundos por factura hasta que el script se hizo cargo.

  Y recién ahí el libro, citando el DocID.

  **Y lo ÚLTIMO de todo: cerrá la fila.** Si usaste el script, ya lo hizo él y
  te lo dijo («estado: registrada»); esto es para el caso en que hayas
  registrado a mano.

  ```sql
  update qualia_trabajos set estado='registrada'
   where id='<trabajo_id>' and empresa_id='$QUALIA_EMPRESA_ID'
     and estado='aprobada';
  ```

  Sin este paso la factura queda registrada de verdad en ADM y la mesa la
  muestra como pendiente PARA SIEMPRE. Pasó con las cuatro primeras facturas
  (2026-08-03): las cuatro en ADM, `registrada` = 0 en la base, porque este
  renglón no existía en ninguna capa del sistema. Dos detalles:

  - El `and estado='aprobada'` es el guard: si alguien movió la fila mientras
    trabajabas, no la pises.
  - **NO pongas `updated_at` en el SET.** No tenés grant sobre esa columna y el
    UPDATE entero muere con «permission denied». El trigger la sella sola.

  ### Cargo bancario, transferencia o asiento: sin NCF no hay red contra el doble registro

  **Esta sección habla de DUPLICADOS, no de clasificación.** El tipo ya lo
  decidiste con «Qué documento de ADM es esto» (la sección vive en
  `references/rama-facturas-1.md`, por si necesitás releerla), y ahí el NCF no
  jugó — es regla dura, con 96 contraejemplos. Lo que cambia acá es otra cosa:
  el script de
  arriba es SOLO para facturas, y lo que sale de una sugerencia —`BankCharges`,
  `BankBankTransfers`, `Journals`— lo armás vos con la API. Como esos documentos
  no llevan NCF, ninguna de las dos redes que frenan el doble registro de una
  factura existe: ADM te va a dejar crear el mismo cargo diez veces.

  **REGLA DURA: un documento de ADM es «el tuyo» solo si podés PROBARLO.** El
  parecido no prueba nada: mismo banco, misma fecha, mismo monto y mismo
  concepto es exactamente cómo se ven DOS cargos distintos. El banco cobra dos
  comisiones iguales el mismo día y las cobra de verdad.

  Pasó el 2026-08-03: dos comisiones LBTR de RD$100 del mismo día se aprobaron
  juntas, la segunda encontró en ADM el cargo que vos mismo habías creado 45
  segundos antes para la primera, lo dio por suyo y cerró la fila con
  `CB00000169` — el mismo DocID en dos trabajos, y un cargo de menos en ADM.
  Nadie se enteró hasta que el dueño contó 61 en la mesa contra 59 en ADM.

  Entonces, al registrar uno de estos:

  - **Mandá `Reference` = el `banco_tx_id` de la propuesta** (el uuid del
    movimiento del banco). Es lo único que distingue dos cargos gemelos.
    **Verificá en el readback si volvió**: los 166 `BankCharges` de esta empresa
    tienen `Reference` en null porque nunca nadie lo mandó (medido 2026-08-04),
    así que la primera vez que lo mandes estás averiguando si el campo se
    persiste. Si vuelve poblado, decilo en el evento `nota` y desde ahí es LA
    llave. Si vuelve null, avisá — hay que buscar otra y no se puede seguir
    registrando gemelos a ciegas.
  - **Buscar antes del POST no es opcional**: paginá el listado de su tipo y
    fijate si alguno trae TU referencia. **Ojo: el listado no trae los
    anulados** (medido 2026-08-04: `/api/BankCharges` devolvió 166 filas, cero
    con `Void`, y los que el dueño acababa de anular no estaban). No
    encontrarlo es la respuesta correcta para registrar: si lo anularon, hay que
    volver a registrarlo igual.
  - **Leé de vuelta por UUID** (`GET <tipo>/<uuid>`) y comprobá que el `ID`
    devuelto sea el que pediste, igual que hace el script con las facturas.
    Recién ahí guardás `docid`, `uuid`, `documento` y `reference` en
    `registro_adm`.
  - **Si no podés probar que el documento es tuyo, NO lo adoptes y NO
    re-registres**: preguntá por evento `pregunta` y dejá la fila en
    `esperando_respuesta` con lo que viste («hay un CB00000169 idéntico del
    mismo día; no puedo saber si es este movimiento o el otro»). Un DocID
    prestado es un descuadre silencioso; una pregunta la contesta el dueño en
    diez segundos.

  ### Referencia: qué hace el script por dentro

  **Esto NO es un procedimiento a seguir.** Está acá para que entiendas los
  mensajes de error del script y puedas explicarle al humano qué pasó. Rehacer
  estos pasos a mano con `curl` es exactamente lo que hay que evitar: es más
  lento (el guardián de comandos cobra 15-30s por cada `-c`), y las validaciones
  que el script trae —el cuadre contra el documento, el readback verificado, el
  duplicado— no están en estos pasos, así que hacerlo a mano las saltea.


  **1. ¿Existe el proveedor?** Buscalo por RNC en `/api/Vendors` (paginando:
  `skip` es obligatorio y `take` se ignora). El match es por `FiscalID`, exacto —
  **nunca por nombre**, que se escribe de veinte formas distintas.

  Si NO existe, creálo con `POST /api/Vendors`. Un proveedor de esta empresa
  lleva cinco campos y nada más (medido sobre los 169 existentes):

  ```json
  {"Name": "<razón social de DGII>", "FiscalID": "<RNC>", "IsVendor": true,
   "CurrencyID": "DOP", "PaymentTermID": "<uuid del término>"}
  ```

  El **nombre sale de la consulta a DGII**, no de lo impreso: `razon_social_emisor`
  es la razón social oficial y es lo que la contable espera ver. (ADM tiene consulta
  automática a DGII en su pantalla, pero **no la expone por API** — verificado sobre
  los 801 endpoints publicados. Da igual: ya le preguntamos a DGII nosotros.)

  **Nunca te quedes trabado por el nombre.** Si el comprobante no se pudo
  verificar y no hay `razon_social_emisor`, el nombre igual existe: es
  `rnc_emisor.razon_social` del dossier, o la consulta al padrón del §5c
  (`consultar-rnc-dgii.py --rnc <rnc>`). Solo pide el RNC. Ese camino es
  obligatorio antes de dar el trabajo por fallido — «DGII no me dio la razón
  social» no es un motivo de error válido mientras tengas el RNC. Recién si el
  padrón responde NO ENCONTRADO o no verificable, parás y lo explicás.
  Términos de pago: `Al contado` `94940a99-f119-4573-8bbd-08dd14abff09` ·
  `30 días` `b002e9c1-0430-4809-8612-b27db42a35a0` ·
  `45 días` `27e7f4f5-f179-40f0-6fb0-08dd14abefee` ·
  `60 días` `a101c88e-5a4c-4860-17e0-08dd149772e6`. Sale del documento; si no dice,
  `Al contado`. **Si el RNC no verifica en DGII, NO crees el proveedor**: preguntá.

  **2. ¿Ya está registrada la factura?** Paginá `/api/VendorBills` y filtrá
  **local** por NCF. **Prohibido `?Reference=` y `?DocID=`**: el primero devuelve
  cero para referencias que sí existen y el segundo se ignora — buscar con ellos
  es licenciar el doble registro.

  ADM también lo frena por su cuenta, por DOS claves independientes (probado):
  mismo NCF → *«de este RNC posee el mismo NCF»*; misma referencia → *«de este
  proveedor posee la misma referencia»*. Es una red, no un permiso para saltarse
  el chequeo: mejor avisar antes que gastar el POST.

  **3. POST `/api/VendorBills`.** Único campo requerido: `DocDate`. Lo que
  importa y no es obvio:

  - **El ITBIS NO se manda como monto.** Va `TaxScheduleID` por línea
    (`f980499b-4f32-48cb-8c6f-5fe74d245528` = ITBIS 18%) y el servidor calcula.
    Las líneas exentas simplemente no lo llevan.
  - **La base del impuesto es `Quantity × Price`, no `Price`.** Con cantidad 1 no
    se nota; con 0.50 la diferencia fue de 10.63 contra 21.25 y el total se iba a
    173.88 con `success:true`. Verificalo antes de mandar.
  - **El asiento NO se manda.** ADM lo deriva: débito a la cuenta de cada línea,
    débito a ITBIS Operativo, crédito a Cuentas por Pagar. Mandarlo descuadra.
  - `Reference` = el número PROPIO del suplidor (`extraccion.numero_factura_suplidor`
    del dossier), NO el NCF. Está poblado en las 1050/1050 facturas del libro.
  - El e-CF se manda igual que un B01: el string en `NCF` y nada más. Registrar
    una factura de proveedor **no emite, ni firma, ni declara** ante DGII.
  - **Una sola vez.** No hay clave de idempotencia: si expira, NO reintentes —
    volvé al paso 2 y contá. Reintentar a ciegas crea una segunda factura, y
    revertir en ADM **borra** el documento (no lo anula).

  **4. Leé de vuelta.** El POST devuelve **solo el UUID**; el número humano
  (`FP########`) sale del readback, así que este paso es obligatorio, no una
  verificación opcional. `GET /api/VendorBills/<uuid>` y **comprobá que el `ID`
  devuelto sea el UUID que pediste**: pasarle un DocID, un NCF o una referencia
  devuelve *otro documento* con `success:true`. Confirmá también que el asiento
  derivado cuadre.

  **5. Guardá los dos identificadores** en la fila (la web muestra el DocID como
  "Documento ADM"; la base ya no deja `registrada` sin él):

  ```sql
  update qualia_trabajos
     set propuesta = propuesta || jsonb_build_object('registro_adm',
           jsonb_build_object('docid','<DocID>','uuid','<UUID>',
                              'documento','VendorBills','fecha',now()::date,
                              'reference','<numero del suplidor>'))
   where id='<trabajo_id>' and empresa_id='$QUALIA_EMPRESA_ID';
  ```

  **6. Adjuntá el documento.** `POST /api/Storage?transactionID=<UUID>` con
  **multipart/form-data**, campo `file`. El archivo lo bajás con
  `bajar-documento.sh`. Sin adjunto la factura queda sin respaldo: no lo saltes.

  **7. Recién ahora, el libro**, citando el DocID: «Registrada en ADM como
  FP00001061».

  **8. Y cierra la fila**: `update qualia_trabajos set estado='registrada'
  … and estado='aprobada'`. Sentencia APARTE de la del paso 5, a propósito: si
  el guard no matchea porque alguien movió la fila, perder el estado es
  recuperable, perder el DocID no. La garantía de «nunca `registrada` sin
  evidencia» la da el CHECK de la base, no la atomicidad.

- **`rechazada`**: evento `nota` reconociéndolo, respondiendo a lo que él dijo
  («Entendido, la descarto y no va a ADM»). Sin libro: un rechazo no registra
  nada. **Esta rama NO aplica si el trabajo es tipo `criterio`** — ese caso lo
  manda la sección «Si el trabajo es tipo `criterio`», y un criterio rechazado
  JAMÁS engendra otro criterio: se muerde la cola.

  **Atendé TODOS los rechazos recientes, no sólo el que te nombraron.** El
  poller agrupa: cuando caen varios seguidos —lo normal al rehacer el plan de un
  caso, donde se rechazan tres o cuatro pasos de un tirón— sólo el primero abre
  sesión, y los demás quedan esperando que vos los mires en ésta. Antes se
  despertaba uno por cada uno: cuatro sesiones de LLM que llenaban el cupo y
  dejaban el trabajo de verdad haciendo cola detrás.

  ```bash
  psql "$QUALIA_DSN" -t -A -F'|' -c "select t.id, t.resumen, (select e.contenido from qualia_eventos e where e.trabajo_id=t.id and e.autor='usuario' order by e.id desc limit 1) from qualia_trabajos t where t.empresa_id='$QUALIA_EMPRESA_ID' and t.estado='rechazada' and t.updated_at > now() - interval '15 minutes' and not (t.propuesta ? 'superada_por_ncf') and not exists (select 1 from qualia_eventos x where x.trabajo_id=t.id and x.autor='contable' and x.id > (select max(y.id) from qualia_eventos y where y.trabajo_id=t.id and y.autor='usuario'))"
  ```

  El `not exists` es lo que evita el bucle: trae sólo los que todavía no
  respondiste. El `not (propuesta ? 'superada_por_ncf')` descarta los cierres
  AUTOMÁTICOS del cron de conciliación (una suelta superada por su comprobante
  fiscal): ahí no hay humano que te haya dicho nada, no hay porqué que guardar
  como criterio, y contestarle a una máquina es puro ruido en el hilo. Contestá cada uno con su `nota`, y si varios comparten el motivo
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
  vas a hacer con eso (regla «si te escribió, contestale a él primero»). Un
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

