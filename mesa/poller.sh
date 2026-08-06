#!/bin/bash
# Poller de la mesa de trabajo — SIN LLM.
#
# Vigila la cola qualia_* en la Supabase de Labs_Inv y despierta al contable
# (webhook local del gateway Hermes) solo cuando hay trabajo. No marca ningún
# estado por sí mismo: todos los cambios los hace el contable o la web.
#
# Despierta por cuatro señales:
#   1) trabajos en estado 'pendiente' (factura recién arrastrada)
#   2) eventos nuevos con autor='usuario' (rechazó / respondió; la APROBACIÓN no
#      lo despierta: la registra este mismo script — ver registrar_directo)
#   3) aprobadas que llevan rato sin llegar a ADM: red de seguridad para el
#      registro que murió a mitad — sin esto la fila queda huérfana para siempre
#   4) registradas sin entrada en el libro de acción (motivo escribir_libro)
#
# Y suelta las reservas muertas: 'analizando' congelado 20 min vuelve a
# 'pendiente'. La regla general detrás de los barridos: TODO estado que le
# pertenece al contable —pendiente, analizando, aprobada-sin-docid,
# registrada-sin-libro— necesita su red. Los que le pertenecen al humano
# —propuesta, esperando_respuesta— no se tocan nunca, y los terminales
# —rechazada, error— tampoco. Si algún día se agrega un estado del contable, hay
# que preguntarse quién lo rescata.
#
# Antes de avisar un trabajo nuevo corre el preparador determinista
# (mesa/preparar-trabajo.sh, montado en /mesa): baja el documento, extrae,
# verifica DGII y chequea duplicados sin LLM, y deja el dossier en
# /tmp/mesa/<id>/ para que el contable despierte con todo masticado. Si el
# prep falla, el aviso va igual y el contable completa con el protocolo viejo.
# El único estado que el prep puede marcar es 'error' por descarga imposible;
# el claim pendiente→analizando sigue siendo del contable.
#
# Y en la SALIDA hace lo simétrico: una aprobación se registra en ADM corriendo
# el script del tipo de documento, sin despertar al LLM (ver registrar_directo).
#
# Corre como sidecar en el compose de cada empresa (servicio 'mesa'), red de
# host, misma imagen qualiaconta:local (trae psql y curl).
#
# Env requerido: QUALIA_DSN, QUALIA_EMPRESA_ID
# Opcional: WEBHOOK_PORT (default 8644, el de platforms.webhook en config.yaml),
#           MESA_INTERVALO segundos (default 20)

set -u

: "${QUALIA_DSN:?falta QUALIA_DSN}"
: "${QUALIA_EMPRESA_ID:?falta QUALIA_EMPRESA_ID}"
PUERTO="${WEBHOOK_PORT:-8644}"
INTERVALO="${MESA_INTERVALO:-20}"
WEBHOOK="http://127.0.0.1:${PUERTO}/webhooks/mesa"
# Cuántos análisis puede tener el contable a la vez. Cada aviso abre una sesión
# LLM nueva en Hermes y del otro lado NO hay límite, así que el tope va acá.
# Medido el 2026-08-03: con 1 la factura sale en ~3 min; con 3 termina una y las
# otras dos se arrastran (8 min sin un solo evento); con 18 z.AI devolvió 464
# respuestas 429 y varios turnos murieron. Subilo si el plan aguanta más.
MAX_ANALIZANDO="${MESA_MAX_ANALIZANDO:-2}"

log() { echo "[mesa-poller] $(date -u +%H:%M:%S) $*"; }

corriendo=1
trap 'corriendo=0' TERM INT

sql() {
  # -q silencia notices; PGCONNECT_TIMEOUT corto + timeout DURO alrededor:
  # una conexión TCP colgada a mitad de query congelaba el loop entero con
  # el contenedor "Up" (hallazgo de auditoría 2026-08-02).
  timeout 30 env PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -t -A -q -c "$1" 2>/dev/null
}

# ------------------------------------------------------------------ cuota LLM
# Los 429 de z.AI son DOS cosas distintas y hay que tratarlas distinto:
#   1302 "Rate limit reached for requests" → límite de ritmo, se pasa en
#        minutos. El backoff del barrido alcanza.
#   1308 "Usage limit reached for 5 hour"  → CUOTA agotada. Dura horas y trae
#        la hora en que vuelve. Insistir contra esto es tirar turnos a la
#        basura y, peor, deja al humano sin saber por qué su factura no sube.
#
# El sondeo es un request de 1 token: durante el corte lo rechazan ANTES de
# inferir, así que no consume cuota. Solo se sondea cuando el barrido tiene algo
# que hacer, así que en régimen normal esto no genera tráfico.
#
# La hora del mensaje viene en UTC+8 (la zona de z.AI): decía "15:40:58" con el
# reloj del contenedor —UTC— en 05:49, y la ventana es de 5 horas, así que 15:40
# UTC sería imposible y +08 (07:40 UTC) es lo único que cierra. Es una
# DEDUCCIÓN, y por eso está el clamp: si el reset calculado cae a más de 6 horas
# se recorta a 5. Un error mío de zona horaria puede costar un aviso impreciso,
# nunca medio día con el barrido congelado.
CUOTA_TZ_OFFSET="${CUOTA_TZ_OFFSET:-+08}"
# Saldo de OpenRouter (USD) por debajo del cual se avisa. NO es cero a proposito
# —ver respaldo_saldo()—: el contable se apaga ANTES de llegar a cero.
RESPALDO_PISO="${RESPALDO_PISO:-1.00}"
# Qué tope disparó el bloqueo: 1308 = ventana de 5h, 1310 = semanal. Viaja
# pegado a la hora ("<ISO>|<codigo>") en vez de por variable global, porque el
# llamador usa $(cuota_bloqueada_hasta) y eso corre en un SUBSHELL: cualquier
# asignación de adentro se pierde al volver (verificado probándolo).
CUOTA_CODIGO=""

