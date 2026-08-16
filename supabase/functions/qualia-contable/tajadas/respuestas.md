<!-- GENERADO por deploy/generar-tajadas.sh — NO editar a mano -->

<!-- adaptado: la rama ya no la sirve scripts/abrir-trabajo.sh — la sirve el harness
del turno, que rutea por el ESTADO REAL de la fila y precarga el dossier. Sigue siendo
la rama de respuestas, correcciones, aprobaciones y rechazos, y la que se sirve para
registro_pendiente; lo que cambia es que en F3 ese motivo es SOLO diagnóstico. Re-tajada
de la tajada verbatim de a14c7d0 según contrato-turno.md §5.3: muere la mecánica del
chasis viejo, quedan las reglas contables y las lápidas. -->

## Si el motivo es `accion_usuario`

<!-- adaptado: muere `bash /opt/data/memoria/scripts/leer-contexto.sh <trabajo_id>` — no hay shell.
El contexto entero viene PRECARGADO en la primera iteración (tool `dossier_completo`,
contrato §2.1) y el claim lo hace el harness. La regla de fondo queda: el contexto se
lee completo de una vez, no a pedacitos. -->
Contexto completo en una corrida: ya lo tenés delante (`dossier_completo`, servido de
oficio). Acá no hay claim que ganar: el harness ya reclamó la fila. Si tras una
corrección necesitás el hilo entero, volvé a llamar la tool pidiéndolo.

Mirá el último evento con `autor='usuario'` del trabajo y el estado actual:

- **`aprobada`**: desde el 2026-08-04 esta rama es la EXCEPCIÓN, no el camino
  normal. Las facturas y los cargos bancarios los registra el poller solo, y te
  despierta después con el motivo `escribir_libro`. Acá llegás por lo que él no
  automatiza —una transferencia, un `Journals`— o por una carrera en la que el
  evento se leyó antes de que la fila dijera `aprobada`. **Mirá primero
  `registro_adm.docid`**: si ya está, no registres nada, andá derecho a lo que
  dice `escribir_libro`.

<!-- adaptado: mueren el archivo escrito al filesystem y el insert a `qualia_libro` por psql — los hace la tool
`escribir_libro`, en el orden fijo tabla → GitHub → `ref_git` (contrato §2.6). El `docid`
y el `aprobado_por_nombre` los toma la tool de la FILA, jamás de tu salida (enmienda
NORMATIVA 1). La doctrina queda entera: archivo NUEVO, append-only, Aprobó, Alcance, y el
espejo en la tabla para la vista web. -->
  Escribí la entrada en tu libro de acción con la tool `escribir_libro`: nace un
  archivo NUEVO en `libro-de-accion/` (append-only, jamás editar uno existente),
  con **Aprobó:** el `aprobado_por_nombre` de la fila, «por la mesa web», y su
  **Alcance**. La tool la espeja sola en `qualia_libro` para la vista web y es
  idempotente por trabajo: si la entrada ya está, no la dupliques.

<!-- adaptado: muere «actualizá tu memoria curada» como acción tuya: la memoria viaja
empaquetada en este contexto y ratificarla o ampliarla es operación de repo + redeploy
(contrato §6.7 y enmienda 6a). La regla de fondo queda: sin Alcance escrito, se vuelve a
preguntar lo mismo. -->
  Si la decisión trae Alcance, escribilo en la entrada del libro y dejalo dicho
  ahí: reflejarlo en la memoria curada (proveedores.md / criterios.md) no es tuyo
  —se hace en el repo— y qualia-salud avisa cuando queda sin reflejar.

