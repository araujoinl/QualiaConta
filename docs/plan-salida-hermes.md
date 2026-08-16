# Plan — salida de Hermes y de CodeBox: QualiaConta directo a z.AI sobre Supabase

> **BORRADOR v2 en revisión — 2026-08-15. Nada de esto está aplicado.** Nada se
> apaga ni se toca en producción hasta aprobar cada fase. Documentos hermanos:
> [modelo-zai.md](modelo-zai.md), [mesa-de-trabajo.md](mesa-de-trabajo.md),
> [esquema-del-bus.md](esquema-del-bus.md),
> [plan-encendido-escritura.md](plan-encendido-escritura.md).
>
> **v2**: corregido tras una revisión adversarial de 5 lentes (§11). Los cambios
> grandes contra v1: el apagón del contenedor mesa se movió de F3 a F4 (hoy el
> poller YA registra en ADM — v1 heredó una ficha desactualizada), nace la
> function `qualia-barrido` (pg_net no garantiza entrega), §4.4 reclasifica el
> problema PDF (el QR del e-CF exige rasterizar TODO PDF), §4.6 se reescribe
> (el "sin service_role" de v1 era inalcanzable para el registrador) y F4 queda
> bloqueada por precondiciones duras porque tres candados que v1 daba por
> puestos NO existen hoy (§11.2).

## 0. La decisión en una frase

Sustituir el chasis —Hermes Agent y sus contenedores en CodeBox— por llamadas
directas a la API de z.AI orquestadas desde la Supabase de Labs_Inv (Edge
Functions + `pg_cron` + triggers), manteniendo intactos el bus `qualia_*`, la
mesa web, la doctrina en git y las reglas de aprobación.

No se cambia de cerebro: **z.AI ya es el modelo**. Se quita el intermediario
que obliga a tener un contenedor vivo por empresa en un servidor casero.

## 1. Qué NO cambia (los invariantes)

Esto es lo primero que se revisa en cada fase: si algo de acá se movió, la fase
está mal hecha.

- **ADM Cloud es el libro oficial** y los límites viven en los permisos de ADM
  (SPEC regla 5). **Decisión del dueño (2026-08-16, v3): ROL ÚNICO.**
  `QualiaConta-Registro` muere como concepto — no se crea ningún rol nuevo.
  Fundamento: (a) la auditoría de ADM sigue al USUARIO, y el usuario API ya es
  uno solo (verificado contra el `.env`: `ADMCLOUD_USER` = `ADMCLOUD_REG_USER`)
  — todo lo de Qualia queda a un solo nombre; (b) **anular (Void) queda
  ABIERTO**: deja rastro (`Void:true`, es lo que leen las lápidas), es el flujo
  del botón de la mesa, y la regla «el agente jamás anula por su cuenta» vive
  en el código (ni el turno ni el registrador tienen esa tool); (c) eliminar
  sin rastro YA está negado por el rol (DELETEs → Unauthorized, sondado); (d)
  la firma e-CF no es recortable por rol en ADM (decisión 2026-08-02) → su
  candado es el default-deny en `_shared` (§4.6). Pendiente chico: el `.env`
  tiene DOS valores de rol distintos (verificado 2026-08-16) — consolidar a
  uno y correr las sondas §1.3 del plan-encendido en verde es la precondición
  1 de F4 (§11.2), ahora sin ninguna pantalla de ADM de por medio.
- **El bus `qualia_*` no se toca**: mismas tablas, misma máquina de estados,
  mismo claim atómico. Es la columna vertebral del diseño nuevo, no una víctima.
- **La mesa web en Labs_Inv no cambia ni una línea.** Sigue escribiendo como
  `authenticated`, igual que hoy.
- **`propuesta → aprobada` la mueve solo el humano.** La nómina jamás se gradúa
  a automática. La única excepción automática (cron de conciliación cerrando
  sugerencias superadas por NCF) sigue con su firma propia.
- **El libro de acción es append-only en git** (regla 2 del repo) y la doctrina
  se ratifica empujándola al humano, nunca sola.
- **GLM de z.AI con respaldo OpenRouter** (`z-ai/<modelo>`, mismos pesos) y
  `reasoning_effort: low` — cambia quién llama, no qué se llama.
- **WsNotify, colectores, callbell y los respaldos del server no se tocan.**
  CodeBox sigue existiendo para lo que necesita hardware físico; QualiaConta
  deja de ser inquilino, no lo desaloja a los demás.

## 2. Por qué (con lo medido)

1. **Hermes ya casi no trabaja.** Desde el proponedor determinista
   (2026-08-07), la factura de proveedor conocido se resuelve con UNA llamada
   de clasificación sin sesión, y el libro se escribe por plantilla. Hermes
   queda para los casos difíciles — y cada despertar carga ~17,7k tokens fijos
   de sesión, con la cuota del Coding Plan medida por tokens de ENTRADA
   (15,1M por ventana de 5h, cacheados a precio completo — ver
   [modelo-zai.md](modelo-zai.md)). Directo a la API, el costo fijo por paso
   baja a lo que mida el prompt de ese paso.
2. **Destraba multiempresa de raíz.** Las brechas 1 y 2 del análisis
   2026-08-15 (motor en la carpeta de blackbox con GUIDs fijos; freno de cuota
   `MESA_MAX_GLOBAL` sin implementar) son consecuencias del modelo
   contenedor-por-empresa. Con functions, la empresa es un parámetro y el freno
   de cuota vive en UN solo lugar.
3. **El destino ya existe a medias** (verificado 2026-08-15 contra el proyecto
   de Labs): ~30 Edge Functions `admcloud-*` y `nomina-*` en producción —
   registrar-compra, registrar-pago, anular-registro, verificar-registro,
   adjuntar, pago-impuesto, conciliar-comprobante, leer-factura-suplidor, la
   nómina completa. El poller ya llama a z.AI por `curl` y la visión ya cae a
   OpenRouter. `pg_cron` 1.6.4 y `pg_net` 0.19.5 ya están instalados en la
   base. No se construye un mundo nuevo: se termina uno que ya se estaba
   construyendo.
4. **Confiabilidad.** El 2026-08-13 CodeBox estuvo 18 horas ahogado por RAM.
   QualiaConta es puro I/O de API — no tiene por qué compartir destino con un
   teléfono Android y siete navegadores Playwright.

## 3. Inventario exhaustivo: lo que corre hoy y a dónde va

Regla de lectura: **destino con fase** = confirmado; **"auditar F0"** = no se
asume nada hasta medirlo.

### 3.1 Contenedores (corregido en v2: mueren en fases distintas)

| Contenedor | Qué hace | Destino |
|---|---|---|
| `qualiaconta-blackbox` (Hermes gateway) | casos difíciles, Telegram, 5 crons internos | muere en **F3**; reemplazos abajo |
| `qualiaconta-mesa-blackbox` (poller) | claim, dossier, proponedor, poke al webhook, **registro directo en ADM (en producción desde 2026-08-04)** y 4 barridos de rescate | muere en **F4**, cuando `qualia-registrador` esté en verde; el claim/proponedor lo pierde en F2 (flag), el registro y los barridos al final |

### 3.2 Crontab del server — línea por línea (relevado 2026-08-15)

