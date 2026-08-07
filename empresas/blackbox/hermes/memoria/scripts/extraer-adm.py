#!/usr/bin/env python3
"""
Extractor total de ADM Cloud + banco — Capa A del preentrenamiento (Blackbox)

Baja TODO el histórico contable de ADM Cloud (solo GET, jamás escribe) y el
espejo bancario de Supabase/openbanking, a archivos crudos en disco. Es la
primera capa del pipeline de preentrenamiento: extracción determinista,
0 tokens de LLM. Ver docs/plan-preentrenamiento.md §1.1.

USO (dentro del gateway, como /opt/data/memoria/scripts/extraer-adm.py):

    python3 extraer-adm.py                     # extracción completa (60-90 min)
    python3 extraer-adm.py --dry-run           # 1 página + 1 detalle por recurso y para
    python3 extraer-adm.py --solo vendor-bills # un solo recurso (debug); acepta slug,
                                               # nombre de endpoint o "banco"
    python3 extraer-adm.py --desde 2026-09-01  # delta: re-pagina y agrega SOLO docs
                                               # con ID no visto (append, sin tocar lo ya bajado)
    python3 extraer-adm.py --refrescar-desde 2026-07-01   # re-pide el DETALLE de los docs
                                               # con fecha >= esa y reemplaza su línea

SALIDAS:
    /opt/data/preentrenamiento/raw/<slug>.jsonl          # 1 doc por línea (listado)
    /opt/data/preentrenamiento/raw/<slug>-detalle.jsonl  # {"_id","docid","data"} por línea
    /opt/data/preentrenamiento/raw/openbanking_*.csv     # volcado del banco
    /opt/data/preentrenamiento/estado.json               # cursor por recurso (retomable)
    (--dry-run escribe en raw-dryrun/ y NO toca estado.json)

RETOMAR: si el proceso muere, volver a correr sin flags: el cursor de estado.json
retoma cada recurso donde quedó (los ya `done` no se repiten). Antes de retomar
un listado se reconcilia el archivo con el cursor (si quedó una página escrita
sin registrar, se recorta) para no duplicar filas.

REGLAS DURAS (no negociables, ver plan §1.1):
  - Contra api.admcloud.net SOLO GET. Nada de POST/PUT/PATCH/DELETE.
  - `skip` presente en TODO GET de listado (sin él: 405 o un objeto suelto).
  - `take` se ignora (página fija de 50): se avanza por el tamaño devuelto y
    se corta en página vacía.
  - Sales/Detailed ignora skip/take y devuelve TODO: se hace UNA sola llamada.
  - BankBankTransfers responde tupla {Item1: [página], Item2: total}.
  - Throttle ~1 req/s; backoff solo ante 5xx; un 4xx jamás se reintenta.
  - Nunca imprimir credenciales ni cuerpos crudos de error (reflejan el GUID
    de company): todo mensaje de error va sanitizado (código + ruta sin query).

REQUISITOS:
    env: ADMCLOUD_USER, ADMCLOUD_PASSWORD, ADMCLOUD_COMPANY, ADMCLOUD_ROLE,
         ADMCLOUD_APPID, OPENBANKING_DSN (para el volcado del banco)
    binarios: python3 (stdlib sola), psql
"""

import argparse
import base64
import json
import os
import random
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# ======================================================================
# CONFIGURACIÓN
# ======================================================================

BASE_API = "https://api.admcloud.net/api"
BASE_DIR = "/opt/data/preentrenamiento"

THROTTLE_SEG = 1.0        # ~1 req/s contra la API
REINTENTOS_5XX = 5        # backoff exponencial solo ante 5xx / error de red
TIMEOUT_PAGINA = 120
TIMEOUT_UNA_LLAMADA = 300  # Sales/Detailed trae todo junto: darle aire
TOPE_PAGINAS = 200        # freno de runaway por recurso (200 pág × 50 = 10.000 filas)
MUESTRA_N = 50            # detalles de muestra en recursos de ventas
SEMILLA_MUESTRA = 42      # muestra determinista (retomable)

# Modos de listado
PAGINADO = "paginado"
UNA_LLAMADA = "una_llamada"     # Sales/Detailed
TUPLA = "tupla"                 # BankBankTransfers {Item1, Item2}

# Política de detalle por doc
SIN_DETALLE = "no"
DETALLE_TODO = "todo"
DETALLE_MUESTRA = "muestra"     # solo MUESTRA_N docs (ventas no será autónomo)

CAMPOS_FECHA = ("DocDate", "Date", "TransactionDate", "PostDate", "CreatedDate")
CAMPOS_ID = ("ID", "Id", "id")
CAMPOS_DOCID = ("DocID", "DocId", "docid")

