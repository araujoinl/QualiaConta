#!/usr/bin/env bash
# Consulta de sólo lectura a ADM Cloud.
#
#   admcloud-get.sh <recurso> [filtros]
#   admcloud-get.sh Items "skip=0&OnlyActive=true"
#   admcloud-get.sh Customers
#
# Devuelve SIEMPRE un arreglo JSON por salida estándar, ya desenvuelto.
# Las credenciales salen del entorno y nunca se imprimen.

set -euo pipefail

RECURSO="${1:?uso: admcloud-get.sh <recurso> [filtros]}"
FILTROS="${2:-}"

: "${ADMCLOUD_COMPANY:?falta ADMCLOUD_COMPANY}"
: "${ADMCLOUD_USER:?falta ADMCLOUD_USER}"
: "${ADMCLOUD_PASSWORD:?falta ADMCLOUD_PASSWORD}"
: "${ADMCLOUD_ROLE:?falta ADMCLOUD_ROLE}"
: "${ADMCLOUD_APPID:?falta ADMCLOUD_APPID}"

BASE="https://api.admcloud.net/api"

RECURSO="$RECURSO" FILTROS="$FILTROS" BASE="$BASE" python3 - <<'PY'
import base64, json, os, sys, urllib.parse, urllib.request, urllib.error

recurso = os.environ["RECURSO"].strip("/")
filtros = os.environ["FILTROS"]
base    = os.environ["BASE"]

params = {
    "company": os.environ["ADMCLOUD_COMPANY"],
    "role":    os.environ["ADMCLOUD_ROLE"],
    "appid":   os.environ["ADMCLOUD_APPID"],
}
consulta = urllib.parse.urlencode(params)
if filtros:
    consulta = filtros + "&" + consulta

url = f"{base}/{recurso}?{consulta}"

cred = base64.b64encode(
    f'{os.environ["ADMCLOUD_USER"]}:{os.environ["ADMCLOUD_PASSWORD"]}'.encode()
).decode()

pedido = urllib.request.Request(url, headers={
    "Authorization": f"Basic {cred}",
    "Accept": "application/json",
})

try:
    with urllib.request.urlopen(pedido, timeout=60) as r:
        cuerpo = r.read().decode("utf-8", "replace")
except urllib.error.HTTPError as e:
    # El cuerpo del error puede no ser JSON: se lee como texto.
    detalle = e.read().decode("utf-8", "replace")[:400]
    print(f"ERROR HTTP {e.code} en {recurso}: {detalle}", file=sys.stderr)
    if e.code == 401:
        print("Revisá el role y el appid antes que la contraseña.", file=sys.stderr)
    elif e.code == 403:
        print("El rol no tiene permiso para este recurso. Es esperable: corre recortado.", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"ERROR de red en {recurso}: {type(e).__name__}: {e}", file=sys.stderr)
    sys.exit(1)

try:
    datos = json.loads(cuerpo)
except json.JSONDecodeError:
    print(f"ERROR: la respuesta no es JSON: {cuerpo[:300]}", file=sys.stderr)
    sys.exit(1)

# La forma de la respuesta cambia según el recurso: a veces arreglo pelado,
# a veces envuelto en Data/data/Items/items. Se desenvuelve siempre igual
# para que quien consuma esto no tenga que adivinar.
if isinstance(datos, list):
    filas = datos
elif isinstance(datos, dict):
    filas = None
    for llave in ("Data", "data", "Items", "items"):
        if isinstance(datos.get(llave), list):
            filas = datos[llave]
            break
    if filas is None:
        # Último recurso: el primer arreglo no vacío que aparezca.
        filas = next((v for v in datos.values() if isinstance(v, list) and v), None)
    if filas is None:
        filas = [datos]   # detalle de un solo elemento
else:
    filas = [datos]

json.dump(filas, sys.stdout, ensure_ascii=False, indent=2)
print()
print(f"({len(filas)} fila(s) desde {recurso})", file=sys.stderr)
PY
