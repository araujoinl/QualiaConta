---
name: mesa-de-trabajo
description: "Atiende la mesa de trabajo web: facturas que suben desde Labs_Inv, propuesta de registro, aprobaciones y libro. Lee y escribe la cola qualia_* por SQL. Se activa por el webhook mesa."
version: 1.0.0
author: QualiaConta
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [Contabilidad, Mesa, Facturas, Registro]
prerequisites:
  env: [QUALIA_DSN, QUALIA_EMPRESA_ID]
  commands: [psql, curl]
---

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
psql "$QUALIA_DSN" -t -A -c "select estado, tipo, archivo_url, archivo_nombre, resumen from qualia_trabajos where id='<trabajo_id>' and empresa_id='$QUALIA_EMPRESA_ID'"
```

## Si está `pendiente`: analizalo

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
  tras leer el dossier es UN evento `progreso` corto anunciando tu plan** — en
  el MISMO comando psql del claim si podés — p.ej. «Dossier recibido: GUAN LAN,
  RD$4,520.47, NCF inválido en DGII → preparo la propuesta de gasto no
  admitido». Sin ese aviso la mesa queda muda minutos y el humano no sabe si
  estás vivo.

  **NO repitas lo que el dossier ya hizo** (medido 2026-08-02: re-hacer la
  visión + re-consultar DGII quemó ~80s de una corrida que ya los traía):
  - `extraccion` con campos y confianza alta → esos son tus datos. Verificá
    coherencia contra `texto.txt` o contra la aritmética, NUNCA re-leyendo la
    imagen con `vision_analyze` salvo incoherencia REAL (abajo).
    **La aritmética correcta** (corrección del dueño, 2026-08-02): el ITBIS es
    18% de la BASE GRAVADA, JAMÁS del total. La verificación es:
    `base = itbis/0.18` y `base + itbis + exentos + propina/cargos == monto`.
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
  - `duplicados` del dossier → decidís con eso. No re-busques.
  - `extraccion.items` (fotos): esa ES tu tabla de líneas — mapeale la cuenta
    a cada item y armá la propuesta con ellos, SIN re-leer la imagen. Si
    `extraccion.aritmetica.cuadra` es true, no busques renglones que falten;
    si es false, aplicá la regla de arriba: pregunta al humano con la
    diferencia exacta — nada de relecturas.
  - **La cuenta contable, en este orden y en UN turno cada intento**
    (PROHIBIDO greppear `preentrenamiento/raw/` para cuentas):
    1. **Precedente del proveedor**: `/opt/data/preentrenamiento/agg/proveedor-cuentas.json`
       — con qué cuenta registró la contabilidad REAL las facturas de ESE
       proveedor (1,050 facturas destiladas). Si el proveedor está y su
       cuenta dominante tiene ≥70% de usos: ese es tu punto de partida,
       `metodo='precedente'` citando "N de M facturas históricas".
       **El precedente es un default POR ITEM, jamás un sello a ciegas**
       (regla del dueño, 2026-08-02): leé la descripción de CADA renglón —
       si un item contradice la naturaleza de la cuenta dominante (un mueble,
       un equipo, algo capitalizable = activo depreciable; mercancía para
       revender = inventario), ESE item se clasifica por su naturaleza, con
       la explicación en `detalle`. La misma factura puede mezclar cuentas
       por item — eso es lo correcto, no una anomalía. Forma:
       `{"_meta", "proveedores": [{"nombre", "rnc", "facturas", "cuentas": [{"codigo","nombre","usos","pct"}]}]}`.
       Receta (buscá por nombre o RNC):

       ```bash
       python3 -c "import json; [print(p['nombre'],'|',p['facturas'],'facturas:',[(c['codigo'],c['nombre'],str(c['pct'])+'%') for c in p['cuentas'][:3]]) for p in json.load(open('/opt/data/preentrenamiento/agg/proveedor-cuentas.json'))['proveedores'] if 'tupaq' in p['nombre'].lower() or p.get('rnc')=='132942248']"
       ```
    2. **Tu memoria curada** (`memoria/proveedores.md`, criterios ratificados)
       si matiza o contradice el precedente crudo.
    3. **Proveedor nuevo sin precedente**: recién ahí razonás con el plan
       `/opt/data/preentrenamiento/agg/plan-cuentas.json` — forma
       `{"_meta": {...}, "cuentas": [{"codigo", "nombre", "tipo", "clase", ...}]}`:

       ```bash
       python3 -c "import json; [print(c['codigo'],'|',c['nombre'],'|',c['tipo']) for c in json.load(open('/opt/data/preentrenamiento/agg/plan-cuentas.json'))['cuentas'] if 'represent' in (c['nombre'] or '').lower()]"
       ```

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
  `updated_at` actual de la fila): protocolo completo, pasos 2-9, como siempre.

**La extracción del dossier es auto-generada: tratála como borrador a validar,
no como verdad.** Solo el XML e-CF (`confianza: alta`) es dato exacto; lo demás
salió de regex sobre texto o de una pasada de visión y puede leer mal un dígito.
Nada del dossier te exime del juicio contable: la cuenta, el precedente y la
propuesta siguen siendo tuyos.

1. **Claim atómico** — si no devuelve fila, otro proceso lo tomó o ya no está
   pendiente: PARÁ ahí, sin escribir nada.

```sql
update qualia_trabajos set estado='analizando'
 where id='<trabajo_id>' and estado='pendiente' returning id;
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
     `psql ... "select id, estado from qualia_trabajos where empresa_id='$QUALIA_EMPRESA_ID' and propuesta->>'ncf' = '<NCF>' and id != '<trabajo_id>'"` —
     si existe y no esta rechazada/error: este trabajo va a `error` con
     `error_detalle='Duplicada: mismo NCF que el trabajo <id>'` y un evento nota.
   - Contra ADM: busca el NCF en el historico local
     (`grep <NCF> /opt/data/preentrenamiento/raw/vendor-bills*.jsonl`) y, si no
     aparece, en las paginas recientes de VendorBills por API (GET). Si YA esta
     registrada: propuesta con `"posible_duplicado": {"docid": "FPxxxxx", "donde": "ADM"}`
     y confianza baja — la web lo muestra en rojo y el humano decide.

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

   **(b) e-NCF (E31/E32/E34...): verificá el timbre.** La representacion
   impresa trae Fecha de Firma y Codigo de Seguridad (6 chars) — extraelos del
   texto del PDF. Construi la URL publica de consulta (la misma del QR):

   `https://ecf.dgii.gov.do/ecf/ConsultaTimbre?RncEmisor=<rnc>&RncComprador=<rnc_blackbox>&ENCF=<encf>&FechaEmision=DD-MM-AAAA&MontoTotal=<total>&FechaFirma=DD-MM-AAAA%20HH:MM:SS&CodigoSeguridad=<code>`

   (para facturas de consumo la variante es /ecf/ConsultaTimbreFC). Hace curl
   y parsea la tabla HTML. Guarda el resultado en la propuesta:
   `"dgii": {"estado":"Aceptado","rnc_emisor":"...","razon_social_emisor":"...","rnc_comprador":"...","razon_social_comprador":"...","encf":"...","fecha_emision":"...","total_itbis":11.96,"monto_total":163.26,"verificado_en":"<ISO timestamp>"}`.
   - Estado != Aceptado, o los montos de DGII no cuadran con lo que extrajiste
     del PDF → baja la confianza y decilo en `detalle` (posible factura
     adulterada o mal leida).
   - Sin codigo de seguridad legible o DGII inaccesible → `"dgii": {"estado":"no verificable","motivo":"..."}` — nunca inventes el resultado.

