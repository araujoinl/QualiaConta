#!/usr/bin/env python3
"""Consulta un RNC/cedula en el padron de DGII y devuelve JSON.

Responde una sola pregunta: *de quien es este RNC*. No dice nada del
comprobante — para eso estan `consultar-ncf-dgii.py` (NCF impresos) y la
consulta de timbre de los e-CF.

Existe porque esas dos vias pueden quedarse sin razon social y el padron no:
el timbre de un e-CF exige codigo de seguridad y fecha de firma, y cuando la
foto no los deja leer no hay nombre oficial con que crear el proveedor en ADM.
El padron solo pide el RNC, que siempre se lee.

La pagina es ASP.NET WebForms: hay que traer __VIEWSTATE y compania, y postear
con __EVENTTARGET (el boton BUSCAR no es submit, dispara __doPostBack). NO
tiene captcha (verificado 2026-08-03). Exige User-Agent de browser: sin el,
DGII responde 403.

Uso:
    consultar-rnc-dgii.py --rnc 130277682
    consultar-rnc-dgii.py --rnc 130-27768-2 --debug

Salida: JSON en stdout. Siempre trae "estado"; nunca inventa un resultado —
si algo falla, estado = "no verificable" con su motivo.
"""
import argparse
import http.cookiejar
import html
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

URL = "https://dgii.gov.do/app/WebApps/ConsultasWeb2/ConsultasWeb/consultas/rnc.aspx"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
PREFIJO = "ctl00$cphMain$"


def abrir():
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    op.addheaders = [("User-Agent", UA),
                     ("Accept", "text/html,application/xhtml+xml"),
                     ("Accept-Language", "es-DO,es;q=0.9")]
    return op


def ocultos(pagina):
    """__VIEWSTATE y compania: sin ellos ASP.NET descarta el POST."""
    out = {}
    for campo in ("__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION"):
        m = re.search(r'name="%s"[^>]*value="([^"]*)"' % campo, pagina)
        if m:
            out[campo] = html.unescape(m.group(1))
    return out


def texto_plano(pagina):
    h = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", pagina)
    h = re.sub(r"(?i)<br\s*/?>|</tr>|</p>|</div>", "\n", h)
    h = re.sub(r"(?i)</t[dh]>", " | ", h)
    h = re.sub(r"<[^>]+>", " ", h)
    return re.sub(r"[ \t]{2,}", " ", html.unescape(h))


# Etiquetas de la ficha del padron -> clave del JSON de salida.
CAMPOS = [
    (r"C[eé]dula\s*/\s*RNC|RNC\s*/\s*C[eé]dula", "rnc"),
    (r"Nombre\s*/\s*Raz[oó]n\s+Social|Raz[oó]n\s+Social", "razon_social"),
    (r"Nombre\s+Comercial", "nombre_comercial"),
    (r"Estado", "estado_contribuyente"),
    (r"R[eé]gimen\s+de\s+pagos", "regimen_pagos"),
    (r"Actividad\s+Econ[oó]mica", "actividad_economica"),
    (r"Administraci[oó]n\s+Local", "administracion_local"),
    (r"Facturador\s+Electr[oó]nico", "facturador_electronico"),
]


# Como DGII dice "este RNC no existe" (texto literal de la pagina, 2026-08-03).
NO_INSCRITO = r"no\s+se\s+encuentra\s+inscrito\s+como\s+[Cc]ontribuyente"


def parsear(texto):
    datos = {}
    for patron, clave in CAMPOS:
        # (?:...) obligatorio: varias etiquetas traen alternancia y sin agrupar
        # el `|` parte el patron entero — matchea la etiqueta y group(1) sale None.
        m = re.search(r"(?:%s)\s*[:|]\s*([^\n|]{1,120})" % patron, texto, re.I)
        if m:
            v = " ".join(m.group(1).split()).strip(" .|")
            if v and not re.fullmatch(r"[-–—]*", v):
                datos.setdefault(clave, v)
    return datos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rnc", required=True, help="RNC o cedula, con o sin guiones")
    ap.add_argument("--debug", action="store_true")
    a = ap.parse_args()

    rnc = re.sub(r"[^0-9]", "", a.rnc)
    salida = {"rnc_consultado": rnc, "fuente": "dgii.gov.do/consultas/rnc"}

    # Formato ANTES de molestar a DGII: su pagina trata igual al mal escrito y
    # al inexistente, y esa diferencia importa (un digito de mas suele ser un
    # error de lectura de la foto, no un RNC falso).
    if not re.fullmatch(r"\d{9}|\d{11}", rnc):
        salida.update(estado="formato invalido",
                      motivo="%s tiene %d digitos; un RNC lleva 9 y una cedula 11"
                             % (rnc or a.rnc, len(rnc)))
        print(json.dumps(salida, ensure_ascii=False, indent=2))
        return 0

    op = abrir()
    try:
        with op.open(URL, timeout=25) as r:
            pagina = r.read().decode("utf-8", "replace")
        campos = ocultos(pagina)
        if "__VIEWSTATE" not in campos:
            raise RuntimeError("la pagina no trajo __VIEWSTATE (cambio de forma?)")

        campos.update({
            "__EVENTTARGET": PREFIJO + "btnBuscarPorRNC",
            "__EVENTARGUMENT": "",
            PREFIJO + "txtRNCCedula": rnc,
            PREFIJO + "txtRazonSocial": "",
            PREFIJO + "hidActiveTab": "",
        })
        req = urllib.request.Request(
            URL, data=urllib.parse.urlencode(campos).encode(),
            headers={"Content-Type": "application/x-www-form-urlencoded", "Referer": URL})
        with op.open(req, timeout=30) as r:
            res = r.read().decode("utf-8", "replace")

        texto = texto_plano(res)
        salida.update(parsear(texto))

        if salida.get("razon_social"):
            salida["estado"] = "ENCONTRADO"
            # El padron devuelve el RNC formateado (130-27768-2); el resto del
            # pipeline lo usa sin guiones.
            if salida.get("rnc"):
                salida["rnc"] = re.sub(r"[^0-9]", "", salida["rnc"])
        elif re.search(NO_INSCRITO, texto, re.I):
            # Ojo: ese texto vive en el HTML como validador oculto y esta ahi
            # tambien cuando el RNC si existe. Solo vale leerlo DESPUES de
            # descartar la ficha — de ahi que sea un elif y no un if.
            salida["estado"] = "NO ENCONTRADO"
            salida["mensaje"] = "el RNC no se encuentra inscrito como contribuyente"
        else:
            salida["estado"] = "no verificable"
            salida["motivo"] = "la respuesta de DGII no trajo ni ficha ni mensaje reconocible"
        if a.debug:
            salida["_crudo"] = " ".join(texto.split())[:1500]

    except urllib.error.HTTPError as e:
        salida.update(estado="no verificable", motivo="DGII respondio HTTP %s" % e.code)
    except Exception as e:
        salida.update(estado="no verificable", motivo="%s: %s" % (type(e).__name__, str(e)[:100]))

    print(json.dumps(salida, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