| Cron | Qué hace | Destino | Fase |
|---|---|---|---|
| `17 * * * *` respaldo-documentos.sh | copia horaria del bucket al disco del server — **la única copia que hay** | **SE QUEDA** en CodeBox como rol pasivo de respaldo | — |
| `20 5 * * *` refrescar-precedentes.sh | refresca el índice de precedentes | `pg_cron` + function | F1 |
| `25 * * * *` partir-comprobantes.py | parte el PDF de comprobantes del banco por NCF (vive en el repo del colector) | auditar F0 — la cadena nace en el colector (server) y muere en ADM | F0 |
| `*/2` seguir-cuota.sh | copia el selector del panel al config.yaml del contenedor | **MUERE**: el selector se lee de `ai_feature_config` en runtime | F2 |
| `*/2` alerta-cuota.sh | vigila el tope de cuota | absorbida por el freno central + `qualia-salud` | F1 |
| `30 * * * *` adjuntar-comprobantes.py (docker exec mesa) | adjunta el papel a su cargo en ADM | auditar F0; `admcloud-adjuntar` ya existe como function | F0 |
| `35 * * * *` verificar-registros.py --marcar (docker exec) | lápidas: ADM no avisa cuando un documento muere | `pg_cron` + function; `admcloud-verificar-registro` ya existe | F1 |
| `*/5` refrescar-recurrentes.sh | refresca recurrentes | `pg_cron` + function | F1 |
| `0 12 * * *` alerta-salud.sh | salud diaria 8:00 AM RD, avisa por WhatsApp en cruces sano/roto | `qualia-salud` (pg_cron) + mismo canal de aviso | F1 |
| `50 23 * * *` registrar-consumo.py | rescata el consumo del agent.log antes de que rote | **MUERE**: cada llamada escribe su fila en `qualia_llm_uso` al momento | F2 |

(`reconcile/apply/restart-colectores` y `wsnotify-adb-rearm` son de otros
sistemas: no se tocan.)

### 3.3 Crons de Hermes (los 5 `sugerir-*`, relevados del contenedor)

`sugerir-cargos` (0,30), `sugerir-transferencias` (5,35), `sugerir-notas-debito`
(10,40), `sugerir-asignacion` (15,45), `sugerir-recurrentes` (20,50) — todos
scripts `no_agent`, entrega por Telegram. → **una function `qualia-sugerencias`
disparada por `pg_cron`** con el mismo escalonado, en F1. Las reglas ganadas se
portan tal cual: el detector de cargos nunca retira la sugerencia suelta
superada por NCF (la cierra el cron de conciliación con su firma), y el
trinquete de nómina no baja resolución.

### 3.4 `mesa/` — 17 archivos, 7.036 líneas

| Archivo | Destino |
|---|---|
| poller.sh (930) | muere; lo reemplazan trigger `pg_net` + functions |
| preparar-trabajo.sh (1.705) | `qualia-preparador` en TS. Punto duro: usa `pdftotext`/`pdftoppm` (poppler), que no existen en Deno → §4.4 |
| proponer-directo.py (717) | `qualia-proponedor` en TS — ya llama a z.AI directo, el port es mecánico |
| backtest-proponedor.py | **se conserva**: es el banco de pruebas para comparar server vs nube en F2 |
| replay-skill.py (1.249) | **se conserva**: banco de pruebas del turno en F3 |
| escribir-libro.py (244) | plantilla dentro del registrador |
| verificar-punteros.sh / verificar-corte.sh / medir-turnos.py | utilidades de diagnóstico; quedan en el repo como archivo. medir-turnos pierde su fuente (agent.log): las métricas nacen en `qualia_llm_uso` |
| alerta-salud.sh / alerta-cuota.sh | `qualia-salud` |
| refrescar-precedentes.sh / refrescar-recurrentes.sh | `pg_cron` + function |
| cortar-extractos.py | se absorbe en el preparador |
| respaldo-documentos.sh | se queda en el server (§3.2) |
| registrar-corrida.sh / registrar-consumo.py | mueren (cada function registra su propio uso) |

### 3.5 `memoria/scripts` — el motor de escritura (10.045 líneas)

Hipótesis por nombre contra la flota existente de Labs; **la cobertura real la
mide F0, script por script, con `casos-cuadre.json` (1.673 líneas) como banco**.
Las functions existentes las construyó Labs_Inv para SUS flujos: no se asume
equivalencia 1:1.

| Script | ¿Function existente que lo cubre? |
|---|---|
| registrar-en-adm.py (929) | `admcloud-registrar-compra` — auditar; los GUIDs hardcodeados pasan a tabla-catálogo por empresa |
| extraer-adm.py (887) | familia `admcloud-leer-*` |
| registrar-pago-factura.py (656) | `admcloud-registrar-pago` |
| conciliar-entradas.py (583) | `admcloud-conciliacion-entradas` / `conciliacion-entradas` |
| registrar-cargo-bancario.py (527) | gap probable — `conciliar-comprobante` cubre parte |
| registrar-asiento-diario.py (360) | `admcloud-pago-impuesto` y `nomina-registrar-pago` ya postean Journals: hay base |
| registrar-pago-cuenta.py (350) | `admcloud-registrar-pago` — auditar |
| registrar-transferencia-bancaria.py (336) | gap probable |
| buscar-precedente.py (301) | pasa a ser parte del proponedor (lee `qualia_libro`) |
| verificar-registros.py (228) | `admcloud-verificar-registro` |
| agregar-preentrenamiento.py / inyector-destilacion.sh / bloques-criterios.py | herramientas de destilación: se corren una vez, quedan en el repo como archivo |

### 3.6 Skills (8) → qué las reemplaza

| Skill | Reemplazo |
|---|---|
| mesa-de-trabajo | el orquestador mismo: functions + máquina de estados |
| consultar-admcloud | tool `leer_adm` del turno, sobre la flota `admcloud-*` |
| consultar-banco | tool SQL sobre `openbanking_*` (permisos mínimos, §4.6) |
| consultar-nucleo-dgii / consultar-nucleo-niif | núcleo empaquetado en el bundle, retrieval determinista por tema |
| escribir-libro-de-accion | plantilla + escritura a git por API de GitHub (§4.5) |
| conciliar-banco-adm | Entrega 3, nace serverless |
| analizar-cxc-adm | consulta del turno (`admcloud-ar` ya existe) |

### 3.7 SOUL.md, memoria de empresa, núcleo y libro → §4.5

## 4. Arquitectura destino

```
web (Labs_Inv)                        Supabase (misma base de siempre)
─────────────                         ─────────────────────────────────
sube archivo al bucket
inserta qualia_trabajos ────────────► trigger INSERT ─ pg_net ─► qualia-preparador
                                        (dossier al bucket/cache)      │
                                                                       ▼
                                      qualia-proponedor ── 1 llamada z.AI
                                        │ compuertas OK → propuesta
                                        │ duda → qualia-contable (turno)
usuario aprueba/corrige/responde ───► trigger evento ─► qualia-contable
                                        (mini-loop acotado, estado en el bus)
propuesta → aprobada (humano) ──────► trigger ─► qualia-registrador (F4)
                                        └─► flota admcloud-* ─► ADM Cloud
                                        └─► libro: git (API GitHub) + qualia_libro

pg_cron: qualia-sugerencias (0,30 * * * *) · qualia-salud (diaria) ·
         refrescar-* · verificar-registros (lápidas)
```

Functions nuevas: **7** (`qualia-preparador`, `qualia-proponedor`,
`qualia-contable`, `qualia-registrador`, `qualia-sugerencias`, `qualia-salud` y
`qualia-barrido`) más un módulo compartido `_shared/llm.ts`: selector de modelo
desde `ai_feature_config`, freno de cuota, **gate de concurrencia** (el
`MESA_MAX_GLOBAL` acordado el 2026-08-07 es un semáforo de llamadas EN VUELO,
no solo de tokens por ventana — sin él, 30 facturas arrastradas de golpe
repiten la estampida de 429 del 2026-08-03), fallback OpenRouter y registro de
uso. La matriz completa código→acción del endpoint (1113 no es rate-limit,
1308/1310 = cuota agotada NO reintentar, 1311 visión fuera del plan, 1211,
1213, 401) se porta de modelo-zai.md + alerta-cuota.sh + replay-skill.py como
spec con tests — no solo las dos trampas famosas.

**`qualia-barrido`** (pg_cron cada 1-2 min) es el heredero del papel invisible
del poller: `pg_net` es fire-and-forget — si el poke muere (cold start con
error, deploy a mitad, worker de pg_net caído), nadie reintenta. El barrido
porta los cuatro rescates que hoy hace `poller.sh` con sus umbrales: re-poke de
`pendiente` sin claim (300s), liberar `analizando` envejecido >20 min
(incidente de las 464 respuestas 429), reintento escalonado de `aprobada` sin
docid (10min/30min/1h hasta 12h) y `registrada`/`criterio` sin libro. Sin esta
function, "el retry la retoma" de §4.1 no tiene sujeto.