6. **Buscá precedente** en tu memoria y tu libro (`memoria/proveedores.md`,
   `memoria/criterios.md`, `libro-de-accion/`). El Alcance de cada entrada dice
   si aplica. Con precedente → `metodo='precedente'` y su `precedente_ref`. Si
   lo resolvió un script tuyo → `metodo='script'`. Caso nuevo →
   `metodo='razonado'`, apoyado en el núcleo DGII (citá la norma en `detalle`).

7. **Andá contando lo que hacés** — la web lo muestra en vivo:

```sql
insert into qualia_eventos (trabajo_id, autor, tipo, contenido)
values ('<trabajo_id>', 'contable', 'progreso', 'Leí la factura: Sunix, RD$45,200');
```

8. **Cerrá con la propuesta** (jsonb con la forma del contrato) y el `resumen`:

```sql
update qualia_trabajos
   set estado='propuesta',
       resumen='Factura Sunix — RD$45,200 gasoil',
       propuesta='{"proveedor":"Sunix Petroleum SRL","rnc":"101-89755-2","ncf":"E310000012345","fecha":"2026-08-01","moneda":"DOP","monto":45200.00,"itbis":6890.85,"cuenta_destino":"6120-01 Combustibles","documento_adm":"VendorBills","lineas":[{"cuenta":"6120-01","cuenta_nombre":"Combustibles","descripcion":"Gasoil flotilla","debito":38309.15,"credito":0},{"cuenta":"1180-02","cuenta_nombre":"ITBIS adelantado","descripcion":"ITBIS 18% credito fiscal","debito":6890.85,"credito":0},{"cuenta":"2110-01","cuenta_nombre":"CxP Sunix Petroleum","descripcion":"Total factura a credito 30d","debito":0,"credito":45200.00}],"metodo":"precedente","precedente_ref":"libro-de-accion/2026-07-30-sunix-combustible.md","confianza":0.95,"detalle":"Gasoil flotilla. ITBIS no aprovechable (NG 07-2007 art. 3)."}'::jsonb

   **`lineas` es obligatorio en toda propuesta** y su forma depende de
   `documento_adm` (VendorBills | Journals | BankCharges | BankBankTransfers),
   imitando la pantalla REAL de ADM:

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
     propuesta, verificalo vos: `sum(precio*cantidad) + sum(itbis) == monto`.
     Si no cuadra, te falta un renglon (casi siempre la propina legal o un
     impuesto): en el protocolo completo (sin dossier) volve al documento y
     encontralo; si venis del dossier del preparador, aplica SU regla —
     pregunta al humano con la diferencia exacta, sin releer. NO cierres una
     propuesta que no cuadra — la web la marca en rojo y no sirve para
     registrar.

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
 where id='<trabajo_id>' and estado='analizando';
```

   ¿Te falta algo para decidir? Preguntá y esperá:

