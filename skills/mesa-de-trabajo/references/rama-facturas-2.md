<!-- Rama servida por scripts/abrir-trabajo.sh — segunda mitad del análisis de un
pendiente (precedente del proveedor, propuesta, turno, preguntas). Tajada verbatim
de a14c7d0. -->


El paso 6 del protocolo completo usa ESTA misma jerarquía:

1. **Precedente del proveedor**: `/opt/data/preentrenamiento/agg/proveedor-cuentas.json`
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
   Lo resuelve el script de arriba — por nombre o por RNC, da igual:

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

1. **Claim atómico** — con el mismo `leer-contexto.sh <id> --claim` de arriba
   (te lo hace y te trae el contexto en la misma corrida). `CLAIM: perdido` =
   otro proceso lo tomó o ya no está pendiente: PARÁ ahí, sin escribir nada.
   El SQL de referencia, por si el script no está:

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
   - **Al cerrar una subida como duplicado de un trabajo VIVO de la mesa, el
     papel no se descarta.** Si el trabajo vigente no tiene documento propio
     (`archivo_path` null — tipico de una sugerencia nacida del banco, como un
     pago de impuestos), su papel ES la subida que estas cerrando: antes de
     ponerla en `error`, anota en la propuesta del vigente
     `"comprobante_de_trabajo": "<id de la subida cerrada>"` (un `jsonb_set`
     sobre `propuesta`; las columnas `archivo_*` no las podes escribir) y deja
     un evento nota en el vigente diciendo que su comprobante vive ahi. El
     script de registro (`registrar-cargo-bancario.py`) baja ese papel con
     `bajar-documento.sh` y lo adjunta al documento en ADM. Sin este enlace el
     cargo se registra sin soporte y el papel bueno queda varado en una fila en
     `error` — paso el 2026-08-07 con el comprobante DGII del anticipo ISR de
     julio (trabajos 672eacb4 → 646ed1cf).

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

6. **Buscá precedente** — la salida de `buscar-precedente.py` YA vino en
   `leer-contexto.sh` (la corrió con el RNC del dossier): usala de ahí, y
   volvé a correrlo solo para OTRA búsqueda (`--cuenta`, `--plan`, un término
   distinto — nunca `python3 -c`). Después tu memoria y tu libro
   (`memoria/proveedores.md`, `memoria/criterios.md`, `libro-de-accion/`). El
   Alcance de cada entrada dice si aplica. Con precedente →
   `metodo='precedente'` y su `precedente_ref`. Si lo resolvió un script tuyo
   → `metodo='script'`. Caso nuevo → `metodo='razonado'`, apoyado en el
   núcleo DGII (citá la norma en `detalle`).

7. **Andá contando lo que hacés** — la web lo muestra en vivo:

```sql
insert into qualia_eventos (trabajo_id, autor, tipo, contenido)
values ('<trabajo_id>', 'contable', 'progreso', 'Recibí la factura de Sunix por RD$45,200 — la estoy revisando contra DGII y contra cómo hemos registrado a este proveedor antes.');
```

8. **Cerrá con la propuesta en UNA corrida** — escribí un JSON a
   `/tmp/mesa/<trabajo_id>/turno.json` y aplicalo:

```bash
python3 /opt/data/memoria/scripts/aplicar-propuesta.py /tmp/mesa/<trabajo_id>/turno.json
```

   Hace todo en una transacción — tus eventos de cierre, la propuesta, el
   resumen y el estado — con los guards del contrato adentro, y si el guard
   no matchea REVIENTA con el motivo (la trampa del «UPDATE 0» silencioso ya
   mordió dos veces; este script la mata). Ejemplo COMPLETO y coherente
   (VendorBills en forma de items, aritmética que cuadra:
   38,305.08 + 6,894.92 = 45,200.00):

```json
{
  "trabajo_id": "<trabajo_id>",
  "eventos": [{"tipo": "progreso", "contenido": "A este proveedor siempre lo registramos como combustible: te armé la propuesta igual que las 94 anteriores."}],
  "estado": "propuesta",
  "resumen": "Factura Isla Dominicana — RD$45,200 combustible flotilla",
  "propuesta": {"proveedor":"Isla Dominicana De Petroleo Corporation","rnc":"101008172","ncf":"E310000012345","fecha":"2026-08-01","moneda":"DOP","monto":45200.00,"itbis":6894.92,"tipo_gasto":{"codigo":"02","nombre":"Gastos por Trabajos, Suministros y Servicios"},"documento_adm":"VendorBills","lineas":[{"descripcion":"Gasoil flotilla","cantidad":1,"precio":38305.08,"grupo_impuesto":"ITBIS","itbis":6894.92,"cuenta":"620.11","cuenta_nombre":"Combustible"}],"metodo":"precedente","precedente_ref":"agg:proveedor-cuentas.json#101008172","confianza":0.95,"detalle":"Combustible de flotilla. Cuenta 620.11 por precedente: 94 de 96 usos de cuenta sobre 96 facturas históricas de este proveedor."}
}
```

   El mismo script cierra las preguntas (`"estado": "esperando_respuesta"`
   con tu evento `pregunta`) y los errores (`"estado": "error"` con
   `error_detalle`). El SQL de referencia, por si el script no está:

```sql
update qualia_trabajos
   set estado='propuesta', resumen='…', propuesta='…'::jsonb
 where id='<trabajo_id>' and empresa_id='$QUALIA_EMPRESA_ID' and estado='analizando';
```

   **Dejá el borrador del libro en la MISMA propuesta**, campo
   `borrador_libro`, mientras el análisis está fresco: al aprobarse, la
   entrada la materializa una plantilla (`escribir-libro.py`, la corre el
   poller) SIN abrirte otra sesión — usa tu borrador si está y el `detalle` a
   secas si no, y el que redacta con el caso en la cabeza sos vos ahora, no
   un turno frío tres horas después. Forma:
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

9. Si algo revienta: `estado='error'` + `error_detalle` legible + evento `nota`.

