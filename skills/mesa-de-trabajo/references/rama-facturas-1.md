<!-- Rama servida por scripts/abrir-trabajo.sh — primera mitad del análisis de un
pendiente (dossier, documento, extracción, DGII, duplicados). La segunda mitad la
sirve el mismo router con `parte2`; no la busques a mano. Tajada verbatim del
SKILL.md pre-partición (a14c7d0); historial en git. -->

## Si está `pendiente`: analizalo

### Paso 0 — si el hilo ya tiene voz del humano, no es un análisis nuevo

Antes de nada, mirá si alguien ya te dijo algo sobre esta fila:

```bash
psql "$QUALIA_DSN" -t -A -c "select id, tipo, contenido from qualia_eventos where trabajo_id='<trabajo_id>' and autor='usuario' order by id desc limit 5"
```

Si hay una respuesta del usuario posterior a una propuesta tuya, **estás por
repetir un análisis que ya fue corregido**: cargá la rama «evento `respuesta`»
con `cat references/rama-respuestas.md` (desde la carpeta de la skill) y tratá
lo que dijo como dato, no arranques de cero. El
motivo del webhook puede llegar equivocado —el poke es un puntero y la base es
la única verdad— y **el dossier del preparador NO contiene eventos**: si el
documento no cambió te lo entrega idéntico al de antes de la corrección, así que
leerlo te devuelve exactamente el razonamiento que el humano acaba de rechazar.

### El dossier del preparador — mirá esto ANTES de trabajar

Antes de despertarte, un preparador determinista (`preparar-trabajo.sh`, corre
en el sidecar, sin LLM) pudo dejar el trabajo masticado en
`/tmp/mesa/<trabajo_id>/dossier.json`. El claim atómico (paso 1, abajo) sigue
siendo SIEMPRE tu primer movimiento — y tu primer movimiento es UN comando,
no cinco (cada llamada tuya re-paga el prompt entero contra la cuota):

```bash
bash /opt/data/memoria/scripts/leer-contexto.sh <trabajo_id> --claim
```

Hace el claim y te imprime TODO junto: la fila, el hilo, el rastro del
proponedor determinista si lo hubo (`clasificacion.json`: por qué el camino
sin LLM NO propuso — ése es tu punto de partida, no lo re-descubras), el
dossier y el precedente del proveedor ya buscado. Si la primera línea dice
`CLAIM: perdido`, PARÁ sin escribir nada, como siempre. En las ramas donde no
hay claim (`accion_usuario`, `escribir_libro`), corrélo SIN `--claim`.