cuota_bloqueada_hasta() {
  # Imprime la hora UTC (ISO) hasta la que la cuota está agotada, o nada si
  # está libre / no se pudo determinar. Nunca falla al llamador.
  [ -n "${GLM_API_KEY:-}" ] || return 0
  local resp
  resp=$(curl -s -m 20 -X POST "https://api.z.ai/api/coding/paas/v4/chat/completions" \
    -H "Authorization: Bearer $GLM_API_KEY" -H 'Content-Type: application/json' \
    -d '{"model":"glm-4.6v","max_tokens":1,"messages":[{"role":"user","content":"."}]}' 2>/dev/null)
  # Son DOS topes distintos y hay que separarlos, porque duran ordenes de
  # magnitud diferentes:
  #   1308 "Usage limit reached for 5 hour"  -> la ventana de 5h del plan.
  #   1310 "Weekly/Monthly Limit Exhausted"  -> el tope SEMANAL. Dura DIAS.
  # Hasta el 2026-08-03 acá sólo se miraba el 1308, así que el semanal caía al
  # *) y se leía como "libre": qualia_servicio quedaba en NULL, la web no
  # pintaba el banner y el aviso de WhatsApp no salía. Un corte de 66 horas pasó
  # entero sin que nadie se enterara, quemando saldo del respaldo de OpenRouter.
  case "$resp" in
    *'"code":"1308"'*) CUOTA_CODIGO=1308 ;;
    *'"code":"1310"'*) CUOTA_CODIGO=1310 ;;
    *) return 0 ;;   # otro error, o está libre: no nos toca
  esac
  local crudo
  crudo=$(printf '%s' "$resp" | grep -oE 'reset at [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}' \
          | head -1 | sed 's/^reset at //')
  local hasta
  if [ -n "$crudo" ]; then
    hasta=$(date -u -d "${crudo}${CUOTA_TZ_OFFSET}" +%s 2>/dev/null)
  fi
  # El clamp va POR CODIGO, porque la ventana real es de otro tamaño. Con el
  # tope de 6h parejo, un 1310 legítimo a tres días quedaba recortado a cinco
  # horas y la web decía "vuelve en un rato" sobre un corte de tres días.
  local ahora tope conjetura
  ahora=$(date +%s)
  if [ "${CUOTA_CODIGO}" = "1310" ]; then
    tope=$(( ahora + 691200 ))      # 8 días: una semana con margen
    conjetura=$(( ahora + 86400 ))  # sin hora legible: volver a preguntar mañana
  else
    tope=$(( ahora + 21600 ))       # 6 horas
    conjetura=$(( ahora + 18000 ))  # 5h es el largo real de la ventana del plan
  fi
  # Pasarse de largo no congela nada: el sondeo de los 300s levanta el bloqueo
  # apenas z.AI vuelva a contestar, diga lo que diga la hora que anunció.
  if [ -z "${hasta:-}" ] || (( hasta <= ahora )) || (( hasta > tope )); then
    hasta=$conjetura
  fi
  printf '%s|%s\n' "$(date -u -d "@$hasta" +%Y-%m-%dT%H:%M:%SZ)" "$CUOTA_CODIGO"
}

cuota_libre() {
  # Devuelve 0 SÓLO si z.AI contestó de verdad. Exige ver "choices" en la
  # respuesta y no se conforma con "no vino el 1308": un curl que falla por red
  # también devuelve vacío, y confundir "no pude preguntar" con "ya volvió"
  # dispararía un aviso falso de recuperación.
  [ -n "${GLM_API_KEY:-}" ] || return 1
  local resp
  resp=$(curl -s -m 20 -X POST "https://api.z.ai/api/coding/paas/v4/chat/completions" \
    -H "Authorization: Bearer $GLM_API_KEY" -H 'Content-Type: application/json' \
    -d '{"model":"glm-4.6v","max_tokens":1,"messages":[{"role":"user","content":"."}]}' 2>/dev/null)
  case "$resp" in
    *'"choices"'*) return 0 ;;
    *) return 1 ;;
  esac
}

respaldo_saldo() {
  # Imprime lo que queda en OpenRouter, en USD. Nada si no se pudo averiguar.
  #
  # `GET /credits` no infiere: no gasta un token ni cuenta como request de
  # inferencia, asi que se puede preguntar seguido sin costo. Por eso se
  # consulta el saldo en vez de sondear con una llamada real.
  #
  # Y por que un PISO y no "cero": el 402 de OpenRouter no dice "no hay plata",
  # dice "no hay plata para la RESERVA que pediste". El 2026-08-03 a las
  # 23:29:40Z fue literal — «You requested up to 65536 tokens, but can only
  # afford 8090» — y el turno murio con "Non-retryable client error. Aborting.".
  # O sea que el contable se apago CON saldo en la cuenta. Avisar recien en cero
  # llegaria tarde.
  [ -n "${OPENROUTER_API_KEY:-}" ] || return 0
  curl -s -m 15 https://openrouter.ai/api/v1/credits \
    -H "Authorization: Bearer $OPENROUTER_API_KEY" 2>/dev/null \
  | python3 -c 'import sys, json
try:
    d = json.load(sys.stdin)["data"]
    print("%.2f" % (float(d["total_credits"]) - float(d["total_usage"])))
except Exception:
    pass' 2>/dev/null
}

registrar_respaldo() {
  # $1 = saldo en USD, o vacio si no se pudo medir.
  #
  # El saldo como NUMERO, que es lo que la web necesita para decidir un color.
  # Vacio se escribe como NULL a proposito: "no pude preguntar" no es "no hay
  # plata", y si se guardara cero la web pintaria el rojo de contable-muerto
  # sobre un contable sano cada vez que a OpenRouter se le cae la API.
  #
  # Toca SOLO las dos columnas del respaldo. No pisa cuota_bloqueada_hasta ni
  # cuota_detalle porque esto corre cada 10 minutos pase lo que pase, incluso
  # con z.AI sana: si el upsert las incluyera, cada medicion borraria un tope
  # que registrar_cuota acaba de anotar.
  local valor="null"
  [ -n "${1:-}" ] && valor="$1"
  sql "insert into qualia_servicio (empresa_id, respaldo_saldo_usd, respaldo_medido_en, actualizado_en)
       values ('${QUALIA_EMPRESA_ID}', ${valor}, now(), now())
       on conflict (empresa_id) do update
         set respaldo_saldo_usd = excluded.respaldo_saldo_usd,
             respaldo_medido_en = now(),
             actualizado_en = now()" > /dev/null
}

