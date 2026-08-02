# Operación batch — one-shot con terminal y cron agente

Receta operativa para correr al contable **sin TTY**: turnos one-shot
(`hermes -z`) y jobs del scheduler en modo agente (`hermes cron create
--script`). Es la salida de la Fase 0 del plan de preentrenamiento (puntos 2
y 3): las dos cosas quedaron probadas contra el gateway real
(`qualiaconta-blackbox`, Hermes v0.19.0) el 2026-08-02.

Contexto del susto original: las sesiones tituladas "Bloqueo por falta de
terminal" del 2026-08-02 eran **sesiones webhook de la mesa** (`source:
webhook`, `user_id: webhook:mesa`), no one-shots del CLI. El CLI `-z` nace
con el toolset terminal habilitado; lo que se bloquea sin terminal es el
canal webhook, cuyos toolsets se configuran por plataforma (`hermes tools`,
interactivo, requiere TTY: `docker exec -it`). Son dos problemas distintos —
este doc cubre el carril CLI/cron, que es el que usa el preentrenamiento.

## One-shot con terminal (sin TTY)

La línea ganadora, completa:

```bash
docker exec qualiaconta-blackbox hermes -z "PROMPT" -t terminal --accept-hooks
```

- `-t terminal` — habilita el toolset de terminal explícitamente. En
  v0.19.0 el default del CLI ya lo trae habilitado (se probó sin `-t` y
  ejecutó igual), pero la flag se deja SIEMPRE: te protege de un cambio de
  config o de versión. Acepta lista separada por comas:
  `-t terminal,file,skills` (probado).
- `--accept-hooks` — auto-aprueba hooks de shell no vistos, que sin TTY se
  quedarían esperando un prompt interactivo.
- Prueba de ejecución real (no alucinada): se le pidió
  `cat /proc/sys/kernel/random/uuid | tee /tmp/proof.txt` y el UUID que
  reportó coincidió con el contenido real del archivo leído por fuera de la
  sesión. Verificá así cualquier duda de "¿ejecutó o inventó?": hacele
  escribir un valor impredecible a disco y leelo vos.

Flags que se suman para los batches del preentrenamiento (mismas semánticas):
`--usage-file PATH` (ver auditoría abajo), `-m glm-5.2` / `-m glm-5-turbo`,
`--skills consultar-admcloud`.

## Cron agente (script → stdout → prompt)

El modo agente del cron quedó estrenado con el piloto `piloto-agente`
(job `a226f4f77bca`, corrida `7c7ccf9e...` completed, 2026-08-02 14:04 UTC):
un script trivial imprimía "Di exactamente PILOTO-OK y nada mas." y el
agente respondió `PILOTO-OK`. Receta:

1. El script vive en `$HERMES_HOME/scripts/` (en el gateway:
   `/opt/data/scripts/`), ejecutable, `.sh` corre con bash, el resto con
   Python. Su **stdout es el material del turno**.
2. Crear el job — ojo: **el prompt base posicional es obligatorio** en modo
   agente con `--script` (sin él: "create requires either prompt or at least
   one skill"):

```bash
docker exec qualiaconta-blackbox hermes cron create "*/2 * * * *" \
  --name mi-job --script mi-script.sh --repeat 1 --deliver local \
  "Prompt base del turno."
```

3. Cómo arma el prompt el scheduler (verificado en la sesión del piloto): un
   preámbulo fijo de cron (la respuesta final se entrega sola; responder
   `[SILENT]` suprime la entrega), después el stdout del script en un bloque
   `## Script Output`, y **al final** el prompt base posicional. O sea: el
   stdout queda ARRIBA del prompt base — redactá el prompt base sabiendo que
   el contexto ya vino antes, no digas "debajo".
4. `--repeat N` finito siempre en batches; al agotar las corridas **el job
   se elimina solo** de `cron list` (no hace falta `cron rm`, y un `rm`
   posterior da "not found" — es normal).
5. El scheduler es el gateway (`hermes cron status` debe decir "Gateway is
   running" con heartbeat fresco). Para no esperar el minuto del schedule:
   `hermes cron run <job>` marca el job para el próximo tick y
   `hermes cron tick` corre lo vencido una vez y sale.
6. `cron create` no tiene `-t`: los toolsets del turno salen de la config
   default del CLI (terminal incluido, ver arriba). Sí acepta `--skill`
   (repetible), `--model`, `--workdir`.

## Auditar corridas y consumo

- `hermes cron runs` — intentos durables del scheduler, uno por corrida:
  `<run-id>  completed  job=<job-id>  source=builtin  <timestamp>`. Acepta
  `[job_id]` como filtro posicional y `--limit`.
- Cada corrida agente deja sesión `cron_<job-id>_<timestamp>` en el store.
  Para leer qué le llegó y qué respondió:

```bash
docker exec qualiaconta-blackbox hermes sessions export \
  --session-id cron_<job-id>_<ts> - > corrida.jsonl
```

  (el `-` manda el JSONL a stdout; sin `--session-id`, el posicional es el
  ARCHIVO de salida y exporta todo — trampa ya pisada).
- `--usage-file PATH` en `hermes -z` escribe al terminar un JSON con
  `input_tokens`, `output_tokens`, `cache_read_tokens`, `api_calls`,
  `model`, `provider`, `session_id`, `completed`/`failed`. Es la base del
  corte diario de presupuesto del plan (§4): el inyector suma los usage de
  la jornada y aborta la cadena si pasa el tope.
- Referencia de consumo medida: un one-shot trivial contra glm-5.2 costó
  ~10.5k input (10.4k de caché) / ~21 output en 2 llamadas.

## Higiene

- Jamás pongas secretos en el PROMPT ni en el stdout del script: la sesión
  queda persistida en el store y `sessions export` la vuelca entera.
- stdout del script = contexto del LLM. Sanitizá errores de la API de ADM
  ahí mismo (reflejan el GUID de company) antes de imprimir nada.
