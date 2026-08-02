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

log() { echo "[mesa-poller] $(date -u +%H:%M:%S) $*"; }

corriendo=1
trap 'corriendo=0' TERM INT

sql() {
  # -q silencia notices; PGCONNECT_TIMEOUT corto + timeout DURO alrededor:
  # una conexión TCP colgada a mitad de query congelaba el loop entero con
  # el contenedor "Up" (hallazgo de auditoría 2026-08-02).
  timeout 30 env PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -t -A -q -c "$1" 2>/dev/null
}

poke() {
  # $1 = trabajo_id, $2 = motivo. Devuelve el rc REAL del curl: el llamador
  # decide qué hacer con un gateway caído (los eventos de usuario NO pueden
  # perderse — ver el loop de accion_usuario).
  if curl -s -m 15 -X POST "$WEBHOOK" \
    -H 'Content-Type: application/json' \
    -d "{\"trabajo_id\":\"$1\",\"motivo\":\"$2\"}" > /dev/null 2>&1; then
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

while [ "$corriendo" -eq 1 ]; do
  # Latido para el healthcheck del compose: si este archivo envejece, el
  # loop está congelado y Docker lo marca unhealthy (y el restart lo revive).
  date +%s > /tmp/latido 2>/dev/null

  # 1) trabajos nuevos
  # La clave del anti-spam incluye updated_at: si el trabajo VUELVE a pendiente
  # (tras un error, o porque el humano pidió otra revisión) es una petición
  # nueva y se avisa al instante. El tope de 300s queda solo para el caso
  # "sigue pendiente y el gateway estaba caído cuando avisé".
  while IFS='|' read -r id upd; do
    [ -z "$id" ] && continue
    ahora=$(date +%s)
    clave="${id}:${upd}"
    antes=${avisado[$clave]:-0}
    if (( ahora - antes > 300 )); then
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

  sleep "$INTERVALO" &
  wait $!
done

log "apagado limpio"
