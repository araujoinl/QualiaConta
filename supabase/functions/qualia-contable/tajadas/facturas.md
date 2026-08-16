<!-- GENERADO por deploy/generar-tajadas.sh — NO editar a mano -->

<!-- adaptado: la rama la sirve el harness (no scripts/abrir-trabajo.sh) y las dos mitades van
concatenadas. Re-tajada de a14c7d0 según contrato-turno.md §5.3: muere la mecánica del
chasis viejo, quedan las reglas contables y las lápidas. -->

## Si está `pendiente`: analizalo

### Paso 0 — si el hilo ya tiene voz del humano, no es un análisis nuevo

<!-- adaptado: psql del hilo y `cat rama-respuestas.md` → hilo en el dossier, ruteo del harness. -->
Antes de nada, mirá si alguien ya te dijo algo sobre esta fila: los últimos eventos
del hilo ya vienen en el dossier, y `dossier_completo {hilo_completo: true}` te trae
el hilo entero.

Si hay una respuesta del usuario posterior a una propuesta tuya, **estás por
repetir un análisis que ya fue corregido**: el harness te sirve la rama «evento
`respuesta`» en lugar de ésta, y lo que dijo el humano es dato, no un arranque de
cero. El motivo del poke puede llegar equivocado —el poke es un puntero y la base
es la única verdad— y **el dossier del preparador NO contiene eventos**: si el
documento no cambió te lo entrega idéntico al de antes de la corrección, así que
leerlo te devuelve exactamente el razonamiento que el humano acaba de rechazar.

### El dossier del preparador — mirá esto ANTES de trabajar

<!-- adaptado: `leer-contexto.sh --claim` y el dossier.json de /tmp/mesa → claim del harness,
dossier precargado y `avisar_progreso`. La regla —un movimiento y no cinco— queda. -->
Antes de despertarte, un preparador determinista (sin LLM) dejó el trabajo masticado,
y **ya tenés su dossier**: la iteración 1 llega con la fila, el hilo, el rastro del
proponedor determinista si lo hubo (`clasificacion.json`: por qué el camino sin LLM
NO propuso — ése es tu punto de partida, no lo re-descubras), el dossier y el
precedente del proveedor ya buscado. No lo vuelvas a pedir: `dossier_completo` es
para releer el hilo entero o mirarlo tras una corrección. El claim tampoco es tuyo:
nunca ves la carrera.

- **Con dossier** (lo normal): el documento ya lo procesó el preparador
  (convertido a jpg si era HEIC, con su texto extraído si lo hubo), y la
  extracción, la verificación DGII y el chequeo
  de duplicados YA están hechos. **SALTATE los pasos 2-5** y andá DIRECTO al
  precedente y la propuesta (pasos 6-8). **Tu PRIMER movimiento tras leer el
  dossier es UNA llamada a `avisar_progreso` corta anunciando SOLO tu plan y tu
  juicio** — sin repetir proveedor/monto/DGII, que ya están en el evento del
  preparador — p.ej. «Este comprobante no pasó la verificación de DGII, así
  que no sirve como crédito fiscal: te preparo la propuesta para registrarlo
  como gasto no admitido» o «A este proveedor siempre lo registramos como
  combustible; te armo la propuesta igual que las anteriores». Corto pero
  hablado, con el tono de la sección «Cómo le hablás al humano».
  Sin ese aviso la mesa queda muda minutos y el humano no sabe si estás vivo.

  **NO repitas lo que el dossier ya hizo** (medido 2026-08-02: re-hacer la
  visión + re-consultar DGII quemó ~80s de una corrida que ya los traía):
<!-- adaptado: `vision_analyze` no existe; la prohibición de relectura queda igual de dura. -->
  - `extraccion` con campos y confianza alta → esos son tus datos. Verificá
    coherencia contra el texto extraído del dossier o contra la aritmética,
    NUNCA re-leyendo la imagen —el turno no tiene tool de visión—; si algo de
    verdad no cierra, aplicá la regla de abajo (patrón conocido → renglón
    inferido; sin patrón → preguntá).
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
       imagen — PREGUNTALE al humano con `preguntar_al_humano`, con la
       diferencia exacta y tu mejor hipótesis. Él tiene el documento a un
       click. Con su respuesta, cerrás.
<!-- adaptado: no hay `texto.txt` en disco; el texto extraído viaja en el dossier. -->
  - `dgii` del dossier → va a tu propuesta TAL CUAL. No re-consultes DGII.
    EXCEPCIÓN: un `dgii` con estado "no verificable" cuenta como AUSENTE —
    intentá el paso 5 vos (con `consultar_dgii`, desde el texto extraído del
    dossier, sin visión); si tampoco podés, queda "no verificable" con el motivo.
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
  no cuadra, PREGUNTA al humano), jamás re-leyendo la imagen: no hay tool de
  visión en el turno. El `dgii` del dossier va a tu propuesta como siempre
  (nunca lo dejes vacío), y si `duplicados` trae filas, decidís vos con la
  regla del paso 4 — el prep nunca marca error por duplicado. El prep ya dejó
  un evento de progreso con el resumen: no lo repitas, contá solo tu juicio.

