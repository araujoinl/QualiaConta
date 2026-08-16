#!/usr/bin/env python3
"""Pago doble J-11+J-12 y abono parcial J-11 (Caso #4, Nercido Vargas).

registro_pendiente del trabajo df5e8cc5 (pago final 3,400,000 sobre DOS
facturas) + su prerrequisito 8e6165e8 (abono parcial 50,000). El script
hermano registrar-pago-factura.py no cubre ninguno de los dos: exige una sola
factura que cierre al centavo y solo conoce las dos tarjetas como cuenta de
salida. Este arma el BillPayments a mano siguiendo su mismo esqueleto:
- saldos reales desde /api/AP (unica fuente)
- Reference = banco_tx_id (prueba de propiedad)
- readback por UUID + autorizacion + relectura de pendientes
- Documents[] con UN renglon por factura por su saldo exacto
"""
import base64, json, os, re, subprocess, sys
import urllib.error, urllib.parse, urllib.request

BASE = "https://api.admcloud.net"
TIMEOUT = 90

def morir(msg):
    print(msg, file=sys.stderr); sys.exit(1)

def env(n):
    v = os.environ.get(n)
    if not v: morir("falta %s" % n)
    return v

def sanear(t):
    return str(t).replace(env("ADMCLOUD_COMPANY"), "<company>")

def llamar(metodo, ruta, cuerpo=None, params=None):
    q = {"company": env("ADMCLOUD_COMPANY"), "role": env("ADMCLOUD_REG_ROLE"),
         "appid": env("ADMCLOUD_APPID")}
    q.update(params or {})
    url = "%s/api/%s?%s" % (BASE, ruta, urllib.parse.urlencode(q))
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    cred = base64.b64encode(("%s:%s" % (env("ADMCLOUD_REG_USER"),
        env("ADMCLOUD_REG_PASSWORD"))).encode()).decode()
    req = urllib.request.Request(url, data=datos, method=metodo)
    req.add_header("Authorization", "Basic " + cred)
    req.add_header("Accept", "application/json")
    if datos: req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            morir("ADM nego permiso (%s) en %s: rol '%s'." % (e.code, ruta,
                  env("ADMCLOUD_REG_ROLE")))
        morir("ADM respondio %s en %s" % (e.code, ruta))
    except Exception as e:
        morir("fallo %s: %s (si era POST, NO reintentes)" % (ruta, type(e).__name__))

def sql(consulta, **v):
    cmd = ["psql", env("QUALIA_DSN"), "-t", "-A", "-F", "\t", "-q"]
    for k, val in v.items(): cmd += ["-v", "%s=%s" % (k, val)]
    r = subprocess.run(cmd, input=consulta, capture_output=True, text=True)
    if r.returncode != 0: morir("psql fallo: %s" % r.stderr.strip()[:200])
    return [l.split("\t") for l in r.stdout.strip().splitlines() if l.strip()]

def paginar(ruta, params=None):
    filas, skip = [], 0
    for _ in range(60):
        q = dict(params or {}); q["skip"] = skip
        lote = llamar("GET", ruta, params=q).get("data") or []
        if not lote: break
        filas.extend(lote); skip += len(lote)
    return filas

def leer_trabajo(tid):
    filas = sql("select estado, propuesta::text from qualia_trabajos "
                "where id=:'id' and empresa_id=:'emp';",
                id=tid, emp=env("QUALIA_EMPRESA_ID"))
    if not filas: morir("trabajo %s no existe" % tid)
    return filas[0][0], json.loads(filas[0][1])

def mapa_cuentas():
    m = {}
    for c in paginar("Accounts"):
        cod = str(c.get("Code") or c.get("AccountCode") or "").strip()
        if cod and c.get("ID"): m.setdefault(cod, c["ID"])
    return m

def tipo_de_pago(nombre_buscado):
    for t in paginar("PaymentTypes"):
        plano = (str(t.get("Name") or t.get("Description") or "").strip().lower()
                 .replace("é","e").replace("ó","o").replace("í","i"))
        if plano.startswith(nombre_buscado): return t.get("ID")
    morir("no encontre tipo de pago '%s'" % nombre_buscado)

