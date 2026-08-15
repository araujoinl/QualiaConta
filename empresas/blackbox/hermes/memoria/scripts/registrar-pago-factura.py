#!/usr/bin/env python3
"""Registra en ADM Cloud el PAGO de una factura de proveedor (BillPayments).

Cierra el circulo que la mesa tenia abierto. La factura se registra subiendo su
foto por la Bandeja y ese trabajo NO queda atado a ningun movimiento del banco
—las 61 registradas al 2026-08-05 no tienen `banco_tx_id`, ninguna—, asi que el
cargo de la tarjeta queda huerfano y Conciliacion lo lee como «sin registro en
ADM» aunque el gasto este facturado y contabilizado. El documento que ata las
dos puntas es este.

  CashAccountID = la tarjeta o la cuenta de banco de la que sale la plata (SI,
                  una tarjeta es cuenta de caja en ADM aunque su codigo viva en
                  el pasivo; es como se registro siempre)
  RelationshipID = el proveedor, leido de la FACTURA en ADM y no de la propuesta
  Documents[]   = las facturas que cancela, cada una con su UUID y su monto

NO clasifica ningun gasto y no lleva `Accounts[]`: la cuenta de resultado ya la
puso la factura cuando se registro. Este documento solo mueve el pasivo contra
la caja, y ese asiento lo deriva ADM.

Un pago puede cerrar VARIAS facturas y puede ABONAR sin cerrarlas, porque asi
paga la empresa: la compra de los locales J-11 y J-12 (2026-08-15) fue una
separacion de 50.000 contra una factura de 1.725.000 y despues una transferencia
de 3.400.000 que salda el resto de esa y toda la otra. Lo que no se negocia es
que la SUMA de los renglones sea exactamente lo que salio del banco — ese es el
chequeo que protege la cuenta de caja, y el que antes hacia el «cierra al
centavo». Ver `renglones()` para las tres reglas y por que un abono tiene que
venir declarado.

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

# Lo mismo para las cuentas de BANCO: numero -> (codigo contable, moneda).
#
# Espejo de `cuentas` en mapa-cuentas.yaml, y esta duplicado por la misma razon
# que TARJETAS. Un pago a proveedor sale del banco mucho mas seguido que de una
# tarjeta —la compra de los locales J-11/J-12 salio de Operaciones 874— y sin
# esto el script moria en `cuenta_de_caja` aunque todo lo demas cerrara.
#
# La moneda va al lado del codigo A PROPOSITO: ADM tiene cuentas separadas en
# pesos y en dolares, y pagar una factura en pesos desde la cuenta en USD no es
# un pago, es una conversion. `cuenta_de_caja` lo frena.
CUENTAS_BANCO = {
    "11121000000801": ("101.04", "DOP"),  # Banco Ingresos 801
    "11122010014964": ("101.05", "DOP"),  # Banco Impuestos 964
    "11122010023874": ("101.06", "DOP"),  # Banco Operaciones 874
    "21122020001404": ("102.01", "USD"),  # Banco Suplidores USD 404
    "21122020002181": ("102.02", "USD"),  # Banco Ganancia USD 181
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


def cuenta_de_caja(p, moneda):
    """El codigo contable de la cuenta de la que sale la plata."""
    numero = str(p.get("cuenta_numero") or "").strip()
    if numero in TARJETAS:
        return TARJETAS[numero]
    if numero in CUENTAS_BANCO:
        codigo, moneda_cuenta = CUENTAS_BANCO[numero]
        if moneda_cuenta != moneda:
            morir("el pago es en %s y sale de %s, que en ADM es la cuenta %s en "
                  "%s. Pagar cruzando monedas no es un pago, es una conversion: "
                  "lo decide un humano." % (moneda, p.get("cuenta_banco"),
                                            codigo, moneda_cuenta))
        return codigo
    morir("no se de que cuenta de ADM sale este pago. El movimiento vino de "
          "'%s' (%s) y no esta ni en TARJETAS ni en CUENTAS_BANCO de este "
          "script. Si es una cuenta nueva, agregala aca y a `cuentas` en "
          "mapa-cuentas.yaml; si es una tarjeta en dolares, no tiene donde "
          "asentarse (ADM tiene una sola cuenta por tarjeta y es en pesos) y "
          "lo decide un humano." % (p.get("cuenta_banco"), numero))


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


def saldos_pendientes(docids):
    """Cuanto se le debe todavia a cada factura, segun /api/AP.

    ES LA UNICA FUENTE QUE LO SABE, y costo descubrirlo. `Balance` viene NULL
    tanto en el listado de VendorBills como en el detalle, y los campos de
    estado de la factura no distinguen pagada de impaga: la FP00001027, que el
    pago PP00000750 ya cancelo casi entera, muestra exactamente el mismo
    `Status=0 / BillingStatus='Pendiente de Facturacion'` que una recien
    cargada. Creerles a esos campos seria pagar dos veces sin enterarse.

    /api/AP son las cuentas por pagar ABIERTAS —237 partidas, 224 de ellas
    facturas FP— con su saldo real: la FP00001027 aparece ahi con Balance 28.00
    sobre un total de 6.223,16, o sea lo que quedo despues del pago parcial.

    Devuelve un dict docid -> saldo. La factura que NO aparece en AP queda
    FUERA del dict: no debe nada, ya se pago.

    Se pagina AP UNA sola vez para todas las facturas del pago y no una por
    cada una: son 237 partidas en 5 llamadas, y multiplicarlas por renglon es
    el mismo gasto tonto que el barrido de BillPayments que este script ya
    habia dejado de hacer.
    """
    faltan = {str(d).strip() for d in docids}
    saldos = {}
    for x in paginar("AP"):
        docid = str(x.get("DocID") or "").strip()
        if docid in faltan:
            saldos[docid] = round(float(x.get("Balance") or 0), 2)
    return saldos


# Una diferencia MENOR a esto entre lo que se paga y lo que la factura debe no
# es un abono: es la factura que nacio torcida. Ver `renglones()`.
TOPE_REDONDEO = 1.00


def renglones(elegidas, monto_pago):
    """Que factura cierra este pago y con cuanto. Tres reglas, y ninguna es
    cosmetica.

    1. LA SUMA DE LOS RENGLONES ES EXACTAMENTE LO QUE SALIO DEL BANCO. Es el
       unico chequeo que no se negocia, y es el que antes hacia el «cierra al
       centavo» cuando el pago era de una sola factura: si la suma no da, el
       asiento acredita la caja por algo distinto de lo que la caja movio y la
       cuenta de banco queda descuadrada para siempre.

    2. UN ABONO PARCIAL VIENE DECLARADO, con `"parcial": true` en el renglon.
       No se deduce de que el monto sea menor al saldo, y la diferencia importa:
       un abono de verdad es una decision (la separacion de 50.000 del local
       J-11 contra su factura de 1.725.000), mientras que un monto que quedo
       corto sin querer es un cruce mal hecho rio arriba. Los dos se ven igual
       en el JSON; solo la bandera los distingue.

    3. UNA DIFERENCIA MENOR A TOPE_REDONDEO NO ES UN ABONO, aunque venga
       declarada. Es el caso FP00001102 —la tarjeta cobro RD$330,00 y la factura
       en ADM decia RD$330,02— y sigue siendo un error: nadie abona dos centavos
       a proposito. Dejarlo pasar deja la factura abierta para siempre por esa
       diferencia, apareciendo como candidata de cualquier otro cargo del mismo
       monto, y nadie la mira porque en la mesa figura «pagada». El arreglo esta
       rio arriba, en que la factura no nazca torcida (ver cuadre.py).

    Devuelve [{docid, uuid, monto, parcial}], ya validado contra el monto del
    pago pero TODAVIA no contra los saldos de ADM: eso lo hace main(), que es
    quien tiene AP a mano.
    """
    if not elegidas:
        morir("la propuesta no dice que factura cierra este pago: "
              "`asignacion.facturas` viene vacia. Un pago a proveedor sin "
              "documento al que aplicarse queda como anticipo, que no es lo "
              "que nadie quiso.")

    salida, suma = [], 0.0
    for i, e in enumerate(elegidas):
        docid = str(e.get("docid") or "").strip()
        if not docid:
            morir("la factura #%d de la propuesta no trae docid" % (i + 1))
        if e.get("monto") is None:
            if len(elegidas) > 1:
                # Repartir un monto entre varias facturas es una decision
                # contable —cual se salda entera y cual queda abierta— y este
                # script no la inventa. Con una sola factura no hay nada que
                # repartir: se le aplica todo el movimiento.
                morir("la propuesta trae %d facturas y la %s no dice cuanto le "
                      "toca. Con varias facturas cada renglon lleva su `monto`: "
                      "repartir el pago es una decision contable, no un `for`."
                      % (len(elegidas), docid))
            monto = round(float(monto_pago), 2)
        else:
            monto = round(float(e["monto"]), 2)
        if monto <= 0:
            morir("el renglon de %s paga %.2f: un pago de cero o negativo no "
                  "es un pago" % (docid, monto))
        salida.append({
            "docid": docid,
            "uuid": e.get("uuid"),
            "monto": monto,
            "parcial": bool(e.get("parcial")),
        })
        suma += monto

    vistos = [r["docid"] for r in salida]
    if len(set(vistos)) != len(vistos):
        morir("la propuesta repite una factura en dos renglones (%s). ADM los "
              "sumaria y el saldo quedaria mal: junta los montos en uno solo."
              % ", ".join(sorted(vistos)))

    if abs(round(suma, 2) - round(float(monto_pago), 2)) > 0.005:
        morir("NO CIERRA: los renglones suman %.2f y del banco salieron %.2f "
              "(diferencia de %.2f). La suma de lo que se aplica a las facturas "
              "tiene que ser exactamente lo que movio la caja."
              % (suma, monto_pago, suma - float(monto_pago)))

    return salida


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

    monto = round(float(p.get("monto") or 0), 2)
    if monto <= 0:
        morir("el monto del pago tiene que ser mayor que cero")

    asignacion = p.get("asignacion") or {}
    aplica = renglones(asignacion.get("facturas") or [], monto)

    fecha = str(p.get("fecha") or "")[:10]
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", fecha):
        morir("la propuesta no trae una fecha valida")

    # La llave que ata ESTE pago a ESTE movimiento del banco. Es el
    # `banco_tx_id` y no el NCF: el NCF es de la FACTURA, y usarlo aca haria que
    # el pago y la factura compartieran referencia — que es justo lo que hace
    # imposible distinguirlos despues.
    referencia = str(p.get("banco_tx_id") or args.trabajo)

    for r in aplica:
        r["adm"] = buscar_factura(r["docid"], r["uuid"])
        if r["adm"].get("Void"):
            morir("la factura %s esta ANULADA en ADM. Un pago contra un "
                  "documento anulado queda colgado de nada." % r["docid"])

    # Los saldos son TAMBIEN el chequeo de duplicado, y por eso reemplazan al
    # barrido de pagos que tenia antes: una factura que ya se pago no le debe
    # nada a nadie, este pago exista o no. Mirar los pagos era ademas inutil —
    # `Documents[]` viene VACIO en el listado de BillPayments y solo aparece en
    # el detalle, o sea 50+ llamadas para responder lo que AP contesta en una.
    saldos = saldos_pendientes([r["docid"] for r in aplica])
    for r in aplica:
        docid, paga = r["docid"], r["monto"]
        if docid not in saldos:
            morir("la factura %s no tiene saldo abierto en ADM: ya esta pagada. "
                  "Si este movimiento no es el de ese pago, mirá primero cual la "
                  "cancelo — pagarla de nuevo genera un anticipo que nadie pidio."
                  % docid)
        saldo = saldos[docid]
        if saldo <= 0:
            morir("la factura %s figura en AP con saldo %.2f: no hay nada que "
                  "pagar" % (docid, saldo))
        r["saldo"] = saldo

        # DE MAS NUNCA. ADM no lo frena y deja un anticipo que nadie pidio.
        if paga - saldo > 0.005:
            morir("la factura %s debe %.2f en ADM y este pago le aplica %.2f "
                  "(%.2f de mas). ADM no lo frena: acepta el excedente y lo deja "
                  "como anticipo del proveedor, que no es lo que nadie quiso."
                  % (docid, saldo, paga, paga - saldo))

        # DE MENOS, SOLO SI VIENE DECLARADO. Ver `renglones()`: la bandera es lo
        # unico que distingue el abono a proposito del cruce mal hecho.
        falta = round(saldo - paga, 2)
        if falta > 0.005:
            if not r["parcial"]:
                morir("NO CIERRA: la factura %s debe %.2f en ADM y este pago le "
                      "aplica %.2f, o sea que quedaria abierta por %.2f. Si el "
                      "abono es a proposito, el renglon de la propuesta lleva "
                      "\"parcial\": true y lo dice; si no, el cruce esta mal "
                      "hecho rio arriba o la factura nacio torcida."
                      % (docid, saldo, paga, falta))
            # Declarada o no, una diferencia de centavos no es un abono.
            #
            # Se intento (2026-08-05, PP00000754) mandarle a ADM un `Accounts[]`
            # explicito con la linea de «Diferencias por Redondeo», que es como
            # aparece en el PP00000683. ADM LO IGNORO: derivo su propio asiento
            # desde `Documents[].Amount` y acredito la tarjeta por 330,02 cuando
            # de la tarjeta habian salido 330,00. La factura cerro y la tarjeta
            # quedo cargada de mas — exactamente lo que se queria evitar. Y el
            # centavo del PP00000683 no lo puso nadie a mano: lo genero ADM solo,
            # porque ese pago era en dolares y la diferencia venia de la
            # conversion. La via para castigar la diferencia no existe.
            if falta < TOPE_REDONDEO:
                morir("la factura %s debe %.2f y el pago le aplica %.2f: %.2f de "
                      "diferencia no es un abono, es la factura torcida (el caso "
                      "FP00001102, RD$330,00 cobrados contra RD$330,02 "
                      "facturados). ADM no deja asentar esa diferencia en el pago "
                      "—se probo y la ignora—, asi que o se corrige la factura o "
                      "lo decide un humano." % (docid, saldo, paga, falta))

    # UN BillPayments TIENE UN SOLO RelationshipID. Si los renglones fueran de
    # proveedores distintos, ADM emitiria el pago entero a nombre del primero y
    # las cuentas por pagar de los otros quedarian saldadas contra un tercero.
    proveedores = {str(r["adm"].get("RelationshipID") or "") for r in aplica}
    if len(proveedores) > 1:
        morir("las facturas de este pago son de proveedores distintos (%s) y un "
              "pago a proveedor en ADM va a uno solo. Hay que partirlo en un "
              "pago por proveedor."
              % ", ".join(sorted(str(r["adm"].get("RelationshipName") or "?")
                                 for r in aplica)))

    factura = aplica[0]["adm"]
    docid_factura = aplica[0]["docid"]
    proveedor_id = factura.get("RelationshipID")
    if not proveedor_id:
        morir("la factura %s no trae RelationshipID: sin proveedor el pago no "
              "se puede emitir" % docid_factura)

    moneda = p.get("moneda") or "DOP"
    codigo_caja = cuenta_de_caja(p, moneda)
    cuentas = mapa_cuentas()
    caja_uuid = cuentas.get(codigo_caja)
    if not caja_uuid:
        morir("la cuenta de caja %s no existe en /api/Accounts de ADM"
              % codigo_caja)

    tipo_pago = tipo_de_pago(codigo_caja)

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
                  % (", ".join(r["docid"] for r in aplica),
                     p.get("cuenta_banco") or "tarjeta",
                     p.get("descripcion") or "")).strip(),
        # Sin `Accounts[]`: el asiento lo deriva ADM de la cuenta de caja y de
        # la cuenta por pagar de la factura. Mandar lineas aca seria volver a
        # clasificar un gasto que ya esta clasificado.
        "Documents": [{
            "DocumentID": r["adm"].get("ID"),
            "DocID": r["docid"],
            # Lo que se le aplica a ESTA factura: igual a su saldo cuando la
            # cierra, menor cuando es un abono declarado. Los chequeos de arriba
            # ya frenaron el de mas, el de menos sin declarar y el de centavos.
            "Amount": r["monto"],
            "TotalAmount": round(float(r["adm"].get("TotalAmount") or r["monto"]), 2),
            # La tasa del RENGLON, que ADM valida contra la de la factura y no
            # contra la de la cabecera: sin esto muere con «La tasa de cambio
            # indicada para el documento FP00001111 es invalida, debe ser igual
            # a la del documento» (probado el 2026-08-05). Se copia de la
            # factura en vez de asumir 1.0 — en pesos es 1.0, pero una factura
            # en dolares trae la tasa del dia en que se registro, y esa es la
            # unica que ADM acepta.
            "ExchangeRate": float(r["adm"].get("ExchangeRate") or 1.0),
        } for r in aplica],
    }

    if args.simular:
        print(json.dumps(payload, ensure_ascii=False, indent=1))
        print()
        for r in aplica:
            print("factura      : %s (%s)"
                  % (r["docid"], r["adm"].get("RelationshipName")))
            print("  saldo en AP: %.2f" % r["saldo"])
            print("  le aplica  : %.2f%s"
                  % (r["monto"], "  ABONO PARCIAL, queda debiendo %.2f"
                     % (r["saldo"] - r["monto"]) if r["parcial"] else ""))
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
    print("  paga %s a %s por %s"
          % (", ".join(r["docid"] for r in aplica), doc.get("Beneficiary"),
             doc.get("TotalAmount")))
    for ren in aplica:
        if ren["parcial"]:
            print("  OJO: %s queda ABIERTA por %.2f — es un abono, no un cierre"
                  % (ren["docid"], ren["saldo"] - ren["monto"]))

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
                cerradas = [x["docid"] for x in aplica if not x["parcial"]]
                print("  autorizado: %s"
                      % ("quedan saldadas %s" % ", ".join(cerradas) if cerradas
                         else "es un abono, ninguna factura queda saldada"))

    # `factura` sigue siendo el DocID de la primera para no romper a quien ya lo
    # leia; `facturas` es la lista completa con cuanto le toco a cada una, que
    # es lo unico que deja reconstruir despues un pago que cerro dos.
    detalle = json.dumps([{"docid": x["docid"], "monto": x["monto"],
                           "parcial": x["parcial"]} for x in aplica],
                         ensure_ascii=False)
    sql("update qualia_trabajos set estado = 'registrada', "
        "propuesta = propuesta || jsonb_build_object('registro_adm', "
        "jsonb_build_object('docid', :'doc', 'uuid', :'guid', "
        "'documento', 'BillPayments', 'fecha', :'fecha', "
        "'reference', :'ref', 'pendiente_autorizacion', :'pend'::boolean, "
        "'factura', :'fact', 'facturas', :'facts'::jsonb)) "
        "where id = :'id' and empresa_id = :'emp';",
        doc=docid, guid=guid, fecha=fecha, ref=referencia,
        pend="true" if pendiente else "false", fact=docid_factura,
        facts=detalle, id=args.trabajo, emp=env("QUALIA_EMPRESA_ID"))
    print("  mesa actualizada")


if __name__ == "__main__":
    main()
