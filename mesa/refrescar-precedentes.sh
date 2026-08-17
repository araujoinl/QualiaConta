#!/usr/bin/env bash
# Refresca la libreta de precedentes que el contable consulta para clasificar
# la cuenta de cada factura.
#
# Por que existe: el destilado (generar-proveedor-cuentas.py) ya corria todas
# las noches, pero sobre una copia cruda que nadie actualizaba — re-destilaba
# siempre las mismas 1,050 facturas. Daba sensacion de estar fresco sin estarlo,
# y cada proveedor nuevo seguia saliendo como "no lo conozco" aunque ya tuviera
# historia en ADM. Esto baja primero lo nuevo y despues destila.
#
# Solo GET contra ADM Cloud. Corre en el host (necesita docker); el trabajo real
# pasa dentro del contenedor, que es donde viven las credenciales y las rutas.
#
# Al cerrar deja la corrida en qualia_actualizaciones (ver registrar-corrida.sh)
# para que se vea desde la web sin entrar por ssh a leer este log.

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
    # Se lee acá y no se exporta al resto del script más de lo necesario.
    ( set -a; . "$REPO_EMPRESA/.env"; set +a; python3 "$@" )
}
LOG=/home/codebox/qualia-precedentes.log
TOPE_LOG=$((2 * 1024 * 1024))
AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# El log es de por vida: si crece, se conserva la mitad reciente.
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt "$TOPE_LOG" ]; then
    tail -c $((TOPE_LOG / 2)) "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

# Buffer con SOLO esta corrida: es lo que se guarda como detalle en la
# bitacora. El log de por vida sigue recibiendo todo igual.
CORRIDA=$(mktemp)
trap 'rm -f "$CORRIDA"' EXIT

INICIO=$(date -u +%FT%TZ)

registrar() { echo "$(date -u +%FT%TZ) $*" | tee -a "$CORRIDA" >>"$LOG"; }
volcar()    { sed "s/^/  /" | tee -a "$CORRIDA" >>"$LOG"; }

registrar "=== inicio ==="

# COMPARTE EL CANDADO con refrescar-recurrentes.sh, a propósito: los dos
# escriben el mismo volcado y pisarse deja el archivo a medias.
#
# Pero ESPERA en vez de rendirse, y ésa es la corrección del 2026-08-14. Con
# `flock -n` el diario perdía siempre: corre una vez por día contra las 288
# corridas del otro, así que la probabilidad de encontrarlo tomado no es
# despreciable, es lo normal. Perdió SIETE noches seguidas y en cada una escribió
# «ya hay una corrida en curso, salgo» y devolvió éxito, así que la libreta de
# precedentes —de donde sale la mayoría de los aciertos del contable— dejó de
# actualizarse una semana sin que nadie se enterara.
#
# El otro conserva su `-n`: es barato, corre cada 5 minutos y saltear una vuelta
# no cuesta nada. El caro es éste.
#
# 600s es holgado: la corrida del otro son segundos. Si de verdad no se consigue
# en diez minutos, algo está trabado y eso SÍ hay que verlo — por eso no sale
# más con exit 0, sale por el mismo camino que cualquier otra falla y queda en
# la bitácora que se lee desde la web.
exec 9>/tmp/refrescar-precedentes.lock
if ! flock -w 600 9; then
    registrar "ERROR: no pude tomar el candado en 600s — el refresh de recurrentes quedó trabado"
    "$AQUI/registrar-corrida.sh" precedentes "$INICIO" "$(date -u +%FT%TZ)" false 1 '{}' "$CORRIDA"
    exit 1
fi

if [ ! -f "$REPO_EMPRESA/.env" ]; then
    registrar "ERROR: falta $REPO_EMPRESA/.env (credenciales de ADM), no refresco nada"
    "$AQUI/registrar-corrida.sh" precedentes "$INICIO" "$(date -u +%FT%TZ)" false 1 '{}' "$CORRIDA"
    exit 1
fi

# --desde es lo que fuerza el modo delta: re-pagina el listado desde el
# principio y agrega SOLO los IDs que no estaban (el detalle ya bajado no se
# vuelve a pedir). La fecha en si es apenas un registro en estado.json.
DESDE=$(date -u +%F)
fallas=0