def factura_por_uuid(uuid):
    d = llamar("GET", "VendorBills/%s" % uuid).get("data") or {}
    if str(d.get("ID") or "").lower() != uuid.lower():
        morir("readback de factura %s devolvio otro documento" % uuid)
    return d

def saldo_ap(docid):
    for x in paginar("AP"):
        if str(x.get("DocID") or "").strip() == docid:
            return round(float(x.get("Balance") or 0), 2)
    return None

def armar_y_registrar(tid, documentos, fecha, monto, moneda, ref, notas):
    """documentos: [(docid, uuid)] ya verificados. Debe cerrar al centavo."""
    estado, p = leer_trabajo(tid)
    if estado != "aprobada":
        morir("trabajo %s esta en '%s': solo se registra lo aprobado" % (tid, estado))
    reg = p.get("registro_adm") or {}
    if reg.get("docid") and not (reg.get("eliminado_en") or reg.get("anulado_en")):
        morir("%s ya tiene registro_adm vivo: %s" % (tid, reg["docid"]))
    if abs(sum(a for _, _, a in documentos) - monto) > 0.005:
        morir("NO CIERRA: documentos suman %.2f vs monto %.2f"
              % (sum(a for _, _, a in documentos), monto))

    # duplicado: la referencia (banco_tx_id) es la unica prueba
    mios = [d for d in paginar("BillPayments")
            if not d.get("Void") and str(d.get("Reference") or "").strip() == ref]
    if mios:
        morir("YA REGISTRADO: %s trae la referencia %s" % (mios[0].get("DocID"), ref))

    # la cuenta de salida: el proveedor lo tomo de la PRIMERA factura (verificada)
    f0 = factura_por_uuid(documentos[0][1])
    prov = f0.get("RelationshipID")
    if not prov: morir("factura %s sin RelationshipID" % documentos[0][0])

    cuentas = mapa_cuentas()
    caja = cuentas.get(p.get("cuenta_contable"))
    if not caja:
        morir("la cuenta %s no existe en /api/Accounts" % p.get("cuenta_contable"))
    tp = tipo_de_pago("transferencia")

    payload = {
        "DocDate": fecha,
        "CashAccountID": caja,
        "PaymentTypeID": tp,
        "RelationshipID": prov,
        "CurrencyID": moneda,
        "ExchangeRate": 1.0 if moneda == "DOP" else float(f0.get("ExchangeRate") or 1.0),
        "Reference": ref,
        "Beneficiary": f0.get("RelationshipName") or (p.get("asignacion") or {}).get("proveedor") or "",
        "Notes": notas,
        "Documents": [{
            "DocumentID": factura_por_uuid(u)["ID"],
            "DocID": d,
            "Amount": round(a, 2),
            "TotalAmount": round(a, 2),
            "ExchangeRate": 1.0,
        } for d, u, a in documentos],
    }

    if SIMULAR:
        print("== payload %s ==" % tid)
        print(json.dumps(payload, ensure_ascii=False, indent=1))
        return None

    r = llamar("POST", "BillPayments", cuerpo=payload)
    if not r.get("success") or not isinstance(r.get("data"), str):
        morir("ADM rechazo: %s" % sanear(r.get("message")))
    guid = r["data"]
    doc = llamar("GET", "BillPayments/%s" % guid).get("data") or {}
    docid = doc.get("DocID")
    if str(doc.get("ID") or "").lower() != guid.lower():
        morir("readback devolvio OTRO documento (%s)" % docid)
    print("REGISTRADO: %s (uuid %s) total %s" % (docid, guid, doc.get("TotalAmount")))

    pendiente = any(str(x.get("DocID") or "").strip() == str(docid).strip()
                    for x in paginar("BillPayments",
                                     params={"OnlyPendingAuthorize": "true"}))
    if pendiente:
        a = llamar("PUT", "BillPayments/Authorize", params={"id": guid})
        pendiente = any(str(x.get("DocID") or "").strip() == str(docid).strip()
                        for x in paginar("BillPayments",
                                         params={"OnlyPendingAuthorize": "true"}))
        if pendiente:
            print("  OJO: %s sigue PENDIENTE de autorizacion tras el PUT: revisar a mano" % docid)
        else:
            print("  autorizado")
    sql("update qualia_trabajos set estado='registrada', "
        "propuesta = propuesta || jsonb_build_object('registro_adm', "
        "jsonb_build_object('docid', :'doc', 'uuid', :'guid', 'documento', 'BillPayments', "
        "'fecha', :'fecha', 'reference', :'ref')) "
        "where id=:'id' and empresa_id=:'emp';",
        doc=docid, guid=guid, fecha=fecha, ref=ref, id=tid, emp=env("QUALIA_EMPRESA_ID"))
    print("  mesa actualizada (%s)" % tid)
    return docid