- **Si existe**: el documento YA está local en `archivo.path` (convertido a jpg
  si era HEIC, con `texto.txt` si hubo texto), y la extracción, la verificación
  DGII y el chequeo de duplicados YA están hechos. **SALTATE los pasos 2-5** y
  andá DIRECTO al precedente y la propuesta (pasos 6-8). **Tu PRIMER movimiento
  tras leer el dossier es UN evento `progreso` corto anunciando SOLO tu plan y
  tu juicio** — sin repetir proveedor/monto/DGII, que ya están en el evento del
  preparador — p.ej. «Este comprobante no pasó la verificación de DGII, así
  que no sirve como crédito fiscal: te preparo la propuesta para registrarlo
  como gasto no admitido» o «A este proveedor siempre lo registramos como
  combustible; te armo la propuesta igual que las anteriores». Corto pero
  hablado, con el tono de la sección «Cómo le hablás al humano».
  Sin ese aviso la mesa queda muda minutos y el humano no sabe si estás vivo.

  **NO repitas lo que el dossier ya hizo** (medido 2026-08-02: re-hacer la
  visión + re-consultar DGII quemó ~80s de una corrida que ya los traía):
  - `extraccion` con campos y confianza alta → esos son tus datos. Verificá
    coherencia contra `texto.txt` o contra la aritmética, NUNCA re-leyendo la
    imagen con `vision_analyze`; si algo de verdad no cierra, aplicá la regla
    de abajo (patrón conocido → renglón inferido; sin patrón → preguntá).
    **La aritmética correcta** (corrección del dueño, 2026-08-02): el ITBIS es
    un porcentaje de la BASE GRAVADA, JAMÁS del total. La verificación es
    `base + itbis + exentos + propina/cargos == monto`.

    **La tasa NO se asume: se despeja y se compara.** Son tres las legales —
    18% general, 16% reducida (café, cacao, azúcar, mantequilla, yogurt: art.
    343) y 0%/exento. Probá las que apliquen contra la cabecera: para cada una,
    `base = itbis/tasa` y `exentos = monto - itbis - base`. La lectura buena es
    la que deja `exentos` en CERO, o en renglones que de verdad leíste del
    papel. **Si tenés que inventar un renglón exento para que cierre, esa tasa
    está mal** — probá la otra ANTES de proponer.

    Pasó el 2026-08-04 con la FP00001120 (Carrefour, café): dividir por 0.18
    dio base 287.33 y dejó 35.90 sueltos, que se fueron a un renglón «Productos
    exentos (no individualizados por el preparador)». Al 16% —la tasa del
    café— la misma cabecera cierra sola: base 323.23, cero exentos. Se registró
    en ADM con un 18% que el papel nunca dijo, reclamando un crédito fiscal de
    más. Un renglón exento que sale de una resta y no del documento es la firma
    de este error: si lo estás escribiendo, pará y probá la otra tasa.

    **Restaurantes: los cargos son DOS, siempre** (regla del dueño): ITBIS 18%
    + propina legal 10% (Ley 16-92), ambos impresos. Esperalos de ENTRADA como
    estructura del documento — si solo ves uno, el otro existe y está en los
    números; no lo "descubras" por descuadre ni lo verifiques dos veces. Que
    `monto != base*1.18` NO es incoherencia — es la anatomía normal (y suele
    haber renglones exentos además).
    **Y si NO cuadra, en este orden (regla del dueño, 2026-08-02: lo obvio se
    resuelve a la primera, sin releer y sin preguntar):**
    1. Si el dossier trae `propina` (capturada o `propina_inferida`: el prep
       ya infiere la propina cuando el descuadre calza exacto con el 10% de
       la base) → proponé DIRECTO con ese renglón, explicándolo en `detalle`.
    2. Si la diferencia calza vos mismo con un patrón conocido de este
       mercado (propina 10% de la base ±1 peso, un ISC de bebidas, un
       recargo impreso) → renglón inferido + explicación en `detalle`, y
       proponé. La aprobación del humano ES la confirmación.
    3. SOLO si la diferencia no calza con ningún patrón: NO reeleas la
       imagen — PREGUNTALE al humano con evento `pregunta` +
       `esperando_respuesta`, con la diferencia exacta y tu mejor hipótesis.
       Él tiene el documento a un click. Con su respuesta, cerrás.
  - `dgii` del dossier → va a tu propuesta TAL CUAL. No re-consultes DGII.
    EXCEPCIÓN: un `dgii` con estado "no verificable" cuenta como AUSENTE —
    intentá el paso 5 vos (desde `texto.txt`, sin visión); si tampoco podés,
    queda "no verificable" con el motivo.
  - `duplicados` del dossier → decidís con eso. No re-busques.
  - `extraccion.items` (fotos): esa ES tu tabla de líneas — mapeale la cuenta
    a cada item y armá la propuesta con ellos, SIN re-leer la imagen. Si
    `extraccion.aritmetica.cuadra` es true, no busques renglones que falten;
    si es false, aplicá la regla de arriba: pregunta al humano con la
    diferencia exacta — nada de relecturas.
  - **La cuenta contable**: seguí la sección «Cómo clasificás la cuenta»
    (más abajo — aplica CON y SIN dossier).

  Después trabajá. Los campos que vengan AUSENTES del dossier son lo que el
  prep NO pudo hacer: completá SOLO esos con el protocolo normal. Con campos
  presentes NO hay relectura de imagen bajo NINGUNA condición — confianza
  media/baja, montos que no cierran o razón social que no casa se resuelven
  con las reglas de arriba (aritmética sobre la base gravada; y si de verdad
  no cuadra, PREGUNTA al humano), jamás con `vision_analyze`. El `dgii` del dossier va a tu propuesta como siempre
  (nunca lo dejes vacío), y si `duplicados` trae filas, decidís vos con la
  regla del paso 4 — el prep nunca marca error por duplicado. El prep ya dejó
  un evento de progreso con el resumen: no lo repitas, contá solo tu juicio.

