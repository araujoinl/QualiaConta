#!/usr/bin/env python3
"""Registra en ADM Cloud un Pago a Cuentas (AccountPayments) aprobado en la mesa.

Hermano de registrar-pago-factura.py (BillPayments) y registrar-asiento-diario.py
(Journals). La diferencia: un Pago a Cuentas no cancela una factura (no hay
Documents[]) ni es un asiento puro (lleva banco en el header). Es el documento
que usa Blackbox para pagar a la DGII: anticipo de ISR, ITBIS, IR-3, retenciones.

Estructura del documento en ADM (verificada contra PC00000314, DGII ISR):
  - CashAccountID = la cuenta bancaria de donde sale (header). En ADM el banco
    es una cuenta de caja; su GUID es el mismo en CashAccountID y en la linea de
    Accounts[] que lo acredita.
  - Accounts[]    = las DOS patas del asiento, explicitas: Cr. banco (101.05) +
    Dr. contrapartida (210.11 para anticipo ISR, 210.01 para ITBIS, etc.). A
    diferencia de BillPayments, aca no hay Documents[] que derive el asiento.
  - TotalAmount   = suma de debitos de Accounts[] (= suma de creditos).
  - Items[]       = la cuenta a la que se aplica (la contrapartida). ADM la
    pide; sin el Items[] el pago no ata la cuenta.

NO clasifica nada: las cuentas vienen en la propuesta (que armo el sugeridor o
el humano). Este script solo ejecuta el POST y verifica.

Uso:
    registrar-pago-cuenta.py --trabajo <uuid>            # registra
    registrar-pago-cuenta.py --trabajo <uuid> --simular  # payload sin escribir
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
        body = ""
        try:
            body = e.read().decode("utf-8", "replace")[:500]
        except Exception:
            pass
        if e.code in (401, 403):
            morir("ADM nego el permiso (%s) en %s. El rol '%s' no puede crear "
                  "AccountPayments: hay que ampliarlo en ADM."
                  % (e.code, ruta, os.environ.get("ADMCLOUD_REG_ROLE", "?")))
        morir("ADM respondio %s en %s: %s" % (e.code, ruta, body))
    except Exception as e:
        morir("fallo la llamada a %s: %s (si era POST, NO reintentes)"
              % (ruta, type(e).__name__))


def sql(consulta, **variables):
    cmd = ["psql", os.environ.get("QUALIA_DSN") or morir("falta QUALIA_DSN"),
           "-t", "-A", "-F", "\t", "-q"]
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
        raw = d.get("data")
        if isinstance(raw, dict) and isinstance(raw.get("Item1"), list):
            raw = raw["Item1"]
        if not raw:
            break
        filas.extend(raw)
        skip += len(raw)
    return filas


def mapa_cuentas():
    mapa = {}
    for c in paginar("Accounts"):
        cod = str(c.get("Code") or c.get("AccountCode") or "").strip()
        if cod and c.get("ID"):
            mapa.setdefault(cod, c["ID"])
    return mapa


def tipo_pago_transferencia():
    """UUID del tipo de pago 'Transferencia'. ADM lo EXIGE en AccountPayments.
    Se resuelve por nombre contra /api/PaymentTypes (no hardcodear GUID)."""
    for t in paginar("PaymentTypes"):
        nombre = str(t.get("Name") or t.get("Description") or "")
        plano = (nombre.strip().lower()
                 .replace("é", "e").replace("ó", "o").replace("í", "i"))
        if plano.startswith("transferencia"):
            return t.get("ID")
    morir("no encontre el tipo de pago 'Transferencia' en /api/PaymentTypes.")


def referencia_de(p, trabajo_id):
    return str(p.get("banco_tx_id") or p.get("nro_referencia") or trabajo_id)


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

    reg = p.get("registro_adm") or {}
    muerto = reg.get("eliminado_en") or reg.get("anulado_en")
    if reg.get("docid") and not muerto:
        morir("ya tiene registro_adm vivo: %s" % reg["docid"])

    documento = p.get("documento_adm") or ""
    if documento != "AccountPayments":
        morir("este script solo registra AccountPayments; la propuesta dice '%s'"
              % documento)

    banco_id = str(p.get("banco_id") or "").strip()
    if not re.match(r"^[0-9a-f-]{36}$", banco_id):
        morir("la propuesta no trae banco_id (GUID de la cuenta de caja/banco). "
              "El sugeridor o el humano lo debe poner; sin eso no se de que banco sale.")

    monto = round(float(p.get("monto") or 0), 2)
    if monto <= 0:
        morir("el monto del pago tiene que ser mayor que cero")
    fecha = str(p.get("fecha") or "")[:10]
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", fecha):
        morir("la propuesta no trae una fecha valida")

    lineas = p.get("lineas") or []
    if not lineas:
        morir("no hay lineas en la propuesta")

    cuentas = mapa_cuentas()
    accounts = []
    items = []
    sum_d = 0.0
    sum_c = 0.0
    for i, l in enumerate(lineas):
        cod = str(l.get("cuenta") or "").strip()
        if not cod:
            morir("la linea %d no tiene cuenta" % (i + 1))
        uid = cuentas.get(cod)
        if not uid:
            morir("no encontre el UUID de la cuenta '%s' (linea %d) en ADM"
                  % (cod, i + 1))
        debito = float(l.get("debito") or 0)
        credito = float(l.get("credito") or 0)
        sum_d += debito
        sum_c += credito
        accounts.append({
            "AccountID": uid,
            "Debit": debito,
            "Credit": credito,
            "ExchangeRate": 1.0,
            "Notes": str(l.get("descripcion") or l.get("cuenta_nombre") or "")[:200],
        })
        # La contrapartida (la cuenta que NO es el banco) va tambien en Items[]:
        # es lo que ATA el pago a la cuenta. La linea del banco no (CashAccountID
        # ya la lleva en el header). PC00000314 trae Items[] con un solo elemento.
        if uid != banco_id:
            items.append({"AccountID": uid, "RowType": 0})

    # Partida doble completa: debitos = creditos = monto que sale del banco.
    if abs(sum_d - sum_c) > 0.005:
        morir("no cuadra: debitos=%.2f creditos=%.2f" % (sum_d, sum_c))
    if abs(sum_d - monto) > 0.005:
        morir("las lineas (%.2f) no cuadran con el monto del pago (%.2f)"
              % (sum_d, monto))

    referencia = referencia_de(p, args.trabajo)
    beneficiario = str(p.get("beneficiario") or p.get("proveedor") or "")[:200]
    moneda = p.get("moneda") or "DOP"

    payload = {
        "DocDate": fecha,
        "CashAccountID": banco_id,
        "PaymentTypeID": tipo_pago_transferencia(),
        "CurrencyID": moneda,
        "ExchangeRate": 1.0 if moneda == "DOP" else float(p.get("tasa") or 1.0),
        "Reference": referencia,
        "Beneficiary": beneficiario,
        "Notes": (str(p.get("detalle") or p.get("descripcion") or "")[:500]
                  or None),
        "TotalAmount": monto,
        "Accounts": accounts,
        "Items": items,
    }

    if args.simular:
        print(json.dumps(payload, ensure_ascii=False, indent=1))
        print()
        print("monto        : %.2f %s" % (monto, moneda))
        print("banco (hdr)  : %s  (CashAccountID)" % banco_id)
        print("Accounts[]:")
        for a in accounts:
            print("  D %.2f / C %.2f" % (a["Debit"], a["Credit"]))
        print("Items[]      : %d (contrapartida)" % len(items))
        print("referencia   : %s" % referencia)
        print("beneficiario : %s" % beneficiario)
        return

    # Dedup: mismo Reference + fecha. La referencia es la prueba de que este
    # pago ya se registro (CB00000169 enseno que monto+fecha no alcanza).
    mios = [d for d in paginar("AccountPayments")
            if not d.get("Void")
            and str(d.get("Reference") or "").strip() == referencia]
    if mios:
        morir("YA REGISTRADO: %s — trae la referencia de este movimiento (%s)"
              % (mios[0].get("DocID"), referencia))

    d = llamar("POST", "AccountPayments", cuerpo=payload)
    if not d.get("success") or not isinstance(d.get("data"), str):
        morir("ADM rechazo el pago a cuenta: %s" % sanear(d.get("message")))

    guid = d["data"]
    # Readback: el success ya devolvio true sobre cosas que no hizo.
    doc = llamar("GET", "AccountPayments/%s" % guid).get("data") or {}
    if isinstance(doc, dict) and isinstance(doc.get("data"), dict):
        doc = doc["data"]
    docid = doc.get("DocID")
    if str(doc.get("ID") or "").lower() != guid.lower():
        morir("el readback devolvio OTRO documento (%s). Buscar por fecha/monto."
              % docid)

    print("REGISTRADO: %s (uuid %s)" % (docid, guid))
    print("  paga a %s por %.2f desde %s"
          % (doc.get("Beneficiary"), doc.get("TotalAmount"),
             doc.get("BankAccountName")))

    sql("update qualia_trabajos set estado = 'registrada', "
        "propuesta = propuesta || jsonb_build_object('registro_adm', "
        "jsonb_build_object('docid', :'doc', 'uuid', :'guid', "
        "'documento', 'AccountPayments', 'fecha', :'fecha', "
        "'reference', :'ref')) "
        "where id = :'id' and empresa_id = :'emp';",
        doc=docid, guid=guid, fecha=fecha, ref=referencia,
        id=args.trabajo, emp=env("QUALIA_EMPRESA_ID"))
    print("  mesa actualizada")
    print()
    print("Falta el libro de accion (si aplica) citando %s." % docid)


if __name__ == "__main__":
    main()
