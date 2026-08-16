#!/usr/bin/env python3
"""Registra en ADM Cloud un PAGO PARCIAL de factura de proveedor (BillPayments).

Hermano de registrar-pago-factura.py, que exige que el pago cierre UNA factura
al centavo. Aca el caso es el contrario: el movimiento del banco abona PARTE de
la factura (ej: separacion de RD$50,000 sobre una compra de RD$1,725,000) y la
factura queda con saldo abierto, que es legitimo.

Diferencias con el hermano:
  - `--factura <docid>` es obligatorio: la propuesta de un abono parcial casi
    nunca trae asignacion.facturas (la pantalla no arma ese caso todavia).
  - El chequeo de cierre al centavo se reemplaza por `monto <= saldo`: no puede
    pagarse de mas (dejaria un anticipo) ni pagar una factura que no debe nada.
  - Documents[].Amount = el monto del movimiento, no el total de la factura.

Todo lo demas es igual y por la misma razon: Reference = banco_tx_id (llave
anti-duplicado), readback verificado por UUID, autorizacion si nacio pendiente,
y la mesa actualizada recien al final.

Uso:
    registrar-pago-parcial.py --trabajo <uuid> --factura FP00001152 [--simular]
"""
import argparse
import base64
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api.admcloud.net"
TIMEOUT = 90


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
        if e.code in (401, 403):
            morir("ADM nego el permiso (%s) en %s: el rol '%s' no puede crear pagos."
                  % (e.code, ruta, os.environ.get("ADMCLOUD_REG_ROLE", "?")))
        morir("ADM respondio %s en %s" % (e.code, ruta))
    except Exception as e:
        morir("fallo la llamada a %s: %s (si era POST, NO reintentes)"
              % (ruta, type(e).__name__))


def sql(consulta, **variables):
    cmd = ["psql", env("QUALIA_DSN"), "-t", "-A", "-F", "\t", "-q"]
    for k, v in variables.items():
        cmd += ["-v", "%s=%s" % (k, v)]
    r = subprocess.run(cmd, input=consulta, capture_output=True, text=True)
    if r.returncode != 0:
        morir("consulta a la mesa fallo: %s" % r.stderr.strip()[:200])
    return [l.split("\t") for l in r.stdout.strip().splitlines() if l.strip()]


def paginar(ruta, params=None):
    filas, skip = [], 0
    for _ in range(60):
        q = dict(params or {})
        q["skip"] = skip
        d = llamar("GET", ruta, params=q)
        lote = d.get("data") or []
        if not lote:
            break
        filas.extend(lote)
        skip += len(lote)
    return filas


def mapa_cuentas():
    mapa = {}
    for c in paginar("Accounts"):
        cod = str(c.get("Code") or c.get("AccountCode") or "").strip()
        if cod and c.get("ID"):
            mapa.setdefault(cod, c["ID"])
    return mapa


def tipo_de_pago():
    # Cualquier cuenta de banco que no sea tarjeta paga por Transferencia.
    for t in paginar("PaymentTypes"):
        nombre = str(t.get("Name") or t.get("Description") or "")
        plano = (nombre.strip().lower()
                 .replace("é", "e").replace("ó", "o").replace("í", "i"))
        if plano.startswith("transferencia"):
            return t.get("ID")
    morir("no encontre el tipo de pago 'Transferencia' en /api/PaymentTypes.")


def buscar_factura(docid):
    for d in paginar("VendorBills"):
        if str(d.get("DocID") or "").strip() == docid:
            return d
    morir("la factura %s no aparece en ADM." % docid)