- **Si NO existe** (o no parsea, o su `row_updated_at` no coincide con el
  `updated_at` que leíste ANTES del claim — ojo: tu claim cambia el
  `updated_at` de la fila, por eso la comparación es contra el valor
  pre-claim del primer SELECT, jamás contra el actual): protocolo completo,
  pasos 2-9, como siempre.

### Qué documento de ADM es esto: lo decide el ROL del hecho, no el papel

Primero el documento, después la cuenta: `documento_adm` no es una etiqueta, es
el router — `poller.sh` elige con qué script registrar según ese campo, y la
forma de tus `lineas` depende de él.

**REGLA DURA: el NCF NO decide el tipo de documento. Ni su presencia ni su
ausencia.** Medido sobre el histórico de esta empresa: **45 de las 1.109
facturas de proveedor NO tienen NCF** —gobierno, exterior, entidades estatales,
con las 10 liquidaciones de la DGA entre ellas— y **51 de los 159 cargos
bancarios SÍ lo tienen**, todos e-CF E31 que el banco emite por sus propias
comisiones. La heurística falla en las dos direcciones y tiene 96
contraejemplos en tu propio corpus. Que el RNC impreso sea el de BlackBox
tampoco decide nada: es normal en el comprobante de un pago propio.

El NCF decide **una** cosa, y recién DESPUÉS de que estas cinco preguntas
eligieron el rol: si el documento corrige a otro. Es una subdivisión dentro de
la pregunta 4, no una excepción al orden — ver la nota de crédito ahí.

Preguntá en este orden; la primera que dé SÍ, gana:

1. **¿El movimiento nació en tu estado de cuenta, sin que nadie te entregara un
   documento previo, Y la contraparte es el BANCO?** (comisión, cargo por
   cheque, interés, sobregiro, cashback, y los impuestos que el banco te
   descuenta como agente de retención: Ley 30-26 2x1000, el 0,15% de cheques,
   el 1% Norma 07-19) → **`BankCharges`**, con `direccion` explícita
   (`cargo` = sale plata, `credito` = entra).
   **Que el beneficiario final sea la DGII NO lo saca de acá**: 51 de los 92
   cargos que esta mesa ya registró bien son exactamente eso. El corte no es
   quién cobra al final, es que el hecho nació en la cuenta y no hubo papel que
   recibieras y decidieras pagar.

   **Y antes de contestar esta pregunta: ¿la descripción dice algo?** En Banco
   Santa Cruz, `Nota De Debito` a secas no es un concepto — es lo que el banco
   escribe cuando no describe nada, y las 13 del histórico tienen el texto
   idéntico. Con eso no se clasifica: se busca el monto y la fecha en el espejo
   antes de proponer, porque dos de las diez que estaban en la mesa al
   2026-08-14 ya estaban registradas. **Con esa descripción, empezá por C-005 de
   `criterios.md`, no por esta pregunta.**

   **Las dos condiciones son necesarias, y la segunda es la que se olvida.** Un
   `BankCharges` es lo que el BANCO le hace a tu cuenta: él cobra, él devuelve,
   él acredita. Si del otro lado hay un cliente, un inquilino o cualquier
   tercero que te mandó plata, la pregunta 1 **NO la gana** — que haya entrado
   por ACH sin que nadie te entregara un papel no lo convierte en un hecho del
   banco: el banco ahí es el caño, no la contraparte. Registrarlo igual lo
   archiva bajo «Bancos → Cargos Bancarios», que es donde un contador va a
   buscar comisiones, y ahí esa plata no es lo que el módulo dice que es.

   **Plata que ENTRA de un tercero: hoy no tenés documento para eso — pará y
   preguntá.** El rol del agente niega toda emisión AR (`CashInvoices`,
   `CreditInvoices`, notas de crédito de cliente) y también `Deposits`; ver
   `docs/plan-encendido-escritura.md` §1.1. No hay vuelta que darle: no la
   disfraces de `BankCharges` en crédito ni de `Journals`. Abrís un evento
   `pregunta` con el movimiento, el tercero y el tratamiento que corresponde, y
   que el humano lo registre él. Proponer `CashInvoice` es peor que no proponer
   nada: el router de `poller.sh` no conoce ese tipo, así que la fila se aprueba
   y no se registra nunca — queda viva simulando que alguien la atendió.

   **Y si el candado de `Journals` te frena, ése NO es tu permiso para
   re-etiquetar.** El `hint` del trigger sugiere `BankCharges`, y esa sugerencia
   vale para plata que SALE hacia el banco, no para plata que entra de un
   tercero. Un candado que te frena está diciendo «el tipo está mal elegido» o
   «esto no lo registrás vos», nunca «buscá otro tipo que pase». Pasó el
   2026-08-07 con el depósito en garantía de Formax: el contable escribió en su
   propio `detalle` que C-002 mandaba `Journals`, que el sistema lo bloqueaba, y
   que por eso iba como `BankCharges` crédito. Se aprobó y salió el CB00000258 —
   un depósito de un inquilino asentado como cargo bancario.
