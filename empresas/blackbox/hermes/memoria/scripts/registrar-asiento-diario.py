#!/usr/bin/env python3
"""Registra en ADM Cloud una entrada de diario (Journals) aprobada en la mesa.

Modelado sobre registrar-cargo-bancario.py y registrar-transferencia-bancaria.py.
La estructura del documento en ADM:
  - DocType = "JOURNAL"
  - Accounts[] = las líneas de partida doble (debito/credito)
  - TotalAmount = suma de debitos
  - No lleva CashAccountID (a diferencia de BankCharges/Transfers)

Uso:
    registrar-asiento-diario.py --trabajo <uuid>            # registra
    registrar-asiento-diario.py --trabajo <uuid> --simular  # payload sin escribir
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
        morir("ADM respondio %s en %s: %s" % (e.code, ruta, body))
    except Exception as e:
        morir("fallo la llamada a %s: %s (si era POST, NO reintentes)" % (
            ruta, type(e).__name__))


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
    """Devuelve (por_codigo, info). info: UUID -> fila completa (para ver GroupAccount)."""
    mapa, info = {}, {}
    for c in paginar("Accounts"):
        cod = str(c.get("Code") or c.get("AccountCode") or "").strip()
        uid = c.get("ID")
        if uid:
            info[uid] = c
            if cod:
                mapa.setdefault(cod, uid)
    return mapa, info


def tasa_cambio(moneda):
    if moneda == "DOP":
        return 1.0
    for c in paginar("Currencies"):
        if c.get("ID") == moneda:
            return float(c.get("ExchangeRate") or 1.0)
    return 1.0


def referencia_de(p, trabajo_id):
    return str(p.get("nro_referencia") or p.get("banco_tx_id") or trabajo_id)


def docids_reclamados():
    filas = sql(
        "select propuesta->'registro_adm'->>'docid' from qualia_trabajos "
        " where empresa_id = :'emp' "
        "   and propuesta->'registro_adm'->>'docid' is not null "
        "   and coalesce(propuesta->'registro_adm'->>'eliminado_en','') = '' "
        "   and coalesce(propuesta->'registro_adm'->>'anulado_en','') = '';",
        emp=env("QUALIA_EMPRESA_ID"))
    return {f[0].strip() for f in filas if f and f[0].strip()}


def subir_adjunto(guid, ruta):
    url = ("%s/api/Storage?%s" % (
        BASE,
        urllib.parse.urlencode({
            "transactionID": guid,
            "company": env("ADMCLOUD_COMPANY"),
            "role": env("ADMCLOUD_REG_ROLE"),
            "appid": env("ADMCLOUD_APPID"),
        })))
    cred = base64.b64encode(
        ("%s:%s" % (env("ADMCLOUD_REG_USER"), env("ADMCLOUD_REG_PASSWORD"))).encode()
    ).decode()
    try:
        import subprocess as sp
        r = sp.run(
            ["curl", "-s", "-H", "Authorization: Basic " + cred,
             "-F", "file=@" + ruta, url],
            capture_output=True, text=True, timeout=60)
        resp = json.loads(r.stdout)
        if resp.get("success"):
            return True
        morir("adjunto falló: %s" % sanear(resp.get("message", "")))
    except Exception as e:
        morir("adjunto falló: %s" % e)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trabajo", required=True)
    ap.add_argument("--simular", action="store_true")
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

    documento = p.get("documento_adm") or ""
    if documento != "Journals":
        morir("este script solo registra Journals; la propuesta dice '%s'" % documento)

    fecha = p.get("fecha")
    moneda = p.get("moneda") or "DOP"
    lineas = p.get("lineas") or []
    descripcion = p.get("detalle") or p.get("descripcion") or ""
    referencia = referencia_de(p, args.trabajo)

    if not fecha:
        morir("falta la fecha del documento")
    if not lineas:
        morir("no hay lineas en la propuesta")

    cuentas, info_cuentas = mapa_cuentas()

    # Build Accounts[] lines
    accounts = []
    sum_d = 0.0
    sum_c = 0.0
    for i, l in enumerate(lineas):
        cod = str(l.get("cuenta") or "").strip()
        if not cod:
            morir("la linea %d no tiene cuenta" % (i + 1))
        uid = None
        if re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-", cod):
            uid = cod
        elif l.get("cuenta_id"):
            uid = str(l["cuenta_id"])
        if not uid:
            uid = cuentas.get(cod)
        if not uid:
            morir("no encontre el UUID de la cuenta '%s' (linea %d) en ADM" % (cod, i + 1))
        inf = info_cuentas.get(uid) or {}
        if inf.get("GroupAccount"):
            morir("la cuenta '%s' (%s, linea %d) es de GRUPO y ADM no la afecta "
                  "directamente: usa su subcuenta hoja (pasa cuenta_id en la linea)"
                  % (cod, inf.get("Name"), i + 1))
        debito = float(l.get("debito") or 0)
        credito = float(l.get("credito") or 0)
        sum_d += debito
        sum_c += credito
        accounts.append({
            "AccountID": uid,
            "Debit": debito,
            "Credit": credito,
            "Notes": str(l.get("descripcion") or l.get("cuenta_nombre") or "")[:200],
        })

    # Cuadre: partida doble
    dif = sum_d - sum_c
    if abs(dif) > 0.05:
        morir("no cuadra: debitos=%.2f creditos=%.2f dif=%.4f" % (sum_d, sum_c, dif))

    total_amount = sum_d

    payload = {
        "DocDate": fecha,
        "DocType": "JOURNAL",
        "CurrencyID": moneda,
        "ExchangeRate": tasa_cambio(moneda),
        "TotalAmount": total_amount,
        "Reference": referencia,
        "Notes": descripcion[:500] if descripcion else None,
        "Accounts": accounts,
    }

    if args.simular:
        print(json.dumps(payload, ensure_ascii=False, indent=1))
        print()
        print("TotalAmount: %.2f %s" % (total_amount, moneda))
        print("Accounts[]:")
        for a in accounts:
            print("  D %.2f / C %.2f  (%s)" % (a["Debit"], a["Credit"], a["AccountID"]))
        print("cuadre: dif %.4f" % dif)
        return

    # Buscar duplicados: mismo monto, fecha, y con nuestra referencia
    existentes = paginar("Journals")
    mios = [d for d in existentes
            if str(d.get("Reference") or "").strip() == referencia
            and str(d.get("DocDate") or "")[:10] == fecha]
    if mios:
        docid = mios[0].get("DocID")
        print("YA REGISTRADO: %s — trae la referencia de este movimiento (%s). "
              "Guardo y cierro." % (docid, referencia))
        sql("update qualia_trabajos set propuesta = propuesta || "
            "jsonb_build_object('registro_adm', jsonb_build_object("
            "'docid', :'doc', 'uuid', :'guid', 'documento', 'Journals', "
            "'reference', :'ref', 'fecha', now()::date)) "
            "where id = :'id' and empresa_id = :'emp';",
            doc=docid, guid=mios[0].get("ID"), ref=referencia, id=args.trabajo,
            emp=env("QUALIA_EMPRESA_ID"))
        cerrado = sql("update qualia_trabajos set estado = 'registrada' "
                      "where id = :'id' and empresa_id = :'emp' "
                      "and estado = 'aprobada' returning id;",
                      id=args.trabajo, emp=env("QUALIA_EMPRESA_ID"))
        if cerrado:
            print("  estado: registrada")
        return

    # POST
    d = llamar("POST", "Journals", cuerpo=payload)
    if not d.get("success") or not isinstance(d.get("data"), str):
        morir("ADM rechazo el asiento de diario: %s" % sanear(d.get("message")))

    guid = d["data"]
    # Readback
    doc = llamar("GET", "Journals/%s" % guid).get("data") or {}
    if isinstance(doc, dict) and isinstance(doc.get("data"), dict):
        doc = doc["data"]
    docid = doc.get("DocID")
    if str(doc.get("ID") or "").lower() != guid.lower():
        morir("el readback devolvio OTRO documento (%s). Buscar por fecha/monto." % docid)

    ref_vuelta = str(doc.get("Reference") or "").strip()
    if ref_vuelta != referencia:
        print("  OJO: mande Reference=%s y ADM devolvio %r — el campo no se "
              "persiste." % (referencia, ref_vuelta))

    print("REGISTRADA: %s (uuid %s)" % (docid, guid))
    print("  total %s | %d lineas" % (doc.get("TotalAmount"), len(accounts)))

    # Guardar en la mesa
    sql("update qualia_trabajos set propuesta = propuesta || "
        "jsonb_build_object('registro_adm', jsonb_build_object("
        "'docid', :'doc', 'uuid', :'guid', 'documento', 'Journals', "
        "'fecha', now()::date, 'reference', :'ref')) "
        "where id = :'id' and empresa_id = :'emp';",
        doc=docid, guid=guid, ref=referencia or None,
        id=args.trabajo, emp=env("QUALIA_EMPRESA_ID"))
    print("  guardado en la mesa")

    # Subir adjunto si hay documento
    archivo_id = None
    try:
        r = subprocess.run(
            ["bash", os.path.join(os.path.dirname(os.path.abspath(__file__)), "bajar-documento.sh"),
             args.trabajo],
            capture_output=True, text=True, timeout=60)
        if r.returncode == 0 and r.stdout.strip():
            ruta = r.stdout.strip()
            if subir_adjunto(guid, ruta):
                sql("update qualia_trabajos set propuesta = propuesta || "
                    "jsonb_build_object('registro_adm', propuesta->'registro_adm' || "
                    "jsonb_build_object('adjunto', :'adj')) "
                    "where id = :'id' and empresa_id = :'emp';",
                    adj=os.path.basename(ruta), id=args.trabajo, emp=env("QUALIA_EMPRESA_ID"))
                print("  adjunto subido: %s" % os.path.basename(ruta))
            else:
                print("  ADJUNTO FALLO")
    except Exception as e:
        print("  ADJUNTO FALLO: %s" % e)

    # Cerrar la fila
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
