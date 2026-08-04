#!/usr/bin/env python3
"""Registra en ADM Cloud una transferencia banco-a-banco (BankBankTransfers).

Es ARCHIVO (no python3 -c) por la misma razon que los demas: el guardian de
comandos marca `-c` y cobra 15-30s por llamada.

Modelado sobre registrar-cargo-bancario.py. La estructura del documento en ADM:
  - CashAccountID  = cuenta banco ORIGEN (de donde sale el dinero)
  - DebitAccountID = cuenta banco DESTINO (a donde entra el dinero)
  - TotalAmount    = monto transferido
  - DocType        = "BA_BA_TRA"

Uso:
    registrar-transferencia-bancaria.py --trabajo <uuid>            # registra
    registrar-transferencia-bancaria.py --trabajo <uuid> --simular  # payload sin escribir
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
        # BankBankTransfers puede venir como tupla {Item1, Item2}
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


def tasa_cambio(moneda):
    if moneda == "DOP":
        return 1.0
    for c in paginar("Currencies"):
        if c.get("ID") == moneda:
            return float(c.get("ExchangeRate") or 1.0)
    return 1.0


def referencia_de(p, trabajo_id):
    """La llave que ata ESTE documento a ESTE movimiento.

    Se prefiere el numero de referencia del banco, que ademas la contable ve en
    ADM. Si no viene —pasa seguido—, el `banco_tx_id`, y en ultimo caso el id
    del trabajo: lo que no puede pasar es quedarse sin llave, porque dos
    traspasos del mismo dia por el mismo monto entre las mismas dos cuentas se
    ven identicos y no hay NCF que los separe.
    """
    return str(p.get("nro_referencia") or p.get("banco_tx_id") or trabajo_id)


def docids_reclamados():
    """DocIDs que la mesa ya se atribuye, con registro vivo. Un gemelo que otro
    trabajo ya reclamo no puede ser este movimiento."""
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
    # Solo para el caso ambiguo, y solo despues de preguntarle al humano.
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
    if documento != "BankBankTransfers":
        morir("este script solo registra BankBankTransfers; la propuesta dice '%s'"
              % documento)

    # Origen y destino pueden venir como bloques explicitos o como lineas.
    origen = p.get("origen") or {}
    destino = p.get("destino") or {}
    cod_origen = str(origen.get("cuenta") or "").strip()
    cod_destino = str(destino.get("cuenta") or "").strip()
    monto = float(p.get("monto") or 0)
    moneda = p.get("moneda") or "DOP"
    fecha = p.get("fecha")
    descripcion = p.get("descripcion") or p.get("detalle") or ""
    referencia = referencia_de(p, args.trabajo)

    if not cod_origen or not cod_destino:
        # Fallback: deducir de las lineas (debito = destino, credito = origen)
        for l in (p.get("lineas") or []):
            d = float(l.get("debito") or 0)
            c = float(l.get("credito") or 0)
            if d > 0 and not cod_destino:
                cod_destino = str(l.get("cuenta") or "").strip()
            if c > 0 and not cod_origen:
                cod_origen = str(l.get("cuenta") or "").strip()

    if not cod_origen or not cod_destino:
        morir("no puedo determinar origen/destino de la transferencia")
    if monto <= 0:
        morir("monto invalido: %s" % monto)
    if not fecha:
        morir("falta la fecha del documento")

    cuentas = mapa_cuentas()
    uuid_origen = cuentas.get(cod_origen)
    uuid_destino = cuentas.get(cod_destino)
    if not uuid_origen:
        morir("no encontre el UUID de la cuenta origen '%s' en ADM" % cod_origen)
    if not uuid_destino:
        morir("no encontre el UUID de la cuenta destino '%s' en ADM" % cod_destino)

    tasa = tasa_cambio(moneda)

    payload = {
        "DocDate": fecha,
        "CashAccountID": uuid_origen,
        "DebitAccountID": uuid_destino,
        "TotalAmount": monto,
        "ToAmount": monto,
        "CurrencyID": moneda,
        "ExchangeRate": tasa,
        "Notes": (descripcion[:500] if descripcion else None),
        "Reference": (referencia if referencia else None),
    }

    if args.simular:
        print(json.dumps(payload, ensure_ascii=False, indent=1))
        print()
        print("Origen:  %s (%s)" % (cod_origen, uuid_origen))
        print("Destino: %s (%s)" % (cod_destino, uuid_destino))
        print("Monto:   %.2f %s" % (monto, moneda))
        print("Fecha:   %s" % fecha)
        return

    # ¿Ya está registrado ESTE traspaso? Mismo cuidado que en los cargos
    # bancarios: «misma fecha, mismo monto, mismas cuentas» NO prueba que sea el
    # mismo movimiento — asi se ven dos traspasos iguales del mismo dia, que
    # existen. Antes esto adoptaba el DocID encontrado y cerraba la fila SOLO,
    # sin que nadie se enterara; con dos traspasos gemelos, el segundo se comia
    # el numero del primero y en ADM faltaba uno (pasó con el CB00000169 del
    # lado de los cargos, 2026-08-03).
    gemelos = [d for d in paginar("BankBankTransfers")
               if str(d.get("FromCashAccountID") or "").lower() == uuid_origen.lower()
               and str(d.get("ToCashAccountID") or "").lower() == uuid_destino.lower()
               and abs(float(d.get("TotalAmount") or 0) - monto) < 0.01
               and str(d.get("DocDate") or "")[:10] == fecha]

    # Con MI referencia: ese si es este movimiento, probado. Se adopta y cierra.
    mios = [d for d in gemelos if str(d.get("Reference") or "").strip() == referencia]
    if mios:
        docid = mios[0].get("DocID")
        print("YA REGISTRADO: %s — trae la referencia de este movimiento (%s). "
              "Guardo y cierro." % (docid, referencia))
        sql("update qualia_trabajos set propuesta = propuesta || "
            "jsonb_build_object('registro_adm', jsonb_build_object("
            "'docid', :'doc', 'uuid', :'guid', 'documento', 'BankBankTransfers', "
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

    huerfanos = [d for d in gemelos
                 if str(d.get("DocID") or "").strip() not in docids_reclamados()]
    if huerfanos and args.forzar:
        print("--forzar: hay %d traspaso(s) igual(es) sin dueño (%s) y se registra igual"
              % (len(huerfanos), ", ".join(str(d.get("DocID")) for d in huerfanos)))
    elif huerfanos:
        morir(
            "AMBIGUO, no registro nada. En ADM hay %d traspaso(s) igual(es) a este "
            "(%s → %s, %s, %.2f) y %d no lo reclama ningun trabajo de la mesa: %s. "
            "Ninguno trae esta referencia, asi que no se puede saber si alguno es "
            "este movimiento. Preguntale al humano (evento 'pregunta' + estado "
            "'esperando_respuesta') citando esos DocID; si te dice que este no esta "
            "registrado, volve a correr con --forzar."
            % (len(gemelos), cod_origen, cod_destino, fecha, monto, len(huerfanos),
               ", ".join(str(d.get("DocID")) for d in huerfanos)))

    d = llamar("POST", "BankBankTransfers", cuerpo=payload)
    if not d.get("success") or not isinstance(d.get("data"), str):
        morir("ADM rechazo la transferencia: %s" % sanear(d.get("message")))

    guid = d["data"]
    # Readback
    doc = llamar("GET", "BankBankTransfers/%s" % guid)
    raw = doc.get("data") or {}
    if isinstance(raw, dict) and isinstance(raw.get("data"), dict):
        raw = raw["data"]
    docid = raw.get("DocID")
    if str(raw.get("ID") or "").lower() != guid.lower():
        morir("el readback devolvio OTRO documento (%s). Buscar por fecha/monto."
              % docid)
    ref_vuelta = str(raw.get("Reference") or "").strip()
    if ref_vuelta != referencia:
        print("  OJO: mande Reference=%s y ADM devolvio %r — el campo no se "
              "persiste. Sin llave, dos traspasos gemelos vuelven a ser "
              "indistinguibles: decilo en el hilo." % (referencia, ref_vuelta))

    print("REGISTRADA: %s (uuid %s)" % (docid, guid))
    print("  total %s | origen %s | destino %s" % (
        raw.get("TotalAmount"),
        raw.get("FromCashAccountName") or cod_origen,
        raw.get("ToCashAccountName") or cod_destino))

    sql("update qualia_trabajos set propuesta = propuesta || "
        "jsonb_build_object('registro_adm', jsonb_build_object("
        "'docid', :'doc', 'uuid', :'guid', 'documento', 'BankBankTransfers', "
        "'fecha', now()::date, 'reference', :'ref')) "
        "where id = :'id' and empresa_id = :'emp';",
        doc=docid, guid=guid, ref=referencia or None,
        id=args.trabajo, emp=env("QUALIA_EMPRESA_ID"))
    print("  guardado en la mesa")

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
