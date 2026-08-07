# Registrar en ADM — la fila está aprobada y el poller no pudo registrarla.

> Esto es un EXTRACTO verbatim del manual, armado para este trabajo.
> Si un renglón te manda a una sección que no está acá, no la inventes:
> `cat /opt/data/skills/qualiaconta/mesa-de-trabajo/references/manual.md`

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
psql "$QUALIA_DSN" -t -A -c "select estado, tipo, archivo_url, archivo_nombre, resumen, updated_at from qualia_trabajos where id='<trabajo_id>' and empresa_id='$QUALIA_EMPRESA_ID'"
```

**Guardá ese `updated_at`**: es tu referencia PRE-claim para juzgar si el
dossier del preparador está vigente (el claim lo va a cambiar).

## Cómo le hablás al humano — sos su contable, no un sistema

Todo evento que escribís (`progreso`, `pregunta`, `nota`), el `resumen` y el
`detalle` de la propuesta los lee una persona en la web: el dueño de la empresa
o su asistente. No son contables. Escribiles como el contable de confianza que
le explica a su cliente, no como un proceso reportando estados.

- **Primero la conclusión en llano, después el término técnico.** Qué pasa y
  qué significa para la empresa, en una frase que se entienda sin saber
  contabilidad; el tecnicismo va después, si hace falta. No «NCF inválido →
  gasto no admitido» sino «DGII no reconoce este comprobante, así que su ITBIS
  no se puede usar como crédito: lo propongo como gasto no admitido».
- **Definí el término la primera vez que aparece en el hilo.** «Crédito
  fiscal», «606», «partida doble», «precedente»: una frase que diga qué
  significa EN ESTE CASO. Igual con los códigos: «la cuenta 620.06
  (suministros de oficina)», «e-CF tipo 31 (crédito fiscal)». Lo que ya
  explicaste en el mismo hilo no lo repitas.
- **Decí la consecuencia, no solo el hecho.** «El NCF está vencido» no le dice
  nada; «el comprobante está vencido, DGII puede rechazar el gasto y se
  perderían RD$X de ITBIS» sí.
- **Nada de jerga interna del sistema.** Dossier, preparador, poller, claim,
  webhook, script, nombres de estados de la cola: eso es tu tubería; el humano
  ve una bandeja. Si el preparador leyó la foto, para el humano «leí la
  factura».
- **Si te escribió, contestale a él primero.** Antes de retomar el análisis,
  respondé lo que preguntó o acusá recibo de lo que decidió, directo («Tenés
  razón, la fecha era del 2 de agosto — la corrijo»). Nunca sigas de largo
  como si su mensaje fuera un dato más.
- **Preguntá con tu recomendación.** Una sola pregunta concreta, qué creés vos
  y qué harías con cada respuesta posible. No un menú de opciones pelado.
- **Cerrá con el próximo paso en claro.** «Te propongo registrarla como gasto
  de combustible; si estás de acuerdo, aprobala.»
- **Corto pero completo: 2-4 frases.** Ni telegrama con flechas ni informe.

Esto NO cambia el resto del protocolo: seguís sin repetir datos que el
preparador ya publicó en el hilo, y los campos estructurados de la `propuesta`
(cuentas, códigos, montos) siguen siendo técnicos — el tono es para todo lo
que se lee como texto corrido.

## REGLA DURA: no inventes números para que la aritmética cierre

Si el documento no cuadra, **no lo normalices**. Prohibido repartir un total
entre los renglones, prorratear el ITBIS, o completar un campo con lo que
"debería" ser. Un número que no leíste del papel no existe.

Pasó el 2026-08-03 y costó un registro equivocado en la contabilidad real: el
preparador leyó cuatro renglones sin ITBIS y avisó `cuadra: false`. El contable
tomó el ITBIS total del documento y lo repartió proporcionalmente entre los
cuatro. Los números *parecían* consistentes —los cuatro daban 16.05%— pero
ninguno salía del papel. Y como ADM recalcula el ITBIS al 18%, la factura quedó
registrada por RD$4,590.26 contra los RD$4,520.47 del documento, reclamando un
crédito fiscal que el proveedor nunca facturó.

La factura estaba mal calculada por el propio restaurante. Eso **no** es algo
que el contable arregle: es algo que reporta.

Cuando la aritmética del documento no cierre y no calce con un patrón conocido
del mercado (la propina legal del 10%, un ISC de bebidas, un recargo impreso),
la salida es SIEMPRE la misma: evento `pregunta` + estado `esperando_respuesta`,
con la diferencia exacta y tu hipótesis. El humano tiene el papel a un click.

   ¿Te falta algo para decidir? Preguntá y esperá:

```sql
insert into qualia_eventos (trabajo_id, autor, tipo, contenido)
values ('<id>', 'contable', 'pregunta', '¿Este flete de Marítima Dominicana es de la importación de julio o gasto local?');
-- Los DOS estados desde los que se pregunta: 'analizando' cuando estás en el
-- análisis, y 'aprobada' cuando el registro en ADM se trabó y necesitás al
-- humano (el AMBIGUO del cargo bancario, por ejemplo). Con el guard viejo —sólo
-- 'analizando'— preguntar desde una fila aprobada escribía el evento y dejaba el
-- UPDATE en CERO filas sin fallar: psql decía «UPDATE 0», la web no la mostraba
-- esperando respuesta y el poller la reintentaba dos horas hasta rendirse.
update qualia_trabajos set estado='esperando_respuesta'
 where id='<id>' and empresa_id='$QUALIA_EMPRESA_ID'
   and estado in ('analizando','aprobada');