# bank-transfers no alimenta la libreta de precedentes: es el espejo con el que
# sugerir-transferencias.sh sabe que una transferencia entre cuentas propias YA
# esta registrada en ADM y no la vuelve a proponer. Sin refrescarlo, el detector
# duplicaria todo lo asentado despues del ultimo snapshot. Son 203 docs y solo
# GET: cuesta nada bajarlo con los otros dos.
#
# bill-payments y account-payments entran por la misma razon, y responden LA
# pregunta que decide que hacer con una salida del banco que no es cargo
# bancario: ¿ya la registro el humano? El banco escribe "Nota De Debito" a secas
# y jamas dice a quien se le pago, asi que clasificarla por su descripcion es
# imposible; lo unico que lo resuelve es preguntarle a ADM. Si esta registrada,
# no hay nada que proponer (a lo sumo falta el volante del impuesto); si no
# esta, es un pago que nadie asento —un prestamo, un abono a linea de credito— y
# ahi si hay trabajo. Sus espejos estaban CONGELADOS en el volcado inicial
# (2026-08-02), o sea que el cruce habria dicho "no registrado" para todo lo
# posterior a esa fecha: la misma trampa que ya habia mordido a bank-transfers.
# `accounts` entra el 2026-08-14, también por auditoría. El espejo del plan de
# cuentas era lo ÚNICO que nadie refrescaba: quedó congelado en el volcado
# inicial del 2026-08-02 y le faltaba la 220.06 — justo la cuenta que sostiene
# el C-002, el criterio vivo. Un contable que clasifica contra un catálogo de
# hace doce días no puede proponer una cuenta creada ayer, y el síntoma es el
# peor de todos: no falla, elige la más parecida.
for recurso in vendor-bills vendors bank-transfers bill-payments account-payments accounts; do
    registrar "bajando $recurso (delta)"
    if salida=$(hermes_py "$SCRIPTS/extraer-adm.py" \
                    --solo "$recurso" --desde "$DESDE" 2>&1); then
        echo "$salida" | volcar
    else
        registrar "ERROR bajando $recurso:"
        echo "$salida" | volcar
        fallas=$((fallas + 1))
    fi
done

# Se destila igual aunque una bajada falle: mejor una libreta con lo que si
# llego que ninguna. Pero el exit code lo refleja.
registrar "destilando la cuenta contable (de esta empresa)"
if salida=$(hermes_py "$SCRIPTS/generar-proveedor-cuentas.py" 2>&1); then
    echo "$salida" | volcar
else
    registrar "ERROR destilando cuentas:"
    echo "$salida" | volcar
    fallas=$((fallas + 1))
fi

# El tipo de gasto del 606 no es de esta empresa sino de la DGII: se destila
# aparte, por RNC, recorriendo TODAS las empresas que tengan historico. Corre en
# el host y no en el contenedor porque escribe en nucleo-contable/, que adentro
# esta montado :ro.
registrar "destilando el tipo de gasto (general, todas las empresas)"
if salida=$(python3 /home/codebox/qualiaconta/repo/nucleo-contable/scripts/generar-rnc-tipo-gasto.py 2>&1); then
    echo "$salida" | volcar
else
    registrar "ERROR destilando tipos de gasto:"
    echo "$salida" | volcar
    fallas=$((fallas + 1))
fi

registrar "=== fin (fallas: $fallas) ==="

# Los numeros de la corrida, para que la web muestre un resumen sin re-parsear
# el log. Lo que no aparezca queda en null: el detalle crudo va igual.
#
# Primero se ubica la LINEA de cada paso y despues se saca cada numero de ella.
# Buscar la metrica suelta en todo el buffer mezclaba pasos (los dos destilados
# hablan de "facturas"), y un patron rigido de la linea entera se rompe cada vez
# que un destilador suma una metrica.
linea()  { grep -m1 -F "$1" "$CORRIDA" || true; }
numero() { local v; v=$(echo "$1" | grep -oE "$2" | head -1 | grep -oE '[0-9]+' | head -1); echo "${v:-null}"; }

l_bills=$(linea '[vendor-bills] delta:')
l_vendors=$(linea '[vendors] delta:')
l_cuentas=$(linea 'con RNC')
l_tipos=$(linea 'con tipo dominante')

vb_nuevas=$(numero "$l_bills" 'delta: [0-9]+')
vb_total=$(numero "$l_bills" '\([0-9]+ en archivo')
vn_nuevas=$(numero "$l_vendors" 'delta: [0-9]+')
vn_total=$(numero "$l_vendors" '\([0-9]+ en archivo')

d_prov=$(numero "$l_cuentas" '[0-9]+ proveedores')
d_rnc=$(numero "$l_cuentas" '[0-9]+ con RNC')
d_ctas=$(numero "$l_cuentas" '[0-9]+ cuentas')
d_fact=$(numero "$l_cuentas" '[0-9]+ facturas')
d_sin=$(numero "$l_cuentas" '[0-9]+ sin cuenta')

n_supl=$(numero "$l_tipos" '[0-9]+ suplidores')
n_tipo=$(numero "$l_tipos" '[0-9]+ con tipo dominante')