# La tabla de la spec (plan §1.1). Nota: los "Satélites AP" del plan mapean
# así en la API (verificado contra llms.txt y por conteo real): Prepayments →
# VendorPrepayments, CreditApplications → VendorCreditApplications, y
# "Receptions 10" → VendorReceptions (el endpoint pelado Receptions existe
# pero tiene 1 solo doc; se bajan los dos por completitud).
#   (slug, endpoint, modo, detalle)
RECURSOS = [
    ("accounts",              "Accounts",                 PAGINADO,    SIN_DETALLE),
    ("vendors",               "Vendors",                  PAGINADO,    DETALLE_TODO),
    ("vendor-bills",          "VendorBills",              PAGINADO,    DETALLE_TODO),
    ("journals",              "Journals",                 PAGINADO,    DETALLE_TODO),
    ("bill-payments",         "BillPayments",             PAGINADO,    DETALLE_TODO),
    ("account-payments",      "AccountPayments",          PAGINADO,    DETALLE_TODO),
    ("bank-charges",          "BankCharges",              PAGINADO,    DETALLE_TODO),
    ("bank-transfers",        "BankBankTransfers",        TUPLA,       DETALLE_TODO),
    ("deposits",              "Deposits",                 PAGINADO,    DETALLE_TODO),
    ("cash-invoices",         "CashInvoices",             PAGINADO,    DETALLE_MUESTRA),
    ("cash-receipts",         "CashReceipts",             PAGINADO,    DETALLE_MUESTRA),
    ("credit-invoices",       "CreditInvoices",           PAGINADO,    DETALLE_MUESTRA),
    ("sales-detailed",        "Sales/Detailed",           UNA_LLAMADA, SIN_DETALLE),
    ("customers",             "Customers",                PAGINADO,    SIN_DETALLE),
    ("employees",             "Employee",                 PAGINADO,    SIN_DETALLE),
    ("payment-methods",       "PaymentMethods",           PAGINADO,    SIN_DETALLE),
    ("expense-types",         "ExpenseTypes",             PAGINADO,    SIN_DETALLE),
    ("accounting-periods",    "AccountingPeriods",        PAGINADO,    SIN_DETALLE),
    ("bank-reconciliations",  "BankReconciliations",      PAGINADO,    SIN_DETALLE),
    ("vendor-credit-notes",   "VendorCreditNotes",        PAGINADO,    DETALLE_TODO),
    ("vendor-prepayments",    "VendorPrepayments",        PAGINADO,    DETALLE_TODO),
    ("receptions",            "Receptions",               PAGINADO,    DETALLE_TODO),
    ("vendor-receptions",     "VendorReceptions",         PAGINADO,    DETALLE_TODO),
    ("vendor-credit-applications", "VendorCreditApplications", PAGINADO, DETALLE_TODO),
]

TABLAS_BANCO = ("openbanking_accounts", "openbanking_transactions")

ENV_ADM = ("ADMCLOUD_USER", "ADMCLOUD_PASSWORD", "ADMCLOUD_COMPANY",
           "ADMCLOUD_ROLE", "ADMCLOUD_APPID")


# ======================================================================
# ERRORES SANITIZADOS
# ======================================================================

class ErrorExtractor(Exception):
    """Error con mensaje ya sanitizado: nunca lleva query strings, cuerpos
    de respuesta ni credenciales. Es seguro imprimirlo."""


# ======================================================================
# HTTP — GET-only, throttled, sanitizado
# ======================================================================

_ultimo_request = [0.0]


def _throttle():
    espera = THROTTLE_SEG - (time.monotonic() - _ultimo_request[0])
    if espera > 0:
        time.sleep(espera)
    _ultimo_request[0] = time.monotonic()


def _credencial():
    return base64.b64encode(
        f'{os.environ["ADMCLOUD_USER"]}:{os.environ["ADMCLOUD_PASSWORD"]}'.encode()
    ).decode()


