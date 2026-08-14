#!/usr/bin/env bash
# Trae las facturas nuevas de ADM y vuelve a mirar los recurrentes. Cada hora.
#
# Por qué existe: `sugerir-recurrentes.sh` no le pregunta a ADM, lee el volcado
# `vendor-bills-detalle.jsonl`. Correrlo más seguido sin refrescar ese archivo
# daría exactamente el mismo resultado hasta el día siguiente — la caja diría
# «todavía no facturó» durante horas después de que la factura ya entró. El
# chequeo horario tiene sentido sólo con la bajada pegada adelante.
#
# Y una vez por hora vuelve a preguntar por las facturas del mes en curso y el
# anterior, para enterarse de las ANULACIONES: el delta agrega documentos
# nuevos, y anular no crea uno nuevo — cambia uno viejo, que la copia local ya
# tenía y por eso nunca volvía a mirar.
#
# Baja SÓLO vendor-bills, que es lo único que el detector lee. El refresh diario
# (`refrescar-precedentes.sh`) sigue trayendo los otros cuatro recursos y
# destilando la libreta: eso no hace falta cada hora y multiplicaría por 24 el
# tráfico contra ADM sin que nadie lo aproveche.
#
# COMPARTE EL CANDADO con el refresh diario, a propósito: los dos escriben el
# mismo volcado y a las 5:20 se cruzarían. Ésta se saltea en silencio — el
# refresh diario ya bajó lo mismo y va a dejar el archivo mejor que ésta.
#
# El `-n` es de ÉSTA y sólo de ésta. El diario espera con `-w 600`, porque la
# asimetría manda: éste tiene 288 oportunidades por día y el otro una sola. Con
# los dos en `-n` el que perdía era siempre el diario, y perdió siete noches
# seguidas antes de que alguien lo notara (ver el comentario del candado allá).
#
# Solo GET contra ADM. Corre en el host (necesita docker); el trabajo pasa dentro
# del contenedor, que es donde viven las credenciales y las rutas.

set -uo pipefail

CONTENEDOR=qualiaconta-blackbox
SCRIPTS=/opt/data/memoria/scripts
LOG=/home/codebox/qualia-recurrentes.log
TOPE_LOG=$((2 * 1024 * 1024))
# Cuándo se revisó por última vez si algo se anuló. Es un archivo vacío: lo único
# que se lee es su fecha de modificación.
MARCADOR_ANULACIONES=/home/codebox/.qualia-refresco-anulaciones

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

# Las ANULACIONES no son documentos nuevos: cambian uno viejo, así que el delta
# de arriba —que sólo agrega IDs no vistos— nunca las ve. Sin esto, el volcado
# cuenta como viva una factura que en ADM ya no existe: es lo que sacó a Claro
# de la caja el 2026-08-06, con una anulada del 31/07 rompiéndole el patrón.
#
# Va una vez por HORA y no en cada corrida: son ~90 GET (el mes en curso y el
# anterior) y anular es raro. Corriendo cada 5 minutos serían 26.000 pedidos
# diarios a ADM para enterarse de dos cambios al mes.
#
# Un fallo acá NO corta: el detector corre igual con el volcado que haya. Peor
# que un dato viejo es no volver a mirar a nadie.
if [ ! -f "$MARCADOR_ANULACIONES" ] || [ -n "$(find "$MARCADOR_ANULACIONES" -mmin +55 2>/dev/null)" ]; then
    DESDE_REFRESCO=$(date -u -d "$(date -u +%Y-%m-01) -1 month" +%F)
    if salida=$(docker exec "$CONTENEDOR" python3 "$SCRIPTS/extraer-adm.py" \
                    --solo vendor-bills --refrescar-desde "$DESDE_REFRESCO" 2>&1); then
        touch "$MARCADOR_ANULACIONES"
        # Igual que la bajada: sólo se escribe si algo cambió de verdad.
        if ! grep -q "0 cambiado" <<<"$salida"; then
            grep "refresco desde" <<<"$salida" | sed "s/^/  /" >>"$LOG"
        fi
    else
        registrar "ERROR refrescando anulaciones (sigo con el detector):"
        echo "$salida" | sed "s/^/  /" >>"$LOG"
    fi
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

# Anticipo ISR: NO se sugiere por acá. El flujo vive en la banda de impuestos
# de Labs_Inv (calendarioFiscal clave 'anticipo'), con el gesto doble de subir
# volante+comprobante. El script `sugerir-anticipo-isr.sh` queda en el repo como
# respaldo, pero crear sugerencias acá duplicaría la ficha de la banda.
# Si algún día el anticipo sale de la banda, se vuelve a cablear acá.

exit 0
