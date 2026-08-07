# Referencia «qué documento y qué cuenta» — la leen la rama de análisis, la rama del caso, y cualquier turno en que haya que reclasificar.

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

Preguntá en este orden; la primera que dé SÍ, gana:

1. **¿El movimiento nació en tu estado de cuenta, sin que nadie te entregara un
   documento previo?** (comisión, cargo por cheque, interés, sobregiro,
   cashback, y los impuestos que el banco te descuenta como agente de
   retención: Ley 30-26 2x1000, el 0,15% de cheques, el 1% Norma 07-19)
   → **`BankCharges`**, con `direccion` explícita (`cargo` = sale plata,
   `credito` = entra).
   **Que el beneficiario final sea la DGII NO lo saca de acá**: 51 de los 92
   cargos que esta mesa ya registró bien son exactamente eso. El corte no es
   quién cobra al final, es que el hecho nació en la cuenta y no hubo papel que
   recibieras y decidieras pagar.
2. **¿La plata salió de una cuenta tuya y entró a otra cuenta tuya?** — la
   tarjeta corporativa también es cuenta tuya: 203.10 y 203.11 son cuentas de
   caja en ADM aunque su código viva en el pasivo → **`BankBankTransfers`**.
3. **¿Estás cancelando una obligación que ADM YA tiene registrada** (una factura
   con saldo abierto)? → **`BillPayments`** (prefijo `PP`, módulo BANCO, no
   Compras). No crea gasto: debita Cuentas por Pagar y acredita la caja. El
   saldo lo dice SOLO `/api/AP`.
4. **¿Un tercero te entregó algo, o te liquidó una obligación, y de eso hay un
   documento que recibiste?** → **`VendorBills`**, tenga NCF o no lo tenga, y
   sea quien sea el tercero. **Que sea el Estado no cambia nada: la DGA es un
   proveedor** —10 de 10 liquidaciones históricas, FP00000049 … FP00001018—, y
   el banco también lo es: es el proveedor #1 de esta empresa con 203 facturas.
   «Banco» y «proveedor» NO son excluyentes.
5. Si ninguna aplica y el hecho es puro devengo sin caja (nómina, TSS, INFOTEP,
   ISR de empleados) → **`Journals`**. **Es el último recurso, no el cajón de
   sastre**: los asientos quedan FUERA del cruce de la conciliación bancaria a
   propósito. Si tu asiento toca una cuenta 101.xx o 102.xx y no tenés
   precedente citable del MISMO hecho, **pará y preguntá** — el cashback de
   RD$70,84 de la Visa 1877 entró como asiento (ED00000183) y quedó como
   diferencia eterna.

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
| `BillPayments` | la cuenta de caja que pagó | partida doble |
| `BankCharges` | la cuenta de caja o la tarjeta | partida doble + `direccion` |
| `BankBankTransfers` | las dos cuentas de caja | partida doble |
| `Journals` | lo que declaren tus líneas | partida doble |

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