2. **¿La plata salió de una cuenta tuya y entró a otra cuenta tuya?** — la
   tarjeta corporativa también es cuenta tuya: 203.10 y 203.11 son cuentas de
   caja en ADM aunque su código viva en el pasivo → **`BankBankTransfers`**.
3. **¿Estás cancelando una obligación que ADM YA tiene registrada** (una factura
   con saldo abierto)? → **`BillPayments`** (prefijo `PP`, módulo BANCO, no
   Compras). No crea gasto: debita Cuentas por Pagar y acredita la caja. El
   saldo lo dice SOLO `/api/AP`.
   **Y si la respuesta es «sale plata pero NO hay factura registrada que
   cancelar», no bajes a la 4: es la 3-bis.** → **`AccountPayments`** (prefijo
   `PC`, módulo BANCO). Es con lo que Blackbox le paga a la **DGII** —anticipo
   de ISR, ITBIS, IR-3, retenciones— y también a la **TSS** y al **INFOTEP**
   (PC00000335 y PC00000336 de julio). No cancela ninguna factura: no lleva
   `Documents[]`, lleva las dos patas del asiento en `Accounts[]` —crédito al
   banco, débito a la cuenta del impuesto— y el `Items[]` con la contrapartida.
   Doctrina: `nucleo-contable/doctrina/pagos-a-cuenta.md`.

   **Por qué esta pregunta existe desde el 2026-08-14 y no antes:** no estaba, y
   sin ella el anticipo de ISR —un hecho mensual, previsible y con doctrina
   ratificada— salió propuesto de cuatro formas con tres tipos de documento
   distintos en seis días. Y ojo con la trampa que hace caer en la pregunta 1:
   el pago de un impuesto SALE del estado de cuenta, pero **la contraparte es la
   DGII, no el banco**, así que la 1 no lo gana. El banco es el caño.

