# Plan de preentrenamiento total — QualiaConta (Blackbox)

**Objetivo:** que el contable lea TODO (ADM Cloud completo, banco openbanking, núcleo DGII) y lo destile UNA vez a memoria curada en git, sin una sola escritura en ADM Cloud. Los criterios destilados solo se vuelven precedente tras ratificación humana con nombre (SPEC).

**Invariante dura de todo el plan:** cero POST/PUT/DELETE contra `api.admcloud.net`. Toda la extracción va por el wrapper GET-only (`scripts/admcloud-get.sh` de la skill `consultar-admcloud`). Explícitamente prohibido `POST /api/CustomReports/Execute` aunque "solo lea": es un POST y ejecuta query arbitrario. La verificación empírica del rol `contabilidad` (que no pueda anular/emitir/firmar) queda **fuera de este plan** porque exige intentar una escritura; se difiere a la puesta en marcha de Entrega 2 y se anota como requisito bloqueante de esa entrega.

---

## 0. Fase 0 — Preflight (medio día, sin LLM salvo 2 pings)

Antes de gastar un token en lotes, resolver los 4 bloqueos operativos detectados:

1. **Endpoint z.AI verificado**: un `chat/completions` con `max_tokens: 16` contra el provider builtin `zai` del config actual. Si devuelve 429 code 1113 ("Insufficient balance" disfrazado de rate-limit), reconfigurar a `provider: custom` + `base_url` del endpoint coding (`https://api.z.ai/api/coding/paas/v4`) como documenta `docs/modelo-zai.md`, y registrar el resultado en ese doc.
2. **Toolset terminal en sesiones one-shot**: las sesiones mesa del 2026-08-02 murieron por "bloqueada sin terminal". Correr un `hermes -z "pwd && date" -t <toolsets> --accept-hooks` de prueba y fijar la combinación exacta de `-t`/`--accept-hooks` que da terminal sin TTY. Sin esto, ningún batch puede correr `psql`/`curl`.
3. **Piloto de cron agente**: un `hermes cron create` con `--script` trivial (stdout = "di hola con este contexto: X"), `--repeat 1`, para validar la inyección de stdout al prompt y la entrega, porque el modo agente del cron nunca se estrenó.
4. **Limpieza de fallbacks**: dejar `fallback_providers` en una cadena corta y sin duplicados (glm-5-turbo → glm-4.7), quitando la entrada glm-5.2 repetida — un batch largo con fallbacks ruidosos multiplica reintentos en cadena.
5. **Medir contexto real**: no está documentada la ventana de glm-5.2 ni la cuota del Coding Plan. Calibrar empíricamente: `hermes prompt-size` sobre un lote candidato + una corrida con `--usage-file` y un prompt de ~40k tokens. Registrar techo observado en `docs/modelo-zai.md`. Hasta medir, presupuesto conservador por turno: **≤ 35k tokens de input, ≤ 5k de output**.

---

## 1. Pipeline de lectura total

Arquitectura en 3 capas: **extracción determinista (0 tokens) → agregación determinista (0 tokens) → destilación GLM sobre agregados compactos**. El LLM nunca ve datos crudos masivos; ve resúmenes que un script ya condensó. Esto es lo que hace viable "leer absolutamente todo" con un Coding Plan.

### 1.1 Capa A — Extracción a disco (scripts, sin LLM)

Un script `memoria/scripts/extraer-adm.py` (nuevo, hermano de `conciliar-entradas.py`, mismas env `ADMCLOUD_*`) que vuelca a `/opt/data/preentrenamiento/raw/*.jsonl`, un archivo por recurso, con cursor de fecha para el delta futuro. Reglas de paginación aprendidas (no negociables, ya verificadas por el explorador):

- `skip` SIEMPRE presente; avanzar de 50 en 50; cortar en página vacía. `take` se ignora (excepto `/api/AR`).
- `Sales/Detailed`: UNA sola llamada (ignora skip y take, devuelve los 1507); guardar el payload completo tal cual.
- `BankBankTransfers`: shape tupla `{Item1: [página], Item2: total}` — parsear especial.
- Throttle ~1 req/s; reintento con backoff solo ante 5xx; nunca reintentar en loop un 4xx.
- No loggear cuerpos de error crudos (la API refleja el GUID de company en los mensajes).