registrar_respaldo_bajo() {
  # $1 = saldo restante (USD), $2 = hora ISO hasta la que z.AI sigue topada.
  #
  # Escribe la MISMA fila que registrar_cuota porque para el humano es un solo
  # hecho: "el contable se va a quedar sin motor". La web pinta cuota_detalle y
  # mesa/alerta-cuota.sh ya se cuelga de esa fila, asi que el aviso por WhatsApp
  # sale sin tocar nada mas.
  local det="z.AI topada hasta $2 y al respaldo de OpenRouter le quedan US\$$1 — cuando se acabe, el contable se apaga"
  sql "insert into qualia_servicio (empresa_id, cuota_bloqueada_hasta, cuota_detalle, actualizado_en)
       values ('${QUALIA_EMPRESA_ID}', '$2', '${det}', now())
       on conflict (empresa_id) do update
         set cuota_bloqueada_hasta = excluded.cuota_bloqueada_hasta,
             cuota_detalle = excluded.cuota_detalle,
             actualizado_en = now()" > /dev/null
}

registrar_cuota() {
  # $1 = hora UTC ISO o vacío para liberar. $2 = código del tope (1308/1310).
  # Upsert de la fila de la empresa.
  local valor="null" detalle="null"
  if [ -n "${1:-}" ]; then
    valor="'$1'"
    local qtope="de 5 horas"
    [ "${2:-}" = "1310" ] && qtope="semanal"
    detalle="'cuota del LLM agotada (z.AI ${2:-?}, tope ${qtope}); vuelve $1'"
  fi
  sql "insert into qualia_servicio (empresa_id, cuota_bloqueada_hasta, cuota_detalle, actualizado_en)
       values ('${QUALIA_EMPRESA_ID}', ${valor}, ${detalle}, now())
       on conflict (empresa_id) do update
         set cuota_bloqueada_hasta = excluded.cuota_bloqueada_hasta,
             cuota_detalle = excluded.cuota_detalle,
             actualizado_en = now()" > /dev/null
}

poke() {
  # $1 = trabajo_id, $2 = motivo, $3 = sello opcional. Devuelve el rc REAL del
  # curl: el llamador decide qué hacer con un gateway caído (los eventos de
  # usuario NO pueden perderse — ver el loop de accion_usuario).
  #
  # El sello existe por la caché de idempotencia del webhook: dos POST con
  # payload IDÉNTICO colapsan en uno solo. Un re-aviso del mismo trabajo con el
  # mismo motivo se perdería en silencio, que es justo lo contrario de lo que un
  # reintento tiene que hacer. Variando el payload el aviso siempre entra.
  local cuerpo="{\"trabajo_id\":\"$1\",\"motivo\":\"$2\"}"
  [ -n "${3:-}" ] && cuerpo="{\"trabajo_id\":\"$1\",\"motivo\":\"$2\",\"intento\":\"$3\"}"
  if curl -s -m 15 -X POST "$WEBHOOK" \
    -H 'Content-Type: application/json' \
    -d "$cuerpo" > /dev/null 2>&1; then
    log "desperté al contable: $2 $1"
    return 0
  fi
  log "no pude tocar el webhook ($2 $1) — ¿gateway abajo?"
  return 1
}

# ------------------------------------------------------- registro determinista
# Registrar en ADM lo YA aprobado no necesita al contable. La propuesta está
# fija —el humano la aprobó tal cual— y hay un script por tipo de documento que
# hace el trabajo entero: arma el payload, chequea duplicado, hace el POST, lee
# de vuelta el DocID, sube el adjunto, lo guarda en la fila y la cierra en
# 'registrada'.
#
# Hasta el 2026-08-04 el poller despertaba al LLM para que corriera ESE script:
# el modelo leía la SKILL entera y decidía ejecutar un comando que siempre es el
# mismo. De los 120 registros de las 6 h previas, 64 eran sugerencias nacidas de
# un cron --no-agent (cero tokens) que sólo pagaban al modelo de mensajero entre
# dos programas — y encima durante el tope semanal de z.AI, o sea por OpenRouter,
# que se cobra por token.
#
# Lo que se gana no es sólo el ahorro: el registro deja de depender de que el
# modelo esté vivo y con cupo. Lo que sigue siendo del contable es el libro de
# acción —texto redactado que va a git—, y para eso se lo despierta DESPUÉS, con
# el documento ya en ADM.
#
# Sólo se automatiza lo que FALLA CERRADO. La condición para que un tipo entre
# acá no es que exista el script: es que el script se niegue a registrar cuando
# no puede PROBAR que el documento es suyo.
#   - VendorBills: el NCF es único por emisor y ADM además frena el duplicado.
#   - BankCharges: manda Reference=banco_tx_id y, si hay un cargo gemelo que
#     ningún trabajo reclama, muere con AMBIGUO en vez de adoptarlo.
#   - BankBankTransfers queda AFUERA a propósito (2026-08-04): su script todavía
#     adopta el gemelo —misma fecha, monto y cuentas → «YA REGISTRADO: guardo y
#     cierro»—, que es el error exacto que duplicó el CB00000169 en cargos. Dos
#     traslados iguales el mismo día entre las mismas dos cuentas son normales,
#     así que adoptar a ciegas deja uno sin registrar y el DocID en dos filas.
#     Sin humano mirando eso se multiplica: hasta que tenga la barrera de los
#     cargos, la registra el contable como hasta ahora.
script_de_registro() {
  case "${1:-}" in
    VendorBills)       echo "registrar-en-adm.py" ;;
    BankCharges)       echo "registrar-cargo-bancario.py" ;;
    # El script existia desde el 2026-08-03 —lo uso el contable para TE00000212
    # y TE00000214— y nunca se engancho: el registro-sin-LLM se construyo antes
    # de que se commiteara. Cada transferencia aprobada despertaba al modelo
    # para nada.
    BankBankTransfers) echo "registrar-transferencia-bancaria.py" ;;
    # El pago de una factura de proveedor con la tarjeta. Lo pide la caja
    # «Pagos con tarjeta de credito detectados» de la mesa, que ya trae la
    # factura elegida por un humano: aca no hay nada que analizar.
    BillPayments)      echo "registrar-pago-factura.py" ;;
    # Journals sigue SIN script y es a proposito: un asiento contable no tiene
    # forma fija y ahi el juicio hace falta. Preferimos el camino caro al
    # camino equivocado.
    *)                 return 1 ;;
  esac
}