### 4.1 Límites de Edge Functions y cómo se respetan (doc verificada 2026-08-15)

| Límite | Valor | Cómo se respeta |
|---|---|---|
| CPU por request | 2s (el I/O async NO cuenta) | la espera del LLM es I/O; el cómputo propio es parseo liviano |
| Wall clock | 400s plan pago (150s free — confirmar plan en F0) | un turno = una invocación; nada de sesiones vivas |
| Idle timeout | 150s para responder | responder 202 de inmediato y seguir con `EdgeRuntime.waitUntil` |
| Memoria | 256 MB | documentos por streaming desde el bucket |

**El estado vive SIEMPRE en el bus, nunca en la memoria del worker.** Un corte
a mitad deja la fila en su estado y el retry la retoma — es el mismo diseño de
idempotencia + claim atómico que ya existe, ahora obligatorio por plataforma.
La "sesión" del contable es `qualia_eventos`: cada turno carga el historial de
la base, decide, escribe, y muere.

### 4.2 Cuota y modelo — el freno que hoy falta

- Tabla nueva `qualia_llm_uso`: una fila por llamada (empresa, function,
  modelo, tokens entrada/salida, latencia, ventana). `MESA_MAX_GLOBAL` (brecha
  2, acordado 2026-08-07) se implementa como check central en `_shared/llm.ts`
  contra la ventana de 5h — por fin en un solo lugar. Reemplaza
  registrar-consumo, alerta-cuota y medir-turnos.
- El selector del panel de AI Engines se lee de `ai_feature_config` **en el
  momento de la llamada**: muere seguir-cuota.sh y con él la limitación
  conocida de "la pantalla muestra lo que pediste, no lo que corre".
- Fallback OpenRouter como hoy (mismos pesos `z-ai/*`), ahora también útil como
  plan B si el endpoint coding discriminara IPs de datacenter (§7).

### 4.3 El turno acotado — reemplazo del agente para casos difíciles

Mini-loop propio en `qualia-contable`: system + dossier + núcleo relevante +
precedentes + historial de eventos → tool calls acotadas, máximo N iteraciones
por invocación. El endpoint coding es OpenAI-compatible con tool calls;
`reasoning_effort: low` se mantiene (medido: 8,8s por turno, y `minimal` reabre
la puerta de inventar — FP00001120).

Dos correcciones v2 sobre este diseño:

