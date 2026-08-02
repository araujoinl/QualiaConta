#!/usr/bin/env bash
# Devuelve el último pago (Recibo de Ingreso) de un cliente.
#
#   ultimo-pago-cliente.sh "JFD"
#   ultimo-pago-cliente.sh "92b389b9-184a-4158-6590-08dd15eefa87"
#
# Acepta nombre parcial o ID. Si es nombre, busca en Customers (cache local
# en /tmp/admcloud-customers.json, válido 24h). Luego llama CashReceipts con
# filtro RelationshipID y skip=0 (primera página = más reciente). Devuelve
# JSON con los datos clave del último recibo.

set -euo pipefail

BUSQUEDA="${1:?uso: ultimo-pago-cliente.sh <nombre-o-id>}"

: "${ADMCLOUD_COMPANY:?falta ADMCLOUD_COMPANY}"
: "${ADMCLOUD_USER:?falta ADMCLOUD_USER}"
: "${ADMCLOUD_PASSWORD:?falta ADMCLOUD_PASSWORD}"
: "${ADMCLOUD_ROLE:?falta ADMCLOUD_ROLE}"
: "${ADMCLOUD_APPID:?falta ADMCLOUD_APPID}"

BUSQUEDA="$BUSQUEDA" python3 - "$@" <<'PY'
import base64, json, os, sys, time, urllib.parse, urllib.request, urllib.error

BASE = "https://api.admcloud.net/api"
busqueda = os.environ["BUSQUEDA"].strip()

cred = base64.b64encode(
    f'{os.environ["ADMCLOUD_USER"]}:{os.environ["ADMCLOUD_PASSWORD"]}'.encode()
).decode()
fijos = {
    "company": os.environ["ADMCLOUD_COMPANY"],
    "role":    os.environ["ADMCLOUD_ROLE"],
    "appid":   os.environ["ADMCLOUD_APPID"],
}

def api_get(recurso, params_extra=None):
    params = dict(fijos)
    if params_extra:
        params.update(params_extra)
    url = f"{BASE}/{recurso}?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "Authorization": f"Basic {cred}",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        datos = json.loads(r.read().decode("utf-8", "replace"))
    if isinstance(datos, list):
        return datos
    for k in ("Data", "data", "Items", "items"):
        if isinstance(datos.get(k), list):
            return datos[k]
    return [datos]

# --- 1. Resolver el ID del cliente ---
es_guid = len(busqueda) == 36 and busqueda.count("-") == 4
CACHE = "/tmp/admcloud-customers.json"

if es_guid:
    customer_id = busqueda
    customer_name = busqueda
else:
    customer_id = None
    usar_cache = False
    if os.path.exists(CACHE):
        edad = time.time() - os.path.getmtime(CACHE)
        if edad < 86400:
            usar_cache = True

    if usar_cache:
        with open(CACHE) as f:
            custs = json.load(f)
    else:
        custs = []
        skip = 0
        while True:
            pagina = api_get("Customers", {"skip": skip})
            custs.extend(pagina)
            if len(pagina) < 50:
                break
            skip += 50
        with open(CACHE, "w") as f:
            json.dump(custs, f, ensure_ascii=False)

    busqueda_upper = busqueda.upper()
    for c in custs:
        nombre = (c.get("Name") or "").upper()
        codigo = (c.get("Code") or "").upper()
        short  = (c.get("ShortName") or "").upper()
        fiscal = (c.get("FiscalID") or "").upper()
        if busqueda_upper in nombre or busqueda_upper in codigo or busqueda_upper in short or busqueda_upper in fiscal:
            customer_id = c.get("ID")
            customer_name = c.get("Name")
            break

    if not customer_id:
        print(json.dumps({"error": f"No se encontro cliente con '{busqueda}'"}, ensure_ascii=False))
        sys.exit(1)

# --- 2. Traer el ultimo recibo de ingreso de ese cliente ---
recibos = api_get("CashReceipts", {"RelationshipID": customer_id, "skip": 0})

recibos = [r for r in recibos if not r.get("Void", False)]
recibos.sort(key=lambda r: r.get("DocDate", ""), reverse=True)

if not recibos:
    print(json.dumps({"error": f"Sin recibos para {customer_name}", "customer_id": customer_id}, ensure_ascii=False))
    sys.exit(0)

ultimo = recibos[0]
resultado = {
    "cliente": customer_name,
    "customer_id": customer_id,
    "documento": ultimo.get("DocID"),
    "tipo": ultimo.get("DocumentTypeName"),
    "fecha": (ultimo.get("DocDate") or "")[:10],
    "monto": ultimo.get("TotalAmount"),
    "moneda": ultimo.get("CurrencyID"),
    "anulado": ultimo.get("Void", False),
    "total_recibos": len(recibos),
}
print(json.dumps(resultado, ensure_ascii=False, indent=2))
PY