```sql
insert into qualia_eventos (trabajo_id, autor, tipo, contenido)
values ('<id>', 'contable', 'pregunta', '¿Este flete de Marítima Dominicana es de la importación de julio o gasto local?');
update qualia_trabajos set estado='esperando_respuesta'
 where id='<id>' and estado='analizando';
```

9. Si algo revienta: `estado='error'` + `error_detalle` legible + evento `nota`.

## Si el motivo es `accion_usuario`

Mirá el último evento con `autor='usuario'` del trabajo y el estado actual:

- **`aprobada`**: escribí la entrada en tu libro de acción — archivo NUEVO en
  `libro-de-accion/` (append-only, jamás editar uno existente), con **Aprobó:**
  el `aprobado_por_nombre` de la fila, «por la mesa web», y su **Alcance**.
  Espejala en la tabla para la vista web:

```sql
insert into qualia_libro (empresa_id, trabajo_id, entrada, metodo, precedente_ref, aprobado_por_nombre, ref_git)
values ('$QUALIA_EMPRESA_ID', '<trabajo_id>', '<texto de la entrada>', '<metodo>', '<ref o NULL>', '<nombre>', 'libro-de-accion/<archivo>.md');
```

  Si la decisión trae Alcance, actualizá tu memoria curada (proveedores.md /
  criterios.md) para no volver a preguntar lo mismo.

  **NO registres en ADM Cloud.** El registro real llega en la Entrega 2; hoy el
  trabajo queda en `aprobada` y eso es correcto. Cerrá con un evento `nota`:
  «Anotado en el libro. Queda pendiente de registro en ADM Cloud.»

  **Contrato para cuando la Entrega 2 encienda el registro real**: al crear el
  documento en ADM, su DocID queda enlazado en DOS lugares, siempre —
  (1) en la fila: `update qualia_trabajos set propuesta = propuesta ||
  jsonb_build_object('registro_adm', jsonb_build_object('docid', '<DocID>',
  'fecha', now()::date)) where id='<id>'` (la web lo muestra como "Documento
  ADM" en la bandeja y en el libro); (2) en el TEXTO de la entrada del libro
  (archivo canónico en git y espejo en `qualia_libro.entrada`), p.ej.
  «Registrada en ADM como PI20250921». Una entrada de libro sin el DocID del
  documento que generó está incompleta.

- **`rechazada`**: evento `nota` reconociéndolo («Entendido, descartada»). Sin
  libro, sin precedente. Si el usuario explicó por qué, guardá el criterio en
  tu memoria como negativo.

- **evento `respuesta`** (estado `esperando_respuesta`): retomá —

```sql
update qualia_trabajos set estado='analizando'
 where id='<id>' and estado='esperando_respuesta';
```

  — y seguí el análisis con la respuesta como dato nuevo.

## Si el trabajo es tipo `criterio`

Bloques de reglas destiladas del preentrenamiento (los crea
`memoria/scripts/bloques-criterios.py` con `origen='preentrenamiento'`). Nacen
ya en `propuesta`: no hay archivo que bajar ni análisis que hacer — la
`propuesta` trae `{bloque, archivo, n_reglas, reglas: [{titulo, enunciado,
evidencia, alcance}], detalle}`. Solo te despiertan cuando el usuario actúa
(`accion_usuario`), y el estado real de la fila manda, como siempre.

- **`aprobada`**: escribí UNA entrada de libro de acción POR CADA regla del
  bloque — archivo NUEVO `libro-de-accion/AAAA-MM-DD-<slug-de-la-regla>.md`
  (append-only, jamás editar uno existente), con **Aprobó:** el
  `aprobado_por_nombre` de la fila, «por la mesa web»; **Alcance:** el de la
  regla (si la regla no trae uno propio, el del bloque; si el comentario de
  aprobación lo editó, ese manda); y la **evidencia citada** de la regla
  (n docs + DocIDs). Espejá cada entrada en `qualia_libro` como siempre.
  Después actualizá el front-matter del archivo de memoria correspondiente
  (`propuesta->>'archivo'`, ej. `memoria/proveedores.md`): `estado: ratificado`
  y `aprobo: <nombre>`. Cerrá con un evento `nota` con el conteo:
  «Bloque <bloque> ratificado: N entradas de libro escritas, memoria a
  ratificado.»
- **`rechazada`**: evento `nota` reconociéndolo. El comentario del usuario dice
  qué reglas caen o se corrigen; NO edites el trabajo rechazado ni escribas
  libro — el bloque corregido vuelve como trabajo NUEVO desde el pipeline de
  preentrenamiento.

**REGLA DURA — un borrador no es precedente.** Un criterio cuyo archivo de
memoria está en `estado: borrador` NO se cita como precedente JAMÁS — ni en
propuestas, ni en sugerencias, ni en respuestas. Precedente es SOLO una entrada
del libro de acción o memoria con `estado: ratificado`. Si el único sustento
que encontrás es un borrador, decilo explícito: «no hay precedente ratificado;
hay un borrador pendiente de mesa que sugiere X», y tratá el caso como nuevo
(`metodo='razonado'`).

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
