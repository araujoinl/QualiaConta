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

# ── Sin gateway: los extractores corren en el HOST ───────────────────────────
# Hermes se apagó el 2026-08-17 y con él murió el `docker exec`. Los scripts no
# necesitaban el contenedor: necesitaban su .env y su ruta de datos, que son de
# la EMPRESA y viven en el server. `hermes_py` reemplaza al exec — misma
# invocación, mismo resultado, sin contenedor.
REPO_EMPRESA="${QUALIA_REPO_EMPRESA:-/home/codebox/qualiaconta/repo/empresas/blackbox}"
SCRIPTS="$REPO_EMPRESA/hermes/memoria/scripts"
export QUALIA_PREENTRENAMIENTO="${QUALIA_PREENTRENAMIENTO:-$REPO_EMPRESA/hermes/preentrenamiento}"

hermes_py() {
    # El .env de la empresa trae las credenciales de ADM y el DSN del banco.
    # Se parsea a mano, NO con `.`: docker env_file no evalúa el archivo, y un
    # valor con espacios (ADMCLOUD_ROLE="Contabilidad Digital") hacía que bash
    # intentara ejecutar la segunda palabra como comando. Mismo criterio que
    # docker: clave=valor literal, sin expansión.
    (
        while IFS= read -r linea || [ -n "$linea" ]; do
            case "$linea" in ''|'#'*|*[!A-Za-z0-9_]*=*) ;; esac
            case "$linea" in ''|'#'*) continue ;; esac
            case "$linea" in *=*) ;; *) continue ;; esac
            clave=${linea%%=*}
            valor=${linea#*=}
            case "$valor" in
                \"*\") valor=${valor#\"}; valor=${valor%\"} ;;
                \'*\') valor=${valor#\'}; valor=${valor%\'} ;;
            esac
            export "$clave=$valor"
        done < "$REPO_EMPRESA/.env"
        python3 "$@"
    )
}
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

if [ ! -f "$REPO_EMPRESA/.env" ]; then
    registrar "ERROR: falta $REPO_EMPRESA/.env (credenciales de ADM)"
    exit 1
fi

# --desde fuerza el modo delta: re-pagina el listado y agrega sólo los IDs que no
# estaban. El detalle ya bajado no se vuelve a pedir.
if ! salida=$(hermes_py "$SCRIPTS/extraer-adm.py" \
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
    if salida=$(hermes_py "$SCRIPTS/extraer-adm.py" \
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

# El DETECTOR ya no corre acá: desde el apagón de Hermes (2026-08-17) vive en
# la nube, dentro de qualia-sugerencias, con su propio cron. Este script quedó
# haciendo lo único que sigue siendo suyo — refrescar el espejo que el detector
# consulta. Correrlo también acá sembraría la misma sugerencia dos veces.

# ── El espejo tiene que SUBIR, no sólo refrescarse acá ───────────────────────
# Y ésa era la mitad que faltaba desde el apagón de Hermes. El detector dejó de
# leer este archivo del disco y pasó a leer su copia del bucket, pero la única
# subida vivía en el refresh diario (`refrescar-precedentes.sh`, 05:20 UTC). O
# sea: este script bajaba las anulaciones cada hora contra un archivo que nadie
# miraba, y el detector de la nube decidía sobre una foto de ADM de hasta 24
# horas. El 2026-08-18 se eliminó la factura de Claro del mes y la caja siguió
# diciendo «Llegó · FP00001134» — no porque no se enterara, sino porque el
# archivo donde ya estaba escrito no había cruzado a la nube.
#
# Sube SÓLO cuando el contenido cambió de verdad, y la huella se compara contra
# la de la última subida EXITOSA, no contra la corrida anterior: así un fallo de
# red se reintenta solo en los 5 minutos siguientes en vez de esperar al día.
# Con ~2 documentos nuevos y un puñado de anulaciones por día, son unas pocas
# subidas de 22 MB en vez de 288.
#
# Un fallo acá no cambia el código de salida: el archivo local quedó bien y el
# detector sigue con el espejo anterior, que es exactamente lo de antes.
ESPEJO_FACTURAS="$QUALIA_PREENTRENAMIENTO/raw/vendor-bills-detalle.jsonl"
MARCADOR_SUBIDA=/home/codebox/.qualia-espejo-facturas-subido
NUBE_URL="https://uzvnluxxaekmaqnuocvo.supabase.co"
NUBE_EMP="1de77ce6-ed98-4a96-8b1f-d8b902f11cd5"

if [ -f "$ESPEJO_FACTURAS" ]; then
    huella=$(md5sum "$ESPEJO_FACTURAS" | cut -d' ' -f1)
    subida=$(cat "$MARCADOR_SUBIDA" 2>/dev/null || echo '')
    if [ "$huella" != "$subida" ]; then
        NUBE_KEY=$(grep -m1 '^SUPABASE_SERVICE_ROLE_KEY=' /home/codebox/colector-bancos/.env | cut -d= -f2- | tr -d '"')
        if [ -z "$NUBE_KEY" ]; then
            registrar "ERROR: no encontré la llave de Supabase, el espejo no sube"
        else
            code=$(curl -s -o /dev/null -w '%{http_code}' -m 300 -X POST \
                "$NUBE_URL/storage/v1/object/qualia-espejos/espejo-adm/$NUBE_EMP/vendor-bills-detalle.jsonl" \
                -H "Authorization: Bearer $NUBE_KEY" -H 'x-upsert: true' \
                -H 'Content-Type: application/octet-stream' --data-binary @"$ESPEJO_FACTURAS")
            if [ "$code" = "200" ]; then
                echo "$huella" >"$MARCADOR_SUBIDA"
                registrar "espejo de facturas subido a la nube"
            else
                registrar "ERROR subiendo el espejo de facturas (HTTP $code), reintento en la próxima corrida"
            fi
        fi
    fi
fi

# Anticipo ISR: NO se sugiere por acá. El flujo vive en la banda de impuestos
# de Labs_Inv (calendarioFiscal clave 'anticipo'), con el gesto doble de subir
# volante+comprobante. El script `sugerir-anticipo-isr.sh` queda en el repo como
# respaldo, pero crear sugerencias acá duplicaría la ficha de la banda.
# Si algún día el anticipo sale de la banda, se vuelve a cablear acá.

exit 0
