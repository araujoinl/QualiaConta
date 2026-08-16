# Mesa de trabajo — contrato del bus con Labs_Inv

La mesa es la superficie web principal del contable: un tab del módulo ADM
Cloud en Labs_Inv donde arrastran facturas, ven el desglose de lo que el
contable propone, aprueban o rechazan, leen el libro y reciben sugerencias.
Telegram queda como canal de consulta y avisos (SPEC, decisión 9 enmendada).

Nada entra a CodeBox: el bus son tres tablas y un bucket en la Supabase de
Labs_Inv (la misma base del banco). La web escribe como `authenticated`; el
contable lee y escribe con su DSN (`QUALIA_DSN`, rol `qualiaconta_lector`,
grants sólo sobre estas tablas). El rol NO ve `admcloud_empresas` (ahí viven
credenciales): cada instancia conoce su empresa por `QUALIA_EMPRESA_ID`.

> Este documento describe **cómo se usa** el bus. La forma exacta de las tablas
> —el DDL, los grants por columna, las policies, el trigger y el bucket, con las
> migraciones que hay que crear y en qué orden— está en
> [esquema-del-bus.md](esquema-del-bus.md). Hace falta si montás QualiaConta
> contra una base nueva: las migraciones viven en el repo de la web, no acá.

## Las piezas

```
Labs_Inv (web)                       CodeBox
──────────────                       ────────
sube archivo al bucket qualia-conta
inserta qualia_trabajos (pendiente)
                              ←──── mesa-poller (sidecar, sin LLM):
                                    psql cada ~20s; si hay trabajo,
                                    POST 127.0.0.1:$PUERTO_PANEL/webhooks/mesa
                                    → despierta al contable (skill mesa-de-trabajo)
muestra qualia_eventos en vivo ←─── el contable escribe eventos y propuesta
usuario aprueba/rechaza/responde ─→ (siempre insertando un evento autor=usuario)
                              ←──── poller detecta el evento → despierta al contable
                                    → libro de acción + espejo qualia_libro
```

- El webhook `mesa` corre con secret `INSECURE_NO_AUTH`: el panel de Hermes
  escucha SÓLO en 127.0.0.1 y Hermes exige loopback para aceptar esa
  configuración. El payload es apenas un puntero (`trabajo_id`, `motivo`); el
  contable relee la base como única fuente de verdad, así que un POST espurio
  no puede hacerle registrar nada.
- Entre el preparador y el poke vive el **proponedor determinista**
  (`mesa/proponer-directo.py`, desde 2026-08-07): si el documento es de un
  proveedor conocido y pasa todas sus compuertas, arma la propuesta con UNA
  llamada de clasificación (sin sesión Hermes) y deja la fila en `propuesta`
  — el contable ni se despierta. Cualquier duda degrada al poke de siempre,
  con el motivo en `/tmp/mesa/<id>/clasificacion.json` para la sesión. La
  contracara existe desde el mismo día: tras el registro directo, la entrada
  del libro la escribe una plantilla (`mesa/escribir-libro.py`). Una factura
  repetida ya no toca el modelo en NINGÚN punto de su ciclo.
- El poller no marca nada por sí mismo: todos los cambios de estado los hace
  el contable (o la web). Si el poller despierta dos veces por lo mismo, el
  claim atómico y la idempotencia de la skill lo absorben.

## qualia_trabajos

Una fila por documento arrastrado o sugerencia del contable.

| Columna | Quién la escribe | Qué es |
|---|---|---|
| `empresa_id` | web | UUID en `admcloud_empresas` |
| `tipo` | web/cron | `factura` (arrastrada), `sugerencia` (detectada por el contable) o `criterio` (bloque de reglas del preentrenamiento para ratificar; nace en `propuesta`, sin archivo) |
| `origen` | web/cron | `web` o `cron_conciliacion` |
| `estado` | ver tabla de estados | máquina de estados del trabajo |
| `archivo_path` / `archivo_nombre` | web | archivo en el bucket `qualia-conta` (null en sugerencias) |
| `archivo_url` | web | URL firmada (~30 días) para descargar sin llaves; si venció, la web la regenera |
| `resumen` | contable | título humano del card ("Factura Sunix — RD$45,200 gasoil") |
| `propuesta` | contable | jsonb, ver forma abajo |
| `creado_por` | web | usuarios.id |
| `aprobado_por` / `aprobado_por_nombre` | web | quién aprobó/rechazó; el nombre es durable (SPEC decisión 19) |
| `error_detalle` | contable | sólo con estado `error` |

