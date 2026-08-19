#!/usr/bin/env python3
"""Registra en ADM Cloud un cargo bancario (BankCharges) aprobado en la mesa.

Cubre capitalización de intereses y otros cargos/creditos bancarios:
  - CashAccountID = la cuenta de banco (débito/crédito implícito en la cabecera)
  - Accounts[] = las líneas contrapartida (intereses, retenciones, etc.)
  - TotalAmount negativo para créditos (entra dinero al banco)

Es ARCHIVO por la misma razón que registrar-en-adm.py: el guardián de comandos
marca `python3 -c` y cobra 15-30s por llamada.

Uso:
    registrar-cargo-bancario.py --trabajo <uuid>            # registra
    registrar-cargo-bancario.py --trabajo <uuid> --simular  # payload sin escribir
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

BASE = "https://api.admcloud.net"
TIMEOUT = 90

# Cuentas de ingreso (700.xx) y otras que no salen en el paginado de /api/Accounts
# pero existen y se pueden leer por UUID directo.
UUIDS_CONOCIDOS = {
    "700.01": "576cbb2b-ab48-4b26-77fc-08dd1014e167",  # Intereses Bancarios
    "150.06": "4cef27bb-50aa-4e94-1c6b-08dd4c3ef461",  # Retencion DGII 1%
}

# Tipo de gasto del 606 (catalogo DGII, /api/ExpenseTypes): "07 Gastos
# Financieros". Es el que la contable le puso a los 51 cargos con NCF del
# historico; los que no llevaban comprobante iban SIN tipo de gasto.
EXPENSE_TYPE_GASTOS_FINANCIEROS = "aaee37e1-3cde-485d-92fd-a0db22efd789"

# RNC del banco emisor del comprobante: va en `FiscalID` de la cabecera (el
# campo "RNC" de la pantalla Cargo/Credito Bancario). Sin el, la linea del 606
# sale con NCF pero sin emisor y el gasto pierde el respaldo. Los 16 CB de
# agosto 2026 salieron asi y los tuvo que corregir la contable a mano.
# Solo digitos, como el Vendor "Banco Multiple Santa Cruz S A" en ADM.
BANCO_RNC = {
    "santacruz": "102012921",  # Banco Multiple Santa Cruz S A
}


def morir(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


def env(nombre):
    v = os.environ.get(nombre)
    if not v:
        morir("falta la variable de entorno %s" % nombre)
    return v


def sanear(txt):
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
        morir("fallo la llamada a %s: %s (si era POST, NO reintentes)" % (ruta, type(e).__name__))


def sql(consulta, **variables):
    cmd = ["psql", env("QUALIA_DSN"), "-t", "-A", "-F", "\t", "-q"]
    for k, v in variables.items():
        cmd += ["-v", "%s=%s" % (k, v)]
    r = subprocess.run(cmd, input=consulta, capture_output=True, text=True)
    if r.returncode != 0:
        morir("consulta a la mesa fallo: %s" % r.stderr.strip()[:200])
    return [l.split("\t") for l in r.stdout.strip().splitlines() if l.strip()]


def paginar(ruta):
    filas, skip = [], 0
    for _ in range(60):
        d = llamar("GET", ruta, params={"skip": skip})
        lote = d.get("data") or []
        if not lote:
            break
        filas.extend(lote)
        skip += len(lote)
    return filas


def mapa_cuentas():
    """codigo de cuenta -> UUID. Pagina /api/Accounts."""
    mapa = {}
    for c in paginar("Accounts"):
        cod = str(c.get("Code") or c.get("AccountCode") or "").strip()
        if cod and c.get("ID"):
            mapa.setdefault(cod, c["ID"])
    return mapa


def tasa_cambio(moneda):
    """Lee la tasa de cambio configurada en ADM para la moneda dada."""
    if moneda == "DOP":
        return 1.0
    for c in paginar("Currencies"):
        if c.get("ID") == moneda:
            return float(c.get("ExchangeRate") or 1.0)
    return 1.0


# Las tarjetas de crédito TAMBIEN son cuentas de caja en ADM, aunque su código
# viva en el pasivo: los 9 «AHORRO POR COMPRA» del histórico (CB00000070 …
# CB00000113) son Cargos Bancarios con la tarjeta en CashAccountID. Van
# enumeradas y no por prefijo "203." porque 203.xx es Cuentas por Pagar: tomar
# el prefijo entero haría pasar por banco la línea de un proveedor.
# Espejo de `cuentas` en mapa-cuentas.yaml; si agregás una tarjeta allá, va acá.
CUENTAS_CAJA_TARJETA = {"203.10", "203.11"}


def es_cuenta_banco(codigo):
    """Cuentas de caja: 101 (caja), 102 (bancos) y las tarjetas del mapa."""
    cod = str(codigo or "").strip()
    return (cod.startswith("101.") or cod.startswith("102.")
            or cod in CUENTAS_CAJA_TARJETA)


def referencia_de(p, trabajo_id):
    """La llave que ata ESTE documento a ESTE cargo del banco.

    Con comprobante fiscal la llave es el NCF: es unico por empresa y ADM
    frena duplicados por el (igual que con las facturas de proveedor), asi
    que ademas de identificar, protege.

    Sin comprobante no hay llave natural —dos comisiones iguales del mismo
    dia son indistinguibles en ADM— y se cae al `banco_tx_id` (el movimiento
    en `openbanking_transactions`); si tampoco esta, al id del trabajo.
    """
    return str(p.get("ncf") or p.get("banco_tx_id") or trabajo_id)


def subir_adjunto(guid, ruta):
    """Sube un archivo como adjunto de la transaccion de ADM.

    Multipart a mano porque la stdlib no lo arma sola y no hay `requests` en el
    venv. Es gemela de la de registrar-en-adm.py y esta DUPLICADA a proposito:
    importarla de ese script ejecutaria todo su nivel superior —lee entorno,
    arma sesion— por el solo hecho de subir un PDF, y son dos scripts en
    produccion que no conviene acoplar por eso. Si aparece una tercera, ahi si
    vale un modulo compartido.

    Ojo con el rol: ADMCLOUD_REG_ROLE vale "Contabilidad Digital", CON ESPACIO,
    y sin encodear da HTTP 000. Por eso la query la arma urlencode."""
    nombre = os.path.basename(ruta)
    with open(ruta, "rb") as f:
        contenido = f.read()
    # No siempre es PDF: el papel de un pago sin NCF puede ser la foto que
    # subio el humano (jpeg/png). El tipo sale de la extension.
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


def docids_reclamados():
    """DocIDs que la mesa ya se atribuye, con registro vivo.

    Es la mitad que faltaba del chequeo de duplicados: ADM no sabe de quien es
    cada cargo, pero la mesa si. Un gemelo que otro trabajo ya reclamo no puede
    ser este movimiento.
    """
    filas = sql(
        "select propuesta->'registro_adm'->>'docid' from qualia_trabajos "
        " where empresa_id = :'emp' "
        "   and propuesta->'registro_adm'->>'docid' is not null "
        "   and coalesce(propuesta->'registro_adm'->>'eliminado_en','') = '' "
        "   and coalesce(propuesta->'registro_adm'->>'anulado_en','') = '';",
        emp=env("QUALIA_EMPRESA_ID"))
    return {f[0].strip() for f in filas if f and f[0].strip()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trabajo", required=True)
    ap.add_argument("--simular", action="store_true")
    # Solo para el caso ambiguo, y solo despues de preguntarle al humano: hay un
    # cargo igual en ADM que nadie reclama y el dueño confirmó que NO es este.
    ap.add_argument("--forzar", action="store_true")
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

    reg = p.get("registro_adm") or {}
    muerto = reg.get("eliminado_en") or reg.get("anulado_en")
    if reg.get("docid") and not muerto:
        morir("ya tiene registro_adm vivo: %s" % reg["docid"])

    documento = p.get("documento_adm") or "BankCharges"
    if documento != "BankCharges":
        morir("este script solo registra BankCharges; la propuesta dice '%s'" % documento)

    lineas = p.get("lineas") or []
    if not lineas:
        morir("la propuesta no trae lineas")

    moneda = p.get("moneda") or "DOP"
    fecha = p.get("fecha")
    descripcion = p.get("descripcion") or p.get("resumen") or ""
    direccion = p.get("direccion") or "credito"
    ncf = str(p.get("ncf") or "").strip() or None

    cuentas = mapa_cuentas()

    # Identificar la linea del banco (CashAccountID): la cuenta que empieza con
    # 101/102. Si hay mas de una, la primera. Si no hay ninguna, morir.
    banco_idx = None
    for i, l in enumerate(lineas):
        if es_cuenta_banco(l.get("cuenta")):
            banco_idx = i
            break
    if banco_idx is None:
        morir("no encontre la cuenta de caja (101.xx/102.xx o una tarjeta) en "
              "las lineas — si es una cuenta nueva, agregala a `cuentas` en "
              "mapa-cuentas.yaml y a CUENTAS_CAJA_TARJETA de este script")

    banco_cod = str(lineas[banco_idx].get("cuenta") or "").strip()
    banco_uuid = cuentas.get(banco_cod)
    if not banco_uuid:
        morir("no encontre el UUID de la cuenta de banco '%s' en ADM" % banco_cod)

    # Las demas lineas van en Accounts[] (contrapartida)
    accounts = []
    for i, l in enumerate(lineas):
        if i == banco_idx:
            continue  # el banco va en CashAccountID, no en Accounts[]
        cod = str(l.get("cuenta") or "").strip()
        uid = cuentas.get(cod) or UUIDS_CONOCIDOS.get(cod)
        if not uid:
            morir("no encontre el UUID de la cuenta '%s' (linea %d)" % (cod, i + 1))
        debito = float(l.get("debito") or 0)
        credito = float(l.get("credito") or 0)
        accounts.append({
            "RowOrder": len(accounts),
            "RowType": 0,
            "AccountID": uid,
            "Debit": debito,
            "Credit": credito,
            "NetAmount": credito - debito,
            "Quantity": 0.0,
            "ExchangeRate": 0.0,
            "LocalAmount": 0.0,
            "NetLocalAmount": 0.0,
            "Reference": None,
            "ProjectID": None,
            "DivisionID": None,
            "LocationID": None,
            "ClassID": None,
            "DepartmentID": None,
            "FixedAssetID": None,
            "RelationshipID": None,
            "IsHidden": False,
            "Conciliated": False,
            "ExpenseCategoryID": None,
            "ItemID": None,
            "TaxID": None,
            "Notes": str(l.get("descripcion") or l.get("cuenta_nombre") or "")[:200],
        })

    if not accounts:
        morir("no hay lineas de contrapartida (todas eran el banco?)")

    monto = float(p.get("monto") or 0)
    total_amount = -abs(monto) if direccion == "credito" else abs(monto)
    # Con comprobante manda LA TASA DEL BANCO, no la configurada en ADM: es la
    # que el propio banco uso para facturar (US$60 -> RD$3.477,17 = 57,9528) y
    # es la unica con la que el monto fiscal del NCF reconstruye. La de ADM es
    # una tasa de sistema y daria otro numero en el 606.
    tasa = float(p.get("tasa_usd") or 0) or tasa_cambio(moneda)

    # Validar partida doble
    sum_d = sum(a["Debit"] for a in accounts)
    sum_c = sum(a["Credit"] for a in accounts)
    if direccion == "credito":
        dif = sum_c - sum_d - monto
    else:
        dif = sum_d - sum_c - monto
    if abs(dif) > 0.05:
        morir("no cuadra: contrapartida da %.2f, monto banco %.2f, dif %.4f"
              % (sum_c - sum_d, monto, dif))

    referencia = referencia_de(p, args.trabajo)

    payload = {
        "DocDate": fecha,
        "DocType": "BANK_TRA",
        "CashAccountID": banco_uuid,
        "CurrencyID": moneda,
        "ExchangeRate": tasa,
        "TotalAmount": total_amount,
        # La llave propia del documento. Los 166 cargos historicos la tienen en
        # null porque nadie la mandaba nunca; desde acá va siempre, y el
        # readback dice si ADM la persiste.
        "Reference": referencia,
        "Notes": descripcion[:500] if descripcion else None,
        "Accounts": accounts,
    }

    # El comprobante fiscal del banco: es lo que soporta el gasto ante DGII y lo
    # que decide la cuenta (con NCF va a 640.01 Cargos Bancarios; sin NCF, a
    # 801.01 Gastos sin comprobante). Va con su tipo de gasto del 606, igual que
    # los 159 cargos que registro la contable hasta mayo 2026.
    if ncf:
        payload["NCF"] = ncf
        payload["ExpenseTypeID"] = EXPENSE_TYPE_GASTOS_FINANCIEROS
        # El RNC del emisor: primero el de la propuesta (si el detector lo
        # trae), si no el mapa por banco. NCF sin RNC no se registra: es la
        # linea coja del 606 que motivo este campo.
        rnc = re.sub(r"\D", "", str(p.get("rnc") or ""))
        if len(rnc) not in (9, 11):
            rnc = BANCO_RNC.get(str(p.get("banco") or "").strip().lower(), "")
        if not rnc:
            morir("el cargo trae NCF %s pero no pude resolver el RNC del banco "
                  "emisor (propuesta sin `rnc` y banco '%s' fuera de BANCO_RNC). "
                  "Agrega el banco al mapa BANCO_RNC de este script; no registro "
                  "un comprobante sin emisor." % (ncf, p.get("banco")))
        payload["FiscalID"] = rnc

    if args.simular:
        print(json.dumps(payload, ensure_ascii=False, indent=1))
        print()
        print("CashAccountID (banco): %s (%s)" % (banco_uuid, banco_cod))
        print("TotalAmount: %.2f %s (direccion: %s)" % (total_amount, moneda, direccion))
        print("ExchangeRate: %.4f" % tasa)
        print("Accounts[] contrapartida:", len(accounts))
        for a in accounts:
            print("  D %.4f / C %.4f" % (a["Debit"], a["Credit"]))
        print("cuadre: dif %.4f" % dif)
        return

    # ¿Ya está registrado ESTE movimiento? Ojo con la respuesta facil.
    #
    # Antes, cualquier cargo de mismo banco+fecha+monto abortaba con «YA
    # REGISTRADO». Pero eso no es un duplicado: es como se ven DOS cargos
    # distintos, porque el banco cobra dos comisiones iguales el mismo dia.
    # El 2026-08-03 dos comisiones LBTR de RD$100 chocaron asi: el contable
    # leyo «YA REGISTRADO: CB00000169», lo tomó por suyo, anotó ese DocID en la
    # segunda fila y cerró — el mismo documento en dos trabajos y un cargo de
    # menos en ADM.
    #
    # Dos preguntas separadas, entonces:
    #   1. ¿Hay un cargo que traiga MI referencia? Ese si es mio, probado.
    #   2. Si no, ¿los gemelos que hay en ADM ya los reclamó otro trabajo? Si
    #      todos tienen dueño, ninguno puede ser este: falta registrarlo.
    # Y si queda un gemelo sin dueño, no se sabe: para y que decida el humano.
    gemelos = [d for d in paginar("BankCharges")
               if d.get("BankAccountID") == banco_uuid
               and str(d.get("DocDate") or "") == fecha
               and abs(float(d.get("TotalAmount") or 0) - total_amount) < 0.01]

    mios = [d for d in gemelos if str(d.get("Reference") or "").strip() == referencia]
    if mios:
        morir("YA REGISTRADO: %s — trae la referencia de este movimiento (%s)"
              % (mios[0].get("DocID"), referencia))

    huerfanos = [d for d in gemelos if str(d.get("DocID") or "").strip() not in docids_reclamados()]
    if huerfanos and args.forzar:
        print("--forzar: hay %d cargo(s) igual(es) sin dueño (%s) y se registra igual"
              % (len(huerfanos), ", ".join(str(d.get("DocID")) for d in huerfanos)))
    elif huerfanos:
        morir(
            "AMBIGUO, no registro nada. En ADM hay %d cargo(s) igual(es) a este "
            "(banco %s, %s, %.2f) y %d no lo reclama ningun trabajo de la mesa: %s. "
            "Ninguno trae referencia, asi que no se puede saber si alguno es este "
            "movimiento o son cargos distintos que se ven iguales. Preguntale al "
            "humano (evento 'pregunta' + estado 'esperando_respuesta') citando esos "
            "DocID; si te confirma que este ya esta registrado, anotalo a mano, y si "
            "te dice que no, volve a correr el script con --forzar."
            % (len(gemelos), banco_cod, fecha, total_amount, len(huerfanos),
               ", ".join(str(d.get("DocID")) for d in huerfanos)))

    d = llamar("POST", "BankCharges", cuerpo=payload)
    if not d.get("success") or not isinstance(d.get("data"), str):
        morir("ADM rechazo el cargo bancario: %s" % sanear(d.get("message")))

    guid = d["data"]
    doc = llamar("GET", "BankCharges/%s" % guid).get("data") or {}
    docid = doc.get("DocID")
    if str(doc.get("ID") or "").lower() != guid.lower():
        morir("el readback devolvio OTRO documento (%s). Buscar por fecha/banco."
              % docid)
    print("REGISTRADO: %s (uuid %s)" % (docid, guid))
    print("  total %s | banco %s" % (doc.get("TotalAmount"), doc.get("BankAccountName")))

    # ¿ADM se quedó con la referencia? De eso depende que el proximo cargo
    # gemelo se pueda distinguir sin preguntarle a nadie. Si vuelve vacia, el
    # documento igual quedó bien registrado — lo que se pierde es la llave, y
    # eso hay que decirlo, no descubrirlo dentro de tres meses.
    ref_vuelta = str(doc.get("Reference") or "").strip()
    if ref_vuelta == referencia:
        print("  referencia guardada en ADM: %s" % referencia)
    else:
        print("  OJO: mande Reference=%s y ADM devolvio %r — el campo no se "
              "persiste. Avisalo en el hilo: sin llave, dos cargos gemelos "
              "vuelven a ser indistinguibles." % (referencia, ref_vuelta))

    sql("update qualia_trabajos set propuesta = propuesta || "
        "jsonb_build_object('registro_adm', jsonb_build_object("
        "'docid', :'doc', 'uuid', :'guid', 'documento', 'BankCharges', "
        "'reference', :'ref', 'referencia_en_adm', (:'refok')::boolean, "
        "'fecha', now()::date)) "
        "where id = :'id' and empresa_id = :'emp';",
        doc=docid, guid=guid, ref=referencia,
        refok="true" if ref_vuelta == referencia else "false",
        id=args.trabajo, emp=env("QUALIA_EMPRESA_ID"))
    print("  guardado en la mesa")

    # El PAPEL del cargo. El banco factura sus servicios con un comprobante
    # fiscal por dia y concepto, y su PDF —con el QR y el codigo de seguridad—
    # es lo que soporta el gasto: es lo que la contable humana adjuntaba. Hasta
    # el 2026-08-05 esto no existia y los cargos se registraban pelados.
    #
    # Las paginas las deja partir-comprobantes.py (repo del colector) en
    # /comprobantes, montado de solo lectura: asi este contenedor adjunta sin
    # necesitar la service_role de Supabase.
    #
    # Va DESPUES de guardar el docid y NO puede tumbar el registro: el documento
    # en ADM es lo que hay que dejar asentado, y el adjunto se reintenta. Si
    # falta el PDF se dice fuerte, porque un cargo sin soporte es un hallazgo de
    # auditoria esperando.
    ncf = str(p.get("ncf") or "").strip()
    banco_ncf = str(p.get("banco") or "").strip()
    if not ncf:
        # Sin NCF no hay comprobante del banco, pero el pago puede tener papel
        # propio: el documento del trabajo mismo, o el de una subida que se
        # cerro como duplicado de esta propuesta (`comprobante_de_trabajo` en
        # la propuesta, lo enlaza quien cierra el duplicado). Paso el
        # 2026-08-07 con el anticipo ISR de julio: el comprobante DGII quedo
        # varado en la subida cerrada y el cargo iba a quedar sin soporte.
        duenio_papel = str(p.get("comprobante_de_trabajo") or args.trabajo)
        bajar = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "bajar-documento.sh")
        r = subprocess.run(["bash", bajar, duenio_papel],
                           capture_output=True, text=True)
        if r.returncode != 0:
            print("  sin NCF y sin papel propio: el cargo queda sin adjunto "
                  "(%s)" % (r.stderr.strip().splitlines() or ["?"])[-1][:160])
        else:
            ruta_doc = r.stdout.strip()
            try:
                subir_adjunto(guid, ruta_doc)
                nombre_doc = os.path.basename(ruta_doc)
                print("  adjunto: %s subido (papel del trabajo %s)"
                      % (nombre_doc, duenio_papel))
                sql("update qualia_trabajos set propuesta = jsonb_set(propuesta, "
                    "'{registro_adm,adjunto}', to_jsonb(:'n'::text)) "
                    "where id = :'id' and empresa_id = :'emp';",
                    n=nombre_doc, id=args.trabajo, emp=env("QUALIA_EMPRESA_ID"))
            except Exception as e:  # noqa: BLE001 — el registro ya esta hecho
                print("  OJO: no pude adjuntar el papel del pago (%s). El cargo "
                      "queda REGISTRADO pero SIN soporte." % e)
    else:
        ruta_pdf = "/comprobantes/%s/%s.pdf" % (banco_ncf, ncf)
        if not os.path.exists(ruta_pdf):
            print("  OJO: no encuentro el PDF del comprobante %s (%s). El cargo "
                  "queda REGISTRADO pero SIN soporte." % (ncf, ruta_pdf))
        else:
            try:
                subir_adjunto(guid, ruta_pdf)
                print("  adjunto: comprobante %s subido" % ncf)
                sql("update qualia_trabajos set propuesta = jsonb_set(propuesta, "
                    "'{registro_adm,adjunto}', to_jsonb(:'n'::text)) "
                    "where id = :'id' and empresa_id = :'emp';",
                    n="%s.pdf" % ncf, id=args.trabajo, emp=env("QUALIA_EMPRESA_ID"))
            except Exception as e:  # noqa: BLE001 — el registro ya esta hecho
                print("  OJO: no pude adjuntar el comprobante %s (%s). El cargo "
                      "queda REGISTRADO pero SIN soporte." % (ncf, e))

    cerrado = sql("update qualia_trabajos set estado = 'registrada' "
                  "where id = :'id' and empresa_id = :'emp' "
                  "and estado = 'aprobada' returning id;",
                  id=args.trabajo, emp=env("QUALIA_EMPRESA_ID"))
    if cerrado:
        print("  estado: registrada")
    else:
        print("  OJO: el docid quedo guardado pero el estado NO se cerro")
    print()
    print("Falta solo el libro de accion, citando %s." % docid)


if __name__ == "__main__":
    main()
