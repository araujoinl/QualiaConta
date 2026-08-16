# Contrato de tools del turno — `qualia-contable` (F3)

> **BORRADOR para revisión — 2026-08-16. Entregable de la precondición de F3
> del [plan de salida de Hermes](plan-salida-hermes.md) §4.3 v2: «el contrato
> de tools sale de los protocolos, no de una lista intuitiva… se verifica
> verbo por verbo contra rama-casos.md y rama-respuestas.md antes de F3».**
>
> Fuentes leídas ENTERAS para armarlo (estado al commit `5dd6645`; las ramas
> son tajadas verbatim de `a14c7d0`): `skills/mesa-de-trabajo/SKILL.md`,
> `references/rama-facturas-1.md`, `references/rama-facturas-2.md`,
> `references/rama-casos.md`, `references/rama-respuestas.md`,
> `references/comun-asientos.md`, `scripts/abrir-trabajo.sh` (763 líneas),
> `docs/mesa-de-trabajo.md`. La verificación completa está en §3; el veredicto
> corto: **la lista intuitiva de 4 tools se quedaba corta en 10** — los
> protocolos exigen 14 verbos, y varios de los que faltaban tienen lápida
> propia (el `abrir_trabajo` del Caso #2, el `proponer_criterio` del carril de
> correcciones, el `marcar_error` con enlace de comprobante del 2026-08-07).

## 0. Qué es este contrato

`qualia-contable` es el mini-loop acotado que reemplaza al agente Hermes para
los casos difíciles: system + dossier + tajada de la rama + precedentes +
historial → tool calls acotadas, máximo N iteraciones por invocación, estado
SIEMPRE en el bus. Este documento fija **qué puede hacer el modelo (las
tools), con qué firma, qué escribe cada una y qué guard la frena**, más el
contrato de continuación (§4), el presupuesto de tokens medido en F0.6 (§5) y
la lista explícita de lo que queda fuera (§6).

La regla de diseño que ordena todo (F0.6): **cada iteración re-paga el prompt
entero (~11k de entrada) contra una cuota que se mide por tokens de ENTRADA.**
Tools finas = más iteraciones = más entrada. Por eso las tools son GORDAS
(una llamada devuelve todo lo que hoy imprime `leer-contexto.sh`), y todo lo
que un guard determinista puede resolver NO se le pregunta al modelo.

## 1. El reparto previo: lo que hace el harness ANTES de la primera llamada

Hoy `abrir-trabajo.sh` + `leer-contexto.sh` hacen la mitad del trabajo sin
LLM. En el turno serverless esa mitad es del **harness** de la function — no
son tools, el modelo ni se entera:

| Hoy | En `qualia-contable` | Por qué no es tool (y su lápida) |
|---|---|---|
| Ruteo R1-R8 por el ESTADO REAL de la fila (`abrir-trabajo.sh`) | el harness rutea antes de armar el prompt; **el motivo del poke sigue sin rutear JAMÁS** | lápida `poller.sh:578-586`: motivo autoritativo = dos sesiones ciegas sobre la misma fila (Caso #1, pasos duplicados) |
| Claim atómico (del router en casos; de `leer-contexto.sh --claim` en facturas) | el harness reclama TODA fila que va a trabajar (`pendiente→analizando`, y el retome `esperando_respuesta/propuesta/error→analizando` al llegar una respuesta) ANTES de invocar al modelo; **el perdedor no gasta ni un token** | «si perdiste el claim, PARÁ» se desobedeció dos veces el 2026-08-07 (Formax v3: 21+43 llamadas en paralelo; Mtk Designs: 4 hijos duplicados). El modelo no puede desobedecer un manual que nunca le llegó |
| Progreso temprano del claim | lo escribe el mismo CTE del claim | señal de vida en la web sin gastar una iteración |
| «Nada que hacer» (R1 fila de otro turno, R2 cerrada con libro) | el harness corta sin invocar: 0 tokens | hoy igual (exit 6); un veredicto de más mata un trabajo vivo |
| Tajada por rama | system + SOLO la tajada, **re-tajada**: muere toda la mecánica de psql/shell/guardián (la absorben harness y tools) y quedan reglas contables y lápidas | meter la rama completa empata el ahorro (F0.6) |
| `criterios.md` junto a la rama de casos | el harness lo adjunta a la tajada de casos, siempre | Formax v2: C-002 existía y ninguna pieza se lo puso delante |
| Dossier + hilo + clasificación + precedente (`leer-contexto.sh`) | precargados en la iteración 1 (es la tool `dossier_completo` servida de oficio) | cada round-trip re-paga ~11k |
| Vigencia del dossier (`row_updated_at` vs `updated_at` PRE-claim) | la compara el harness. Vigente → precarga. Vencido o ausente → **no invoca al modelo**: re-poke al preparador y a esperar | un turno sin dossier re-paga visión y DGII ya pagadas (medido 2026-08-02: ~80s) |
| Valla con nonce sobre datos no confiables | fila, propuesta y eventos viajan como bloques rotulados DATO en el mensaje de usuario; las instrucciones viven en el system | el texto de una persona leído como orden es el mismo modo de falla en cualquier chasis |
| Batch de rechazos sin respuesta (query `not exists`, 15 min) | el harness los precarga en el prompt del turno de rechazo | antes: 4 sesiones LLM por 4 rechazos del mismo replan |
| Hijos existentes del caso (`propuesta->>'caso_id'`) | en el dossier del caso, siempre | Mtk Designs: 4 hijos duplicados en 12 segundos |
| Filtro `superada_por_ncf` | el harness ni invoca: no hay humano que haya hablado | contestarle a una máquina es ruido en el hilo |
| Topes de volcado (propuesta 4.000 bytes, eventos 5×800) | los mismos topes, en el armador del prompt | el tope de ~50k del tool de Hermes muere, el de la cuota no |

## 2. Las tools del turno

Convenciones: toda tool corre con la `empresa_id` y el `trabajo_id` que fijó
el harness — **el modelo jamás los pasa** (la lección de §4.6: `empresa_id`
nace de `qualia_trabajos`, nunca de la salida del LLM). Las tools de cierre
(`proponer`, `preguntar_al_humano`, `responder`, `marcar_error`) son
transaccionales, llevan los eventos de cierre ADENTRO (como hoy
`aplicar-propuesta.py`), y **una sola cierra el turno**: tras cualquiera de
ellas el loop termina. Si el guard no matchea, la tool REVIENTA con el motivo
— la trampa del «UPDATE 0» silencioso ya mordió dos veces y este contrato la
hereda muerta.

### 2.1 Lectura (no escriben nada)

| Tool | Firma | Qué devuelve | Guards |
|---|---|---|---|
| `dossier_completo` | `{hilo_completo?: bool}` | fila + propuesta (capada, con claves y tamaño si excede) + hilo (últimos 5 capados; entero si se pide) + dossier del cache + `clasificacion.json` del proponedor + precedente del proveedor ya buscado + (si es caso) hijos existentes | precargada en la iteración 1; llamarla de nuevo solo tras una corrección o para releer el hilo entero |
| `leer_adm` | `{modo: 'documento'\|'listado'\|'ap_saldo'\|'vendor'\|'plan_cuentas', tipo_doc?, uuid?, rnc?, serie?, pagina?}` | GET sobre la flota `admcloud-*` de LECTURA: documento por UUID, listado paginado por tipo (filtro local — `?Reference=`/`?DocID=` siguen prohibidos: mienten), saldo abierto por `/api/AP`, vendor por `FiscalID` exacto, y el plan VIVO por serie (`220.x` completo, nunca un keyword suelto) | solo lectura; el vecindario de serie se devuelve entero (comun-asientos: adivinar un código está prohibido) |
| `consultar_banco` | `{tx_id}` ó `{cuenta?, desde?, hasta?, monto?, texto?}` | filas de `openbanking_transactions` con sus columnas reales (en español — la tool las tipa: el error de traducirlas al inglés muere acá) | SELECT parametrizado, solo tablas `openbanking_*`, cuentas de la empresa |
| `buscar_precedente` | `{termino?\|rnc?\|cuenta?\|plan?\|tipos?: true}` | lo mismo que `buscar-precedente.py` sobre `qualia_libro` + espejos agg, con sus CINCO etiquetas literales (`PRECEDENTE` / `SIN CUENTA DOMINANTE` / `MUESTRA INSUFICIENTE` / `PARECIDOS DE NOMBRE` / `⚠ Coincidió por RNC`) y el `TIPO DE GASTO 606:` | las etiquetas no se reinterpretan; la del proveedor del dossier ya vino precargada — esta tool es para OTRA búsqueda |
| `consultar_dgii` | `{modo: 'ncf'\|'timbre'\|'padron', rnc?, ncf?, url_qr?}` | la consulta que hoy hacen `consultar-ncf-dgii.py`, la URL del QR y `consultar-rnc-dgii.py`; salida tal cual para copiar a `dgii` / `rnc_padron` | SOLO cuando el dossier trae el campo ausente o `no verificable` — con campo presente, re-consultar está prohibido (rama-facturas-1); jamás inventar el resultado |

### 2.2 Escritura intermedia

| Tool | Firma | Qué escribe | Guards |
|---|---|---|---|
| `avisar_progreso` | `{texto}` | un evento `progreso` (`autor='contable'`) | fila en `analizando` y reclamada por ESTA invocación; uno por FASE, no por comando; los del cierre van dentro de la tool de cierre, no acá |

### 2.3 Cierre (una sola por invocación; transaccionales)

| Tool | Firma | Qué escribe | Guards |
|---|---|---|---|
| `proponer` | `{resumen, propuesta, eventos[]}` | eventos de cierre + `resumen` + `propuesta` + `estado='propuesta'`, en UNA transacción (hereda a `aplicar-propuesta.py`) | guard `estado='analizando'`; validaciones duras abajo |
| `preguntar_al_humano` | `{tipo: 'pregunta'\|'dictamen', texto, eventos?}` | evento `pregunta` (o `nota` si es dictamen de caso) + `estado='esperando_respuesta'` | guard `estado in ('analizando','aprobada')` — las DOS puertas (la de `aprobada` es la del `AMBIGUO`; con el guard viejo el UPDATE quedaba en 0 sin fallar). `dictamen` es el cierre del caso: «ya te dije lo que pienso, decidí vos» |
| `responder` | `{eventos[], criterio: 'si'\|'no', motivo_no?}` | eventos `nota` SIN tocar el estado (el acuse de un rechazo, la respuesta que no cambia nada) + **siempre** el marcador de criterio (`datos.criterio`) | la fila queda en su estado; el marcador es obligatorio — es lo que vuelve auditable el carril de correcciones |
| `marcar_error` | `{error_detalle, nota, duplicado_de?}` | `estado='error'` + `error_detalle` legible + evento `nota`. Con `duplicado_de`: además anota `comprobante_de_trabajo` en la `propuesta` del trabajo vigente y le deja su evento `nota`, todo en la misma transacción | `error_detalle` nunca vacío — un trabajo mudo es un trabajo perdido; el enlace de comprobante existe porque el 2026-08-07 el papel del anticipo ISR quedó varado en una fila en `error` (672eacb4 → 646ed1cf) |

**Validaciones duras de `proponer`** (las que hoy reparten la web, los guards
del contrato y el trigger, ahora juntas en la tool):

- `documento_adm` obligatorio y dentro del catálogo; `tipo_gasto` obligatorio
  en toda factura (catálogo 01-11, uno por documento).
- Forma de `lineas` según el tipo: items para `VendorBills`/`VendorCreditNotes`
  (precios POSITIVOS en la nota), partida doble para el resto; **prohibido
  `cuenta_destino`** (retirada 2026-08-02).
- Cuadre: `sum(precio×cantidad)+sum(itbis)` contra `monto`, umbral 0,05 — y
  débitos = créditos en partida doble. La tool frena ANTES de que el humano
  apruebe algo falso (hoy frena `verificar_cuadre` recién en el registro).
- El trigger `qualia_trabajos_journal_no_toca_caja` sigue vivo en la base: un
  `Journals` que toque 101.xx/102.xx/203.10/203.11 revienta, y **el error no
  es permiso para re-etiquetar** — lápida CB00000258 (depósito de un inquilino
  disfrazado de `BankCharges` crédito, 2026-08-07).
- En asientos de conciliación, el `detalle` debe traer el segundo piso
  «Sostén:» (formato del 2026-08-15) — sin sostén, la tool rechaza.
- `borrador_libro` viaja en la misma propuesta, sin `Aprobó` ni DocID (los
  pone la plantilla al materializar).
- Estados que la tool puede escribir: `propuesta`. Nada más. `aprobada`,
  `rechazada` (salvo `rechazar_paso`, abajo) y `registrada` **no existen** en
  el vocabulario del turno.

### 2.4 La rama de casos (lo que la lista intuitiva no tenía)

| Tool | Firma | Qué escribe | Guards |
|---|---|---|---|
| `abrir_trabajo` | `{resumen, propuesta}` | INSERT en `qualia_trabajos`: `tipo='sugerencia'`, `origen='caso'`, `estado='propuesta'`, `propuesta.caso_id` = el caso en curso (**lo pone el harness, no el modelo**) | solo si la fila madre es `tipo='caso'` en `analizando`; `resumen` en formato «acción · origen → destino — RD$monto»; si el hijo resuelve un movimiento del banco, `banco_tx_id` obligatorio (sin él la misma plata se cuenta dos veces); las mismas validaciones de `lineas` de `proponer` |
| `rechazar_paso` | `{trabajo_hijo_id, motivo}` | `estado='rechazada'` en el hijo + evento `nota` («reemplazada por el nuevo plan del Caso #N») | SOLO hijos del caso en curso (`propuesta->>'caso_id'` matchea), SOLO en `estado='propuesta'`, y SOLO cuando hay voz del humano pidiendo el replan — es la excepción documentada a «`rechazada` la mueve el usuario»: traducir su decisión, no tomarla |

`abrir_trabajo` existe por regla dura con lápida: **«cada paso es un TRABAJO,
ninguno queda en prosa»** (Caso #2 Mtk Designs, 2026-08-07: los dos asientos
quedaron escritos como advertencia, sin botón, y se mandó al dueño a
asentarlos a mano). Sus reglas de uso viven en la tajada y el guard ayuda
donde puede: la cancha son las filas del caso (Formax: la transferencia de
RD$90.000 decía `pendiente` en la tabla y ya estaba conciliada), P-001 se
verifica con `leer_adm` antes de abrir (Caso #1: diez propuestas muertas por
debitar un pasivo que nunca existió), UN plan y no dos vías (Caso #1: cuatro
pasos donde el plan eran dos), un trabajo = UN documento, y el caso jamás
lleva `registro_adm` propio.

### 2.5 El carril de criterios

| Tool | Firma | Qué escribe | Guards |
|---|---|---|---|
| `proponer_criterio` | `{titulo, enunciado, alcance, sosten}` | INSERT `tipo='criterio'`, `origen='correccion_usuario'`, `estado='propuesta'`, UNA regla, `origen_trabajo` = la fila en curso; y el marcador `datos.criterio='si'` en el hilo | las cuatro reglas que no se negocian, ahora en el schema: (1) `reglas` es array de UN elemento — la tool no acepta más; (2) **el campo `archivo` NO EXISTE en la firma** — ratificar 73 fichas sin revisar (6 con la cuenta invertida, medido 2026-08-06) deja de ser un descuido posible; (3) `alcance` requerido y no vacío; (4) `sosten` requerido (cuántos documentos lo respaldan, o «palabra del dueño») |

El discriminador sigue siendo del modelo (¿corrigió lo que VISTE o lo que
CONCLUISTE? — 2 de 19 correcciones reales generalizan) y va en la tajada; lo
que NO generaliza se cierra con `responder {criterio:'no'}`. El criterio
negativo de un rechazo explicado usa esta misma tool — mismo carril, ningún
atajo: la pantalla se lo prometió al usuario.

### 2.6 El libro

| Tool | Firma | Qué escribe | Guards |
|---|---|---|---|
| `escribir_libro` | `{titulo, caso, por_que, sosten, alcance, docid, aprobado_por_nombre}` | el orden fijo de §4.5 del plan: (1) fila en `qualia_libro` con estado `pendiente_git`, (2) archivo NUEVO en `libro-de-accion/` vía API de GitHub (crear = append-only nativo; editar no está implementado), (3) `ref_git` en la fila | idempotente por `trabajo_id`: si `qualia_libro` ya tiene la entrada, no-op con aviso (el barrido de «registrada sin libro» reintenta, y el archivo ya se duplicó una vez en miniatura); **sin `docid` no hay entrada** — se cierra con `responder` avisando («una entrada sin documento es peor que ninguna»); `tipo='caso'` REVIENTA: el caso no va al libro jamás; en un criterio aprobado, una llamada POR REGLA |

## 3. Verificación verbo por verbo contra los protocolos

Cada verbo que el contable ejecuta hoy, con su destino. Destinos posibles:
**tool** (lo llama el modelo), **harness** (lo hace la function sola),
**preparador/registrador/cron** (otra pieza de la arquitectura), **muere**
(era mecánica del chasis viejo), **F4** (explícitamente fuera del turno, §6).

### 3.1 SKILL.md (núcleo)

| Verbo hoy | Destino | Regla dura / lápida |
|---|---|---|
| `abrir-trabajo.sh <id> <motivo>` (primer comando obligatorio) | harness (§1) | el motivo no rutea — lápida poller.sh:578-586 |
| `psql "$QUALIA_DSN"` como vía universal | muere: no hay shell ni DSN; cada verbo tiene su tool | el guardián de comandos y sus 15-30s mueren con él |
| eventos `progreso`/`pregunta`/`nota` por insert | `avisar_progreso` / dentro de las tools de cierre | uno por fase; los de cierre van en la transacción del cierre |
| motivo `escribir_libro`: leer fila → archivo git → espejo `qualia_libro` → memoria | `escribir_libro` (orden invertido a propósito: tabla primero, §4.5) | no duplicar (barrido reintenta); sin docid no se inventa; la actualización de memoria curada queda FUERA (§6.7) |
| motivo `registro_pendiente`: diagnosticar y registrar | en F3, SOLO diagnóstico: `leer_adm`+`consultar_banco` → `preguntar_al_humano` o `responder`; el POST es del mesa (vivo hasta F4) o del registrador (F4) | el `AMBIGUO` «no se resuelve reintentando — se resuelve preguntando»; ver §6.1 |
| tipo `criterio` aprobado: libro por regla + ratificar archivo | `escribir_libro` por regla; la ratificación del archivo, FUERA (§6.7) | «un borrador no es precedente» sigue en la tajada; sin `archivo` no se toca memoria — y la tool ya no tiene el campo |
| tipo `criterio` rechazado: nota, sin libro | `responder` | un criterio rechazado jamás engendra otro criterio |
| REGLA DURA: no inventar números / no prorratear ITBIS | tajada + el cuadre de `proponer` frena la mitad mecánica | 2026-08-03: RD$4.590,26 registrados contra RD$4.520,47 del papel |
| `archivo_url` solo lectura, jamás imprimirla | muere: el turno no ve URLs firmadas — los archivos los maneja el preparador y su cache | los strings largos abreviados con «...» rompían la URL |
| «la mesa recibe CUALQUIER documento» | tajada (identificar y proponer el tratamiento del tipo, o preguntar) | nunca forzar al molde de factura |

### 3.2 rama-facturas-1.md y rama-facturas-2.md

| Verbo hoy | Destino | Regla dura / lápida |
|---|---|---|
| Paso 0: mirar la voz del humano antes de analizar | harness (rutea por eventos; una respuesta post-propuesta va a la rama de respuestas) | el dossier no contiene eventos: releerlo devuelve el razonamiento que el humano acaba de rechazar |
| `leer-contexto.sh <id> --claim` | harness (claim) + `dossier_completo` (precarga) | UN comando, no cinco — ahora cero: viene en el prompt |
| claim atómico por UPDATE guardado | harness | Formax v3 / Mtk Designs |
| `bajar-documento.sh` / HEIC vía uv / xlsx con openpyxl / `vision_analyze` local | preparador (`qualia-preparador`, F2) — **la visión NO es tool del turno**; sin dossier vigente el turno no arranca (§1) | prohibida la relectura de imagen con campos presentes, bajo NINGUNA condición |
| chequear duplicados (mesa por NCF, histórico, API) | dossier del preparador (`duplicados` → «decidís con eso, no re-busques»); `leer_adm{listado}` para re-confirmar un docid vivo | un documento con `eliminado_en`/`anulado_en` NO es duplicado — FP00001120 (Carrefour borrada, 2026-08-04) caía en `error` para siempre |
| cerrar subida duplicada enlazando el papel al trabajo vigente | `marcar_error{duplicado_de}` | el comprobante del anticipo ISR varado (2026-08-07) |
| `consultar-ncf-dgii.py` / URL del QR / `consultar-rnc-dgii.py` | `consultar_dgii` — SOLO si el dossier lo trae ausente/`no verificable` | el QR pisa al texto (E310016169496); jamás inventar el resultado; `dgii` nunca vacío en la propuesta |
| `buscar-precedente.py` (nombre/RNC/`--cuenta`/`--plan`/`--tipos`) | `buscar_precedente` | las 5 etiquetas se leen literal; «SIN CUENTA DOMINANTE» no es precedente citable; el agg SÍ vale como precedente (excepción explícita al borrador) |
| prohibición de `python3 -c` sobre los agg | muere con el shell | se lleva 8-17s por llamada del guardián a la tumba |
| aritmética: tasa despejada, no asumida; exento que sale de una resta = tasa mala | tajada; el cuadre de `proponer` frena el total, el criterio es del modelo | FP00001120 (Carrefour, café al 16%, 2026-08-04): crédito fiscal reclamado de más |
| las 5 preguntas de `documento_adm` + auto-chequeo de contrapartida | tajada (es EL criterio contable del turno) | el NCF no decide el tipo (96 contraejemplos); DGA RD$939.118,86 etiquetada `VendorBills` describiendo el pago; CB00000258 |
| fecha de emisión vs firma; DD/MM | tajada; el timbre del dossier manda | Claro 2026-08-06 (agosto entró en julio); ticket guardado 2026-02-08 |
| «el banco del papel no es la cuenta de origen»; no emparejar por monto+fecha | tajada; `consultar_banco` solo con movimiento delante | Promerica/Santa Cruz 2026-08-06; FP00001114/1115 (mentiras indetectables, medido) |
| evento `progreso` por fase | `avisar_progreso` | sin señal la mesa queda muda |
| `aplicar-propuesta.py turno.json` | `proponer` | mata el «UPDATE 0» — igual que hoy, ahora con las validaciones de la web adentro |
| pregunta + `esperando_respuesta` (desde `analizando` O `aprobada`) | `preguntar_al_humano` | el guard viejo de solo-`analizando` dejaba la fila zombi 2 horas |
| `estado='error'` + `error_detalle` | `marcar_error` | un trabajo mudo es un trabajo perdido |

### 3.3 rama-casos.md (verificación exigida por §4.3)

| Verbo hoy | Destino | Regla dura / lápida |
|---|---|---|
| claim del caso (CTE del router) + progreso temprano | harness | Formax v3 / Mtk Designs — el perdedor no recibe protocolo |
| `select jsonb_pretty(propuesta)` + hilo | `dossier_completo` (precargado, con la `foto` de cada fila) | la `foto` es fotografía, no presente; empezar por ella, no por la tabla |
| `select * from openbanking_transactions where id=<tx_id>` | `consultar_banco{tx_id}` | columnas en español — la tool las tipa y el error de traducirlas muere |
| releer `docid` por API ADM | `leer_adm{documento}` | releer antes de dar por vigente |
| verificar saldos/documentos ANTES de proponer (P-001) | `leer_adm` — y la tajada exige citarlo en el «Sostén:» | Caso #1: diez propuestas debitando un pasivo que nunca existió |
| INSERT de trabajos hijos | `abrir_trabajo` (§2.4) | «cada paso es un TRABAJO, ninguno queda en prosa» — Caso #2 Mtk Designs; «el dictamen termina en botones, no en tareas para el humano» |
| mirar hijos existentes antes de abrir | harness (vienen en el dossier del caso) | Mtk: 4 hijos duplicados en 12 segundos |
| rechazar hijos obsoletos en un replan | `rechazar_paso` | excepción documentada a «rechazada la mueve el usuario»: traducir su decisión |
| H-12 solo con contraparte banco; el candado no dice «buscá otro tipo que pase» | tajada | CB00000258 — el depósito de Formax |
| cerrar contestando: `esperando_respuesta` | `preguntar_al_humano{dictamen}` | el caso puede volver a `pendiente` las veces que haga falta |
| NUNCA `aprobada` en el caso, NUNCA `propuesta.cerrado` | sin tool — el vocabulario del turno no los tiene (§6.2) | cerrar el caso es del humano |
| el caso no va al libro | guard de `escribir_libro` (REVIENTA con `tipo='caso'`) | es la pregunta, no el asiento |
| escapar `$` en los textos de shell | muere: los textos viajan como JSON | «RD,322.75» en dos de los cuatro pasos del Caso #1 |

### 3.4 rama-respuestas.md (verificación exigida por §4.3)

| Verbo hoy | Destino | Regla dura / lápida |
|---|---|---|
| `leer-contexto.sh` sin `--claim` | `dossier_completo` | — |
| `registrar-en-adm.py --trabajo` (y `--simular`) | **F4** (`qualia-registrador`); en F3 lo sigue haciendo el mesa (`registrar_directo`) | §6.1 — el turno JAMÁS postea a ADM |
| curl a `/api/Storage` (adjunto) | F4 / cron `admcloud-adjuntar` | — |
| archivo git + espejo `qualia_libro` + `ref_git` | `escribir_libro` | orden fijo tabla→GitHub→ref; la tabla es la fuente del retry |
| actualizar memoria curada tras un Alcance | FUERA (§6.7) | — |
| `update … estado='registrada'` con guard `aprobada` | F4 (del registrador, con su claim de registro) | las 4 primeras facturas: registradas en ADM, `registrada`=0 en la base (2026-08-03); el CHECK de la base sigue: nunca `registrada` sin docid |
| gemelo sin NCF: `Reference=banco_tx_id`, buscar paginado, readback por UUID, no adoptar sin prueba | spec del registrador (F4); en F3 el turno lo usa para DIAGNOSTICAR (`leer_adm{listado}`) y termina en `preguntar_al_humano` | CB00000169: el mismo DocID en dos trabajos, un cargo de menos en ADM; el listado no trae anulados |
| `rechazada`: nota de acuse; batch de rechazos recientes | `responder` (el batch lo precarga el harness) | el `not exists` evita el bucle; `superada_por_ncf` ni se invoca |
| evento `respuesta`: retomar a `analizando` | harness (es el claim del retome) | «esperando_respuesta NO es el único origen» — gatearlo así volvía inalcanzable el caso más común |
| contestarle a él primero; acatar y completar; no volver atrás | tajada | DGA 2026-08-05: acató 23:44:54 y se retractó 15 segundos después; corregir el tipo sin el pago dejaba el débito sin documento |
| INSERT criterio (4 reglas duras) + marcador | `proponer_criterio` / `responder{criterio:'no'}` | VISTE vs CONCLUISTE (2 de 19 generalizan); las 4 reglas ahora son schema, no memoria |

### 3.5 comun-asientos.md

| Verbo hoy | Destino | Regla dura / lápida |
|---|---|---|
| doctrina INDEX + jerarquía P-003 | tajada (viaja con facturas y casos, como hoy la sirve el router) | ADM real → doctrina → criterios ratificados → precedente → DGII solo eje fiscal |
| resolver la cuenta contra el plan VIVO, vecindario completo | `leer_adm{plan_cuentas}` | el plan manda sobre cualquier papel; sin cuenta utilizable → `preguntar_al_humano` citando el hecho |
| `resumen` = solo QUÉ ES; `detalle` en dos pisos con «Sostén:» | validación de `proponer` y `abrir_trabajo` | regla del 2026-08-15; el ejemplar es el Caso #4 |

**Veredicto de la verificación**: los 5 archivos de ramas + el núcleo + el
router quedan cubiertos. Ningún verbo de rama-casos.md ni de
rama-respuestas.md queda sin destino; los que no tienen tool lo dicen con
nombre (harness, preparador, F4, muere, fuera §6).

## 4. Contrato de continuación

La plataforma mata sin señal atrapable (wall clock 400s en plan pago; el CPU
de 2s no aplica: la espera del LLM es I/O). El turno no confía en llegar:

1. **Deadline blando propio: ~300s** por invocación, medido por el harness al
   entrar a cada iteración. Tope de iteraciones por invocación: **N=8**
   (parámetro, a calibrar en la doble corrida — ver §5).
2. **Al cortar** (deadline o N agotado, sin haber llegado a una tool de
   cierre): el harness escribe un **evento de corte** — `tipo='nota'`,
   `autor='contable'`, `datos={"corte": true, "n": <continuación>, "motivo":
   "deadline"|"iteraciones"}` — y la fila QUEDA en `analizando`. El estado no
   se disfraza: **un turno que agota N sin pregunta real para el humano NO se
   marca `esperando_respuesta`** (regla v2 del plan) — queda «turno partido,
   continúa solo».
3. **Re-invocación inmediata vía `pg_net`** con `continuacion = n+1` en el
   payload del poke. El harness valida el contador contra el último evento de
   corte de la fila; si no coinciden, manda el de la base.
4. **Tope de continuaciones: 3.** Agotado, el harness cierra él mismo con
   `marcar_error`: «turno partido 4 veces sin cierre» + el último razonamiento
   como nota — visible en la web, jamás mudo.
5. **El barrido distingue**: una fila en `analizando` cuyo último evento es un
   corte reciente con contador vivo se re-pokea como continuación; una fila
   muda >20 min se libera como siempre (el rescate del incidente de las 464
   respuestas 429). El poke de continuación perdido lo recoge `qualia-barrido`
   igual que cualquier otro.
6. La «sesión» entre invocaciones es `qualia_eventos` + la propuesta parcial
   que el turno haya dejado en eventos: cada continuación recarga TODO de la
   base (mismo diseño de §4.1 del plan: el estado vive SIEMPRE en el bus).

> Desvío declarado contra §4.3 del plan: el plan dice «contador de
> continuaciones en la fila»; este contrato lo pone en el evento de corte +
> payload del poke, porque escribir `propuesta` a mitad de análisis pisa el
> trabajo del propio turno y el evento ya es append-only y auditable. Si la
> revisión prefiere la fila, es una clave nueva fuera de `propuesta` — no un
> cambio de diseño.

## 5. Presupuesto de tokens (lo medido en F0.6)

Los números que ya se midieron, y la regla que imponen:

| Medición (F0, corrida 2026-08-16) | Valor |
|---|---|
| Despertar de Hermes hoy (costo fijo de sesión) | ~17,7k tokens de entrada + contexto creciente por turno |
| Dossier real | **~600 tokens** (no los 3.500 estimados) |
| Turno nuevo, tajada tipo router | **~11k de entrada POR ITERACIÓN** (system + SOUL + tajada + dossier + precedentes + historial) |
| Cuota del Coding Plan | 15,1M tokens de ENTRADA por ventana de 5h, cache a precio completo |
| `reasoning_effort: low` | se mantiene (8,8s/turno medido; `minimal` reabre FP00001120). `disabled` PROHIBIDO en el turno (§6.10) |

**La conclusión de F0.6 es condicional y este contrato es la condición**: la
baja de cuota se sostiene SOLO manteniendo el servido por tajadas y las tools
gordas — meter la rama completa (~26k) empata con Hermes. De ahí las tres
reglas de presupuesto:

1. **Una iteración cuesta ~11k.** Una tool nueva se justifica si ahorra al
   menos una iteración; una tool fina que obliga a dos llamadas donde
   `dossier_completo` daba todo, cuesta ~11k de más. Por eso el precedente
   del proveedor, la clasificación del proponedor, los hijos del caso y el
   batch de rechazos viajan PRECARGADOS y no se piden.
2. **Iteraciones esperadas por rama** (estimación de diseño — se miden contra
   el corpus dorado y la doble corrida antes del cutover, y el tope N y el
   deadline se calibran con eso):

   | Rama | Cierre esperado |
   |---|---|
   | factura con dossier (la que degradó del proponedor) | 1-2 iteraciones (dossier precargado → `proponer` o `preguntar_al_humano`) |
   | respuesta / corrección / rechazo | 2-3 |
   | caso | 3-6 (leer_adm de verificación + hijos + dictamen) |
   | escribir_libro / criterio | 1 |

   Peor caso presupuestado: 8 iteraciones × ~11k ≈ 88k por invocación; con el
   tope de 3 continuaciones, ≈ 350k por trabajo — ~2,3% de la ventana de 5h.
   Un trabajo que pida más que eso termina en `error` legible, no comiéndose
   la cuota en silencio.
3. **Las tajadas se RE-TAJAN al portar.** Todo lo que en las ramas es
   mecánica del chasis viejo (psql, scripts, el guardián, los `$` del shell,
   las URLs firmadas, el tope de 50k del tool) muere absorbido por harness y
   tools; quedan las reglas contables y las lápidas. La tajada portada debe
   medir MENOS que la de hoy, y el check de tamaño entra al deploy junto al
   del bundle (§4.5 del plan).

Los topes de volcado del router se conservan en el armador del prompt:
propuesta capada a 4.000 bytes (con claves y tamaños si excede), eventos a
5×800 con marca de recorte, `archivo_url` jamás.

## 6. Qué queda EXPLÍCITAMENTE fuera del turno

1. **Registrar en ADM = F4.** El turno no tiene NINGUNA tool que escriba en
   ADM Cloud — ni POST, ni adjunto, ni «destrabar» un `registro_pendiente`.
   En la ventana F3→F4 el registro directo sigue siendo del contenedor mesa
   (`registrar_directo`, en producción desde 2026-08-04, con sus 7 tipos);
   lo que caiga fuera de esos tipos —que hoy registraba Hermes a mano— queda
   en diagnóstico + `preguntar_al_humano` hasta que `qualia-registrador`
   esté en verde. Recorte temporal, aceptado con nombre.
2. **Aprobar = humano, siempre.** `propuesta → aprobada` no existe en el
   vocabulario del turno; `rechazada` solo vía `rechazar_paso`, sobre hijos
   del caso propio y con el pedido del humano en el hilo. Cerrar un caso
   (`aprobada` en `tipo='caso'`, `propuesta.cerrado`) es de la web.
3. **Void / firmar / des-firmar**: default-deny en código (`_shared/`,
   heredero de `approvals.deny`, precondición de F4). No hay tool, no hay
   excepción.
4. **Emisión AR y depósitos** (`CashInvoices`, `CreditInvoices`, notas de
   crédito de cliente, `Deposits`): el rol los niega; la salida es SIEMPRE
   `preguntar_al_humano`. Proponer un tipo que el registrador no conoce deja
   la fila viva simulando atención — prohibido.
5. **Visión, extracción, QR, DGII de primera pasada, duplicados**: del
   preparador (F2). Sin dossier vigente el turno no arranca.
6. **Sugerencias de detectores**: `qualia-sugerencias` (F1), con sus cinco
   llaves de reclamo. El turno abre trabajos solo desde un caso.
7. **Ratificar archivos de memoria curada** (front-matter `estado:
   ratificado`): la memoria viaja empaquetada en el bundle — ratificarla es
   commit + redeploy, una operación de repo, no del turno. El turno escribe
   las entradas de libro del criterio y nada más.
8. **Elegir modelo, tocar flags de cuota o el kill-switch**: `_shared/llm.ts`
   y el panel. El turno consume el selector, jamás lo escribe.
9. **El claim**: del harness. El modelo nunca ve la carrera.
10. **`reasoningEffort: 'disabled'`**: existe SOLO para la clasificación
    determinista del proponedor (F2); el turno lo tiene prohibido por
    contrato.
11. **Telegram**: el gateway muere con Hermes; avisos salientes van por
    `qualia-salud` y el canal que ya existe (pregunta abierta §9 del plan).

---

*Pendiente de este contrato antes de construir F3: fijar N y el tope de
continuaciones con el corpus dorado; decidir contador en evento vs fila (§4);
y confirmar en la doble corrida que las tajadas re-tajadas conservan cada
lápida de §3 — el diff contra las ramas es parte de la revisión, no un
extra.*

## Enmiendas del revisor adversarial (2026-08-16) — NORMATIVAS

Estas enmiendas mandan sobre el cuerpo del contrato donde choquen. El
constructor de F3 las implementa como parte del contrato, no como sugerencias.

1. **`escribir_libro` no recibe `docid` ni `aprobado_por_nombre` del modelo.**
   Los toma SIEMPRE de la fila (`registro_adm.docid`, `aprobado_por_nombre`):
   los identificadores nacen de `qualia_trabajos`, jamás de la salida del LLM
   (la propia lección de §2 del contrato). El guard pasa de «sin docid no hay
   entrada» a «el docid ES el de la fila, punto».
2. **La tajada de casos EMBEBE las 5 preguntas.** rama-casos.md ordena releer
   rama-facturas-1 antes del primer trabajo hijo; en el turno no hay shell:
   la tajada servida para tipo `caso` incluye las secciones «5 preguntas del
   documento ADM» y «clasificación de cuenta» de rama-facturas-1/2, además de
   comun-asientos.
3. **Continuación sobre filas `registrada`** (motivo escribir_libro): no hay
   claim de estado (la fila es terminal y no se toca); la reanudación tras un
   corte es el barrido «registrada sin libro», y el evento de corte lleva el
   contador. §4.2 aplica solo a filas en `analizando`.
4. `leer_adm{documento}` acepta también `docid` con resolución vía listado +
   filtro local (el `?DocID=` de la API miente — prohibido); la fila de §3.3
   queda corregida.
5. El marcador `datos.criterio` de `responder` es obligatorio SOLO en el
   carril de correcciones y rechazos explicados (rama-respuestas.md); en
   acuses y avisos va omitido para no ensuciar la auditoría.
6. Dueños de los dos verbos huérfanos: (a) «Alcance → memoria curada» es
   operación de repo+redeploy, dueño HUMANO (Carlos o sesión de trabajo), y
   qualia-salud avisa cuando hay entradas de libro con Alcance sin reflejar;
   (b) los tipos fuera de los 7 de registrar_directo quedan esperando F4 —
   recorte temporal aceptado de la ventana F3→F4.
7. `marcar_error{duplicado_de}` escribe en la fila vigente SOLO con
   `empresa_id` igual y estado en (`aprobada`,`registrada`), con guard de
   estado en el WHERE como toda escritura.