4. **¿Un tercero te entregó algo, o te liquidó una obligación, y de eso hay un
   documento que recibiste?** → **`VendorBills`**, tenga NCF o no lo tenga, y
   sea quien sea el tercero. **Que sea el Estado no cambia nada: la DGA es un
   proveedor** —10 de 10 liquidaciones históricas, FP00000049 … FP00001018—, y
   el banco también lo es: es el proveedor #1 de esta empresa con 203 facturas.
   «Banco» y «proveedor» NO son excluyentes.

   **4-bis · Lo único que SACA un hecho de esta pregunta: el bien que se
   transfiere ante notario.** Si lo que entró es un **inmueble** —local,
   terreno, apartamento, nave— o cualquier bien cuya propiedad se pasa por
   **acto de venta notarial y matrícula** en vez de por factura, no es una
   `VendorBills`: es un **`Journals`** que debita la `160.xx` y acredita `201`
   Cuentas por Pagar DOP, y los pagos que lo saldan van por `AccountPayments`
   (la 3-bis). **No lleva tipo de gasto 606.** Doctrina: **C-007** de
   `criterios.md`.
   Y ojo con el orden: esto **no** es «no tiene NCF, entonces no es factura» —
   la REGLA DURA sigue en pie y la DGA sin NCF sigue siendo `VendorBills`. Lo
   que decide acá es que **la operación no se documenta con comprobante
   fiscal en ninguna de las dos puntas**: no hay NCF que informar, no hay ITBIS
   que adelantar, y el 606 no tiene fila donde ponerla. Si el vendedor SÍ emite
   NCF por el inmueble —una constructora vendiendo de su inventario— vuelve a
   ganar la 4 y es una factura normal.
   **Toda `VendorBills` con RNC entra al 606 por construcción**: elegir ese
   documento acá no es un detalle de archivo, es meter la operación en un
   reporte a la DGII donde no existe. Pasó el 2026-08-15 con el Caso #4 —los
   locales J-11 y J-12, RD$1.725.000,00 cada uno, FP00001152 y FP00001153, con
   el vendedor sin RNC en ADM y las dos facturas sin NCF—; los contables de la
   empresa lo dictaminaron mal y los cuatro documentos se anularon.

   **Y acá adentro, la única sub-pregunta que mira el NCF: ¿ese documento
   CORRIGE una factura anterior** (e-NCF `E34`, NCF tipo 04)**?** →
   **`VendorCreditNotes`** (prefijo `NCP`, módulo Compras), con los precios
   **POSITIVOS** y las mismas cuentas de la factura que corrige. ADM invierte el
   asiento solo: acredita los gastos y el ITBIS, debita Cuentas por Pagar.
   **Nunca** una `VendorBills` con montos negativos: es otro documento y otra
   secuencia fiscal, y ADM no la acepta.
   Poné `ncf_modificado` y `factura_original_docid` de la factura corregida: es
   lo que deja el rastro nota→factura dentro de ADM.
   Esto **no contradice la REGLA DURA**: el NCF no eligió el rol —el rol ya lo
   ganó esta pregunta 4—, sólo elige el documento adentro. Que el orden importa
   lo prueba el `E340000187146`: es la nota de crédito con la que el banco te
   devuelve el 2x1000 que él mismo te cobró, gana en la pregunta 1 y es un
   `BankCharges` con `direccion: credito`, no una `VendorCreditNotes`, aunque su
   NCF diga 34.
