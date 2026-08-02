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
- El poller no marca nada por sí mismo: todos los cambios de estado los hace
  el contable (o la web). Si el poller despierta dos veces por lo mismo, el
  claim atómico y la idempotencia de la skill lo absorben.

## qualia_trabajos

Una fila por documento arrastrado o sugerencia del contable.

| Columna | Quién la escribe | Qué es |
|---|---|---|
| `empresa_id` | web | UUID en `admcloud_empresas` |
| `tipo` | web/cron | `factura` (arrastrada) o `sugerencia` (detectada por el contable) |
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
| `esperando_respuesta → analizando` | contable, al llegar la respuesta |
| `propuesta → aprobada` / `rechazada` | usuario en la web. NUNCA el contable |
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
  "cuenta_destino": "6120-01 Combustibles",
  "metodo": "precedente",
  "precedente_ref": "libro-de-accion/2026-07-30-sunix-combustible.md",
  "confianza": 0.95,
  "detalle": "Gasoil flotilla. ITBIS no aprovechable (NG 07-2007 art. 3)."
}
```

`metodo`: `precedente` (aplicó una entrada del libro), `script` (lo resolvió un
script propio) o `razonado` (caso nuevo, razonado desde el núcleo DGII y la
memoria). `precedente_ref` sólo cuando `metodo != razonado`.

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
