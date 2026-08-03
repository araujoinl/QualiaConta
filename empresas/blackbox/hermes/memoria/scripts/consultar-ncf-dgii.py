#!/usr/bin/env python3
"""Consulta un comprobante fiscal en la web de DGII y devuelve JSON.

Sirve para los NCF IMPRESOS (B01, B02, B04, B14, B15...), que no tienen QR ni
timbre electronico: la unica via de verificacion es esta consulta publica.
Los e-CF (E31, E32...) se verifican por su timbre en ecf.dgii.gov.do — otro
camino, ver la skill mesa-de-trabajo.

La pagina es ASP.NET WebForms: hay que traer __VIEWSTATE y compania antes de
postear. NO tiene captcha (verificado 2026-08-02). Exige User-Agent de browser:
sin el, DGII responde 403.

Uso:
    consultar-ncf-dgii.py --rnc 133542013 --ncf B0100000500
    consultar-ncf-dgii.py --rnc ... --ncf E310000002221 --comprador 131188648 \
                          --codigo ABC123          # e-CF: lleva codigo de seguridad
    ... --debug        # ademas vuelca el texto crudo del resultado

Salida: JSON en stdout. Siempre trae "estado"; nunca inventa un resultado —
si algo falla, estado = "no verificable" con su motivo.
"""
import argparse
import http.cookiejar
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

URL = "https://dgii.gov.do/app/WebApps/ConsultasWeb2/ConsultasWeb/consultas/ncf.aspx"
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


def ocultos(html):
    """__VIEWSTATE y compania: sin ellos ASP.NET descarta el POST."""
    out = {}
    for campo in ("__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION"):
        m = re.search(r'name="%s"[^>]*value="([^"]*)"' % campo, html)
        if m:
            out[campo] = m.group(1)
    return out


def texto_plano(html):
    h = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html)
    h = re.sub(r"(?i)<br\s*/?>|</tr>|</p>|</div>", "\n", h)
    h = re.sub(r"(?i)</t[dh]>", " | ", h)
    h = re.sub(r"<[^>]+>", " ", h)
    h = h.replace("&nbsp;", " ").replace("&amp;", "&").replace("&#241;", "n")
    return re.sub(r"[ \t]{2,}", " ", h)


# Etiquetas de la ficha de DGII -> clave del JSON de salida.
CAMPOS = [
    (r"RNC\s*(?:/\s*C[eé]dula)?\s*(?:Emisor)?", "rnc_emisor"),
    (r"Raz[oó]n\s+Social\s*(?:Emisor)?", "razon_social_emisor"),
    (r"RNC\s*Comprador", "rnc_comprador"),
    (r"Raz[oó]n\s+Social\s*Comprador", "razon_social_comprador"),
    (r"(?:e-)?NCF", "ncf"),
    (r"Estado", "estado"),
    (r"Tipo\s+de\s+Comprobante", "tipo_comprobante"),
    (r"Fecha\s+de\s+(?:Emisi[oó]n|Vencimiento)", "fecha"),
    (r"Vigencia|V[aá]lido\s+hasta", "vigencia"),
]


def parsear(texto):
    datos = {}
    for patron, clave in CAMPOS:
        # (?:...) obligatorio: "Vigencia|Valido hasta" trae alternancia y sin
        # agrupar el `|` parte el patron entero — matchea la etiqueta sola y
        # group(1) sale None. Reventaba justo en las fichas VIGENTES (son las
        # unicas que traen esa etiqueta) y el except de main lo disfrazaba de
        # "no verificable": DGII respondia bien y el NCF valido se perdia.
        m = re.search(r"(?:%s)\s*[:|]\s*([^\n|]{1,80})" % patron, texto, re.I)
        if m:
            v = m.group(1).strip(" .|")
            if v and not re.fullmatch(r"[-–—]*", v):
                datos.setdefault(clave, v)
    return datos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rnc", required=True, help="RNC del emisor")
    ap.add_argument("--ncf", required=True)
    ap.add_argument("--comprador", default="", help="solo e-CF")
    ap.add_argument("--codigo", default="", help="codigo de seguridad, solo e-CF")
    ap.add_argument("--debug", action="store_true")
    a = ap.parse_args()

    ncf = a.ncf.strip().upper()
    salida = {"tipo": "ncf_impreso" if not ncf.startswith("E") else "ecf",
              "ncf": ncf, "rnc_emisor": a.rnc, "fuente": "dgii.gov.do/consultas/ncf"}

    # Validacion de formato ANTES de molestar a DGII: su pagina rechaza el
    # malformado con un mensaje generico que no distingue "mal escrito" de
    # "no existe", y esa diferencia importa (un digito de mas suele ser un
    # error de lectura de la foto, no una factura falsa).
    #   NCF impreso: letra + 2 digitos de tipo + 8 de secuencia  (11 chars)
    #   e-NCF:       E + 2 digitos de tipo + 10 de secuencia     (13 chars)
    formato = r"^[A-Z]\d{10}$" if not ncf.startswith("E") else r"^E\d{12}$"
    if not re.match(formato, ncf):
        largo = "11 caracteres (letra + 2 de tipo + 8 de secuencia)" if not ncf.startswith("E") \
                else "13 caracteres (E + 2 de tipo + 10 de secuencia)"
        salida.update(estado="formato invalido",
                      motivo="%s tiene %d caracteres; un %s lleva %s. "
                             "Revisa el documento: sobra o falta un digito."
                             % (ncf, len(ncf), salida["tipo"], largo))
        print(json.dumps(salida, ensure_ascii=False, indent=2))
        return 0
    if not re.fullmatch(r"\d{9}|\d{11}", a.rnc.strip()):
        salida.update(estado="formato invalido",
                      motivo="el RNC %s no tiene 9 ni 11 digitos" % a.rnc)
        print(json.dumps(salida, ensure_ascii=False, indent=2))
        return 0
    op = abrir()
    try:
        with op.open(URL, timeout=25) as r:
            html = r.read().decode("utf-8", "replace")
        campos = ocultos(html)
        if "__VIEWSTATE" not in campos:
            raise RuntimeError("la pagina no trajo __VIEWSTATE (cambio de forma?)")

        campos.update({
            PREFIJO + "txtRNC": a.rnc,
            PREFIJO + "txtNCF": ncf,
            PREFIJO + "txtRncComprador": a.comprador,
            PREFIJO + "txtCodigoSeg": a.codigo,
            PREFIJO + "btnConsultar": "Consultar",
        })
        req = urllib.request.Request(
            URL, data=urllib.parse.urlencode(campos).encode(),
            headers={"Content-Type": "application/x-www-form-urlencoded", "Referer": URL})
        with op.open(req, timeout=30) as r:
            res = r.read().decode("utf-8", "replace")

        texto = texto_plano(res)
        salida.update(parsear(texto))

        if "estado" not in salida:
            # DGII responde el "no existe" como mensaje suelto, no como ficha.
            if re.search(r"no\s+(?:se\s+encontr|existe|corresponde|es\s+v[aá]lido)", texto, re.I):
                salida["estado"] = "NO VALIDO"
                m = re.search(r"([^\n]{0,120}no\s+(?:se\s+encontr|existe|corresponde|es\s+v[aá]lido)[^\n]{0,80})",
                              texto, re.I)
                if m:
                    salida["mensaje"] = " ".join(m.group(1).split())[:160]
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
