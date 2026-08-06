#!/usr/bin/env python3
"""Registra en ADM Cloud una factura de proveedor ya aprobada en la mesa.

Existe como ARCHIVO por la misma razon que buscar-precedente.py: el guardian de
comandos de Hermes marca el flag `-c` de cualquier interprete y consulta a un
segundo LLM antes de dejar correr el comando. Sin este script el agente improvisa
`curl | python3 -c` para hablar con ADM y paga 15-30s por llamada (medido: ese
patron acumulo 30 minutos de espera pura). El 2026-08-03 quedo atascado ahi con
la factura del restaurante.

Y el otro motivo, mas importante: las trampas de esta API se escriben UNA vez acá
en vez de que el modelo las re-derive en cada factura, que es donde se cuelan los
errores caros. Todas estan medidas en produccion:

  - El ITBIS NO se manda: va TaxScheduleID por linea y el server calcula. Su base
    es Quantity x Price, no Price (con cantidad 0.50 la diferencia era 10.63 vs
    21.25 y el total se iba a 173.88 con success:true).
  - El asiento NO se manda: ADM lo deriva. Mandarlo descuadra.
  - El POST devuelve SOLO el UUID; el DocID sale del readback.
  - `GET /api/<recurso>/<id>` con un DocID, un NCF o una referencia devuelve OTRO
    documento con success:true. Hay que verificar que el ID devuelto sea el GUID.
  - Los filtros ?Reference= y ?DocID= mienten: se pagina y se filtra local.
  - No hay clave de idempotencia: ante timeout NO se reintenta.
  - ADM frena duplicados por NCF y por Reference, pero sirve avisar antes.

Uso:
    registrar-en-adm.py --trabajo <uuid>            # registra
    registrar-en-adm.py --trabajo <uuid> --simular  # muestra el payload y para

Sale 0 e imprime el DocID. Sale != 0 con el motivo por stderr, sin haber escrito.
"""
import argparse
import base64
import json
import mimetypes
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

# La aritmetica de ADM y el ajuste que hace que su cuenta caiga en el total del
# papel. Vive aparte porque es una regla probada contra las 63 facturas reales.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cuadre  # noqa: E402

BASE = "https://api.admcloud.net"
TIMEOUT = 90

# Catalogos fijos de Blackbox, verificados contra el sistema vivo.
TAX_ITBIS = "f980499b-4f32-48cb-8c6f-5fe74d245528"      # ITBIS 18%
TAX_ITBIS_16 = "26b690b9-cc2a-4ced-d30b-08dd66faeff4"  # ITBIS 16% (tasa reducida: cafe, leche, etc.)
TAX_ITBIS_30 = "264c13b2-286d-4b60-03b8-08dd34a31da8"  # ITBIS 30% (telecomunicaciones)

# Mapea tasa efectiva -> TaxScheduleID. Se calcula por linea desde itbis/(precio*cantidad).
TAX_SCHEDULES = {
    18.0: (TAX_ITBIS, 18.0),
    16.0: (TAX_ITBIS_16, 16.0),
    30.0: (TAX_ITBIS_30, 30.0),
}

def resolver_tasa_linea(itbis, cantidad, precio):
    """Dado el ITBIS y la base de una linea, devuelve (TaxScheduleID, TaxPercent).
    Si itbis<=0 -> exento. Si la tasa no calza con un schedule conocido, morir."""
    itbis = float(itbis or 0)
    if itbis <= 0:
        return (None, 0.0)
    base = float(cantidad or 1) * float(precio or 0)
    if base <= 0:
        return (None, 0.0)
    tasa = round((itbis / base) * 100, 1)
    # Tolerancia de 1 punto porcentual para redondeos del documento, y gana el
    # schedule MAS CERCANO, no el primero que caiga adentro: con una tasa de
    # 17.0 el 16 y el 18 estan ambos a un punto y el orden del dict decidia en
    # silencio cual de los dos se le cobraba al documento.
    cerca = sorted((abs(tasa - t), t) for t in TAX_SCHEDULES if abs(tasa - t) <= 1.0)
    if cerca:
        return TAX_SCHEDULES[cerca[0][1]]
    morir("la linea (base %.2f, itbis %.2f, tasa %.1f%%) no calza con ningun "
          "schedule conocido (16%%, 18%%, 30%%). Revisar el documento." % (base, itbis, tasa))
TERMINOS = {
    "al contado": "94940a99-f119-4573-8bbd-08dd14abff09",
    "30": "b002e9c1-0430-4809-8612-b27db42a35a0",
    "45": "27e7f4f5-f179-40f0-6fb0-08dd14abefee",
    "60": "a101c88e-5a4c-4860-17e0-08dd149772e6",
}
TIPO_GASTO_DEFECTO = "dcda501b-23df-4074-a8b8-039a153c6b44"  # 02 Trabajos y Servicios