- **El contrato de tools sale de los protocolos, no de una lista intuitiva.**
  Además de `leer_adm`, `consultar_banco`, `preguntar_al_humano` y `proponer`,
  la rama de casos exige `abrir_trabajo` (hijos de un caso — regla dura: "cada
  paso es un TRABAJO, ninguno queda en prosa", lápida del Caso #2 Mtk Designs)
  y el carril de criterios exige `proponer_criterio`. Antes de F3, el toolset
  se verifica verbo por verbo contra rama-casos.md y rama-respuestas.md. Y las
  tools se diseñan "gordas" (una `dossier_completo` que emule a
  leer-contexto.sh en un solo round-trip): cada iteración re-paga el prompt
  entero contra la cuota, así que tools finas = más iteraciones = más entrada.
- **Contrato de continuación**: la plataforma mata sin señal atrapable. El loop
  se auto-impone un deadline (~300s), corta escribiendo un evento de corte, y
  se re-invoca vía pg_net con contador de continuaciones en la fila. Un turno
  que agota N iteraciones SIN pregunta real para el humano no se disfraza de
  `esperando_respuesta`: queda marcado "turno partido, continúa solo" y lo
  recoge el barrido.

Lo que se pierde de Hermes y **se acepta con nombre**: la auto-generación de
skills (SPEC 13 se retira — los GUIDs hardcodeados de la brecha 1 son el
argumento en contra), el sandbox de ejecución (innecesario cuando el código es
nuestro y versionado), y el Telegram interactivo (§4.6).

### 4.4 PDF sin poppler — decisión de diseño, se cierra con el spike de F0

Corrección v2: la dicotomía "texto vs escaneado" de v1 clasificaba mal el
problema. **El QR del e-CF exige rasterizar TODO PDF, también los que traen
capa de texto**: hoy `preparar-trabajo.sh` (bloque 4b) rasteriza las 2 primeras
páginas de CADA pdf a 200dpi y decodifica el QR con zxing, porque el QR PISA al
texto — trae la hora de firma que el papel no imprime y corrige fecha/monto mal
leídos (caso E310016169496: solo la URL del QR da "Aceptado" en DGII).

- **Texto**: `unpdf`/pdf.js en Deno, JS puro. El spike de F0 lo mide contra el
  PDF más pesado del bucket real (los anexos de 40 hojas existen), no contra
  uno representativo — el parseo es CPU pura y el tope son 2s; si no cabe, la
  válvula es tope de páginas con marca "extracción parcial" en el dossier.
- **Raster (QR + escaneados)**: pdfium-WASM + zxing-WASM en la function,
  midiendo CPU-time con un e-CF real. **Rasterizar en el navegador al subir**
  solo salva el canal web: los documentos que entran por cron, y mañana por
  correo o WhatsApp (ROADMAP Entrega 2), no pasan por un navegador — si el
  WASM no cabe en 2s, esa limitación se hereda con nombre y esos canales
  degradan a turno con imagen original, como hoy.

### 4.5 Doctrina, núcleo y libro en el mundo serverless

- **Git sigue siendo la fuente** (regla 2 del repo intacta).
- Núcleo DGII, doctrina y protocolos: empaquetados **estáticos en el bundle**
  de cada function. Actualizar doctrina = redeploy de un comando, amarrado al
  commit — mejor trazabilidad que el volumen actual, que se desincroniza sin
  que nadie se entere.
- **Libro de acción**: la lectura operativa pasa a `qualia_libro` (ya existe
  como espejo); la escritura crea el archivo en git **vía API de GitHub**
  (crear archivo nuevo = append-only nativo; editar ni siquiera se implementa).
  Descartado: libro solo-tabla — se pierde el diff revisable en git, que es la
  auditoría. Tres reglas v2: (a) el libro **NO viaja en el bundle** — crece
  ~4KB por entrada y a ritmo actual son ~25MB/año por empresa contra el límite
  de 20MB de bundle; en el bundle van núcleo + doctrina + protocolos + SOUL +
  memoria curada (~500KB), con check de tamaño en el deploy; (b) orden de
  escritura fijo: fila en `qualia_libro` con estado `pendiente_git` → llamada a
  GitHub → actualizar `ref_git` — la tabla es la fuente del retry, nunca se
  re-crea a ciegas (hoy ya pasó en miniatura: archivo duplicado cuando el
  insert falló y el barrido re-corrió); (c) `qualia-salud` cuadra a diario
  conteo y refs de la tabla contra el árbol real del repo.
- **Memoria de empresa** (hoy en el volumen `/opt/data`): se destila a
  doctrina/núcleo en git ANTES del apagón — es ítem del checklist de F3, nada
  se pierde con el contenedor.

### 4.6 Permisos y secretos (reescrito en v2 — el "sin service_role" de v1 era inalcanzable)

La revisión adversarial verificó contra el código real: **toda la flota
`admcloud-*` viva corre con SERVICE_ROLE_KEY y hace `select('*')` sobre
`admcloud_empresas`**, que guarda en la MISMA fila las credenciales ADM, la de
SMTP y la de Resend, en texto plano. El registrador NECESITA la credencial ADM
para escribir — no hay versión de "permisos mínimos" que lo evite sin refactor.
El diseño honesto:

- **Partir `admcloud_empresas`**: tabla de credenciales (solo service_role,
  cifrada en Vault en vez de texto plano) separada de la tabla
  catálogo-GUIDs/config (legible por el rol mínimo). Las functions que tocan el
  LLM no leen jamás la fila de credenciales; solo el registrador la lee, y por
  columnas, no `select('*')`.
- **Quién invoca qué**: las functions de escritura van `verify_jwt=true` CON
  autorización propia adentro (caller→empresa, como ya hace `ai-config-admin`)
  — hoy `admcloud-anular-registro` acepta la anon key pública sin verificar
  empresa, y eso se audita en TODA la flota de escritura como precondición de
  F4 (§11.2). Los triggers pg_net invocan con un bearer dedicado guardado en
  Vault, rotable — nunca la anon pública, nunca el service_role escrito en el
  DDL del trigger.
- **El deny de approvals.deny se porta como código**: los patrones
  `electronicsign` / `removesign` / `*/void` quedan como default-deny en
  `_shared/` de toda function de escritura. El kill-switch de F4 es otra cosa
  (frena la autonomía) y además se hace fail-safe: ausencia o valor inválido
  del flag = modo propuesta, no "seguir con lo último"; cada cambio del flag se
  loggea y alerta; y el permiso de tocarlo se separa del permiso de elegir
  modelo.
- **Token de GitHub**: fine-grained, un solo repo, `contents:write` sin
  workflows, sin auto-deploy sobre main — y la rama/árbol del libro separada de
  la doctrina, para que el token que escribe el libro no pueda tocar el system
  prompt que se empaqueta en el próximo deploy.
- **Multiempresa**: el aislamiento físico (un contenedor = una credencial)
  muere, y la RLS del bus es `using(true)`. Consecuencia v2: endurecer RLS de
  `qualia_*` por `empresa_id` deja de ser "deuda fuera de alcance" y pasa a ser
  **prerrequisito de F5** — antes de encender la segunda empresa, no después. Y
  por código: `empresa_id` nace SIEMPRE de `qualia_trabajos.empresa_id` (lo
  escribió la web), jamás de la salida del LLM ni del documento.
- Secretos (z.AI, OpenRouter, GitHub, Telegram) → Supabase secrets; ADM/SMTP →
  Vault. Salen del `.env` del server. La rotación de los secretos del server se
  hace DESPUÉS de vencida la ventana de rollback de 30 días, no en el apagón.
- Telegram: el gateway muere. Avisos salientes por el canal que ya existe
  (flota `wsnotify-*` o Bot API directo desde `qualia-salud`); consultas → la
  mesa web. Pregunta abierta §9.

## 5. Fases — alcance, criterio de terminado y rollback

**Regla general: nada se apaga hasta que su reemplazo lleve días en verde en
paralelo.** El cutover es por flag `qualia_modo` (`server` | `nube`) por
empresa y por etapa; volver atrás es volver el flag. Toda fase que toque
schema/functions pasa por la skill `supabase` y deja su migración en el repo.

### F0 — Spike y auditoría (sin tocar producción)

1. Function de prueba: llamada real a z.AI (endpoint coding) **desde la IP de
   Supabase** — hoy todo sale de CodeBox; verificar que el Coding Plan no
   discrimina datacenter. Medir latencia. **Visión por partida doble (v2)**: la
   misma imagen base64 contra z.AI coding Y contra OpenRouter `z-ai/glm-4.6v`,
   comparando transcripción — OpenRouter es el plan B entero de la migración y
   jamás corrió en visión (los modelos de visión ni siquiera aparecen en
   `GET /models`; hay que probar un chat/completions real).
2. Gap-analysis de los scripts de §3.5 contra la flota `admcloud-*`, con
   `casos-cuadre.json` como banco. **Ampliado v2**: incluye la auditoría de
   seguridad de la flota de escritura (quién puede invocarla, con qué llave,
   si verifica caller→empresa) y la tabla código→acción de z.AI como spec de
   `_shared/llm.ts`.
3. Decisión PDF (§4.4): extracción de texto contra el PDF **más pesado del
   bucket real** midiendo CPU-time contra el tope de 2s, y **el QR como caso
   propio** — pdfium-WASM + zxing-WASM con un e-CF real (v2: el QR pisa al
   texto y aplica a TODO PDF, no solo escaneados).
4. Trigger `pg_net` → function con inserts en tabla sombra; confirmar plan del
   proyecto (wall clock 400s); **decidir el bearer del trigger** (§4.6) y
   probar el camino del poke perdido (matar el poke a propósito → el barrido lo
   recoge).
5. Auditar la cadena comprobantes-pdf (partir/adjuntar): qué es del colector y
   qué de qualia.
6. **Presupuesto de cuota del diseño nuevo (v2)**: armar el prompt real del
   turno (system + dossier + tajada + precedentes), contar tokens contra los
   ~17,7k fijos actuales y estimar iteraciones por rama — §2.1 afirma que la
   cuota baja; F0 lo demuestra con números o corrige la afirmación.

**Terminado cuando:** cada fila del inventario §3 tiene destino confirmado o
gap dimensionado, y las 6 mediciones tienen número. **Rollback:** nada que
revertir.

### Resultados de F0 (corrida 2026-08-16) — F0 CERRADA

1. **z.AI desde la IP de Supabase: verde.** Texto HTTP 200 en 2,4s (ojo: la
   cuenta ya sirve glm-5.3 aunque se pida glm-5.2 — actualizar el selector);
   visión glm-4.6v transcribió una factura real perfecta en 6,1s; y
   **OpenRouter en visión, probado por primera vez: funciona**, transcripción
   idéntica, ~US$0,0007 por página. El plan B es real.
2. **Gap-analysis (5 agentes sobre el código desplegado):** compras ~20%
   (admcloud-registrar-compra registra VendorReceptions de importación, NO la
   VendorBill de gasto con NCF), pagos ~30-35% (el pago fiscal en nube SUPERA
   al script; BillPayments a proveedores = 0), cargos/transferencias/asientos
   ~0% directo con ~30% de maquinaria reutilizable (catálogo cuenta→UUID,
   cuadre con absorción — superior al script), conciliación: conciliar-entradas
   **100% cubierto y superado**; lápidas 50% (3 de 7 tipos, sin batch).
   Consecuencia: en F4 el registrador se ESCRIBE en su mayoría, no se orquesta.
3. **Seguridad de la flota (verificado contra el código):** las 10 functions de
   escritura usan service_role, CERO verifican el caller (la anon key entra),
   `admcloud-update-item` es escritura arbitraria sin lista blanca,
   `anular-registro` acepta el rastro de auditoría desde el body, y el único
   kill-switch (`activo`) NO se chequea en las que mueven dinero. Las
   precondiciones de §11.2 quedan confirmadas con nombres y apellidos.
4. **PDF: resuelto ENTERO en Deno, sin navegador.** Contra el PDF real más
   pesado (3,1MB/33 páginas): extracción de texto 162-300ms con 33/33 NCFs,
   partir una página 104ms, raster pdfium-WASM 187ms, y **jsQR decodificó el QR
   de un e-CF real** (URL ConsultaTimbre completa con FechaFirma) en <1s total.
   El plan A del navegador queda innecesario; los canales no-web quedan
   cubiertos.
5. **Cadena comprobantes-pdf: migra entera.** El insumo ya nace en Storage (el
   colector lo sube antes que nada); adjuntar necesita ~10 líneas en
   `admcloud-adjuntar` (modo bucket/path); partir probado en 4. Hallazgo
   colateral: el PDF de período del 2º RNC (131985203) es COPIA byte a byte del
   1º — el export del banco exporta la búsqueda activa; hoy inocuo, pero esa
   empresa no tiene papel propio.
6. **Cuota del turno nuevo, medida:** dossier real ~600 tokens (no 3.500);
   turno con tajada tipo router ~11k de entrada por iteración vs ~17,7k fijos +
   contexto creciente de Hermes. La baja de §2.1 se sostiene SOLO manteniendo
   el servido por tajadas y tools gordas — meter la rama completa empata.
7. **Trigger pg_net → function: verde.** Bearer generado DENTRO de la base
   (`qualia_config`, nunca pasó por un log), function con auth propia (401 a
   bearer inválido o ausente), pokes observables en `net._http_response` — y el
   patrón ya corre en producción en el proyecto (monitor-servicios).

Infra creada y aplicada (migraciones `20260816000100` y `...0200`, registradas
por MCP): `qualia_config`, `qualia_llm_uso`, `qualia_sombra`, RLS sin policies
+ revoke a anon/authenticated, modo global = `server`. Functions de spike
(`qualia-spike`, `qualia-spike-pdf`, `qualia-poke-echo`) quedan desplegadas
como referencia y se retiran al cerrar F1.

### F1 — Sugeridores, salud y barrido (riesgo bajo: detectores idempotentes)

`qualia-sugerencias`, `qualia-salud` y `qualia-barrido` por `pg_cron`;
refrescar-* migra igual. Convivencia: se apaga el cron viejo **por job** al
encender el nuevo — correr ambos duplicaría sugerencias. Dos contratos v2 del
port: (a) las **cinco llaves de reclamo** de un movimiento (`banco_tx_id`,
origen/destino, `banco_tx_ids[]`, `movimientos[]`) y el segundo not-exists que
silencia lo rechazado se verifican contra la implementación de referencia — el
agujero ya se pagó dos veces (40 cargos re-sugeridos el 2026-08-04, y de nuevo
en notas de débito el 2026-08-15); (b) **las lápidas (verificar-registros)
migran con modo sombra propio**: la function corre N días SIN `--marcar`
diffeando contra el script viejo, porque sus guardas nacieron de incidentes
(la versión por listado enterró 61 BankCharges vivos el 2026-08-04) — per-UUID,
anulado≠eliminado, ID devuelto=pedido, lo inverificable no se marca. Acá
también nace el **cron de cuadre 1:1** (precondición de F4).

**Terminado cuando:** 7 días de sugerencias equivalentes a la semana previa,
lápidas en sombra sin diferencias, y semáforo verde. **Rollback:** re-habilitar
el cron de Hermes (un comando).

### Estado de F1 (2026-08-16) — ENCENDIDA EN SOMBRA

Construida por 5 constructores + 5 revisores adversariales (todas las piezas
aprobadas con notas; las violaciones media se corrigieron: 429 de ritmo ahora
conmuta a OpenRouter, `??` vs `or` de Python en strings vacíos, parser
estricto de asignación, coalesce en detalles). Desplegado y verificado en
vivo:

- `qualia-barrido` (pg_cron `*/2`): los 4 rescates corrieron contra la cola
  real — 0 candidatos (el poller del server está al día, coherente).
- `qualia-sugerencias` (pg_cron `4,34`): multiempresa por `qualia_activa`; los
  5 detectores corrieron sin errores contra los espejos y el mapa reales y
  dieron **0 sugerencias nuevas — la equivalencia esperada**: las 5 llaves de
  reclamo reconocen todo lo que Hermes ya sembró.
- `qualia-salud` (pg_cron `12:00 UTC`): reporte completo en sombra (cola 42
  trabajos, huérfanos 0, libro 283/0 sin ref).
- Bearer de crons: nace en la base (`gen_random_bytes` en la migración), las
  functions lo validan leyéndolo — jamás pasó por un log, un .env ni un deploy.
- Espejos jsonl en el bucket privado `qualia-espejos` (los del server, frescos
  de la corrida 05:20) y `mapa-cuentas.yaml` vivo sembrado en `qualia_config`
  directo desde el server (los números de cuenta no viajaron por el chat).
- Deploy por CLI (`supabase functions deploy --use-api`) con el layout
  estándar `_shared/`; `deno check` en verde.

Pendiente del cierre de F1 (además de los 7 días de comparación): el **puente
de espejos** — `mesa/refrescar-precedentes.sh` sube los 6 jsonl al bucket y
renueva la marca `refresco_precedentes` al terminar (parche listo en el repo,
viaja con el próximo push al server); el port de las **lápidas** batch con su
sombra propia; y `verificar-registros`/`adjuntar-comprobantes` del crontab.

### F2 — Preparador + proponedor (el camino de la factura nueva)

Trigger en `qualia_trabajos` → preparador → proponedor. **Modo sombra
primero**: N días con el poller del server como único dueño del claim y la
function escribiendo su propuesta a una tabla de comparación, sin tocar la
fila; se compara con el backtest. Después, cutover con `qualia_modo='nube'`.
Acá nacen `qualia_llm_uso` y el freno central (§4.2).

Tres letras chicas v2 de la sombra y el flag: (a) la sombra necesita **modo
sombra explícito en el código** — el preparador actual tiene efectos
colaterales (marca `estado='error'` si la descarga falla, escribe eventos): una
URL vencida vista desde la nube le robaría la fila al poller; en sombra se
suprime TODO write salvo la tabla de comparación. (b) La sombra **duplica el
gasto de visión y clasificación** sobre la misma ventana de 5h — o reusa el
dossier del server, o el doble gasto entra presupuestado al freno de cuota.
(c) `qualia_modo` exige un cambio real en `poller.sh` (leer el flag y
abstenerse de reclamar, sin apagar sus barridos ni el registro directo) — es un
deploy más al server, con sus tres puntas, y entra al alcance de F2.

**Terminado cuando:** 2 semanas en nube con tasa de degradación-a-turno igual o
menor que la histórica y cero trabajos huérfanos (incluido el test del poke
perdido). **Rollback:** flag de vuelta — el poller sigue instalado hasta F4.

### Estado de F2 (2026-08-16) — SOMBRA ENCENDIDA, esperando tráfico real

Construida por 2 constructores + 2 revisores adversariales (ambas piezas
aprobadas con notas; corregido: GC del cache paginado con poda de 35 días e
invocable sin NCF, y la clasificación con thinking APAGADO fiel al fuente —
`reasoningEffort: 'disabled'` existe en `_shared/llm.ts` SOLO para esa llamada
determinista; el turno de F3 tiene prohibido usarlo). Desplegado y verificado:

- `qualia-preparador`: port bloque a bloque de preparar-trabajo.sh v3 (gates,
  idempotencia por sha256, QR que pisa al texto, DGII con endpoints exactos,
  visión vía llamarLLM). Cache en `qualia-espejos/dossier-cache/`.
- `qualia-proponedor`: compuertas del fuente + prompt byte a byte + dedup de
  sombra (una clasificación por trabajo, los re-pokes no re-pagan).
- Trigger `qualia_trabajos_poke_preparador` en INSERT (migración
  `20260816000500`) — el poke del poller, serverless; el perdido lo recoge el
  barrido. `empresa_rnc` sembrado para el timbre e-CF.
- Espejos completos: los 8 jsonl crudos + agg (proveedor-cuentas,
  plan-cuentas) + memoria (proveedores.md) + núcleo (rnc-tipo-gasto). El
  puente del refrescador los renueva a diario — **verificado en vivo**: la
  corrida del server del 2026-08-16 15:42Z subió todo y renovó la marca sola.
- Humo de plomería: preparador respeta el gate («no es pendiente; no toco
  nada»), proponedor responde 424 `falta_preparador` sin dossier, ambos
  resuelven modo sombra. Falta el humo con TRÁFICO real: la próxima factura
  arrastrada dispara el trigger y deja su dossier + propuesta en sombra para
  diffear contra lo que haga el server.

### F3 — El turno; apagón SOLO de Hermes (corregido en v2)

**Corrección v2 de secuencia — el error más grave de v1**: el contenedor mesa
NO se apaga en F3. `poller.sh` registra en ADM **en producción desde el
2026-08-04** (`registrar_directo()` despacha 6 tipos de documento a
memoria/scripts, con reintento escalonado y libro por plantilla) — v1 heredó la
ficha desactualizada de mesa-de-trabajo.md ("registrada todavía no habilitado")
y apagaba al único registrador vivo un mes antes de que naciera su reemplazo
(F4). En F3 muere solo el contenedor **Hermes** (gateway + turno + Telegram);
el mesa queda vivo, reducido a `registrar_directo` + sus barridos de registro,
hasta cerrar F4.

`qualia-contable` con el mini-loop (§4.3, con el toolset verificado verbo por
verbo contra las ramas). Validación previa v2: **el replay histórico NO es la
red** — el propio header de replay-skill.py declara que no puede medir un
cambio de envoltorio (system + tools + assembly a la vez). En su lugar: corpus
dorado por rama (N casos tipo caso, N correcciones, N registro_pendiente,
curados de `qualia_eventos` reales) + un período de doble corrida (Hermes
decide, la function decide en sombra a tabla de comparación).

Checklist de apagón de Hermes (ampliado en v2, ver §11.3): destilar la memoria
del volumen a git; **tar completo de `empresas/blackbox/hermes` +
`/home/codebox/qualia-docs` + `/home/codebox/comprobantes-pdf` a un destino
FUERA del server** (el kit de rollback no puede vivir en el mismo disco único
que se ahogó el 2026-08-13) + `docker save` de la imagen + copia cifrada del
`.env`; cosechar y commitear los .md del libro pendientes y cruzar
`qualia_libro.ref_git` contra el árbol real; documentar y archivar
`approvals.deny` y el config del volumen (su deny ya debe estar portado a
código en la nube ANTES de apagar); **reescribir respaldo-documentos.sh para
que lleve su propia conexión** (hoy hace `docker exec` al contenedor mesa — si
mesa muere en F4, el respaldo del bucket muere con él sin aviso) y verificar
que corrió en verde DESPUÉS de cada apagón; actualizar
`~/.claude/rules/codebox.md`.

**Terminado cuando:** un mes de operación con el turno en la nube y cero casos
resueltos por Hermes. **Rollback:** el contenedor Hermes queda `stop` (no `rm`)
30 días — revivirlo es `docker start` + flag — con su kit fuera del server.

### F4 — Registro en ADM (Entrega 2), serverless-first; apagón del mesa

`qualia-registrador` sobre la flota `admcloud-*`, con catálogo de GUIDs por
empresa en tabla (mata la brecha 1). **Precondiciones bloqueantes (v2, §11.2)**:
el rol recortado real de ADM creado y sondado en verde; el default-deny de
sign/void portado a código; la flota de escritura auditada (autorización
caller→empresa — hoy `anular-registro` acepta la anon key); credenciales
partidas a Vault; y el **cron de cuadre 1:1** corriendo desde F1-F2 (documento
QC-* en ADM sin trabajo `registrada` = huérfano; `registrada` sin documento =
fantasma) — es el detector de todos los modos de fallo de escritura.

**Las guardas duras del
[plan-encendido-escritura §3.4](plan-encendido-escritura.md) nacen acá, en
código**: tope de monto por documento, tope diario de escrituras, prohibición
de backdating pasado el día 5, y kill-switch central fail-safe (§4.6). Además,
v2: **serialización de la escritura por empresa** con
`pg_advisory_xact_lock(empresa_id)` alrededor de POST+readback — ADM asigna el
correlativo al guardar y dos POST simultáneos chocan (incidente CB00000225 del
2026-08-05; hoy lo evita un flock del poller que no existe entre invocaciones)
— más claim de registro en la fila para que el barrido no re-dispare un POST en
vuelo. El registrador re-chequea kill-switch y versión solo ENTRE documentos
(drain), y antes de cada POST persiste `escritura_iniciada` en `qualia_eventos`
(plan-encendido §4.2). La regla de la nómina (reportar con nombre y número,
jamás reintentar solo) se porta como está.

Cerrada la validación, acá muere el contenedor mesa (mismo checklist de kit
fuera del server) y con él el último proceso de qualia en CodeBox.

**Terminado cuando:** el criterio original de Entrega 2 — una factura de punta
a punta sin tocar nada — más el cuadre 1:1 en verde 2 semanas. **Rollback:**
kill-switch (y el mesa sigue vivo hasta ese verde, así que volver es un flag).

### F5 — Multiempresa y limpieza

Encender Planchas Comerciales (el freno de cuota ya existe desde F2). Mover
las migraciones del bus al repo del producto (brecha 5), limpiar el núcleo
contaminado con datos de Blackbox (brecha 4), reescritura documental (§6),
borrar `deploy/` y compose.

### Esfuerzo (t-shirt)

F0: 2-3 días · F1: 2-3 días · F2: ~1 semana · F3: 1-2 semanas · F4: es la
Entrega 2 que ya estaba pendiente, ahora nace serverless · F5: 3-4 días. Con
F1-F3 el server queda libre de qualia.

## 5.bis Backtest contra la historia (2026-08-16) — reemplaza a "7 días de sombra"

**Decisión del dueño**: esperar tráfico futuro es la peor forma de conseguir la
evidencia. En su lugar se corre el circuito de la nube sobre facturas YA
resueltas y se contrasta contra lo que el server hizo de verdad. Mismo valor
probatorio, horas en vez de días. Palanca: `{"backtest": true}` en el body del
preparador, que **solo obedece en modo sombra** (en nube el portón de
`pendiente` sigue intacto).

Tres corridas sobre las últimas 12 facturas registradas. Lo que encontró — y
ninguna de las tres la habría encontrado una revisión de código:

1. **Las llaves del modelo nunca se configuraron en el proyecto.** Toda foto
   caía en `metodo: ninguno` con "vision: llave sin ZAI_API_KEY ni
   OPENROUTER_API_KEY". Corregido (`supabase secrets set`); la visión ahora lee
   NCF y monto **idénticos al server** en las tres fotos del lote.
2. **El empalme preparador→proponedor perdía el dossier.** Storage NO garantiza
   leer-lo-recién-escrito: el dossier subido a las 21:03:41.983 se leía sin
   extracción a las 21:03:43. El proponedor degradaba TODO a turno por
   "dossier sin extraccion" — un pipeline que parecía sano y no lo estaba.
   Corregido: el poke lleva un **sello de frescura** (`dossier_en`) y el
   proponedor reintenta con backoff hasta ver esa versión; el cache del dossier
   va con `cacheControl: '0'`.
3. **HEIC (fotos de iPhone, 4 de 12 del lote) — detectado y RESUELTO el mismo
   día.** Primero se midió el callejón: el decodificador WASM revienta el
   límite de cómputo (`WORKER_RESOURCE_LIMIT`) y z.AI rechaza el formato crudo
   (error 1210) — o sea, ni convertir en la function ni mandarlo tal cual. La
   salida NO fue el navegador ni un puente en el server: **el transformador de
   imágenes que Storage ya trae** (`render/image`) sirve el mismo objeto
   convertido a JPEG, del lado del servidor de Storage, y la function solo
   recibe el resultado. Verificado sobre las 4 facturas HEIC del lote: NCF y
   montos **idénticos al server**, cero errores de prep. Queda como la vía
   oficial (`heicAJpeg` en el preparador) con degradación limpia si falla.

Lo que el backtest CONFIRMÓ que funciona, punta a punta: PDF con capa de texto
(extracción, QR del e-CF, DGII), visión sobre fotos jpg/png, el dedup contra la
mesa y contra el histórico de ADM (las degradaciones "posible duplicado (mesa:
0, ADM: 1)" son correctas: el backtest re-procesa facturas que YA están
registradas), y la cadena trigger→preparador→proponedor con su sello.

