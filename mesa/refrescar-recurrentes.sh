#!/usr/bin/env bash
# Trae las facturas nuevas de ADM y vuelve a mirar los recurrentes. Cada hora.
#
# Por qué existe: `sugerir-recurrentes.sh` no le pregunta a ADM, lee el volcado
# `vendor-bills-detalle.jsonl`. Correrlo más seguido sin refrescar ese archivo
# daría exactamente el mismo resultado hasta el día siguiente — la caja diría
# «todavía no facturó» durante horas después de que la factura ya entró. El
# chequeo horario tiene sentido sólo con la bajada pegada adelante.
#
# Baja SÓLO vendor-bills, que es lo único que el detector lee. El refresh diario
# (`refrescar-precedentes.sh`) sigue trayendo los otros cuatro recursos y
# destilando la libreta: eso no hace falta cada hora y multiplicaría por 24 el
# tráfico contra ADM sin que nadie lo aproveche.
#
# COMPARTE EL CANDADO con el refresh diario, a propósito: los dos escriben el
# mismo volcado y a las 5:20 se cruzarían. Con `flock -n`, la corrida horaria de
# esa hora se saltea en silencio — el refresh diario ya bajó lo mismo y va a
# dejar el archivo mejor de lo que lo dejaría ésta.
#
# Solo GET contra ADM. Corre en el host (necesita docker); el trabajo pasa dentro
# del contenedor, que es donde viven las credenciales y las rutas.

set -uo pipefail

CONTENEDOR=qualiaconta-blackbox
SCRIPTS=/opt/data/memoria/scripts
LOG=/home/codebox/qualia-recurrentes.log
TOPE_LOG=$((2 * 1024 * 1024))

exec 9>/tmp/refrescar-precedentes.lock
if ! flock -n 9; then
    echo "$(date -u +%FT%TZ) el refresh diario está corriendo, salgo" >>"$LOG"
    exit 0
fi

# El log es de por vida: si crece, se conserva la mitad reciente. Mismo trato que
# el del refresh diario.
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt "$TOPE_LOG" ]; then
    tail -c $((TOPE_LOG / 2)) "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

registrar() { echo "$(date -u +%FT%TZ) $*" >>"$LOG"; }

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTENEDOR"; then
    registrar "ERROR: el contenedor $CONTENEDOR no está corriendo"
    exit 1
fi

# --desde fuerza el modo delta: re-pagina el listado y agrega sólo los IDs que no
# estaban. El detalle ya bajado no se vuelve a pedir.
if ! salida=$(docker exec "$CONTENEDOR" python3 "$SCRIPTS/extraer-adm.py" \
                  --solo vendor-bills --desde "$(date -u +%F)" 2>&1); then
    registrar "ERROR bajando vendor-bills:"
    echo "$salida" | sed "s/^/  /" >>"$LOG"
    exit 1
fi

# Sólo se registra la bajada cuando trajo algo: una línea por hora diciendo «0
# filas nuevas» son 24 al día que tapan las que importan.
if ! grep -q "0 filas nuevas" <<<"$salida"; then
    echo "$salida" | sed "s/^/  /" >>"$LOG"
fi

# El detector es silencioso cuando no hay nada que cambiar, así que su salida se
# registra tal cual: si escribió algo, pasó algo.
if resultado=$(docker exec "$CONTENEDOR" /opt/data/scripts/sugerir-recurrentes.sh 2>&1); then
    [ -n "$resultado" ] && registrar "$resultado"
else
    registrar "ERROR en sugerir-recurrentes:"
    echo "$resultado" | sed "s/^/  /" >>"$LOG"
    exit 1
fi

exit 0
