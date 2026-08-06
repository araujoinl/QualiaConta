#!/usr/bin/env python3
"""Registra en ADM Cloud una factura de proveedor ya aprobada en la mesa.

Existe como ARCHIVO por la misma razon que buscar-precedente.py: el guardian de
comandos de Hermes marca el flag `-c` de cualquier interprete y consulta a un
segundo LLM antes de dejar correr el comando. Sin este script el agente improvisa
`curl | python3 -c` para hablar con ADM y paga 15-30s por llamada (medido: ese
patron acumulo 30 minutos de espera pura). El 2026-08-03 quedo atascado ahi con
la factura del restaurante.

Y el otro motivo, mas importante: las trampas de esta API se escriben UNA vez acá
en vez de que el modelo las re-derive en cada factura, que es donde se cuelan los
errores caros. Todas estan medidas en produccion:

  - El ITBIS NO se manda: va TaxScheduleID por linea y el server calcula. Su base
    es Quantity x Price, no Price (con cantidad 0.50 la diferencia era 10.63 vs
    21.25 y el total se iba a 173.88 con success:true).
  - El asiento NO se manda: ADM lo deriva. Mandarlo descuadra.
  - El POST devuelve SOLO el UUID; el DocID sale del readback.
  - `GET /api/<recurso>/<id>` con un DocID, un NCF o una referencia devuelve OTRO
    documento con success:true. Hay que verificar que el ID devuelto sea el GUID.
  - Los filtros ?Reference= y ?DocID= mienten: se pagina y se filtra local.
  - No hay clave de idempotencia: ante timeout NO se reintenta.
  - ADM frena duplicados por NCF y por Reference, pero sirve avisar antes.

Uso:
    registrar-en-adm.py --trabajo <uuid>            # registra
    registrar-en-adm.py --trabajo <uuid> --simular  # muestra el payload y para

Sale 0 e imprime el DocID. Sale != 0 con el motivo por stderr, sin haber escrito.
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

# Catalogos fijos de Blackbox, verificados contra el sistema vivo.
TAX_ITBIS = "f980499b-4f32-48cb-8c6f-5fe74d245528"      # ITBIS 18%
TERMINOS = {
    "al contado": "94940a99-f119-4573-8bbd-08dd14abff09",
    "30": "b002e9c1-0430-4809-8612-b27db42a35a0",
    "45": "27e7f4f5-f179-40f0-6fb0-08dd14abefee",
    "60": "a101c88e-5a4c-4860-17e0-08dd149772e6",
}
TIPO_GASTO_DEFECTO = "dcda501b-23df-4074-a8b8-039a153c6b44"  # 02 Trabajos y Servicios


def morir(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


def env(nombre):
    v = os.environ.get(nombre)
    if not v:
        morir("falta la variable de entorno %s" % nombre)
    return v


def sanear(txt):
    """Los errores de ADM reflejan la URI completa, con el GUID de company."""
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
        # Un timeout en un POST es el caso peligroso: puede haberse creado igual.
        morir("fallo la llamada a %s: %s (si era un POST, NO reintentes: "
              "volve a buscar el documento antes de tocar nada)" % (ruta, type(e).__name__))


def bajar_documento(trabajo_id):
    """Ruta local del documento. Delega en bajar-documento.sh, que ya resuelve
    la URL firmada y tiene el short-circuit de 'ya estaba bajado'.

    Devuelve (ruta, motivo). El motivo NO es decorativo: bajar-documento.sh
    escribe a stderr por que fallo — sin archivo_url, URL vencida, trabajo
    inexistente— y ese script fue escrito justamente para NO tapar su stderr
    (taparlo hacia que un query roto se reportara como "no tiene archivo").
    Capturarlo y tirarlo repetiria el mismo error un nivel mas arriba.
    """
    guion = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "bajar-documento.sh")
    if not os.path.exists(guion):
        return None, "no encuentro bajar-documento.sh junto a este script"
    r = subprocess.run(["bash", guion, trabajo_id], capture_output=True, text=True)
    ruta = r.stdout.strip()
    if r.returncode == 0 and ruta and os.path.exists(ruta):
        return ruta, ""
    return None, (r.stderr or "").strip()[:300] or "exit %s sin motivo" % r.returncode


def subir_adjunto(guid, ruta):
    """Sube el documento como adjunto de la transaccion. Multipart a mano
    porque la stdlib no lo arma sola y no hay `requests` en el venv.

    Vive ACA y no en la skill por dos medidas del 2026-08-03: el adjunto a mano
    era el 55% del turno —~94s de ese tramo eran el portero de comandos de
    Hermes autorizando el `curl`, contra ~6s de subida real— y otros ~31s se
    perdian porque el `curl` de la skill interpolaba $ADMCLOUD_REG_ROLE crudo en
    la URL. Ese rol vale "Contabilidad Digital", CON ESPACIO, y sin encodear da
    HTTP 000. Aca la query la arma urlencode, igual que en llamar().
    """
    nombre = os.path.basename(ruta)
    with open(ruta, "rb") as f:
        contenido = f.read()
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


def paginar(ruta):
    """`skip` es obligatorio y `take` se ignora: se avanza por lo devuelto."""
    filas, skip = [], 0
    for _ in range(60):
        d = llamar("GET", ruta, params={"skip": skip})
        lote = d.get("data") or []
        if not lote:
            break
        filas.extend(lote)
        skip += len(lote)
    return filas


def sql(consulta, **variables):
    cmd = ["psql", env("QUALIA_DSN"), "-t", "-A", "-F", "\t", "-q"]
    for k, v in variables.items():
        cmd += ["-v", "%s=%s" % (k, v)]
    # Por STDIN y no con -c: `psql -c` NO interpola las variables -v.
    r = subprocess.run(cmd, input=consulta, capture_output=True, text=True)
    if r.returncode != 0:
        morir("consulta a la mesa fallo: %s" % r.stderr.strip()[:200])
    return [l.split("\t") for l in r.stdout.strip().splitlines() if l.strip()]


# ---------------------------------------------------------------- proveedor
def asegurar_proveedor(p, simular):
    """Devuelve el RelationshipID. Si el proveedor no existe, lo crea.

    El match es por RNC exacto, NUNCA por nombre: los nombres se escriben de
    veinte formas. El nombre para crearlo sale de la razon social de DGII, que
    es la oficial — no de lo impreso en el papel.

    DGII responde eso por DOS vias distintas y cualquiera sirve para el alta:
    la verificacion del comprobante (`dgii`) y el padron de RNC (`rnc_padron`).
    El padron es el que rescata al e-CF cuya foto no dejo leer el codigo de
    seguridad: sin el, un comprobante no verificable dejaba al proveedor sin
    nombre y el trabajo moria pudiendo resolverse con el RNC solo.
    """
    rnc = re.sub(r"\D", "", str(p.get("rnc") or ""))
    if len(rnc) not in (9, 11):
        morir("la propuesta no trae un RNC valido: no busco ni creo el proveedor")

    for v in paginar("Vendors"):
        if re.sub(r"\D", "", str(v.get("FiscalID") or "")) == rnc:
            estado_aut = v.get("AuthorizationStatusDesc") or ""
            extra = "" if "aprobad" in estado_aut.lower() else "  [%s]" % estado_aut
            print("proveedor: %s (ya existia)%s" % (v.get("Name"), extra))
            return v.get("ID"), v.get("PaymentTermID") or TERMINOS["al contado"]

    dgii = p.get("dgii") or {}
    padron = p.get("rnc_padron") or {}
    comprobante_ok = str(dgii.get("estado") or "").upper() in ("VIGENTE", "ACEPTADO")
    padron_ok = (str(padron.get("estado") or "").upper() == "ENCONTRADO"
                 and bool(str(padron.get("razon_social") or "").strip()))

    # El respaldo del ALTA es que DGII reconozca el RNC, no que el comprobante
    # verifique: son dos preguntas. Un comprobante que no verifica sigue
    # bajando confianza y puede terminar en gasto no admitido — eso lo decide
    # el humano en la web —, pero no es motivo para no poder nombrar al emisor.
    if comprobante_ok:
        nombre = (dgii.get("razon_social_emisor") or "").strip()
    elif padron_ok:
        nombre = str(padron["razon_social"]).strip()
    else:
        nombre = ""

    if not nombre:
        morir("el proveedor RNC %s no existe en ADM y ninguna via de DGII dio su "
              "razon social (comprobante: %s; padron: %s). Consulta el padron con "
              "consultar-rnc-dgii.py antes de rendirte; no invento el nombre."
              % (rnc, dgii.get("estado") or "sin consultar",
                 padron.get("estado") or "sin consultar"))
    if not comprobante_ok and not padron_ok:
        morir("el proveedor no existe, su comprobante no verifica en DGII "
              "(estado: %s) y el padron tampoco lo reconoce. No doy de alta un "
              "proveedor sin respaldo." % dgii.get("estado"))
    if not comprobante_ok:
        estado_c = str(padron.get("estado_contribuyente") or "").upper()
        print("proveedor: nombre tomado del padron de RNC (el comprobante quedo "
              "en '%s')%s" % (dgii.get("estado") or "sin consultar",
                              "" if estado_c in ("", "ACTIVO") else "  [contribuyente %s]" % estado_c))

    termino = TERMINOS["al contado"]
    m = re.search(r"(30|45|60)\s*d[ií]as", str(p.get("termino_pago") or ""), re.I)
    if m:
        termino = TERMINOS[m.group(1)]

    nuevo = {"Name": nombre, "FiscalID": rnc, "IsVendor": True,
             "CurrencyID": p.get("moneda") or "DOP", "PaymentTermID": termino}
    print("proveedor: NO existe, se crea -> %s" % nombre)
    if simular:
        print(json.dumps(nuevo, ensure_ascii=False, indent=1))
        return "<uuid-del-proveedor-nuevo>", termino

    d = llamar("POST", "Vendors", cuerpo=nuevo)
    if not d.get("success") or not isinstance(d.get("data"), str):
        morir("no pude crear el proveedor: %s" % sanear(d.get("message")))
    print("   creado: %s (nace Pendiente de Aprobacion: un humano lo aprueba en ADM)"
          % d["data"])
    return d["data"], termino


# ------------------------------------------------------------------ factura
def mapa_cuentas():
    """codigo de cuenta -> UUID. La propuesta trae el codigo ("611.17"), que es
    como piensa el contable; ADM necesita el UUID. La traduccion la hace este
    script y no el modelo: es una busqueda exacta, no un juicio.
    OJO: en /api/Accounts el campo del codigo es `Code`; `AccountCode` viene null."""
    mapa = {}
    for c in paginar("Accounts"):
        cod = str(c.get("Code") or c.get("AccountCode") or "").strip()
        if cod and c.get("ID"):
            mapa.setdefault(cod, c["ID"])
    return mapa


def armar_payload(p, relationship_id, payment_term_id):
    lineas = p.get("lineas") or []
    if not lineas:
        morir("la propuesta no trae lineas")
    cuentas = mapa_cuentas()
    items = []
    for i, l in enumerate(lineas, 1):
        gravada = float(l.get("itbis") or 0) > 0
        items.append({
            "RowOrder": i, "RowType": 0,
            "Name": str(l.get("descripcion") or "")[:200],
            "Quantity": float(l.get("cantidad") or 1),
            "Price": float(l.get("precio") or 0),
            "Cost": 0.0, "DiscountPercent": 0.0, "ExchangeRate": 0.0,
            "AccountID": (l.get("account_id") or l.get("cuenta_id")
                          or cuentas.get(str(l.get("cuenta") or "").strip())),
            # El monto del ITBIS NO se manda: el server lo calcula del grupo.
            "TaxScheduleID": TAX_ITBIS if gravada else None,
            "TaxPercent": 18.0 if gravada else 0.0,
        })
    faltan = [(items[j]["Name"], lineas[j].get("cuenta"))
              for j in range(len(items)) if not items[j]["AccountID"]]
    if faltan:
        morir("no encontre en ADM la cuenta de estas lineas (renglon, codigo): %s. "
              "Si el codigo esta bien escrito, esa cuenta no existe o esta inactiva "
              "en el catalogo: preguntale al humano antes de registrar." % faltan)

    return {
        "DocDate": p.get("fecha"),
        "Reference": p.get("numero_factura_suplidor") or p.get("ncf"),
        "NCF": p.get("ncf"),
        "RelationshipID": relationship_id,
        "FiscalID": re.sub(r"\D", "", str(p.get("rnc") or "")),
        "Beneficiary": str(p.get("proveedor") or "")[:120],
        "CurrencyID": p.get("moneda") or "DOP",
        "ExchangeRate": 1.0,
        # Obligatorio aunque el esquema lo marque opcional: omitirlo devuelve
        # "Este termino de pago no existe". Se hereda del proveedor.
        "PaymentTermID": payment_term_id,
        "ExpenseTypeID": (p.get("tipo_gasto") or {}).get("adm_id") or TIPO_GASTO_DEFECTO,
        "Items": items,
    }


def verificar_cuadre(p, payload):
    """El ITBIS lo calcula ADM aplicando 18% a los precios: si el ITBIS impreso
    en la factura NO es el 18% de esas lineas, el documento va a quedar
    registrado por un monto distinto al del papel.

    Paso en produccion el 2026-08-03 (FP00001063): el papel decia 4,520.47 con
    ITBIS 575.72, y ADM cobro 645.51 sobre las mismas lineas -> 69.79 de mas.
    Se chequea ANTES del POST, porque despues la unica salida es borrar el
    documento y ADM no deja anular.
    """
    base = sum(i["Quantity"] * i["Price"] for i in payload["Items"] if i["TaxScheduleID"])
    exento = sum(i["Quantity"] * i["Price"] for i in payload["Items"] if not i["TaxScheduleID"])
    itbis_adm = round(base * 0.18, 2)
    total_adm = round(base + exento + itbis_adm, 2)

    itbis_papel = round(float(p.get("itbis") or 0), 2)
    total_papel = round(float(p.get("monto") or 0), 2)

    if abs(itbis_adm - itbis_papel) > 0.05 or abs(total_adm - total_papel) > 0.05:
        morir(
            "NO CUADRA con el documento, no registro:\n"
            "  el papel dice   total %.2f  ITBIS %.2f\n"
            "  ADM cobraria    total %.2f  ITBIS %.2f  (18%% sobre %.2f de base)\n"
            "  diferencia      %.2f\n"
            "Alguna linea tiene el precio o el grupo de impuesto mal leido, o la\n"
            "factura trae un descuento que no se capturo. Corregi las lineas o\n"
            "preguntale al humano; NO se registra un documento que no coincide."
            % (total_papel, itbis_papel, total_adm, itbis_adm, base,
               total_adm - total_papel))


def verificar_duplicado(ncf, referencia):
    """Aviso temprano. ADM tambien lo frena, pero mejor no gastar el POST."""
    for f in paginar("VendorBills"):
        if str(f.get("NCF") or "").strip().upper() == str(ncf).upper():
            morir("YA REGISTRADA: %s tiene ese NCF" % f.get("DocID"))
        if referencia and str(f.get("Reference") or "").strip() == str(referencia):
            morir("YA REGISTRADA: %s tiene esa referencia" % f.get("DocID"))


def leer_de_vuelta(guid):
    """El POST solo devuelve el UUID; el DocID sale de acá. Y hay que confirmar
    que el documento devuelto sea EL nuestro: pasarle cualquier cosa a getbyid
    devuelve otro documento con success:true."""
    d = (llamar("GET", "VendorBills/%s" % guid).get("data")) or {}
    if str(d.get("ID") or "").lower() != guid.lower():
        morir("el readback devolvio OTRO documento (%s). La factura puede estar "
              "creada igual: buscala por NCF antes de reintentar." % d.get("DocID"))
    return d


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
    # Abortar solo si el registro esta VIVO. En ADM revertir BORRA el documento
    # (no lo anula), asi que la fila se queda con el docid + una lapida
    # (`eliminado_en`). Sin esta distincion una factura corregida no se podia
    # volver a registrar NUNCA: el guard moria contra un documento que ya no
    # existe. Paso con HUAYAO / FP00001063 el 2026-08-03.
    # El registro nuevo pisa la lapida; el rastro de la borrada vive en el
    # libro de accion, que es append-only y es el registro canonico.
    reg = p.get("registro_adm") or {}
    muerto = reg.get("eliminado_en") or reg.get("anulado_en")
    if reg.get("docid") and not muerto:
        morir("ya tiene registro_adm vivo: %s" % reg["docid"])
    if reg.get("docid"):
        print("nota: la fila trae %s pero fue %s el %s — registro de nuevo" % (
            reg["docid"],
            "eliminada" if reg.get("eliminado_en") else "anulada", muerto))

    rid, termino_pago = asegurar_proveedor(p, args.simular)
    payload = armar_payload(p, rid, termino_pago)

    if args.simular:
        print()
        print(json.dumps(payload, ensure_ascii=False, indent=1))
        print()
        verificar_cuadre(p, payload)
        print("el cuadre coincide con el documento")
        return

    verificar_cuadre(p, payload)
    verificar_duplicado(payload["NCF"], payload["Reference"])

    d = llamar("POST", "VendorBills", cuerpo=payload)
    if not d.get("success") or not isinstance(d.get("data"), str):
        morir("ADM rechazo la factura: %s" % sanear(d.get("message")))
    guid = d["data"]

    doc = leer_de_vuelta(guid)
    print("REGISTRADA: %s (uuid %s)" % (doc.get("DocID"), guid))
    print("  total %s | itbis %s" % (doc.get("TotalAmount"), doc.get("TaxAmount")))

    sql("update qualia_trabajos set propuesta = propuesta || "
        "jsonb_build_object('registro_adm', jsonb_build_object("
        "'docid', :'doc', 'uuid', :'guid', 'documento', 'VendorBills', "
        "'fecha', now()::date, 'reference', :'ref')) "
        "where id = :'id' and empresa_id = :'emp';",
        doc=doc.get("DocID"), guid=guid, ref=payload["Reference"],
        id=args.trabajo, emp=env("QUALIA_EMPRESA_ID"))
    print("  guardado en la mesa")

    # El adjunto. Era el unico paso que quedaba a mano y se comia el 55% del
    # turno (ver subir_adjunto). Va DESPUES de guardar el docid a proposito: el
    # docid es el dato irremplazable y no se hace esperar detras de una subida.
    # Si falla NO se aborta — la factura ya esta registrada y eso es lo que hay
    # que dejar asentado; el adjunto se reintenta.
    ruta, motivo = bajar_documento(args.trabajo)
    if not ruta:
        print("  ADJUNTO: no pude bajar el documento, subilo a mano — %s" % motivo)
    else:
        try:
            da = subir_adjunto(guid, ruta)
        except Exception as e:
            da = {"success": False, "message": type(e).__name__}
        if da.get("success"):
            print("  adjunto: %s subido" % os.path.basename(ruta))
            sql("update qualia_trabajos set propuesta = jsonb_set(propuesta, "
                "'{registro_adm,adjunto}', jsonb_build_object("
                "'nombre', :'n', 'storage_id', :'sid')) "
                "where id = :'id' and empresa_id = :'emp';",
                n=os.path.basename(ruta),
                sid=da.get("data") if isinstance(da.get("data"), str) else "",
                id=args.trabajo, emp=env("QUALIA_EMPRESA_ID"))
        else:
            print("  ADJUNTO FALLO (%s). La factura SI quedo registrada."
                  % sanear(da.get("message")))
            print("  Reintentalo con el curl del SKILL sobre uuid %s, y OJO: el"
                  % guid)
            print("  rol lleva espacio, va como 'Contabilidad%20Digital' en la URL.")

    # Cerrar la fila. Hasta hoy este paso NO EXISTIA en ninguna capa del sistema
    # (ni aca, ni en la skill, ni en la web): la factura se registraba de verdad
    # y la mesa la dejaba en 'aprobada' para siempre, asi que desde la web
    # parecia que no se habia registrado nunca.
    #
    # Va en una sentencia APARTE de la de arriba a proposito. Si alguien movio el
    # trabajo mientras corriamos, el guard `estado='aprobada'` no matchea — y en
    # una sola sentencia eso se llevaria puesto tambien el docid, que es el dato
    # irremplazable: ata la fila a un documento real en ADM. El estado se corrige
    # despues; el docid no se recupera. La garantia de "nunca registrada sin
    # evidencia" la da el CHECK qualia_trabajos_registrada_con_evidencia, no la
    # atomicidad de esta linea.
    #
    # NADA de `updated_at = now()` en el SET: el rol tiene grant solo sobre
    # estado/propuesta/resumen/error_detalle y el UPDATE entero muere con
    # "permission denied". El trigger de updated_at ya lo sella solo.
    cerrado = sql("update qualia_trabajos set estado = 'registrada' "
                  "where id = :'id' and empresa_id = :'emp' "
                  "and estado = 'aprobada' returning id;",
                  id=args.trabajo, emp=env("QUALIA_EMPRESA_ID"))
    if cerrado:
        print("  estado: registrada")
    else:
        print("  OJO: el docid quedo guardado pero el estado NO se cerro; "
              "el trabajo ya no estaba en 'aprobada'. Revisar a mano.")
    print()
    print("Falta solo el libro de accion, citando %s." % doc.get("DocID"))


if __name__ == "__main__":
    main()