<!-- adaptado: la vigencia del dossier la compara el harness, y sin él no te invoca (§1). -->
- **Si el dossier no llegara**, no es tu turno: el harness no invoca sin dossier
  vigente. Lo que sí puede faltar es un campo suelto: ése lo completás vos.

### Qué documento de ADM es esto: lo decide el ROL del hecho, no el papel

<!-- adaptado: `poller.sh` → la pieza que registra (el mesa hasta F4). -->
Primero el documento, después la cuenta: `documento_adm` no es una etiqueta, es
el router — la pieza que registra elige el camino según ese campo, y la
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

<!-- adaptado: el evento `pregunta` a mano → `preguntar_al_humano`; `poller.sh` → quien registra. -->
   **Plata que ENTRA de un tercero: hoy no tenés documento para eso — pará y
   preguntá.** El rol del agente niega toda emisión AR (`CashInvoices`,
   `CreditInvoices`, notas de crédito de cliente) y también `Deposits`; ver
   `docs/plan-encendido-escritura.md` §1.1. No hay vuelta que darle: no la
   disfraces de `BankCharges` en crédito ni de `Journals`. Cerrás con
   `preguntar_al_humano`, nombrando el movimiento, el tercero y el tratamiento
   que corresponde, y que el humano lo registre él. Proponer `CashInvoice` es
   peor que no proponer nada: la pieza que registra no conoce ese tipo, así que
   la fila se aprueba y no se registra nunca — queda viva simulando que alguien
   la atendió.

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

<!-- adaptado: `buscar-precedente.py`, sus comillas y el veto al `python3 -c` (con los 8-17s
del guardián de comandos) → la tool `buscar_precedente`. -->
**Una sola llamada resuelve los pasos 1 y 3 de abajo** (el paso 2, tu memoria
curada, la leés aparte y SIEMPRE: lo ratificado manda sobre el destilado). El
precedente del proveedor de ESTE documento **ya vino precargado con el dossier**:
leé esa salida entera antes de decidir nada, y usá la tool sólo para OTRA
búsqueda:

`buscar_precedente {termino: "nombre del proveedor"}`

Podés pasarle el RNC en vez del nombre (`{rnc: "..."}`). Otros modos:
`{cuenta: "<codigo>"}` (quién usa esa cuenta), `{plan: "<palabra>"}` (busca en las
215 cuentas del plan, no sólo en las que ya se usan) y `{tipos: true}` (catálogo
606). El catálogo entero de cuentas EN USO viene en el mismo bloque cuando no hay
precedente. Y el plan VIVO, con el vecindario de la serie completo, sale de
`leer_adm {modo: 'plan_cuentas'}`: adivinar un código sigue prohibido.

Las cinco etiquetas de su salida se leen literal y no se reinterpretan:

- **`PRECEDENTE:`** — hay cuenta dominante con muestra suficiente. Es tu punto
  de partida, con el `precedente_ref` que la propia tool te devuelve. Sigue
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

<!-- adaptado: no hay scripts tuyos; `metodo='script'` queda para la pieza determinista. -->
El método NO lo cambia la tool: si devolvió `PRECEDENTE` va
`metodo='precedente'`. `metodo='script'` queda reservado para cuando el asiento
completo lo calcula una pieza determinista (conciliación, nómina), no tu juicio.

<!-- ——— generar-tajadas.sh: fin de rama-facturas-1.md · sigue rama-facturas-2.md ——— -->

<!-- adaptado: segunda mitad de la tajada; ya no la sirve abrir-trabajo.sh. -->


El paso 6 del protocolo completo usa ESTA misma jerarquía:

<!-- adaptado: la ruta /opt/data/…/agg muere; el espejo lo lee `buscar_precedente`. -->
1. **Precedente del proveedor**: el espejo agg `proveedor-cuentas.json`
   — con qué cuenta registró la contabilidad REAL las facturas de ESE
   proveedor (1,050 facturas destiladas). Si el proveedor está y su cuenta
   dominante tiene ≥70% de usos: ese es tu punto de partida,
   `metodo='precedente'` con `precedente_ref='agg:proveedor-cuentas.json#<rnc-o-nombre>'`
   citando "N de M facturas históricas" en `detalle`. **Excepción explícita a
   la REGLA DURA del borrador**: este agg NO es memoria en borrador — es
   destilado determinista de la contabilidad REAL registrada en ADM, y por
   eso SÍ vale como precedente con esa referencia.
   **El precedente es un default POR ITEM, jamás un sello a ciegas** (regla
   del dueño, 2026-08-02): leé la descripción de CADA renglón — si un item
   contradice la naturaleza de la cuenta dominante (un mueble, un equipo,
   algo capitalizable = activo depreciable; mercancía para revender =
   inventario), ESE item se clasifica por su naturaleza, con la explicación
   en `detalle`. La misma factura puede mezclar cuentas por item — eso es lo
   correcto, no una anomalía. Forma:
   `{"_meta", "proveedores": [{"nombre", "rnc", "facturas", "cuentas": [{"codigo","nombre","usos","pct"}]}]}`.
   El RNC del agg es real desde 2026-08-02 (sale de `raw/vendors.jsonl`, campo
   `FiscalID`: 154 de 164 proveedores lo tienen), así que buscar por RNC vale.
<!-- adaptado: los `python3 buscar-precedente.py` de ejemplo → la tool. -->
   Lo resuelve la tool — por nombre o por RNC, da igual:
   `buscar_precedente {termino: "tupaq"}` · `buscar_precedente {rnc: "132942248"}`

<!-- adaptado: la memoria curada viaja en este contexto, no en archivos (§6.7). -->
2. **Tu memoria curada** (proveedores y criterios RATIFICADOS, empaquetados en
   este contexto) si matiza o contradice el precedente crudo — lo ratificado
   manda sobre el agg.

<!-- adaptado: esa salida la devuelve la tool, no un script. -->
3. **Proveedor nuevo sin precedente**: la tool ya te lo dijo con
   `SIN PRECEDENTE PARA "..."`, y en ese mismo bloque te imprimió **todas las
   cuentas que la contabilidad real usa** (el encabezado dice cuántas), con su
   nombre exacto y cuántos proveedores las usan. Razonás (`metodo='razonado'`) eligiendo de ESA lista
   por la naturaleza del renglón — **no inventes una categoría**: ADM no tiene
   categorías de proveedor, y un "39 restaurantes históricos" improvisado es
   justo el error que se cometió el 2026-08-02 (eran 39 proveedores de la
   cuenta, con supermercados adentro).
<!-- adaptado: `--cuenta` y `--plan` son modos de la tool; el plan VIVO, `leer_adm`. -->
   Para ver quién más usa una cuenta antes de decidirte:
   `buscar_precedente {cuenta: "611.17"}`.

   No busques la cuenta por palabra clave adivinada: "viaje" no encuentra
   "Dieta y Viáticos". Leé los nombres de la lista. Y si de verdad ninguna
   encaja, el plan completo tiene 215 cuentas —`buscar_precedente {plan:
   "<palabra>"}`, y el vecindario vivo de una serie con `leer_adm {modo:
   'plan_cuentas'}`— pero salir de las cuentas en uso hay que justificarlo en
   `detalle`.

**La extracción del dossier es auto-generada: tratála como borrador a validar,
no como verdad.** Solo el XML e-CF (`confianza: alta`) es dato exacto; lo demás
salió de regex sobre texto o de una pasada de visión y puede leer mal un dígito.
Nada del dossier te exime del juicio contable: la cuenta, el precedente y la
propuesta siguen siendo tuyos.

<!-- adaptado: el claim (`leer-contexto.sh --claim` y su SQL) es del harness; `bajar-documento.sh`,
del preparador. Los pasos quedan numerados para que «saltate los pasos 2-5» siga cerrando. -->
1. **El claim ya está hecho** — lo hizo el harness antes de invocarte, con su
   UPDATE guardado, y el que pierde la carrera no gasta un token: si estás
   leyendo esto, la fila es tuya y está en `analizando`.

2. **El documento ya está bajado y leído** — es del preparador, y su dossier es
   lo que tenés: no manejás archivos ni URLs firmadas, y no hay tool de visión.