<!-- adaptado: mueren `registrar-en-adm.py --trabajo` y `--simular`, el curl a /api/Storage del adjunto (y su %20), y el `update ... estado='registrada'` por psql: en F3 el turno NO postea a ADM ni cierra la fila (contrato §6.1 y §3.4).
Eso lo hace la pieza que registra —el mesa hasta F4, `qualia-registrador` después—; vos
solo diagnosticás y avisás. Muere también el guardián de comandos con sus 15-30s, que se
va con el shell. La regla de orden y las lápidas quedan escritas para quien registre. -->
  **VOS NO REGISTRÁS EN ADM CLOUD.** Registrar lo que un humano aprobó es de otra
  pieza del sistema; acá ADM es solo lectura (`leer_adm`). Ante un registro
  pendiente tu parte es diagnosticar con lo que ADM ya tiene y contestar:
  `preguntar_al_humano` si falta una decisión, `responder` si es un acuse.

  **El orden no se negocia, y sigue escrito acá porque lo hereda quien registre:
  ADM primero, libro después**, para que la entrada nazca con su número. Si el
  registro falla, el libro NO se escribe: el trabajo queda en `error` y se
  reintenta. Jamás una entrada de libro sin el documento que la generó — por eso
  `escribir_libro` toma el DocID de la fila, y sin DocID no hay entrada: se cierra
  con `responder` avisando.

  **Cuando el registro falló, el diagnóstico es tuyo.** Los casos previstos son
  proveedor sin RNC válido, cuenta contable que no existe en el catálogo, factura
  ya registrada y NCF que no verifica en DGII. **Ninguno se resuelve insistiendo**:
  o falta un dato de la propuesta o hay que preguntarle al humano. Verificá con
  `leer_adm` —el vendor por `FiscalID` exacto, la cuenta contra el plan VIVO, el
  listado de su tipo— y con `consultar_dgii` solo si el dossier trae el campo
  ausente o `no verificable`.

  ### Cargo bancario, transferencia o asiento: sin NCF no hay red contra el doble registro

<!-- adaptado: muere el puntero «la sección vive en references/rama-facturas-1.md, por si
necesitás releerla» (no hay filesystem que releer) y muere «lo armás vos con la API»: en
F3 el turno no postea nada (§6.1). La regla dura del NCF con sus 96 contraejemplos y la
doctrina del duplicado quedan; lo de abajo pasa a ser criterio de DIAGNÓSTICO. -->
  **Esta sección habla de DUPLICADOS, no de clasificación.** El tipo ya lo
  decidiste con «Qué documento de ADM es esto», y ahí el NCF no jugó — es regla
  dura, con 96 contraejemplos; si el tipo te queda en duda se pregunta, no se
  relee un archivo que acá no existe. Lo que cambia es otra cosa: lo que sale de
  una sugerencia —`BankCharges`, `BankBankTransfers`, `Journals`— no lleva NCF, y
  sin NCF ninguna de las dos redes que frenan el doble registro de una factura
  existe: ADM deja crear el mismo cargo diez veces.

  **REGLA DURA: un documento de ADM es «el tuyo» solo si podés PROBARLO.** El
  parecido no prueba nada: mismo banco, misma fecha, mismo monto y mismo
  concepto es exactamente cómo se ven DOS cargos distintos. El banco cobra dos
  comisiones iguales el mismo día y las cobra de verdad.

  Pasó el 2026-08-03: dos comisiones LBTR de RD$100 del mismo día se aprobaron
  juntas, la segunda encontró en ADM el cargo que vos mismo habías creado 45
  segundos antes para la primera, lo dio por suyo y cerró la fila con
  `CB00000169` — el mismo DocID en dos trabajos, y un cargo de menos en ADM.
  Nadie se enteró hasta que el dueño contó 61 en la mesa contra 59 en ADM.

<!-- adaptado: los cuatro pasos son la spec de la pieza que registra (F4): `Reference` =
banco_tx_id, buscar paginado antes del POST, readback por UUID, no adoptar sin prueba. En
F3 el turno los usa para DIAGNOSTICAR con `leer_adm{listado}` y cierra con
`preguntar_al_humano` (contrato §3.4). Muere el POST y muere el evento suelto con su
cambio de estado a mano; las reglas y la lápida CB00000169 quedan enteras. -->
  Entonces, frente a uno de estos —lo registre quien lo registre— lo que aportás
  vos es la PRUEBA:

  - **La llave es el `banco_tx_id` de la propuesta** (el uuid del movimiento del
    banco) viajando en `Reference`: es lo único que distingue dos cargos gemelos.
    Los 166 `BankCharges` de esta empresa tienen `Reference` en null porque nunca
    nadie lo mandó (medido 2026-08-04), así que todavía no se sabe si el campo se
    persiste. Si lo ves poblado, decilo — desde ahí es LA llave. Si sigue en null,
    avisá: hay que buscar otra y no se puede seguir registrando gemelos a ciegas.
  - **Buscar no es opcional**: `leer_adm{listado}` de su tipo, paginado, y fijate
    si alguno trae ESA referencia. **Ojo: el listado no trae los anulados**
    (medido 2026-08-04: `/api/BankCharges` devolvió 166 filas, cero con `Void`, y
    los que el dueño acababa de anular no estaban). No encontrarlo es la respuesta
    correcta para registrar: si lo anularon, hay que volver a registrarlo igual.
  - **La prueba se cierra por UUID**: `leer_adm{documento}` y que el `ID` devuelto
    sea el que pediste. Un parecido no prueba nada.
  - **Si no podés probar que el documento es tuyo, NO lo des por adoptado y NO
    pidas que se re-registre**: cerrá con `preguntar_al_humano` contando lo que
    viste («hay un CB00000169 idéntico del mismo día; no puedo saber si es este
    movimiento o el otro»). Un DocID prestado es un descuadre silencioso; una
    pregunta la contesta el dueño en diez segundos.