# Entidades que NO tienen RNC de emisor, y por eso son el unico caso que se
# resuelve por nombre. El Estado no emite NCF ni imprime su RNC en el papel: la
# liquidacion de aduana trae el RNC del CONTRIBUYENTE que paga, no el de la DGA,
# asi que el match por RNC busca al comprador y no encuentra nada.
#
# Sin esto el registro moria en "la propuesta no trae un RNC valido" y el agente
# terminaba creando la factura a mano. Paso el 2026-08-06 con la liquidacion de
# RD$939,118.86 (FP00001133): 5 minutos y medio de desvio contra los 23 segundos
# del camino normal, y el docid volvio a la mesa recien al final.
#
# La lista es CERRADA a proposito: la excepcion la revisa un humano una vez, no
# la elige el modelo por parecido de nombre. Lo que no este aca muere igual que
# siempre.
SIN_RNC = ("DGA ADUANAS",)


def morir(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


def env(nombre):
    v = os.environ.get(nombre)
    if not v:
        morir("falta la variable de entorno %s" % nombre)
    return v


def sanear(txt):
    """Los errores de ADM reflejan la URI completa, con el GUID de company."""
    return str(txt).replace(os.environ.get("ADMCLOUD_COMPANY", "\0"), "<company>")


def llamar(metodo, ruta, cuerpo=None, params=None):
    q = {
        "company": env("ADMCLOUD_COMPANY"),
        "role": env("ADMCLOUD_REG_ROLE"),
        "appid": env("ADMCLOUD_APPID"),
    }
    q.update(params or {})
    url = "%s/api/%s?%s" % (BASE, ruta, urllib.parse.urlencode(q))
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    cred = base64.b64encode(
        ("%s:%s" % (env("ADMCLOUD_REG_USER"), env("ADMCLOUD_REG_PASSWORD"))).encode()
    ).decode()
    req = urllib.request.Request(url, data=datos, method=metodo)
    req.add_header("Authorization", "Basic " + cred)
    req.add_header("Accept", "application/json")
    if datos:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        morir("ADM respondio %s en %s" % (e.code, ruta))
    except Exception as e:
        # Un timeout en un POST es el caso peligroso: puede haberse creado igual.
        morir("fallo la llamada a %s: %s (si era un POST, NO reintentes: "
              "volve a buscar el documento antes de tocar nada)" % (ruta, type(e).__name__))


def bajar_documento(trabajo_id):
    """Ruta local del documento. Delega en bajar-documento.sh, que ya resuelve
    la URL firmada y tiene el short-circuit de 'ya estaba bajado'.

    Devuelve (ruta, motivo). El motivo NO es decorativo: bajar-documento.sh
    escribe a stderr por que fallo — sin archivo_url, URL vencida, trabajo
    inexistente— y ese script fue escrito justamente para NO tapar su stderr
    (taparlo hacia que un query roto se reportara como "no tiene archivo").
    Capturarlo y tirarlo repetiria el mismo error un nivel mas arriba.
    """
    guion = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "bajar-documento.sh")
    if not os.path.exists(guion):
        return None, "no encuentro bajar-documento.sh junto a este script"
    r = subprocess.run(["bash", guion, trabajo_id], capture_output=True, text=True)
    ruta = r.stdout.strip()
    if r.returncode == 0 and ruta and os.path.exists(ruta):
        return ruta, ""
    return None, (r.stderr or "").strip()[:300] or "exit %s sin motivo" % r.returncode