3. **Extraé los datos**: proveedor, RNC, NCF, fecha, moneda, monto, ITBIS.
   e-CF (XML) es dato exacto; PDF/foto se lee con cuidado y confianza menor.

   **`fecha` es la FECHA DE EMISIÓN del comprobante**, la que el papel rotula
   «Fecha de Factura», «Fecha de Emisión» o «Fecha» a secas. Un documento trae
   varias y ninguna de las otras sirve: NO la **Fecha de Firma Digital** (cuándo
   se firmó el XML), NO la **Fecha Límite de Pago**, NO el **Vencimiento del
   e-NCF**. Decide en qué mes entra el gasto y en qué 606 se declara, así que
   elegir mal no es un detalle de forma.

   **Si la fecha que vas a escribir coincide con la Fecha de Firma que
   extrajiste para el timbre (paso 5b), releé el papel antes de proponer.**
   Pueden coincidir de verdad, pero es la señal de que agarraste la del pie en
   vez de la del encabezado. Pasó el 2026-08-06 con Claro: el PDF decía «Fecha
   de Factura: Agosto 04, 2026» y se registró con la firma, `2026-07-31`. La
   factura de agosto entró en julio y el detector de recurrentes siguió
   reclamando una factura que ya estaba cargada. Entender el período no alcanza
   —el `detalle` de esa misma propuesta decía «por los servicios de agosto»—:
   lo que se declara es lo que va en `fecha`.

   Cuando el timbre e-CF verifica en DGII, **su `fecha_emision` manda** sobre lo
   que hayas leído del PDF: es la fecha que el comprobante tiene ante la DGII.

   **La fecha se imprime DÍA/MES/AÑO**: `02/08/2026` es el 2 de agosto
   (`2026-08-02`), NO el 8 de febrero. La visión del preparador la voltea a la
   gringa cuando día y mes son ≤ 12 y ya pasó (ticket del 2026-08-02 guardado
   como `2026-02-08`). Cuando ambos números sean ≤ 12, releé la fecha impresa
   en el documento antes de proponer, no copies la del dossier a ciegas.

   Y ojo con la emisión escrita en palabras («Agosto 04, 2026»): no matchea
   ningún patrón numérico, así que es la que más fácil se pasa por alto — y
   mientras tanto la firma del pie sí viene como `31-07-2026` y se ofrece sola.

<!-- adaptado: openpyxl, `vision_analyze` y el HEIC con `uv run` son del preparador (§6.5). -->
   Si es Excel (.xlsx — nómina u otro), lo que leyó el preparador es lo que
   tenés; una nómina se propone como su asiento completo (bruto, TSS,
   retenciones, neto) según el criterio de tu memoria.

   Fotos (jpg/png/webp) y HEIC de iPhone: las convierte y las lee el preparador.
   Vos trabajás con su extracción — no hay tool de visión en el turno, y con
   campos presentes la relectura está prohibida.

<!-- adaptado: psql, grep del histórico y `jsonb_set` → dossier, `leer_adm {listado}` y
`marcar_error {duplicado_de}`, que enlaza el papel en la misma transacción. -->
4. **Chequeá duplicados ANTES de proponer** (el NCF es unico por emisor):
   - En la mesa: el dossier ya trae `duplicados` —otros trabajos con el mismo
     NCF—. **Decidís con eso, no re-busques.** Si hay uno vivo y no esta
     rechazada/error: este trabajo va a `error` con `marcar_error`,
     `error_detalle='Duplicada: mismo NCF que el trabajo <id>'` y su evento nota.
     **Un trabajo cuyo documento ADM ya no cuenta —`eliminado_en` o `anulado_en`
     en `registro_adm`— NO es un duplicado**, y por eso el dossier lo descarta:
     ese gasto quedo SIN registrar, y volver a subir el papel es justo lo que
     corresponde hacer. Sin ese corte la resubida caia en `error` para siempre,
     porque la fila vieja se queda en `registrada` —que no es rechazada ni
     error— aunque el documento ya no exista (paso el 2026-08-04 con la
     FP00001120 de Carrefour, borrada en ADM).
   - Contra ADM: si el dossier no alcanza, `leer_adm {modo: 'listado', tipo_doc:
     'VendorBills'}` y filtrás el NCF vos —el `?Reference=` / `?DocID=` de la API
     miente y está prohibido—. Si YA esta registrada: propuesta con
     `"posible_duplicado": {"docid": "FPxxxxx", "donde": "ADM"}` y confianza
     baja — la web lo muestra en rojo y el humano decide. El historico que trae
     el dossier es una FOTO vieja: si el NCF aparece ahi, confirma con `leer_adm`
     que el docid sigue existiendo antes de marcar nada — un documento eliminado
     en ADM no es un duplicado, es el que hay que volver a registrar.
   - **Al cerrar una subida como duplicado de un trabajo VIVO de la mesa, el
     papel no se descarta.** Si el trabajo vigente no tiene documento propio
     (`archivo_path` null — tipico de una sugerencia nacida del banco, como un
     pago de impuestos), su papel ES la subida que estas cerrando: cerrala con
     `marcar_error {duplicado_de: "<id del trabajo vigente>"}`, que en la misma
     transacción anota `comprobante_de_trabajo` en la propuesta del vigente y le
     deja su evento nota. La pieza que registra baja ese papel y lo adjunta al
     documento en ADM. Sin este enlace el cargo se registra sin soporte y el
     papel bueno queda varado en una fila en `error` — paso el 2026-08-07 con el
     comprobante DGII del anticipo ISR de julio (trabajos 672eacb4 → 646ed1cf).

