#!/bin/bash
# TODO el contexto de un trabajo de la mesa en UNA pasada — y opcionalmente el
# claim atómico en el mismo viaje.
#
# Existe por la cuota, no por la latencia: cada tool call del turno re-manda el
# prompt entero (~25k tokens que el caché hace gratis en segundos pero cobra
# COMPLETOS contra la ventana de 5 h de z.AI — medido 2026-08-07). El protocolo
# viejo gastaba 4-6 llamadas en claim + fila + hilo + dossier + precedente;
# esto las vuelve UNA. La base sigue siendo la única fuente de verdad: el poke
# del webhook es un puntero y este script es quien relee.
#
# Uso:
#   leer-contexto.sh <trabajo_id>            # solo leer (accion_usuario, etc.)
#   leer-contexto.sh <trabajo_id> --claim    # claim pendiente→analizando + leer
#
# Con --claim, la PRIMERA línea dice el resultado:
#   CLAIM: ok         → el trabajo es tuyo, seguí
#   CLAIM: perdido    → otro proceso lo tomó o ya no está pendiente. PARÁ:
#                       lo que imprime abajo es solo para que entiendas, no
#                       para que escribas nada.
#
# Imprime, en orden: la fila, el hilo de eventos (últimos 30), el rastro del
# proponedor determinista si existe (clasificacion.json: por qué NO propuso —
# ése es tu punto de partida, no lo re-descubras), el dossier del preparador,
# y el precedente del proveedor ya buscado (buscar-precedente.py). Lo que no
# exista se dice y se sigue: este script nunca revienta por un pedazo ausente.

set -u
: "${QUALIA_DSN:?falta QUALIA_DSN}"
: "${QUALIA_EMPRESA_ID:?falta QUALIA_EMPRESA_ID}"

ID="${1:?uso: leer-contexto.sh <trabajo_id> [--claim]}"
[[ "$ID" =~ ^[0-9a-f-]{36}$ ]] || { echo "trabajo_id invalido" >&2; exit 1; }
AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

sql() {
  PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -X -q -v ON_ERROR_STOP=1 "$@" 2>&1
}

if [ "${2:-}" = "--claim" ]; then
  ganado=$(sql -t -A -v id="$ID" -v emp="$QUALIA_EMPRESA_ID" <<'SQL'
update qualia_trabajos set estado='analizando'
 where id = :'id' and empresa_id = :'emp' and estado = 'pendiente'
returning id;
SQL
)
  if [ -n "$ganado" ]; then echo "CLAIM: ok"; else echo "CLAIM: perdido"; fi
fi

echo "=== FILA ==="
sql -x -v id="$ID" -v emp="$QUALIA_EMPRESA_ID" <<'SQL'
select estado, tipo, origen, resumen, aprobado_por_nombre, error_detalle,
       archivo_nombre, created_at, updated_at,
       jsonb_pretty(propuesta) as propuesta
  from qualia_trabajos
 where id = :'id' and empresa_id = :'emp';
SQL

# En trabajos de CONCILIACIÓN (casos y sugerencias del cron) el marco es la
# doctrina contable ratificada: el índice viaja entero en el contexto para que
# la jerarquía P-003 y los hechos H-XX estén delante ANTES de razonar — el
# sesgo de citar DGII donde tocaba contabilidad nació de tener solo impuestos
# a mano. En facturas normales alcanza el puntero (una línea, cero cuota).
tipo_fila=$(sql -t -A -v id="$ID" -v emp="$QUALIA_EMPRESA_ID" <<'SQL'
select tipo || '|' || coalesce(origen, '') from qualia_trabajos
 where id = :'id' and empresa_id = :'emp';
SQL
)
case "$tipo_fila" in
  caso\|*|*\|cron_conciliacion)
    if [ -f /nucleo-contable/doctrina/INDEX.md ]; then
      echo
      echo "=== DOCTRINA CONTABLE (ratificada — P-003: la DGII no decide cuentas) ==="
      cat /nucleo-contable/doctrina/INDEX.md
    fi
    ;;
  *)
    echo
    echo "(doctrina contable: /nucleo-contable/doctrina/INDEX.md — leela antes de cualquier asiento de conciliación)"
    ;;
esac

echo
echo "=== HILO (últimos 30 eventos, viejo→nuevo) ==="
sql -v id="$ID" <<'SQL'
select to_char(e.created_at, 'MM-DD HH24:MI') || '  ' || e.autor || '/' ||
       e.tipo || ': ' || e.contenido
  from (select * from qualia_eventos where trabajo_id = :'id'
        order by id desc limit 30) e
 order by e.id;
SQL

RASTRO="/tmp/mesa/$ID/clasificacion.json"
if [ -f "$RASTRO" ]; then
  echo
  echo "=== PROPONEDOR DETERMINISTA (por qué no propuso él) ==="
  cat "$RASTRO"
fi

DOSSIER="/tmp/mesa/$ID/dossier.json"
echo
if [ -f "$DOSSIER" ]; then
  echo "=== DOSSIER DEL PREPARADOR ==="
  cat "$DOSSIER"
else
  echo "=== SIN DOSSIER (protocolo completo: descargá y extraé vos) ==="
fi

# El precedente, ya corrido: por RNC si el dossier lo trae, si no por el nombre
# extraído. Sin ninguno de los dos no se adivina — buscá vos con otro término.
if [ -f "$DOSSIER" ]; then
  TERMINO=$(python3 - "$DOSSIER" 2>/dev/null <<'PY'
import json, sys
e = (json.load(open(sys.argv[1])).get("extraccion") or {})
print(e.get("rnc") or e.get("proveedor") or "")
PY
)
  if [ -n "${TERMINO:-}" ]; then
    echo
    echo "=== PRECEDENTE (buscar-precedente.py \"$TERMINO\") ==="
    python3 "$AQUI/buscar-precedente.py" "$TERMINO" 2>&1
  fi
fi