def get_api(ruta, extra=None, timeout=TIMEOUT_PAGINA):
    """GET a la API de ADM Cloud. `ruta` sin query (ej. "VendorBills" o
    "VendorBills/<uuid>"). Agrega SIEMPRE company/role/appid URL-encoded.
    Reintenta con backoff solo ante 5xx o error de red; un 4xx corta al acto.
    Los mensajes de error salen sanitizados: código + ruta, jamás el cuerpo
    (refleja el GUID de company) ni la query."""
    params = dict(extra or {})
    params["company"] = os.environ["ADMCLOUD_COMPANY"]
    params["role"] = os.environ["ADMCLOUD_ROLE"]
    params["appid"] = os.environ["ADMCLOUD_APPID"]
    ruta_limpia = "/".join(urllib.parse.quote(p, safe="") for p in ruta.strip("/").split("/"))
    url = f"{BASE_API}/{ruta_limpia}?{urllib.parse.urlencode(params)}"

    for intento in range(1, REINTENTOS_5XX + 1):
        _throttle()
        pedido = urllib.request.Request(url, headers={
            "Authorization": f"Basic {_credencial()}",
            "Accept": "application/json",
        })
        try:
            with urllib.request.urlopen(pedido, timeout=timeout) as r:
                cuerpo = r.read().decode("utf-8", "replace")
            try:
                return json.loads(cuerpo)
            except json.JSONDecodeError:
                raise ErrorExtractor(f"respuesta no-JSON en {ruta}")
        except urllib.error.HTTPError as e:
            # OJO: no leer/propagar e.read() — el cuerpo refleja el GUID de company.
            if 500 <= e.code < 600 and intento < REINTENTOS_5XX:
                pausa = 2 ** intento
                print(f"    HTTP {e.code} en {ruta}; reintento {intento}/{REINTENTOS_5XX} "
                      f"en {pausa}s", file=sys.stderr, flush=True)
                time.sleep(pausa)
                continue
            raise ErrorExtractor(f"HTTP {e.code} en {ruta} (sin reintento)"
                                 if e.code < 500 else
                                 f"HTTP {e.code} en {ruta} tras {intento} intentos")
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            if intento < REINTENTOS_5XX:
                pausa = 2 ** intento
                print(f"    error de red ({type(e).__name__}) en {ruta}; "
                      f"reintento {intento}/{REINTENTOS_5XX} en {pausa}s",
                      file=sys.stderr, flush=True)
                time.sleep(pausa)
                continue
            raise ErrorExtractor(f"error de red ({type(e).__name__}) en {ruta} "
                                 f"tras {intento} intentos")
    raise ErrorExtractor(f"agotados los reintentos en {ruta}")


# ======================================================================
# DESENVOLVER RESPUESTAS (la forma cambia según el recurso)
# ======================================================================

def desenvolver_lista(raw):
    """Arreglo pelado, o envuelto en Data/data/Items/items."""
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        for llave in ("Data", "data", "Items", "items"):
            if isinstance(raw.get(llave), list):
                return raw[llave]
        suelto = next((v for v in raw.values() if isinstance(v, list) and v), None)
        if suelto is not None:
            return suelto
        return [raw]
    return [raw]


def desenvolver_tupla(raw):
    """BankBankTransfers: data = {Item1: [página], Item2: total}."""
    candidatos = [raw]
    if isinstance(raw, dict):
        for llave in ("data", "Data"):
            if isinstance(raw.get(llave), dict):
                candidatos.append(raw[llave])
    for c in candidatos:
        if isinstance(c, dict) and isinstance(c.get("Item1"), list):
            return c["Item1"]
    raise ErrorExtractor("forma tupla inesperada en BankBankTransfers")


def desenvolver_detalle(raw):
    """Detalle por ID: suele venir {success, message, data:{...}}."""
    if isinstance(raw, dict):
        for llave in ("data", "Data"):
            if isinstance(raw.get(llave), dict):
                return raw[llave]
    return raw


def campo(doc, nombres):
    if isinstance(doc, dict):
        for n in nombres:
            v = doc.get(n)
            if v not in (None, ""):
                return v
    return None


def fecha_doc(doc):
    v = campo(doc, CAMPOS_FECHA)
    if isinstance(v, str) and len(v) >= 10:
        return v[:10]
    return None


# ======================================================================
# ESTADO (cursor retomable)
# ======================================================================

def ruta_estado():
    return os.path.join(BASE_DIR, "estado.json")


