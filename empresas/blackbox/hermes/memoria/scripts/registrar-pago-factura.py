#!/usr/bin/env python3
"""Registra en ADM Cloud el PAGO de una factura de proveedor (BillPayments).

Cierra el circulo que la mesa tenia abierto. La factura se registra subiendo su
foto por la Bandeja y ese trabajo NO queda atado a ningun movimiento del banco
—las 61 registradas al 2026-08-05 no tienen `banco_tx_id`, ninguna—, asi que el
cargo de la tarjeta queda huerfano y Conciliacion lo lee como «sin registro en
ADM» aunque el gasto este facturado y contabilizado. El documento que ata las
dos puntas es este.

  CashAccountID = la tarjeta (SI, una tarjeta es cuenta de caja en ADM aunque su
                  codigo viva en el pasivo; es como se registro siempre)
  RelationshipID = el proveedor, leido de la FACTURA en ADM y no de la propuesta
  Documents[]   = la factura que cancela, con su UUID y su monto

NO clasifica ningun gasto y no lleva `Accounts[]`: la cuenta de resultado ya la
puso la factura cuando se registro. Este documento solo mueve el pasivo contra
la caja, y ese asiento lo deriva ADM.

Es ARCHIVO por la misma razon que sus hermanos: el guardian de comandos marca
`python3 -c` y cobra 15-30s por llamada.

Uso:
    registrar-pago-factura.py --trabajo <uuid>            # registra
    registrar-pago-factura.py --trabajo <uuid> --simular  # payload sin escribir
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

# Numero de cuenta del colector -> codigo contable de ADM.
#
# Espejo de `cuentas` en mapa-cuentas.yaml, igual que CUENTAS_CAJA_TARJETA en
# registrar-cargo-bancario.py: si agregas una tarjeta alla, va aca. Se duplica a
# proposito y no se parsea el yaml — no hay PyYAML en el venv y ninguno de los
# scripts hermanos lo lee.
#
# Las patas en USD quedan fuera A PROPOSITO, no por olvido: ADM tiene UNA cuenta
# por tarjeta y las dos son en pesos, asi que un consumo en dolares no tiene
# donde asentarse. Si aparece uno, este script muere y lo decide un humano.
TARJETAS = {
    "407537XXXXXX1877-DOP": "203.10",  # Visa 1877 - Tarjeta Corporativa 877
    "407537XXXXXX2414-DOP": "203.11",  # Visa 2414 - Tarjeta Corporativa 414
}

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
        # Un 401 aca no es un bug del script: es el rol. `BillPayments` estaba
        # FUERA del rol del contable por decision escrita (docs/plan-encendido-
        # escritura.md: «los pagos quedan explicitamente fuera de este plan»), y
        # este script existe porque esa decision se gradua. Si el rol todavia no
        # se amplio en ADM, el mensaje tiene que decirlo, no dejar adivinando.
        if e.code in (401, 403):
            morir("ADM nego el permiso (%s) en %s. El rol '%s' todavia no puede "
                  "crear pagos a proveedor: hay que ampliarlo en ADM."
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
    """ADM devuelve 50 por pagina SIEMPRE, ignore lo que le pidas: se avanza por
    el largo realmente devuelto y se corta con la pagina vacia."""
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
    """codigo de cuenta -> UUID. Pagina /api/Accounts."""
    mapa = {}
    for c in paginar("Accounts"):
        cod = str(c.get("Code") or c.get("AccountCode") or "").strip()
        if cod and c.get("ID"):
            mapa.setdefault(cod, c["ID"])
    return mapa


def tipo_de_pago(codigo_caja):
    """El UUID del tipo de pago que corresponde a la cuenta de la que sale.

    ADM lo EXIGE: sin el, el POST muere con «El tipo de pago es requerido» y no
    crea nada (probado el 2026-08-05 con la FP00001102). No sale en el listado
    de BillPayments —ahi viene vacio en los 741— sino en el detalle de cada uno.

    Se resuelve por NOMBRE contra /api/PaymentTypes y no por UUID clavado: los
    GUID son de esta instancia de ADM, no de un catalogo universal, asi que uno
    hardcodeado deja de existir el dia que se migre la empresa. El catalogo hoy
    tiene cuatro: Cheque, Paypal, Tarjeta de Credito y Transferencia.

    La tarjeta lleva «Tarjeta de Credito» —es lo que usa el PP00000751, el
    primero que se registro bien— y cualquier otra cuenta de caja lleva
    «Transferencia».

    Ojo con el nombre: en esta instancia viene como 'Tarjeta de Crédito ' CON
    ESPACIO AL FINAL, asi que la comparacion normaliza antes de comparar.
    """
    quiero = "tarjeta" if codigo_caja in TARJETAS.values() else "transferencia"
    for t in paginar("PaymentTypes"):
        nombre = str(t.get("Name") or t.get("Description") or "")
        plano = (nombre.strip().lower()
                 .replace("é", "e").replace("ó", "o").replace("í", "i"))
        if plano.startswith(quiero):
            return t.get("ID")
    morir("no encontre el tipo de pago '%s' en /api/PaymentTypes de ADM. Sin el, "
          "ADM rechaza el pago con «El tipo de pago es requerido»." % quiero)


def cuenta_de_caja(p):
    """El codigo contable de la cuenta de la que sale la plata."""
    numero = str(p.get("cuenta_numero") or "").strip()
    if numero in TARJETAS:
        return TARJETAS[numero]
    morir("no se de que cuenta de ADM sale este pago. El movimiento vino de "
          "'%s' (%s) y no esta en TARJETAS de este script. Si es una tarjeta "
          "nueva, agregala aca y a `cuentas` en mapa-cuentas.yaml; si es una "
          "cuenta en dolares, no tiene donde asentarse (ADM tiene una sola "
          "cuenta por tarjeta y es en pesos) y lo decide un humano."
          % (p.get("cuenta_banco"), numero))


def buscar_factura(docid, uuid_esperado):
    """La factura de proveedor, LEIDA DE ADM.

    No se confia en lo que trae la propuesta y no es desconfianza gratuita: la
    propuesta la escribio la pantalla cuando alguien la miro, y entre ese
    momento y este la factura puede haberse anulado, eliminado o pagado. Lo que
    manda para pagar es el estado de AHORA.

    OJO con el filtro: `GET /api/VendorBills?DocID=...` IGNORA el parametro y
    devuelve las 50 de siempre (probado el 2026-08-05: pedir FP00001086 trajo
    FP00001119 y FP00001121). Por eso se busca por UUID cuando lo hay y, si no,
    se pagina y se filtra ACA. Confiar en ese filtro daria la factura equivocada
    con toda la cara de haber acertado.
    """
    if uuid_esperado:
        d = llamar("GET", "VendorBills/%s" % uuid_esperado).get("data") or {}
        if str(d.get("DocID") or "").strip() == docid:
            return d
    for d in paginar("VendorBills"):
        if str(d.get("DocID") or "").strip() == docid:
            return d
    morir("la factura %s no aparece en ADM. Si se elimino, hay que rehacer el "
          "trabajo desde la Bandeja; el pago no se registra contra un documento "
          "que no existe." % docid)


def saldo_pendiente(docid):
    """Cuanto se le debe todavia a esa factura, segun /api/AP.

    ES LA UNICA FUENTE QUE LO SABE, y costo descubrirlo. `Balance` viene NULL
    tanto en el listado de VendorBills como en el detalle, y los campos de
    estado de la factura no distinguen pagada de impaga: la FP00001027, que el
    pago PP00000750 ya cancelo casi entera, muestra exactamente el mismo
    `Status=0 / BillingStatus='Pendiente de Facturacion'` que una recien
    cargada. Creerles a esos campos seria pagar dos veces sin enterarse.

    /api/AP son las cuentas por pagar ABIERTAS —237 partidas, 224 de ellas
    facturas FP— con su saldo real: la FP00001027 aparece ahi con Balance 28.00
    sobre un total de 6.223,16, o sea lo que quedo despues del pago parcial.

    Devuelve None si la factura NO esta en AP: no debe nada, ya se pago.
    """
    for x in paginar("AP"):
        if str(x.get("DocID") or "").strip() == docid:
            return round(float(x.get("Balance") or 0), 2)
    return None


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
    if reg.get("docid") and not (reg.get("eliminado_en") or reg.get("anulado_en")):
        morir("ya tiene registro_adm vivo: %s" % reg["docid"])

    documento = p.get("documento_adm")
    if documento != "BillPayments":
        morir("este script solo registra BillPayments; la propuesta dice '%s'"
              % documento)

    asignacion = p.get("asignacion") or {}
    elegidas = asignacion.get("facturas") or []
    if len(elegidas) != 1:
        # Un pago puede cubrir varias facturas y el payload lo soporta, pero
        # ninguna pantalla arma todavia ese caso. Antes de habilitarlo hay que
        # decidir como se reparte el monto cuando no cierra exacto, y eso es una
        # decision contable, no un `for`.
        morir("la propuesta trae %d facturas y este script registra pagos de "
              "UNA. El caso de varias existe en ADM (Documents[] es lista) pero "
              "todavia no se decidio como repartir un monto que no cierra."
              % len(elegidas))

    elegida = elegidas[0]
    docid_factura = str(elegida.get("docid") or "").strip()
    if not docid_factura:
        morir("la factura elegida no trae docid")

    monto = round(float(p.get("monto") or 0), 2)
    if monto <= 0:
        morir("el monto del pago tiene que ser mayor que cero")
    fecha = str(p.get("fecha") or "")[:10]
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", fecha):
        morir("la propuesta no trae una fecha valida")

    # La llave que ata ESTE pago a ESTE movimiento del banco. Es el
    # `banco_tx_id` y no el NCF: el NCF es de la FACTURA, y usarlo aca haria que
    # el pago y la factura compartieran referencia — que es justo lo que hace
    # imposible distinguirlos despues.
    referencia = str(p.get("banco_tx_id") or args.trabajo)

    factura = buscar_factura(docid_factura, elegida.get("uuid"))
    if factura.get("Void"):
        morir("la factura %s esta ANULADA en ADM. Un pago contra un documento "
              "anulado queda colgado de nada." % docid_factura)

    # El saldo es TAMBIEN el chequeo de duplicado, y por eso reemplaza al
    # barrido de pagos que tenia antes: una factura que ya se pago no le debe
    # nada a nadie, este pago exista o no. Mirar los pagos era ademas inutil —
    # `Documents[]` viene VACIO en el listado de BillPayments y solo aparece en
    # el detalle, o sea 50+ llamadas para responder lo que AP contesta en una.
    saldo = saldo_pendiente(docid_factura)
    if saldo is None:
        morir("la factura %s no tiene saldo abierto en ADM: ya esta pagada. Si "
              "este movimiento no es el de ese pago, mirá primero cual lo cancelo "
              "— pagarla de nuevo genera un anticipo que nadie pidio."
              % docid_factura)
    if saldo <= 0:
        morir("la factura %s figura en AP con saldo %.2f: no hay nada que pagar"
              % (docid_factura, saldo))
    # EL PAGO TIENE QUE CERRAR LA FACTURA AL CENTAVO, en los dos sentidos.
    #
    # De mas: ADM no lo frena y deja un anticipo que nadie pidio.
    #
    # De menos: la factura queda abierta por la diferencia PARA SIEMPRE. Nunca
    # sale de cuentas por pagar, sigue apareciendo como candidata de cualquier
    # otro cargo del mismo monto, y nadie la mira porque en la mesa figura
    # «pagada». Pasó con la FP00001102: la tarjeta cobro RD$330,00 y la factura
    # en ADM es de RD$330,02 — dos centavos que habrian quedado colgados.
    #
    # Y el origen esta rio arriba: el cruce de la pantalla compara contra la
    # copia que la mesa tiene de la factura (330,00, leida de la foto), no
    # contra lo que ADM tiene (330,02). Cuando las dos se separan, el cruce
    # empareja cosas que no cierran. Este chequeo es el que lo caza, porque es
    # el unico punto que mira el saldo REAL.
    #
    # No se decide aca: un pago parcial es legitimo en general y puede que estos
    # dos centavos haya que castigarlos contra diferencias. Pero es una decision
    # contable, y este script no la inventa.
    # La diferencia entre lo que salio de la tarjeta y lo que la factura debe.
    # Positiva = la factura debe MAS de lo que se pago, que es el caso normal
    # (ADM redondea el ITBIS hacia arriba). Ver TOPE_REDONDEO.
    # EL PAGO TIENE QUE CERRAR AL CENTAVO. Sin excepciones, y no por purismo:
    # ADM no deja meter la diferencia en ningun lado.
    #
    # Se intento (2026-08-05, PP00000754) mandarle un `Accounts[]` explicito con
    # la linea de «Diferencias por Redondeo», que es como aparece en el
    # PP00000683. ADM LO IGNORO: derivo su propio asiento desde
    # `Documents[].Amount` y acredito la tarjeta por 330,02 cuando de la tarjeta
    # habian salido 330,00. La factura cerro y la tarjeta quedo cargada de mas —
    # exactamente lo que se queria evitar. Y el centavo del PP00000683 no lo
    # puso nadie a mano: lo genero ADM solo, porque ese pago era en dolares y la
    # diferencia venia de la conversion.
    #
    # Revisado ademas el historico: de los ultimos 150 pagos, NINGUNO salda una
    # factura por menos de su monto, ni con `DiscountAmount` ni parcial. La via
    # no existe.
    #
    # Asi que quedan dos caminos y los dos son malos: pagar el saldo descuadra
    # la cuenta de banco, y pagar el movimiento deja la factura abierta para
    # siempre. Cuando los dos son malos, la respuesta no es elegir uno callado.
    # El arreglo de verdad esta rio arriba, en que la factura no nazca torcida
    # (ver cuadre.py).
    if abs(saldo - monto) > 0.005:
        morir("NO CIERRA: el movimiento del banco es de %.2f y la factura %s "
              "debe %.2f en ADM (diferencia de %.2f). ADM no deja asentar esa "
              "diferencia en el pago —se probo y la ignora—, asi que o se "
              "corrige la factura o lo decide un humano."
              % (monto, docid_factura, saldo, monto - saldo))

    proveedor_id = factura.get("RelationshipID")
    if not proveedor_id:
        morir("la factura %s no trae RelationshipID: sin proveedor el pago no "
              "se puede emitir" % docid_factura)

    codigo_caja = cuenta_de_caja(p)
    cuentas = mapa_cuentas()
    caja_uuid = cuentas.get(codigo_caja)
    if not caja_uuid:
        morir("la cuenta de caja %s no existe en /api/Accounts de ADM"
              % codigo_caja)

    tipo_pago = tipo_de_pago(codigo_caja)

    moneda = p.get("moneda") or "DOP"
    payload = {
        "DocDate": fecha,
        "CashAccountID": caja_uuid,
        "PaymentTypeID": tipo_pago,
        "RelationshipID": proveedor_id,
        "CurrencyID": moneda,
        "ExchangeRate": 1.0 if moneda == "DOP" else float(factura.get("ExchangeRate") or 1.0),
        "Reference": referencia,
        "Beneficiary": factura.get("RelationshipName") or asignacion.get("proveedor") or "",
        "Notes": ("Pago de %s con %s. %s"
                  % (docid_factura, p.get("cuenta_banco") or "tarjeta",
                     p.get("descripcion") or "")).strip(),
        # Sin `Accounts[]`: el asiento lo deriva ADM de la cuenta de caja y de
        # la cuenta por pagar de la factura. Mandar lineas aca seria volver a
        # clasificar un gasto que ya esta clasificado.
        "Documents": [{
            "DocumentID": factura.get("ID"),
            "DocID": docid_factura,
            # Lo que salio de la tarjeta, que a esta altura es igual al saldo:
            # el chequeo de arriba ya frena cualquier diferencia.
            "Amount": monto,
            "TotalAmount": round(float(factura.get("TotalAmount") or monto), 2),
            # La tasa del RENGLON, que ADM valida contra la de la factura y no
            # contra la de la cabecera: sin esto muere con «La tasa de cambio
            # indicada para el documento FP00001111 es invalida, debe ser igual
            # a la del documento» (probado el 2026-08-05). Se copia de la
            # factura en vez de asumir 1.0 — en pesos es 1.0, pero una factura
            # en dolares trae la tasa del dia en que se registro, y esa es la
            # unica que ADM acepta.
            "ExchangeRate": float(factura.get("ExchangeRate") or 1.0),
        }],
    }

    if args.simular:
        print(json.dumps(payload, ensure_ascii=False, indent=1))
        print()
        print("factura      : %s (%s)" % (docid_factura, factura.get("RelationshipName")))
        print("saldo en AP  : %.2f" % saldo)
        print("paga         : %.2f %s" % (monto, moneda))
        print("desde        : %s (%s)" % (codigo_caja, p.get("cuenta_banco")))
        print("referencia   : %s" % referencia)
        return

    # ¿Ya esta registrado ESTE movimiento? La referencia es la unica prueba.
    #
    # NO se aborta por «hay un pago del mismo dia y monto», y es la leccion que
    # costo el CB00000169: dos pagos iguales el mismo dia NO son un duplicado
    # —se pagan dos facturas gemelas— y darlo por registrado deja un pago de
    # menos y dos trabajos apuntando al mismo DocID. La otra mitad de la
    # pregunta («¿esta factura ya se pago?») la contesto AP mas arriba, que es
    # donde de verdad se sabe.
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
    # El POST no devuelve el documento creado: se RELEE siempre. El `success`
    # de esta API ya devolvio true sobre cosas que no hizo.
    doc = llamar("GET", "BillPayments/%s" % guid).get("data") or {}
    docid = doc.get("DocID")
    if str(doc.get("ID") or "").lower() != guid.lower():
        morir("el readback devolvio OTRO documento (%s)" % docid)

    print("REGISTRADO: %s (uuid %s)" % (docid, guid))
    print("  paga %s a %s por %s" % (docid_factura, doc.get("Beneficiary"),
                                     doc.get("TotalAmount")))

    # ¿Nacio pendiente de autorizacion?
    #
    # `BillPayments` tiene Authorize/Reject/MarkPendingAuthorization, asi que un
    # pago creado por API PUEDE quedar esperando el OK de alguien y no mover
    # plata todavia. Si eso pasa y la mesa dice «registrado», estamos poniendo
    # una lapida sobre algo que sigue vivo — el mismo error que costo el
    # FP00001120.
    #
    # Se pregunta por COMPORTAMIENTO y no por un campo: el listado acepta
    # `OnlyPendingAuthorize`, asi que si mi DocID aparece ahi, esta pendiente.
    # No depende de adivinar como se llama el campo en el JSON.
    def sigue_pendiente():
        return any(
            str(x.get("DocID") or "").strip() == str(docid).strip()
            for x in paginar("BillPayments", params={"OnlyPendingAuthorize": "true"})
        )

    pendiente = sigue_pendiente()

    # Autorizarlo, que es lo que hace que la plata se mueva de verdad.
    #
    # Es un paso SEPARADO del alta y no un campo del payload: el cuerpo de
    # BillPayments no tiene con que pedir «creamelo autorizado». Se crea
    # pendiente y despues se autoriza, o no se autoriza nunca.
    #
    # Es PUT, no POST: con POST devuelve 405 «does not support http method».
    #
    # Y NO se cree lo que conteste: se RELEE la lista de pendientes. Esta API ya
    # devolvio `success:true` sobre cosas que no hizo, y decir «autorizado»
    # sobre un pago que sigue esperando es la lapida falsa otra vez — con el
    # agravante de que aca la mesa daria por saldada una factura que sigue
    # debiendo.
    if pendiente:
        r = llamar("PUT", "BillPayments/Authorize", params={"id": guid})
        if str(r.get("message") or "").strip().lower() == "unauthorized":
            print("  %s quedo PENDIENTE DE AUTORIZACION: el rol '%s' puede crear "
                  "pagos pero no autorizarlos. El documento existe y NO movio "
                  "plata todavia; hay que autorizarlo a mano en ADM (Banco -> "
                  "Pagos a proveedor) o ampliarle esa accion al rol."
                  % (docid, os.environ.get("ADMCLOUD_REG_ROLE", "?")))
        else:
            pendiente = sigue_pendiente()
            if pendiente:
                print("  OJO: pedi autorizar %s y ADM contesto %r, pero sigue en "
                      "la lista de pendientes. NO movio plata: revisalo a mano."
                      % (docid, r.get("message")))
            else:
                print("  autorizado: la factura %s queda saldada" % docid_factura)

    sql("update qualia_trabajos set estado = 'registrada', "
        "propuesta = propuesta || jsonb_build_object('registro_adm', "
        "jsonb_build_object('docid', :'doc', 'uuid', :'guid', "
        "'documento', 'BillPayments', 'fecha', :'fecha', "
        "'reference', :'ref', 'pendiente_autorizacion', :'pend'::boolean, "
        "'factura', :'fact')) "
        "where id = :'id' and empresa_id = :'emp';",
        doc=docid, guid=guid, fecha=fecha, ref=referencia,
        pend="true" if pendiente else "false", fact=docid_factura,
        id=args.trabajo, emp=env("QUALIA_EMPRESA_ID"))
    print("  mesa actualizada")


if __name__ == "__main__":
    main()