5. Si ninguna aplica y el hecho es puro devengo sin caja (nómina, TSS, INFOTEP,
   ISR de empleados) → **`Journals`**. **Es el último recurso, no el cajón de
   sastre**: los asientos quedan FUERA del cruce de la conciliación bancaria a
   propósito. Si tu asiento toca una cuenta 101.xx o 102.xx y no tenés
   precedente citable del MISMO hecho, **pará y preguntá** — el cashback de
   RD$70,84 de la Visa 1877 entró como asiento (ED00000183) y quedó como
   diferencia eterna.

   **Y desde el 2026-08-07 esto ya no depende de que lo recuerdes: la base lo
   rechaza.** El trigger `qualia_trabajos_journal_no_toca_caja` (repo Labs_Inv)
   revienta con `check_violation` cualquier propuesta `Journals` cuyas líneas
   toquen 101.xx, 102.xx o las tarjetas 203.10 / 203.11, y el mensaje del error
   te dice a qué documento va. Si lo ves, no reintentes ni busques la vuelta:
   **el tipo está mal elegido**, casi siempre porque el hecho nació en el estado
   de cuenta y la pregunta 1 ya lo había ganado.

   **El `hint` de ese error tiene un punto ciego: sólo vale si la contraparte es
   el banco.** Te manda a `BankCharges` mirando únicamente de dónde nació el
   movimiento, y para plata que ENTRA de un cliente eso da el documento
   equivocado (ver la pregunta 1). Si el candado te frena y del otro lado hay un
   tercero, la salida no es otro tipo: es un evento `pregunta`.

   El candado se puso porque la regla escrita de arriba no se cumplía sola: de
   los **8 `Journals` que pasaron por esta mesa, los 8 tocan una cuenta de caja**
   y ninguno era de nómina. Siete los rechazó el usuario y el octavo es el
   ED00000183. Cero aciertos en ocho intentos. Lo que decide es el tipo de
   documento contra la cuenta.

   **Y acá hay que ser preciso, porque «la conciliación» son DOS y esta doctrina
   las confundió hasta el 2026-08-14.** La de la mesa —la edge function
   `admcloud-conciliacion-entradas` de Labs_Inv— lee `CashInvoices`,
   `CashReceipts` y `BankBankTransfers` del lado entrada y `BillPayments`,
   `Expenses`, `AccountPayments` y `BankCharges` del lado salida: ahí un asiento
   no entra, y por eso el movimiento aparece «Sin registro en ADM». **La de ADM
   sí lee asientos**: su módulo `BankReconciliations` los cruza con
   `DocType: "JOURNAL"` apuntando con `TransAccountRowID` a la línea exacta que
   toca la cuenta de banco. Verificado el 2026-08-14 sobre 25 conciliaciones: 32
   filas `JOURNAL` conciliadas, entre ellas el ED00000169 de RD$2.497.600
   («Desembolso de préstamo») y el ED00000148 de RD$4.000.000.

   Corolario que corrige lo que decía antes esta misma sección: los precedentes
   ED00000096 / ED00000097 / ED00000127 **sí sirven** —el 127 está conciliado en
   la CCB00000079— y citarlos no es el error. El error es que el hecho nació en
   el estado de cuenta y la pregunta 1 ya lo había ganado. Lo que un asiento
   contra caja rompe hoy es **la pantalla de conciliación de la mesa**, no los
   libros de ADM, y ésa sigue siendo razón suficiente para no proponerlo: pará y
   preguntá.

**«Es del Estado» no es criterio, y la evidencia lo prueba en las dos
direcciones**: la liquidación de aduanas va como factura de proveedor (10 de 10)
y la TSS y el INFOTEP van como asiento (39 `Journals`, ED00000007 …
ED00000181). Decide el rol del hecho, no quién es el tercero.

**Un hecho que salió del banco casi nunca es UN documento: son DOS.** La
liquidación de aduana es la factura (`VendorBills`, acredita Cuentas por Pagar)
y el débito de la cuenta es el pago (`BillPayments`, acredita el banco). De las
10 liquidaciones de la DGA, **9 están saldadas por el centavo exacto** con su
`BillPayments` propio (PP00000034, PP00000129 …) y la décima, FP00001018, sigue
abierta. Si proponés sólo la factura, **decilo en `detalle` nombrando el
`banco_tx_id` del movimiento**: si no, el débito sigue en Sugerencias como
salida sin documento y alguien lo registra otra vez.

**AUTO-CHEQUEO antes de cerrar: la contrapartida delata el tipo.** Releé tu
propio `detalle` y preguntate qué cuenta se acredita.

| `documento_adm` | Qué se acredita | Forma de `lineas` |
|---|---|---|
| `VendorBills` | Cuentas por Pagar — la pone ADM sola, NO la escribas | ítems |
| `VendorCreditNotes` | los gastos y el ITBIS que corrige; Cuentas por Pagar va al DÉBITO, y la pone ADM sola | ítems, precios POSITIVOS |
| `BillPayments` | la cuenta de caja que pagó | partida doble |
| `AccountPayments` | la cuenta de caja que pagó, contra la cuenta del impuesto al débito — **sin `Documents[]`**: si hay una factura que cancelar, era `BillPayments` | partida doble + `Items[]` |
| `BankCharges` | en `cargo`: la cuenta de caja o la tarjeta. En `credito`: el ingreso del banco o la cuenta del cargo que se revierte — **jamás un pasivo con un tercero** | partida doble + `direccion` |
| `BankBankTransfers` | las dos cuentas de caja | partida doble |
| `Journals` | lo que declaren tus líneas | partida doble |