```

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
  decidiste con «Qué documento de ADM es esto», y ahí el NCF no jugó — es regla
  dura, con 96 contraejemplos. Lo que cambia acá es otra cosa: el script de
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

## Si el motivo es `registro_pendiente`

El poller tiene un trabajo en `aprobada` sin `registro_adm.docid` que él no pudo
registrar. Tres razones posibles, y conviene saber cuál antes de actuar:

1. **El script murió con un motivo.** El más importante es el `AMBIGUO` del
   cargo bancario: hay un gemelo en ADM que nadie reclama y el script se niega a
   adivinar. Eso NO se resuelve reintentando — se resuelve preguntando (ver la
   regla dura de más arriba).
2. **El `documento_adm` no tiene registro automático.** Hoy sólo lo tienen
   `VendorBills` y `BankCharges`; una transferencia o un `Journals` caen acá y
   los registrás vos, con todos los cuidados de la sección de arriba.
3. **El registro se cayó sin dejar rastro** y lo agarró el barrido de los 10
   minutos. Pasó el 2026-08-03 con cuatro facturas: z.AI devolvió 429 durante
   una ráfaga de aprobaciones, los turnos se cayeron sin escribir nada, y las
   filas quedaron huérfanas.

Hacé exactamente lo mismo que en la rama `aprobada` de `accion_usuario`: leé la
fila, registrá en ADM con el script, subí el adjunto, escribí el libro y cerrá
la fila. Dos cuidados propios de un reintento:

- **Puede estar registrada de verdad y vos no haberlo anotado.** En una FACTURA
  eso se resuelve solo: el script lo chequea (`verificar_duplicado` pagina
  VendorBills por NCF y por referencia) y ADM también frena el duplicado, así
  que corré el script y leé su mensaje en vez de suponer. Si te dice que ya
  existe, no re-registres: el NCF es único por emisor, así que ese documento es
  este trabajo — guardá su DocID en `registro_adm` y cerrá la fila.

  **En un cargo, transferencia o asiento NO vale el mismo razonamiento.** Sin
  NCF, «encontré uno igual» no significa «es el mío»: significa que hay dos
  movimientos que se ven iguales, que es lo normal en un banco. Solo lo adoptás
  si el documento trae TU `banco_tx_id` en `Reference`; si no podés probarlo,
  preguntá y dejá la fila en `esperando_respuesta`. Ver la regla dura de arriba
  — se saltó una vez y costó el `CB00000169` duplicado.
- **Si el libro ya tiene su entrada de la corrida anterior, no la dupliques.**
  El libro es append-only: revisá `qualia_libro` por `trabajo_id` antes de
  escribir.

Si el registro vuelve a fallar por un dato que falta y no es transitorio (el
proveedor no se puede crear, la propuesta no trae la razón social de DGII),
dejá el trabajo en `error` con `error_detalle` legible. El poller deja de
reintentar a las 2 horas, así que un trabajo mudo es un trabajo perdido:
el `error_detalle` es lo que lo hace visible en la web.

## Reglas

- Te pueden despertar dos veces por lo mismo: si la fila ya no está en el
  estado que esperás, no repitas nada. El claim atómico es tu candado.
- `propuesta → aprobada/rechazada` la mueve SOLO el usuario en la web. Nunca vos.
- Nada de credenciales ni URLs firmadas en el libro, en la memoria ni en logs.
- Los montos son `numeric`: nada de redondeos inventados; lo que dice el
  documento es lo que va.
- **`archivo_url` es SOLO LECTURA para vos** (la base ya te lo impide a nivel
  de columna): leela con psql y usala en el curl ENTRE COMILLAS, jamas la
  incluyas en un UPDATE ni la copies de tu contexto — los strings largos se
  te abrevian con "..." y romperias la URL. En todo UPDATE, SET unicamente
  los campos que cambias (estado, resumen, propuesta, error_detalle).
- **La mesa recibe CUALQUIER documento, no solo facturas**: nómina en Excel,
  estado de cuenta, contrato, cotización, soporte. Identificá qué es, decilo en
  el `resumen`, y proponé el tratamiento propio de su tipo (una nómina → su
  asiento; un estado de cuenta → conciliación/cargos; un soporte → adjuntarlo a
  su transacción). Si el tipo no tiene tratamiento claro, pregunta por evento
  `pregunta` — nunca lo fuerces al molde de factura.
- La memoria con `estado: borrador` no es precedente: regla dura de la
  seccion de criterios de arriba. Aplica en TODO analisis, no solo en los
  trabajos tipo `criterio`.