5. **Verificá el comprobante contra DGII — SIEMPRE llená el campo `dgii`**, aun
   cuando no aplique. Nunca lo dejes vacío: quien mira la propuesta no puede
   distinguir "no aplica" de "se me olvidó".

   **(a) NCF impreso (B01, B02, B04, B14, B15...): consultá si está autorizado.**
<!-- adaptado: `consultar-ncf-dgii.py` → `consultar_dgii {modo:'ncf'}`. -->
   No tiene QR ni timbre — eso es solo de los electrónicos. Se consulta con
   `consultar_dgii {modo: 'ncf', rnc: "<rnc_emisor>", ncf: "<ncf>"}` (verificado
   2026-08-02 contra NCF reales; devuelve JSON), y SOLO si el dossier trae ese
   campo ausente o `no verificable`.

   Guardá su salida tal cual en `"dgii"`. Devuelve `estado` VIGENTE (con
   `razon_social_emisor`, `tipo_comprobante` y `vigencia`), NO VALIDO con su
   `mensaje`, o `no verificable` con `motivo`. **Jamás inventes el resultado.**

   Dos comprobaciones que SÍ tenés que hacer con esa respuesta:
   - **`estado` distinto de VIGENTE** → un NCF no autorizado **no sirve como
     crédito fiscal**. Bajá la confianza, decilo en `detalle`, y hacé dos cosas
     más:
     1. **El contacto del proveedor sale del DOCUMENTO y de ningún otro lado**
        (regla del dueño, 2026-08-02): las facturas casi siempre traen el
        teléfono/dirección del emisor impresos en el encabezado o el pie —
        revisá el texto extraído o la imagen (el dossier del preparador puede
        traerlo ya en `extraccion.telefono`). Si se lee, guardalo en la
        propuesta:
        `"proveedor_contacto": {"contacto":"...","telefono":"...","email":"..."}`.
        Si el documento no lo trae o no se lee, dejá el campo FUERA y seguí.
        **PROHIBIDO buscarlo en ADM, en tu memoria o en internet** — además el
        `search` de `/api/Vendors` ni siquiera filtra (verificado 2026-08-02).
     2. **Proponé el tratamiento alternativo** en `detalle`: si deciden
        registrarla igual, va como **gasto no admitido** — ITBIS NO aprovechable
        y el total a una cuenta de gasto no deducible. La web solo deja aprobarla
        por esa vía; el humano decide.
     Y si al aprobarla ves en el hilo una nota que dice **GASTO NO ADMITIDO**,
     respetalo: al escribir el libro, el ITBIS no se toma como crédito fiscal.
   - **`razon_social_emisor` de DGII contra el proveedor que leíste**: si no
     coinciden, probablemente leíste mal el RNC o el NCF (pasa con las fotos).
     Volvé al documento antes de proponer.

   **(b) e-NCF (E31/E32/E34...): verificá el timbre. El QR es la fuente, no el
   texto.** El QR de la representación impresa ES esta consulta ya armada, y
   trae un dato que el papel NO imprime: la HORA de la firma. Claro imprime
   «Fecha Firma Digital: 31-07-2026» y el QR dice «31-07-2026 10:16:23»; DGII
   exige el segundo exacto, así que una URL reconstruida del texto NO PUEDE
   verificar nunca. Si te da «No fue encontrada», la explicación no es que DGII
   tarde en publicar —eso suena razonable y es falso—: es que te falta la hora.

   El preparador ya lee el QR y deja sus campos en `extraccion.json` con
   `"timbre_qr": true`. Cuando estén, **usalos tal cual**: son los que el emisor
   firmó. Si además viene `qr_corrigio`, ahí está lo que el texto había leído
   mal — el QR gana, y no al revés. Si no hay `timbre_qr` (factura impresa B01,
   foto sin QR legible), recién ahí armás la URL con lo que salga del texto,
   sabiendo que sin hora de firma va a fallar.

   **La Fecha de Firma se usa SOLO acá**: no es la fecha de la factura, que sale
   del encabezado (paso 3). La URL pública de consulta (la misma del QR):

   `https://ecf.dgii.gov.do/ecf/ConsultaTimbre?RncEmisor=<rnc>&RncComprador=<rnc_blackbox>&ENCF=<encf>&FechaEmision=DD-MM-AAAA&MontoTotal=<total>&FechaFirma=DD-MM-AAAA%20HH:MM:SS&CodigoSeguridad=<code>`