Qué se baja (volúmenes reales del explorador):

| Recurso | Listado | Detalle por doc |
|---|---|---|
| Accounts (plan de cuentas) | 215 | no hace falta |
| Vendors | 169 | sí (maestro corto) |
| VendorBills | 1050 | **sí** (líneas contables = corazón del preentrenamiento) |
| Journals | 186 | **sí** (Accounts[] + Files[]) |
| BillPayments / AccountPayments | 739 / 320 | sí (vínculo pago→doc, cuenta de banco usada) |
| BankCharges / BankBankTransfers / Deposits | 159 / 203 / 2 | sí |
| CashInvoices / CashReceipts / CreditInvoices | 299 / 712 / 1201 | solo headers + muestra de 50 detalles (ventas no será autónomo) |
| Sales/Detailed | 1507 en 1 llamada | n/a |
| Customers / Employee / PaymentMethods / ExpenseTypes / AccountingPeriods / BankReconciliations | maestros y satélites completos | headers |
| Satélites AP (VendorCreditNotes 4, Prepayments 8, Receptions 10, CreditApplications 6) | completos con detalle | sí (son pocos) |

Total ≈ **3.000–3.500 requests GET ≈ 60–90 min de reloj**. Banco: `pg_dump --data-only` lógico de `openbanking_accounts` + `openbanking_transactions` vía `psql "$OPENBANKING_DSN"` a CSV en `raw/`. Núcleo DGII ya está montado read-only (`/nucleo-contable/dgii`), no se copia: se referencia.

### 1.2 Capa B — Agregación determinista (scripts, sin LLM)

`memoria/scripts/agregar-preentrenamiento.py` produce `/opt/data/preentrenamiento/agg/`:

- `vendors-agg.jsonl` — una línea por proveedor: RNC, n facturas, rango de fechas, total, moneda, **distribución de cuentas contables usadas en sus líneas (código + nombre + frecuencia + % del monto)**, tratamiento ITBIS/retenciones observado, tipos NCF, vía de pago típica (PP vs PC, cuenta banco), plazo medio de pago, docs importados (PI*) vs nativos (FP*).
- `journals-agg.json` — asientos agrupados por patrón de `Reference` (regex nomina|tss|infotep|sueldo ya validada: 60/186), con el asiento tipo por patrón (líneas debe/haber con cuentas y montos de un ejemplar real) y la lista de asientos "sin patrón" para revisión.
- `bancos-agg.json` — cargos bancarios por concepto/cuenta, traspasos por par de cuentas, y el cruce banco↔ADM reutilizando la lógica ya probada de `conciliar-entradas.py` (tarjetas 5.395%, cuenta de Impact excluida, 8 rondas).
- `plan-cuentas.json` — las 215 cuentas con jerarquía, tipo, flags (IsCashAccount, RequireX), y **uso real** (n líneas que la tocan en todo el histórico, para separar cuentas vivas de muertas).
- `ventas-agg.json` — solo estadística de forma (tipos NCF, secuencias, volúmenes por mes): ventas se destila como contexto, no como dominio autónomo.

Cada agregado por proveedor pesa ~300–600 tokens. Este es el material que ve el GLM.

### 1.3 Capa C — Destilación GLM (turnos por lote)

Mecanismo Hermes: **`hermes cron create` en modo agente con `--script` + `--repeat N`** — el script emite por stdout el siguiente lote pendiente (lee un cursor en `/opt/data/preentrenamiento/estado.json`, imprime los agregados del lote + la plantilla de salida + el plan de cuentas condensado) y ese stdout se inyecta al prompt. `--model glm-5.2` para destilación (criterio de juicio), `--usage-file /opt/data/preentrenamiento/usage.jsonl` para contabilidad, `--skills consultar-admcloud` por si el turno necesita verificar un dato puntual, `-t` con el toolset terminal validado en Fase 0. Ejecuciones durables quedan en `cron/executions.db` (auditar con `hermes cron runs`).

Para los documentos únicos y grandes (plan de cuentas anotado, síntesis de nómina) se usa **`hermes -z "PROMPT" --accept-hooks`** one-shot, más controlable que el cron para 1–2 turnos.