resumen=$(printf '{"vendor_bills":{"nuevas":%s,"total":%s},"vendors":{"nuevas":%s,"total":%s},"destilado":{"proveedores":%s,"con_rnc":%s,"cuentas":%s,"facturas":%s,"sin_cuenta":%s},"nucleo":{"suplidores":%s,"con_tipo":%s}}' \
    "$vb_nuevas" "$vb_total" "$vn_nuevas" "$vn_total" \
    "$d_prov" "$d_rnc" "$d_ctas" "$d_fact" "$d_sin" \
    "$n_supl" "$n_tipo")

if [ "$fallas" -eq 0 ]; then ok=true; else ok=false; fi
"$AQUI/registrar-corrida.sh" precedentes "$INICIO" "$(date -u +%FT%TZ)" "$ok" "$fallas" "$resumen" "$CORRIDA"

# ── Puente de espejos a la nube (F1, salida de Hermes) ───────────────────────
# Los detectores serverless leen estos mismos jsonl del bucket privado
# qualia-espejos; sin este paso la sombra trabaja con espejos viejos y
# qualia-salud lo marca como congelado a las 48h. Solo en corrida verde.
# TODO(F5): empresa hardcodeada como el resto del script — multiempresa lo
# resuelve el port completo de este refrescador a function.
if [ "$fallas" -eq 0 ]; then
    NUBE_URL="https://uzvnluxxaekmaqnuocvo.supabase.co"
    NUBE_KEY=$(grep -m1 '^SUPABASE_SERVICE_ROLE_KEY=' /home/codebox/colector-bancos/.env | cut -d= -f2- | tr -d '"')
    NUBE_EMP="1de77ce6-ed98-4a96-8b1f-d8b902f11cd5"
    NUBE_RAW="/home/codebox/qualiaconta/repo/empresas/blackbox/hermes/preentrenamiento/raw"
    NUBE_AGG="/home/codebox/qualiaconta/repo/empresas/blackbox/hermes/preentrenamiento/agg"
    NUBE_REPO="/home/codebox/qualiaconta/repo"
    if [ -n "$NUBE_KEY" ]; then
        subidas=0
        esperadas=0
        nube_sube() {
            esperadas=$((esperadas+1))
            [ -f "$1" ] || return 0
            code=$(curl -s -o /dev/null -w '%{http_code}' -m 120 -X POST \
                "$NUBE_URL/storage/v1/object/qualia-espejos/$2" \
                -H "Authorization: Bearer $NUBE_KEY" -H 'x-upsert: true' \
                -H 'Content-Type: application/octet-stream' --data-binary @"$1")
            [ "$code" = "200" ] && subidas=$((subidas+1))
        }
        for f in accounts.jsonl bank-transfers-detalle.jsonl vendor-bills-detalle.jsonl \
                 vendors.jsonl bill-payments.jsonl account-payments.jsonl \
                 bank-charges.jsonl bank-charges-detalle.jsonl; do
            nube_sube "$NUBE_RAW/$f" "espejo-adm/$NUBE_EMP/$f"
        done
        # Lo que el proponedor serverless necesita además de los crudos:
        # el agg destilado, la memoria curada y el catálogo nacional del 606.
        nube_sube "$NUBE_AGG/proveedor-cuentas.json" "espejo-adm/$NUBE_EMP/agg/proveedor-cuentas.json"
        nube_sube "$NUBE_AGG/plan-cuentas.json" "espejo-adm/$NUBE_EMP/agg/plan-cuentas.json"
        nube_sube "$NUBE_REPO/empresas/blackbox/hermes/memoria/proveedores.md" "espejo-adm/$NUBE_EMP/memoria/proveedores.md"
        nube_sube "$NUBE_REPO/nucleo-contable/agg/rnc-tipo-gasto.json" "nucleo/agg/rnc-tipo-gasto.json"
        # La marca solo se renueva si TODOS subieron: una marca fresca con
        # espejos viejos es el falso verde que qualia-salud existe para ver.
        if [ "$subidas" -eq "$esperadas" ]; then
            curl -s -o /dev/null -m 30 -X PATCH \
                "$NUBE_URL/rest/v1/qualia_config?empresa_id=is.null&clave=eq.refresco_precedentes" \
                -H "apikey: $NUBE_KEY" -H "Authorization: Bearer $NUBE_KEY" \
                -H 'Content-Type: application/json' \
                -d "{\"valor\": {\"en\": \"$(date -u +%FT%TZ)\"}, \"actualizado_por\": \"refrescar-precedentes.sh (puente de espejos)\"}"
        fi
    fi
fi

[ "$fallas" -eq 0 ]
