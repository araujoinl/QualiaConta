#!/usr/bin/env bash
# Consulta de sólo lectura a ADM Cloud.
#
#   admcloud-get.sh <recurso> [filtros]
#   admcloud-get.sh Items "OnlyActive=true"
#   admcloud-get.sh Customers
#   admcloud-get.sh Customers "skip=50"      <- una sola página, la que pidas
#
# PAGINA SOLO. La API devuelve 50 filas por página; este script recorre todas
# hasta agotarlas y devuelve el conjunto completo. Así un conteo es correcto por
# construcción y no porque alguien se haya acordado de paginar.
#
# Si pasás un `skip=` en los filtros, se respeta y se trae ESA página sola.
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

RECURSO="$RECURSO" FILTROS="$FILTROS" python3 - <<'PY'
import base64, json, os, sys, urllib.parse, urllib.request, urllib.error

BASE      = "https://api.admcloud.net/api"
TOPE_PAGS = 200          # freno de runaway; con página de 50 son 10.000 filas

recurso = os.environ["RECURSO"].strip("/")
filtros = os.environ["FILTROS"].strip("&")

cred = base64.b64encode(
    f'{os.environ["ADMCLOUD_USER"]}:{os.environ["ADMCLOUD_PASSWORD"]}'.encode()
).decode()

fijos = {
    "company": os.environ["ADMCLOUD_COMPANY"],
    "role":    os.environ["ADMCLOUD_ROLE"],
    "appid":   os.environ["ADMCLOUD_APPID"],
}

# Si quien llama fijó un skip, quiere esa página y sólo esa.
pagina_fija = "skip=" in filtros


def desenvolver(datos):
    """La forma cambia según el recurso: arreglo pelado o envuelto en
    Data/data/Items/items. Se normaliza siempre a arreglo."""
    if isinstance(datos, list):
        return datos
    if isinstance(datos, dict):
        for llave in ("Data", "data", "Items", "items"):
            if isinstance(datos.get(llave), list):
                return datos[llave]
        suelto = next((v for v in datos.values() if isinstance(v, list) and v), None)
        if suelto is not None:
            return suelto
        return [datos]          # detalle de un solo elemento
    return [datos]


def pedir(skip):
    partes = [p for p in (filtros,) if p]
    if not pagina_fija:
        partes.append(f"skip={skip}")
    partes.append(urllib.parse.urlencode(fijos))
    url = f"{BASE}/{recurso}?" + "&".join(partes)

    pedido = urllib.request.Request(url, headers={
        "Authorization": f"Basic {cred}",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(pedido, timeout=60) as r:
            return desenvolver(json.loads(r.read().decode("utf-8", "replace")))
    except urllib.error.HTTPError as e:
        detalle = e.read().decode("utf-8", "replace")[:400]
        print(f"ERROR HTTP {e.code} en {recurso}: {detalle}", file=sys.stderr)
        if e.code == 401:
            print("Revisá el role y el appid antes que la contraseña.", file=sys.stderr)
        elif e.code == 403:
            print("El rol no tiene permiso para este recurso. Es esperable: corre recortado.", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError:
        print(f"ERROR: la respuesta de {recurso} no es JSON.", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"ERROR de red en {recurso}: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)


todo, skip, tam_pagina, paginas, cortado = [], 0, None, 0, False

while True:
    filas = pedir(skip)
    todo.extend(filas)
    paginas += 1

    if pagina_fija or not filas:
        break
    if tam_pagina is None:
        tam_pagina = len(filas)
    # Página incompleta = última página.
    if len(filas) < tam_pagina:
        break
    if paginas >= TOPE_PAGS:
        cortado = True
        break
    skip += tam_pagina

json.dump(todo, sys.stdout, ensure_ascii=False, indent=2)
print()

if pagina_fija:
    print(f"({len(todo)} fila(s) desde {recurso}, página pedida a mano)", file=sys.stderr)
elif cortado:
    print(f"(⚠ {len(todo)} fila(s) desde {recurso} en {paginas} páginas — "
          f"SE CORTÓ en el tope; hay más. No lo presentes como total.)", file=sys.stderr)
else:
    print(f"({len(todo)} fila(s) desde {recurso}, {paginas} página(s), completo)", file=sys.stderr)
PY