### Estados y quién mueve cada transición

| Transición | Quién |
|---|---|
| (nace) `pendiente` | web (o cron de sugerencias, que nace en `propuesta`) |
| `pendiente → analizando` | contable, claim atómico |
| `analizando → propuesta` | contable, con `propuesta` y `resumen` llenos |
| `analizando → esperando_respuesta` | contable, tras evento `pregunta` |
| `aprobada → esperando_respuesta` | contable, cuando el registro en ADM se traba y necesita al humano (el `AMBIGUO` de un cargo bancario, p. ej.). Habilitada el 2026-08-07: antes el `update` guardaba `and estado='analizando'` y desde `registro_pendiente` matcheaba CERO filas sin fallar — el evento quedaba escrito, la fila seguía `aprobada` y el poller la reintentaba dos horas |
| `esperando_respuesta → analizando` | contable, al llegar la respuesta |
| `propuesta`/`pendiente`/`error` `→ analizando` | contable, cuando el usuario corrige una propuesta suya. **`esperando_respuesta` NO es el único origen de una respuesta**: sólo lo es cuando el contable preguntó. El caso común es que el humano corrija por su cuenta y la fila siga en `propuesta` |
| `propuesta → aprobada` / `rechazada` | usuario en la web. NUNCA el contable. Una sola excepción automática (2026-08-15): el cron de conciliación cierra en `rechazada` la sugerencia suelta de un cargo cuando un comprobante fiscal VIVO ya lo ampara — se reconoce por `motivo_rechazo`/`superada_por_ncf` dentro de `propuesta` (los `aprobado_por*` quedan null: esas columnas solo las escribe la web — el grant de `qualiaconta_lector` no las incluye, a propósito); no es una decisión humana y el contable no le responde |
| `aprobada → registrada` | contable, al registrar en ADM Cloud — **todavía no habilitado** (Entrega 2); mientras tanto los trabajos quedan en `aprobada` y eso es correcto |
| `* → error` | contable, con `error_detalle` |

### Forma de `propuesta` (jsonb)

```json
{
  "proveedor": "Sunix Petroleum SRL",
  "rnc": "101-89755-2",
  "ncf": "E310000012345",
  "fecha": "2026-08-01",
  "moneda": "DOP",
  "monto": 45200.00,
  "itbis": 6890.85,
  "tipo_gasto": { "codigo": "02", "nombre": "Gastos por Trabajos, Suministros y Servicios" },
  "metodo": "precedente",
  "precedente_ref": "libro-de-accion/2026-07-30-sunix-combustible.md",
  "confianza": 0.95,
  "detalle": "Gasoil flotilla. ITBIS no aprovechable (NG 07-2007 art. 3)."
}
```

`metodo`: `precedente` (aplicó una entrada del libro), `script` (lo resolvió un
script propio) o `razonado` (caso nuevo, razonado desde el núcleo DGII y la
memoria). `precedente_ref` sólo cuando `metodo != razonado`.

**`tipo_gasto`** (desde 2026-08-02) es la clasificación DGII del **606** que
ADM pide en la cabecera: catálogo fijo 01-11 (`raw/expense-types.jsonl`, el
bill lo trae como `ExpenseTypeID`), **una por documento**. No confundir con la
cuenta contable, que es por renglón: un restaurante es tipo 05 Representación
y a la vez 611.17 Dieta y Viáticos + 690.06 Propina Legal en sus líneas.

**La factura NO lleva cuenta de cabecera** (se retiró `cuenta_destino` el
2026-08-02): la clasificación es POR RENGLÓN, en `lineas[].cuenta`. Una misma
factura mezcla naturalezas —el consumo de un restaurante va a una cuenta y su
propina legal a otra, y un mueble comprado al proveedor de siempre va a activo—
así que una cuenta única para el documento entero sobraba y podía contradecir a
sus propios renglones. Las sugerencias de cargos bancarios sí llevan cuenta de
cabecera, en `cuenta_contable`: son un movimiento y una cuenta.

