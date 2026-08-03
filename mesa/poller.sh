#!/bin/bash
# Poller de la mesa de trabajo — SIN LLM.
#
# Vigila la cola qualia_* en la Supabase de Labs_Inv y despierta al contable
# (webhook local del gateway Hermes) solo cuando hay trabajo. No marca ningún
# estado por sí mismo: todos los cambios los hace el contable o la web.
#
# Despierta por tres señales:
#   1) trabajos en estado 'pendiente' (factura recién arrastrada)
#   2) eventos nuevos con autor='usuario' (aprobó / rechazó / respondió)
#   3) aprobadas que llevan rato sin llegar a ADM (motivo registro_pendiente):
#      red de seguridad para el turno del contable que muere después de que el
#      aviso ya se entregó — sin esto la fila queda huérfana para siempre
#
# Y suelta las reservas muertas: 'analizando' congelado 20 min vuelve a
# 'pendiente'. La regla general detrás de los tres barridos: TODO estado que le
# pertenece al contable —pendiente, analizando, aprobada-sin-docid— necesita su
# red. Los que le pertenecen al humano —propuesta, esperando_respuesta— no se
# tocan nunca, y los terminales —registrada, rechazada, error— tampoco. Si algún
# día se agrega un estado del contable, hay que preguntarse quién lo rescata.
#
# Antes de avisar un trabajo nuevo corre el preparador determinista
# (mesa/preparar-trabajo.sh, montado en /mesa): baja el documento, extrae,
# verifica DGII y chequea duplicados sin LLM, y deja el dossier en
# /tmp/mesa/<id>/ para que el contable despierte con todo masticado. Si el
# prep falla, el aviso va igual y el contable completa con el protocolo viejo.
# El único estado que el prep puede marcar es 'error' por descarga imposible;
# el claim pendiente→analizando sigue siendo del contable.
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

cuota_bloqueada_hasta() {
  # Imprime la hora UTC (ISO) hasta la que la cuota está agotada, o nada si
  # está libre / no se pudo determinar. Nunca falla al llamador.
  [ -n "${GLM_API_KEY:-}" ] || return 0
  local resp
  resp=$(curl -s -m 20 -X POST "https://api.z.ai/api/coding/paas/v4/chat/completions" \
    -H "Authorization: Bearer $GLM_API_KEY" -H 'Content-Type: application/json' \
    -d '{"model":"glm-4.6v","max_tokens":1,"messages":[{"role":"user","content":"."}]}' 2>/dev/null)
  case "$resp" in
    *'"code":"1308"'*) ;;
    *) return 0 ;;   # sin 1308: o está libre, o es otro error que no nos toca
  esac
  local crudo
  crudo=$(printf '%s' "$resp" | grep -oE 'reset at [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}' \
          | head -1 | sed 's/^reset at //')
  local hasta
  if [ -n "$crudo" ]; then
    hasta=$(date -u -d "${crudo}${CUOTA_TZ_OFFSET}" +%s 2>/dev/null)
  fi
  local ahora tope
  ahora=$(date +%s); tope=$(( ahora + 21600 ))          # 6 horas
  # Sin hora legible, o una hora absurda (pasado, o más de 6h): 5 horas es el
  # largo real de la ventana del plan y es la conjetura segura.
  if [ -z "${hasta:-}" ] || (( hasta <= ahora )) || (( hasta > tope )); then
    hasta=$(( ahora + 18000 ))
  fi
  date -u -d "@$hasta" +%Y-%m-%dT%H:%M:%SZ
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

registrar_cuota() {
  # $1 = hora UTC ISO o vacío para liberar. Upsert de la fila de la empresa.
  local valor="null" detalle="null"
  if [ -n "${1:-}" ]; then
    valor="'$1'"
    detalle="'cuota del LLM agotada (z.AI 1308); vuelve $1'"
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
      if hasta=$(cuota_bloqueada_hasta) && [ -n "$hasta" ]; then
        cuota_hasta=$(date -u -d "$hasta" +%s 2>/dev/null || echo 0)
        cuota_avisado=$ahora
        registrar_cuota "$hasta"
        log "cuota de z.AI agotada hasta $hasta — $estancado en cola, siguen por el respaldo"
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
  if (( cuota_hasta > ahora )) && (( ahora - cuota_avisado > 600 )); then
    cuota_avisado=$ahora
    log "cuota de z.AI agotada hasta $(date -u -d "@$cuota_hasta" +%H:%M)Z — sigo trabajando por el respaldo de OpenRouter"
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
  done < <(sql "select id, extract(epoch from updated_at)::bigint from qualia_trabajos where empresa_id='${QUALIA_EMPRESA_ID}' and estado='pendiente' order by created_at limit 3")

  # 2) acciones del usuario en la web. El watermark SOLO avanza si el aviso
  # llegó: una aprobación con el gateway caído se reintenta el próximo tick
  # en vez de perderse para siempre (antes wm avanzaba incondicional y el
  # evento se consumía sin entregarse).
  while IFS='|' read -r eid tid; do
    [ -z "${eid:-}" ] && continue
    if poke "$tid" "accion_usuario"; then
      wm=$eid
    else
      break
    fi
  done < <(sql "select e.id, e.trabajo_id from qualia_eventos e join qualia_trabajos t on t.id = e.trabajo_id where t.empresa_id='${QUALIA_EMPRESA_ID}' and e.autor='usuario' and e.id > ${wm} order by e.id limit 10")

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
  done < <(sql "select id, extract(epoch from updated_at)::bigint from qualia_trabajos where empresa_id='${QUALIA_EMPRESA_ID}' and estado='aprobada' and propuesta->'registro_adm'->>'docid' is null and updated_at < now() - interval '10 minutes' and updated_at > now() - interval '12 hours' order by updated_at limit 3")

  # Ya no se saltea por cuota agotada: con el respaldo puesto, una aprobada sin
  # registrar se reintenta igual, salga por z.AI o por OpenRouter. Dejarla
  # esperando era lo que hacía que una factura aprobada a las 2 PM apareciera en
  # ADM recién de noche.
  if (( ${#pendientes_reg[@]} > 0 )); then
    ahora=$(date +%s)
    for fila in "${pendientes_reg[@]}"; do
      IFS='|' read -r id clave edad <<< "$fila"
      avisado[$clave]=$ahora
      log "aprobada sin registrar hace $(( edad / 60 ))min: $id — reintento"
      poke "$id" "registro_pendiente" "$ahora"
    done
  fi

  sleep "$INTERVALO" &
  wait $!
done

log "apagado limpio"
