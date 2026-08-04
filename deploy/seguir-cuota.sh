#!/usr/bin/env bash
# Mantiene al contable llamando al proveedor que SÍ atiende.
#
#   bash /home/codebox/qualiaconta/repo/deploy/seguir-cuota.sh [empresa]
#
# El problema que resuelve, en una línea: cuando la cuota de z.AI se agota, el
# contable sigue marcando el número cerrado en cada turno y una factura tarda
# eternidades en analizarse.
#
# El detalle: el tope de z.AI es por CUENTA, no por modelo, así que con el
# orden normal cada turno quema tres llamadas muertas —glm-5.2, glm-5-turbo,
# glm-4.7— antes de llegar a OpenRouter, que es el único que contesta. Y el
# cooldown de Hermes son 60 segundos fijos que ignoran la hora de reset que el
# propio 429 trae (`_rate_limited_until = time.monotonic() + 60`), así que al
# turno siguiente vuelve a empezar por el principal y repite las tres. El
# 2026-08-04 una factura de flete quedó «analizando» hasta que el usuario la
# borró.
#
# Por qué vive acá y no adentro del poller, que es quien detecta el tope: el
# poller corre en el contenedor de la mesa, que monta /mesa de solo lectura y
# NO tiene montado el config del contable — no puede escribirlo. Y por qué no
# se arregla dentro de Hermes: su código está dentro de la imagen, pineada a
# v0.19.0 @ 14abd64, y rebuild.sh aborta si la fuente se mueve de ese commit.
# El host sí puede escribir el config, y el gateway crea un agente fresco
# cuando el config cambia, así que la conmutación entra en caliente sin
# reiniciar al contable ni matar las sesiones en vuelo.
#
# No decide nada por su cuenta: la verdad sobre el tope la escribe el poller en
# qualia_servicio.cuota_bloqueada_hasta, que ya trae resuelto lo difícil (los
# dos códigos de 429, la hora en UTC+8, y el re-sondeo que levanta el bloqueo
# antes si z.AI vuelve). Acá solo se traduce esa columna a un orden de llamada.

set -euo pipefail

EMPRESA="${1:-blackbox}"
RAIZ="/home/codebox/qualiaconta/repo"
CONF="${RAIZ}/empresas/${EMPRESA}/hermes/config.yaml"
ENV_EMPRESA="${RAIZ}/empresas/${EMPRESA}/.env"
LOG="${HOME}/qualiaconta-cuota.log"

log() { printf '%s %s\n' "$(date -u '+%F %T')" "$*" >> "$LOG"; }

# Un solo vigilante a la vez. El cron entra cada 2 minutos y una conmutación
# tarda más que eso —el configurador consulta los catálogos de los dos
# proveedores—, así que sin esto dos corridas podrían escribir el config a la
# vez. -n: si ya hay una corriendo, esta se va en silencio.
exec 9>"${HOME}/.qualiaconta-cuota.lock"
flock -n 9 || exit 0

[ -f "$CONF" ] || { log "no existe $CONF"; exit 1; }
[ -f "$ENV_EMPRESA" ] || { log "no existe $ENV_EMPRESA"; exit 1; }

# Mismo criterio que configurar-modelo.sh: se lee variable por variable, nunca
# se sourcea el .env (hay valores con espacios sin comillas, y sourcear ejecuta
# lo que haya adentro).
leer_env() {
  sed -n "s/^$1=//p" "$ENV_EMPRESA" | tail -1 | sed 's/^"\(.*\)"$/\1/'
}
QUALIA_DSN=$(leer_env QUALIA_DSN)
QUALIA_EMPRESA_ID=$(leer_env QUALIA_EMPRESA_ID)
[ -n "$QUALIA_DSN" ] && [ -n "$QUALIA_EMPRESA_ID" ] || {
  log "falta QUALIA_DSN o QUALIA_EMPRESA_ID en el .env de ${EMPRESA}"; exit 1; }

modo_del_config() {
  # El provider del bloque model es la firma del modo: openrouter = respaldo.
  python3 - "$CONF" <<'PY'
import sys, yaml
cfg = yaml.safe_load(open(sys.argv[1], encoding="utf-8")) or {}
prov = ((cfg.get("model") or {}).get("provider") or "").strip().lower()
print("respaldo" if prov == "openrouter" else "normal")
PY
}

# El agregado garantiza UNA fila incluso si la empresa nunca tuvo bloqueo, así
# que una respuesta vacía significa "no pude consultar" y no "no hay tope".
# Distinguirlo importa: ante una base caída no se toca nada, porque conmutar a
# ciegas es peor que quedarse como está.
if ! bloqueo=$(timeout 30 env PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -t -A -q -c \
    "select coalesce(max(case when cuota_bloqueada_hasta > now() then 1 else 0 end), 0)
       from qualia_servicio where empresa_id='${QUALIA_EMPRESA_ID}'" 2>&1); then
  log "no pude consultar la base — no toco nada (${bloqueo//$'\n'/ })"
  exit 0
fi
bloqueo="${bloqueo//[[:space:]]/}"
case "$bloqueo" in
  0) deseado=normal ;;
  1) deseado=respaldo ;;
  *) log "respuesta rara de la base ('$bloqueo') — no toco nada"; exit 0 ;;
esac

actual=$(modo_del_config)
if [ "$deseado" = "$actual" ]; then
  exit 0
fi

log "cuota: ${actual} -> ${deseado}"
if bash "${RAIZ}/deploy/configurar-modelo.sh" "$EMPRESA" "$deseado" >>"$LOG" 2>&1; then
  log "conmutado a ${deseado}"
  exit 0
fi

# El configurador puede fallar DESPUÉS de haber escrito bien: su verificación
# final hace docker exec y el contenedor puede estar caído. Así que el veredicto
# se toma leyendo el archivo, no del código de salida.
quedo=$(modo_del_config)
if [ "$quedo" = "$deseado" ]; then
  log "conmutado a ${deseado} (el post-chequeo falló, pero el config quedó bien)"
else
  log "FALLÓ la conmutación a ${deseado} — sigue en ${quedo}"
  exit 1
fi
