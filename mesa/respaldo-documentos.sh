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
# Tolerante: cualquier fallo cuenta y sigue; nunca aborta. El motivo se lee
# del cuerpo del error: un objeto borrado (NoSuchKey) no es lo mismo que una
# firma vencida, y mandan a arreglar cosas distintas.
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

# Inicio y ruta del helper: al cerrar, la corrida queda en qualia_actualizaciones
# para verse desde la web (Configuracion > Bancos > QualiaConta).
INICIO=$(date -u +%FT%TZ)
AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# Buffer con SOLO esta corrida: es lo que se guarda como detalle en la
# bitacora. El log de por vida sigue recibiendo todo igual.
CORRIDA=$(mktemp)
trap 'rm -f "$CORRIDA"' EXIT

log() {
  echo "[respaldo-docs] $(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$CORRIDA" | tee -a "$LOG"
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
fallidos=0        # reintentables: la próxima corrida puede arreglarlas
irrecuperables=0  # el archivo ya no existe; esperar no lo trae de vuelta
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
  # -f oculta el cuerpo del error, y el cuerpo es justo lo que distingue un
  # objeto borrado de una firma vencida. Se baja sin -f y se decide leyendo.
  cuerpo=$(curl -sS -m 120 -o "$tmp" -w '%{http_code}' "$url" 2>/dev/null || echo 000)
  if [ "$cuerpo" = "200" ] && [ -s "$tmp" ]; then
    mv "$tmp" "$archivo"
    nuevos=$((nuevos + 1))
    log "bajado: ${empresa}/${trabajo}/${nombre} ($(stat -c%s "$archivo") bytes)"
  else
    motivo="HTTP $cuerpo"
    clase="fallo"
    if grep -q 'NoSuchKey\|not_found' "$tmp" 2>/dev/null; then
      # El archivo ya no esta en el bucket. Reintentar no lo va a traer: esto
      # se arregla subiendo el documento de nuevo, no esperando.
      motivo="el archivo YA NO EXISTE en el bucket (borrado); no se recupera reintentando"
      clase="irrecuperable"
    elif grep -qi 'jwt\|expired\|signature' "$tmp" 2>/dev/null; then
      motivo="la firma de la URL no sirve; abrir «Ver original» en la web la regenera"
    fi
    rm -f "$tmp"
    if [ "$clase" = "irrecuperable" ]; then
      irrecuperables=$((irrecuperables + 1))
      log "IRRECUPERABLE: ${empresa}/${trabajo}/${nombre} — ${motivo}"
    else
      fallidos=$((fallidos + 1))
      log "FALLO: ${empresa}/${trabajo}/${nombre} — ${motivo}"
    fi
  fi
done <<< "$filas"

log "resumen: ${nuevos} nuevos, ${fallidos} fallidos, ${irrecuperables} irrecuperables, ${existentes} ya respaldados"

resumen=$(printf '{"documentos":{"nuevos":%s,"fallidos":%s,"irrecuperables":%s,"ya_estaban":%s,"total":%s}}' \
    "$nuevos" "$fallidos" "$irrecuperables" "$existentes" "$((nuevos + existentes))")

# Solo las fallas REINTENTABLES ponen la corrida en rojo.
#
# Un documento borrado del bucket no vuelve por esperar, asi que marcaba la
# corrida en rojo cada hora, para siempre: paso el 2026-08-03 con el PDF de
# TUPAQ, borrado el dia anterior cuando la policy todavia lo permitia. Un rojo
# que NO PUEDE volver a verde es peor que no tener luz — ensena a ignorar el
# panel, y el dia que falle algo de verdad ya nadie lo mira.
#
# No se esconde: va contado aparte en el resumen (la web lo muestra) y con su
# propia linea IRRECUPERABLE en el log. Es un hecho que se mira una vez y se
# decide, no una alarma que se repite.
if [ "$fallidos" -eq 0 ]; then ok=true; else ok=false; fi
"$AQUI/registrar-corrida.sh" respaldo_documentos "$INICIO" "$(date -u +%FT%TZ)" \
    "$ok" "$fallidos" "$resumen" "$CORRIDA"

exit 0
