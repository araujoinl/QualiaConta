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

CONTENEDOR=qualiaconta-blackbox
SCRIPTS=/opt/data/memoria/scripts
LOG=/home/codebox/qualia-precedentes.log
TOPE_LOG=$((2 * 1024 * 1024))
AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

exec 9>/tmp/refrescar-precedentes.lock
if ! flock -n 9; then
    echo "$(date -u +%FT%TZ) ya hay una corrida en curso, salgo" >>"$LOG"
    exit 0
fi

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

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTENEDOR"; then
    registrar "ERROR: el contenedor $CONTENEDOR no esta corriendo, no refresco nada"
    "$AQUI/registrar-corrida.sh" precedentes "$INICIO" "$(date -u +%FT%TZ)" false 1 '{}' "$CORRIDA"
    exit 1
fi

# --desde es lo que fuerza el modo delta: re-pagina el listado desde el
# principio y agrega SOLO los IDs que no estaban (el detalle ya bajado no se
# vuelve a pedir). La fecha en si es apenas un registro en estado.json.
DESDE=$(date -u +%F)
fallas=0

for recurso in vendor-bills vendors; do
    registrar "bajando $recurso (delta)"
    if salida=$(docker exec "$CONTENEDOR" python3 "$SCRIPTS/extraer-adm.py" \
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
if salida=$(docker exec "$CONTENEDOR" python3 "$SCRIPTS/generar-proveedor-cuentas.py" 2>&1); then
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

[ "$fallas" -eq 0 ]