SIMULAR = "--simular" in sys.argv

# ---- Paso 1: abono parcial J-11 (trabajo 8e6165e8) ----
T1 = "8e6165e8-5c27-42ed-9c0c-97a99759a81f"
s1, p1 = leer_trabajo(T1)
if s1 == "registrada" and (p1.get("registro_adm") or {}).get("docid"):
    print("paso 1 ya registrado: %s" % p1["registro_adm"]["docid"])
else:
    f11 = factura_por_uuid("4c7c25f6-ddb2-4ac2-f006-08def8e89c1e")
    sal11 = saldo_ap("FP00001152")
    print("J-11 FP00001152 saldo AP: %s" % sal11)
    if sal11 is None:
        print("  J-11 sin saldo abierto — paso 1 OMITIDO (nada que abonar)")
    elif abs(sal11 - 1725000.00) > 0.005:
        morir("J-11 debe %.2f (esperaba 1,725,000): revisar antes de continuar" % sal11)
    else:
        # ADM rechaza aplicar el pago con fecha 29/07: las facturas son del
        # 10/08 y la fecha de aplicacion no puede ser anterior a la factura.
        # Se aplica el 10/08 (fecha de la factura y del pago final); la fecha
        # REAL de la transferencia queda en Notes y en la propuesta.
        armar_y_registrar(T1, [("FP00001152", "4c7c25f6-ddb2-4ac2-f006-08def8e89c1e", 50000.00)],
                          "2026-08-10", 50000.00, "DOP", p1["banco_tx_id"],
                          "Abono parcial por separacion del local J-11. Transferencia real del 29/07/2026 ref. banco 21847255, aplicada el 10/08 por fecha de factura (Caso #4).")

# ---- Paso 2: pago final J-11+J-12 (trabajo df5e8cc5, EL DESPERTADO) ----
T2 = "df5e8cc5-276d-41d9-8531-ec1d1dd81706"
s2, p2 = leer_trabajo(T2)
if s2 == "registrada" and (p2.get("registro_adm") or {}).get("docid"):
    print("paso 2 ya registrado: %s" % p2["registro_adm"]["docid"])
    sys.exit(0)
sal11 = saldo_ap("FP00001152"); sal12 = saldo_ap("FP00001152")
sal12 = saldo_ap("FP00001153")
print("pre-paso-2: J-11=%.2f J-12=%.2f (esperado 1,675,000 / 1,725,000)" % (sal11 or -1, sal12 or -1))
if sal11 is None or sal12 is None:
    morir("una de las facturas no tiene saldo abierto en AP: J-11=%s J-12=%s" % (sal11, sal12))
if abs(sal11 - 1675000.00) > 0.005 or abs(sal12 - 1725000.00) > 0.005:
    morir("saldos no cierran con el plan del caso: J-11=%.2f J-12=%.2f" % (sal11, sal12))
armar_y_registrar(T2,
    [("FP00001152", "4c7c25f6-ddb2-4ac2-f006-08def8e89c1e", sal11),
     ("FP00001153", "4e0bea1d-ca92-444b-f00f-08def8e89c1e", sal12)],
    p2["fecha"], float(p2["monto"]), "DOP", p2["banco_tx_id"],
    "Pago final compra locales J-11 y J-12 (ref. banco 15591411, Caso #4).")
print("LISTO")
