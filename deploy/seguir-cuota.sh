#!/usr/bin/env bash
# Mantiene al contable llamando al proveedor que SÍ atiende, y con el modelo que
# se le eligió.
#
# Son dos preguntas distintas que se contestan en la misma pasada porque las dos
# terminan en el mismo archivo, y ese archivo tiene un solo escritor a propósito
# (ver el lock más abajo):
#
#   QUIÉN atiende primero  -> lo decide la cuota, mirando qualia_servicio.
#   CON QUÉ modelo         -> lo decide el humano en el panel de AI Engines de
#                             Labs_Inv, que guarda en ai_feature_config la fila
#                             `qualia_contable`. Acá sólo se lee y se aplica; el
#                             panel ya probó el modelo contra z.AI antes de
#                             dejarlo guardar.
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

# Modo y modelo vivos, en ese orden, una línea cada uno.
modo_del_config() {
  # El provider del bloque model es la firma del modo: openrouter = respaldo.
  python3 - "$CONF" <<'PY'
import sys, yaml
cfg = yaml.safe_load(open(sys.argv[1], encoding="utf-8")) or {}
m = cfg.get("model") or {}
prov = (m.get("provider") or "").strip().lower()
modelo = (m.get("default") or "").strip()
# En modo respaldo el principal viaja con el prefijo de la organización
# ('z-ai/glm-5.2'), pero es EL MISMO peso. Se compara sin prefijo o cada
# conmutación de cuota se leería además como un cambio de modelo, y las dos se
# perseguirían en círculo cada 2 minutos.
if modelo.startswith("z-ai/"):
    modelo = modelo[len("z-ai/"):]
print("respaldo" if prov == "openrouter" else "normal")
print(modelo)
PY
}

# El modelo que el panel dejó pedido, o vacío si no hay nada que decir.
#
# Sin fila NO es un error: significa "nunca se tocó el selector", y la respuesta
# correcta es dejar el que está corriendo. Es el mismo trato que le da el
# resolver de las edge functions, donde la ausencia de fila cae al default de la
# feature. Distinto es no poder preguntar —base caída—, que se maneja arriba.
modelo_pedido() {
  timeout 30 env PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -t -A -q -c \
    "select model from ai_feature_config
      where feature_key='qualia_contable' and provider='zai'"
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

vivo=$(modo_del_config)
actual=$(printf '%s\n' "$vivo" | sed -n 1p)
modelo_actual=$(printf '%s\n' "$vivo" | sed -n 2p)

if ! pedido=$(modelo_pedido 2>&1); then
  log "no pude leer el modelo pedido — sigo con ${modelo_actual} (${pedido//$'\n'/ })"
  pedido="$modelo_actual"
fi
pedido="${pedido//[[:space:]]/}"
# Vacío = nadie tocó el selector todavía. El id se valida contra la forma antes
# de pasarlo como argumento: viene de una tabla que escribe la web.
[ -n "$pedido" ] || pedido="$modelo_actual"
case "$pedido" in
  *[!a-zA-Z0-9._-]*)
    log "el modelo pedido ('$pedido') no tiene forma de id — sigo con ${modelo_actual}"
    pedido="$modelo_actual" ;;
esac

# Un modelo que el configurador ya rechazó no se reintenta cada 2 minutos: sería
# llenar el log y castigar a las dos APIs sin cambiar el resultado. El bloqueo
# caduca a la hora porque un modelo puede aparecer en OpenRouter más tarde, y
# sin caducidad la única salida sería borrar este archivo a mano en el server.
FALLIDO="${HOME}/.qualiaconta-modelo-fallido"
if [ "$pedido" != "$modelo_actual" ] \
   && [ "$pedido" = "$(cat "$FALLIDO" 2>/dev/null)" ] \
   && [ -z "$(find "$FALLIDO" -mmin +60 2>/dev/null)" ]; then
  pedido="$modelo_actual"
fi

if [ "$deseado" = "$actual" ] && [ "$pedido" = "$modelo_actual" ]; then
  exit 0
fi

log "cambio: ${actual}/${modelo_actual} -> ${deseado}/${pedido}"
if bash "${RAIZ}/deploy/configurar-modelo.sh" "$EMPRESA" "$deseado" "$pedido" >>"$LOG" 2>&1; then
  log "aplicado ${deseado}/${pedido}"
  rm -f "$FALLIDO"
  exit 0
fi

# El configurador puede fallar DESPUÉS de haber escrito bien: su verificación
# final hace docker exec y el contenedor puede estar caído. Así que el veredicto
# se toma leyendo el archivo, no del código de salida.
vivo=$(modo_del_config)
quedo=$(printf '%s\n' "$vivo" | sed -n 1p)
quedo_modelo=$(printf '%s\n' "$vivo" | sed -n 2p)
if [ "$quedo" = "$deseado" ] && [ "$quedo_modelo" = "$pedido" ]; then
  log "aplicado ${deseado}/${pedido} (el post-chequeo falló, pero el config quedó bien)"
  rm -f "$FALLIDO"
  exit 0
fi

# No se aplicó nada. Si además del modo se pedía un modelo nuevo, el sospechoso
# número uno es ése: el configurador aborta ante un modelo que no exista en los
# DOS proveedores, y aborta entero. Lo que no puede pasar es que una elección de
# modelo mala deshabilite la conmutación de cuota, que es la red de la que
# depende que el contable siga contestando cuando z.AI topa. Así que el modelo
# se anota como fallido y el modo se reintenta con el que ya estaba corriendo.
if [ "$pedido" != "$modelo_actual" ]; then
  printf '%s\n' "$pedido" > "$FALLIDO"
  log "el modelo '${pedido}' no se pudo aplicar (el detalle está arriba) — reintento el modo con ${modelo_actual}"
  if bash "${RAIZ}/deploy/configurar-modelo.sh" "$EMPRESA" "$deseado" "$modelo_actual" >>"$LOG" 2>&1; then
    log "conmutado a ${deseado} con ${modelo_actual}"
    exit 0
  fi
fi

log "FALLÓ el cambio a ${deseado}/${pedido} — sigue en ${quedo}/${quedo_modelo}"
exit 1