**En la fila de `BankCharges` está el segundo auto-chequeo, y es el que atrapa
el error de Formax:** si tu `BankCharges` en crédito acredita una cuenta de
pasivo con un tercero (adelantos de clientes, depósitos en garantía) o una
cuenta por cobrar, **no es un crédito bancario** — es plata de alguien que no
es el banco, y ya perdiste en la pregunta 1. Eso salió como CB00000258.

### El papel manda dos datos más: la tasa y el descuento

- **Moneda extranjera** → `moneda: "USD"` **y** `tasa_usd` = la tasa de cambio
  IMPRESA en el papel (Account One la imprime como «Tasa»). Sin `tasa_usd` el
  registrador cae a la tasa de sistema de ADM, que puede no ser la del
  proveedor — y sin ninguna, el gasto en pesos queda dividido por ~60: la
  FP00001118 (US$2,306.15) quedó asentada por RD$2,306 en vez de ~RD$134,000.
- **Descuento** → si el papel trae columna de descuento, la línea lleva el
  precio BRUTO en `precio` y el porcentaje en `descuento` (número 0-99.99,
  no el monto). Aplastar el neto en el precio deja Subtotal/Descuento del
  documento distintos a los del papel: la FP00001065 salió con 540 pelado
  siendo 600 al 10% y la contable la corrigió a mano. El ITBIS del papel
  cruza contra la base DESCONTADA (97.20 = 18% de 540, no de 600) —
  verificado contra ADM el 2026-08-19 (FP00001122) y en el precedente del
  libro `2026-08-03-account-one-outsourcing-fiscal-contable.md`.
  **OJO — transición**: la compuerta de cuadre del validador aún no conoce
  `descuento` (suma `precio×cantidad` bruto) y va a responder «no cuadra»
  a una propuesta bien capturada. Si te pasa, NO aplastes el neto en el
  precio para complacerla: es exactamente el error que esto corrige —
  `preguntar_al_humano` citando esta regla, hasta que el validador se
  actualice.

Si tu razonamiento nombra una cuenta que no le toca al tipo que elegiste, **la
propuesta no sale**: estás describiendo un documento y etiquetando otro. Pasó el
2026-08-05 con la liquidación de la DGA por RD$939.118,86 — quedó guardada como
`documento_adm: "VendorBills"` con un `detalle` que decía «la contraparte es un
crédito a la cuenta banco de impuestos (101.05)». Ese asiento no existe: las
1.109 facturas históricas acreditan Cuentas por Pagar sin una sola excepción. Lo
que ese detalle describía era el SEGUNDO documento, el pago — y faltaba.

**Y el banco que dice el papel NO es la cuenta de la que salió la plata.** Un
comprobante de pago electrónico trae el banco **adquirente** —el que COBRÓ, del
lado del que recibe— bajo rótulos como «Banco / Empresa de Adquirencia». Dice
quién recibió, nunca de dónde salió. Pasó el 2026-08-06 con la liquidación de la
DGA por RD$939.118,86: el PDF dice «BANCO MULTIPLE PROMERICA DE LA REPUBLICA» y
el `detalle` salió diciendo «pago electrónico desde Banco Promérica». No existe
ninguna cuenta Promérica entre las 19 del colector — el débito fue de Santa Cruz,
cuenta «Impuestos» 11122010014964. Quien lea ese detalle busca donde no hay nada.

**Sólo afirmás de dónde salió la plata si tenés el movimiento delante.** En una
sugerencia del detector lo tenés: `propuesta.banco`, `cuenta_banco` y
`cuenta_numero` SON el movimiento, y ahí nombralos con confianza. En una factura
subida a la Bandeja NO lo tenés: escribí que el débito quedó pendiente de
identificar y seguí. «No sé de dónde salió» es una respuesta válida; el banco del
papel puesto en su lugar, no.