<!-- adaptado: el curl y el parseo → `consultar_dgii {modo:'timbre'}`. -->
   (para facturas de consumo la variante es /ecf/ConsultaTimbreFC). Esa consulta
   la hace `consultar_dgii {modo: 'timbre', url_qr: "<la URL del QR>"}`, que te
   devuelve la tabla ya parseada. Guarda el resultado en la propuesta:
   `"dgii": {"estado":"Aceptado","rnc_emisor":"...","razon_social_emisor":"...","rnc_comprador":"...","razon_social_comprador":"...","encf":"...","fecha_emision":"...","total_itbis":11.96,"monto_total":163.26,"verificado_en":"<ISO timestamp>"}`.
   - Estado != Aceptado, o los montos de DGII no cuadran con lo que extrajiste
     del PDF → baja la confianza y decilo en `detalle` (posible factura
     adulterada o mal leida).
   - Sin codigo de seguridad legible o DGII inaccesible → `"dgii": {"estado":"no verificable","motivo":"..."}` — nunca inventes el resultado.

   **(c) El padrón de RNC: quién es el emisor. Siempre disponible.** Es otra
   pregunta y otra fuente: (a) y (b) dicen si el COMPROBANTE vale; el padrón
   dice de quién es el RNC. **Un comprobante no verificable NO te deja sin
   nombre oficial** — el padrón pide solo el RNC, que siempre se lee, mientras
   que el timbre exige el código de seguridad del QR y la fecha de firma.

<!-- adaptado: `consultar-rnc-dgii.py` → `consultar_dgii {modo:'padron'}`. -->
   El preparador ya lo consulta por vos y lo deja en `rnc_emisor` del dossier
   (clave aparte de `dgii`, nunca mezcladas). Si falta o vino `no verificable`,
   reconsultá con `consultar_dgii {modo: 'padron', rnc: "<rnc_emisor>"}` — con el
   campo presente, re-consultar está prohibido.

   Devuelve `estado` ENCONTRADO (con `razon_social`, `nombre_comercial`,
   `estado_contribuyente`, `actividad_economica`), NO ENCONTRADO, `formato
   invalido` o `no verificable` con su motivo. Es la web
   `dgii.gov.do/.../consultas/rnc.aspx`, sin captcha (verificado 2026-08-03).

<!-- adaptado: `registrar-en-adm.py` → la pieza que registra. -->
   **Copiá su salida tal cual a la propuesta, en `"rnc_padron"`** (hermana de
   `"dgii"`, nunca dentro). La pieza que registra la lee de ahí para nombrar al
   proveedor cuando el comprobante no verificó: si no la ponés, el registro
   muere pidiendo un nombre que ya tenías.

   Qué hacer con eso:
   - **`razon_social` del padrón es el nombre oficial** para crear el proveedor
     en ADM cuando el timbre o el NCF no lo dieron. Vale igual que el
     `razon_social_emisor` de (a)/(b) — misma DGII, distinta consulta.
   - **Contrastalo con el proveedor que leíste**, igual que en (a): si no casa
     ni con `razon_social` ni con `nombre_comercial`, sospechá que leíste mal el
     RNC y volvé al documento antes de proponer.
   - **`estado_contribuyente` distinto de ACTIVO** → decilo en `detalle`: un
     emisor dado de baja o suspendido es una señal, no un bloqueo.
   - **NO ENCONTRADO** con formato válido es serio: ese RNC no está inscrito.
     Bajá la confianza y decilo en `detalle`.
   - Nunca uses el padrón para dar por verificado el comprobante: saber de quién
     es el RNC no dice nada de si el NCF está autorizado.

<!-- adaptado: la búsqueda la precargó el harness; el resto, `buscar_precedente`. -->
6. **Buscá precedente** — la salida YA vino con el dossier (la corrió el harness
   con el RNC): usala de ahí, y llamá a `buscar_precedente` sólo para OTRA
   búsqueda (`{cuenta}`, `{plan}`, un término distinto). Después tu memoria y tu
   libro: los criterios ratificados y las entradas del libro de acción viajan en
   este contexto. El Alcance de cada entrada dice si aplica. Con precedente →
   `metodo='precedente'` y su `precedente_ref`. Si lo resolvió una pieza
   determinista → `metodo='script'`. Caso nuevo → `metodo='razonado'`, apoyado en
   el núcleo DGII (citá la norma en `detalle`).

<!-- adaptado: el insert a `qualia_eventos` → `avisar_progreso`. -->
7. **Andá contando lo que hacés** — la web lo muestra en vivo:

`avisar_progreso {texto: "Recibí la factura de Sunix por RD$45,200 — la estoy
revisando contra DGII y contra cómo hemos registrado a este proveedor antes."}`

   Uno por FASE, no por comando; los del cierre van en la tool de cierre.