def saldo_pendiente(docid):
    for x in paginar("AP"):
        if str(x.get("DocID") or "").strip() == docid:
            return round(float(x.get("Balance") or 0), 2)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trabajo", required=True)
    ap.add_argument("--factura", required=True)
    ap.add_argument("--simular", action="store_true")
    args = ap.parse_args()
    if not re.match(r"^[0-9a-f-]{36}$", args.trabajo):
        morir("trabajo_id invalido")
    docid_factura = args.factura.strip().upper()

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
    if reg.get("docid") and not (reg.get("eliminado_en") or reg.get("anulado_en")):
        morir("ya tiene registro_adm vivo: %s" % reg["docid"])

    if p.get("documento_adm") != "BillPayments":
        morir("este script solo registra BillPayments; la propuesta dice '%s'"
              % p.get("documento_adm"))

    monto = round(float(p.get("monto") or 0), 2)
    if monto <= 0:
        morir("el monto del pago tiene que ser mayor que cero")
    fecha = str(p.get("fecha") or "")[:10]
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", fecha):
        morir("la propuesta no trae una fecha valida")

    referencia = str(p.get("banco_tx_id") or "")
    if not referencia:
        morir("la propuesta no trae banco_tx_id: sin ella no hay llave anti-duplicado")

    factura = buscar_factura(docid_factura)
    if factura.get("Void"):
        morir("la factura %s esta ANULADA en ADM." % docid_factura)

    saldo = saldo_pendiente(docid_factura)
    if saldo is None:
        morir("la factura %s no tiene saldo abierto en ADM: ya esta pagada."
              % docid_factura)
    if monto > saldo + 0.005:
        morir("NO CIERRA: el pago es de %.2f y la factura %s solo debe %.2f. "
              "Pagar de mas deja un anticipo que nadie pidio."
              % (monto, docid_factura, saldo))

    proveedor_id = factura.get("RelationshipID")
    if not proveedor_id:
        morir("la factura %s no trae RelationshipID" % docid_factura)

    codigo_caja = str(p.get("cuenta_contable") or "").strip()
    if not codigo_caja:
        morir("la propuesta no trae cuenta_contable (cuenta de banco de salida)")
    cuentas = mapa_cuentas()
    caja_uuid = cuentas.get(codigo_caja)
    if not caja_uuid:
        morir("la cuenta de caja %s no existe en /api/Accounts de ADM" % codigo_caja)

    tipo_pago = tipo_de_pago()
    moneda = p.get("moneda") or "DOP"
    payload = {
        "DocDate": fecha,
        "CashAccountID": caja_uuid,
        "PaymentTypeID": tipo_pago,
        "RelationshipID": proveedor_id,
        "CurrencyID": moneda,
        "ExchangeRate": 1.0 if moneda == "DOP" else float(factura.get("ExchangeRate") or 1.0),
        "Reference": referencia,
        "Beneficiary": factura.get("RelationshipName") or (p.get("asignacion") or {}).get("proveedor") or "",
        "Notes": ("Abono parcial a %s con %s. %s"
                  % (docid_factura, p.get("cuenta_banco") or "banco",
                     p.get("descripcion") or "")).strip(),
        "Documents": [{
            "DocumentID": factura.get("ID"),
            "DocID": docid_factura,
            "Amount": monto,
            "TotalAmount": round(float(factura.get("TotalAmount") or 0), 2),
            "ExchangeRate": float(factura.get("ExchangeRate") or 1.0),
        }],
    }

    if args.simular:
        print(json.dumps(payload, ensure_ascii=False, indent=1))
        print()
        print("factura      : %s (%s)" % (docid_factura, factura.get("RelationshipName")))
        print("saldo en AP  : %.2f" % saldo)
        print("abona        : %.2f %s (queda %.2f)" % (monto, moneda, saldo - monto))
        print("desde        : %s (%s)" % (codigo_caja, p.get("cuenta_banco")))
        print("referencia   : %s" % referencia)
        return

    mios = [d for d in paginar("BillPayments")
            if not d.get("Void")
            and str(d.get("Reference") or "").strip() == referencia]
    if mios:
        morir("YA REGISTRADO: %s — trae la referencia de este movimiento (%s)"
              % (mios[0].get("DocID"), referencia))

    d = llamar("POST", "BillPayments", cuerpo=payload)
    if not d.get("success") or not isinstance(d.get("data"), str):
        morir("ADM rechazo el pago: %s" % sanear(d.get("message")))

    guid = d["data"]
    doc = llamar("GET", "BillPayments/%s" % guid).get("data") or {}
    docid = doc.get("DocID")
    if str(doc.get("ID") or "").lower() != guid.lower():
        morir("el readback devolvio OTRO documento (%s)" % docid)

    print("REGISTRADO: %s (uuid %s)" % (docid, guid))
    print("  abona %s a %s por %.2f" % (docid_factura, doc.get("Beneficiary"), monto))

    def sigue_pendiente():
        return any(
            str(x.get("DocID") or "").strip() == str(docid).strip()
            for x in paginar("BillPayments", params={"OnlyPendingAuthorize": "true"})
        )

    pendiente = sigue_pendiente()
    if pendiente:
        r = llamar("PUT", "BillPayments/Authorize", params={"id": guid})
        if str(r.get("message") or "").strip().lower() == "unauthorized":
            print("  %s quedo PENDIENTE DE AUTORIZACION: el rol '%s' puede crear "
                  "pagos pero no autorizarlos. NO movio plata todavia."
                  % (docid, os.environ.get("ADMCLOUD_REG_ROLE", "?")))
        else:
            pendiente = sigue_pendiente()
            if pendiente:
                print("  OJO: pedi autorizar %s y sigue en la lista de pendientes. "
                      "NO movio plata: revisalo a mano." % docid)
            else:
                print("  autorizado")

    sql("update qualia_trabajos set estado = 'registrada', "
        "propuesta = propuesta || jsonb_build_object('registro_adm', "
        "jsonb_build_object('docid', :'doc', 'uuid', :'guid', "
        "'documento', 'BillPayments', 'fecha', :'fecha', "
        "'reference', :'ref', 'pendiente_autorizacion', :'pend'::boolean, "
        "'factura', :'fact', 'pago_parcial', true)) "
        "where id = :'id' and empresa_id = :'emp';",
        doc=docid, guid=guid, fecha=fecha, ref=referencia,
        pend="true" if pendiente else "false", fact=docid_factura,
        id=args.trabajo, emp=env("QUALIA_EMPRESA_ID"))
    print("  mesa actualizada")


if __name__ == "__main__":
    main()