def subir_adjunto(guid, ruta):
    """Sube el documento como adjunto de la transaccion. Multipart a mano
    porque la stdlib no lo arma sola y no hay `requests` en el venv.

    Vive ACA y no en la skill por dos medidas del 2026-08-03: el adjunto a mano
    era el 55% del turno —~94s de ese tramo eran el portero de comandos de
    Hermes autorizando el `curl`, contra ~6s de subida real— y otros ~31s se
    perdian porque el `curl` de la skill interpolaba $ADMCLOUD_REG_ROLE crudo en
    la URL. Ese rol vale "Contabilidad Digital", CON ESPACIO, y sin encodear da
    HTTP 000. Aca la query la arma urlencode, igual que en llamar().
    """
    nombre = os.path.basename(ruta)
    with open(ruta, "rb") as f:
        contenido = f.read()
    tipo = mimetypes.guess_type(nombre)[0] or "application/octet-stream"
    borde = "----qualiaconta" + re.sub(r"\W", "", guid)
    cuerpo = b"".join([
        ("--%s\r\n" % borde).encode(),
        ('Content-Disposition: form-data; name="file"; filename="%s"\r\n'
         % nombre.replace('"', "_")).encode("utf-8"),
        ("Content-Type: %s\r\n\r\n" % tipo).encode(),
        contenido,
        ("\r\n--%s--\r\n" % borde).encode(),
    ])
    q = {
        "transactionID": guid,
        "company": env("ADMCLOUD_COMPANY"),
        "role": env("ADMCLOUD_REG_ROLE"),
        "appid": env("ADMCLOUD_APPID"),
    }
    url = "%s/api/Storage?%s" % (BASE, urllib.parse.urlencode(q))
    cred = base64.b64encode(
        ("%s:%s" % (env("ADMCLOUD_REG_USER"), env("ADMCLOUD_REG_PASSWORD"))).encode()
    ).decode()
    req = urllib.request.Request(url, data=cuerpo, method="POST")
    req.add_header("Authorization", "Basic " + cred)
    req.add_header("Accept", "application/json")
    req.add_header("Content-Type", "multipart/form-data; boundary=" + borde)
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def paginar(ruta, cortar=None):
    """`skip` es obligatorio y `take` se ignora: se avanza por lo devuelto.

    `cortar(lote)` es opcional y se evalua DESPUES de sumar el lote: si devuelve
    True se deja de pedir paginas. Sirve para los listados que vienen ordenados
    y donde el resto del historico no aporta nada."""
    filas, skip = [], 0
    for _ in range(60):
        d = llamar("GET", ruta, params={"skip": skip})
        lote = d.get("data") or []
        if not lote:
            break
        filas.extend(lote)
        skip += len(lote)
        if cortar is not None and cortar(lote):
            break
    return filas