Desde 2026-08-02 la propuesta lleva además **`documento_adm`** (qué entidad se
creará: VendorBills | BillPayments | BankCharges | BankBankTransfers | Journals
— son CINCO; `BillPayments` es el pago a una factura ya registrada, prefijo `PP`
y módulo BANCO, no Compras) y
**`lineas[]`**, cuya forma depende del documento — imitando la pantalla real
de ADM (la web auto-detecta la forma por la presencia de `precio`/`cantidad`):

**Quién decide el valor de `documento_adm`, y cómo**: en las sugerencias lo fija
el script del carril (`sugerir-cargos.sh` → `BankCharges`, etc.); en una factura
lo elige el contable con el criterio de la sección «Qué documento de ADM es esto»
de `skills/mesa-de-trabajo/SKILL.md`, que decide por el ROL del hecho. **El NCF no
entra en esa decisión** — 45 de 1.109 facturas de proveedor históricas no lo
tienen y 51 de 159 cargos bancarios sí. No es una etiqueta: `poller.sh` elige con
qué script registrar según este campo.

- **VendorBills: líneas de ITEMS** — cada renglón del documento como
  `{descripcion, cantidad, precio, grupo_impuesto, itbis, cuenta, cuenta_nombre}`;
  `precio` sin ITBIS; TODO renglón que sume al total va como item (incluida la
  propina legal 10% de restaurantes, exenta) con su propia cuenta; la web
  valida `sum(precio*cantidad) + sum(itbis)` contra `monto` (umbral 0.05).
- **Journals | BankCharges | BankBankTransfers: partida doble** — cada línea
  `{cuenta, cuenta_nombre, descripcion, debito, credito}` con cuentas EXACTAS
  del plan, débitos = créditos (la web verifica el cuadre y lo marca), ITBIS
  aprovechable como línea propia.

La web las muestra como tabla estilo ADM y serán el payload del registro real
en la Entrega 2.

## qualia_eventos

El hilo del trabajo. La web lo muestra en vivo (Realtime).

| Columna | Qué es |
|---|---|
| `autor` | `contable`, `usuario`, `sistema` |
| `tipo` | `estado`, `progreso`, `pregunta`, `respuesta`, `nota` |
| `contenido` | texto legible |
| `datos` | jsonb opcional |

Regla clave: **toda acción del usuario en la web inserta un evento con
`autor=usuario`** (`respuesta` al contestar una pregunta; `nota` con el
aprobar/rechazar). El poller vigila esos eventos para despertar al contable;
sin evento, no hay despertar.

### El chat fantasma: los `progreso` mientras el contable trabaja

Los eventos `progreso` con `autor=contable` que caen entre el claim (fila en
`analizando`) y el cierre del turno son el contable **pensando en voz alta**.
No son parte de la respuesta: son la señal de que se está moviendo. Convención
para la web:

- **Mientras la fila está en `analizando`**, esos `progreso` se pintan como
  burbuja fantasma — atenuada, con indicador de "escribiendo…" — encima del
  hilo normal.
- **Cuando el turno cierra** (la fila sale de `analizando` hacia `propuesta`,
  `esperando_respuesta` o `error`), la burbuja se colapsa y queda solo la
  respuesta. Los `progreso` del turno quedan accesibles tras un "ver detalle";
  **las filas jamás se borran** — el hilo sigue siendo la historia completa.
- **Tranque visible**: si la fila sigue en `analizando` y el último evento del
  contable tiene más de ~10 minutos, la web lo marca como posible tranque en
  vez de seguir mostrando "escribiendo…".

La pieza web (burbuja, colapso, detector de tranque) vive en Labs_Inv
(`QualiaContaTab.jsx`). Del lado del contable, la cadencia la fija la skill:
un `progreso` corto por fase, nunca una fase larga en silencio.

## qualia_libro

Espejo consultable del libro de acción para la vista web. **El archivo en git
(`empresas/<empresa>/hermes/libro-de-accion/`) sigue siendo el canónico**; cada
entrada nueva del libro inserta también una fila acá (`entrada`, `metodo`,
`precedente_ref`, `aprobado_por_nombre`, `ref_git`).

## Piezas en cada repo

- **QualiaConta**: `skills/mesa-de-trabajo/` (cómo opera el contable),
  `mesa/poller.sh` (sidecar `mesa` en el compose de cada empresa), este doc.