Criterio de terminado de F2, corregido: **el backtest en verde sobre un lote de
facturas variadas** (sin HEIC pendiente) reemplaza a los 7 días de calendario.

## 5.ter Boletín del examen del corpus (2026-08-16) — el turno, medido

18 de los 20 casos dorados corridos contra `qualia-contable` en modo examen
(cero escrituras; el snapshot no lleva la respuesta). Resultado por rama:

| Rama | Aprobados | Parcial | Reprobados | Ojo humano |
|---|---|---|---|---|
| facturas difíciles (5) | 4 | 1 | 0 | 0 |
| criterios (5) | 3 | 0 | 1 | 1 |
| correcciones (5) | 1 | 0 | 2 | 2 |
| casos de conciliación (3 corridos) | 0 | 0 | 0 | 3 |

**Lo que el examen dice, sin maquillaje:**

- **El camino diario está listo.** En facturas difíciles el turno eligió la
  misma cuenta, documento, tipo 606, monto y NCF que el contable real —
  incluido un proveedor nuevo sin precedente, donde pidió el plan de cuentas
  vivo y razonó por naturaleza del renglón.
- **La rama de correcciones es la floja, y falla hacia el lado peligroso**: en
  `nuevo-milenio` PROPUSO donde el contable real probó que faltaban datos y
  había que preguntar; en `suena-inversor` cerró con `marcar_error` donde el
  histórico pedía propuesta. Antes del cutover, esa rama necesita su vuelta de
  tuerca (la tajada de respuestas es la que menos se re-tajó).