<!-- adaptado: `aplicar-propuesta.py`, el turno.json y los SQL → la tool `proponer`, con las
validaciones adentro; del ejemplo salen `trabajo_id` y `estado`, que pone el harness.
`escribir-libro.py` → `escribir_libro`. -->
8. **Cerrá con la propuesta en UNA llamada** — `proponer {resumen, propuesta,
   eventos}`. Hace todo en una transacción — tus eventos de cierre, la propuesta,
   el resumen y el estado — con los guards del contrato adentro, y si el guard
   no matchea REVIENTA con el motivo (la trampa del «UPDATE 0» silencioso ya
   mordió dos veces; esta tool la mata). El `trabajo_id` y la `empresa_id` los
   pone el harness, y el único estado que la tool escribe es `propuesta`.
   Ejemplo COMPLETO y coherente (VendorBills en forma de items, aritmética que
   cuadra: 38,305.08 + 6,894.92 = 45,200.00):

```json
{
  "eventos": [{"tipo": "progreso", "contenido": "A este proveedor siempre lo registramos como combustible: te armé la propuesta igual que las 94 anteriores."}],
  "resumen": "Factura Isla Dominicana — RD$45,200 combustible flotilla",
  "propuesta": {"proveedor":"Isla Dominicana De Petroleo Corporation","rnc":"101008172","ncf":"E310000012345","fecha":"2026-08-01","moneda":"DOP","monto":45200.00,"itbis":6894.92,"tipo_gasto":{"codigo":"02","nombre":"Gastos por Trabajos, Suministros y Servicios"},"documento_adm":"VendorBills","lineas":[{"descripcion":"Gasoil flotilla","cantidad":1,"precio":38305.08,"grupo_impuesto":"ITBIS","itbis":6894.92,"cuenta":"620.11","cuenta_nombre":"Combustible"}],"metodo":"precedente","precedente_ref":"agg:proveedor-cuentas.json#101008172","confianza":0.95,"detalle":"Combustible de flotilla. Cuenta 620.11 por precedente: 94 de 96 usos de cuenta sobre 96 facturas históricas de este proveedor."}
}
```

   Las otras dos salidas son tools propias y **una sola cierra la invocación**:
   `preguntar_al_humano` (evento + `esperando_respuesta`) y `marcar_error`. Tras
   cualquiera de las tres, el turno termina.

   **Dejá el borrador del libro en la MISMA propuesta**, campo
   `borrador_libro`, mientras el análisis está fresco: al aprobarse y
   registrarse, la entrada la materializa la tool `escribir_libro` — usa tu
   borrador si está y el `detalle` a secas si no, y el que redacta con el caso en
   la cabeza sos vos ahora, no un turno frío tres horas después. Forma:
   `"borrador_libro":{"titulo":"…","caso":"…","por_que":"…","sosten":"norma o precedente citado","alcance":"a qué casos futuros aplica"}`.
   `Aprobó` y DocID NO van — todavía no existen; los pone la plantilla al
   materializar. El `alcance` escribilo como siempre: sin alcance, la entrada
   documenta pero no automatiza.

   **`tipo_gasto` es OBLIGATORIO en toda factura** y es un eje DISTINTO de la
   cuenta contable — no los confundas:

   - **Tipo de gasto** = la clasificación DGII del **606**, catálogo fijo 01-11,
     **UNA por documento**. Es lo que ADM pide en la cabecera de la factura.
     Forma: `"tipo_gasto":{"codigo":"05","nombre":"Gastos de Representación"}`.
   - **Cuenta contable** = dónde impacta el asiento, **por renglón**.

   Un restaurante ilustra los dos a la vez: tipo de gasto **05 Representación**
   para toda la factura, y por renglón la cuenta **611.17 Dieta y Viáticos** para
   el consumo más **690.06 Propina Legal** para la propina.

<!-- adaptado: el dato lo devuelve `buscar_precedente`; `--tipos` → `{tipos: true}`. -->
   El tipo de gasto sale del MISMO precedente que la cuenta, y de hecho es el
   más firme de los dos: `buscar_precedente` te lo devuelve como
   `TIPO DE GASTO 606:` — 40 suplidores tienen uno citable (con 3 facturas o
   más), y esos 40 cubren el 85% de las facturas del histórico. Sin
   precedente, elegilo del catálogo con `buscar_precedente {tipos: true}` por la
   naturaleza del documento.

   **NO pongas `cuenta_destino`**: se retiró del contrato el 2026-08-02. La
   factura no tiene UNA cuenta — la tiene cada renglón, en `lineas[].cuenta`.
   Si los renglones van todos a la misma cuenta, igual va en cada renglón; y si
   uno contradice la naturaleza de los demás (un mueble, un equipo), ese va a la
   suya y está bien que la factura quede con cuentas mezcladas. La única que
   lleva cuenta de cabecera es la sugerencia de cargo bancario, en
   `cuenta_contable`.

   **Las `lineas`, por tipo de documento** — obligatorias en toda propuesta;
   su forma depende de `documento_adm` (VendorBills | BillPayments | BankCharges
   | BankBankTransfers | Journals — son CINCO, y el tipo lo elegiste con las
   preguntas de «Qué documento de ADM es esto»), imitando la pantalla REAL de ADM:

   - **VendorBills (facturas de proveedor): lineas de ITEMS**, como la pestaña
     "Articulos y Servicios" de ADM.

     **REGLA QUE NO SE ROMPE: TODO renglon que sume al total va como item, con
     su propia cuenta contable.** No solo los productos/servicios: tambien la
     **propina legal del 10%** (restaurantes, Ley 16-92), recargos por servicio,
     impuesto selectivo al consumo, tasas, seguros, gastos administrativos,
     cargos varios y **cualquier impuesto adicional, sean los que sean**. Cada
     uno es una linea propia porque cada uno se clasifica distinto — nunca los
     sumes al precio de otro renglon ni los omitas.

     **La suma de items DEBE dar el total del documento.** Antes de cerrar la
     propuesta, verificalo vos: `sum(precio*cantidad) + sum(itbis)` contra
     `monto`, con el MISMO umbral que valida la web: diferencia < 0.05.
     Si no cuadra, te falta un renglon (casi siempre la propina legal o un
     impuesto): en el protocolo completo (sin dossier) volve al documento y
     encontralo; si venis del dossier del preparador, aplica SU regla —
     patron conocido → renglon inferido; sin patron → pregunta al humano con
     la diferencia exacta, sin releer. NO cierres una propuesta que no cuadra
     — la web la marca en rojo y no sirve para registrar.

