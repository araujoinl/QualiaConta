# Plan F4 — `qualia-registrador`: la pieza que ESCRIBE en ADM Cloud

> **BORRADOR en revisión — 2026-08-16. Nada de esto está aplicado ni desplegado.**
> Documentos hermanos: [plan-salida-hermes.md](plan-salida-hermes.md) (§5-F4,
> §11.2, §4.6), [plan-encendido-escritura.md](plan-encendido-escritura.md),
> [mesa-de-trabajo.md](mesa-de-trabajo.md),
> [hoja-de-ruta-registro.md](hoja-de-ruta-registro.md).
>
> Este documento diseña la ÚNICA fase de la mudanza calificada de **riesgo alto
> por naturaleza** (plan-salida-hermes §11.4): escribe en un libro fiscal real
> donde revertir **BORRA** y donde no hay clave de idempotencia. Todo lo demás de
> la mudanza es reversible con un flag; esto no.
>
> **Revisión adversarial cerrada el 2026-08-16, veredicto `no_construir_todavía`.**
> Las enmiendas están en [§11](#11-enmiendas-de-la-revisión-adversarial) y
> **mandan sobre el cuerpo donde choquen**. Las contradicciones directas ya se
> corrigieron acá arriba; §11 guarda la razón de cada corrección y la lista final
> de precondiciones. Leer §11 antes de escribir una línea de código.

---

## 0. La decisión en una frase

`qualia-registrador` es una Edge Function **determinista, sin LLM**, que toma un
trabajo que un humano ya aprobó y lo escribe en ADM Cloud: un documento por
invocación, con turno por empresa, evento antes del POST y readback verificado
después. No clasifica, no elige cuenta, no elige documento y no anula.

El gap-analysis de F0 mató la ilusión de que esto se orquesta: la flota
`admcloud-*` de la nube **no cubre la VendorBill de gasto con NCF** (registra
VendorReceptions de importación) ni los **BillPayments a proveedor** (cobertura
0). Cargos, transferencias y asientos: ~0% directo. Así que en F4 el registrador
**se escribe**, no se cablea — y lo que se escribe es el port de 3.158 líneas de
Python que ya están en producción desde el 2026-08-04, con sus lápidas.

### 0.1 La distinción que ordena todo el documento

`plan-encendido-escritura.md` gradúa **el criterio contable** (fase B propuesta →
fase C autonomía por precedente). Este plan gradúa **el ejecutor**. Son dos ejes
distintos y confundirlos es lo que haría empezar por el tipo equivocado:

| | plan-encendido §3 | este plan (F4) |
|---|---|---|
| Qué se gradúa | quién DECIDE el asiento | quién ESCRIBE lo ya decidido |
| Entrada | una propuesta | una fila en `aprobada` con OK humano |
| Orden por | dificultad de clasificar | prueba de propiedad + reversibilidad + plata que sale |
| Primero | VendorBills (volumen para precedentes) | **BankCharges** (§1) |

En F4 **`propuesta → aprobada` sigue siendo del humano, siempre**. F4 no enciende
autonomía de criterio: enciende una cañería.

### 0.2 Precondiciones bloqueantes — nada de F4 arranca sin esto

Las 6 de [plan-salida-hermes §11.2](plan-salida-hermes.md), más las 3 que
aparecieron al escribir este plan. La revisión adversarial agregó **nueve más**:
la lista completa, final y numerada —con cómo se verifica cada una— está en
**[§11.4](#114-precondiciones-bloqueantes-de-f4--forma-final)**. Esta tabla es
sólo el bloque original, y ya no es suficiente para arrancar.

| # | Precondición | Estado hoy | Por qué bloquea |
|---|---|---|---|
| 1 | Rol único consolidado (`ADMCLOUD_ROLE` = `ADMCLOUD_REG_ROLE`) y sondas §1.3 en verde | el `.env` tiene DOS valores distintos (verificado 2026-08-16) | el `role` viaja como query param; dos valores = dos superficies de permiso sin saber cuál escribe |
| 2 | Default-deny de `electronicsign`/`removesign`/`*/void`/`DELETE` portado a código | `approvals.deny` vive en un volumen gitignoreado que no sobrevive recreaciones | la firma e-CF **no se recorta por rol** (2026-08-02) y los Void PASAN con el rol actual (re-sondeado 2026-08-14) |
| 3 | Flota `admcloud-*` de escritura auditada: autorización caller→empresa | 10 functions con service_role, **CERO** verifican el caller; `anular-registro` acepta la anon pública y recibe el rastro de auditoría desde el body | el registrador comparte proyecto con ellas |
| 4 | Credenciales ADM/SMTP partidas de `admcloud_empresas` a Vault | texto plano, misma fila, `select('*')` en toda la flota | el registrador NECESITA la credencial; el LLM jamás puede compartir contexto con ella |
| 5 | **Cron de cuadre 1:1 en verde 14 días** (§7) | no existe | es el detector de TODOS los modos de fallo de escritura |
| 6 | Turno por empresa + claim de registro en la fila (§4) | hoy lo hace un `flock` del poller que no existe entre invocaciones | ADM asigna el correlativo al guardar (lápida CB00000225) |
| 7 | **La lista de tipos registrables vive en UN solo lugar** | vive en tres: `script_de_registro` (poller.sh), `ENDPOINTS` (qualia-lapidas), y el comentario de poller.sh:280-295 — que sigue diciendo «BankBankTransfers queda AFUERA» mientras el `case` de la línea 310 lo incluye | ya se desincronizó tres veces (§10.4 del plan madre); un tipo que se registra y no se verifica es un fantasma esperando |
| 8 | Catálogo de GUIDs por empresa en tabla | hardcodeados en los scripts (TaxScheduleID, ExpenseTypeID, TERMINOS, UUIDS_CONOCIDOS, TARJETAS, CUENTAS_BANCO) | es la brecha 1; sin esto el registrador nace atado a Blackbox |
| 9 | Banco de pruebas del cuadre corriendo en TS | `casos-cuadre.json` (1.673 líneas) sólo corre contra `cuadre.py` | el redondeo half-up de ADM en JS es una trampa nueva (§2.2) |

---

## 1. Alcance por tipo de documento, de menor a mayor riesgo

El eje de riesgo del EJECUTOR tiene cinco componentes, en este orden:

1. **Prueba de propiedad**: ¿puedo demostrar que ESTE documento de ADM es ESTE
   trabajo, sin adivinar? (NCF, Reference, `banco_tx_id`).
2. **Falla cerrada**: cuando no puede probarlo, ¿el script para o adopta?
3. **Pasos irreversibles encadenados**: un POST solo, o POST + Authorize, o tres
   POST que no se deshacen.
4. **Plata que sale hacia afuera**: un asiento no mueve caja; un pago sí.
5. **Exposición fiscal**: qué contamina si sale mal (606 de la contable externa).

| # | Documento | Prefijo | Volumen histórico | Prueba de propiedad | Falla cerrada | Pasos | Riesgo |
|---|---|---|---|---|---|---|---|
| 1 | `BankCharges` | CB | 159 | NCF, o `banco_tx_id` en `Reference` | **sí** — AMBIGUO y para | 1 POST | bajo |
| 2 | `Journals` no-nómina | ED | 186 (−60 nómina) | `Reference` propia, nunca gemelo | **sí** — cuadre pre-POST | 1 POST | bajo |
| 3 | `VendorBills` + `VendorCreditNotes` | FP / NCP | 1.050 + 6 | NCF **y** referencia del proveedor (ADM frena las dos) | **sí** — muere sin ninguna de las dos | 1 POST + adjunto | medio |
| 4 | `BankBankTransfers` | TE | 203 | `nro_referencia` > `banco_tx_id` | **sí** (ya portada la barrera) | 1 POST | medio |
| 5 | `AccountPayments` | PC | — | `Reference` = `banco_tx_id` | sí + cuadre post-Authorize | POST + **Authorize** | medio-alto |
| 6 | `BillPayments` | PP | 741 | `Reference` = `banco_tx_id` + saldos de `/api/AP` | sí | POST + **Authorize** | alto |
| 7 | `Journals` de nómina | ED | 60 | **ninguna que sirva**: el `Reference` lo tipea un humano y el histórico ya lo tiene mal (E2) | sí, por **cuentas + monto**, nunca por string | **3 POST sin deshacer** | máximo — nunca autónomo (§6) |

### Se enciende primero `BankCharges`. Por qué

- **Es el tipo con la mejor prueba de propiedad y la mejor falla cerrada.** Su
  script hace DOS preguntas separadas: «¿hay un cargo con MI referencia?» (ése es
  mío, probado) y «¿los gemelos que hay en ADM ya los reclamó otro trabajo?». Si
  queda un gemelo sin dueño, **muere con AMBIGUO y le pregunta al humano** en vez
  de adoptarlo. 🪦 **CB00000169** (2026-08-03): dos comisiones LBTR de RD$100 el
  mismo día; el contable leyó «YA REGISTRADO», anotó ese DocID en la segunda fila
  y cerró — el mismo documento en dos trabajos y un cargo de menos en ADM.
- **Tiene verificación independiente por fuera de ADM**: todo `BankCharge` tiene
  su movimiento espejo en `openbanking_transactions`. Dos libros que no se hablan
  y tienen que dar lo mismo.
- **Un solo POST**, sin Authorize, sin adjunto obligatorio en el camino crítico.
- **Montos chicos y frecuencia alta**: el peor caso individual es barato y la
  evidencia se acumula en días, no en meses.
- **El server ya lo registra solo desde el 2026-08-04**, así que el cutover es
  cambiar de escritor, no estrenar la escritura: hay una línea base conocida
  contra la cual diffear.

Después: `Journals` no-nómina (segundo porque no tiene NCF, no entra al 606, no
toca terceros y su barrera —cuadre débitos=créditos antes del POST— es aritmética
pura; 🪦 ADM autoriza asientos descuadrados sin chistar, **PC00000334**), y
recién tercero el volumen (`VendorBills`), que es donde está el premio pero
también el 606 de la contable externa.

Los pagos van al final **no porque sean difíciles sino porque su segundo paso
mueve plata**: el documento nace pendiente y el `Authorize` es lo que la mueve de
verdad. Un `AccountPayments` sin autorizar tiene Total y **cero Accounts**
(verificado 2026-08-15); decir «registrado» sobre eso es una lápida falsa.

---

## 2. Qué se porta de cada script, y qué se reusa de la flota

Regla del port: **se porta bloque a bloque, no de memoria**, igual que se hizo
con `qualia-preparador` en F2. Cada guarda va con el comentario que explica su
incidente; un port que pierde el comentario pierde la guarda en el próximo
refactor.

### 2.1 Guardas que se portan, por script

#### `registrar-en-adm.py` → VendorBills / VendorCreditNotes (929 líneas)

| Guarda | Qué hace | 🪦 Lápida |
|---|---|---|
| **El ITBIS NO se manda** | va `TaxScheduleID` por línea y el server calcula; su base es `Quantity × Price`, no `Price` | con cantidad 0,50 la diferencia era 10,63 vs 21,25 y el total se fue a 173,88 **con `success:true`** |
| **El asiento NO se manda** | ADM lo deriva; mandarlo descuadra | — |
| **Tasa por línea, schedule más cercano** | despeja la tasa de `itbis/(cantidad×precio)`, tolerancia 1 punto, gana el MÁS CERCANO | con tasa 17,0% el 16 y el 18 estaban ambos a un punto y **el orden del dict** decidía en silencio |
| **Cuadre predictivo pre-POST** | replica la aritmética de ADM (renglón por renglón, medio-hacia-arriba) y compara total e ITBIS contra el papel, tolerancia 0,05 | **FP00001063** (2026-08-03): papel 4.520,47 / ITBIS 575,72; ADM cobró 645,51 → 69,79 de más. Después del POST la única salida es borrar |
| **Cuadrar los ítems** | mueve el PRECIO (2 y luego 3 decimales) para que la cuenta de ADM caiga en el total del papel; **nunca mueve el total** | 13 de 63 facturas al 2026-08-05; el centavo está dentro del ITBIS que va al 606 |
| **La tasa que no se sostiene** | si sobra un «exento» residual con una sola tasa en juego y otra tasa cierra SOLA la cabecera, muere | **FP00001120** (Carrefour, café): se registró al 18% con 35,90 de exentos inventados; al 16% del art. 343 cerraba sola |
| **Duplicado por NCF y por referencia** | pagina hasta 6 meses antes de la fecha del documento y corta (el listado viene del más nuevo al más viejo) | medido: 1.106 filas / 23 páginas / 9,04s el barrido completo contra ~1,5s con el corte, en CADA registro |
| **Sin NCF y sin referencia → morir** | son las DOS claves con las que ADM frena duplicados; sin ninguna, la misma plata entra dos veces callada. Corre también en `--simular` | las 1.120 facturas del histórico traen una u otra; el Estado no emite NCF |
| **Alta de proveedor con respaldo DGII** | match por **RNC exacto, jamás por nombre**; el nombre sale de la razón social de DGII (comprobante) o del **padrón RNC**; sin ninguna de las dos, muere. Nace «Pendiente de Aprobación» y lo aprueba un humano en ADM | el padrón rescata al e-CF cuya foto no dejó leer el código de seguridad |
| **Lista cerrada `SIN_RNC`** | única vía por nombre (DGA Aduanas), y **se busca, nunca se crea** | **FP00001133**, liquidación de aduana de RD$939.118,86: 5 min 30 s de desvío contra 23 s del camino normal |
| **La nota de crédito se decide por el NCF (E34), no por `documento_adm`** | el campo lo escribe el modelo; el NCF es un hecho fiscal. Precios POSITIVOS (ADM invierte el asiento solo); signos MEZCLADOS → muere | NC de Claro (2026-08-07): el modelo escribió «VendorBills» y mandó los montos en negativo. Y el **E340000187146** es una NC que es un `BankCharges`: la regla `^E34 → VendorCreditNotes` a nivel router se lleva puesto ese caso |
| **`aplicacion_pendiente` escrita en la fila** | registrar la nota NO la aplica (eso es un ACP) | **NCP00000004** flotando desde enero; **FP00001027** abierta por RD$28 |
| **Readback con el recurso correcto y el ID pedido** | preguntar a `VendorBills` por el UUID de una NCP devuelve `success:true` con `data:null`, indistinguible de un documento borrado | **NCP00000006** (2026-08-07): el cron le puso lápida a una nota viva |
| **Guardar el docid y cerrar el estado en sentencias SEPARADAS** | si alguien movió la fila, el `where estado='aprobada'` no matchea y en una sola sentencia se llevaría puesto también el docid | el docid ata la fila a un documento real: el estado se corrige, el docid no se recupera |
| **`ExpenseTypeID` (tipo de gasto 606) por documento** | catálogo fijo 01-11, **una por documento** (no confundir con la cuenta, que es por renglón) | un restaurante es tipo 05 y a la vez 611.17 + 690.06 en sus líneas |
| **`PaymentTermID` obligatorio** aunque el schema lo marque opcional; **`FiscalID: null`** y no `""` cuando no hay RNC | — | omitirlo devuelve «Este término de pago no existe»; la FP00001133 es la única evidencia de que vacío ≠ ausente |
| **El adjunto va DESPUÉS del docid y no aborta** | el documento ya está registrado: eso es lo que hay que asentar | el adjunto a mano era el **55% del turno** (~94s del portero de comandos contra ~6s de subida real) |

#### `registrar-cargo-bancario.py` → BankCharges (527 líneas)

| Guarda | Qué hace | 🪦 |
|---|---|---|
| **Doble pregunta de duplicado** | (1) ¿hay un gemelo con MI referencia? → YA REGISTRADO; (2) ¿los gemelos vivos ya los reclamó otro trabajo? Si queda uno huérfano → **AMBIGUO, no registra nada** y pregunta al humano citando los DocID | CB00000169 |
| **Referencia = NCF > `banco_tx_id` > trabajo_id** | con comprobante la llave es única por empresa y además protege; sin comprobante, dos comisiones iguales del mismo día son indistinguibles en ADM | — |
| **Cuentas de caja enumeradas, no por prefijo** | 101.xx, 102.xx y las tarjetas **listadas una por una** (203.10, 203.11) | 203.xx es Cuentas por Pagar: tomar el prefijo entero haría pasar por banco la línea de un proveedor |
| **La tasa del BANCO, no la de ADM** | con comprobante manda `tasa_usd` (US$60 → RD$3.477,17 = 57,9528) | la tasa de sistema de ADM daría otro número en el 606 |
| **Tipo de gasto 07 sólo con NCF** | con NCF → 640.01 + ExpenseType 07; sin NCF → 801.01 y sin tipo de gasto | es lo que hizo la contable con los 51 cargos con NCF del histórico |
| **Verificar que ADM persistió el `Reference`** | si vuelve vacío se dice fuerte en el hilo | sin llave, dos cargos gemelos vuelven a ser indistinguibles — y eso se descubre tres meses después |
| **El papel del cargo** | comprobante del banco por NCF, o el papel propio del trabajo (`comprobante_de_trabajo`) | anticipo ISR de julio (2026-08-07): el comprobante DGII quedó varado en una subida cerrada como duplicado |

#### `registrar-asiento-diario.py` → Journals (360 líneas)

- **Cuenta de GRUPO → muere**: ADM no afecta agrupadoras; hay que usar la hoja.
- **Cuadre débitos = créditos pre-POST**, tolerancia 0,05. 🪦 ADM autoriza
  descuadrados sin chistar.
- **Sólo adopta el asiento que trae SU `Reference` + fecha**, jamás un gemelo por
  monto y fecha. ⚠️ **No alcanza** (enmienda E8): el script adopta y cierra sin
  comparar `TotalAmount`, y la `Reference` sale de `nro_referencia`, que es un
  dato tipeado. Se porta con **tres** llaves: referencia + fecha + monto al
  centavo.
- Readback con desanidado (`data.data` aparece en algunos recursos).

#### `registrar-transferencia-bancaria.py` → BankBankTransfers (336 líneas)

- `CashAccountID` = origen, `DebitAccountID` = destino, `DocType: BA_BA_TRA`, y el
  listado viene como **tupla `{Item1, Item2}`**.
- La barrera AMBIGUO **ya está portada en el script** (gemelos → míos → huérfanos
  → muere). ⚠️ El comentario de `poller.sh:289-295` sigue diciendo que este tipo
  «queda AFUERA a propósito» mientras el `case` de la línea 310 lo incluye: la
  justificación y el código se desincronizaron. Antes de encender este tipo hay
  que verificar cuál de los dos es la verdad operativa (precondición 7).

#### `registrar-pago-factura.py` → BillPayments (656 líneas)

| Guarda | 🪦 |
|---|---|
| **La factura se lee de ADM, no de la propuesta** — entre que alguien la miró y ahora pudo anularse, eliminarse o pagarse | el filtro `?DocID=` **miente**: pedir FP00001086 trajo FP00001119 y FP00001121 (2026-08-05). Se pagina y se filtra local |
| **Factura con `Void` → muere** | un pago contra un documento anulado queda colgado de nada |
| **Los saldos salen de `/api/AP`, la única fuente que los sabe** | `Balance` viene NULL en VendorBills y `Status` no distingue pagada de impaga: la FP00001027, ya casi cancelada, mostraba lo mismo que una recién cargada |
| **De MÁS nunca** | ADM no lo frena: acepta el excedente y lo deja como anticipo que nadie pidió |
| **De MENOS sólo declarado** (`"parcial": true`) | un abono es una decisión (la separación de 50.000 del local J-11); un monto corto sin querer es un cruce mal hecho río arriba. En el JSON se ven igual |
| **Diferencia < RD$1,00 no es abono: es la factura torcida** | **FP00001102**: la tarjeta cobró 330,00 contra 330,02 facturados. Se intentó mandarle a ADM una línea de «Diferencias por Redondeo» (**PP00000754**) y **la ignoró**: derivó su asiento de `Documents[].Amount` y cargó la tarjeta de más |
| **La suma de los renglones = exactamente lo que salió del banco** | si no, el asiento acredita la caja por algo distinto de lo que la caja movió |
| **Un solo `RelationshipID` por pago** | si no, ADM emite el pago entero a nombre del primero y salda las CxP de los otros contra un tercero |
| **`PaymentTypeID` resuelto por NOMBRE contra `/api/PaymentTypes`** | ADM lo exige («El tipo de pago es requerido»); los GUID son de esta instancia, no de un catálogo universal. Ojo: el nombre viene con **espacio al final** |
| **`ExchangeRate` por renglón copiado de la factura** | ADM lo valida contra la del documento, no contra la cabecera |
| **El Authorize se pregunta por COMPORTAMIENTO y se RELEE** | es `PUT` (con POST da 405) y esta API ya devolvió `success:true` sobre cosas que no hizo. Se consulta `OnlyPendingAuthorize` en vez de adivinar el nombre del campo |

#### `registrar-pago-cuenta.py` → AccountPayments (350 líneas)

- **El monto viaja en `Items[]`** (`Price × Quantity`), no en `Accounts[]`: sin
  `Items` el documento nace con **Total 0 y VACÍO**. 🪦 **PC00000376**
  (2026-08-15). `ExchangeRate` es requerido («la tasa de 0 no está permitida»).
- **`RelationshipID` = `auxiliar_id`** para cuentas control con auxiliar (CxP), o
  el mayor del proveedor queda sin auxiliar (🪦 PC00000377).
- **El asiento nace al Authorize**: antes el documento tiene Total y cero
  Accounts.
- **Cuadre POST-autorización**: releer y verificar D = C = monto sobre las líneas
  que ADM derivó de verdad. 🪦 **PC00000334**.

#### `poller.sh :: registrar_directo()` — las guardas del orquestador

Se portan al registrador y al barrido, no se pierden con el contenedor:

- **Criterio de admisión de un tipo**: «sólo se automatiza lo que **falla
  cerrado**» — no basta con que exista el script.
- **Lock por trabajo** (el barrido no re-dispara un POST en vuelo) → claim en la
  fila (§4).
- **Lock por empresa alrededor del registro**, con espera de 330s → turno por
  empresa (§4). 🪦 **CB00000225** (2026-08-05): dos cargos aprobados de un tirón,
  ADM le dio a los dos el mismo correlativo.
- **Reintento del choque de correlativo: UNA vez y sólo ése**, y sólo porque el
  script relee ADM antes de crear.
- **Timeout de 300s** con kill de respaldo.
- **Reintento escalonado por edad** (10 min → 30 min → 1 h, tope 12 h), con los
  tipos `criterio` y `caso` excluidos porque viven en `aprobada` para siempre.
  🪦 la ráfaga de 429 código 1308 («Usage limit reached for 5 hour»): el tope
  viejo de 2 h abandonaba las filas justo antes de que volviera la cuota.
- **El libro por plantilla después de registrar**; si la plantilla falla,
  despierta al contable.

### 2.2 Módulos compartidos nuevos

| Módulo | Qué es | Nota dura |
|---|---|---|
| `_shared/adm.ts` | **el único cliente HTTP de ADM**: Basic auth, query `company/role/appid` armada con `urlencode`, paginado (`skip` obligatorio / `take` ignorado / tupla `Item1`), saneador de errores, readback verificado, y la **lista blanca de rutas** (§3) | el rol vale `Contabilidad Digital` **con espacio**: sin encodear da HTTP 000 (~31s perdidos por factura antes del fix) |
| `_shared/cuadre.ts` | port de `cuadre.py`: `r2` medio-hacia-arriba, `total_segun_adm`, `cuadrar_items` | **JS no tiene `Decimal`**. Se implementa en aritmética entera de milésimas con half-up explícito, y se valida contra `casos-cuadre.json` (1.673 líneas) **caso por caso contra la salida de `cuadre.py`**. `Math.round` de JS es half-away-from-zero sobre binario: 60,255 → 60,25 y ahí se va la mitad de los descuadres |
| `_shared/guardas.ts` | topes, backdating, kill-switch, candado de nómina, sanitizador | §3 |
| `_shared/catalogo.ts` | cuenta→UUID, tax schedules, tipos de gasto, términos de pago, tipos de pago, cuentas de caja/tarjeta — **desde tabla por empresa**, con caché por invocación | mata la brecha 1: hoy son constantes hardcodeadas en seis archivos |

**El registrador NO importa `_shared/llm.ts`.** Es determinista por diseño y la
credencial ADM jamás comparte contexto con una llamada al modelo (§4.6). Se
verifica con un grep en el deploy, no con una intención.

### 2.3 Qué se reusa de la flota `admcloud-*`

| Pieza | Veredicto de F0 | Uso en F4 |
|---|---|---|
| `conciliacion-entradas` | **100% cubierto y superado** | se usa tal cual (alimenta el cuadre §7) |
| `admcloud-pago-impuesto` | el pago fiscal en nube **supera** al script | los `AccountPayments` de impuestos se orquestan sobre esta function, no se reescriben |
| catálogo cuenta→UUID + cuadre con absorción (de la flota) | ~30% de maquinaria reutilizable, **superior al script** | se absorbe en `_shared/catalogo.ts` y `_shared/cuadre.ts` |
| `admcloud-adjuntar` | existe; le faltan ~10 líneas para modo bucket/path | el adjunto del registrador sale por acá |
| `admcloud-verificar-registro` / `qualia-lapidas` | gemelo por click + batch ya portado en F1 | el circuito de vuelta; **no** lo llama el registrador |
| `admcloud-registrar-compra` | registra VendorReceptions de importación, **no** la VendorBill de gasto con NCF (~20%) | **no se usa**: se escribe |
| BillPayments a proveedor | cobertura **0** | se escribe |
| `admcloud-anular-registro` | existe y hoy acepta la anon pública | **el registrador no lo llama nunca** (§3, §9) |

---

## 3. Las guardas duras NUEVAS, en código

Ninguna de éstas existe hoy. Todas son **fail-safe**: ausencia, valor inválido o
base ilegible = NO escribir. Es el mismo criterio que ya cumple `modo()` en
`_shared/db.ts` («un flag que no se puede leer jamás autoriza a escribir»).

| Guarda | Default | Dónde vive | Qué pasa al chocarla |
|---|---|---|---|
| **Lista blanca de rutas de escritura** | ver abajo | `_shared/adm.ts`, en el **cliente**, antes de armar el request | excepción; no se llega a la red |
| **Default-deny de sign / void / delete** | siempre | `_shared/adm.ts` (redundante sobre la blanca) | excepción + evento + alerta: es señal de que alguien intentó algo que no debía |
| **Kill-switch de escritura** | `off` | `qualia_config` clave `escritura`, por empresa con default global | el registrador no escribe; la fila queda en `aprobada` con evento `registro_frenado` |
| **Tope de monto por documento** | RD$25.000 (Carlos fija) | `_shared/guardas.ts`, sobre el **payload ya armado** | doble llave: `registro_frenado` + espera confirmación humana |
| **Tope diario de escrituras** | 20 / empresa / día | RPC del claim, **dentro de la misma transacción** | el resto del día todo queda en `aprobada` + alerta |
| **Prohibición de backdating** | día 5 | `_shared/guardas.ts` | `registro_frenado`; sólo un waiver humano explícito lo levanta |
| **Período contable cerrado** | siempre | `_shared/guardas.ts` contra `/api/AccountingPeriods` | `registro_frenado`, sin waiver posible |
| **Candado de nómina** | siempre | `_shared/guardas.ts` | ruta §6, jamás la autónoma |
| **`empresa_id` nace de la fila** | siempre | el registrador | jamás del payload, del documento ni de nada que haya tocado un modelo |

### 3.1 Lista blanca — el candado que sí es real

El rol de ADM **no alcanza**: la firma e-CF no se recorta por rol (2026-08-02) y
los `Void` de `VendorBills`, `BankCharges` y `Journals` **pasan** con el rol
actual (re-sondeado 2026-08-14 — sólo `BillPayments/Void` y
`AccountPayments/Void` responden `Unauthorized`). Y hoy lo único que sostiene la
prohibición es un archivo gitignoreado en un volumen que no sobrevive
recreaciones. Por eso el candado vive en el cliente HTTP:

```
PERMITIDO (y nada más):
  POST   VendorBills · VendorCreditNotes · BankCharges · BankBankTransfers ·
         Journals · BillPayments · AccountPayments · Vendors · Storage
  PUT    BillPayments/Authorize · AccountPayments/Authorize
  GET    (lectura libre)
NEGADO por patrón, además de por la blanca:
  */void · */Void · electronicsign · removesign · cualquier DELETE ·
  CustomReports/Execute · CustomReports/ExecuteScalar · SaveBankFeeds ·
  BankFileImport · todo AR (CreditInvoices, CashInvoices, Customer*, Quotes…)
```

`Vendors` está en la blanca **sólo** para el alta con respaldo DGII de §2.1.
`Items`, `Accounts`, `PaymentTypes`, `FiscalSequences` y `AccountingPeriods` no:
crear maestros pide OK humano y lo hace una persona en la UI (regla 6 del repo).

### 3.2 El tope de monto es una doble llave, no un permiso

En F4 el registrador sólo corre sobre filas que un humano ya aprobó — así que un
tope de monto **no distingue autónomo de supervisado**: distingue el radio de
explosión de un error de la cañería. Diseño propuesto:

- monto ≤ tope → el registrador escribe;
- monto > tope → **no escribe**, evento `registro_frenado`, la fila sigue en
  `aprobada` y espera un **segundo evento humano** (`confirmar_registro`),
  distinto del aprobar.

🪦 La liquidación de aduana **FP00001133** fue de RD$939.118,86: por esta cañería
pasan documentos de siete cifras, y el aprobar de la mesa es un click.

> Dependencia fuera de esta function: el botón «confirmar registro» en la mesa
> web (Labs_Inv, `QualiaContaTab.jsx`). Sin él, el tope frena y nadie destraba.

### 3.3 El tope diario protege contra el barrido, no contra el humano

El barrido de rescate re-dispara filas viejas. Un bug de estado —o una migración
que toca `updated_at`— puede poner 200 filas «aprobadas sin registrar» en la
cola, y el registrador las escribiría todas. 🪦 la ráfaga de **18 aprobaciones
seguidas del 2026-08-03** produjo 464 respuestas 429; la misma forma de
estampida, ahora con POST a un libro fiscal. El contador se lee y se incrementa
**dentro de la transacción del claim**: dos invocaciones paralelas no pueden
pasar las dos por el número 20.

### 3.4 Backdating: el día 5 se calcula en hora local

La function corre en UTC; el día 5 es del calendario dominicano. `DocDate` de un
mes anterior después del **día 5 del mes siguiente, América/Santo_Domingo** →
frenado. Fundamento: el 606 de ese mes ya está en manos de la contable externa.

### 3.5 El kill-switch se re-lee ENTRE documentos

Un documento por invocación hace esto casi trivial, pero la regla se escribe
igual: el switch y la versión desplegada se re-chequean **antes de tomar el
siguiente trabajo**, nunca a mitad de un POST+readback (drain). Cada cambio del
flag deja fila con quién, cuándo y valor anterior, y dispara alerta. El permiso
de tocar el kill-switch **se separa** del permiso de elegir modelo: son dos
llaves distintas (§4.6 del plan madre).

---

## 4. Serialización e idempotencia

### 4.1 El problema, medido

ADM asigna el correlativo **al guardar**. No hay forma de pedirlo antes ni de
reservarlo. Dos POST simultáneos de la misma empresa chocan: el que pierde muere
con «Ya existe una transacción con el número CB00000225». 🪦 2026-08-05,
aprobando dos cargos de un tirón: uno entró y el otro se quedó 10 minutos
esperando al barrido.

Hoy eso lo evita un `flock` de archivo dentro del contenedor. **Entre
invocaciones de Edge Functions no existe ese archivo.**

### 4.2 Dos niveles, porque un advisory lock no sobrevive al POST

`pg_advisory_xact_lock` vive dentro de una transacción, y el POST a ADM ocurre
fuera de toda transacción (son decenas de segundos de HTTP). Un
`pg_advisory_lock` de sesión tampoco sirve: con pooling en modo transacción la
sesión no es estable, y una function que muere deja el lock colgado. El diseño
honesto es un **lease**, y el advisory lock protege lo único que sí es una
transacción corta: **tomarlo**.

| Nivel | Mecanismo | TTL | Qué protege |
|---|---|---|---|
| 1. Turno por empresa | tabla `qualia_registro_turno` (PK `empresa_id`), tomada por RPC que corre `pg_advisory_xact_lock(hashtext('qualia_registro:'||empresa_id))` y dentro de esa transacción hace el `update … where expira_en < now() returning` | 330s, renovable cada 60s | el correlativo de ADM |
| 2. Claim del trabajo | `update qualia_trabajos … where id=$1 and estado='aprobada' and claim vencido returning` | **por tipo, > presupuesto medido, renovable cada 60s** (E7 — el 330s original era más corto que el peor caso de la propia invocación) | que el barrido no re-dispare un POST en vuelo |

El lease **expira solo**: un worker muerto libera el turno sin intervención, que
es exactamente lo que un `flock` de archivo no hace bien en la nube. Si no
consigue turno, la invocación sale limpia y la fila queda para el barrido —
mismo comportamiento que hoy.

### 4.3 El evento `escritura_iniciada` va ANTES del POST

Es lo único que convierte «murió entre el POST y el readback» en un huérfano
**detectable**. Contenido mínimo:

```
{ recurso, referencia, ncf, monto, fecha_doc, hash_payload (sha256 canónico),
  empresa_id, trabajo_id, invocacion, turno_hasta }
```

Y su regla dura, portada tal cual de los scripts:

> **Nunca re-POST sin antes buscar el documento en ADM.** El barrido, al ver un
> `escritura_iniciada` sin `registrada` ni `registro_fallido`, **no reintenta**:
> busca por `Reference` y por NCF.

⚠️ **Esta regla, tal como estaba escrita, era la instrucción de escribir dos
veces.** Queda sustituida por las enmiendas E1, E6, E7 y E8, y su forma
normativa es ésta:

> - **Si aparece**: se cierra la fila **sólo** si coinciden las tres llaves
>   (referencia/NCF + fecha + monto al centavo, E8) **y** el tipo no tiene
>   `Authorize` pendiente (E6). Si el tipo tiene Authorize, se consulta
>   `OnlyPendingAuthorize` antes de concluir nada.
> - **Si NO aparece**: se re-dispara **únicamente** en los recursos donde la
>   precondición 10 probó que ADM persiste el `Reference`. Donde no persiste, la
>   recuperación es **humana**: la fila va a `esperando_respuesta` citando el
>   `escritura_iniciada` y su `hash_payload`, y nadie re-dispara solo (E1).
> - **Una `qualia_escrituras.iniciada` sin cierre no re-dispara nunca sola**, sin
>   importar si el claim venció (E7). El claim vencido autoriza a *investigar*,
>   jamás a *escribir*.

Los scripts ya lo dicen con todas las letras: *«fallo la llamada: si era un POST,
NO reintentes; volvé a buscar el documento antes de tocar nada»*. Esta API no
tiene clave de idempotencia y `success:true` ya volvió sobre cosas que no hizo.

### 4.4 El ledger de escrituras

Tabla nueva `qualia_escrituras`: una fila por intento, con `estado ∈ {iniciada,
confirmada, **parcial**, fallida, frenada}`, `hash_payload`, `adm_uuid`,
`adm_docid`, `invocacion`, `referencia_persistida` (bool, E1). **`parcial`** es
el estado nuevo de la enmienda E6: el documento existe en ADM pero le falta el
`Authorize` — ni confirmada ni fallida, y hoy no tiene dónde vivir. Es el libro del ESCRITOR, no un libro contable — no viola la regla
1 del repo (nada de contabilidad paralela): no guarda saldos ni asientos, guarda
intentos. De acá salen, sin inventar nada:

- el contador del tope diario (§3.3),
- la caza de huérfanos del cuadre 1:1 (§7),
- y la respuesta a «¿qué escribió el agente hoy?» sin pedirle nada a ADM.

### 4.5 Idempotencia de negocio, por tipo

| Tipo | Llave | Quién la frena |
|---|---|---|
| VendorBills / VendorCreditNotes | NCF **y** referencia del proveedor | ADM (las dos, independientes) + chequeo previo |
| BankCharges | `Reference` = NCF o `banco_tx_id` ⚠️ | sólo nosotros (ADM no frena) + AMBIGUO |
| BankBankTransfers | `nro_referencia` / `banco_tx_id` ⚠️ | sólo nosotros + AMBIGUO |
| Journals | `Reference` propia + fecha **+ monto al centavo** (E8) ⚠️ | sólo nosotros |
| BillPayments | `Reference` = `banco_tx_id` + saldo abierto en `/api/AP` ⚠️ | AP responde «ya está pagada» |
| AccountPayments | `Reference`, ignorando `Void` ⚠️ | sólo nosotros |
| Nómina | **cuentas afectadas (210.09 / 210.1 / 220.01 / 611.x) + monto del mes** (E2) | sólo nosotros. El `Reference` es dato, **no candado**: ED00000181 lo tiene mal tipeado |

⚠️ **Toda llave marcada así depende de un hecho que todavía no está medido**: que
ADM persista el `Reference` que le mandamos. Es la precondición 10 (E1) y se mide
recurso por recurso. Donde no persista, ese tipo **no se enciende**.

El reintento del choque de correlativo se porta con su límite: **una vez, sólo
ante ese mensaje**, y sólo porque el chequeo de duplicado vuelve a correr entero
antes del segundo POST.

---

## 5. La máquina de estados, y quién mueve qué

```
pendiente ──► analizando ──► propuesta ──► aprobada ──► registrada
                  │              ▲            │  ▲          │
                  ▼              │            │  │          ▼
          esperando_respuesta ───┘            │  │   (lápida: anulado_en /
                  ▲                          ▼  │    eliminado_en — no reabre)
                  └──────────────────────────┘  │
                     el registrador se traba    │
                                                └── registro_frenado (no cambia
                                                    de estado, sólo avisa)
```

| Transición | Quién la mueve | Condición dura |
|---|---|---|
| (nace) `pendiente` | web / cron de sugerencias | — |
| `pendiente → analizando` | preparador/proponedor (F2), claim atómico | — |
| `analizando → propuesta` | proponedor / contable | `propuesta` y `resumen` llenos |
| **`propuesta → aprobada`** | **SOLO el humano en la web** | invariante del proyecto. ⚠️ **Hoy es falso en el código**: con `_shared/db.ts` el registrador usa `service_role`, que saltea RLS y grants — puede aprobar su propia fila, subirse el tope y leer el `cron_bearer`. La invariante existe recién cuando esté la precondición 11 (E3) |
| `aprobada → registrada` | **`qualia-registrador`** | sólo tras readback OK. ⚠️ El CHECK `qualia_trabajos_registrada_con_evidencia` es lo único que `service_role` **no** saltea, pero no vive en este repo: está en `docs/esquema-del-bus.md` §5 y su migración en Labs_Inv. Precondición 12 (E3): localizarlo, versionarlo y extenderlo con `pendiente_autorizacion = false` (E6) |
| `aprobada → esperando_respuesta` | `qualia-registrador` | cuando el registro se traba y necesita al humano: AMBIGUO, proveedor sin respaldo DGII, cuenta inexistente o inactiva, moneda cruzada. Habilitada desde 2026-08-07 |
| `aprobada → aprobada` + `registro_frenado` | `qualia-registrador` | kill-switch, tope de monto, tope diario, backdating, período cerrado. **No es un error del documento**: la fila no cambia de estado |
| `* → error` | contable | con `error_detalle`; reservado a lo NO transitorio |
| `registrada → (lápida)` | `qualia-lapidas` | marca `anulado_en` / `eliminado_en`; **no reabre la fila ni re-registra**: qué hacer lo decide el humano |
| anular en ADM | **humano**, botón de la mesa → `admcloud-anular-registro` | el registrador **no tiene esa tool**. Void queda abierto por decisión del dueño (deja rastro, es el botón de la mesa, y las lápidas lo leen); la prohibición del agente vive en el código, no en el rol |
| re-registro tras muerte | `qualia-registrador` | el guard distingue registro **vivo** de muerto. ⚠️ **La marca sola NO autoriza el segundo POST** (E5): `qualia-lapidas` concluye `eliminado` con sólo ver `data` no-dict, sobre un recurso derivado de `documento_adm` —el campo que escribe el modelo—, y ése es exactamente el falso positivo de NCP00000006. Hacen falta las tres condiciones de E5: readback propio con recurso derivado del NCF, evento humano `confirmar_registro`, y edad mínima de la marca. 🪦 HUAYAO / **FP00001063**: sin la distinción, una factura corregida no se podía volver a registrar nunca |

**Eventos del registrador** (`qualia_eventos`, `autor='contable'`):
`escritura_iniciada` (antes del POST), `registrada` (tras readback, con
`adm_ref`), `registro_fallido` (error **saneado**), `registro_frenado` (nuevo,
con la guarda que lo frenó y qué destraba). Ningún error crudo de ADM se
persiste: la API refleja la URI completa **con el GUID de company** dentro del
JSON de error.

**Quién dispara al registrador**: trigger `AFTER UPDATE` en `qualia_trabajos`
cuando `estado` pasa a `aprobada` → `pg_net` con el bearer dedicado que nace en
la base. El poke perdido lo recoge `qualia-barrido` con su reintento escalonado.
Es el mismo patrón ya en producción desde F2.

---

## 6. El protocolo de la nómina

La nómina es el único caso donde **tres POST que no se deshacen** tienen que
salir juntos o no salir. En ADM revertir BORRA: no hay transacción, no hay
rollback, y un devengo duplicado es un mes de contabilidad mal contada.

**Reglas, en orden de dureza:**

1. **Jamás autónoma.** Las 3 piezas del devengo y los `AccountPayments` de TSS e
   INFOTEP se proponen con preview línea a línea y Excel adjunto, y un humano
   aprueba **cada pieza**. No se gradúa nunca (SPEC §5, plan-encendido §3.4).
2. **Candado doble.** (a) Todo `Journal` que toque 611.x, 210.04–210.10,
   220.01/220.02, o cuyo `Reference` matchee `nomina|tss|infotep|sueldo`, es
   no-autonomizable por código. (b) El cuadre diario alerta cualquier asiento
   autónomo que toque esas cuentas. Honestidad del diseño: **el rol de ADM no
   discrimina por cuenta**, así que este candado es de flujo + monitoreo.
3. **Una pieza por invocación, encadenada por evidencia.** La pieza 2 sólo sale
   si la 1 volvió con readback OK y su fila cerrada. Nada de un bucle que manda
   tres POST.
4. **Chequeo por CUENTAS y MONTO antes de cada POST, nunca por string** (E2).
   `NOMINA <MES> <AÑO>`, `REG. TSS EMPLEADOR <YYYYMM>` y
   `REG.INFOTEP EMPLEADOR <YYYYMM>` **no son llaves naturales**: las tipea un
   humano y el histórico ya las tiene mal — ED00000181, la TSS de julio, lleva
   `Reference "202606"`, así que buscar `"202607"` no la encuentra y la escribe
   de nuevo. Duplicar una nómina son ~RD$350.000 sin red. La barrera real: paginar
   los `Journals` del rango del mes y descartar por **cuentas afectadas**
   (210.09 / 210.1 / 220.01 / 611.x) **más monto**. El `Reference` se sigue
   mandando, pero como dato, no como candado.
5. **Si la pieza 2 o 3 falla: se reporta con NOMBRE y NÚMERO, y JAMÁS se
   reintenta solo.** El aviso dice qué asiento quedó escrito con qué DocID y cuál
   falta; la nómina del mes queda marcada **PARCIAL** en la fila madre; el
   reintento lo dispara un humano después de mirar ADM. Fundamento: un reintento
   ciego sobre un POST que quizá entró duplica el devengo, y deshacerlo borra.
6. **Aviso inmediato**, por el canal de avisos que ya existe — no se espera al
   cron de la mañana siguiente.
7. **Cuadre exacto al centavo**: ADM valida el cuadre del `Journal` al centavo;
   el redondeo del Excel se absorbe en 701.01/801.03 con tope 0,05.
8. **Trinquete de resolución**: detectar y luego agregar; nada baja de
   resolución, ningún mes se saltea porque el Excel llegó raro.
9. El débito del devengo sale de `SUM(Sueldos + Comisiones + Otras
   remuneraciones)`: **la columna «Total» del Excel no sirve** (resta 35.000).

---

## 7. El cron de cuadre 1:1 — precondición, no adorno

Es el detector de **todos** los modos de fallo de escritura, y por eso corre en
verde **antes** de que el registrador escriba su primer documento, no después.

**Dónde vive**: function propia `qualia-cuadre` con `pg_cron` diario (y
disparable a demanda). No dentro de `qualia-salud`: el cuadre necesita la
credencial de ADM y salud no, y mezclarlas ensancha el radio de explosión de la
function que menos lo necesita.

**Qué cruza, cada día:**

| Hallazgo | Cómo se detecta | Qué significa |
|---|---|---|
| **Huérfano** | documento en ADM del día, creado por el usuario API o con nuestra referencia, sin trabajo en `registrada` | escribimos algo que la mesa no sabe que escribió |
| **Fantasma** | trabajo `registrada` sin documento en ADM | la mesa dice «subida» sobre algo que no existe (lo mira también `qualia-lapidas`, por UUID; acá se mira del otro lado) |
| **Escritura colgada** | `qualia_escrituras.estado='iniciada'` sin cierre | murió entre el POST y el readback: se busca por referencia, con su `hash_payload` |
| **Descuadre de montos** | suma registrada del día ≠ suma aprobada del día | algo se escribió por otro monto |
| **Nómina fuera de protocolo** | cualquier Journal autónomo tocando 611.x / 210.04-210.10 / 220.0x | el candado de §6 falló |
| **Deriva de la API** | un listado cambia de shape | falla **ruidoso**: el cuadre se rompe antes que el registro |

**Trampas del paginado que el cuadre tiene que respetar**: `skip` es obligatorio
y `take` se ignora (página fija de 50); el listado **no trae los anulados**;
`BankBankTransfers` viene como tupla `{Item1, Item2}`; `Sales/Detailed` no
pagina.

**Criterio**: 14 días corridos en verde sobre la escritura del SERVER antes de
encender el primer tipo en la nube. Después queda para siempre.

---

## 8. Encendido por etapas

**Regla del cutover**: un tipo tiene **un solo escritor**. El flag es por empresa
**y por tipo** (`qualia_config` clave `escritura_tipos`), y `poller.sh` lee la
misma tabla y se abstiene de los tipos marcados `nube`. Dos escritores sobre el
mismo tipo = dos documentos en ADM, que es exactamente el fallo que este plan
existe para evitar.

⚠️ **El flag por tipo no alcanza** (enmienda E4). El correlativo de ADM es **por
empresa**, no por tipo: un `BankCharges` en nube y un `VendorBills` en server
chocan igual (🪦 CB00000225). Y son dos candados que no se ven — el `flock` del
contenedor y el lease de la base. Por eso, **en el mismo commit que enciende
F4.2**: `poller.sh` toma `qualia_registro_turno` por psql antes de cada registro
(precondición 13), y todo flip pasa a ser de **tres pasos con drenado**: flag a
`nadie` → esperar a que no queden `iniciada` en `qualia_escrituras` ni turno vivo
→ flag al escritor nuevo. Vale para encender y para revertir: son 8 etapas más
sus rollbacks, o sea 16 ventanas.

> Consecuencia operativa: cada etapa incluye **un deploy al server** (leer el
> flag por tipo en `script_de_registro`), con sus tres puntas — local, GitHub y
> server en el mismo commit. Es la misma letra chica que pagó F2 con
> `qualia_modo`.

| Etapa | Alcance | Terminado cuando | Rollback |
|---|---|---|---|
| **F4.0** Precondiciones | **las 18 de §11.4** (las 9 de §0.2 + las 9 de la revisión adversarial) | las 18 en verde, cada una con su evidencia escrita en el libro de acción | — (no se tocó nada) |
| **F4.1** Backtest del registrador (cero escrituras) | recomputar el payload de las últimas N filas ya registradas por el server y **diffearlo campo por campo contra el documento REAL en ADM** (readback) | cero diferencias fuera de tolerancia en un lote variado por tipo; el banco `casos-cuadre.json` en verde en TS; **ED00000181 detectado por la barrera de nómina** (E2) y **la regla de adopción de tres llaves probada contra gemelos del histórico** (E8) | — |
| **F4.2** `BankCharges` | primer tipo en nube | 15 documentos consecutivos sin corrección · cuadre 1:1 verde · cero `escritura_iniciada` sin cierre · cero AMBIGUO mal resueltos | flag del tipo → **drenado de tres pasos** (E4), no flip directo; el poller lo retoma con el turno tomado |
| **F4.3** `Journals` no-nómina | segundo tipo | ídem, + cero descuadres detectados post-registro | flag |
| **F4.4** `VendorBills` + `VendorCreditNotes` | el volumen, con alta de proveedor y adjunto | ídem, + cero altas de proveedor sin respaldo DGII · 100% de documentos con adjunto o con su motivo escrito · el 606 del mes revisado por la contable externa sin hallazgos | flag |
| **F4.5** `BankBankTransfers` | tras resolver la precondición 7 (la lista y su comentario) | ídem, + las dos patas cruzadas contra `openbanking_transactions` | flag |
| **F4.6** `AccountPayments` | primer tipo con Authorize | ídem, + cero pagos quedados en «pendiente de autorización» sin aviso —**medible recién con el estado `parcial` y el aviso de E6**; sin eso este criterio no se puede verificar— · cuadre post-Authorize en verde | flag |
| **F4.7** `BillPayments` | el último autónomo | ídem, + cero anticipos generados · cero facturas cerradas por diferencia de redondeo | flag |
| **F4.8** Nómina | protocolo §6, con OK humano por pieza | una corrida mensual completa, las 3 piezas + los pagos, sin reintento automático | el humano no confirma: nada sale |
| **F4.9** Apagón del `mesa` | muere `qualiaconta-mesa-blackbox` y el último proceso de qualia en CodeBox | criterio original de Entrega 2 (una factura de punta a punta sin tocar nada) + cuadre 1:1 verde 2 semanas | kit de rollback **fuera del server** (tar + `docker save` + `.env` cifrado); el contenedor queda `stop`, no `rm`, 30 días |

**Antes de F4.9, sin excepción**: reescribir `respaldo-documentos.sh` para que
lleve su propia conexión. Hoy hace `docker exec` al contenedor `mesa`, y es la
**única copia** de los documentos del bucket. Si `mesa` muere primero, el
respaldo muere con él sin que nadie se entere.

**Rollback global, en cualquier momento**: kill-switch `escritura → off`. El
poller del server sigue instalado y vivo hasta F4.9, así que volver atrás es un
flag más un tick.

---

## 9. Qué queda EXPLÍCITAMENTE fuera

**Del registrador, para siempre:**

- **Anular (`Void`)**: el registrador no tiene esa tool. Void queda abierto por
  decisión del dueño —deja rastro y es el botón de la mesa—, pero lo aprieta un
  humano.
- **Eliminar (`DELETE`)**: negado por rol Y por la lista blanca.
- **Firmar / desfirmar e-CF** (`ElectronicSign`, `RemoveSign`): default-deny en
  código, porque el rol **no lo recorta**.
- **Editar (`PUT`)** documentos ya creados, salvo los dos `Authorize` de la lista
  blanca.
- **Toda la emisión AR**: facturas y notas a clientes, cotizaciones, órdenes de
  venta, promociones, recurrentes.
- **Declarar**: 606 / 607 / IT-1 los sigue haciendo la contable externa.
- **`CustomReports/Execute` y `ExecuteScalar`** (query arbitrario),
  **`SaveBankFeeds` / `BankFileImport`** (inyectan movimientos bancarios),
  **`BankReconciliations`**.
- **Crear maestros**, salvo `Vendors` con respaldo DGII: `Items`, `Accounts`,
  `PaymentTypes`, `FiscalSequences`, `AccountingPeriods` los crea un humano en la
  UI (regla 6 del repo).
- **Aplicar notas de crédito** (`VendorCreditApplications`, prefijo ACP): queda
  como deuda **visible** escrita en la fila, no como cosa que el agente resuelva.
- **Decidir**: el registrador no clasifica, no elige cuenta, no elige tipo de
  gasto y **no llama al LLM**. La única «decisión» que toma es corregir
  `documento_adm` cuando el NCF dice E34 — y eso no es un juicio, es un hecho
  fiscal.
- **`propuesta → aprobada`**: no tiene el verbo ni el grant.
- **Nómina autónoma**: jamás, en ninguna fase.
- **Reintentar un POST con timeout** sin haber buscado antes el documento en ADM.

**De este plan (van a otro lado):**

- La **RLS por `empresa_id`** del bus y la **segunda empresa**: prerrequisito de
  F5, no de F4.
- El **botón «confirmar registro»** de la mesa web (Labs_Inv): dependencia
  nombrada en §3.2, se construye allá.
- La **auditoría de la flota `admcloud-*`** y el **partido de credenciales a
  Vault**: son precondiciones (§0.2), no entregables del registrador.
- La **destilación de precedentes** y la graduación B→C de
  `plan-encendido-escritura` §3: otro eje (§0.1).

---

## 10. Anexo — derivas encontradas al escribir este plan

Tres cosas que no estaban en el inventario y hay que resolver antes de F4:

1. **El comentario de `poller.sh:280-295` contradice a su propio `case`.** Dice
   que `BankBankTransfers` «queda AFUERA a propósito» porque su script adopta el
   gemelo; el script **ya tiene** la barrera AMBIGUO y la línea 310 lo despacha.
   O el comentario quedó viejo o el tipo se enchufó sin revisar su justificación.
   Hay que decidir cuál, porque de ese párrafo salió el criterio de admisión
   («sólo se automatiza lo que falla cerrado»).
2. **La lista de tipos registrables vive en tres lugares** (`script_de_registro`,
   `ENDPOINTS` de `qualia-lapidas`, y el comentario de arriba) y ya se
   desincronizó tres veces, cada una con su documento fantasma o su lápida falsa.
   En el diseño nuevo va en **una tabla**, leída por el registrador, por las
   lápidas y por el cuadre.
3. **`subir_adjunto` está duplicada en tres scripts** con tres implementaciones
   distintas (multipart a mano ×2, `curl` ×1) y comportamientos distintos ante el
   fallo. El comentario del segundo lo dice: *«si aparece una tercera, ahí sí
   vale un módulo compartido»*. Apareció.

---

## 11. Enmiendas de la revisión adversarial

> **Veredicto: `no_construir_todavía`.** Tres revisores atacaron el diseño por
> dinero/irreversibilidad, operación/convivencia y permisos/superficie. Ocho
> hallazgos de severidad **alta**, ninguno descartado: los ocho se verificaron
> línea por línea contra el código citado y los ocho se sostienen.
>
> **Estas enmiendas son NORMATIVAS y mandan sobre el cuerpo de este documento
> donde choquen.** Donde el cuerpo decía otra cosa, ya está corregido y marcado
> con ⚠️; esta sección guarda la evidencia y el porqué, que es lo que un port
> pierde primero.

Patrón común de los ocho: **el plan trata como hechos varias cosas que los
scripts fuente tratan como preguntas abiertas.** Cada guarda del cuerpo está bien
razonada; lo que falla es que se apoyan en identidades, permisos y candados que
nadie midió todavía. Por eso el veredicto no es «está mal», es «todavía no».

### 11.1 Las ocho enmiendas

#### E1 — El `Reference` es una hipótesis, no una llave

**Manda sobre**: §4.3, §4.5, §6.4.

Toda la idempotencia de F4.2–F4.5 cuelga de que ADM guarde el `Reference` que le
mandamos. Los scripts fuente **no lo dan por hecho**:
`registrar-cargo-bancario.py:348-351` dice *«los 166 cargos históricos la tienen
en null porque nadie la mandaba nunca; desde acá va siempre, y el readback dice
si ADM la persiste»*, y `:434-440` tiene la rama explícita para cuando vuelve
vacía. Igual en `registrar-asiento-diario.py:307-310`. Y `BankCharges` —el tipo
donde la pregunta está abierta— es justo el primero que se enciende.

Lo duro: la única identidad que ADM devuelve con certeza es el UUID en el cuerpo
del POST. Si la invocación muere antes de leer ese cuerpo y el `Reference` no
persiste, el documento queda **sin ninguna llave**. El `hash_payload` de §4.4 no
ayuda: no vive en ADM.

**Normativo:**

1. «ADM persiste `Reference`» se mide **recurso por recurso**, con POST real, y
   queda en el libro de acción antes de F4.1 (precondición 10).
2. En código: si el readback muestra que no persistió, la fila **no cierra en
   `registrada`** — va a `esperando_respuesta` citando el DocID, y el tipo se
   apaga por flag.
3. En los recursos sin `Reference` persistido, **la recuperación de huérfanos es
   humana**. Jamás re-disparo automático.

#### E2 — La llave de nómina ya está escrita mal en el histórico

**Manda sobre**: §1 (fila 7), §4.5, §6.4.

§6.4 apoyaba la barrera del devengo en buscar `NOMINA <MES> <AÑO>` /
`REG. TSS EMPLEADOR <YYYYMM>`. El inventario del propio repo la desmiente dos
veces en la misma página: `docs/hoja-de-ruta-registro.md:701-703` —
*«ED00000181 (julio) tiene `Reference "202606"`. Buscar "202607" no la encuentra
→ riesgo real de registrarla dos veces»*— y al lado *«Duplicar una nómina son
~RD$350,000 en los libros, sin red»*.

Son **dos fallos de match encadenados**: el período está mal tipeado, y el
`Reference` real es `202606` pelado, no el string completo que el plan buscaba.
Una llave que un humano tipea a mano no es una llave natural — y ésta ya falló en
producción para el mes exacto que el registrador iba a chequear.

**Normativo:** antes de cada POST de nómina, paginar los `Journals` del rango del
mes y descartar por **cuentas afectadas (210.09 / 210.1 / 220.01 / 611.x) más
monto**. El `Reference` queda como dato, no como candado. **ED00000181 es caso
obligatorio del backtest F4.1: si el diseño no lo detecta, F4.8 no arranca.**

#### E3 — `service_role` convierte en decorativas las guardas de §3 y §5

**Manda sobre**: §3 (tabla completa), §5 (filas `propuesta → aprobada` y
`aprobada → registrada`), §0.2.

§5 declara como invariante que el registrador «no tiene ese verbo ni el grant».
Con el cliente que existe hoy, **es falso**: `supabase/functions/_shared/db.ts:8-20`
arma el cliente con `SUPABASE_SERVICE_ROLE_KEY`, y
`supabase/migrations/20260816000100_infra_nube_f1.sql:57-59` le da
`grant select, insert, update, delete`. `service_role` saltea RLS y grants: el
registrador puede mover su propia fila a `aprobada`, subirse el tope diario,
apagar el kill-switch y leer el `cron_bearer`, que vive en esa misma
`qualia_config`. El propio código lo grita: *«TODO(F4): cambiar a llave
restringida… el plan §4.6 exige partir credenciales y permisos ANTES de encender
la escritura — este es el punto único donde se cambia»*. Las 9 precondiciones de
§0.2 no lo incluían.

Lo único que `service_role` **no** saltea es un CHECK. Y el CHECK
`qualia_trabajos_registrada_con_evidencia`, del que §5 decía que «lo hace
imposible de otra forma», **no está en ninguna migración de este repo**: vive
como DDL documentada en `docs/esquema-del-bus.md:221`, y su migración pertenece a
Labs_Inv (`frontend/supabase/migrations/`). O sea: el plan se apoyaba en una
garantía sin dueño declarado.

**Normativo:**

1. El registrador corre con **rol de base propio**, sin `UPDATE` sobre
   `qualia_config` ni sobre `estado` fuera de una RPC `SECURITY DEFINER` que sólo
   admite `registrada` y `esperando_respuesta` (precondición 11).
2. Kill-switch, tope diario y ledger quedan **fuera de su alcance de escritura**.
3. El CHECK se localiza en la base viva, se versiona en el repo que sea dueño de
   `qualia_trabajos`, y se **extiende** con `pendiente_autorizacion = false`
   (E6). Ese reparto entre repos se decide y se escribe: hoy las migraciones de
   QualiaConta ya tocan esa misma base (`admcloud_empresas`), así que la
   ambigüedad es real (precondición 12).

#### E4 — Dos mutex que no se conocen, y un flip sin drenado

**Manda sobre**: §4.1, §4.2, §8.

§8 promete «un tipo tiene un solo escritor», pero el correlativo lo protege hoy
un `flock` **de archivo dentro del contenedor** y en la nube lo protegerá
`qualia_registro_turno`: dos candados en dos sustratos que no se ven, y nada
obligaba al poller a tomar el de la base. Peor: **el correlativo de ADM es por
EMPRESA, no por tipo** (🪦 CB00000225 fueron dos cargos de la misma empresa), así
que un flag por tipo no evita que un `BankCharges` en nube choque con un
`VendorBills` en server. Y el flip no tenía drenado: el poller lee el flag en su
tick mientras el trigger `AFTER UPDATE` dispara al instante. Ocho etapas más sus
rollbacks = dieciséis ventanas donde el fallo que este plan existe para evitar
está abierto por diseño.

**Normativo:**

1. **Los dos escritores toman el mismo turno.** `poller.sh` toma
   `qualia_registro_turno` por psql antes de cada registro, y eso entra **en el
   mismo commit que enciende F4.2**, no después (precondición 13).
2. Todo flip —de encendido y de rollback— es de **tres pasos**: flag a `nadie` →
   esperar a que no queden `iniciada` en `qualia_escrituras` ni turno vivo → flag
   al escritor nuevo.

#### E5 — La lápida autoriza un segundo POST sin que nadie vuelva a mirar ADM

**Manda sobre**: §5 (fila «re-registro tras muerte»), §2.3.

Quien escribe `anulado_en`/`eliminado_en` es otro componente:
`verificar-registros.py:128-131` concluye `eliminado` con sólo ver que `data` no
es un dict — que es exactamente el falso positivo de **NCP00000006**, documentado
en ese mismo archivo `:57-64`: preguntarle a `VendorBills` por el UUID de una NCP
devuelve `success:true, data:null`. El recurso al que pregunta sale de
`documento_adm`, **un campo que escribe el modelo**, y su lista `ENDPOINTS`
(`:80-82`) es una de las tres que la precondición 7 admite desincronizadas.

Hoy una lápida falsa sólo tacha una fila. En F4 es **permiso de escritura sobre
un documento vivo**: dos VendorBills con el mismo NCF, o dos Journals sin ninguna
barrera. Que el registrador «no llame» a las lápidas no lo salva — consume su
salida como autorización para escribir, que es peor: la guarda que decide se
evalúa en otro proceso, con otra lista y otro criterio.

**Normativo:** el re-registro tras lápida **no lo dispara la marca**. Exige las
tres cosas juntas:

- **(a)** el propio registrador rehace `GET <recurso>/<uuid>` con el recurso
  derivado del **NCF o del prefijo del DocID**, jamás de `documento_adm`;
- **(b)** un evento humano explícito `confirmar_registro` — el mismo verbo que ya
  existe para el tope de monto (§3.2), no una superficie nueva;
- **(c)** edad mínima de la marca.

Y `qualia-lapidas` **no puede concluir `eliminado`** cuando el tipo salió de un
campo escrito por el modelo: ahí es `indeterminado` (precondición 15).

#### E6 — POST hecho + Authorize fallido: sin estado, con dos recetas opuestas

**Manda sobre**: §4.3, §4.4, §8 (F4.6/F4.7).

§4.3 mandaba que al encontrar el documento el barrido «haga readback y cierre la
fila». §1 dice lo contrario para estos tipos: un `AccountPayments` sin autorizar
*«tiene Total y cero Accounts; decir "registrado" sobre eso es una lápida
falsa»*. Los dos scripts fuente ya hacen cosas opuestas:

- `registrar-pago-cuenta.py:308-311` hace `morir()` y **no escribe nada en la
  mesa**: el pago existe en ADM, la mesa no lo sabe, y `docids_reclamados()`
  tampoco lo ve — el próximo pase gira en «YA REGISTRADO» o crea un **segundo
  pago**, según si el listado trae los pendientes, cosa que nadie sondeó.
- `registrar-pago-factura.py:617-646` escribe `estado='registrada'` con
  `pendiente_autorizacion: true`, y **ningún consumidor lee ese flag** — ni §5 ni
  el cuadre de §7.

Encima §3.1 dice que `AccountPayments/Void` y `BillPayments/Void` responden
`Unauthorized`: **el medio-pago no lo puede deshacer la cañería**. F4.6/F4.7
pedían «cero pagos quedados en pendiente de autorización sin aviso» como criterio
de salida, y ninguna guarda del plan producía ese aviso.

**Normativo:**

1. Estado propio: fila `parcial` en `qualia_escrituras` + `esperando_respuesta`
   con motivo.
2. **Aviso inmediato** por el canal de avisos que ya existe (§6, regla 6), no el
   cron de la mañana siguiente.
3. El CHECK de evidencia se extiende: `registrada` exige
   `pendiente_autorizacion = false` (E3).
4. §4.3 se carvea por tipo: **en tipos con Authorize, «aparece en ADM» nunca
   cierra la fila sola** — hay que consultar `OnlyPendingAuthorize`. El patrón ya
   está escrito en `registrar-pago-factura.py:595-598`; se porta, no se inventa.

#### E7 — El claim de 330s es más corto que el peor caso, y no se renueva

**Manda sobre**: §4.2, §4.3.

§4.2 le daba al turno 330s renovables y al claim 330s **sin renovación**. El
presupuesto real de una invocación, con los números que están en los scripts:
paginado de catálogos y duplicados (**9,04s medidos** sólo para el barrido de
VendorBills, `registrar-en-adm.py:670-691`), POST con `TIMEOUT = 90`, readback
otros 90, adjunto con `timeout=180`
(`registrar-cargo-bancario.py:199`), y en `BillPayments` dos paginados completos
extra por `sigue_pendiente()` más el Authorize. **Se pasa de 330s sin
esforzarse.** Cuando el claim vence con el POST en vuelo, el barrido re-dispara
el mismo trabajo: el camino de doble escritura que §4 existe para cerrar, abierto
por su propio TTL. El plan tampoco nombraba el límite de wall-clock de Edge
Functions, que es justo lo que fija cuántos huérfanos va a haber.

**Normativo:**

1. **Presupuesto de tiempo escrito por tipo**, medido, no estimado.
2. TTL del claim **por encima** de ese presupuesto y **renovable** igual que el
   turno.
3. Cerrar la puerta por el otro lado: el barrido consulta `qualia_escrituras`
   antes de re-disparar, y **una `iniciada` sin cierre nunca re-dispara sola**,
   sin importar el claim (precondición 14).

#### E8 — Adoptar por `Reference` + fecha sin comparar monto

**Manda sobre**: §2.1 (asientos), §4.3, §4.5.

`registrar-asiento-diario.py:270-291`: si aparece un `Journal` con la misma
`Reference` y la misma fecha, imprime *«YA REGISTRADO… Guardo y cierro»*, escribe
`registro_adm` y pone `registrada` — **sin comparar `TotalAmount` ni las
líneas**. La `Reference` sale de `nro_referencia` de la propuesta (`:126`), un
dato tipeado por el banco o por un humano, y ya se repitió en el histórico
(ED00000181). §4.3 repetía la misma forma para el barrido.

El resultado no es un duplicado: es lo contrario, y peor de encontrar. La fila
queda **cerrada sobre el documento equivocado** — el trabajo real nunca se
registra, y la mesa dice que sí. Un duplicado se ve en el cuadre de montos; esto
no: los dos libros cuadran en cantidad de documentos y ninguno en contenido.

**Normativo:** la adopción exige **tres llaves juntas** —referencia/NCF + fecha +
`TotalAmount` al centavo— en el script y en el barrido. Si coinciden dos de tres,
es **AMBIGUO**: no se adopta, no se escribe, y se le pregunta al humano citando
los DocID, exactamente como ya hace `registrar-cargo-bancario.py`
(precondición 18).

### 11.2 Qué no se aceptó como novedad, y por qué

Ninguno de los ocho hallazgos se descartó, pero tres tenían cobertura **parcial**
en el cuerpo, y decirlo evita inflar el documento:

- **E1 estaba cubierto a nivel script, no a nivel diseño.** §2.1 ya listaba
  «Verificar que ADM persistió el `Reference`» como guarda de `BankCharges`. Lo
  que faltaba era la **consecuencia**: el plan construía la idempotencia de cinco
  tipos encima de esa verificación sin esperar su resultado. La enmienda no
  agrega la sonda, agrega el **candado que cuelga de ella**.
- **E6 ya era conocido, y por eso el plan se contradecía.** §1 decía que llamar
  «registrado» a un pago sin autorizar es una lápida falsa, y §4.3 mandaba
  hacerlo. La enmienda no descubre el problema: resuelve la contradicción y le da
  **estado** a algo que hoy no tiene dónde vivir.
- **E7 refuerza una regla que ya existía.** §4.3 ya prohibía re-POST sin buscar
  antes en ADM. Lo nuevo es la **segunda barrera** (`qualia_escrituras`), que
  hace falta justamente porque E1 demuestra que la búsqueda en ADM puede no
  encontrar nada aunque el documento exista.

Y una nota de superficie: **E5 no crea un botón nuevo.** Reusa
`confirmar_registro`, el evento humano que §3.2 ya necesita para el tope de
monto. Una sola superficie de confirmación, dos motivos para invocarla.

### 11.3 Lo que estas enmiendas cambian en el orden de trabajo

El veredicto `no_construir_todavía` no mueve el orden de los tipos de §1: mueve
**el contenido de F4.0**. Cinco de las nueve precondiciones nuevas (10, 11, 12,
13, 15) son trabajo de **infraestructura y permisos**, no del registrador — y
tres de ellas viven parcialmente fuera de este repo (el CHECK en Labs_Inv, el
turno en `poller.sh`, el rol en la base). Eso es lo que hay que planificar
primero, y es la razón real por la que F4 no arranca esta semana.

### 11.4 Precondiciones bloqueantes de F4 — forma final

Las 9 originales de §0.2 más las 9 de esta revisión. **Ninguna se da por buena
sin evidencia escrita en el libro de acción**: «lo revisé» no es verificación.

| # | Precondición | Cómo se verifica | Bloquea |
|---|---|---|---|
| 1 | Rol único consolidado (`ADMCLOUD_ROLE` = `ADMCLOUD_REG_ROLE`) y sondas §1.3 en verde | `diff` de los dos valores en el `.env` + las sondas de §1.3 corriendo con el rol único y su salida pegada en el libro | toda escritura |
| 2 | Default-deny de `electronicsign`/`removesign`/`*/void`/`DELETE` portado a código | test unitario de `_shared/adm.ts` que intenta las 6 rutas negadas y espera excepción **antes de la red** (sin mock de HTTP: si sale un request, falla) | toda escritura |
| 3 | Flota `admcloud-*` auditada: autorización caller→empresa | las 10 functions con su chequeo de caller escrito y un test por function con caller ajeno → 403; `anular-registro` sin aceptar la anon pública | toda escritura |
| 4 | Credenciales ADM/SMTP partidas de `admcloud_empresas` a Vault | `grep` de `select('*')` en la flota = 0 sobre la tabla de credenciales; la credencial se lee sólo por Vault | toda escritura |
| 5 | Cron de cuadre 1:1 en verde **14 días** (§7) | 14 corridas consecutivas sin hallazgo, sobre la escritura del **server**, con el reporte diario archivado | F4.2 |
| 6 | Turno por empresa + claim en la fila (§4) | test de concurrencia: dos invocaciones simultáneas de la misma empresa, una escribe y la otra sale limpia sin POST | F4.2 |
| 7 | La lista de tipos registrables vive en **un** solo lugar | la tabla existe y `script_de_registro`, `ENDPOINTS` de `qualia-lapidas` y el cuadre la leen; el comentario de `poller.sh:280-295` resuelto contra su `case` (§10.1); test que falla si alguna lista se define aparte | F4.2 |
| 8 | Catálogo de GUIDs por empresa en tabla | `grep` de las 6 constantes (`TaxScheduleID`, `ExpenseTypeID`, `TERMINOS`, `UUIDS_CONOCIDOS`, `TARJETAS`, `CUENTAS_BANCO`) = 0 en el código del registrador; el catálogo resuelve para una empresa que no es Blackbox | F4.2 |
| 9 | Banco de pruebas del cuadre corriendo en TS | los 1.673 casos de `casos-cuadre.json` verdes en TS **comparados caso por caso contra la salida de `cuadre.py`**, no contra el esperado del JSON | F4.1 |
| **10** | **ADM persiste `Reference`, medido recurso por recurso** (E1) | un POST real por recurso (`BankCharges`, `Journals`, `BankBankTransfers`, `VendorBills`, `BillPayments`, `AccountPayments`) + readback que compare el `Reference` devuelto contra el mandado; la matriz recurso→sí/no escrita en el libro. Los recursos que den «no» nacen apagados | F4.1 y **cada tipo** |
| **11** | **Rol de base propio del registrador, sin `service_role`** (E3) | el `.env` de la function no tiene `SUPABASE_SERVICE_ROLE_KEY`; test negativo: con la llave del registrador, un `update` a `qualia_config`, un `update` de `estado` a `'aprobada'` y un `select` del `cron_bearer` fallan los tres con permission denied | toda escritura |
| **12** | **CHECK de evidencia localizado, versionado y extendido** (E3, E6) | `select conname … from pg_constraint` sobre la base viva devuelve el CHECK; el archivo de migración existe en el repo dueño de `qualia_trabajos`; test negativo: `update … set estado='registrada'` sin docid **y** con `pendiente_autorizacion=true` fallan los dos | toda escritura |
| **13** | **Un solo mutex: `poller.sh` toma `qualia_registro_turno`** (E4) | test de convivencia: poller y registrador arrancando a la vez sobre la misma empresa con tipos **distintos** → un solo POST a la vez, verificado contra el correlativo de ADM. El commit que enciende F4.2 incluye el cambio del poller | F4.2 |
| **14** | **Presupuesto de tiempo por tipo + TTL renovable + wall-clock de Edge escrito** (E7) | la tabla tipo→p95 medida sobre el backtest, con el TTL configurado por encima; test: una invocación que excede el presupuesto **renueva** el claim y no se le vence; el límite de wall-clock de Edge Functions citado con su fuente | F4.2 |
| **15** | **`qualia-lapidas` no concluye `eliminado` sobre recurso derivado de `documento_adm`** (E5) | caso de prueba con el UUID de NCP00000006 y `documento_adm='VendorBills'` → devuelve `indeterminado`, no `eliminado`; y el registrador rehace su propio readback antes de cualquier re-registro | F4.2 |
| **16** | **Estado `parcial` + aviso inmediato para creado-sin-autorizar** (E6) | la fila `parcial` existe en `qualia_escrituras`; simulacro de Authorize fallido → fila `parcial`, trabajo en `esperando_respuesta`, aviso emitido en el momento, y el cuadre §7 lo lista | F4.6 |
| **17** | **Barrera de nómina por cuentas + monto** (E2) | el backtest F4.1 corre contra ED00000181 y **la detecta pese al `Reference "202606"`**; y detecta un devengo gemelo inyectado a propósito con `Reference` distinto | F4.8 (caso obligatorio en F4.1) |
| **18** | **Regla de adopción de tres llaves** (E8) | test contra el histórico: un `Journal` con misma referencia y fecha pero **otro monto** → AMBIGUO, no adopta, no cierra la fila; dos de tres llaves nunca cierran | F4.1 |

**Regla de cierre.** Las 18 en verde no autorizan a escribir: autorizan a
**empezar F4.1**, que sigue siendo cero escrituras. El primer POST del registrador
en la nube sale recién después de F4.1 verde y con el cuadre 1:1 corriendo hace
14 días sobre la escritura del server. El veredicto de los revisores —
`no_construir_todavía`— se levanta con evidencia, no con una fecha.
