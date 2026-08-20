# Plan de encendido gradual de escritura en ADM Cloud — QualiaConta (Blackbox)

> Alcance: de CERO escrituras a operar el registro diario (compras, gastos, traspasos entre cuentas, asientos de diario incluida la nómina desde Excel). ADM Cloud es el libro oficial y el blast radius es el libro fiscal real. Emitir facturas, anular de forma autónoma, firmar/desfirmar e-CF y declarar (606/607/IT-1) quedan fuera para siempre: los reportes DGII los sigue haciendo la empresa contable externa.

**Mapa de la superficie real de escritura** (de los hallazgos, no del swagger teórico): en Blackbox las compras NO usan órdenes (`PurchaseOrders`=0) ni el módulo de gastos de GL (`Expenses`=0). El flujo real es:

| Operación del negocio | Endpoint ADM | Volumen histórico | Reversa real |
|---|---|---|---|
| Compra / gasto con factura de proveedor | `POST /api/VendorBills` | 1,050 (FP#####) | `POST /api/VendorBills/Void` |
| Cargo bancario (comisiones, etc.) | `POST /api/BankCharges` | 159 (CB*) | `POST /api/BankCharges/Void` |
| Traspaso entre cuentas propias | `POST /api/BankBankTransfers` | 203 | `POST /api/BankBankTransfers/Void` |
| Asiento de diario (incl. nómina) | `POST /api/Journals` | 186 (ED########; 60 son nómina/TSS/INFOTEP) | `POST /api/Journals/Void` |
| Adjuntar soporte (PDF/Excel) | `POST /api/Storage` (vincula por `TransactionID`) | — | `DELETE /api/Storage/{ID}` (solo humano) |

Los pagos (`BillPayments`, `AccountPayments`) quedan **explícitamente fuera de este plan**: extenderles el rol será un evento auditado posterior, con su propia graduación.

---

## 1. Pre-requisitos: usuario y rol API recortado

### 1.1 Qué pedir exactamente (mapeado a los endpoints hallados)

Un **usuario API nuevo y dedicado** (no el de Carlos, no el usuario de solo-lectura actual) con un rol nuevo, p.ej. `QualiaConta-Registro`, clonado del rol `contabilidad` actual. En la matriz de permisos por pantalla de ADM:

**Conceder (Ver + Registrar únicamente):**
- Compras → Facturas de Proveedor (`VendorBills`)
- Bancos → Cargos Bancarios (`BankCharges`)
- Bancos → Traspasos entre Cuentas (`BankBankTransfers`)
- Contabilidad → Entradas de Diario (`Journals`)
- Archivos/Storage → subir adjuntos (`Storage` POST)

**Negar en esas mismas pantallas:** Modificar (PUT), Anular (Void) y Eliminar (DELETE). La corrección del agente es siempre "humano anula + agente re-registra": el agente no edita ni anula nada por API, nunca.

**Negar módulos completos** (el agente conserva solo lectura donde ya la tiene):
- Toda emisión AR: `CreditInvoices`, `CashInvoices`, `CashReturns`, `CustomerCreditNotes/DebitNotes`, `Promotions`, `Quotes`, `SalesOrders`, recurrentes.
- **e-CF completo**: `ElectronicInvoicingTransactions/*` (`ElectronicSign` y `RemoveSign` son el riesgo máximo del inventario: firman/desfirman ante DGII).
- `CustomReports/Execute` y `ExecuteScalar` (query arbitrario).
- `BankFileImport/SaveBankFeeds` (inyecta movimientos bancarios).
- Maestros y configuración: `Accounts`, `AccountingPeriods`, `FiscalSequences`, `Items`, `Vendors`, `Customers`, `PaymentMethods`, `Currencies`, `Subsidiaries`, custom fields, etc. (crear artículos/proveedores siempre pedirá OK; mientras el rol lo niegue, lo crea un humano en la UI — ver §3.5).
- Módulos enteros: PR (nómina nativa), HR, IC (incluye `InventoryAdjustments`), MF, WS, CRM, FA, `Deposits`, `BankReconciliations`, pagos (`BillPayments`, `AccountPayments`), prepagos, notas de débito/crédito de proveedor.

### 1.2 Pasos que hace Carlos en la pantalla de ADM (el agente no puede crear usuarios)

Para qué sirve: separa la identidad del agente de la tuya y convierte el recorte en un límite del servidor, no del prompt.

1. En ADM: Configuración → Roles → duplicar `Contabilidad` como `QualiaConta-Registro`.
2. Ajustar la matriz según §1.1 (Registrar sí en las 4 pantallas + Storage; Modificar/Anular/Eliminar en NO en todo; módulos negados en NO).
3. Crear usuario nuevo (p.ej. `qualia.registro@blackbox…`) con ÚNICAMENTE ese rol. Password fuerte; va solo al `.env` del contenedor de Hermes (vars `ADMCLOUD_*`), nunca a git ni a logs.
4. Anotar el nombre EXACTO del rol como ADM lo escribe (el env actual usa `contabilidad` en minúsculas; el `role` viaja como query param en cada llamada) y actualizar `ADMCLOUD_ROLE`.
5. Avisar para correr la verificación de abajo antes de cualquier escritura.

### 1.3 Verificación empírica del recorte (el SPEC la exige y no consta hecha)

El nombre del rol no basta; se verifica sin mutar nada:

1. **GETs de visibilidad**: recorrer con el usuario nuevo los listados concedidos (deben responder 200 con `skip=0` — recordar la trampa: `skip` es requerido, `take` se ignora) y los negados (se espera 401/403).
2. **Sondas negativas con GUID inexistente** (no pueden mutar nada porque el documento no existe; la señal está en el código de error):
   - `POST /api/Journals/Void`, `DELETE /api/Journals/{guid-aleatorio}`, ídem en `VendorBills`, `CreditInvoices`, `ElectronicSign`, `CustomReports/Execute`, `SaveBankFeeds`.
   - **403/401 = el rol lo niega (correcto). 404 / "Este documento no existe" = el rol lo permitiría (mal): parar y arreglar el rol.** Calibrar primero el shape del 404 con un GET a un GUID inexistente en un recurso permitido.
3. **Test de escalación del query param**: repetir una sonda negada enviando `role=Administradores` con las credenciales del usuario recortado. Si el servidor obedece el param en vez del rol del usuario, el "límite duro" es ficción → escalar con soporte de ADM antes de seguir; mientras tanto no hay encendido.
4. Registrar el resultado como la **primera entrada del libro de acción** (`Aprobó: Carlos`, `Alcance: credenciales y rol vigentes; re-verificar si cambia el rol o el usuario`).

Precaución transversal: la API refleja la URI completa (incluido el GUID de company) dentro de los errores JSON — sanitizar todo error antes de escribirlo en `qualia_eventos` o logs.

**Pre-requisito operativo adicional**: resolver el bloqueo "mesa sin terminal" observado el 2026-08-02 (`-t TOOLSETS` / `--accept-hooks` en las sesiones one-shot). Sin terminal no hay `curl`, y sin `curl` no hay escritura verificable.

---

## 2. Spike: primera escritura supervisada (Gate 0)

**Operación elegida: un asiento de diario mínimo (`POST /api/Journals`).** Es la escritura más chica y reversible del inventario: no genera NCF, no toca terceros ni bancos ni inventario, no entra al 606/607, y tiene `Void` nativo. Además Journals es el recurso mejor cartografiado (detalle con `Accounts[]`, campo `Void` en el header, `Reference` como portador de semántica, `Files[]` para adjuntos).

**Diseño del asiento de prueba** (con Carlos mirando en vivo, sesión interactiva de Hermes, no cron):
- Fecha: hoy, en período contable abierto (verificar contra `AccountingPeriods`).
- Dos líneas de RD$1.00 **contra el mismo par de cuentas de gasto** (débito y crédito se cancelan: efecto neto cero en balances incluso antes de anular). Cuentas elegidas con Carlos; prohibido usar cuentas de nómina (611.x, 210.04–210.10, 220.x).
- `Reference`: `QC-SPIKE-001 PRUEBA ESCRITURA QUALIACONTA — ANULAR`.
- Flujo completo del protocolo de escritura (§4): evento `escritura_iniciada` → POST → **readback** `GET /api/Journals/{ID}` → evento `registrada` con `adm_ref`.

**Verificación en la UI de ADM**: Contabilidad → Entradas de Diario → aparece el nuevo `ED########` correlativo (el último conocido era ED00000181); abrirlo y confirmar líneas, montos y Reference.

**Reversa — documentar el mecanismo real de ADM**: la reversa canónica es la **anulación (Void)**: el documento se conserva con marca `Void=true`, sale de los balances y su número ED no se reutiliza — es un tombstone auditable, no un borrado. `DELETE` existe en la API pero destruye el rastro: queda prohibido y negado por rol. Las notas de crédito son reversa de documentos emitidos a terceros, no aplican aquí. Como el rol del agente NO tiene Void (§1.1), **la anulación la ejecuta Carlos en la UI** y el agente la verifica por API (`GET` → `Void=true`).

**Gate 0 — no se avanza sin marcar todo esto:**
- [ ] Sondas del §1.3 en verde (incluido el test de escalación del query param).
- [ ] Asiento creado por API, visible en UI, readback OK.
- [ ] Asiento anulado por humano en UI; `Void=true` confirmado por API; balances sin efecto.
- [ ] Entrada del libro de acción con el runbook de reversa escrito (`Aprobó:` Carlos, `Alcance:` toda escritura futura de QualiaConta).
- [ ] El flujo de la mesa (§4) registró los eventos correctamente.

---

## 3. Graduación por tipo de operación

### 3.1 Orden y por qué

1. **Compras con factura de proveedor** (`VendorBills`) — el volumen mayor (1,050 históricas) y el patrón más repetitivo; mejor terreno para acumular precedentes.
2. **Gastos** — mismos `VendorBills` para servicios + `BankCharges` para cargos bancarios (el módulo Expenses de GL no se usa en Blackbox: no inventar un flujo que la empresa no tiene).
3. **Traspasos entre cuentas** (`BankBankTransfers`) — mecánicos pero tocan dos saldos bancarios y la conciliación.
4. **Asientos de diario, incluida la nómina desde Excel** (`Journals`) — máxima expresividad, máximo riesgo; al final.

### 3.2 Ciclo de cada tipo (idéntico para los cuatro)

- **Fase A — Destilación (una sola vez, por SPEC)**: batch one-shot de Hermes (con `--usage-file` y midiendo con `hermes prompt-size`) que lee el histórico del tipo y produce reglas escritas en `memoria/` del repo: mapa proveedor→cuenta contable, patrones de `BankCharges`, pares de cuentas de los 203 traspasos, y la plantilla de nómina (patrón mensual de 3 asientos: `NOMINA <MES> <AÑO>`, `REG. TSS EMPLEADOR YYYYMM`, `REG.INFOTEP EMPLEADOR YYYYMM`, con las cuentas exactas 611.x / 210.04 / 210.08 / 210.09 / 210.10 / 220.01 ya observadas en ED00000177/ED00000180). El histórico no se relee en cada corrida.
- **Fase B — Propuesta pura**: todo registro del tipo pasa por la mesa como `propuesta` y un humano aprueba cada uno. El agente escribe en ADM solo tras `aprobada`.
- **Fase C — Autonomía por precedente**: el agente registra sin OK únicamente los casos que matchean un precedente del libro de acción con `Aprobó:` y cuyo `Alcance:` los cubre. Todo lo demás sigue siendo propuesta. Un criterio sin Aprobó humano NO es precedente.

### 3.3 Criterio de graduación B→C (defaults propuestos; Carlos ajusta los números)

Por tipo, TODAS estas condiciones:
- ≥ 15 registros consecutivos aprobados **sin corrección** (corrección = cualquier Void o edición posterior de un documento del agente), y
- ≥ 14 días naturales operando en fase B, y
- precedentes escritos que cubren ≥ 80% del volumen del tipo, y
- el monitoreo diario (§5) corriendo en verde ≥ 7 días.

**Regresión automática**: 2 correcciones en 7 días → el tipo vuelve a fase B y se re-gradúa desde cero. Un incidente grave (documento fantasma, doble registro, cuenta de nómina tocada de forma autónoma) → **kill-switch global** (§5) y revisión.

### 3.4 Guardas permanentes (no se gradúan nunca)

- **Nómina SIEMPRE con OK humano**: los 3 asientos mensuales se generan desde el Excel como propuesta con preview línea a línea + Excel adjunto vía Storage, y jamás se auto-registran. Candado doble: (a) regla de flujo — cualquier `Journal` que toque 611.x, 210.04–210.10, 220.01/220.02 o cuyo Reference matchee `nomina|tss|infotep|sueldo` es no-autonomizable; (b) el monitoreo alerta cualquier asiento autónomo que toque esas cuentas. Honestidad del diseño: el rol de ADM no discrimina por cuenta, así que este candado es de flujo + monitoreo, no de servidor.
- **Monto máximo de auto-registro**: RD$25,000 por documento (default; Carlos fija el número). Igual o superior → propuesta siempre.
- **Tope diario**: máx 20 escrituras autónomas/día; superado → el resto del día todo en propuesta + alerta.
- **Crear maestros (artículos, proveedores, cuentas) siempre pide OK**: mientras el rol lo niegue, lo crea el humano en la UI y el agente lo espera en `esperando_respuesta`; si más adelante se concede `Vendors`/`Items` POST, será solo con OK explícito por pieza en la mesa, jamás autónomo.
- **Anular/editar jamás autónomo**: el rol no lo permite y el flujo tampoco lo pide.
- ~~**Sin backdating fiscal**: nada con fecha de un mes anterior después del día 5 del mes siguiente (el 606 de ese mes ya está en manos de la contable externa); períodos cerrados nunca.~~
  **Retirada 2026-08-20 por decisión de Carlos**, el mismo día que entró en
  vigor: la mesa existe justamente para subir papeles de meses anteriores, y la
  regla frenaba ese flujo (primer caso: factura Tupaq E310000002191 del 31/07).
  Queda como freno de fechas SOLO fecha ilegible y fecha futura; la protección
  contra descuadrar lo declarado es el período cerrado en ADM, que sigue en pie
  y sin waiver. Además, desde esa fecha todo freno o error del registrador se
  escribe en `error_detalle` de la fila y la mesa lo muestra — un freno mudo
  parecía atraso.
- **Emitir, firmar e-CF y declarar: jamás** (rol + flujo + monitoreo).

### 3.5 Detalle por tipo

- **Compras/gastos (`VendorBills`)**: precedente por proveedor (RNC + cuenta + tipo NCF esperado). Validar formato NCF y RNC contra el maestro antes de escribir: estos documentos alimentan el 606 que declara la contable externa — es el tipo con la fase B más larga. Proveedor inexistente → nunca crearlo solo (§3.4). Ojo hallazgo: los DocID de VendorBills son mixtos (FP##### + importados tipo `PI20240921`) — no usar DocID para inferir nada; el identificador es el UUID.
- **`BankCharges`**: precedentes por patrón (banco + concepto). Suelen ser el primer tipo en graduarse.
- **`BankBankTransfers`**: precedente = par (cuenta origen, cuenta destino) ya visto en el histórico; par nuevo → propuesta. Recordar el shape especial del recurso (`data={Item1:[página], Item2:total}`). El cruce contra los movimientos reales de openbanking (dos patas) es la verificación natural.
- **`Journals` no-nómina**: solo con plantilla precedente exacta (mismas cuentas, misma estructura); asiento libre → propuesta siempre.

---

## 4. Cambios mínimos en la mesa web / skill para el estado `registrada`

Hoy `registrada` es un estado sin evidencia. Cambios mínimos:

1. **`qualia_trabajos`**: columna `adm_ref jsonb` — `{recurso, uuid, doc_id, monto, fecha_doc, reference}` (ej. `{"recurso":"Journals","uuid":"dcfa…","doc_id":"ED00000182",…}`). Constraint de flujo: **prohibido transicionar a `registrada` con `adm_ref` nulo**.
2. **`qualia_eventos`**: tres tipos nuevos — `escritura_iniciada` (intención + hash del payload, ANTES del POST), `registrada` (tras readback OK, con `adm_ref`), `registro_fallido` (error sanitizado). Si el proceso muere entre POST y readback, el evento pre-write permite detectar el huérfano; **nunca reintentar un POST sin antes buscar el documento en ADM**.
3. **Convención de idempotencia/rastro**: todo documento creado por el agente lleva `Reference = "QC-<trabajo_id>"`. ADM no tiene idempotency keys; este campo es el enlace auditable en ambos sentidos y la llave del cron de huérfanos (§5).
4. **Skill `mesa-de-trabajo` — protocolo de escritura** (extiende el protocolo duro existente): solo desde estado `aprobada` (o fase C con cita del precedente: path del archivo del libro en el evento); secuencia fija evento pre-write → POST → readback `GET /{Recurso}/{ID}` → evento `registrada`; readback fallido → `registro_fallido` y el trabajo queda en `aprobada` con alerta (opcional: estado `error_registro` si se prefiere visible en el tablero — único cambio a la máquina de estados).
5. **UI web**: en el trabajo registrado, chip con `doc_id` + `recurso` y UUID copiable (la UI legacy de ADM es WebForms, sin deep-link confiable: auditar = buscar el DocID en la pantalla del recurso o `GET` por UUID). Filtro "registradas hoy".
6. **Kill-switch global**: flag `modo_propuesta_global` (config de la mesa) que degrada TODO a fase B con un solo cambio. Debe existir antes de la primera autonomía.

---

## 5. Monitoreo y rollback

### 5.1 Detección de un registro malo

- **Cron diario de cuadre 1:1** (patrón `--no-agent` ya probado con `sugerir-cargos`: script puro, cero tokens): lista los documentos del día en los 4 recursos (DateFrom/DateTo; recordar `skip` requerido y página fija de 50) y cruza contra `qualia_trabajos`:
  - documento en ADM con `Reference QC-*` (o creado por el usuario API) sin trabajo `registrada` → **huérfano**, alerta;
  - trabajo `registrada` sin documento en ADM → **fantasma**, alerta;
  - suma de montos registrados ≠ suma de montos aprobados del día → alerta.
  - alerta adicional: cualquier Journal autónomo tocando cuentas de nómina (§3.4).
  - Entrega por Telegram (canal ya operativo en los cron de Hermes).
- **Conciliación bancaria**: reutilizar/extender `conciliar-entradas.py` al lado de egresos — todo `BankCharge`/`BankBankTransfer`/pago registrado debe tener su movimiento espejo en `openbanking_transactions`.
- **Revisión humana muestral**: semanal, Carlos o la contable externa revisan una muestra de los auto-registros (foco en clasificación de cuenta, el error que la máquina no se detecta sola).

### 5.2 Runbook de reversa (un registro malo confirmado)

1. **Congelar**: activar `modo_propuesta_global` (todo vuelve a propuesta; no se investiga con el grifo abierto).
2. **Identificar**: `adm_ref` del trabajo → `GET` del documento; confirmar con Carlos qué está mal.
3. **Revertir (humano, en la UI de ADM)**. ⚠️ **CORRECCIÓN medida el 2026-08-02**: este paso decía que la reversa dejaba el documento con `Void=true`, fuera de balances y con el rastro intacto. **Es falso.** Se revirtió el asiento del Gate 0 (`ED00000182`) y el documento **desapareció**: `GET` por su UUID devuelve `data:null` y no figura en el listado. No hay lápida que auditar y el número puede reutilizarse.
   Consecuencias que hay que tener presentes al revertir: si el documento ya está conciliado (`Conciliated` en las líneas) o el mes ya fue remitido a la contable externa (606/607), coordinar con ella ANTES — y con más razón ahora, porque después del borrado no queda evidencia de qué se fue.
   **Antes de tocar nada, guardar el documento completo**: `GET` del documento y volcar la respuesta al libro de acción. Es la única copia que va a existir.
4. **Verificar** que ya no está (`GET` por UUID → `data:null`, y ausencia en el listado del período) y re-registrar corregido como documento nuevo vía nueva propuesta en la mesa.
   La reversa es siempre humana — pero **por decisión, no por permiso**. La afirmación «su rol niega `DELETE` y `Journals/Void` (verificado 2026-08-02)» quedó **desactualizada**: re-sondeado el 2026-08-14, `VendorBills/Void`, `BankCharges/Void` y `Journals/Void` responden «Este documento no existe», o sea que el permiso pasa. Sólo `BillPayments/Void` y `AccountPayments/Void` siguen dando `Unauthorized`.

   **Y la causa es más de fondo que un permiso suelto: el rol recortado de §1.1 nunca se creó.** `ADMCLOUD_ROLE` y `ADMCLOUD_REG_ROLE` apuntan los DOS al mismo rol, `Contabilidad Digital` — no existe ningún `QualiaConta-Registro`. Así que el «límite duro del servidor» que este plan da por puesto hoy no está, y lo único que sostiene la regla es la instrucción escrita. Eso contradice de frente la regla 5 del CLAUDE.md («los límites viven en los permisos de ADM Cloud, no en el prompt»). Cerrarlo pide a Carlos en la pantalla de roles; hasta entonces, la prohibición de anular es de doctrina y se declara como tal.
5. **Aprender**: entrada del libro de acción con causa, regla corregida, `Aprobó:` y `Alcance:`; actualizar `memoria/` si el precedente estaba mal escrito.
6. **Regresar la graduación** del tipo afectado según §3.3 y, revisado todo, desactivar el kill-switch.

---

## 6. Riesgos y mitigaciones

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | El rol no recorta de verdad, o el servidor obedece el query param `role` (escalación trivial) | Sondas negativas con GUID inexistente + test explícito con `role=Administradores` (§1.3); sin verde no hay Gate 0. Re-verificar ante cualquier cambio de rol/usuario. |
| 2 | Doble registro por retry/crash (z.AI muere entre POST y readback; el 429-1113 "Insufficient balance" se disfraza de rate-limit) | Evento `escritura_iniciada` pre-POST + `Reference QC-<id>` + regla "nunca re-POST sin buscar huérfanos" + cron de cuadre 1:1. Verificar el endpoint coding de z.AI con un chat de `max_tokens:16` antes de cada batch. |
| 3 | Escritura técnicamente correcta pero mal clasificada (cuenta/NCF/RNC equivocados) — el error más probable y el que contamina el 606 de la contable externa | Precedentes de alcance estrecho, validación NCF/RNC pre-write, fase B larga en VendorBills, cap de monto, conciliación diaria y revisión muestral humana. |
| 4 | Asiento de nómina auto-registrado por un precedente demasiado amplio | Candado no-autonomizable por cuentas y por patrón de Reference + alerta específica del cron; la nómina jamás sale de fase B. |
| 5 | DELETE/e-CF/`CustomReports/Execute`/`SaveBankFeeds` accesibles por error de configuración | Negados por rol y cubiertos por sondas del §1.3; los 16 swagger son públicos sin auth (exposición conocida) → las credenciales del usuario API son el único gate real: viven solo en el env del contenedor, rotación si hay sospecha, y reportar la exposición a ADM. |
| 6 | Fugas en logs (la API refleja la URI con el GUID de company en los errores) | Sanitizador obligatorio antes de persistir errores en `qualia_eventos`/logs; prohibido volcar respuestas crudas. |
| 7 | Escritura en período cerrado o backdating que descuadra lo ya declarado | Validación de `AccountingPeriods` abierto pre-write + regla del día 5 (§3.4); cualquier Void posterior al corte se coordina con la contable externa. |
| 8 | Anulación de un traspaso ya conciliado rompe la conciliación bancaria | Chequear `Conciliated` antes de anular (paso 3 del runbook). |
| 9 | La mesa se bloquea sin terminal a mitad de escritura (fallo ya observado 2026-08-02) | Pre-requisito §1: resolver toolsets/hooks antes del spike; el protocolo pre-write/readback deja el estado recuperable si igual ocurre. |
| 10 | Deriva de la API (shapes, paginación, totales) rompe el cuadre silenciosamente | El cron de cuadre falla ruidoso (alerta si un listado cambia de shape); trampas conocidas documentadas en `memoria/` (skip requerido, take ignorado, tupla de BankBankTransfers, Sales/Detailed no paginable). |

**Secuencia resumida**: §1 (rol + verificación empírica + terminal de la mesa) → §2 Gate 0 (escritura+reversa verificadas) → §3 por tipo: destilar una vez → propuesta → autonomía por precedente, con las guardas permanentes y el monitoreo de §5 corriendo desde el primer documento real.