<!-- adaptado: el chequeo del script de registro → validación dura de `proponer`. -->
     **Que sume NO alcanza.** Esa verificación la podés hacer pasar siempre:
     con la cabecera sola (total + ITBIS) elegís la base y el resto lo mandás a
     un renglón exento, y da. Por eso, si alguna línea quedó exenta, revisá
     ANTES de cerrar que ese exento salga del papel y no de la resta: probá las
     otras tasas legales (`base = itbis/tasa`) y mirá si alguna cierra con
     exento CERO. Si alguna cierra sola, esa es la tasa buena y la tuya está
     mal. La tool `proponer` corre ese mismo chequeo de cuadre y te frena ANTES
     de que el humano apruebe algo falso — antes llegaba recién en el registro.

     Ejemplo restaurante (asi debe quedar): items de comida con su ITBIS + una
     linea "Propina legal 10%" con su precio y `itbis: 0` (la propina no se
     grava) y la cuenta que corresponda. Cada item:
     `{"descripcion":"FLETE AEREO PRIORITY","cantidad":1,"precio":429.41,"grupo_impuesto":"ITBIS","itbis":77.29,"cuenta":"620.10","cuenta_nombre":"Envios y Correspondencias"}`
     — un item por renglon del documento (si la factura desglosa flete, airport
     fee, combustible, DGA, van SEPARADOS, no sumados); `precio` sin ITBIS;
     `grupo_impuesto` "ITBIS" o "Exento"; `cuenta` = la clasificacion contable
     de ESE item (pueden diferir entre items). La web muestra Subtotal =
     suma(precio*cantidad), Impuesto = suma(itbis) y Total, y valida que
     cuadren con `monto`/`itbis` de la propuesta.
   - **Journals / BankCharges / BankBankTransfers: partida doble**. Cada linea
     `{"cuenta","cuenta_nombre","descripcion","debito","credito"}` con cuentas
     EXACTAS del plan; total debitos = total creditos (la web lo marca en rojo
     si no cuadra); el ITBIS aprovechable como linea propia.

   Estas lineas seran el payload del registro real cuando la escritura se
   encienda: escribilas como si ya estuvieras llenando la pantalla de ADM.

<!-- adaptado: el insert + el UPDATE → `preguntar_al_humano`, con las DOS puertas adentro. -->
   ¿Te falta algo para decidir? Preguntá y esperá:

`preguntar_al_humano {tipo: 'pregunta', texto: "¿Este flete de Marítima
Dominicana es de la importación de julio o gasto local?"}`

   Escribe el evento y deja la fila en `esperando_respuesta` en una sola
   transacción. **Los DOS estados desde los que se pregunta**: `analizando`
   cuando estás en el análisis, y `aprobada` cuando el registro en ADM se trabó y
   necesitás al humano (el AMBIGUO del cargo bancario, por ejemplo). Con el guard
   viejo —sólo `analizando`— preguntar desde una fila aprobada escribía el evento
   y dejaba el UPDATE en CERO filas sin fallar: «UPDATE 0», la web no la mostraba
   esperando respuesta y el poller la reintentaba dos horas hasta rendirse.

<!-- adaptado: el `estado='error'` a mano → `marcar_error`, con su nota adentro. -->
9. Si algo revienta: `marcar_error {error_detalle, nota}` — el `error_detalle`
   legible y NUNCA vacío: un trabajo mudo es un trabajo perdido.
