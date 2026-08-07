# Rama «analizar lo pendiente» — la lee el trabajo nuevo (factura o sugerencia) que todavía no tiene voz del humano en el hilo.

## Si está `pendiente`: analizalo

### Paso 0 — si el hilo ya tiene voz del humano, no es un análisis nuevo

Antes de nada, mirá si alguien ya te dijo algo sobre esta fila:

```bash
psql "$QUALIA_DSN" -t -A -c "select id, tipo, contenido from qualia_eventos where trabajo_id='<trabajo_id>' and autor='usuario' order by id desc limit 5"
```

Si hay una respuesta del usuario posterior a una propuesta tuya, **estás por
repetir un análisis que ya fue corregido**: pará con esto, leé la otra rama
(`cat /opt/data/skills/qualiaconta/mesa-de-trabajo/references/rama-accion-usuario.md`,
viñeta «evento `respuesta`») y tratá lo que dijo como dato, no arranques de
cero. El
motivo del webhook puede llegar equivocado —el poke es un puntero y la base es
la única verdad— y **el dossier del preparador NO contiene eventos**: si el
documento no cambió te lo entrega idéntico al de antes de la corrección, así que
leerlo te devuelve exactamente el razonamiento que el humano acaba de rechazar.

### El dossier del preparador — mirá esto ANTES de trabajar

Antes de despertarte, un preparador determinista (`preparar-trabajo.sh`, corre
en el sidecar, sin LLM) pudo dejar el trabajo masticado en
`/tmp/mesa/<trabajo_id>/dossier.json`. El claim atómico (paso 1, abajo) sigue
siendo SIEMPRE tu primer movimiento; recién después del claim mirá el dossier:

```bash
cat /tmp/mesa/<trabajo_id>/dossier.json
```

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
  hablado, con el tono de la sección «Cómo le hablás al humano» (núcleo).
  Sin ese aviso la mesa queda muda minutos y el humano no sabe si estás vivo.

  **NO repitas lo que el dossier ya hizo** (medido 2026-08-02: re-hacer la
  visión + re-consultar DGII quemó ~80s de una corrida que ya los traía):
  - `extraccion` con campos y confianza alta → esos son tus datos. Verificá
    coherencia contra `texto.txt` o contra la aritmética, NUNCA re-leyendo la
    imagen con `vision_analyze`; si algo de verdad no cierra, aplicá la regla
    de abajo (patrón conocido → renglón inferido; sin patrón → preguntá).
    **La aritmética del ITBIS, las tres tasas legales y la regla de los
    restaurantes están en `references/ref-clasificacion.md`**, que
    `abrir-trabajo.sh` te imprime pegado a éste. No las supongas de memoria: el
    16% del art. 343 no es conocimiento general y por no tenerlo se registró la
    FP00001120 con una tasa que el papel nunca dijo.
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
  - **La cuenta contable**: seguí la sección «Cómo clasificás la cuenta» de
    `references/ref-clasificacion.md` (aplica CON y SIN dossier).

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


1. **Claim atómico** — si no devuelve fila, otro proceso lo tomó o ya no está
   pendiente: PARÁ ahí, sin escribir nada.

```sql
update qualia_trabajos set estado='analizando'
 where id='<trabajo_id>' and empresa_id='$QUALIA_EMPRESA_ID'
   and estado='pendiente' returning id;
```

2. **Bajá el documento con el script** — NUNCA manejes la URL a mano (es larga,
   lleva un JWT y varios `&`; cada vez que la copiaste de tu contexto o la
   pasaste sin comillas la rompiste y culpaste al vencimiento):

   ```bash
   ruta=$(bash /opt/data/memoria/scripts/bajar-documento.sh <trabajo_id>) || {
       # el script ya explico el motivo por stderr; dejá el trabajo en error con eso
   }
   ```

   Devuelve la ruta local del archivo por stdout y un resumen (tamaño y qué
   herramienta usar) por stderr. Si falla, usá SU mensaje como `error_detalle`
   — no inventes "URL vencida" sin haberlo comprobado.

   **Trampa que ya te comió un turno:** no encadenes el script con comandos que
   quizá no existan en la imagen (`file` NO está instalado; `&& file ...` te
   devuelve exit 127 y vas a creer que la descarga falló cuando en realidad
   salió bien). Corré el script SOLO. Si imprimió una ruta, el archivo está ahí.

   **Y si en el hilo hay notas tuyas anteriores diciendo que la URL venció:
   ignoralas.** Fueron errores tuyos de manejo, no del archivo. Comprobá siempre
   con el script antes de repetir ese diagnóstico.

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

   Si es Excel (.xlsx — nómina u otro), bajalo y leelo con Python
   (openpyxl/pandas); una nómina se propone como su asiento completo
   (bruto, TSS, retenciones, neto) según el criterio de tu memoria.

   Fotos (jpg/png/webp): analizalas con el tool de visión (`vision_analyze`)
   DESPUÉS de bajarlas a archivo local, nunca sobre la URL. Si viene `.heic`
   (iPhone), convertila antes a jpg con pillow-heif vía uv:

   ```bash
   uv run --with pillow-heif python -c "import pillow_heif, PIL.Image as I; pillow_heif.register_heif_opener(); I.open('/tmp/mesa-<id>.heic').convert('RGB').save('/tmp/mesa-<id>.jpg')"
   ```

