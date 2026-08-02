#!/bin/bash
# Respaldo nocturno de los documentos de la mesa de trabajo.
#
# Por qué existe: los archivos del bucket qualia-conta viven SOLO en el
# Storage de Supabase — el pg_dump nocturno (supabase-backup.timer) respalda
# la base, no el bucket. Este script baja una copia local de cada documento
# adjunto a un trabajo de la mesa, usando la URL firmada (~30 días) que la
# web mantiene fresca en qualia_trabajos.archivo_url.
#
# Destino: /home/codebox/qualia-docs/<empresa_id>/<trabajo_id>/<archivo_nombre>
# Log:     /home/codebox/qualia-docs/respaldo.log — SIN URLs (llevan token firmado)
#
# Idempotente: lo ya bajado (archivo con bytes) no se vuelve a bajar.
# Tolerante: URL vencida o red caída => cuenta el fallo y sigue; nunca aborta.
#
# Uso:      ./respaldo-documentos.sh
# Cron:     0 3 * * * (crontab de codebox; el server corre en UTC → 23:00 RD)
# Requiere: docker en el host (lee la base vía el contenedor del poller de la
#           mesa, que ya tiene QUALIA_DSN en su entorno).

set -u

CONTENEDOR="qualiaconta-mesa-blackbox"
DESTINO="/home/codebox/qualia-docs"
LOG="${DESTINO}/respaldo.log"

mkdir -p "$DESTINO"

log() {
  echo "[respaldo-docs] $(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG"
}

# Pares con documento respaldable: hace falta nombre y URL. OJO: no se filtra
# por archivo_path — hay filas con URL válida y path nulo (p.ej. la PRUEBA
# e2e) que también queremos respaldar; sin URL no hay nada que bajar.
SQL="select empresa_id, id, archivo_nombre, archivo_url
       from qualia_trabajos
      where archivo_url is not null
        and archivo_nombre is not null
      order by created_at"

# stderr a /dev/null: un error de psql puede reflejar detalles de conexión.
if ! filas=$(docker exec "$CONTENEDOR" sh -c 'psql "$QUALIA_DSN" -t -A -q -c "'"$SQL"'"' 2>/dev/null); then
  log "ERROR: no pude leer qualia_trabajos (¿contenedor $CONTENEDOR o base caídos?)"
  exit 1
fi

nuevos=0
fallidos=0
existentes=0

while IFS='|' read -r empresa trabajo nombre url; do
  [ -z "${empresa:-}" ] && continue
  nombre=$(basename "$nombre")   # nunca dejar que un nombre raro escape del árbol
  dir="${DESTINO}/${empresa}/${trabajo}"
  archivo="${dir}/${nombre}"

  if [ -s "$archivo" ]; then
    existentes=$((existentes + 1))
    continue
  fi

  mkdir -p "$dir"
  tmp="${archivo}.part"
  # La URL SIEMPRE entre comillas (trae query string firmado con & y =).
  if curl -fsS -m 120 -o "$tmp" "$url" 2>/dev/null && [ -s "$tmp" ]; then
    mv "$tmp" "$archivo"
    nuevos=$((nuevos + 1))
    log "bajado: ${empresa}/${trabajo}/${nombre} ($(stat -c%s "$archivo") bytes)"
  else
    rm -f "$tmp"
    fallidos=$((fallidos + 1))
    log "FALLO: ${empresa}/${trabajo}/${nombre} (¿URL vencida? la web la regenera sola)"
  fi
done <<< "$filas"

log "resumen: ${nuevos} nuevos, ${fallidos} fallidos, ${existentes} ya respaldados"
exit 0