**Un solo comando resuelve los niveles 1 y 3 de abajo** (el nivel 2, tu memoria
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
La prohibición es para CONSULTAR LOS AGG y nada más: la conversión de HEIC
(`uv run --with pillow-heif python -c ...`) sigue igual de válida —
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

El paso «Buscá precedente» del protocolo completo (`references/rama-pendiente.md`)
usa ESTA misma jerarquía:

1. **Precedente del proveedor**: `/opt/data/preentrenamiento/agg/proveedor-cuentas.json`
   — con qué cuenta registró la contabilidad REAL las facturas de ESE
   proveedor (1,050 facturas destiladas). Si el proveedor está y su cuenta
   dominante tiene ≥70% de usos: ese es tu punto de partida,
   `metodo='precedente'` con `precedente_ref='agg:proveedor-cuentas.json#<rnc-o-nombre>'`
   citando "N de M facturas históricas" en `detalle`. **Excepción explícita a
   la «REGLA DURA — un borrador no es precedente» del núcleo**: este agg NO es
   memoria en borrador — es
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
   Lo resuelve `buscar-precedente.py` — por nombre o por RNC, da igual:

   ```bash
   python3 /opt/data/memoria/scripts/buscar-precedente.py tupaq
   python3 /opt/data/memoria/scripts/buscar-precedente.py 132942248
   ```

2. **Tu memoria curada** (`memoria/proveedores.md`, criterios RATIFICADOS)
   si matiza o contradice el precedente crudo — lo ratificado manda sobre el agg.

3. **Proveedor nuevo sin precedente**: el script ya te lo dijo con
   `SIN PRECEDENTE PARA "..."`, y en ese mismo bloque te imprimió **todas las
   cuentas que la contabilidad real usa** (el encabezado dice cuántas), con su
   nombre exacto y cuántos proveedores las usan. Razonás (`metodo='razonado'`) eligiendo de ESA lista
   por la naturaleza del renglón — **no inventes una categoría**: ADM no tiene
   categorías de proveedor, y un "39 restaurantes históricos" improvisado es
   justo el error que se cometió el 2026-08-02 (eran 39 proveedores de la
   cuenta, con supermercados adentro).
   Para ver quién más usa una cuenta antes de decidirte:

   ```bash
   python3 /opt/data/memoria/scripts/buscar-precedente.py --cuenta 611.17
   ```

   No busques la cuenta por palabra clave adivinada: "viaje" no encuentra
   "Dieta y Viáticos". Leé los nombres de la lista. Y si de verdad ninguna
   encaja, el plan completo tiene 215 cuentas — `--plan <palabra>` — pero salir
   de las cuentas en uso hay que justificarlo en `detalle`.

**La extracción del dossier es auto-generada: tratála como borrador a validar,
no como verdad.** Solo el XML e-CF (`confianza: alta`) es dato exacto; lo demás
salió de regex sobre texto o de una pasada de visión y puede leer mal un dígito.
Nada del dossier te exime del juicio contable: la cuenta, el precedente y la
propuesta siguen siendo tuyos.

## La aritmética del documento — antes de repartir nada

Lo lee todo el que escribe o REESCRIBE una propuesta. Vivía dentro del paso del
dossier de `references/rama-pendiente.md`, y ahí la veía sólo el análisis nuevo:
el turno en que el humano corrige un monto —10 de cada 19 correcciones reales—
recibía «probá las otras tasas legales» sin que nadie le dijera cuáles son.

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


## Cómo se escribe la propuesta — la forma del contrato

**Si la propuesta resuelve un movimiento del banco, `banco_tx_id` va SIEMPRE,
y sobrevive a cada reescritura.** El paso 8 pisa la `propuesta` entera, no la
mezcla: si al corregir no lo volvés a poner, desaparece. Y no es adorno — la
mesa descarta de su lista de movimientos sin conciliar los que algún trabajo ya
reclamó, y ese descarte mira `banco_tx_id`. Sin él, el mismo movimiento vuelve
a Sugerencias mientras su solución ya está propuesta, y la misma plata se
cuenta dos veces.

Lo lee todo el que ESCRIBE una propuesta: el análisis nuevo, el turno en que el
humano corrige una que ya habías mandado, y el caso cuando abre sus trabajos
hijos. Conserva la numeración del protocolo de `references/rama-pendiente.md`,
que es de donde salió.

8. **Cerrá con la propuesta** (jsonb con la forma del contrato) y el `resumen`.
   Ejemplo COMPLETO y coherente (VendorBills en forma de items, aritmética que
   cuadra: 38,305.08 + 6,894.92 = 45,200.00):

```sql
update qualia_trabajos
   set estado='propuesta',
       resumen='Factura Isla Dominicana — RD$45,200 combustible flotilla',
       propuesta='{"proveedor":"Isla Dominicana De Petroleo Corporation","rnc":"101008172","ncf":"E310000012345","fecha":"2026-08-01","moneda":"DOP","monto":45200.00,"itbis":6894.92,"tipo_gasto":{"codigo":"02","nombre":"Gastos por Trabajos, Suministros y Servicios"},"documento_adm":"VendorBills","lineas":[{"descripcion":"Gasoil flotilla","cantidad":1,"precio":38305.08,"grupo_impuesto":"ITBIS","itbis":6894.92,"cuenta":"620.11","cuenta_nombre":"Combustible"}],"metodo":"precedente","precedente_ref":"agg:proveedor-cuentas.json#101008172","confianza":0.95,"detalle":"Combustible de flotilla. Cuenta 620.11 por precedente: 94 de 96 usos de cuenta sobre 96 facturas históricas de este proveedor."}'::jsonb
 where id='<trabajo_id>' and empresa_id='$QUALIA_EMPRESA_ID' and estado='analizando';
```

   **`tipo_gasto` es OBLIGATORIO en toda factura** y es un eje DISTINTO de la
   cuenta contable — no los confundas:

   - **Tipo de gasto** = la clasificación DGII del **606**, catálogo fijo 01-11,
     **UNA por documento**. Es lo que ADM pide en la cabecera de la factura.
     Forma: `"tipo_gasto":{"codigo":"05","nombre":"Gastos de Representación"}`.
   - **Cuenta contable** = dónde impacta el asiento, **por renglón**.

   Un restaurante ilustra los dos a la vez: tipo de gasto **05 Representación**
   para toda la factura, y por renglón la cuenta **611.17 Dieta y Viáticos** para
   el consumo más **690.06 Propina Legal** para la propina.

   El tipo de gasto sale del MISMO precedente que la cuenta, y de hecho es el
   más firme de los dos: `buscar-precedente.py` te lo imprime como
   `TIPO DE GASTO 606:` — 40 suplidores tienen uno citable (con 3 facturas o
   más), y esos 40 cubren el 85% de las facturas del histórico. Sin
   precedente, elegilo del catálogo con `--tipos` por la naturaleza del
   documento.

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

     **Que sume NO alcanza.** Esa verificación la podés hacer pasar siempre:
     con la cabecera sola (total + ITBIS) elegís la base y el resto lo mandás a
     un renglón exento, y da. Por eso, si alguna línea quedó exenta, revisá
     ANTES de cerrar que ese exento salga del papel y no de la resta: probá las
     otras tasas legales (`base = itbis/tasa`) y mirá si alguna cierra con
     exento CERO. Si alguna cierra sola, esa es la tasa buena y la tuya está
     mal. El script de registro tiene el mismo chequeo y te va a frenar ahí
     (`verificar_cuadre`), pero para entonces el humano ya aprobó algo falso.

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