- **`cashback` reprobó por agotar las 8 iteraciones sin cerrar.** N=8 y el tope
  de 3 continuaciones eran "propuestas de diseño, no medidas" (contrato §4):
  ésta es la medición que faltaba — hay que subir el tope para casos de varias
  consultas.
- **Los casos de conciliación no los puede calificar una máquina**: son juicio
  multi-paso y el calificador lo dice honestamente (`requiere_ojo_humano`), que
  era el diseño. Las transcripciones quedan para revisión humana.

Criterio de cutover de F3, con esto medido: facturas y criterios en verde;
**correcciones y el tope de iteraciones son trabajo pendiente**, no detalles.

### Primera vuelta de correcciones (mismo día): una anduvo, la otra no

- **El tope de iteraciones: RESUELTO.** 8 → 14 (el corte real lo pone el
  deadline de 300s, no el contador). `cashback` pasó de "no cerró" a cerrar…
  proponiendo `BankCharges` donde el real fue `Journals`. Sigue reprobado, pero
  ahora el fallo es CONTABLE y medible, no un turno que se apaga mudo.
- **La rama de correcciones: NO se arregla con doctrina.** Se agregó al manual
  la lección literal del caso nuevo-milenio (el dato corregido pisa al dossier
  y se re-verifica; sospechar del RNC que es el propio; si falta un campo,
  preguntar). Re-examen: `nuevo-milenio` SIGUE proponiendo donde debía
  preguntar, y `suena-inversor` movió de `marcar_error` a `responder` sin
  llegar a la propuesta. Conclusión honesta: el problema no es que le falte la
  regla escrita — es cómo el turno decide CERRAR. Queda como el trabajo de
  fondo de F3, con el corpus como banco de pruebas.