def cargar_estado():
    try:
        with open(ruta_estado(), encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {"version": 1, "creado": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "recursos": {}, "banco": {}}


def guardar_estado(estado):
    tmp = ruta_estado() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(estado, f, ensure_ascii=False, indent=2)
    os.replace(tmp, ruta_estado())


def estado_recurso(estado, slug, endpoint):
    return estado["recursos"].setdefault(slug, {
        "endpoint": endpoint, "skip": 0, "paginas": 0, "filas": 0,
        "done": False, "cortado": False, "corte": None,
        "fecha_min": None, "fecha_max": None,
        "detalle_bajados": 0, "detalle_done": False, "detalle_errores": [],
        "error": None,
    })


# ======================================================================
# ARCHIVOS JSONL
# ======================================================================

def contar_lineas(ruta):
    try:
        with open(ruta, encoding="utf-8") as f:
            return sum(1 for _ in f)
    except FileNotFoundError:
        return 0


def truncar_a(ruta, n_lineas):
    """Recorta el archivo a las primeras n líneas (reconciliación tras un
    corte a mitad de página). Los archivos son chicos (≤ ~1.600 líneas)."""
    with open(ruta, encoding="utf-8") as f:
        lineas = f.readlines()
    if len(lineas) <= n_lineas:
        return
    with open(ruta, "w", encoding="utf-8") as f:
        f.writelines(lineas[:n_lineas])


def ids_de_archivo(ruta, llave=None):
    """Set de IDs presentes en un jsonl (llave=None → busca ID del doc;
    llave='_id' → archivos de detalle)."""
    vistos = set()
    try:
        with open(ruta, encoding="utf-8") as f:
            for linea in f:
                try:
                    doc = json.loads(linea)
                except json.JSONDecodeError:
                    continue
                i = doc.get(llave) if llave else campo(doc, CAMPOS_ID)
                if i:
                    vistos.add(str(i))
    except FileNotFoundError:
        pass
    return vistos


# ======================================================================
# EXTRACCIÓN — listados
# ======================================================================

def extraer_listado(slug, endpoint, modo, estado, desde=None):
    """Baja el listado completo (o el delta) de un recurso a raw/<slug>.jsonl.
    Devuelve las filas nuevas escritas."""
    st = estado_recurso(estado, slug, endpoint)
    archivo = os.path.join(BASE_DIR, "raw", f"{slug}.jsonl")
    hoy = time.strftime("%Y-%m-%d", time.gmtime())

    delta = desde is not None
    if st["done"] and not delta:
        print(f"[{slug}] listado ya completo ({st['filas']} filas), salto", flush=True)
        return 0

    ids_previos = set()
    if delta:
        # Delta: siempre desde skip=0, dedupe por ID contra lo ya bajado.
        ids_previos = ids_de_archivo(archivo)
        skip = 0
    else:
        # Retomar: reconciliar archivo vs cursor (páginas escritas sin registrar).
        en_disco = contar_lineas(archivo)
        if en_disco > st["filas"]:
            truncar_a(archivo, st["filas"])
        elif en_disco < st["filas"]:
            # Archivo borrado/incompleto: arrancar de cero.
            st.update(skip=0, paginas=0, filas=0)
            open(archivo, "w").close()
        skip = st["skip"]
        if st["filas"] == 0:
            open(archivo, "w").close()

    nuevas = 0
    with open(archivo, "a", encoding="utf-8") as f:

        def escribir(docs):
            nonlocal nuevas
            for d in docs:
                did = campo(d, CAMPOS_ID)
                if delta and did and str(did) in ids_previos:
                    continue
                f.write(json.dumps(d, ensure_ascii=False) + "\n")
                nuevas += 1
                st["filas"] += 1
                fd = fecha_doc(d)
                if fd:
                    if st["fecha_min"] is None or fd < st["fecha_min"]:
                        st["fecha_min"] = fd
                    if st["fecha_max"] is None or fd > st["fecha_max"]:
                        st["fecha_max"] = fd
            f.flush()

        if modo == UNA_LLAMADA:
            # Sales/Detailed: ignora skip y take → UNA sola llamada con todo.
            # skip=0 va igual (regla: skip presente en todo GET de listado).
            docs = desenvolver_lista(get_api(endpoint, {"skip": 0},
                                             timeout=TIMEOUT_UNA_LLAMADA))
            escribir(docs)
            st["paginas"] = 1
        else:
            while True:
                raw = get_api(endpoint, {"skip": skip})
                pagina = desenvolver_tupla(raw) if modo == TUPLA else desenvolver_lista(raw)
                if not pagina:
                    break
                escribir(pagina)
                st["paginas"] += 1
                skip += len(pagina)
                st["skip"] = skip
                guardar_estado(estado)
                if st["paginas"] >= TOPE_PAGINAS:
                    st["cortado"] = True
                    print(f"[{slug}] ⚠ tope de {TOPE_PAGINAS} páginas: hay más datos, "
                          f"NO es el total", file=sys.stderr, flush=True)
                    break

    st["done"] = True
    st["corte"] = hoy
    st["error"] = None
    guardar_estado(estado)
    etiqueta = "delta" if delta else "listado"
    print(f"[{slug}] {etiqueta}: {nuevas} filas nuevas ({st['filas']} en archivo), "
          f"{st['paginas']} página(s)", flush=True)
    return nuevas


# ======================================================================
# EXTRACCIÓN — detalles por documento
# ======================================================================

def ids_para_detalle(slug, detalle):
    """IDs (y DocIDs) a bajar en detalle, leyendo el listado ya extraído.
    En modo muestra, la selección es determinista (semilla fija) para que
    sea retomable y reproducible."""
    archivo = os.path.join(BASE_DIR, "raw", f"{slug}.jsonl")
    pares = []
    with open(archivo, encoding="utf-8") as f:
        for linea in f:
            try:
                doc = json.loads(linea)
            except json.JSONDecodeError:
                continue
            did = campo(doc, CAMPOS_ID)
            if did:
                pares.append((str(did), campo(doc, CAMPOS_DOCID)))
    # dedupe conservando orden
    vistos, unicos = set(), []
    for p in pares:
        if p[0] not in vistos:
            vistos.add(p[0])
            unicos.append(p)
    if detalle == DETALLE_MUESTRA and len(unicos) > MUESTRA_N:
        unicos = random.Random(SEMILLA_MUESTRA).sample(unicos, MUESTRA_N)
    return unicos


def extraer_detalles(slug, endpoint, detalle, estado, max_docs=None):
    """Baja el detalle doc a doc a raw/<slug>-detalle.jsonl. Retomable: los
    _id ya presentes en el archivo no se piden de nuevo. Un 4xx en un doc
    puntual se anota y se sigue (sin reintento, regla dura)."""
    st = estado_recurso(estado, slug, endpoint)
    archivo = os.path.join(BASE_DIR, "raw", f"{slug}-detalle.jsonl")
    objetivo = ids_para_detalle(slug, detalle)
    ya = ids_de_archivo(archivo, llave="_id")
    faltan = [(i, d) for (i, d) in objetivo if i not in ya]
    if max_docs is not None:
        faltan = faltan[:max_docs]

    if not faltan:
        st["detalle_bajados"] = len(ya)
        st["detalle_done"] = True
        guardar_estado(estado)
        print(f"[{slug}] detalle ya completo ({len(ya)} docs), salto", flush=True)
        return 0

    bajados = 0
    with open(archivo, "a", encoding="utf-8") as f:
        for i, (did, docid) in enumerate(faltan, 1):
            try:
                det = desenvolver_detalle(get_api(f"{endpoint}/{did}"))
            except ErrorExtractor as e:
                mensaje = str(e)
                if "HTTP 5" in mensaje or "error de red" in mensaje:
                    raise   # 5xx agotado / red caída: cortar y retomar después
                st["detalle_errores"].append({"id": did, "error": mensaje})
                guardar_estado(estado)
                print(f"[{slug}] detalle {did}: {mensaje} — anotado, sigo",
                      file=sys.stderr, flush=True)
                continue
            f.write(json.dumps({"_id": did, "docid": docid, "data": det},
                               ensure_ascii=False) + "\n")
            f.flush()
            bajados += 1
            if i % 25 == 0 or i == len(faltan):
                st["detalle_bajados"] = len(ya) + bajados
                guardar_estado(estado)
                print(f"[{slug}] detalle: {len(ya) + bajados}/{len(objetivo)}", flush=True)

    st["detalle_bajados"] = len(ya) + bajados
    if max_docs is None:
        st["detalle_done"] = True
    guardar_estado(estado)
    print(f"[{slug}] detalle: {bajados} docs nuevos "
          f"({st['detalle_bajados']}/{len(objetivo)} total)", flush=True)
    return bajados


def sin_firmas(v):
    """Copia del doc con las URLs firmadas recortadas al path. Las de los
    adjuntos (`Files[].URI`) llevan una firma temporal de Azure que ADM
    re-genera en CADA lectura, así que comparando el documento crudo TODOS
    salen «cambiados» siempre: el archivo se reescribiría cada hora y el log
    diría 68 cambios cuando no hubo ninguno. La firma no es parte del
    documento, es la llave para bajarlo — y encima vence en una hora."""
    if isinstance(v, dict):
        return {k: sin_firmas(x) for k, x in v.items()}
    if isinstance(v, list):
        return [sin_firmas(x) for x in v]
    if isinstance(v, str) and "?" in v and ("sv=" in v or "sig=" in v):
        return v.split("?", 1)[0]
    return v


def refrescar_detalles(slug, endpoint, estado, desde):
    """Vuelve a pedir el detalle de los docs con fecha >= `desde` y REEMPLAZA su
    línea en raw/<slug>-detalle.jsonl. Devuelve (revisados, cambiados).

    Por qué existe: el delta sólo AGREGA lo que no estaba, así que un documento
    ya bajado se congela en el estado que tenía ese día. Anular no crea un
    documento nuevo —cambia uno viejo—, y por eso ninguna anulación posterior
    entraba jamás al volcado. El 2026-08-06 eso dejó a Claro fuera de la caja de
    recurrentes: la copia local contaba como viva la FP00001131 del 31/07, que
    en ADM está anulada, y ese día 31 le rompía el patrón del día 4.

    Reescribe el archivo entero desde memoria (son ~1.100 líneas) con
    `os.replace`, así que un lector concurrente ve el archivo viejo o el nuevo,
    nunca uno a medias. Un 4xx en un doc puntual CONSERVA la línea vieja: un
    error de red no puede borrar lo único que sabemos del documento.

    El listado (`raw/<slug>.jsonl`) no se toca a propósito: es el índice de qué
    documentos existen, y eso no cambia al anular. Quien necesite el estado lee
    el detalle, que es lo que este refresco mantiene al día.

    Un documento BORRADO no se puede volver a pedir, así que su detalle viejo es
    lo único que queda de él: se conserva y se marca `_eliminado` afuera de
    `data`. Anulado y borrado son distintos — el anulado sigue en ADM con `Void`.
    """
    st = estado_recurso(estado, slug, endpoint)
    archivo = os.path.join(BASE_DIR, "raw", f"{slug}-detalle.jsonl")
    try:
        with open(archivo, encoding="utf-8") as f:
            lineas = f.readlines()
    except FileNotFoundError:
        print(f"[{slug}] refresco: no hay detalle bajado todavía, salto", flush=True)
        return (0, 0)

    docs, objetivo = [], []
    for n, linea in enumerate(lineas):
        try:
            doc = json.loads(linea)
        except json.JSONDecodeError:
            docs.append(None)          # línea ilegible: se conserva tal cual
            continue
        docs.append(doc)
        fd = fecha_doc(doc.get("data") or {})
        if fd and fd >= desde and doc.get("_id"):
            objetivo.append(n)

    # Líneas cuyo `data` no es un documento: las dejó una corrida anterior al
    # arreglo de abajo, guardando el sobre vacío de un documento borrado. Se
    # restauran desde el listado —que conserva la cabecera de todo lo que
    # existió— y quedan marcadas como eliminadas. Sin esto, el detalle queda con
    # una línea que revienta a cualquiera que lea `data["DocDate"]`, que es como
    # se leen todos estos archivos.
    rotas = 0
    cabeceras = None
    for n, doc in enumerate(docs):
        if not doc or not doc.get("_id") or campo(doc.get("data") or {}, CAMPOS_ID):
            continue
        if cabeceras is None:
            cabeceras = {}
            try:
                with open(os.path.join(BASE_DIR, "raw", f"{slug}.jsonl"),
                          encoding="utf-8") as f:
                    for linea in f:
                        try:
                            fila = json.loads(linea)
                        except json.JSONDecodeError:
                            continue
                        fid = campo(fila, CAMPOS_ID)
                        if fid:
                            cabeceras[str(fid)] = fila
            except FileNotFoundError:
                pass
        cabecera = cabeceras.get(str(doc["_id"]))
        if not cabecera:
            continue
        doc["data"] = cabecera
        doc.setdefault("_eliminado", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        doc["_solo_cabecera"] = True      # sin las líneas: el detalle se perdió
        lineas[n] = json.dumps(doc, ensure_ascii=False) + "\n"
        rotas += 1
        print(f"[{slug}] {doc.get('docid') or doc['_id']}: detalle vacío, "
              f"restaurado desde el listado", flush=True)

    if not objetivo:
        if rotas:
            tmp = archivo + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.writelines(lineas)
            os.replace(tmp, archivo)
        print(f"[{slug}] refresco: ningún doc desde {desde} "
              f"({rotas} línea(s) reparada(s))", flush=True)
        return (0, rotas)

    cambiados = rotas
    for i, n in enumerate(objetivo, 1):
        doc = docs[n]
        try:
            det = desenvolver_detalle(get_api(f"{endpoint}/{doc['_id']}"))
        except ErrorExtractor as e:
            mensaje = str(e)
            if "HTTP 5" in mensaje or "error de red" in mensaje:
                raise   # 5xx agotado / red caída: cortar sin escribir nada
            st["detalle_errores"].append({"id": doc["_id"], "error": mensaje,
                                          "refresco": desde})
            print(f"[{slug}] refresco {doc['_id']}: {mensaje} — dejo la línea vieja",
                  file=sys.stderr, flush=True)
            continue
        if not campo(det if isinstance(det, dict) else {}, CAMPOS_ID):
            # Un documento BORRADO en ADM contesta {success:true, data:null}, y
            # `desenvolver_detalle` devuelve el sobre entero porque no hay `data`
            # que desenvolver. Guardar eso pisa el único registro que queda de un
            # documento que ya no se puede volver a pedir: la primera corrida se
            # llevó así el detalle de la FP00001120, borrada en ADM el 2026-08-04.
            # El dato viejo se conserva y el hecho se anota AFUERA de `data`, para
            # que quien lee el documento lo siga leyendo igual y quien necesite el
            # estado lo pregunte. Anulado y borrado no son lo mismo: el anulado
            # sigue existiendo en ADM con `Void`, éste ya no existe.
            if not doc.get("_eliminado"):
                doc["_eliminado"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                lineas[n] = json.dumps(doc, ensure_ascii=False) + "\n"
                cambiados += 1
                print(f"[{slug}] {doc.get('docid') or doc['_id']}: ya no existe en "
                      f"ADM — marcado como eliminado, conservo el detalle",
                      flush=True)
        elif sin_firmas(det) != sin_firmas(doc.get("data")):
            doc["data"] = det
            doc.pop("_eliminado", None)   # volvió a existir: la marca ya no es cierta
            lineas[n] = json.dumps(doc, ensure_ascii=False) + "\n"
            cambiados += 1
        if i % 25 == 0 or i == len(objetivo):
            print(f"[{slug}] refresco: {i}/{len(objetivo)}", flush=True)

    if cambiados:
        tmp = archivo + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.writelines(lineas)
        os.replace(tmp, archivo)
    st["refresco"] = {"desde": desde, "revisados": len(objetivo),
                      "cambiados": cambiados,
                      "corrido": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    guardar_estado(estado)
    print(f"[{slug}] refresco desde {desde}: {len(objetivo)} revisados, "
          f"{cambiados} cambiado(s)", flush=True)
    return (len(objetivo), cambiados)


# ======================================================================
# BANCO — volcado de Supabase/openbanking
# ======================================================================

def volcar_banco(destino_dir, estado=None, dry_run=False):
    """COPY de las tablas openbanking a CSV. En dry-run limita a 50 filas.
    El stderr de psql NO se imprime (la cadena de conexión puede asomar en
    errores): ante fallo se reporta solo la tabla y el código de salida."""
    dsn = os.environ.get("OPENBANKING_DSN")
    if not dsn:
        print("[banco] OPENBANKING_DSN no está en el entorno: salto el volcado",
              file=sys.stderr, flush=True)
        return {}

    resultados = {}
    for tabla in TABLAS_BANCO:
        destino = os.path.join(destino_dir, f"{tabla}.csv")
        limite = " LIMIT 50" if dry_run else ""
        sql = f"COPY (SELECT * FROM {tabla}{limite}) TO STDOUT WITH CSV HEADER"
        with open(destino, "w", encoding="utf-8") as f:
            proc = subprocess.run(
                ["psql", dsn, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
                stdout=f, stderr=subprocess.DEVNULL, timeout=600,
            )
        if proc.returncode != 0:
            print(f"[banco] psql falló (código {proc.returncode}) volcando {tabla}; "
                  f"correr el COPY a mano para ver el detalle", file=sys.stderr, flush=True)
            resultados[tabla] = None
            continue
        filas = max(contar_lineas(destino) - 1, 0)   # menos el header
        resultados[tabla] = filas
        print(f"[banco] {tabla}: {filas} filas → {os.path.basename(destino)}", flush=True)

    if estado is not None:
        estado["banco"] = {
            "corte": time.strftime("%Y-%m-%d", time.gmtime()),
            "filas": resultados,
        }
        guardar_estado(estado)
    return resultados


# ======================================================================
# DRY-RUN — 1 página + 1 detalle por recurso, sin tocar estado.json
# ======================================================================

def correr_dry_run(seleccion):
    destino = os.path.join(BASE_DIR, "raw-dryrun")
    os.makedirs(destino, exist_ok=True)
    print(f"DRY-RUN: 1 página + 1 detalle por recurso → {destino}")
    print("(no toca estado.json; la corrida real arranca de cero)\n", flush=True)

    reporte = []
    for slug, endpoint, modo, detalle in RECURSOS:
        if seleccion and slug not in seleccion:
            continue
        archivo = os.path.join(destino, f"{slug}.jsonl")
        try:
            if modo == UNA_LLAMADA:
                docs = desenvolver_lista(get_api(endpoint, {"skip": 0},
                                                 timeout=TIMEOUT_UNA_LLAMADA))
                total_recibido = len(docs)
                docs = docs[:MUESTRA_N]   # el payload entero se baja igual (1 GET);
                nota = f"recibidos {total_recibido}, escribo {len(docs)}"
            else:
                raw = get_api(endpoint, {"skip": 0})
                docs = desenvolver_tupla(raw) if modo == TUPLA else desenvolver_lista(raw)
                nota = f"página de {len(docs)}"
            with open(archivo, "w", encoding="utf-8") as f:
                for d in docs:
                    f.write(json.dumps(d, ensure_ascii=False) + "\n")

            det_nota = "n/a"
            if detalle != SIN_DETALLE and docs:
                did = next((campo(d, CAMPOS_ID) for d in docs if campo(d, CAMPOS_ID)), None)
                if did:
                    det = desenvolver_detalle(get_api(f"{endpoint}/{did}"))
                    with open(os.path.join(destino, f"{slug}-detalle.jsonl"), "w",
                              encoding="utf-8") as f:
                        f.write(json.dumps({"_id": str(did), "data": det},
                                           ensure_ascii=False) + "\n")
                    det_nota = "ok (1 doc)"
                else:
                    det_nota = "sin campo ID en la página"
            reporte.append((slug, len(docs), nota, det_nota, None))
            print(f"[{slug}] {nota}; detalle: {det_nota}", flush=True)
        except ErrorExtractor as e:
            reporte.append((slug, 0, "-", "-", str(e)))
            print(f"[{slug}] ERROR: {e}", file=sys.stderr, flush=True)

    if not seleccion or "banco" in seleccion:
        volcar_banco(destino, estado=None, dry_run=True)

    print("\n=== RESUMEN DRY-RUN ===", flush=True)
    fallas = 0
    for slug, n, nota, det, err in reporte:
        if err:
            fallas += 1
            print(f"  {slug:28} FALLO: {err}")
        else:
            print(f"  {slug:28} {n:4} líneas ({nota}); detalle: {det}")
    return 2 if fallas else 0


# ======================================================================
# MAIN
# ======================================================================

def valor_es_fecha(v):
    """Las fechas de los flags se comparan como texto contra `DocDate` (que
    viene ISO), así que un valor con otro formato no falla: filtra mal y en
    silencio. Se valida al entrar."""
    try:
        time.strptime(v, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def main():
    p = argparse.ArgumentParser(
        description="Extractor total ADM Cloud + banco (Capa A del preentrenamiento). "
                    "Solo GET; retomable; ver docstring.")
    p.add_argument("--dry-run", action="store_true",
                   help="1 página + 1 detalle por recurso a raw-dryrun/ y para; "
                        "no toca estado.json")
    p.add_argument("--solo", metavar="RECURSO",
                   help="procesar un solo recurso (slug, endpoint o 'banco')")
    p.add_argument("--desde", metavar="YYYY-MM-DD",
                   help="delta: re-pagina y agrega solo docs con ID nuevo "
                        "(el valor queda registrado como corte en estado.json)")
    p.add_argument("--refrescar-desde", metavar="YYYY-MM-DD",
                   help="re-pide el detalle de los docs con fecha >= esa y "
                        "reemplaza su línea (así entran las anulaciones, que el "
                        "delta no ve porque no crean un documento nuevo)")
    args = p.parse_args()

    for flag, valor in (("--desde", args.desde),
                        ("--refrescar-desde", args.refrescar_desde)):
        if valor and not valor_es_fecha(valor):
            print(f"{flag} '{valor}' no es una fecha YYYY-MM-DD", file=sys.stderr)
            return 1

    faltantes = [v for v in ENV_ADM if not os.environ.get(v)]
    if faltantes:
        print(f"Faltan variables de entorno: {', '.join(faltantes)}", file=sys.stderr)
        return 1

    os.makedirs(os.path.join(BASE_DIR, "raw"), exist_ok=True)

    seleccion = None
    if args.solo:
        clave = args.solo.strip().lower()
        validos = {s: s for s, _, _, _ in RECURSOS}
        validos.update({e.lower(): s for s, e, _, _ in RECURSOS})
        validos["banco"] = "banco"
        if clave not in validos:
            print(f"--solo '{args.solo}' no existe. Válidos: "
                  f"{', '.join(sorted(set(validos.values())))}", file=sys.stderr)
            return 1
        seleccion = {validos[clave]}

    if args.dry_run:
        return correr_dry_run(seleccion)

    estado = cargar_estado()
    if args.desde:
        estado.setdefault("deltas", []).append(
            {"desde": args.desde, "corrido": time.strftime("%Y-%m-%d", time.gmtime())})

    fallas = []
    try:
        for slug, endpoint, modo, detalle in RECURSOS:
            if seleccion and slug not in seleccion:
                continue
            try:
                extraer_listado(slug, endpoint, modo, estado, desde=args.desde)
                if detalle != SIN_DETALLE:
                    extraer_detalles(slug, endpoint, detalle, estado)
                    # Después de bajar lo nuevo: lo viejo que cambió de estado.
                    if args.refrescar_desde:
                        refrescar_detalles(slug, endpoint, estado,
                                           args.refrescar_desde)
            except ErrorExtractor as e:
                st = estado_recurso(estado, slug, endpoint)
                st["error"] = str(e)
                guardar_estado(estado)
                fallas.append((slug, str(e)))
                print(f"[{slug}] ERROR: {e} — sigo con el próximo recurso",
                      file=sys.stderr, flush=True)
        if not seleccion or "banco" in seleccion:
            volcar_banco(os.path.join(BASE_DIR, "raw"), estado=estado, dry_run=False)
    except KeyboardInterrupt:
        guardar_estado(estado)
        print("\nInterrumpido. El cursor quedó guardado: volver a correr retoma "
              "donde quedó.", file=sys.stderr)
        return 130

    print("\n=== RESUMEN ===", flush=True)
    for slug, _, _, _ in RECURSOS:
        if seleccion and slug not in seleccion:
            continue
        st = estado["recursos"].get(slug, {})
        det = (f", detalle {st.get('detalle_bajados', 0)}"
               if st.get("detalle_bajados") else "")
        err = f"  ← ERROR: {st.get('error')}" if st.get("error") else ""
        print(f"  {slug:28} {st.get('filas', 0):5} filas{det}{err}")
    if fallas:
        print(f"\n{len(fallas)} recurso(s) con error; corregir y re-correr "
              f"(los completos no se repiten).", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