registrar_directo() {
  # $1 = trabajo_id. Lanza el registro en BACKGROUND y vuelve enseguida: una
  # factura con adjunto tarda decenas de segundos y el loop no puede esperarla
  # (los pokes de las otras acciones del usuario quedarían atrás).
  local id="$1" doc script
  doc=$(sql "select propuesta->>'documento_adm' from qualia_trabajos where id='${id}' and empresa_id='${QUALIA_EMPRESA_ID}'")
  if ! script=$(script_de_registro "$doc"); then
    # Tipo sin script propio (Journals, o algo que se agregue mañana): lo hace
    # el contable, exactamente como antes. Preferimos el camino caro al
    # camino equivocado.
    log "sin script para documento_adm='${doc:-vacío}': $id — que lo registre el contable"
    poke "$id" "registro_pendiente" "$(date +%s)"
    return 0
  fi
  (
    # Lock por trabajo. El barrido de la red de seguridad puede volver a ver la
    # fila mientras este registro todavía corre, y dos POST simultáneos crearían
    # el documento DOS veces en ADM: los BankCharges no tienen la barrera de
    # duplicados que sí tienen las facturas por NCF y por referencia. El segundo
    # que llega se va sin hacer nada (flock -n) y el barrido lo reintenta luego.
    exec 9>"/tmp/mesa/.reg-${id}.lock" 2>/dev/null || exit 0
    flock -n 9 || exit 0

    # Turno para escribirle a ADM. El lock de arriba es por TRABAJO y no alcanza:
    # dos trabajos distintos tienen locks distintos, salen juntos, y ADM le da a
    # los dos el MISMO correlativo — el que pierde muere con «Ya existe una
    # transacción con el número CB00000225». Pasó el 2026-08-05 aprobando dos
    # cargos de un tirón: uno entró y el otro se quedó 10 minutos esperando al
    # barrido. ADM asigna el número al GUARDAR, asi que no hay forma de pedirlo
    # antes ni de reservarlo: la única defensa es no pisarse.
    #
    # Es por EMPRESA porque el correlativo lo es, y se ESPERA en vez de
    # abandonar: al de atrás no le sobra nada, sólo le toca después. La espera
    # cubre un registro entero (300s) con margen; si ni asi consigue turno, sale
    # y queda para el barrido, que es exactamente lo que hacía antes.
    exec 8>"/tmp/mesa/.registro-adm.lock" 2>/dev/null || exit 0
    if ! flock -w 330 8; then
      log "sin turno para ADM tras 330s: $id — queda para el barrido"
      exit 0
    fi

    t0=$(date +%s)
    # 300s: el camino largo es factura + adjunto (el paginado del duplicado son
    # ~3s, el POST y el readback otros pocos, la subida ~6s), con margen de
    # sobra para un ADM lento. -k 10 = KILL de respaldo si el TERM no alcanza.
    salida=$(timeout -k 10 300 python3 "/memoria-scripts/${script}" --trabajo "$id" 2>&1)
    rc=$?

    # El choque de correlativo se reintenta UNA vez, y sólo ése. Con el turno de
    # arriba ya no puede venir de nosotros, pero el contable registra por su
    # cuenta y no pide turno, y ADM tampoco es sólo nuestro. Reintentar acá es
    # seguro porque el script relee ADM antes de crear: si el documento ya
    # existe con la referencia de este movimiento muere con YA REGISTRADO, y si
    # hay gemelos que no puede distinguir muere con AMBIGUO. Sin esa barrera
    # esto duplicaría documentos en vez de salvarlos.
    if [ "$rc" -ne 0 ] && printf '%s' "$salida" | grep -qi 'ya existe una transacci.n con el n.mero'; then
      log "ADM le dio el correlativo a otro documento: $id — reintento en 5s"
      sleep 5
      salida=$(timeout -k 10 300 python3 "/memoria-scripts/${script}" --trabajo "$id" 2>&1)
      rc=$?
    fi

    dur=$(( $(date +%s) - t0 ))
    if [ "$rc" -eq 0 ]; then
      log "registrado sin LLM en ${dur}s: $id — $(printf '%s' "$salida" | grep -m1 -E '^REGISTRAD' || echo 'sin línea de resumen')"
      poke "$id" "escribir_libro"
    else
      # El motivo vive en la ÚLTIMA línea de stderr: los scripts mueren con un
      # mensaje escrito para leerse (proveedor sin RNC, cuenta inexistente, ya
      # registrada). Se lo pasamos al contable, que decide si es un dato que
      # falta o algo que arreglar — es el mismo camino de siempre.
      log "registro directo falló (rc=$rc, ${dur}s): $id — $(printf '%s' "$salida" | tail -1)"
      poke "$id" "registro_pendiente" "$(date +%s)"
    fi
  ) &
}

# Watermark de eventos de usuario: arranca en el máximo actual para no
# re-atender el histórico tras un reinicio del poller. El claim atómico y la
# idempotencia de la skill cubren cualquier doble aviso.
wm=""
while [ -z "$wm" ] && [ "$corriendo" -eq 1 ]; do
  wm=$(sql "select coalesce(max(id),0) from qualia_eventos")
  [ -z "$wm" ] && { log "base inalcanzable al arrancar; reintento en 30s"; sleep 30; }
done
log "arrancó (empresa=$QUALIA_EMPRESA_ID, webhook=$WEBHOOK, watermark=$wm)"

# Anti doble-aviso de pendientes: id → epoch del último aviso (re-avisa a los 5 min
# si sigue pendiente, por si el gateway estaba caído la primera vez)
declare -A avisado

# Cuota del LLM: epoch hasta el que está agotada (0 = libre) y epoch del último
# aviso al log, para no repetirlo en cada tick de 20s. Se pierden al reiniciar
# a propósito: el sondeo las vuelve a averiguar, y la fila de qualia_servicio
# guarda una HORA (no un booleano), así que una que quedó vieja se lee como
# libre sola, sin que nadie tenga que limpiarla.
cuota_avisado=0
cuota_sondeo=0    # epoch del último sondeo, para no preguntar en cada tick
respaldo_medido=0 # epoch de la última medición del saldo del respaldo
respaldo_ultimo=""  # último saldo medido (USD); vacío = no se pudo averiguar