<!-- adaptado: la sección entera era la referencia interna de registrar-en-adm.py (alta de proveedor, POST, adjunto, cierre de fila) — spec de la pieza que registra (F4), y acá no hay script que explicar ni curl que rehacer.
Queda lo que sirve para LEER y diagnosticar: las trampas de la API que `leer_adm` hereda,
la aritmética del ITBIS y las lápidas, todas con su medición. -->
  ### Referencia: lo que hay que saber para diagnosticar un registro

  **Esto NO es un procedimiento a seguir**: en este turno no hay POST. Está acá
  para que entiendas por qué un registro falló y puedas explicárselo al humano.

  - **El proveedor se busca por `FiscalID` exacto, nunca por nombre** — se escribe
    de veinte formas distintas — y su nombre oficial es la razón social de DGII,
    no lo impreso. **Si el RNC no verifica en DGII, el proveedor no se crea:
    preguntá.** Y «DGII no me dio la razón social» no es motivo de error mientras
    tengas el RNC: está `rnc_emisor.razon_social` del dossier y está el padrón
    (`consultar_dgii{modo:'padron'}`). Recién si el padrón responde NO ENCONTRADO
    o no verificable, parás y lo explicás.
  - **El duplicado de una factura se busca paginando el listado y filtrando LOCAL
    por NCF.** `?Reference=` y `?DocID=` están **prohibidos**: el primero devuelve
    cero para referencias que sí existen y el segundo se ignora — buscar con ellos
    es licenciar el doble registro. ADM además lo frena por dos claves propias
    (mismo NCF de ese RNC; misma referencia de ese proveedor): es una red, no un
    permiso para saltarse el chequeo.
  - **El ITBIS no se manda como monto: se calcula sobre `Quantity × Price`.** Con
    cantidad 1 no se nota; con 0.50 la diferencia fue 10.63 contra 21.25 y el
    total se iba a 173.88 con `success:true`. Es la misma aritmética que tu
    propuesta tiene que cuadrar.
  - **El asiento no se manda: ADM lo deriva** (débito a la cuenta de cada línea,
    débito a ITBIS Operativo, crédito a Cuentas por Pagar). Mandarlo descuadra.
  - **El `Reference` de una factura es el número PROPIO del suplidor**
    (`extraccion.numero_factura_suplidor`), NO el NCF. Está poblado en las
    1050/1050 facturas del libro. Registrar una factura de proveedor **no emite,
    ni firma, ni declara** ante DGII; el e-CF se manda igual que un B01.
  - **La lectura de vuelta es por UUID y no es opcional**: el POST devuelve solo
    el UUID y el número humano (`FP########`) sale del readback. Pasarle un DocID,
    un NCF o una referencia devuelve *otro documento* con `success:true` — por eso
    `leer_adm{documento}` se pide por UUID y se comprueba el `ID` devuelto.
  - **Registrar no se reintenta a ciegas**: no hay clave de idempotencia, un
    reintento crea una segunda factura, y revertir en ADM **borra** el documento
    (no lo anula). Ante la duda se cuenta primero.
  - **Sin adjunto la factura queda sin respaldo**, y la fila no llega a
    `registrada` sin su DocID: lo impide el CHECK de la base. Las cuatro primeras
    facturas (2026-08-03) quedaron registradas en ADM con `registrada` = 0 porque
    ese renglón no existía en ninguna capa del sistema, y la mesa las mostró
    pendientes PARA SIEMPRE. Hoy ese cierre es de la pieza que registra: si ves
    una fila así, es un diagnóstico para contar, no algo que vos destrabes.

- **`rechazada`**: evento `nota` reconociéndolo, respondiendo a lo que él dijo
  («Entendido, la descarto y no va a ADM»). Sin libro: un rechazo no registra
  nada. **Esta rama NO aplica si el trabajo es tipo `criterio`** — ese caso lo
  manda la sección «Si el trabajo es tipo `criterio`», y un criterio rechazado
  JAMÁS engendra otro criterio: se muerde la cola.

