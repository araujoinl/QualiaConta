#!/usr/bin/env bash
# Carga el padrón de contribuyentes de la DGII en la tabla `dgii_rnc` de
# Supabase, para que el preparador conteste "¿de quién es este RNC y está
# activo?" desde la base en vez de contra el formulario web de la DGII (un
# ASP.NET viejo que se lleva ~5s por factura y a veces no responde).
#
# POR QUÉ ACÁ Y NO EN LA NUBE: la Edge Function `qualia-padron-dgii` existe y
# funciona, pero cada invocación tiene 2 SEGUNDOS de CPU y parsear el millón de
# líneas del archivo necesita ~70 (medido 2026-08-17: cargó 30.000 filas y la
# plataforma la cortó). Partirlo en ~35 invocaciones encadenadas se puede, pero
# no compra nada mientras el server siga vivo por los colectores del banco, que
# necesitan hardware. Cuando el server se vaya, se retoma ese camino.
#
# Lo que NO se puede cachear, y por eso el preparador lo sigue consultando
# online: la validez del COMPROBANTE (NCF/e-CF). Eso es por documento y la DGII
# no lo publica en bloque.
#
# Cron: mensual. El archivo se publica cada pocos días, pero un RNC no cambia de
# dueño y mensual alcanza para lo que decide (activo/suspendido, régimen).
#
# Uso: ./cargar-padron-dgii.sh

set -uo pipefail

LOG=/home/codebox/qualia-padron.log
URL="https://dgii.gov.do/app/WebApps/Consultas/RNC/DGII_RNC.zip"
# La DGII responde 403 a un cliente sin navegador (verificado 2026-08-17).
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
NUBE_URL="https://uzvnluxxaekmaqnuocvo.supabase.co"

registrar() { echo "$(date -u +%FT%TZ) $*" >>"$LOG"; }

NUBE_KEY=$(grep -m1 '^SUPABASE_SERVICE_ROLE_KEY=' /home/codebox/colector-bancos/.env | cut -d= -f2- | tr -d '"')
if [ -z "$NUBE_KEY" ]; then
    registrar "ERROR: sin SUPABASE_SERVICE_ROLE_KEY; no cargo nada"
    exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

registrar "=== inicio ==="
if ! curl -s -m 600 -A "$UA" -o "$TMP/padron.zip" "$URL"; then
    registrar "ERROR: no pude bajar el archivo de la DGII"
    exit 1
fi
registrar "bajado ($(stat -c %s "$TMP/padron.zip") bytes)"

# El parseo y la subida van en python: el archivo es latin-1 con campos
# separados por barra, y se sube por lotes al endpoint REST con upsert (la
# tabla tiene el RNC como llave, así que re-cargar es idempotente).
NUBE_URL="$NUBE_URL" NUBE_KEY="$NUBE_KEY" python3 - "$TMP/padron.zip" <<'PY' >>"$LOG" 2>&1
import io, json, os, sys, urllib.error, urllib.request, zipfile

url = os.environ["NUBE_URL"]
key = os.environ["NUBE_KEY"]
LOTE = 5000

def subir(filas):
    if not filas:
        return 0
    # El archivo de la DGII trae RNCs REPETIDOS y Postgres no puede tocar la
    # misma fila dos veces en un solo ON CONFLICT ("cannot affect row a second
    # time" → HTTP 500). Se deduplica por RNC dentro del lote, quedándose con
    # la última aparición, que es la que el propio archivo deja como vigente.
    unicas = {f["rnc"]: f for f in filas}
    filas = list(unicas.values())
    cuerpo = json.dumps(filas).encode()
    req = urllib.request.Request(
        f"{url}/rest/v1/dgii_rnc?on_conflict=rnc",
        data=cuerpo,
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            # merge-duplicates = upsert; minimal = no devuelvas las filas.
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            if r.status >= 300:
                raise RuntimeError(f"HTTP {r.status}")
    except urllib.error.HTTPError as e:
        # El cuerpo del error es lo único que dice QUÉ pasó (PostgREST manda el
        # mensaje de Postgres ahí). Sin esto, un fallo del lote se lee como un
        # "HTTP 500" pelado y no hay por dónde agarrarlo.
        detalle = e.read()[:400].decode(errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {detalle}") from None
    return len(filas)

def limpio(v):
    v = v.strip()
    return v[:200] if v else None

z = zipfile.ZipFile(sys.argv[1])
nombre = z.namelist()[0]
leidas = cargadas = 0
pendientes = []
with z.open(nombre) as f:
    for cruda in io.TextIOWrapper(f, encoding="latin-1", newline=""):
        leidas += 1
        c = cruda.rstrip("\r\n").split("|")
        if len(c) < 11:
            continue
        rnc = c[0].strip()
        if not (rnc.isdigit() and len(rnc) in (9, 11)):
            continue
        pendientes.append({
            "rnc": rnc,
            "nombre": limpio(c[1]),
            "nombre_comercial": limpio(c[2]),
            "actividad": limpio(c[3]),
            "estado": limpio(c[9]),
            "regimen": limpio(c[10]),
        })
        if len(pendientes) >= LOTE:
            cargadas += subir(pendientes)
            pendientes = []
cargadas += subir(pendientes)
print(f"  leidas={leidas} cargadas={cargadas}")

# La marca de frescura solo se pone al TERMINAR: un padrón a medias con marca
# fresca es el falso verde que qualia-salud existe para evitar.
import datetime
marca = json.dumps({"valor": {"en": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "filas": cargadas},
                    "actualizado_por": "cargar-padron-dgii.sh"}).encode()
req = urllib.request.Request(
    f"{url}/rest/v1/qualia_config?empresa_id=is.null&clave=eq.refresco_padron_dgii",
    data=marca, method="PATCH",
    headers={"apikey": key, "Authorization": f"Bearer {key}",
             "Content-Type": "application/json", "Prefer": "return=minimal"})
urllib.request.urlopen(req, timeout=60)
PY
rc=$?

if [ "$rc" -eq 0 ]; then
    registrar "=== fin (ok) ==="
else
    registrar "=== fin (ERROR rc=$rc) ==="
fi
exit "$rc"