**Monto y fecha no alcanzan para adivinarlo, ni se te ocurra.** Medido sobre las
64 facturas de la mesa: buscar un movimiento del mismo monto a ±3 días acierta 18
veces, se abstiene en 16 y **miente en 2** — y las dos mentiras son de las que no
se descubren. A la FP00001114 (gasolina RD$750 pagada EN EFECTIVO) le ofrece el
movimiento de la FP00001115, otra gasolina de RD$750 cargada seis segundos
después: dos facturas saldadas cruzadas por el monto exacto. A la FP00001077
(membresía de gimnasio, RD$15.000) le ofrece el pago de la tarjeta de crédito.
Emparejar el movimiento con su factura es trabajo de `sugerir-asignacion.sh`, que
lo hace desde el otro lado y sobre facturas ya registradas en ADM — 593 aciertos,
20 empates declarados y CERO errores sobre 729 pagos históricos. No lo rehagas a
ojo desde acá.

Nombrar un banco por otro motivo —es el proveedor, el emisor, el asegurado, el
cliente del documento— está bien y no lo toca esta regla: la FP00001067 dice
«facturada a Banco Multiple Santa Cruz» y es correcto. Lo prohibido es afirmar DE
DÓNDE SALIÓ LA PLATA sin un movimiento delante.

### Cómo clasificás la cuenta (con o sin dossier)

**Un solo comando resuelve los pasos 1 y 3 de abajo** (el paso 2, tu memoria
curada, lo leés vos aparte y SIEMPRE: lo ratificado manda sobre el destilado).
Corré esto y leé la salida entera antes de decidir nada:

```bash
python3 /opt/data/memoria/scripts/buscar-precedente.py "nombre del proveedor"
```

El término **siempre entre comillas** — hay 11 proveedores con `&` en el
nombre. Podés pasarle el RNC en vez del nombre. Otros modos:
`--cuenta <codigo>` (quién usa esa cuenta), `--cuentas` (el catálogo completo
de cuentas en uso), `--plan <palabra>` (busca en las 215 cuentas del plan, no
sólo en las que ya se usan).

**PROHIBIDO consultar los agg con `python3 -c`** (ni `perl -e`, ni ningún
intérprete con `-c`/`-e`): el guardián de comandos marca ese flag y consulta a
otro modelo antes de dejarte ejecutar — medido, 8 a 17 segundos POR LLAMADA, y
en el trabajo 133ea3d5 se comió 57 de los 98 segundos de la clasificación. El
script hace exactamente lo mismo en 30 milisegundos porque es un archivo.
También sigue PROHIBIDO greppear `preentrenamiento/raw/` para cuentas.
La prohibición es para CONSULTAR LOS AGG y nada más: la conversión de HEIC del
paso 3 (`uv run --with pillow-heif python -c ...`) sigue igual de válida —
verificado que no dispara el guardián, porque el comando es `uv`.

Las cinco etiquetas de su salida se leen literal y no se reinterpretan:

- **`PRECEDENTE:`** — hay cuenta dominante con muestra suficiente. Es tu punto
  de partida, con el `precedente_ref` que el propio script te imprime. Sigue
  siendo el default de arranque: está sujeto al chequeo por item y a tu memoria
  ratificada, que manda sobre él.
- **`SIN CUENTA DOMINANTE`** — el proveedor SÍ está, pero se registró
  históricamente con varias cuentas (el caso típico del restaurante: consumo +
  propina legal). NO hay precedente citable: repartí cada renglón entre las
  cuentas que el propio bloque te listó, según la naturaleza de cada uno, con
  `metodo='razonado'` y la explicación en `detalle`.
- **`MUESTRA INSUFICIENTE`** — la cuenta salió de 1 o 2 facturas. Es una señal,
  NO un precedente: no la cites como tal.
- **`PARECIDOS DE NOMBRE`** — coincidieron por una palabra suelta y casi nunca
  son el mismo negocio. Ignoralos salvo que reconozcas el negocio.
- **`⚠ Coincidió por RNC`** — buscaste por número. Confirmá que el nombre que
  te devolvió es el de TU documento antes de usarlo: hay facturas donde el RNC
  impreso no es el del proveedor que la emitió, y una de ellas te devuelve otro
  proveedor con 96% de confianza. Si el nombre no casa, buscá por nombre.

El método NO lo cambia el script: si devolvió `PRECEDENTE` va
`metodo='precedente'`. `metodo='script'` queda reservado para cuando un script
tuyo calcula el asiento completo (conciliación, nómina).