Tamaño de lote (bajo el presupuesto de 35k input/turno hasta medir el contexto real):

- Proveedores: 12–15 por turno (agregado + plan de cuentas condensado ~8k) → **12–15 turnos**.
- Asientos: por patrón, no por asiento → **4–6 turnos** (nómina 1, resto agrupado).
- Banco/pagos: **3–4 turnos**. Ventas (contexto): **2–3 turnos**. Plan de cuentas anotado: **1–2 turnos**. Consolidación de las 4 memorias fragmentadas (MEMORY.md, USER.md, artefactos sueltos, configuracion_conciliacion_entradas.md): **2–3 turnos**.

Regla anti-alucinación en cada prompt de destilación: *"solo podés citar códigos de cuenta que aparecen en el bloque PLAN DE CUENTAS de este prompt; toda regla lleva evidencia: n docs y 1–2 DocIDs de ejemplo"*. Lo mecánico posterior (reformatear, dividir archivos) baja a `--model glm-5-turbo`.

---

## 2. Artefactos de salida

Destino canónico: **`memoria/` del repo QualiaConta** (git = memoria curada del SPEC). Todo archivo nace con un front-matter de estado:

```
estado: borrador | ratificado
aprobo: (vacío hasta ratificación)
evidencia: extracción 2026-08-0X, corte <fecha>
```

| Archivo | Contenido y estructura |
|---|---|
| `memoria/plan-de-cuentas.md` | Las 215 cuentas en jerarquía; por cuenta: código, nombre, tipo, para-qué en llano, uso real (n movimientos histórico), flags de requeridos (depto/proyecto), y marca "no usar" en cuentas muertas o de cierre. Fuente de verdad para el linter anti-alucinación. |
| `memoria/proveedores.md` | Una sección por proveedor con actividad (≥2 docs; los de 1 doc van a una tabla residual): RNC, cuenta(s) de gasto típica(s) con % histórico, ITBIS/retención observados, NCF típico, vía de pago (PP/PC + cuenta banco), plazo, y "tratamiento típico" en 1–3 líneas con DocIDs de evidencia. Los ambiguos (dos cuentas al ~50%) quedan marcados `AMBIGUO — preguntar` (nunca autónomo). |
| `memoria/criterios.md` | Criterios transversales numerados (C-001…): clasificación de cargos bancarios, tarjetas al 5.395%, cuenta Impact excluida, importados PI* vs nativos FP*, qué es entrada real (CashInvoices+CashReceipts+Transfers, CreditInvoices NO), etc. Cada criterio: enunciado, evidencia, alcance propuesto. Absorbe y jubila lo que hoy vive en `memories/MEMORY.md`. |
| `memoria/nomina.md` | El patrón mensual de 3 asientos (NOMINA / REG. TSS EMPLEADOR / REG.INFOTEP) con el **asiento tipo completo** (estructura de cuentas 611.x / 210.x / 220.01, sin montos por empleado), el mapeo al plan de cuentas, y la nota de que el módulo PR nativo está vacío por diseño — nómina = Journals + pago probable por PC (marcar "no verificado línea a línea"). |
| `memoria/banco.md` | Mapa de cuentas bancarias ADM↔openbanking, patrones de cargos (CB*) por concepto, traspasos típicos entre cuentas, reglas de conciliación consolidadas desde `configuracion_conciliacion_entradas.md`. |
| `memoria/ventas.md` | Solo contexto: tipos de comprobante, volúmenes, quién factura (la empresa, jamás QualiaConta), qué NO tocará nunca el agente. Corto por diseño. |
| `memoria/api-admcloud.md` | Los quirks operativos (skip requerido, take ignorado, Sales/Detailed completo, shape tupla de transfers, GUID en errores) migrados desde `memories/MEMORY.md` — conocimiento de herramienta, no requiere ratificación contable. |
| `memoria/INDEX.md` | Índice + convención: qué archivo consultar para qué, y la regla "estado: borrador ⇒ NO es precedente". |

`liquidaciones.md` **no aplica todavía**: no hay corpus de liquidaciones montado en el contenedor (gap confirmado). Se deja stub en INDEX.md apuntando a Entrega 5; si Carlos sube el histórico al bucket `qualia-conta`, se destila en una fase incremental idéntica a esta.

