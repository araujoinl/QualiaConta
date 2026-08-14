#!/bin/bash
# Avisa por WhatsApp cuando algo del contable se detiene en silencio.
#
# Por qué existe: la auditoría del 2026-08-14 encontró CUATRO fallas
# independientes con cero alertas — siete noches de destilación perdidas, doce
# días de espejo de cuentas congelado, nueve días de mediana en la cola sin
# decidir, y cincuenta y tres anulaciones en ADM en un día. Las cuatro se
# descubrían leyendo un log por ssh, o sea que en la práctica no se descubrían.
# `alerta-cuota.sh` ya resolvió este problema para la cuota del LLM; esto es su
# hermano para la salud del resto.
#
# DIARIO, no cada dos minutos. Es la diferencia clave con el de la cuota: un
# tope de z.AI es un evento y hay que saberlo al instante; una cola de nueve
# días es un estado, y preguntarle cada dos minutos manda cientos de mensajes
# iguales por un hecho que no cambia. El que recibe cientos de mensajes iguales
# deja de leerlos, y el día que importe tampoco lo va a leer.
#
# Avisa SOLO en los cruces (sano→roto, roto→sano), igual que el de la cuota, así
# que una cola vieja que dura una semana es UN mensaje, no siete. El estado
# anterior vive en $ESTADO.
#
# Lo que NO hace: no toca nada. Mira y avisa. Arreglar lo que encuentre es
# decisión de un humano — reabrir un trabajo o decidir una propuesta parada son
# actos contables, no de mantenimiento.
#
# Destino: /home/codebox/qualia-salud.log
# Cron:    0 12 * * *  (8:00 AM hora RD, crontab de codebox)
# Requiere: docker en el host (lee la base por el contenedor de la mesa, que ya
#           tiene QUALIA_DSN adentro — acá nunca se toca la credencial) y las
#           WSNOTIFY_* del colector, que ya están en ese .env.

set -u

ESTADO="${QUALIA_SALUD_ESTADO:-/home/codebox/.qualia-alerta-salud}"
LOG="${QUALIA_SALUD_LOG:-/home/codebox/qualia-salud.log}"
WSNOTIFY_ENV="${WSNOTIFY_ENV:-/home/codebox/colector-bancos/.env}"
HERMES="${QUALIA_HERMES_DIR:-/home/codebox/qualiaconta/repo/empresas/blackbox/hermes}"
LOG_MAX_BYTES="${QUALIA_SALUD_LOG_MAX:-2097152}"

# Umbrales. Se cambian por env sin tocar el archivo.
#
# 5 días para la cola: el p50 medido era 9 días y el objetivo son 48 horas, así
# que 5 avisa antes de que se vuelva crónico sin sonar por un fin de semana
# largo. 48 horas para los archivos: el refresco es diario, así que dos vueltas
# perdidas ya es un patrón y no un tropiezo.
COLA_DIAS="${QUALIA_COLA_DIAS:-5}"
ARCHIVO_HORAS="${QUALIA_ARCHIVO_HORAS:-48}"

log() { printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG" 2>/dev/null; }

tam=$(stat -c %s "$LOG" 2>/dev/null || echo 0)
[ "$tam" -gt "$LOG_MAX_BYTES" ] && mv -f "$LOG" "$LOG.1" 2>/dev/null

CONTENEDOR=$(docker ps --format '{{.Names}}' 2>/dev/null | grep '^qualiaconta-mesa-' | head -1)
if [ -z "$CONTENEDOR" ]; then
  log "no hay contenedor de mesa corriendo; no puedo revisar nada"
  exit 0
fi

# Idéntico al de la cuota: las credenciales se leen en un subshell y no se
# imprimen ni viajan por la línea de comandos.
avisar() {
  local texto="$1" seguro rc
  seguro=$(printf '%s' "$texto" | tr -d '\\"' | tr '\n' ' ')
  (
    set -a; . "$WSNOTIFY_ENV" 2>/dev/null || true; set +a
    if [ -z "${WSNOTIFY_BASE_URL:-}" ] || [ -z "${WSNOTIFY_API_KEY:-}" ] || [ -z "${WSNOTIFY_OTP_DESTINO:-}" ]; then
      exit 2
    fi
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

nuevo_estado=$(mktemp) || exit 0
trap 'rm -f "$nuevo_estado"' EXIT

# $1 = clave, $2 = si|no (roto), $3 = mensaje cuando se rompe,
# $4 = mensaje cuando se arregla. Sólo habla en el cruce.
revisar() {
  local clave="$1" roto="$2" msg_roto="$3" msg_sano="$4" previo
  previo=$(awk -F'\t' -v k="$clave" '$1==k {print $2}' "$ESTADO" 2>/dev/null)
  printf '%s\t%s\n' "$clave" "$roto" >>"$nuevo_estado"

  # Primera corrida: se registra y no se avisa, para no disparar un WhatsApp
  # por instalar el script. Mismo criterio que el de la cuota.
  if [ -z "$previo" ]; then
    log "estado inicial de ${clave}: ${roto}"
    return 0
  fi
  [ "$previo" = "$roto" ] && return 0
  if [ "$roto" = "si" ]; then avisar "$msg_roto"; else avisar "$msg_sano"; fi
  log "${clave}: ${previo} -> ${roto}"
}

consulta() {
  docker exec "$CONTENEDOR" sh -c "psql \"\$QUALIA_DSN\" -t -A -c \"$1\"" 2>/dev/null
}

# ------------------------------------------------------------------ 1. la cola
# Propuestas sin decidir y su antigüedad. El monto va en el mensaje porque es lo
# que convierte "hay cosas pendientes" en "hay dos millones y medio parados".
fila=$(consulta "select count(*), coalesce(max(extract(epoch from (now()-created_at))/86400)::int,0), coalesce(round(sum(abs((propuesta->>'monto')::numeric))),0) from qualia_trabajos where estado='propuesta'")
cola_n=$(echo "$fila" | cut -d'|' -f1)
cola_dias=$(echo "$fila" | cut -d'|' -f2)
cola_monto=$(echo "$fila" | cut -d'|' -f3)

if [ -n "${cola_dias:-}" ] && [ "$cola_dias" -ge "$COLA_DIAS" ] 2>/dev/null; then
  revisar "cola_vieja" "si" \
    "Hay ${cola_n} propuestas esperando decisión en la mesa; la más vieja lleva ${cola_dias} días y entre todas suman RD\$${cola_monto}. Nada se registra hasta que las decidas." \
    ""
else
  revisar "cola_vieja" "no" "" \
    "La cola de la mesa volvió a estar al día: nada esperando más de ${COLA_DIAS} días."
fi

# ------------------------------------- 2. plata que se cayó de ADM y quedó sola
# El aviso NO es "se anuló un documento": anular es normal y casi siempre es el
# paso previo a registrar bien. Lo que importa es el movimiento que quedó SIN
# ningún documento vivo que lo ampare — ahí sí hay plata fuera de la
# contabilidad. La distinción se midió el 2026-08-14: de los 55 movimientos de
# trabajos con documento muerto, los 55 ya estaban amparados por el documento
# consolidado que los reemplazó. Avisar por la anulación habría gritado 55 veces
# por cero pesos perdidos.
huerfanos=$(consulta "with muertos as (select id, propuesta from qualia_trabajos where coalesce(propuesta->'registro_adm'->>'anulado_en','')<>'' or coalesce(propuesta->'registro_adm'->>'eliminado_en','')<>''), movs as (select distinct tx from (select m.propuesta->>'banco_tx_id' as tx from muertos m union all select e.v from muertos m cross join lateral jsonb_array_elements_text(coalesce(m.propuesta->'movimientos','[]'::jsonb)) as e(v)) u where tx is not null) select count(*) from movs s join openbanking_transactions t on t.id=s.tx::uuid where t.qualia_trabajo_id is null")

if [ -n "${huerfanos:-}" ] && [ "$huerfanos" -gt 0 ] 2>/dev/null; then
  revisar "movimientos_huerfanos" "si" \
    "Se cayeron documentos de ADM y ${huerfanos} movimiento(s) del banco quedaron sin ningún papel que los cubra. Esa plata está fuera de la contabilidad hasta que se rehaga." \
    ""
else
  revisar "movimientos_huerfanos" "no" "" \
    "Ya no queda plata del banco sin documento por documentos caídos."
fi

# ------------------------------------------- 3 y 4. los archivos que se enfrían
# Un archivo que deja de actualizarse no rompe nada visible: el contable sigue
# contestando, sólo que con datos viejos. Es la falla más cara de detectar y la
# más barata de vigilar — es una fecha de modificación.
vencido() {
  local ruta="$1" horas="$2" mtime ahora
  [ -f "$ruta" ] || { echo "si"; return; }
  mtime=$(stat -c %Y "$ruta" 2>/dev/null || echo 0)
  ahora=$(date -u +%s)
  if [ $(( (ahora - mtime) / 3600 )) -ge "$horas" ]; then echo "si"; else echo "no"; fi
}

edad_horas() {
  local mtime ahora
  [ -f "$1" ] || { echo "?"; return; }
  mtime=$(stat -c %Y "$1" 2>/dev/null || echo 0)
  ahora=$(date -u +%s)
  echo $(( (ahora - mtime) / 3600 ))
}

LIBRETA="$HERMES/preentrenamiento/agg/proveedor-cuentas.json"
revisar "precedentes_congelados" "$(vencido "$LIBRETA" "$ARCHIVO_HORAS")" \
  "La libreta de precedentes del contable lleva $(edad_horas "$LIBRETA") horas sin actualizarse. De ahí saca la cuenta de cada factura: con la libreta vieja, un proveedor nuevo le sale como desconocido aunque ya tenga historia en ADM." \
  "La libreta de precedentes volvió a actualizarse."

CUENTAS="$HERMES/preentrenamiento/raw/accounts.jsonl"
revisar "cuentas_congeladas" "$(vencido "$CUENTAS" "$ARCHIVO_HORAS")" \
  "El espejo del plan de cuentas lleva $(edad_horas "$CUENTAS") horas sin refrescarse. El contable no puede proponer una cuenta creada después de esa fecha, y el síntoma es el peor: no falla, elige la más parecida." \
  "El espejo del plan de cuentas volvió a refrescarse."

# Se reemplaza entero y sólo al final: si algo falló a mitad, el estado viejo
# sigue siendo el bueno y mañana se reintenta.
if [ -s "$nuevo_estado" ]; then
  cp -f "$nuevo_estado" "$ESTADO" 2>/dev/null
fi

log "revisión terminada (cola=${cola_n:-?} de ${cola_dias:-?}d, huerfanos=${huerfanos:-?})"