## 6. Qué se reescribe del SPEC (en sesión de enmienda, no de pasada)

| Decisión | Cambio | Por qué |
|---|---|---|
| 4 — Motor: Hermes Agent | pipeline propio: functions + bus + llamadas directas | lo que Hermes aportaba (memoria, gateway, sandbox, auto-skills) ya no se usa o se retira a propósito |
| 5 — Memoria nativa en archivos | git sigue de fuente; lectura por bundle y `qualia_libro` | la auditoría por diff se mantiene; el volumen desincronizable desaparece |
| 6 — Una instancia por empresa | aislamiento por `empresa_id` + catálogos + permisos | el aislamiento físico ya estaba contaminado (brecha 4); el lógico es verificable |
| 9 — Telegram como canal | solo avisos salientes, o muere (pregunta §9) | el gateway era de Hermes; la mesa web ya es la superficie |
| 12 — CodeBox con Compose | Supabase de Labs_Inv | este plan |
| 13 — El agente escribe sus scripts | **SE RETIRA** | la lección de la brecha 1: scripts auto-escritos con GUIDs fijos y sin revisión |
| §2 — no reutilizar el cliente de Labs_Inv | la flota `admcloud-*` pasa a ser EL cliente único | el costo de dos clientes ya se estaba pagando; los "dos números distintos" que el SPEC temía se evitan teniendo uno |

También: `CLAUDE.md` del repo (la identidad deja de ser "config sobre Hermes"
y pasa a "pipeline contable + doctrina"), y `CONTEXT.md` (mesa-poller, gateway
y webhook salen del glosario).

## 7. Riesgos y qué los tapa

| Riesgo | Mitigación |
|---|---|
| z.AI bloquee IPs de datacenter en el Coding Plan | spike F0 antes de escribir una línea; plan B: OpenRouter como primario (mismos pesos) |
| La flota `admcloud-*` cubra menos de lo que su nombre promete | gap-analysis F0 con casos-cuadre; lo que falte se escribe en TS — trabajo que la brecha 1 igual exigía |
| PDF escaneado sin poppler | decisión F0 (navegador o WASM); mientras, degrada a turno como hoy |
| Un caso que no quepa en una invocación | el turno se parte por diseño: estado en el bus, evento, siguiente invocación |
| Duplicidad durante la convivencia | claim atómico + `qualia_modo` por empresa/etapa; la sombra escribe SOLO a tabla de comparación |
| Registro a medias (nómina: 3 POST sin deshacer) | misma regla de hoy portada + tope diario en código (F4) |
| RLS tautológica del bus | fuera de alcance, anotada (brecha 3); este plan no la empeora: functions con permisos mínimos, no service_role |
| Respaldo del bucket | sigue en CodeBox como rol pasivo; alternativa cloud anotada como pendiente, no bloquea |

## 8. Qué muere en CodeBox, y cuándo (corregido en v2)

- **F3**: contenedor `qualiaconta-blackbox` (Hermes: gateway, turno, Telegram)
  y del crontab seguir-cuota, alerta-cuota, alerta-salud, refrescar-* y
  registrar-consumo.
- **F4**: contenedor `qualiaconta-mesa-blackbox` (el poller registra en ADM en
  producción — muere solo cuando `qualia-registrador` esté en verde), la imagen
  `qualiaconta:local`, y del crontab verificar-registros y
  adjuntar-comprobantes (si F0 la confirma migrable).
- **Se queda:** respaldo-documentos.sh (respaldo pasivo del bucket, reescrito
  ANTES de F3 para no depender del `docker exec` al contenedor mesa) y todo lo
  que no es de qualia. Cada apagón deja su kit de rollback FUERA del server.
  Las tres puntas (local, GitHub, server) se cierran en cada fase como siempre.

## 9. Preguntas abiertas para la revisión

1. ¿Telegram queda como canal de avisos salientes o muere del todo?
2. ¿El libro escribe a git vía API de GitHub (recomendado: mantiene el diff
   como auditoría) o pasa a tabla-primaria con export periódico?
3. ¿Las functions de qualia viven en el repo QualiaConta desplegando al
   proyecto de Labs (recomendado: identidad del producto y brecha 5 resuelta de
   paso) o dentro de Labs_Inv junto a la flota `admcloud-*`?

## 10. Anexo — el conocimiento del contable: qué es, dónde está y a dónde va

Inventario del 2026-08-15 (3 lectores sobre el repo completo). El dato central:
**la estructura de toma de decisiones NO vive dentro de Hermes — vive en git,
en este repo. Hermes solo la monta como archivos.** Por eso esta parte de la
migración es la de menos riesgo: la fuente no se muda; cambia el mecanismo de
carga.

### 10.1 Las cuatro capas y su destino