Además: commitear al repo las 2 skills generadas (`analizar-cxc-adm`, `conciliar-banco-adm`) que hoy viven solo en el volumen, y los 2 scripts nuevos de extracción/agregación bajo `memoria/scripts/`.

**Antes del volumen, sembrar el formato**: 2–3 entradas ejemplo escritas a mano (1 proveedor, 1 criterio, 1 entrada de libro) que fijan la plantilla que los lotes GLM deben imitar. Barato y evita reformatear 200 secciones después.

## 3. Loop de ratificación (SPEC-compliant)

**Forma elegida: trabajos tipo `criterio` en la mesa web, agrupados por bloque temático, con Aprobar/Rechazar por bloque.** Justificación en una línea: reutiliza el pipeline de aprobación ya operativo (qualia_trabajos con estados y UI) sin construir nada nuevo, y la aprobación queda registrada con persona real y timestamp de forma nativa.

Mecánica:

1. Al terminar cada fase de destilación, un script (sin LLM) trocea los borradores en **8–12 trabajos** tipo `criterio` — no 200 individuales: "Proveedores A–F (28 reglas)", "Criterios banco (9)", "Nómina (asiento tipo + 4 reglas)"… Cada trabajo lista sus reglas con evidencia y el **Alcance propuesto** por regla.
2. Carlos en la mesa: **Aprobar** el bloque entero, o **Rechazar con comentario** (el comentario dice qué reglas caen o se corrigen; el bloque vuelve como trabajo nuevo corregido). Esfuerzo estimado: 60–90 min total en 2–3 sentadas.
3. Al aprobar, la mesa dispara la escritura del libro (vía skill `escribir-libro-de-accion`): **una entrada de libro por criterio** contenido en el bloque, cada una con `Aprobo: Carlos Araujo`, `Alcance:` (el texto propuesto, editable en el comentario de aprobación) y fecha — un archivo `AAAA-MM-DD-<criterio>.md`, nunca edición (append-only). Simultáneamente el archivo de memoria pasa a `estado: ratificado` y se commitea.
4. Regla dura implementada en la skill mesa: un criterio con `estado: borrador` **no se cita como precedente** en ninguna respuesta ni sugerencia; si el único sustento es un borrador, la respuesta lo dice.

## 4. Orden, duración y costo

| Fase | Qué | Reloj | Tokens GLM |
|---|---|---|---|
| F0 | Preflight (§0) | 0.5 día | ~1k (pings) |
| F1 | Extracción a disco (Capa A) | 1.5–2 h desatendida | 0 |
| F2 | Agregación determinista (Capa B) | 1–2 h de script | 0 |
| F3 | Sembrar formato (3 ejemplos a mano) | 1 h | 0 |
| F4 | Destilación GLM (~25–35 turnos vía cron `--script --repeat`) | 1–2 días desatendida | input 0.8–1.4M, output 80–150k |
| F5 | Ratificación en mesa (2 rondas) | 1–2 h de Carlos, 1–2 días calendario | ~50–100k (correcciones de rechazos) |
| F6 | Verificación de calidad (§5) | 0.5 día | ~100–200k (si el muestreo usa GLM) |
| F7 | Consolidación: commit a git, jubilar memorias fragmentadas, borrar `raw/` sensible | 0.5 día | ~20k |

**Total: ~4–6 días calendario; ~1.0–1.8M tokens de input y 150–300k de output.** El costo monetario es la suscripción Coding Plan (no por token); el riesgo real es la **cuota** no documentada del plan — por eso `--usage-file` en todo turno y un check del script inyector que aborta la cadena si el consumo acumulado del día supera un tope configurado (empezar en ~500k/día y ajustar con lo medido en F0).

## 5. Verificación de calidad

**Muestreo contra ADM real (post-ratificación):** un script toma 40 documentos al azar estratificados (20 VendorBills, 8 Journals, 6 BankCharges, 6 pagos) **excluidos de la evidencia citada**, y para cada uno deriva de la memoria ratificada la predicción (cuenta de gasto, tratamiento ITBIS, vía de pago) y la compara contra las líneas reales del documento en ADM. La derivación de la predicción es determinista donde se pueda (lookup en proveedores.md) y con un turno GLM barato (glm-5-turbo) donde requiera juicio.