# Se arranca con lo que diga la base, no en cero. Arrancar en cero dejaba
# huérfana una fila con hora FUTURA: nadie la volvía a mirar y la web y el aviso
# de WhatsApp seguían diciendo "topado" hasta esa hora aunque z.AI respondiera
# normal (visto el 2026-08-03). Cargándola acá, el reloj o el re-sondeo de abajo
# la resuelven como a cualquier otra.
cuota_hasta=$(sql "select coalesce(extract(epoch from cuota_bloqueada_hasta)::bigint, 0) from qualia_servicio where empresa_id='${QUALIA_EMPRESA_ID}'")
case "${cuota_hasta:-}" in ''|*[!0-9]*) cuota_hasta=0 ;; esac
(( cuota_hasta > 0 )) && log "arranco con un bloqueo anotado hasta $(date -u -d "@$cuota_hasta" +%H:%M)Z; lo verifico"

# id → epoch del último poke de trabajo_nuevo. Sirve para contar los que ya
# despertamos pero todavía no reclamaron: el claim tarda unos segundos y sin
# contarlos el tope se pasaría de largo en el tick siguiente.
declare -A despertado
cupo_avisado=0

while [ "$corriendo" -eq 1 ]; do
  # Latido para el healthcheck del compose: si este archivo envejece, el
  # loop está congelado y Docker lo marca unhealthy (y el restart lo revive).
  date +%s > /tmp/latido 2>/dev/null

  # 0) COMPUERTA DE CUOTA.
  #
  # Va acá arriba y no dentro de un barrido porque la cuota frena al contable
  # ENTERO: el análisis de lo nuevo Y el registro de lo aprobado. La primera
  # versión sondeaba dentro del barrido de aprobadas y solo si ese barrido tenía
  # candidatos — así que el 2026-08-03, con la cuota agotada y todo el trabajo
  # del lado del análisis, no sondeó nunca y la web no avisó nada. Peor: el
  # poller seguía despertando al contable por cada documento nuevo y cada turno
  # moría contra el 429.
  #
  # La condición correcta no es "hay aprobadas sin registrar", es «el contable
  # DEBE trabajo y no lo entrega», sin importar en qué estado esté ese trabajo.
  ahora=$(date +%s)
  if (( cuota_hasta <= ahora )) && (( ahora - cuota_sondeo > 120 )); then
    # Sin umbral de antigüedad para pendiente/analizando: la gracia del aviso es
    # enterarte AL SUBIR, no cinco minutos después de que se trabó. El costo de
    # sondear de más es 1 token cada 2 minutos y solo mientras hay cola; con la
    # mesa vacía no se pregunta nada, porque no habría nada que explicar.
    estancado=$(sql "select count(*) from qualia_trabajos where empresa_id='${QUALIA_EMPRESA_ID}' and (estado in ('pendiente','analizando') or (estado='aprobada' and propuesta->'registro_adm'->>'docid' is null and updated_at < now() - interval '10 minutes'))")
    if [ -n "${estancado:-}" ] && (( estancado > 0 )); then
      cuota_sondeo=$ahora
      if par=$(cuota_bloqueada_hasta) && [ -n "$par" ]; then
        hasta="${par%%|*}"; codigo="${par##*|}"
        cuota_hasta=$(date -u -d "$hasta" +%s 2>/dev/null || echo 0)
        cuota_avisado=$ahora
        registrar_cuota "$hasta" "$codigo"
        log "cuota de z.AI agotada (tope $codigo) hasta $hasta — $estancado en cola, siguen por el respaldo"
      fi
    fi
  fi
  # Se sale del bloqueo por RELOJ...
  if (( cuota_hasta > 0 )) && (( cuota_hasta <= ahora )); then
    cuota_hasta=0
    registrar_cuota ""
    log "cuota de z.AI disponible otra vez (por reloj)"
  fi

  # ...pero también ANTES de la hora, re-sondeando. La hora que anuncia z.AI no
  # es confiable en el borde de la ventana: el 2026-08-03 el poller sondeó un
  # segundo después de que la ventana venció, agarró el 1308 viejo y se guardó
  # la hora de la ventana SIGUIENTE — cinco horas creyéndose topado con z.AI
  # respondiendo normal. Antes eso congelaba la cola; ahora sólo haría mentir a
  # la web y al aviso de WhatsApp, que es igual de malo porque son lo que se
  # mira para decidir. El sondeo cuesta 1 token cada 5 minutos y sólo mientras
  # dura el bloqueo.
  if (( cuota_hasta > ahora )) && (( ahora - cuota_sondeo > 300 )); then
    cuota_sondeo=$ahora
    if cuota_libre; then
      cuota_hasta=0
      registrar_cuota ""
      log "z.AI volvió antes de la hora que había anunciado — levanto el bloqueo"
    fi
  fi
  # El tope de z.AI ya NO frena la cola. Hasta el 2026-08-03 sí la frenaba, y
  # estaba bien: sin un segundo proveedor, despertar al contable durante el tope
  # era regalarle un turno que moría contra el 429. Desde que la cadena termina
  # en OpenRouter —saldo aparte— el contable sigue produciendo, así que congelar
  # la cola dejó de proteger nada y sólo retrasaba facturas medio día.
  #
  # El tope se sigue DETECTANDO y registrando en qualia_servicio: la web lo
  # muestra y el aviso de WhatsApp (mesa/alerta-cuota.sh) se cuelga de esa fila.
  # Lo único que cambia mientras dura es de dónde sale la inferencia, y eso
  # cuesta por token — de ahí el aviso. El tope de MAX_ANALIZANDO sigue igual,
  # que es lo que de verdad evita la estampida de sesiones.
  #
  # Y con z.AI topada, lo unico que sostiene al contable es el respaldo. Si ESE
  # se queda corto el sistema se apaga entero, y hasta hoy lo hacia EN SILENCIO:
  # el 2026-08-03 a las 23:29:40Z OpenRouter devolvio 402 y el turno murio con
  # "Non-retryable client error. Aborting.". Fueron 23 minutos con 17 cargos
  # aprobados esperando, la web diciendo que todo iba bien, y se descubrio de
  # casualidad al dia siguiente. Preguntar el saldo es gratis; no preguntarlo
  # costo eso.
  # El saldo se mide SIEMPRE, no solo durante un tope. Antes esta medicion vivia
  # dentro del if de abajo, asi que con z.AI sana la web no tenia ningun numero:
  # el respaldo podia estar en cero durante dias y solo se descubria en el peor
  # momento — al topar z.AI, que es justo cuando ya no hay margen para recargar.
  # Preguntar es gratis (GET /credits no infiere ni gasta un token), asi que el
  # unico motivo para no hacerlo era que el dato no tenia donde vivir.
  if (( ahora - respaldo_medido > 600 )); then
    respaldo_medido=$ahora
    respaldo_ultimo=$(respaldo_saldo)
    registrar_respaldo "${respaldo_ultimo:-}"
  fi

  if (( cuota_hasta > ahora )) && (( ahora - cuota_avisado > 600 )); then
    cuota_avisado=$ahora
    # El saldo que acaba de medir el bloque de arriba: los dos ciclos son de 600s
    # y ese corre primero en el mismo tick. Volver a llamar a respaldo_saldo()
    # aca seria un segundo GET para preguntar lo mismo.
    saldo="${respaldo_ultimo:-}"
    hasta_iso=$(date -u -d "@$cuota_hasta" +%Y-%m-%dT%H:%M:%SZ)
    if [ -n "${saldo:-}" ] && awk "BEGIN{exit !($saldo <= $RESPALDO_PISO)}" 2>/dev/null; then
      registrar_respaldo_bajo "$saldo" "$hasta_iso"
      log "OJO: z.AI topada y al respaldo le quedan US\$$saldo — cuando se acabe, el contable se apaga"
    else
      log "cuota de z.AI agotada hasta $(date -u -d "@$cuota_hasta" +%H:%M)Z — sigo por el respaldo (quedan US\$${saldo:-?})"
    fi
  fi

  # 1) trabajos nuevos
  #
  # CONTRAPRESIÓN antes de avisar. Cada aviso abre una sesión LLM en Hermes y
  # del otro lado no hay tope: subiendo varios documentos seguidos terminabas
  # con media docena de sesiones compitiendo por la misma API con límite de
  # ritmo. Se frenaban entre ellas y algunas morían con 429. Los barridos de
  # abajo rescatan lo que se cayó, pero no evitan la caída — esto sí.
  #
  # Lo que no entra en el cupo se queda en 'pendiente', que es exactamente donde
  # el re-aviso de los 300s lo vuelve a tomar. Se pierde velocidad de pico y se
  # gana que TODAS salgan: antes las primeras salían rápido y el resto se
  # arrastraba o se caía.
  enVuelo=$(sql "select count(*) from qualia_trabajos where empresa_id='${QUALIA_EMPRESA_ID}' and estado='analizando'")
  [ -z "${enVuelo:-}" ] && enVuelo=0
  for t in "${despertado[@]}"; do (( ahora - t < 120 )) && enVuelo=$((enVuelo + 1)); done
  cupo=$(( MAX_ANALIZANDO - enVuelo ))
  if (( cupo <= 0 )) && (( ahora - cupo_avisado > 300 )); then
    cupo_avisado=$ahora
    log "contable al tope ($enVuelo en vuelo, máx $MAX_ANALIZANDO): los nuevos esperan turno"
  fi

  # La clave del anti-spam incluye updated_at: si el trabajo VUELVE a pendiente
  # (tras un error, o porque el humano pidió otra revisión) es una petición
  # nueva y se avisa al instante. El tope de 300s queda solo para el caso
  # "sigue pendiente y el gateway estaba caído cuando avisé".
  while IFS='|' read -r id upd; do
    [ -z "$id" ] && continue
    (( cupo <= 0 )) && continue    # sin cupo: queda pendiente, lo toma el re-aviso
    ahora=$(date +%s)
    clave="${id}:${upd}"
    antes=${avisado[$clave]:-0}
    if (( ahora - antes > 300 )); then
      cupo=$((cupo - 1))
      despertado[$id]=$ahora
      # Preparador ANTES del aviso, EN BACKGROUND: si corriera en el loop, un
      # documento terco (hasta 120s) frenaría los pokes de las aprobaciones del
      # usuario. El anti-spam se marca ANTES de lanzar, así el mismo trabajo no
      # se lanza dos veces; si el prep muere o el gateway estaba caído, el
      # re-aviso de los 300s lo repite (el prep es idempotente y barato la
      # segunda vez). Fallar no frena: el poke va igual y el contable completa
      # con el protocolo viejo.
      avisado[$clave]=$ahora
      (
        t0=$(date +%s)
        # 180s: la suma de topes internos del camino foto (descarga + visión
        # + timbre) supera los 120 originales; -k 10 = KILL de respaldo si el
        # TERM no alcanza (el prep atrapa TERM para el chown de entrega).
        timeout -k 10 180 bash /mesa/preparar-trabajo.sh "$id"
        rc=$?
        dur=$(( $(date +%s) - t0 ))
        if [ "$rc" -eq 0 ]; then
          log "prep listo: $id (${dur}s)"
        else
          log "prep falló rc=$rc: $id (${dur}s) — aviso igual"
        fi
        poke "$id" "trabajo_nuevo"
      ) &
    fi
    # Una fila con una acción del usuario todavía sin atender NO es trabajo
    # nuevo: es el bloque 2 el que la despierta, con el motivo `accion_usuario`,
    # que es el único que hace leer el hilo. Sin esta exclusión salían los DOS
    # avisos con dos segundos de diferencia y corrían dos turnos en paralelo
    # sobre la misma fila, ciegos entre sí. El 2026-08-05 con la liquidación de
    # la DGA (fb0c5c71) se vio entero: el usuario corrigió a las 23:43:29, el
    # turno que leyó la corrección la acató a las 23:44:54 —«te lo propongo como
    # VendorBills»— y el turno gemelo la pisó a las 23:45:09 volviendo a «cargo
    # bancario», arrancando de cero con el dossier anterior a la corrección
    # («mismo documento sha 8d2d7885ffd3; reuso el dossier, no re-leo»). No fue
    # que el contable se olvidara: eran dos.
    #
    # Se compara contra el MISMO watermark del bloque 2, así que la exclusión
    # dura exactamente hasta que ese evento se entregó. Si el aviso falla, el
    # watermark no avanza y la fila queda excluida un tick más — que es lo
    # correcto: el reintento le toca al bloque 2, que sí sabe qué evento debe.
    #
    # `forzar_relectura` es la excepción y sigue por acá a propósito: pedir que
    # vuelva a MIRAR el documento es lo único que necesita al preparador, y el
    # preparador sólo corre en este bloque.
  done < <(sql "select id, extract(epoch from updated_at)::bigint from qualia_trabajos t where empresa_id='${QUALIA_EMPRESA_ID}' and estado='pendiente' and not exists (select 1 from qualia_eventos e where e.trabajo_id = t.id and e.autor='usuario' and e.id > ${wm} and coalesce((e.datos->>'forzar_relectura')::boolean, false) = false) order by created_at limit 3")

  # 2) acciones del usuario en la web. El watermark SOLO avanza si el aviso
  # llegó: un rechazo con el gateway caído se reintenta el próximo tick en vez
  # de perderse para siempre (antes wm avanzaba incondicional y el evento se
  # consumía sin entregarse).
  #
  # La APROBACIÓN se bifurca: no despierta a nadie, la registra este script. El
  # estado se lee acá y no se deduce del evento porque el evento no dice en qué
  # quedó la fila — el que manda es el estado, como en todo el resto de la mesa.
  # Si por una carrera todavía no dice 'aprobada', el poke normal la manda por
  # el camino de siempre: degradar al camino viejo es correcto, saltearla no.
  while IFS='|' read -r eid tid tipo estado docid; do
    [ -z "${eid:-}" ] && continue
    # Un criterio NO se registra en ADM: no es un documento, es una regla. Sin
    # este corte, `registrar_directo` lee su `documento_adm` vacío, cae al `*)`
    # de `script_de_registro` y lo despierta con motivo `registro_pendiente` —
    # que es justo la rama que le ordena registrarlo en ADM. Y como la red de
    # seguridad del bloque 3 lo vuelve a ver cada 10 minutos hasta las 12 horas,
    # serían ~20 sesiones de LLM por criterio ratificado, con `error` como final
    # probable: rojo en «Te toca» sobre una regla recién aprobada.
    if [ "$tipo" = "criterio" ]; then
      if poke "$tid" "accion_usuario"; then wm=$eid; else break; fi
      continue
    fi
    if [ "$estado" = "aprobada" ] && [ -z "$docid" ]; then
      registrar_directo "$tid"
      wm=$eid
      continue
    fi
    if poke "$tid" "accion_usuario"; then
      wm=$eid
    else
      break
    fi
  done < <(sql "select e.id, e.trabajo_id, t.tipo, t.estado, coalesce(t.propuesta->'registro_adm'->>'docid','') from qualia_eventos e join qualia_trabajos t on t.id = e.trabajo_id where t.empresa_id='${QUALIA_EMPRESA_ID}' and e.autor='usuario' and e.id > ${wm} order by e.id limit 10")

  # 2b) reservas muertas: 'analizando' que no se movió en 20 minutos.
  #
  # El contable reclama la fila (pendiente→analizando) y ahí queda marcada como
  # suya. Si su turno muere después del claim, la fila sale del alcance del
  # bloque 1 —que solo mira 'pendiente'— y ya nadie la toca: es el MISMO agujero
  # que el bloque 3 tapa un estado más adelante. Pasó el 2026-08-03 por la tarde
  # con tres facturas, cuando 464 respuestas 429 (código 1302, límite de ritmo)
  # mataron varios turnos a mitad del análisis.
  #
  # Acá el poller SÍ escribe estado, y es la segunda excepción explícita a su
  # regla —la primera es el 'error' por descarga imposible del preparador—.
  # Soltar una reserva muerta es infraestructura, no contabilidad. Y se hace
  # devolviendo la fila a 'pendiente' en vez de avisarle al contable, porque el
  # contable es justamente lo que acaba de fallar: el bloque 1 la re-prepara y
  # la re-avisa con maquinaria que ya sabemos que funciona.
  #
  # 20 minutos: un análisis normal tarda 1-4 min (foto conflictiva incluida), así
  # que el margen es 5x el peor caso legítimo. El guard de estado en el UPDATE
  # hace imposible pisar un turno que revivió mientras tanto.
  while IFS='|' read -r id upd; do
    [ -z "$id" ] && continue
    soltada=$(sql "update qualia_trabajos set estado='pendiente'
                    where id='${id}' and empresa_id='${QUALIA_EMPRESA_ID}'
                      and estado='analizando'
                      and updated_at < now() - interval '20 minutes'
                  returning id")
    [ -n "$soltada" ] && log "reserva muerta liberada tras $(( ($(date +%s) - upd) / 60 ))min: $id"
  done < <(sql "select id, extract(epoch from updated_at)::bigint from qualia_trabajos where empresa_id='${QUALIA_EMPRESA_ID}' and estado='analizando' and updated_at < now() - interval '20 minutes' and updated_at > now() - interval '12 hours' order by updated_at limit 3")

  # 3) red de seguridad: aprobadas que nunca llegaron a ADM.
  #
  # El bloque 1 re-avisa las 'pendiente' y el 2 no pierde eventos de usuario,
  # pero ninguno cubre lo que pasó el 2026-08-03: el aviso SÍ llegó, el
  # watermark avanzó, y el turno del contable murió DESPUÉS (z.AI devolvió 429
  # en una ráfaga de 18 aprobaciones seguidas). Cuatro filas quedaron en
  # 'aprobada' sin docid y sin error_detalle — fuera del alcance de los dos
  # barridos, sin nadie que las volviera a intentar nunca. Se destrabaron a mano.
  #
  # 10 minutos de gracia: un registro normal tarda ~45s, así que el margen no
  # pisa un turno lento y el sistema se entera antes que el humano.
  #
  # El reintento se ESPACIA con la edad de la fila. La primera versión probaba
  # cada 10 minutos y se rendía a las 2 horas, y eso estaba mal: se estrenó
  # justo cuando z.AI devolvía 429 código 1308 —«Usage limit reached for 5
  # hour»—, que es una falla transitoria que dura HORAS. Con el tope viejo
  # habría quemado diez turnos que morían al instante y después habría
  # abandonado las filas cerca de la hora en que la cuota volvía. Ahora
  # aguanta la ventana entera y molesta cada vez menos.
  #
  # Tope de 12 horas: cubre de sobra la ventana de 5 horas del plan. Lo que
  # sigue trabado después de eso no es transitorio —falta un dato, el proveedor
  # no se puede crear— y el camino correcto es que el contable lo deje en
  # 'error' con su motivo, que la web pinta en rojo. Reintentar para siempre
  # daría el mismo fallo sin arreglar nada.
  pendientes_reg=()
  while IFS='|' read -r id upd; do
    [ -z "$id" ] && continue
    ahora=$(date +%s)
    edad=$(( ahora - upd ))
    if   (( edad < 3600 ));  then espera=600      # 1ª hora: cada 10 min
    elif (( edad < 14400 )); then espera=1800     # hasta las 4h: cada 30 min
    else                          espera=3600     # después: cada hora
    fi
    clave="reg:${id}:${upd}"
    antes=${avisado[$clave]:-0}
    (( ahora - antes > espera )) && pendientes_reg+=("${id}|${clave}|${edad}")
  # `tipo <> 'criterio'`: una regla ratificada vive en `aprobada` sin docid para
  # siempre —el CHECK de la base exige un DocID que una regla no tiene ni va a
  # tener—, así que sin este corte cae acá cada 10 minutos durante 12 horas
  # pidiendo un registro en ADM que no existe. Su red es el bloque 4.
  done < <(sql "select id, extract(epoch from updated_at)::bigint from qualia_trabajos where empresa_id='${QUALIA_EMPRESA_ID}' and tipo <> 'criterio' and estado='aprobada' and propuesta->'registro_adm'->>'docid' is null and updated_at < now() - interval '10 minutes' and updated_at > now() - interval '12 hours' order by updated_at limit 3")

  # Ya no se saltea por cuota agotada, y desde que el reintento es el script y
  # no el contable, la cuota directamente no lo roza: registrar dejó de pasar
  # por el modelo. Dejarla esperando era lo que hacía que una factura aprobada a
  # las 2 PM apareciera en ADM recién de noche.
  if (( ${#pendientes_reg[@]} > 0 )); then
    ahora=$(date +%s)
    for fila in "${pendientes_reg[@]}"; do
      IFS='|' read -r id clave edad <<< "$fila"
      avisado[$clave]=$ahora
      log "aprobada sin registrar hace $(( edad / 60 ))min: $id — reintento"
      registrar_directo "$id"
    done
  fi

  # 4) registradas sin libro de acción.
  #
  # La contracara del registro directo: el documento ya está en ADM y la fila
  # cerrada, así que ningún otro barrido la mira nunca más — 'registrada' es
  # terminal. Pero el libro es lo único que quedó del lado del contable, y se
  # pierde igual que se perdía un registro: si el gateway estaba caído cuando se
  # mandó el poke, o si el turno murió antes de escribir. Sin esta red, la
  # decisión no queda asentada en ningún lado y nadie se entera, porque en la
  # web la fila se ve perfecta.
  #
  # 5 minutos de gracia para no pisar al turno que está escribiendo ahora mismo,
  # y 12 horas de tope como los demás barridos: más viejo que eso no es una
  # entrega que se cayó, y despertar al contable por el histórico entero (las
  # cuatro primeras facturas nunca tuvieron libro) sería peor que el agujero.
  # El CRITERIO entra por la otra pata de la condición, y por dos razones que no
  # son la del documento. Su estado terminal es `aprobada`, no `registrada`: el
  # CHECK `qualia_trabajos_registrada_con_evidencia` exige un DocID que una regla
  # no tiene ni va a tener, así que sin esta pata ningún barrido lo mira nunca y
  # un precedente que el dueño cree haber ratificado no existe en ningún lado.
  #
  # Y su motivo es `accion_usuario`, NO `escribir_libro`: esa rama de la skill
  # arranca afirmando «el documento YA ESTÁ en ADM» y corta con «si el
  # registro_adm.docid no está, no inventes la entrada» — la descripción exacta
  # de un criterio. La rama que lo atiende es la de `criterio`, y se abre por
  # `accion_usuario`.
  #
  # La marca de cierre es la MISMA de arriba —una fila en `qualia_libro`— y no
  # una clave inventada dentro de `propuesta`: un `is null` que nadie apaga no es
  # condición de salida, es un bucle. Mismo tope de 12 h que los demás, y acá
  # fallar es fail-safe: la memoria pasa a `ratificado` recién al final del
  # trabajo del contable, así que una ratificación que no se escribió deja el
  # archivo en `borrador` — y un borrador no se cita jamás.
  while IFS='|' read -r id tipo; do
    [ -z "$id" ] && continue
    ahora=$(date +%s)
    clave="libro:${id}"
    antes=${avisado[$clave]:-0}
    (( ahora - antes > 1800 )) || continue
    avisado[$clave]=$ahora
    if [ "$tipo" = "criterio" ]; then
      log "criterio ratificado sin libro: $id — pido la entrada"
      poke "$id" "accion_usuario" "$ahora"
    else
      log "registrada sin libro: $id — pido la entrada"
      poke "$id" "escribir_libro" "$ahora"
    fi
  done < <(sql "select t.id, t.tipo from qualia_trabajos t where t.empresa_id='${QUALIA_EMPRESA_ID}' and t.updated_at < now() - interval '5 minutes' and t.updated_at > now() - interval '12 hours' and not exists (select 1 from qualia_libro l where l.trabajo_id = t.id) and ( (t.tipo <> 'criterio' and t.estado='registrada') or (t.tipo = 'criterio' and t.estado='aprobada') ) order by t.updated_at limit 3")

  sleep "$INTERVALO" &
  wait $!
done

log "apagado limpio"
