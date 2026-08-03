#!/bin/bash
# Avisa por WhatsApp cuando el contable se queda sin cuota del LLM, y cuando vuelve.
#
# Por qué existe: el poller de la mesa YA detecta el 1308 de z.AI, frena el
# trabajo y deja la constancia en qualia_servicio.cuota_bloqueada_hasta. Eso
# evita quemar turnos contra el 429, pero no le avisa a nadie: el 2026-08-03 el
# contable estuvo topado desde las 13:54 hasta las 15:45 (hora RD) y la única
# forma de enterarse era leer los logs del contenedor. Un contable mudo dos
# horas en plena tarde de trabajo tiene que sonar un teléfono.
#
# NO vuelve a sondear a z.AI: la fila de qualia_servicio es la única fuente de
# verdad de "estamos topados". Dos detectores del mismo hecho se contradicen.
#
# Avisa SOLO en los cambios de estado (libre→topado, topado→libre), así que un
# corte de tres horas son dos mensajes, no noventa. El estado anterior vive en
# $ESTADO; si el archivo se pierde, el peor caso es un aviso repetido.
#
# También vigila el saldo de OpenRouter, que es el respaldo: si ese saldo llega
# a cero, la red de seguridad no existe y nadie se entera hasta el próximo tope
# de z.AI. Un respaldo que falla en silencio es peor que no tenerlo, porque se
# deja de mirar el problema.
#
# Destino: /home/codebox/qualia-cuota.log
# Cron:    */2 * * * * (crontab de codebox)
# Requiere: docker en el host (lee la base por el contenedor de la mesa, que ya
#           tiene QUALIA_DSN adentro — acá nunca se toca la credencial) y las
#           WSNOTIFY_* del colector, que ya están en ese .env.

set -u

ESTADO="${QUALIA_CUOTA_ESTADO:-/home/codebox/.qualia-alerta-cuota}"
LOG="${QUALIA_CUOTA_LOG:-/home/codebox/qualia-cuota.log}"
WSNOTIFY_ENV="${WSNOTIFY_ENV:-/home/codebox/colector-bancos/.env}"
EMPRESA_ENV="${QUALIA_EMPRESA_ENV:-/home/codebox/qualiaconta/repo/empresas/blackbox/.env}"
SALDO_MINIMO="${OPENROUTER_SALDO_MINIMO:-3}"       # dólares
LOG_MAX_BYTES="${QUALIA_CUOTA_LOG_MAX:-2097152}"   # 2 MiB y rota

log() { printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG" 2>/dev/null; }

# Rotación de una sola generación: alcanza para el triage y no llena el disco.
tam=$(stat -c %s "$LOG" 2>/dev/null || echo 0)
[ "$tam" -gt "$LOG_MAX_BYTES" ] && mv -f "$LOG" "$LOG.1" 2>/dev/null

# El contenedor es sólo el vehículo para llegar a Postgres. Se toma el primero
# que esté corriendo: la fila que se lee es la misma para todas las empresas.
CONTENEDOR=$(docker ps --format '{{.Names}}' 2>/dev/null | grep '^qualiaconta-mesa-' | head -1)
if [ -z "$CONTENEDOR" ]; then
  log "no hay contenedor de mesa corriendo; no puedo leer el estado de la cuota"
  exit 0
fi

# Aviso por WhatsApp vía WsNotify. Las credenciales se leen en un subshell y
# nunca se imprimen ni se pasan por la línea de comandos.
avisar() {
  local texto="$1" seguro rc
  seguro=$(printf '%s' "$texto" | tr -d '\\"' | tr '\n' ' ')
  (
    set -a; . "$WSNOTIFY_ENV" 2>/dev/null || true; set +a
    if [ -z "${WSNOTIFY_BASE_URL:-}" ] || [ -z "${WSNOTIFY_API_KEY:-}" ] || [ -z "${WSNOTIFY_OTP_DESTINO:-}" ]; then
      exit 2
    fi
    # bypass_window: el humano necesita saberlo AHORA, no en la ventana de
    # envío. Es transaccional, no marketing.
    curl -sS -m 15 -X POST "${WSNOTIFY_BASE_URL%/}/v1/messages" \
      -H "Authorization: Bearer ${WSNOTIFY_API_KEY}" \
      -H 'Content-Type: application/json' \
      -d "{\"to\":\"${WSNOTIFY_OTP_DESTINO}\",\"sender\":\"QualiaConta\",\"text\":\"${seguro}\",\"priority\":\"high\",\"bypass_window\":true,\"origin\":\"trigger\"}" \
      >/dev/null 2>&1
  )
  rc=$?
  case "$rc" in
    0) log "aviso enviado: $seguro" ;;
    2) log "no puedo avisar: faltan WSNOTIFY_* en $WSNOTIFY_ENV" ;;
    *) log "ERROR: no pude enviar el aviso (rc=$rc)" ;;
  esac
  return 0
}

# Hora dominicana para el mensaje: el que lo recibe no piensa en UTC.
hora_rd() {
  TZ=America/Santo_Domingo date -d "$1" '+%-I:%M %p' 2>/dev/null || printf '%s' "$1"
}