- **Labs_Inv**: migraciones `20260802041946_qualia_conta_mesa_trabajo.sql` y
  `20260802042624_qualia_conta_grants_worker.sql`, tab `QualiaContaTab.jsx`,
  servicio `qualiaContaService.js`.


## Respaldo de documentos

Los archivos del bucket `qualia-conta` viven sólo en Storage: el pg_dump
nocturno de Supabase respalda las tablas, no el bucket. Por eso
`mesa/respaldo-documentos.sh` (cron de usuario en CodeBox, diario 03:00 UTC)
baja una copia local de cada documento a
`/home/codebox/qualia-docs/<empresa_id>/<trabajo_id>/<archivo_nombre>`,
usando la `archivo_url` firmada (~30 días) que la web mantiene fresca.
Idempotente (lo ya bajado no se re-baja), tolerante a URL vencida (cuenta el
fallo y sigue) y loggea resumen a `/home/codebox/qualia-docs/respaldo.log`
sin URLs (llevan token firmado). Ojo: no filtra por `archivo_path` sino por
nombre + URL presentes — hay filas con URL válida y path nulo que también
se respaldan.

## Escalar a varias empresas: el freno tiene que ser GLOBAL (diseño, sin implementar)

`MAX_ANALIZANDO` vive dentro del poller de CADA empresa, pero el recurso que
protege —la cuota y el límite de ritmo de z.AI— es UNO por cuenta: con 18
sesiones simultáneas z.AI devolvió 464 respuestas 429 (2026-08-03). Con una
empresa, tope local y global son lo mismo; con dos dejan de serlo, y cincuenta
facturas subidas a la vez en empresas distintas serían la misma estampida por
otra puerta.

Diseño acordado el 2026-08-07, para implementarse **cuando la segunda empresa
se conecte** — no antes:

- El semáforo vive en `qualia_servicio` (la fila por empresa ya existe y todos
  los pollers ya la escriben): cada poller publica su `en_vuelo` en cada tick
  y, antes de despertar al contable, suma los `en_vuelo` de las empresas que
  comparten la misma cuenta de modelo contra un tope global
  (`MESA_MAX_GLOBAL`). Sin coordinador y sin locks entre procesos: la base ya
  es el punto de encuentro, y un conteo optimista alcanza — pasarse por 1 en
  una carrera es inofensivo; la estampida que importa es de decenas.
- Empresa con llave de z.AI PROPIA (el `.env` por empresa ya lo permite) no
  entra en la suma: su tope es el local de siempre.
- La otra mitad del freno es por sesión: `agent.max_turns`
  (deploy/configurar-modelo.sh). El semáforo evita muchas sesiones a la vez;
  `max_turns` evita que UNA sesión se coma la ventana entera (pasó: 184
  llamadas ≈ 5M de entrada ≈ un tercio de la ventana de 5 h).

## Calibración por instancia (aprendida 2026-08-02, Blackbox)

Al levantar la mesa en una empresa nueva, además del compose y el .env:

1. **Habilitar terminal en la plataforma webhook** — viene DESHABILITADA de
   fábrica y sin ella el contable no puede usar psql (se traba intentando
   vision/clarify): `hermes tools enable --platform webhook terminal`.
2. **Deshabilitar clarify en webhook** — en ese canal nadie contesta; las
   preguntas van como eventos: `hermes tools disable --platform webhook clarify`.
3. **SOUL.md debe conocer el canal mesa**: que el webhook no es una persona
   (no preguntar nombres) y que escribir las tablas `qualia_*` NO viola el
   «sólo lectura en ADM Cloud».
4. El webhook tiene **caché de idempotencia**: dos POST con payload idéntico
   pueden colapsar en una sola activación. Para forzar una re-activación
   manual, variar el campo `motivo`.
5. Un `docker restart` a mitad de turno puede dejar una sesión webhook
   corrupta que, al recuperarse, manda un mensaje vacío al modelo y Z.AI
   devuelve 400 (código 1213). Es transitorio: la siguiente activación crea
   sesión limpia.
6. El cron `sugerir-cargos` se crea una vez por empresa:
   `hermes cron create "0 13 * * 1-5" --name sugerir-cargos --script sugerir-cargos.sh --no-agent --deliver telegram`
   (el script vive en `empresas/<empresa>/hermes/scripts/`).