def fecha_corte(doc_date, meses=6):
    """La fecha del documento menos N meses, en ISO (dia 1, el borde conservador).

    Sin dependencias de calendario: se resta sobre (anio, mes). Si la fecha no
    se puede leer devuelve una fecha imposiblemente vieja, o sea NO cortar y
    paginar todo — ante la duda se paga el tiempo, no se pierde el chequeo."""
    iso = str(doc_date or "")[:10]
    try:
        anio, mes = int(iso[0:4]), int(iso[5:7])
    except (ValueError, IndexError):
        return "0000-01-01"
    total = anio * 12 + (mes - 1) - meses
    return "%04d-%02d-01" % (total // 12, total % 12 + 1)


def sql(consulta, **variables):
    cmd = ["psql", env("QUALIA_DSN"), "-t", "-A", "-F", "\t", "-q"]
    for k, v in variables.items():
        cmd += ["-v", "%s=%s" % (k, v)]
    # Por STDIN y no con -c: `psql -c` NO interpola las variables -v.
    r = subprocess.run(cmd, input=consulta, capture_output=True, text=True)
    if r.returncode != 0:
        morir("consulta a la mesa fallo: %s" % r.stderr.strip()[:200])
    return [l.split("\t") for l in r.stdout.strip().splitlines() if l.strip()]


# ---------------------------------------------------------------- proveedor
def nombre_plano(txt):
    """Mayusculas y espacios colapsados. Alcanza para comparar contra una lista
    cerrada; NO es un normalizador de nombres de proveedor y no debe usarse para
    buscar uno cualquiera — de eso se encarga el RNC."""
    return re.sub(r"\s+", " ", str(txt or "")).strip().upper()


def proveedor_sin_rnc(p):
    """El unico camino que resuelve un proveedor por NOMBRE, y solo para SIN_RNC.

    Se BUSCA, nunca se crea: un proveedor dado de alta sin RNC queda en ADM como
    una ficha que despues nadie puede casar con DGII. Si no existe, lo abre un
    humano una vez y desde ahi este camino lo encuentra siempre."""
    nombre = nombre_plano(p.get("proveedor"))
    if nombre not in [nombre_plano(n) for n in SIN_RNC]:
        morir("la propuesta no trae un RNC valido: no busco ni creo el proveedor")

    for v in paginar("Vendors"):
        if nombre_plano(v.get("Name")) == nombre:
            print("proveedor: %s (entidad sin RNC, resuelta por nombre)" % v.get("Name"))
            return v.get("ID"), v.get("PaymentTermID") or TERMINOS["al contado"]

    morir("«%s» esta en la lista de entidades sin RNC pero no existe en ADM. Se "
          "da de alta a mano una sola vez; no creo un proveedor sin RNC."
          % p.get("proveedor"))


def asegurar_proveedor(p, simular):
    """Devuelve el RelationshipID. Si el proveedor no existe, lo crea.

    El match es por RNC exacto, NUNCA por nombre: los nombres se escriben de
    veinte formas. El nombre para crearlo sale de la razon social de DGII, que
    es la oficial — no de lo impreso en el papel.

    DGII responde eso por DOS vias distintas y cualquiera sirve para el alta:
    la verificacion del comprobante (`dgii`) y el padron de RNC (`rnc_padron`).
    El padron es el que rescata al e-CF cuya foto no dejo leer el codigo de
    seguridad: sin el, un comprobante no verificable dejaba al proveedor sin
    nombre y el trabajo moria pudiendo resolverse con el RNC solo.

    La UNICA excepcion al match por RNC son las entidades de SIN_RNC, que no
    tienen uno que buscar. Ver proveedor_sin_rnc().
    """
    rnc = re.sub(r"\D", "", str(p.get("rnc") or ""))
    if len(rnc) not in (9, 11):
        return proveedor_sin_rnc(p)

    for v in paginar("Vendors"):
        if re.sub(r"\D", "", str(v.get("FiscalID") or "")) == rnc:
            estado_aut = v.get("AuthorizationStatusDesc") or ""
            extra = "" if "aprobad" in estado_aut.lower() else "  [%s]" % estado_aut
            print("proveedor: %s (ya existia)%s" % (v.get("Name"), extra))
            return v.get("ID"), v.get("PaymentTermID") or TERMINOS["al contado"]

    dgii = p.get("dgii") or {}
    padron = p.get("rnc_padron") or {}
    comprobante_ok = str(dgii.get("estado") or "").upper() in ("VIGENTE", "ACEPTADO")
    padron_ok = (str(padron.get("estado") or "").upper() == "ENCONTRADO"
                 and bool(str(padron.get("razon_social") or "").strip()))

    # El respaldo del ALTA es que DGII reconozca el RNC, no que el comprobante
    # verifique: son dos preguntas. Un comprobante que no verifica sigue
    # bajando confianza y puede terminar en gasto no admitido — eso lo decide
    # el humano en la web —, pero no es motivo para no poder nombrar al emisor.
    if comprobante_ok:
        nombre = (dgii.get("razon_social_emisor") or "").strip()
    elif padron_ok:
        nombre = str(padron["razon_social"]).strip()
    else:
        nombre = ""

    if not nombre:
        morir("el proveedor RNC %s no existe en ADM y ninguna via de DGII dio su "
              "razon social (comprobante: %s; padron: %s). Consulta el padron con "
              "consultar-rnc-dgii.py antes de rendirte; no invento el nombre."
              % (rnc, dgii.get("estado") or "sin consultar",
                 padron.get("estado") or "sin consultar"))
    if not comprobante_ok and not padron_ok:
        morir("el proveedor no existe, su comprobante no verifica en DGII "
              "(estado: %s) y el padron tampoco lo reconoce. No doy de alta un "
              "proveedor sin respaldo." % dgii.get("estado"))
    if not comprobante_ok:
        estado_c = str(padron.get("estado_contribuyente") or "").upper()
        print("proveedor: nombre tomado del padron de RNC (el comprobante quedo "
              "en '%s')%s" % (dgii.get("estado") or "sin consultar",
                              "" if estado_c in ("", "ACTIVO") else "  [contribuyente %s]" % estado_c))

    termino = TERMINOS["al contado"]
    m = re.search(r"(30|45|60)\s*d[ií]as", str(p.get("termino_pago") or ""), re.I)
    if m:
        termino = TERMINOS[m.group(1)]

    nuevo = {"Name": nombre, "FiscalID": rnc, "IsVendor": True,
             "CurrencyID": p.get("moneda") or "DOP", "PaymentTermID": termino}
    print("proveedor: NO existe, se crea -> %s" % nombre)
    if simular:
        print(json.dumps(nuevo, ensure_ascii=False, indent=1))
        return "<uuid-del-proveedor-nuevo>", termino

    d = llamar("POST", "Vendors", cuerpo=nuevo)
    if not d.get("success") or not isinstance(d.get("data"), str):
        morir("no pude crear el proveedor: %s" % sanear(d.get("message")))
    print("   creado: %s (nace Pendiente de Aprobacion: un humano lo aprueba en ADM)"
          % d["data"])
    return d["data"], termino


# ------------------------------------------------------------------ factura
def mapa_cuentas():
    """codigo de cuenta -> UUID. La propuesta trae el codigo ("611.17"), que es
    como piensa el contable; ADM necesita el UUID. La traduccion la hace este
    script y no el modelo: es una busqueda exacta, no un juicio.
    OJO: en /api/Accounts el campo del codigo es `Code`; `AccountCode` viene null."""
    mapa = {}
    for c in paginar("Accounts"):
        cod = str(c.get("Code") or c.get("AccountCode") or "").strip()
        if cod and c.get("ID"):
            mapa.setdefault(cod, c["ID"])
    return mapa


def armar_payload(p, relationship_id, payment_term_id):
    lineas = p.get("lineas") or []
    if not lineas:
        morir("la propuesta no trae lineas")
    cuentas = mapa_cuentas()
    items = []
    for i, l in enumerate(lineas, 1):
        sched_id, sched_pct = resolver_tasa_linea(
            l.get("itbis"), l.get("cantidad"), l.get("precio"))
        items.append({
            "RowOrder": i, "RowType": 0,
            "Name": str(l.get("descripcion") or "")[:200],
            "Quantity": float(l.get("cantidad") or 1),
            "Price": float(l.get("precio") or 0),
            "Cost": 0.0, "DiscountPercent": 0.0, "ExchangeRate": 0.0,
            "AccountID": (l.get("account_id") or l.get("cuenta_id")
                          or cuentas.get(str(l.get("cuenta") or "").strip())),
            # El monto del ITBIS NO se manda: el server lo calcula del grupo.
            "TaxScheduleID": sched_id,
            "TaxPercent": sched_pct,
        })
    faltan = [(items[j]["Name"], lineas[j].get("cuenta"))
              for j in range(len(items)) if not items[j]["AccountID"]]
    if faltan:
        morir("no encontre en ADM la cuenta de estas lineas (renglon, codigo): %s. "
              "Si el codigo esta bien escrito, esa cuenta no existe o esta inactiva "
              "en el catalogo: preguntale al humano antes de registrar." % faltan)

    # Ajustar un precio para que la cuenta de ADM caiga en el total del papel.
    # ADM recalcula Net y Tax renglon por renglon y redondea medio hacia arriba;
    # si los precios no se eligen para eso, el documento queda registrado por
    # otro total. Eran 13 de 63 en BlackBox al 2026-08-05, y ese centavo esta
    # dentro del ITBIS que va al 606.
    items, ajuste = cuadre.cuadrar_items(items, p.get("monto") or 0)
    if ajuste:
        # Se dice QUE renglon y de cuanto a cuanto, no solo el monto movido: con
        # tres decimales el movimiento puede ser de milesimas y «+0.00» leido en
        # un log parece que no se toco nada.
        print("  cuadre: renglon %d, precio %s -> %s (%+0.2f en el total) para "
              "que ADM llegue al total del papel"
              % (ajuste["renglon"] + 1, ajuste["antes"], ajuste["despues"],
                 float(ajuste["movido"])))

    payload = {
        "DocDate": p.get("fecha"),
        "Reference": p.get("numero_factura_suplidor") or p.get("ncf"),
        "NCF": p.get("ncf"),
        "RelationshipID": relationship_id,
        # None y no "" cuando no hay RNC: asi quedo la FP00001133, que es la
        # unica registrada contra una entidad de SIN_RNC y la unica evidencia
        # de que ADM acepta el documento. Vacio y ausente no son lo mismo.
        "FiscalID": re.sub(r"\D", "", str(p.get("rnc") or "")) or None,
        "Beneficiary": str(p.get("proveedor") or "")[:120],
        "CurrencyID": p.get("moneda") or "DOP",
        "ExchangeRate": 1.0,
        # Obligatorio aunque el esquema lo marque opcional: omitirlo devuelve
        # "Este termino de pago no existe". Se hereda del proveedor.
        "PaymentTermID": payment_term_id,
        "ExpenseTypeID": (p.get("tipo_gasto") or {}).get("adm_id") or TIPO_GASTO_DEFECTO,
        "Items": items,
    }

    # ADM frena un duplicado por DOS claves independientes: el NCF y la
    # referencia del proveedor. Sin NINGUNA de las dos deja pasar el mismo
    # documento cuantas veces se lo mande, callado. Un papel sin NCF no es raro
    # (el Estado no emite comprobante fiscal); lo que no puede faltar entonces
    # es la referencia. Las 1120 facturas del historico traen una u otra, asi
    # que esto no cierra un camino: deja escrito el porque.
    #
    # Va aca y no en verificar_duplicado() porque aquella NO corre con
    # --simular, que es el modo con el que se comprueba si el registro va a
    # andar. Simular en verde y morir al registrar es el desvio que este
    # chequeo existe para evitar.
    if not str(payload["NCF"] or "").strip() and not str(payload["Reference"] or "").strip():
        morir("el documento no trae NCF ni referencia, y esas son las DOS claves "
              "con las que ADM frena un duplicado: sin ninguna, la misma plata se "
              "puede registrar dos veces sin que nadie se entere. Ponle la "
              "referencia del papel — en una liquidacion de aduana, el numero de "
              "DUA — y volve a intentar.")
    return payload


def lecturas_posibles(itbis_papel, total_papel):
    """Que base y que exento harian falta, en cada tasa legal, para que la
    cabecera del documento cierre. Devuelve [(tasa, base, exento)] ordenado por
    |exento|: primero la lectura que menos obliga a inventar.

    Es la pregunta que el cuadre solo no responde. Con total e ITBIS hay dos
    incognitas y una ecuacion, asi que TODAS las tasas producen una lectura que
    suma bien; la unica que es de verdad del documento es la que no necesita un
    renglon exento que nadie leyo."""
    posibles = []
    for t in sorted(TAX_SCHEDULES):
        base = itbis_papel / (t / 100.0)
        exento = total_papel - itbis_papel - base
        if exento < -0.05:      # la base sola pasaria el total: imposible
            continue
        posibles.append((t, round(base, 2), round(exento, 2)))
    return sorted(posibles, key=lambda r: abs(r[2]))


def verificar_cuadre(p, payload):
    """El ITBIS lo calcula ADM aplicando 18% a los precios: si el ITBIS impreso
    en la factura NO es el 18% de esas lineas, el documento va a quedar
    registrado por un monto distinto al del papel.

    Paso en produccion el 2026-08-03 (FP00001063): el papel decia 4,520.47 con
    ITBIS 575.72, y ADM cobro 645.51 sobre las mismas lineas -> 69.79 de mas.
    Se chequea ANTES del POST, porque despues la unica salida es borrar el
    documento y ADM no deja anular.
    """
    # Suma por tasa: cada schedule tiene su %, y ADM lo aplica a su base.
    # ADM redondea RENGLON POR RENGLON y medio hacia arriba. La version vieja
    # sumaba los ITBIS sin redondear y redondeaba una sola vez al final, asi que
    # su prediccion no era la de ADM y las diferencias de centavos se le
    # escapaban por debajo de la tolerancia.
    itbis_adm = 0.0
    base_gravada = 0.0
    exento = 0.0
    for item in payload["Items"]:
        neto = float(cuadre.r2(item["Quantity"] * item["Price"]))
        if item["TaxScheduleID"]:
            base_gravada += neto
            itbis_adm += float(cuadre.r2(neto * item["TaxPercent"] / 100.0))
        else:
            exento += neto
    itbis_adm = round(itbis_adm, 2)
    total_adm = round(base_gravada + exento + itbis_adm, 2)
    base = base_gravada

    itbis_papel = round(float(p.get("itbis") or 0), 2)
    total_papel = round(float(p.get("monto") or 0), 2)

    if abs(itbis_adm - itbis_papel) > 0.05 or abs(total_adm - total_papel) > 0.05:
        morir(
            "NO CUADRA con el documento, no registro:\n"
            "  el papel dice   total %.2f  ITBIS %.2f\n"
            "  ADM cobraria    total %.2f  ITBIS %.2f  (18%% sobre %.2f de base)\n"
            "  diferencia      %.2f\n"
            "Alguna linea tiene el precio o el grupo de impuesto mal leido, o la\n"
            "factura trae un descuento que no se capturo. Corregi las lineas o\n"
            "preguntale al humano; NO se registra un documento que no coincide."
            % (total_papel, itbis_papel, total_adm, itbis_adm, base,
               total_adm - total_papel))

    # Que sume es NECESARIO pero no suficiente, y esto es lo que faltaba. El
    # chequeo de arriba aprueba a TODAS las tasas por igual: mientras se pueda
    # repartir la base entre gravado y exento, cualquiera de ellas suma bien.
    # Lo que las desempata es cuanto hay que inventar para llegar al total.
    #
    # Paso el 2026-08-04 con FP00001120 (Carrefour, cafe): al 18% sobraban 35.90
    # que se fueron a un renglon "Productos exentos (no individualizados por el
    # preparador)"; al 16% -la reducida del art. 343, la del cafe- la cabecera
    # cierra sola con base 323.23 y cero exentos. Se registro al 18%, con un
    # credito fiscal que el proveedor nunca facturo.
    #
    # Solo corre con UNA tasa en juego: una factura ya desglosada en 16 y 18
    # sabe lo que hace, y ahi el exento es dato leido, no residuo.
    usadas = {i["TaxPercent"] for i in payload["Items"] if i["TaxScheduleID"]}
    if exento > 0.05 and len(usadas) == 1:
        propia = next(iter(usadas))
        limpias = [(t, b) for t, b, e in lecturas_posibles(itbis_papel, total_papel)
                   if abs(e) <= 0.05 and abs(t - propia) > 0.5]
        if limpias:
            t_ok, base_ok = limpias[0]
            morir(
                "CUADRA PERO LA TASA NO SE SOSTIENE, no registro:\n"
                "  esta propuesta cobra ITBIS %.0f%% sobre una base de %.2f y manda\n"
                "  %.2f a renglones exentos para llegar al total.\n"
                "  Al %.0f%% la misma cabecera cierra SOLA: base %.2f, exentos 0.00.\n"
                "  Un exento que sale de la resta y no del papel es la firma de una\n"
                "  tasa mal asumida — casi siempre la reducida del art. 343 (cafe,\n"
                "  cacao, azucar, mantequilla, yogurt).\n"
                "Volve al documento, mira que tasa dice impresa, y corregi las lineas."
                % (propia, base, exento, t_ok, base_ok))


def verificar_duplicado(ncf, referencia, doc_date=None):
    """Aviso temprano. ADM tambien lo frena, pero mejor no gastar el POST.

    NO se pagina el historico entero. /api/VendorBills viene del mas NUEVO al
    mas viejo (verificado 2026-08-03 contra produccion: pagina 0 arranca en
    FP00001114 del 08-03 y la ultima fila es PI20240921 de 2024-12), asi que
    alcanza con bajar hasta 6 meses antes de la fecha del documento y parar.
    Medido: 1106 filas / 23 paginas / 9.04s el barrido completo, contra ~1.5s
    con el corte, en CADA registro y creciendo con el historico.

    Lo que queda afuera del corte no queda sin barrera: ADM frena el duplicado
    por DOS claves independientes (mismo NCF para el RNC, o misma referencia
    del proveedor) y devuelve un mensaje claro. Este chequeo es cortesia para
    avisar ANTES de gastar el POST, no la unica defensa.

    Que el documento tenga al menos UNA de las dos claves lo garantiza
    armar_payload(), que corre tambien con --simular."""
    corte = fecha_corte(doc_date)

    def ya_es_viejo(lote):
        ultimo = str(lote[-1].get("DocDate") or "")[:10]
        return bool(ultimo) and ultimo < corte

    for f in paginar("VendorBills", cortar=ya_es_viejo):
        if str(f.get("NCF") or "").strip().upper() == str(ncf).upper():
            morir("YA REGISTRADA: %s tiene ese NCF" % f.get("DocID"))
        if referencia and str(f.get("Reference") or "").strip() == str(referencia):
            morir("YA REGISTRADA: %s tiene esa referencia" % f.get("DocID"))


def leer_de_vuelta(guid):
    """El POST solo devuelve el UUID; el DocID sale de acá. Y hay que confirmar
    que el documento devuelto sea EL nuestro: pasarle cualquier cosa a getbyid
    devuelve otro documento con success:true."""
    d = (llamar("GET", "VendorBills/%s" % guid).get("data")) or {}
    if str(d.get("ID") or "").lower() != guid.lower():
        morir("el readback devolvio OTRO documento (%s). La factura puede estar "
              "creada igual: buscala por NCF antes de reintentar." % d.get("DocID"))
    return d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trabajo", required=True)
    ap.add_argument("--simular", action="store_true")
    args = ap.parse_args()
    if not re.match(r"^[0-9a-f-]{36}$", args.trabajo):
        morir("trabajo_id invalido")

    filas = sql("select estado, propuesta::text from qualia_trabajos "
                "where id = :'id' and empresa_id = :'emp';",
                id=args.trabajo, emp=env("QUALIA_EMPRESA_ID"))
    if not filas:
        morir("ese trabajo no existe en la mesa")
    estado, propuesta_txt = filas[0][0], filas[0][1]
    if estado != "aprobada":
        morir("el trabajo esta en '%s': solo se registra lo aprobado" % estado)
    p = json.loads(propuesta_txt)
    # Abortar solo si el registro esta VIVO. En ADM revertir BORRA el documento
    # (no lo anula), asi que la fila se queda con el docid + una lapida
    # (`eliminado_en`). Sin esta distincion una factura corregida no se podia
    # volver a registrar NUNCA: el guard moria contra un documento que ya no
    # existe. Paso con HUAYAO / FP00001063 el 2026-08-03.
    # El registro nuevo pisa la lapida; el rastro de la borrada vive en el
    # libro de accion, que es append-only y es el registro canonico.
    reg = p.get("registro_adm") or {}
    muerto = reg.get("eliminado_en") or reg.get("anulado_en")
    if reg.get("docid") and not muerto:
        morir("ya tiene registro_adm vivo: %s" % reg["docid"])
    if reg.get("docid"):
        print("nota: la fila trae %s pero fue %s el %s — registro de nuevo" % (
            reg["docid"],
            "eliminada" if reg.get("eliminado_en") else "anulada", muerto))

    rid, termino_pago = asegurar_proveedor(p, args.simular)
    payload = armar_payload(p, rid, termino_pago)

    if args.simular:
        print()
        print(json.dumps(payload, ensure_ascii=False, indent=1))
        print()
        verificar_cuadre(p, payload)
        print("el cuadre coincide con el documento")
        return

    verificar_cuadre(p, payload)
    verificar_duplicado(payload["NCF"], payload["Reference"], payload.get("DocDate"))

    d = llamar("POST", "VendorBills", cuerpo=payload)
    if not d.get("success") or not isinstance(d.get("data"), str):
        morir("ADM rechazo la factura: %s" % sanear(d.get("message")))
    guid = d["data"]

    doc = leer_de_vuelta(guid)
    print("REGISTRADA: %s (uuid %s)" % (doc.get("DocID"), guid))
    print("  total %s | itbis %s" % (doc.get("TotalAmount"), doc.get("TaxAmount")))

    sql("update qualia_trabajos set propuesta = propuesta || "
        "jsonb_build_object('registro_adm', jsonb_build_object("
        "'docid', :'doc', 'uuid', :'guid', 'documento', 'VendorBills', "
        "'fecha', now()::date, 'reference', :'ref')) "
        "where id = :'id' and empresa_id = :'emp';",
        doc=doc.get("DocID"), guid=guid, ref=payload["Reference"],
        id=args.trabajo, emp=env("QUALIA_EMPRESA_ID"))
    print("  guardado en la mesa")

    # El adjunto. Era el unico paso que quedaba a mano y se comia el 55% del
    # turno (ver subir_adjunto). Va DESPUES de guardar el docid a proposito: el
    # docid es el dato irremplazable y no se hace esperar detras de una subida.
    # Si falla NO se aborta — la factura ya esta registrada y eso es lo que hay
    # que dejar asentado; el adjunto se reintenta.
    ruta, motivo = bajar_documento(args.trabajo)
    if not ruta:
        print("  ADJUNTO: no pude bajar el documento, subilo a mano — %s" % motivo)
    else:
        try:
            da = subir_adjunto(guid, ruta)
        except Exception as e:
            da = {"success": False, "message": type(e).__name__}
        if da.get("success"):
            print("  adjunto: %s subido" % os.path.basename(ruta))
            sql("update qualia_trabajos set propuesta = jsonb_set(propuesta, "
                "'{registro_adm,adjunto}', jsonb_build_object("
                "'nombre', :'n', 'storage_id', :'sid')) "
                "where id = :'id' and empresa_id = :'emp';",
                n=os.path.basename(ruta),
                sid=da.get("data") if isinstance(da.get("data"), str) else "",
                id=args.trabajo, emp=env("QUALIA_EMPRESA_ID"))
        else:
            print("  ADJUNTO FALLO (%s). La factura SI quedo registrada."
                  % sanear(da.get("message")))
            print("  Reintentalo con el curl del SKILL sobre uuid %s, y OJO: el"
                  % guid)
            print("  rol lleva espacio, va como 'Contabilidad%20Digital' en la URL.")

    # Cerrar la fila. Hasta hoy este paso NO EXISTIA en ninguna capa del sistema
    # (ni aca, ni en la skill, ni en la web): la factura se registraba de verdad
    # y la mesa la dejaba en 'aprobada' para siempre, asi que desde la web
    # parecia que no se habia registrado nunca.
    #
    # Va en una sentencia APARTE de la de arriba a proposito. Si alguien movio el
    # trabajo mientras corriamos, el guard `estado='aprobada'` no matchea — y en
    # una sola sentencia eso se llevaria puesto tambien el docid, que es el dato
    # irremplazable: ata la fila a un documento real en ADM. El estado se corrige
    # despues; el docid no se recupera. La garantia de "nunca registrada sin
    # evidencia" la da el CHECK qualia_trabajos_registrada_con_evidencia, no la
    # atomicidad de esta linea.
    #
    # NADA de `updated_at = now()` en el SET: el rol tiene grant solo sobre
    # estado/propuesta/resumen/error_detalle y el UPDATE entero muere con
    # "permission denied". El trigger de updated_at ya lo sella solo.
    cerrado = sql("update qualia_trabajos set estado = 'registrada' "
                  "where id = :'id' and empresa_id = :'emp' "
                  "and estado = 'aprobada' returning id;",
                  id=args.trabajo, emp=env("QUALIA_EMPRESA_ID"))
    if cerrado:
        print("  estado: registrada")
    else:
        print("  OJO: el docid quedo guardado pero el estado NO se cerro; "
              "el trabajo ya no estaba en 'aprobada'. Revisar a mano.")
    print()
    print("Falta solo el libro de accion, citando %s." % doc.get("DocID"))


if __name__ == "__main__":
    main()
