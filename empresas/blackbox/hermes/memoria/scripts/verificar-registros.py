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

**Se pregunta por UUID, uno por uno, contra el endpoint del tipo de documento
de cada fila.** Antes se paginaba UNA vez el listado de `VendorBills` y se
comparaba local. Estaba mal por dos motivos, los dos medidos el 2026-08-04:

  1. Los cargos bancarios y las transferencias no estan en ese listado. Con 61
     `BankCharges` y 3 `BankBankTransfers` ya registrados, una corrida con
     --marcar los enterraba a todos con un `eliminado_en` falso — y en la mesa
     esa lapida tacha la fila y la saca de "Te toca".
  2. **El listado no trae los anulados.** `/api/BankCharges` devolvio 166 filas
     y ninguna con Void; los CB00000164..171 que el dueno acababa de anular no
     aparecian, y el campo `Void` ni siquiera viene en el listado. Por listado,
     un anulado es indistinguible de un eliminado.

El `GET {tipo}/{uuid}` si los distingue: del anulado devuelve el documento con
`Void: true`, y del eliminado devuelve `data: null` — igual que de un UUID que
no existe. Se conserva el guard de que el `ID` devuelto sea el pedido: a esta
API se le puede pasar un DocID o un NCF y responde OTRO documento con
success:true, y ese acierto casual es peor que un error.

Marca los caidos con `registro_adm.eliminado_en` o `.anulado_en` y los reporta.
NO los re-registra ni cambia el estado: que hacer con un documento caido es una
decision del humano, no del script. Lo que no se pudo verificar (red, HTTP
raro) NO se marca: una lapida falsa cuesta mas que un chequeo perdido.

Uso:  verificar-registros.py [--marcar]
Sin --marcar solo informa.
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api.admcloud.net"

# Los documentos que la mesa sabe registrar. El endpoint es el mismo nombre que
# `propuesta.documento_adm`, que es lo que escribe el contable.
#
# `VendorCreditNotes` NO es decorativo: sin el, la nota de credito de un
# proveedor cae al `indeterminado` de «tipo de documento desconocido» y no se
# verifica NUNCA, ni viva ni muerta. Y con `documento_adm` mintiendo —diciendo
# `VendorBills` sobre una NCP, que es como nacio la primera— es peor todavia:
# `GET /api/VendorBills/{uuid-de-la-NCP}` contesta `success:true, data:null`,
# indistinguible de un documento borrado, y este script le pone lapida a algo
# que esta vivo. Probado contra la NCP00000006 el 2026-08-07.
# `BillPayments` faltaba desde que la mesa empezó a registrar pagos: sus 34
# documentos (PP00000751 …) caían al `indeterminado` de «tipo desconocido» y no
# se verificaban NUNCA, ni vivos ni muertos. Es el mismo agujero que el de la
# nota de credito, al lado. Sondeado el 2026-08-07: el readback por UUID se
# comporta igual que el de los otros —devuelve el documento, con `Void`— y los
# 34 estan vigentes, asi que sumarlo no marca ninguno.
ENDPOINTS = {"VendorBills", "VendorCreditNotes", "BankCharges",
             "BankBankTransfers", "BillPayments", "Journals"}


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


def estado_en_adm(documento, uuid):
    """(estado, detalle) para un documento nuestro. Estado es uno de:
    'vigente' | 'anulado' | 'eliminado' | 'indeterminado'.

    'indeterminado' es un NO SE SABE, no un no: es lo que devuelve cuando la
    API no contesta o contesta algo que no entendemos, y su unico efecto es
    que la fila no se toca.
    """
    if documento not in ENDPOINTS:
        return "indeterminado", "tipo de documento desconocido: %r" % documento
    if not uuid:
        return "indeterminado", "la fila no guardo el uuid del documento"
    try:
        r = llamar("%s/%s" % (documento, uuid))
    except urllib.error.HTTPError as e:
        # 404 es la respuesta honesta de "no esta", pero esta API no la usa
        # para esto (devuelve 200 + data null), asi que un 404 aca es mas
        # probable que sea la ruta mal armada que un documento borrado.
        return "indeterminado", "HTTP %s" % e.code
    except Exception as e:                                    # red, timeout, JSON roto
        return "indeterminado", type(e).__name__

    d = r.get("data")
    if not isinstance(d, dict):
        # Eliminado y uuid-que-no-existe dan lo mismo: success true, data null.
        return "eliminado", "el documento ya no existe en ADM"
    if str(d.get("ID") or "").lower() != str(uuid).lower():
        # No es nuestro documento: la API resolvio otra cosa. Tratarlo como
        # eliminado seria inventar; lo que corresponde es no concluir.
        return "indeterminado", "el readback devolvio otro documento (%s)" % d.get("DocID")
    return ("anulado", "Void=true") if d.get("Void") else ("vigente", "")


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
        # `documento_adm` es lo que el contable declaro registrar. Las facturas
        # mas viejas nacieron antes de ese campo: para ellas el tipo se deduce
        # del tipo del trabajo, que en esa epoca solo podia ser una factura.
        "       coalesce(nullif(propuesta->>'documento_adm',''), "
        "                case when tipo = 'factura' then 'VendorBills' else '' end), "
        "       translate(coalesce(nullif(propuesta->>'proveedor',''), "
        "                          left(coalesce(resumen,''), 40)), E'\\t\\n', '  ') "
        "  from qualia_trabajos "
        " where empresa_id = :'emp' "
        "   and propuesta->'registro_adm'->>'docid' is not null "
        " order by propuesta->'registro_adm'->>'docid';",
        emp=env("QUALIA_EMPRESA_ID"))

    if not filas:
        print("no hay documentos registrados que verificar")
        return

    print("documentos registrados en la mesa: %d" % len(filas))
    print()

    caidos = []   # (trabajo, docid, campo, texto)
    dudosos = 0
    for tid, docid, uuid, ya_marcado, documento, quien in filas:
        if ya_marcado:
            print("  %-12s %-40s ya marcado (%s)" % (docid, quien[:40], ya_marcado[:10]))
            continue

        estado, detalle = estado_en_adm(documento, uuid)
        if estado == "eliminado":
            caidos.append((tid, docid, "eliminado_en",
                           "El documento %s ya no existe en ADM Cloud: fue eliminado. "
                           "El trabajo queda sin registro." % docid))
        elif estado == "anulado":
            caidos.append((tid, docid, "anulado_en",
                           "El documento %s fue ANULADO en ADM Cloud: se conserva con "
                           "marca de anulado y fuera de balances." % docid))
        elif estado == "indeterminado":
            dudosos += 1

        print("  %-12s %-40s %s%s" % (
            docid, quien[:40],
            {"vigente": "vigente", "anulado": "ANULADO en ADM",
             "eliminado": "DESAPARECIO de ADM"}.get(estado, "no se pudo verificar"),
            " (%s)" % detalle if detalle and estado != "anulado" else ""))

    print()
    if dudosos:
        print("%d documento(s) no se pudieron verificar — no se tocan." % dudosos)
    if not caidos:
        print("todo en orden")
        return

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