4. **Chequeá duplicados ANTES de proponer** (el NCF es unico por emisor):
   - En la mesa: otro trabajo con el mismo NCF —
     `psql ... "select id, estado from qualia_trabajos where empresa_id='$QUALIA_EMPRESA_ID' and propuesta->>'ncf' = '<NCF>' and id != '<trabajo_id>' and propuesta->'registro_adm'->>'eliminado_en' is null and propuesta->'registro_adm'->>'anulado_en' is null"` —
     si existe y no esta rechazada/error: este trabajo va a `error` con
     `error_detalle='Duplicada: mismo NCF que el trabajo <id>'` y un evento nota.
     **Un trabajo cuyo documento ADM ya no cuenta —`eliminado_en` o `anulado_en`
     en `registro_adm`— NO es un duplicado**, y por eso el query de arriba lo
     descarta: ese gasto quedo SIN registrar, y volver a subir el papel es justo
     lo que corresponde hacer. Sin ese corte la resubida caia en `error` para
     siempre, porque la fila vieja se queda en `registrada` —que no es rechazada
     ni error— aunque el documento ya no exista (paso el 2026-08-04 con la
     FP00001120 de Carrefour, borrada en ADM).
   - Contra ADM: busca el NCF en el historico local
     (`grep <NCF> /opt/data/preentrenamiento/raw/vendor-bills*.jsonl`) y, si no
     aparece, en las paginas recientes de VendorBills por API (GET). Si YA esta
     registrada: propuesta con `"posible_duplicado": {"docid": "FPxxxxx", "donde": "ADM"}`
     y confianza baja — la web lo muestra en rojo y el humano decide. El
     historico local es una FOTO vieja: si el NCF aparece ahi, confirma por API
     que el docid sigue existiendo antes de marcar nada — un documento eliminado
     en ADM no es un duplicado, es el que hay que volver a registrar.
     Para hablarle a la API de ADM usá `admcloud-get.sh` de la skill hermana
     `consultar-admcloud`
     (`/opt/data/skills/qualiaconta/consultar-admcloud/scripts/admcloud-get.sh`):
     trae host, credenciales y pagina solo. Sin él esta regla se cumple de
     mentira — te quedás con el histórico local, que dos renglones más arriba
     se llama a sí mismo «una FOTO vieja».

5. **Verificá el comprobante contra DGII — SIEMPRE llená el campo `dgii`**, aun
   cuando no aplique. Nunca lo dejes vacío: quien mira la propuesta no puede
   distinguir "no aplica" de "se me olvidó".

   **(a) NCF impreso (B01, B02, B04, B14, B15...): consultá si está autorizado.**
   No tiene QR ni timbre — eso es solo de los electrónicos. Se consulta con el
   script (verificado 2026-08-02 contra NCF reales; devuelve JSON):

   ```bash
   python3 /opt/data/memoria/scripts/consultar-ncf-dgii.py --rnc <rnc_emisor> --ncf <ncf>
   ```

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

   (para facturas de consumo la variante es /ecf/ConsultaTimbreFC). Hace curl
   y parsea la tabla HTML. Guarda el resultado en la propuesta:
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

   El preparador ya lo consulta por vos y lo deja en `rnc_emisor` del dossier
   (clave aparte de `dgii`, nunca mezcladas). Si falta o querés reconsultar:

   ```bash
   python3 /opt/data/memoria/scripts/consultar-rnc-dgii.py --rnc <rnc_emisor>
   ```

   Devuelve `estado` ENCONTRADO (con `razon_social`, `nombre_comercial`,
   `estado_contribuyente`, `actividad_economica`), NO ENCONTRADO, `formato
   invalido` o `no verificable` con su motivo. Es la web
   `dgii.gov.do/.../consultas/rnc.aspx`, sin captcha (verificado 2026-08-03).

   **Copiá su salida tal cual a la propuesta, en `"rnc_padron"`** (hermana de
   `"dgii"`, nunca dentro). `registrar-en-adm.py` la lee de ahí para nombrar al
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

6. **Buscá precedente** — primero `buscar-precedente.py` (nunca `python3 -c`),
   con la jerarquía de «Cómo clasificás la cuenta» de
   `references/ref-clasificacion.md`, y después
   tu memoria y tu libro (`memoria/proveedores.md`,
   `memoria/criterios.md`, `libro-de-accion/`). El Alcance de cada entrada dice
   si aplica. Con precedente → `metodo='precedente'` y su `precedente_ref`. Si
   lo resolvió un script tuyo → `metodo='script'`. Caso nuevo →
   `metodo='razonado'`, apoyado en el núcleo DGII (citá la norma en `detalle`).

7. **Andá contando lo que hacés** — la web lo muestra en vivo:

```sql
insert into qualia_eventos (trabajo_id, autor, tipo, contenido)
values ('<trabajo_id>', 'contable', 'progreso', 'Recibí la factura de Sunix por RD$45,200 — la estoy revisando contra DGII y contra cómo hemos registrado a este proveedor antes.');
```

8. **Cerrá con la propuesta** — la forma del contrato NO está en este archivo:
   vive en `references/ref-clasificacion.md`, que `abrir-trabajo.sh` te imprime
   pegado a éste. Ahí está el ejemplo completo, el `tipo_gasto` obligatorio, el
   cuadre de los ítems y por qué «que sume NO alcanza».


9. Si algo revienta: `estado='error'` + `error_detalle` legible + evento `nota`.

