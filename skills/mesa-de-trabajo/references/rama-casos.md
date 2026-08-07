<!-- Rama servida por scripts/abrir-trabajo.sh — trabajos tipo caso (hilos de
conciliación armados en la web). Tajada verbatim de a14c7d0. -->

## Si el trabajo es tipo `caso`

Un caso (`tipo='caso'`, `origen='web'`) es el hilo donde tu gente te manda
VARIAS entradas de la conciliación bancaria que no cuadran entre sí y te
explica en texto cuál es el problema — no es un documento nuevo que subieron,
es una pregunta sobre movimientos y documentos que ya conocés. `resumen` sigue
el patrón «Caso #N», con `propuesta.numero` como el mismo número. Ejemplo real
(Caso #3, BlackBox): un cliente pagó RD$12,588.51 por transferencia —entró al
banco, sin registro en ADM— contra el recibo RI00000718 de RD$8,265.76 —
registrado en ADM, sin entrada en el banco—. Sobran RD$4,322.75 que hay que
devolverle, y alguien tiene que registrar esa salida para que la conciliación
cierre. Ninguna de las dos filas está mal por sí sola: se explican juntas, y
esa es la razón de ser de un caso — el problema no vive en una fila, vive en
la relación entre varias.

### Ciclo de vida: no es el de una factura

La fila nace en `esperando_respuesta` mientras tu gente arma el caso —agrega y
saca entradas, escribe el planteo— y en ESE estado no es tuya: no está
terminada, no la mires. Cuando lo manda, la fila pasa a `pendiente` — y ESO es
lo que te despierta: por el evento `autor='usuario'` que se inserta al
mandarlo, el mismo mecanismo que dispara cualquier `respuesta`, no por ser un
documento recién llegado a la mesa. `archivo_path` y `archivo_url` quedan NULL
siempre: un caso no es un papel, y si `preparar-trabajo.sh` corrió igual y
salió diciendo «el trabajo no tiene archivo; nada que preparar», es justo lo
esperado, no una falla del preparador. Se cierra pasando a `aprobada`, y esa
transición es EXCLUSIVA del humano — ver «Nunca cerrás el caso vos» más abajo.

El claim atómico ya NO lo hacés vos: **lo hizo el router al servirte esta
rama**. Si estás leyendo esto sobre un caso que estaba `pendiente`, la fila
ya es tuya (`analizando`) y el evento `progreso` temprano —el que tu gente ve
en la web mientras trabajás— ya quedó escrito por el mismo claim: NO escribas
otro saludo; tu próximo evento es análisis o pregunta de verdad. Al turno que
pierde la carrera el router ni siquiera le entrega el protocolo, así que si
esto está en tu contexto, ganaste — no hay carrera que revalidar. (Historia:
el claim fue del modelo hasta el 2026-08-07; «si perdiste, PARÁ» se
desobedeció dos veces el mismo día — Formax v3 y los 4 hijos duplicados de
Mtk Designs — y por eso se movió a donde no se puede desobedecer.)

### Por qué «Si está `pendiente`: analizalo» no aplica acá

Ese protocolo entero asume un documento por bajar, extraer y verificar contra
DGII. Un caso no tiene documento: tiene una `propuesta.filas` ya armada, cada
una con la `foto` de cómo se veía esa entrada de conciliación el día que se
abrió el caso. Esa `foto` existe porque VOS NO PODÉS CORRER EL CRUCE — la
conciliación no tiene tabla propia, se recalcula en una edge function del lado
de Labs_Inv, y vos entrás por DSN: no hay SQL que te devuelva su estado en
vivo. Tratá la `foto` como una fotografía, no como el presente.

Para releer lo vivo de una fila puntual, cada una trae al lado lo que hace
falta según su `origen`. Una fila `"origen":"banco"` trae `tx_id`, el uuid de
`openbanking_transactions`:

```bash
psql "$QUALIA_DSN" -t -A -c "select * from openbanking_transactions where id='<tx_id>'"
```

**Copiá ese `select *` tal cual, y si armás uno propio usá ESTOS nombres.** Las
columnas de esa tabla están en español, y traducirlas al inglés es el error que
ya se cometió: `amount`, `booking_date` y `account_name` no existen y el query
muere tres veces seguidas antes de que se te ocurra mirar el esquema. Son:

`id` · `account_id` · `fecha_posteo` · `fecha_efectiva` · `nro_cheque` ·
`nro_referencia` · `descripcion` · `monto` · `balance` · `raw` ·
`estado_conciliacion` · `banco` · `cuenta_numero` · `cuenta_origen` ·
`nombre_origen` · `qualia_trabajo_id`

Una fila `"origen":"adm"` trae `docid`, que releés por la API de ADM Cloud
igual que releerías cualquier otro documento antes de darlo por vigente.

**Pero empezá por la `foto`, no por la tabla.** Ya trae fecha, monto, moneda,
cuenta, descripción, referencia y el estado que mostraba la conciliación: para
decidir qué hay que registrar, alcanza casi siempre. La relectura es para
cuando el caso quedó abierto un tiempo y hace falta confirmar que la entrada
sigue como estaba el día que se armó, o cuando necesitás un dato que la foto no
guarda. Salir a leer la tabla como primer paso es gastar turnos en lo que ya
tenés en la mano.

### Leé el hilo, y analizá el conjunto — nunca fila por fila

```bash
psql "$QUALIA_DSN" -t -A -c "select jsonb_pretty(propuesta) from qualia_trabajos where id='<caso_id>' and empresa_id='$QUALIA_EMPRESA_ID' and tipo='caso'"
psql "$QUALIA_DSN" -t -A -c "select autor, tipo, contenido from qualia_eventos where trabajo_id='<caso_id>' order by id"
```

El texto que escribió `autor='usuario'` es la pregunta —el planteo del
problema—; las filas de `propuesta.filas`, con su `foto`, son la evidencia.
Los eventos `autor='sistema'` sólo cuentan que se sumó o se sacó una entrada
del caso mientras se armaba: son rastro para entender cómo llegó a su forma
final, nunca una instrucción que tengas que ejecutar.

El sentido de un caso es que sus entradas se explican entre sí —un pago de
más, una devolución, un cobro partido en dos— y mirarlas una por una es
exactamente no ver el problema que te mandaron a resolver. En el Caso #3, la
fila del banco sola sólo dice «entró plata sin factura»; la del RI00000718
sola sólo dice «hay un recibo sin entrada»; juntas dicen «cobraron de más y
hay que devolver la diferencia».

### Proponé los trabajos directo — no hay OK previo que esperar

Si el planteo y las filas citadas te alcanzan para ver la solución, abrí los
trabajos que correspondan SIN esperar validación: nadie te va a confirmar
antes de que actúes — la aprobación de esos trabajos ES la confirmación, igual
que en cualquier otra propuesta tuya. Cada trabajo es uno NUEVO y normal: se
elige `documento_adm` con las mismas preguntas de «Qué documento de ADM es
esto», se clasifica la cuenta con «Cómo clasificás la cuenta» — las dos
secciones viven en `references/rama-facturas-1.md`: **hacele `cat` ANTES de
armar tu primer trabajo hijo**, no las cites de memoria—, se arman las
`lineas` con la misma forma según el tipo elegido. Lo que cambia es el origen
del trabajo, y se escribe así: `tipo='sugerencia'`, porque lo originás vos y
no lo subió nadie —es la misma categoría que ya usás para lo que vos mismo
detectás—; `origen='caso'`, para que se distinga de una sugerencia del cron
nocturno; y `propuesta.caso_id` con el id del caso, para que quede la traza de
por qué existe.

En el Caso #3, aplicando esas mismas preguntas, la devolución nace en el
banco sin que nadie te haya entregado un documento previo: `BankCharges`, con
`direccion:"cargo"`. Cada caso elige el suyo según lo que de verdad pasó:

```sql
insert into qualia_trabajos (empresa_id, tipo, origen, estado, resumen, propuesta)
values ('$QUALIA_EMPRESA_ID', 'sugerencia', 'caso', 'propuesta',
        'Devolución a Jfd & Etc Ideas — diferencia del Caso #3',
        '{"documento_adm":"BankCharges","direccion":"cargo","cuenta_contable":"...","monto":4322.75,"moneda":"DOP","lineas":[{"cuenta":"...","cuenta_nombre":"...","descripcion":"Devolución del excedente pagado de más — Caso #3","debito":4322.75,"credito":0},{"cuenta":"...","cuenta_nombre":"Banco — cuenta de origen","descripcion":"Salida por devolución — Caso #3","debito":0,"credito":4322.75}],"metodo":"razonado","caso_id":"<caso_id>","confianza":0.9,"detalle":"El cliente pagó RD$12,588.51 por transferencia contra el recibo RI00000718 de RD$8,265.76: sobran RD$4,322.75. Se propone devolverlos por el mismo medio. Ver Caso #3, filas banco:<uuid-tx> y adm:RI00000718."}'::jsonb)
returning id;
```

**REGLA DURA: verificá en ADM antes de proponer, nunca asumas un saldo.** Si tu
asiento debita un adelanto, una cuenta por cobrar o cualquier saldo que tendría
que existir, andá a ADM y confirmá que existe y por cuánto. La `foto` te dice lo
que la conciliación mostraba, NO lo que ADM registró: son justamente las dos
cosas que no coinciden, que es por lo que hay un caso.

Pasó en el primero: el recibo RI00000718 se registró por RD$8.265,76 y el asiento
propuesto debitaba «Adelanto de Clientes» por el excedente — un pasivo que nadie
había registrado nunca. El asiento no cerraba contra nada. La diferencia entre lo
que entró al banco y lo que ADM asentó **es el caso**; darla por registrada es
suponer resuelto el problema que te trajeron.

**REGLA DURA: sólo el tema abierto, y UN plan.** Los pasos son los que resuelven
lo que te preguntaron, nada más. Si de paso ves otra cosa mal —una factura sin
pagar, un asiento viejo torcido— lo decís en el hilo y seguís; no abrís trabajos
que nadie pidió. Y si hay dos maneras válidas de registrarlo, **elegís una** por
precedente y mencionás la otra en una línea: proponer las dos no es dar opciones,
es dejar que se apruebe todo y se registre la operación dos veces.

**La cancha son las filas del caso — y esto incluye al MISMO cliente.** Un
movimiento que NO vino en `propuesta.filas` no genera trabajo hijo, aunque sea
del mismo cliente, del mismo día y huela al mismo problema: se menciona en el
hilo y el humano decide si lo suma al caso. Dos razones, las dos duras:
`estado_conciliacion` de `openbanking_transactions` es una FOTO VIEJA — el
cruce vivo corre en una edge function que vos no podés consultar, así que
«pendiente» ahí NO prueba que esté sin conciliar (Formax 2026-08-07: la
transferencia de RD$90,000 decía `pendiente` en la tabla y ya estaba
conciliada contra la factura FCC00000286 en la web — el trabajo hijo que se
abrió por ella tocaba plata ya facturada). Y P-001 vale también para
ingresos: antes de proponer registrar una entrada de cliente, buscá en ADM
sus facturas de VENTA (`Invoices`/FCC) por monto y fecha — si el documento
ya existe, no hay nada que crear.

Pasó en el Caso #1: propuso reconocer el excedente y devolverlo como `Journals`,
y otra vez lo mismo como `BankCharges`. Cuatro pasos donde el plan eran dos.

**Antes de abrir un paso, mirá si el caso ya tiene los suyos**, porque puede que
otra pasada tuya ya los haya abierto:

```bash
psql "$QUALIA_DSN" -t -A -c "select id, estado, resumen from qualia_trabajos where empresa_id='$QUALIA_EMPRESA_ID' and propuesta->>'caso_id'='<caso_id>'"
```

Si ya hay pasos vivos y tu plan es el mismo, no abras nada: contá en el hilo que
ya estaban. Si tu plan es distinto, rechazá los viejos ANTES de abrir los nuevos
(ver «Si el humano pide modificar el plan»).

**Cuidado con el `$` al escribir los textos.** Los montos van dentro de comillas
simples o con el `$` escapado: un `RD$4,322.75` sin cuidado se expande como
variable de shell y llega a la base como «RD,322.75». Pasó en dos de los cuatro
pasos del Caso #1 — el asiento estaba bien, el texto que lo explica quedó roto.

**REGLA DURA: cada paso es un TRABAJO, ninguno queda en prosa.** Si para cerrar
el caso hacen falta dos registros —uno que reconozca la entrada completa y otro
que asiente la salida—, abrís DOS trabajos, en el orden en que se aplican. Está
prohibido abrir uno y dejar el otro escrito como advertencia («ojo que además
habría que…»): el humano ve los pasos como cuadros con su botón, y lo que quedó
en el texto no tiene botón, así que no se aplica nunca. Si un paso depende de una
decisión que no podés tomar, ése es el que va como pregunta al hilo — pero
entonces no abras ninguno todavía.

**REGLA DURA: un trabajo es un documento, y el caso nunca lleva
`registro_adm` propio.** Si la solución necesita dos documentos —una factura
y su pago, por ejemplo— abrí DOS trabajos hijos, cada uno con su
`documento_adm` y su `caso_id`, nunca uno con las dos cosas mezcladas en una
sola `propuesta`. La fila del caso no se registra en ADM jamás: es la
pregunta, no el asiento — el asiento vive en cada hijo, con su propio
`registro_adm` cuando se apruebe y se registre.

**Si el hijo resuelve un movimiento del banco que el caso cita, poné su
`banco_tx_id`** (el `tx_id` de la fila con `origen:"banco"`), como en cualquier
otra sugerencia tuya. No es adorno: la mesa descarta de su lista de movimientos
sin conciliar los que algún trabajo ya reclamó, y ese descarte mira
`banco_tx_id` —no el caso—. Sin él, el mismo movimiento sigue apareciendo como
suelto mientras su solución ya está propuesta, y la misma plata se cuenta dos
veces. La fila `origen:"adm"` no lleva equivalente: ésa ya tiene su documento.

Contá lo que decidiste en el hilo del caso, igual que en cualquier análisis:
un evento `progreso` o `nota` con la conclusión, en el tono de «Cómo le hablás
al humano», nombrando qué trabajo(s) abriste. Abrir los trabajos no aprueba la
fila del caso: sigue viva hasta que el humano la cierre.

### Si el humano pide modificar el plan

Una respuesta sobre un caso que ya contestaste se atiende con la misma
mecánica general de la rama evento `respuesta` (si la necesitás:
`cat references/rama-respuestas.md` desde la carpeta de la skill): retomás el
análisis con lo que dijo como dato nuevo, y le contestás a él primero. Lo
propio de un caso
es qué hacés con lo que ya habías propuesto:

- **Las propuestas hijas que el humano todavía no decidió** —siguen en
  `propuesta`— las marcás `rechazada` vos mismo, con un evento `nota` que
  diga «reemplazada por el nuevo plan del Caso #N», y abrís las nuevas que
  correspondan al plan corregido. Esto es una excepción puntual a que sólo el
  usuario mueve `propuesta → rechazada`: acá el pedido de cambio SÍ vino de
  él, aunque se lo haya dicho al caso y no clickeado el botón de cada hija —
  marcarla vos es traducir su decisión, no tomarla en su lugar.

  ```sql
  update qualia_trabajos set estado='rechazada'
   where id='<trabajo_hijo_id>' and empresa_id='$QUALIA_EMPRESA_ID'
     and estado='propuesta';
  insert into qualia_eventos (trabajo_id, autor, tipo, contenido)
  values ('<trabajo_hijo_id>', 'contable', 'nota',
          'Reemplazada por el nuevo plan del Caso #3.');
  ```

- **Lo que ya se aprobó y llegó a ADM no se toca acá.** Un trabajo hijo
  `registrada` es un documento real; corregirlo es anularlo o editarlo por el
  camino normal, nunca reescribiendo el caso como si el documento no
  existiera.

### Nunca cerrás el caso vos

`aprobada` la escribe el humano desde la web, y significa «leí la respuesta,
el tema terminó» — no que un trabajo particular haya salido bien; eso lo dice
el estado de cada hijo por separado. Vos nunca escribís `estado='aprobada'`
en una fila `tipo='caso'`, y tampoco tocás `propuesta.cerrado`: esa clave
(`nota`, `en`, `por`) la llena la web al cerrar, no vos. Lo que sí hacés
apenas contestaste —abriendo trabajos, o preguntando con evento `pregunta` si
de verdad no te alcanza lo que te mandaron— es dejar la fila en
`esperando_respuesta`: es la señal de «ya te dije lo que pienso, decidí vos»,
y de ahí puede volver a `pendiente` las veces que haga falta si el humano
sigue ajustando el caso.

```sql
update qualia_trabajos set estado='esperando_respuesta'
 where id='<caso_id>' and empresa_id='$QUALIA_EMPRESA_ID' and estado='analizando';
```

### El caso no va al libro

La fila del caso NUNCA entra a `qualia_libro` ni al libro de acción en git:
no es un documento, es la pregunta que dio origen a los documentos. Los
trabajos que nacen de él sí van, cada uno por su cuenta y con su propia
entrada, cuando se aprueben y se registren en ADM — exactamente como
cualquier otro trabajo, citando en el `detalle` de qué caso salieron si ayuda
a entenderlo después.