<!-- adaptado: muere la consulta psql del batch de rechazos — la corre el harness y te
precarga en el prompt los rechazos recientes sin respuesta (contrato §1 y §3.4). Los
filtros y el porqué de cada uno quedan escritos abajo, tal cual; el acuse se escribe con
`responder`. -->
  **Atendé TODOS los rechazos recientes, no sólo el que te nombraron.** El
  poller agrupa: cuando caen varios seguidos —lo normal al rehacer el plan de un
  caso, donde se rechazan tres o cuatro pasos de un tirón— sólo el primero abre
  sesión, y los demás quedan esperando que vos los mires en ésta. Antes se
  despertaba uno por cada uno: cuatro sesiones de LLM que llenaban el cupo y
  dejaban el trabajo de verdad haciendo cola detrás.

  Ya los tenés precargados: los `rechazada` de los últimos 15 minutos que todavía
  no respondiste, sin los que cerró el cron por comprobante fiscal.

  El `not exists` es lo que evita el bucle: trae sólo los que todavía no
  respondiste. El `not (propuesta ? 'superada_por_ncf')` descarta los cierres
  AUTOMÁTICOS del cron de conciliación (una suelta superada por su comprobante
  fiscal): ahí no hay humano que te haya dicho nada, no hay porqué que guardar
  como criterio, y contestarle a una máquina es puro ruido en el hilo. Contestá cada uno con su `nota`, y si varios comparten el motivo
  —el plan entero se rehizo— alcanza con un criterio, no con cuatro iguales.

<!-- adaptado: el INSERT a mano de la fila `tipo='criterio'` pasa a la tool
`proponer_criterio`, que ya trae las cuatro reglas en el schema y NO tiene campo
`archivo` (contrato §2.5). El carril, la promesa de la pantalla y la prohibición de
citar borradores quedan igual. -->
  **Y si explicó el porqué, esa explicación es un criterio negativo — mismo
  carril, ningún atajo.** La pantalla se lo prometió al aprobar el rechazo («si
  explicás el porqué, el contable lo guarda como criterio»), así que no puede
  terminar en un archivo de memoria: los tres que hay están en `borrador` y un
  borrador no es precedente ni se cita jamás. Usá `proponer_criterio` igual que en
  la rama `respuesta`, con el enunciado en negativo («no proponer gastos de
  <comercio>, RNC <rnc>: son personales») y el alcance acotado a ese comercio.

<!-- adaptado: muere el `update ... estado='analizando'` por psql — el retome es el claim del
harness al llegar la respuesta (`esperando_respuesta`/`propuesta`/`error` → `analizando`,
contrato §1 y §3.4). La lápida de los estados de origen queda escrita abajo, tal cual. -->
- **evento `respuesta`**: el humano te está contestando o corrigiendo. La fila ya
  la retomó el harness a `analizando` cuando llegó la respuesta
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

<!-- adaptado: muere el INSERT por psql — la fila de criterio la abre la tool
`proponer_criterio{titulo, enunciado, alcance, sosten}`; el tipo, el origen y el
`origen_trabajo` los pone el harness, `reglas` es un array de UN elemento por schema y el
campo `archivo` NO EXISTE en la firma (contrato §2.5). Las cuatro reglas de abajo quedan
enteras: ahora son schema, no memoria. -->
  Cuando SÍ es criterio, llamá `proponer_criterio` y seguí con lo tuyo — la
  ratifica el dueño, no vos. Va UNA regla, con su `titulo` (qué decide, en una
  línea), su `enunciado` (la regla con el hecho que la sostiene), su `alcance`
  (hasta dónde vale: este proveedor, esta cuenta, esta empresa) y su `sosten`
  (cuántos documentos del histórico lo respaldan, o «palabra del dueño»).

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

<!-- adaptado: muere el insert del evento por psql — el marcador lo escribe `responder`
(`criterio: 'si'`, o `'no'` con su `motivo_no`), y es obligatorio justo en este carril: el
de correcciones y rechazos explicados (enmienda NORMATIVA 5). -->
  **Y cerrá siempre con el marcador**, generalice o no — es lo que vuelve
  auditable el carril: si un día hay que revisar qué correcciones se perdieron, se
  buscan los hilos sin marcador. `responder` con `criterio: 'si'` cuando lo
  propusiste; con `criterio: 'no'` y su motivo cuando corrige el dato de este
  documento y no la regla.