| Capa | Qué es hoy | Dónde vive hoy | Destino |
|---|---|---|---|
| **Lo que sabe** — núcleo compartido | `nucleo-contable/`: DGII (7 normas con rango y vigencia: retenciones ISR/ITBIS con casilla del IT-1, tasas, NCF 31-47, 606/607, anticipo ISR), NIIF-PYMES (6 secciones destiladas), doctrina (principios P-001..P-005 y mapa hecho→asiento H-01..H-12), agregado RNC→tipo de gasto (164 suplidores) | git, montado `:ro` en el contenedor | git igual; **empaquetado en el bundle** de cada function al deploy. Cambiar una norma = commit + redeploy, amarrado al commit |
| **Lo que aprendió de la empresa** | `empresas/blackbox/hermes/`: SOUL.md (103 líneas — el system prompt), memoria curada (proveedores.md 939 líneas en borrador, criterios C-00x ratificados, nómina), **libro de acción: 284 entradas append-only** con Alcance y Aprobó | git (whitelisteado en el .gitignore) | git igual → bundle. El libro además mantiene su **doble punta que ya existe hoy**: archivo en git (auditoría por diff) + espejo en `qualia_libro` (la lectura operativa de precedentes en runtime) |
| **Cómo procede** — protocolos | `skills/`: mesa-de-trabajo (el flujo con sus compuertas: las 5 preguntas del tipo de documento, aritmética del ITBIS despejada, borrador-no-es-precedente), consultar-*, conciliar, CxC. El router `abrir-trabajo.sh` (763 líneas) ya sirve "la tajada" de instrucciones según el estado real de la fila | git | git igual → **instrucciones por paso** de cada function. El router determinista se porta casi 1:1: hoy ya decide por estado de la fila, no por lo que diga el webhook |
| **Lo que recuerda de cada caso** | la conversación del trabajo | `qualia_eventos` (ya en Supabase) | igual — ya es serverless; cada turno recarga el historial de la base |

### 10.2 La cascada de decisión se porta como texto, no se reconstruye

La jerarquía que gobierna todo (P-003: lo asentado en ADM > doctrina >
criterios ratificados de la empresa > precedente citable > DGII solo para el
eje fiscal > NIIF solo cuando lo demás calla) está **escrita en
`doctrina/principios-de-asiento.md` y repetida en los protocolos** — no es
comportamiento emergente de Hermes. El ensamblado del prompt por llamada es
determinista, sin búsqueda semántica:

- **Proponedor**: compuertas + agregado RNC→tipo de gasto + precedentes del
  proveedor (de `qualia_libro`) + catálogo 606 → una llamada.
- **Turno difícil**: SOUL como system + dossier + la tajada del núcleo según el
  tema (igual que hoy la sirve el router) + precedentes + historial de eventos.

### 10.3 Lo que NO está en git y se rescata en el checklist de F3

- Los **PDFs fuente** (compendio DGII jul-2025, NIIF-PYMES 2015) — "van al
  lado, fuera de git", viven solo en el volumen del server.
- **`mapa-cuentas.yaml` vivo** (gitignoreado; en git solo hay dos .bak del
  2026-08-03) — pasa a tabla por empresa, junto al catálogo de GUIDs.
- **`preentrenamiento/raw/*.jsonl`** — sin esos raw, los generadores del
  agregado no regeneran nada; el agg viaja como artefacto ya generado.
- **`approvals.deny` y el config del volumen** — se documentan y archivan; su
  función la heredan las guardas en código de F4.

### 10.4 Contaminaciones detectadas (limpiar durante el port — brecha 4 con lista)

- **Reglas fiscales hardcodeadas dentro de skills** que el propio README de
  skills prohíbe: tasas de ITBIS y lista del art. 343, propina legal 10% Ley
  16-92, impuestos bancarios (2x1000, 0,15% cheques, 1% Norma 07-19) en
  rama-facturas-1; comisión de tarjeta 5.395% en conciliar-banco-adm Y en su
  script. Si la DGII cambia algo hoy, hay que cazarlo en dos lugares. En el
  port: la regla se cita del núcleo, el dato variable va a configuración.
- **Datos de Blackbox en material compartido**: cuentas y DocIDs concretos como
  evidencia en la doctrina, mapeo de cuentas Santa Cruz con números completos
  en una skill, clientes reales nombrados en analizar-cxc, el RNC de Blackbox
  en una plantilla de URL. Nada de eso sirve para Planchas Comerciales tal cual.
- **Enmiendas de doctrina compartida viviendo en el libro de Blackbox** (la
  H-12 acotada del 2026-08-14 y hermanas): con una sola empresa no dolía; con
  dos, una corrección que quede en el libro de una no llega a la otra. En el
  port, esas enmiendas suben al núcleo.
- La lista de tipos con registro automático vive en DOS lugares (poller y
  verificar-registros) y ya se desincronizó tres veces — en el diseño nuevo
  queda en UNA tabla/constante compartida por las functions.

## 11. Revisión adversarial (2026-08-15) — qué encontró y veredicto de riesgo

Cinco revisores independientes atacaron el plan v1 (producción, pérdida de
datos, regresión del contable, plataforma, seguridad), verificando cada
escenario contra el código real. Lo confirmado se integró arriba (marcado
"v2"); esta sección deja el veredicto y las precondiciones juntas.

### 11.1 Los dos errores de secuencia de v1 (ya corregidos arriba)

1. **v1 apagaba en F3 al único registrador vivo**: el poller registra en ADM en
   producción desde el 2026-08-04 y su reemplazo nacía en F4. Corregido: el
   mesa vive hasta F4 (§5-F3, §8).
2. **v1 mataba el respaldo del bucket el día del apagón**: respaldo-documentos
   hace `docker exec` al contenedor que se apagaba, y es la única copia de unos
   documentos que ya se perdieron una vez. Corregido: se reescribe antes de F3
   con conexión propia (§5-F3).

### 11.2 Precondiciones bloqueantes de F4 (la escritura no se enciende sin esto)

1. **Rol único consolidado y sondado** (decisión del dueño 2026-08-16, ver §1):
   los dos valores de rol del `.env` pasan a uno solo, y las sondas del
   plan-encendido §1.3 en verde contra ese rol (DELETEs negados, escalación
   rebotada). Void queda abierto a propósito (rastro + botón de la mesa +
   lápidas); la anulación autónoma se prohíbe en código, no en el rol.
2. Default-deny de `electronicsign`/`removesign`/`*/void` portado a código en
   la nube (heredero del `approvals.deny`).
3. Flota `admcloud-*` de escritura auditada: autorización caller→empresa en
   cada function (hoy `anular-registro` acepta la anon key pública).
4. Credenciales ADM/SMTP partidas de `admcloud_empresas` a Vault; el LLM jamás
   en el mismo contexto que una credencial.
5. Cron de cuadre 1:1 ADM↔bus corriendo en verde desde F1-F2.
6. `pg_advisory_xact_lock` por empresa en el registrador (correlativo de ADM) +
   claim de registro en la fila.

### 11.3 Riesgos que la mudanza NO crea pero destapó (existen HOY)

- Los Void de ADM están permitidos hoy con el rol actual; la única barrera es
  un archivo gitignoreado en un volumen que no sobrevive recreaciones.
- `admcloud-anular-registro` (en producción hoy) es invocable con la anon key
  pública sin verificar empresa.
- Credenciales de todas las empresas en texto plano en una tabla que toda la
  flota lee con `select('*')`.
- RLS `using(true)` en todo el bus.

La mudanza obliga a arreglarlos (11.2); posponerla los deja como están.

### 11.4 Veredicto de riesgo por fase (con v2 aplicado)

| Fase | Riesgo | Por qué |
|---|---|---|
| F0 | nulo | no toca producción; solo mide |
| F1 | bajo | detectores idempotentes, cutover por job, rollback de 1 comando; lápidas con sombra propia |
| F2 | bajo-medio | sombra sin writes + flag por empresa; lo nuevo convive con el poller vivo |
| F3 | medio | cambia el cerebro de los casos difíciles; acotado por corpus dorado + doble corrida + Hermes en stop 30 días con kit fuera del server |
| F4 | **alto por naturaleza** | escribe en un libro oficial donde revertir BORRA y los duplicados no se frenan — por eso es la única fase con precondiciones bloqueantes (11.2) y ya era el trabajo pendiente de Entrega 2 con o sin mudanza |
| F5 | medio | el aislamiento pasa de físico a lógico: RLS por empresa_id es prerrequisito, no deuda |

**En una frase**: la mudanza en sí (F0-F3) es de riesgo bajo-medio y siempre
reversible; lo genuinamente riesgoso es encender la escritura autónoma (F4), y
eso es riesgo de la Entrega 2 que ya existía — la mudanza lo hereda, lo destapa
y lo blinda mejor de lo que está hoy.