**Criterio medible de "preentrenamiento terminado":**

1. Predicción de cuenta principal correcta en **≥ 90%** de la muestra, y los proveedores con regla ratificada cubren **≥ 80% del volumen** histórico de VendorBills (los ambiguos cuentan como acierto si están marcados `AMBIGUO — preguntar`).
2. **100%** de los criterios en memoria con `estado: ratificado` tienen su entrada de libro con `Aprobo:` y `Alcance:`; cero criterios huérfanos.
3. Linter verde: **cero** códigos de cuenta citados en `memoria/` que no existan en el dump de Accounts.
4. Las 4 memorias fragmentadas consolidadas: `memories/MEMORY.md` reducido a puntero, skills generadas y scripts commiteados, artefactos sueltos archivados o destilados.
5. Todo `memoria/` + `libro-de-accion/` commiteado y pusheado.

Si (1) falla, los proveedores errados vuelven como trabajos `criterio` corregidos — no se re-lee el histórico completo (SPEC: se destila una vez; se corrige por excepción).

## 6. Mantenimiento incremental (delta mensual)

- **Cron `--no-agent` mensual** (patrón ya en producción con `sugerir-cargos`): `extraer-adm.py --desde <cursor>` baja solo docs nuevos (DateFrom donde el endpoint lo soporte; si no, paginar desde skip=0 cortando en el primer DocID ya visto), re-agrega, y hace diff contra la memoria: proveedor nuevo, proveedor conocido con cuenta atípica, patrón de asiento nuevo. Costo: 0 tokens.
- Si el diff trae novedades: **un solo turno agente** (cron `--script`, glm-5.2) redacta los criterios candidatos → entran a la mesa como trabajo `criterio` → mismo loop de ratificación. Sin novedades, no hay turno.
- Costo estimado: **0–40k tokens/mes** y ~5 min de Carlos. El cursor vive en `estado.json` junto a la memoria; nunca se relee el histórico completo.

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Contexto GLM desbordado (ventana no documentada) | Nunca crudo al LLM: solo agregados; `hermes prompt-size` en el script inyector antes de cada turno; tope 35k/turno hasta medir; lote se parte solo si excede. |
| Alucinación de cuentas contables | Prompt cerrado al plan de cuentas incluido en el turno + **linter determinista post-turno** que rechaza el output si cita un código inexistente (el turno se repite con el error señalado); toda regla exige DocIDs de evidencia verificables. |
| Escritura accidental en ADM | Extracción solo vía wrapper GET; sin credenciales de escritura en los scripts nuevos; `CustomReports/Execute` vetado por nombre; el rol `contabilidad` como segunda barrera (verificación empírica diferida a Entrega 2 y marcada bloqueante allí). |
| Datos sensibles en git | `memoria/` guarda patrones y cuentas, no montos por empleado ni datos personales (nómina = estructura del asiento tipo); `raw/` y `agg/` viven fuera del repo y `raw/` se borra en F7; errores de API nunca a logs (reflejan el GUID de company); repo privado. |
| Costo runaway (429-1113 leído como rate-limit → reintentos infinitos por la cadena de fallbacks) | F0 verifica el endpoint antes del primer lote; fallbacks deduplicados; reintentos con tope por turno; `--repeat` finito siempre; corte diario por `--usage-file`; vigilar `/opt/data/logs/errors.log` tras el primer lote. |
| Cron agente inmaduro (nunca corrió) o toolset sin terminal | Piloto F0 obligatorio de ambas cosas antes del batch; plan B: bucle bash de `hermes -z` por lote (mismo script inyector), que no depende del scheduler. |
| Criterio borrador usado como precedente | Front-matter `estado:` + regla dura en la skill mesa + el libro append-only como única fuente de precedentes (grep de precedentes ya es el paso 1 de `escribir-libro-de-accion`). |
| Volumen crece durante la corrida (corte 2026-08-02) | Cursor de fecha desde F1; lo que entre después del corte lo captura el primer delta mensual, no se persigue en caliente. |