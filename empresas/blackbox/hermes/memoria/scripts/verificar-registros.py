#!/usr/bin/env python3
"""Verifica que los documentos que registramos en ADM sigan vigentes.

Dos formas de dejar de estarlo, y no son lo mismo:
  ELIMINADO  el documento desaparece. No queda rastro en ADM.
  ANULADO    el documento se conserva con Void=true, fuera de balances.

Hace falta porque en ADM **revertir borra**: no queda `Void=true` ni lapida
auditable — el documento desaparece del listado y su `GET` por UUID devuelve
null (medido 2026-08-02 con el asiento del Gate 0, y otra vez el 2026-08-03 con
la factura FP00001063 que el dueno elimino por estar mal calculada).

Sin este chequeo, la mesa seguiria diciendo "Subida" sobre algo que ya no
existe, y el libro citaria un numero de documento fantasma.

Marca los desaparecidos con `registro_adm.eliminado_en` y los reporta. NO los
re-registra ni cambia el estado: que hacer con una factura eliminada es una
decision del humano, no del script.

Uso:  verificar-registros.py [--marcar]
Sin --marcar solo informa.
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request

BASE = "https://api.admcloud.net"


def env(n):
    v = os.environ.get(n)
    if not v:
        sys.exit("falta la variable %s" % n)
    return v


def llamar(ruta, params=None):
    q = {"company": env("ADMCLOUD_COMPANY"), "role": env("ADMCLOUD_REG_ROLE"),
         "appid": env("ADMCLOUD_APPID")}
    q.update(params or {})
    url = "%s/api/%s?%s" % (BASE, ruta, urllib.parse.urlencode(q))
    cred = base64.b64encode(("%s:%s" % (env("ADMCLOUD_REG_USER"),
                                        env("ADMCLOUD_REG_PASSWORD"))).encode()).decode()
    req = urllib.request.Request(url)
    req.add_header("Authorization", "Basic " + cred)
    req.add_header("Accept", "application/json")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def paginar(ruta):
    filas, skip = [], 0
    for _ in range(60):
        lote = llamar(ruta, {"skip": skip}).get("data") or []
        if not lote:
            break
        filas.extend(lote)
        skip += len(lote)
    return filas


def sql(consulta, **variables):
    cmd = ["psql", env("QUALIA_DSN"), "-t", "-A", "-F", "\t", "-q"]
    for k, v in variables.items():
        cmd += ["-v", "%s=%s" % (k, v)]
    r = subprocess.run(cmd, input=consulta, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("consulta fallo: %s" % r.stderr.strip()[:200])
    return [l.split("\t") for l in r.stdout.strip().splitlines() if l.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--marcar", action="store_true")
    args = ap.parse_args()

    filas = sql(
        "select id, propuesta->'registro_adm'->>'docid', "
        "       propuesta->'registro_adm'->>'uuid', "
        "       coalesce(propuesta->'registro_adm'->>'eliminado_en','') "
        "       || coalesce(propuesta->'registro_adm'->>'anulado_en',''), "
        "       coalesce(propuesta->>'proveedor','') "
        "  from qualia_trabajos "
        " where empresa_id = :'emp' "
        "   and propuesta->'registro_adm'->>'docid' is not null;",
        emp=env("QUALIA_EMPRESA_ID"))

    if not filas:
        print("no hay documentos registrados que verificar")
        return

    # Se pagina UNA vez y se compara local: getbyid no sirve (con un id que no
    # resuelve devuelve OTRO documento con success:true).
    # DocID -> Void. El campo viene en el listado para las 1052 facturas.
    enadm = {str(x.get("DocID") or ""): bool(x.get("Void")) for x in paginar("VendorBills")}
    print("documentos registrados en la mesa: %d | facturas en ADM: %d (anuladas: %d)"
          % (len(filas), len(enadm), sum(1 for v in enadm.values() if v)))
    print()

    caidos = []   # (trabajo, docid, campo, texto)
    for tid, docid, uuid, ya_marcado, proveedor in filas:
        if ya_marcado:
            estado = "ya marcado (%s)" % ya_marcado[:10]
        elif docid not in enadm:
            estado = "DESAPARECIO de ADM"
            caidos.append((tid, docid, "eliminado_en",
                           "El documento %s ya no existe en ADM Cloud: fue eliminado. "
                           "La factura queda sin registro." % docid))
        elif enadm[docid]:
            estado = "ANULADO en ADM"
            caidos.append((tid, docid, "anulado_en",
                           "El documento %s fue ANULADO en ADM Cloud: se conserva con "
                           "marca de anulado y fuera de balances." % docid))
        else:
            estado = "vigente"
        print("  %-12s %-34s %s" % (docid, proveedor[:34], estado))

    if not caidos:
        print()
        print("todo en orden")
        return

    print()
    print("%d documento(s) registrados ya no estan vigentes." % len(caidos))
    if not args.marcar:
        print("(corre con --marcar para anotarlo en la mesa)")
        return

    for tid, docid, campo, texto in caidos:
        sql("update qualia_trabajos set propuesta = jsonb_set(propuesta, "
            "array['registro_adm', :'campo'], to_jsonb(now()::date::text)) "
            " where id = :'id' and empresa_id = :'emp';",
            campo=campo, id=tid, emp=env("QUALIA_EMPRESA_ID"))
        sql("insert into qualia_eventos (trabajo_id, autor, tipo, contenido) "
            "values (:'id', 'contable', 'nota', :'txt');",
            id=tid, txt=texto)
        print("  marcado %s: %s" % (campo.replace("_en", ""), docid))


if __name__ == "__main__":
    main()
