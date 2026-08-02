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
  andá DIRECTO al precedente y la propuesta (pasos 6-8), verificando coherencia
  por el camino: si `extraccion.confianza` es `media` o `baja`, si los montos
  no cuadran (`monto` = subtotal + `itbis` + cargos) o si el
  `razon_social_emisor` de DGII no coincide con el proveedor extraído, volvé al
  documento (ya lo tenés en disco) antes de proponer. Los campos que vengan
  AUSENTES del dossier son lo que el prep NO pudo hacer: completá SOLO esos con
  el protocolo normal. El `dgii` del dossier va a tu propuesta como siempre
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
     1. **Traé el contacto del proveedor** para que puedan llamarlo y pedir la
        factura corregida. Buscalo en ADM (`/api/Vendors`, match por RNC o
        nombre) y guardalo en la propuesta:
        `"proveedor_contacto": {"contacto":"...","telefono":"...","email":"..."}`.
        Si no lo encontrás, dejá el campo fuera — no inventes teléfonos.
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
     impuesto): volve al documento y encontralo. NO cierres una propuesta que
     no cuadra — la web la marca en rojo y no sirve para registrar.

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
