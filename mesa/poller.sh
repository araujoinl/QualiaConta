#!/bin/bash
# Poller de la mesa de trabajo — SIN LLM.
#
# Vigila la cola qualia_* en la Supabase de Labs_Inv y despierta al contable
# (webhook local del gateway Hermes) solo cuando hay trabajo. No marca ningún
# estado por sí mismo: todos los cambios los hace el contable o la web.
#
# Despierta por dos señales:
#   1) trabajos en estado 'pendiente' (factura recién arrastrada)
#   2) eventos nuevos con autor='usuario' (aprobó / rechazó / respondió)
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

log() { echo "[mesa-poller] $(date -u +%H:%M:%S) $*"; }

corriendo=1
trap 'corriendo=0' TERM INT

sql() {
  # -q silencia notices; timeout de conexión corto para no colgar el loop
  PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -t -A -q -c "$1" 2>/dev/null
}

poke() {
  # $1 = trabajo_id, $2 = motivo
  curl -s -m 15 -X POST "$WEBHOOK" \
    -H 'Content-Type: application/json' \
    -d "{\"trabajo_id\":\"$1\",\"motivo\":\"$2\"}" > /dev/null 2>&1 \
    && log "desperté al contable: $2 $1" \
    || log "no pude tocar el webhook ($2 $1) — ¿gateway abajo?"
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

while [ "$corriendo" -eq 1 ]; do
  # 1) trabajos nuevos
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    ahora=$(date +%s)
    antes=${avisado[$id]:-0}
    if (( ahora - antes > 300 )); then
      poke "$id" "trabajo_nuevo"
      avisado[$id]=$ahora
    fi
  done < <(sql "select id from qualia_trabajos where empresa_id='${QUALIA_EMPRESA_ID}' and estado='pendiente' order by created_at limit 3")

  # 2) acciones del usuario en la web
  while IFS='|' read -r eid tid; do
    [ -z "${eid:-}" ] && continue
    poke "$tid" "accion_usuario"
    wm=$eid
  done < <(sql "select e.id, e.trabajo_id from qualia_eventos e join qualia_trabajos t on t.id = e.trabajo_id where t.empresa_id='${QUALIA_EMPRESA_ID}' and e.autor='usuario' and e.id > ${wm} order by e.id limit 10")

  sleep "$INTERVALO" &
  wait $!
done

log "apagado limpio"