# Sin comillas simples adentro del SQL a propósito: la consulta viaja por
# ssh -> docker exec -> sh -c -> psql, y cada capa se come un nivel de escape.
# psql ya imprime NULL como cadena vacía, así que el coalesce sobra.
filas=$(docker exec "$CONTENEDOR" sh -c \
  'psql "$QUALIA_DSN" -t -A -F "|" -c "select empresa_id, cuota_bloqueada_hasta from qualia_servicio"' \
  2>/dev/null)

if [ -z "$filas" ]; then
  log "la consulta no devolvió filas (¿base inalcanzable?); no cambio nada"
  exit 0
fi

ahora=$(date -u +%s)
nuevo_estado=$(mktemp) || exit 0
trap 'rm -f "$nuevo_estado"' EXIT

printf '%s\n' "$filas" | while IFS='|' read -r empresa hasta; do
  [ -n "$empresa" ] || continue

  # Topado = hay hora Y todavía no llegó. Una hora ya vencida es libre: el
  # poller la limpia en su próximo ciclo, pero el aviso no espera por eso.
  estado="libre"
  if [ -n "$hasta" ]; then
    epoch=$(date -u -d "$hasta" +%s 2>/dev/null || echo 0)
    [ "$epoch" -gt "$ahora" ] && estado="topado"
  fi

  # awk y no grep: el separador es un tab literal y un grep con tab adentro se
  # rompe en cuanto alguien reindenta el archivo.
  previo=$(awk -F'\t' -v e="$empresa" '$1==e {print $2}' "$ESTADO" 2>/dev/null)
  printf '%s\t%s\n' "$empresa" "$estado" >>"$nuevo_estado"

  # Primera corrida (sin estado previo): se registra pero no se avisa, para no
  # disparar un WhatsApp por instalar el script.
  [ -n "$previo" ] || { log "estado inicial de ${empresa}: ${estado}"; continue; }
  [ "$previo" = "$estado" ] && continue

  # El mensaje NO dice "está caído" a propósito: desde que la cadena termina en
  # OpenRouter, un tope de z.AI ya no detiene nada — ni el chat ni la cola de
  # facturas. Lo único que cambia es que la inferencia pasa a cobrarse por
  # token, y eso es exactamente lo que hay que avisar. Un aviso que exagera el
  # problema se termina ignorando, y el día que importe tampoco se va a leer.
  if [ "$estado" = "topado" ]; then
    avisar "z.AI se topó hasta las $(hora_rd "$hasta"). El contable sigue trabajando normal —chat y facturas— pero por el respaldo de OpenRouter, que se cobra por token. No hay nada que hacer; es sólo para que sepas que ese rato cuesta."
  else
    avisar "z.AI volvió. El contable salió del respaldo pagado."
  fi
  log "${empresa}: ${previo} -> ${estado}"
done

# ------------------------------------------------------------------ saldo OR
# Se consulta siempre, no sólo durante un tope: enterarse de que el respaldo
# está vacío JUSTO cuando hace falta es enterarse tarde.
saldo=$( (
  set -a; . "$EMPRESA_ENV" 2>/dev/null || true; set +a
  [ -n "${OPENROUTER_API_KEY:-}" ] || exit 0
  curl -s -m 20 -H "Authorization: Bearer ${OPENROUTER_API_KEY}" \
    https://openrouter.ai/api/v1/credits 2>/dev/null \
    | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; print(round(d["total_credits"]-d["total_usage"], 4))' 2>/dev/null
) )

if [ -n "${saldo:-}" ]; then
  bajo=$(awk -v s="$saldo" -v m="$SALDO_MINIMO" 'BEGIN{print (s<m)?"si":"no"}')
  previo_saldo=$(awk -F'\t' '$1=="__saldo_or__" {print $2}' "$ESTADO" 2>/dev/null)
  printf '%s\t%s\n' "__saldo_or__" "$bajo" >>"$nuevo_estado"
  if [ -n "$previo_saldo" ] && [ "$previo_saldo" != "$bajo" ]; then
    if [ "$bajo" = "si" ]; then
      avisar "El respaldo de OpenRouter va quedando corto: quedan US\$${saldo}. Si llega a cero, el próximo tope de z.AI deja al contable mudo otra vez."
    else
      avisar "Respaldo de OpenRouter recargado: US\$${saldo} disponibles."
    fi
    log "saldo openrouter: ${previo_saldo} -> ${bajo} (US\$${saldo})"
  elif [ -z "$previo_saldo" ]; then
    log "saldo openrouter inicial: US\$${saldo} (bajo=${bajo})"
  fi
else
  # Si no se pudo leer, se arrastra el valor anterior en vez de olvidarlo: sin
  # esto un curl que falla borra la memoria y el aviso del cruce nunca sale.
  awk -F'\t' '$1=="__saldo_or__"' "$ESTADO" 2>/dev/null >>"$nuevo_estado"
  log "no pude leer el saldo de OpenRouter"
fi

# Se reemplaza entero y sólo al final: si algo falló a mitad, el estado viejo
# sigue siendo el bueno y el próximo ciclo reintenta.
if [ -s "$nuevo_estado" ]; then
  cp -f "$nuevo_estado" "$ESTADO" 2>/dev/null
fi
