#!/usr/bin/env python3
"""Regresion del registro de una nota de credito de proveedor.

    python3 test-nota-credito.py

Corre sin base y sin red. El caso es la NC de Claro E340009998496, congelada
tal como el modelo la dejo en la mesa el 2026-08-07 —con TODOS los montos en
negativo y `documento_adm: "VendorBills"`, o sea con los dos errores que este
camino existe para corregir.

Lo bueno del caso es el valor esperado: no esta inventado. Esa nota ya esta
registrada en ADM como NCP00000006, y los renglones que se comparan aca abajo
son los que ADM guardo de verdad (21,50 al 18% + 2,15 y 0,43 exentos, total
27,95, ITBIS 3,87). El test compara contra un documento que existe.

Lo que protege, en orden de importancia:

 1. QUE UNA NOTA DE CREDITO NO SE REGISTRE COMO FACTURA. Es el error caro: no
    es un total distinto, es otro documento y otra secuencia fiscal.
 2. Que el discriminador siga siendo ANGOSTO. Un `^E34` suelto se lleva puesto
    al cargo bancario con que el banco devuelve el 2x1000, que tambien es E34
    y tiene que seguir siendo `BankCharges`. Aca eso se prueba por el lado que
    este script puede ver: que la decision salga del NCF y NO de lo que el
    modelo haya escrito en `documento_adm`.
 3. Que los signos mezclados MUERAN en vez de aplanarse. `abs()` sobre una
    lectura a medias inventa plata.
 4. Que la factura normal siga saliendo igual que siempre.
"""
import importlib.util
import json
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import cuadre  # noqa: E402

# El script tiene guiones en el nombre, asi que no entra por `import` a secas.
_spec = importlib.util.spec_from_file_location(
    "registrar_en_adm", os.path.join(AQUI, "registrar-en-adm.py"))
reg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(reg)

# El mapa de cuentas se stubea ACA y no se toca el codigo de produccion: la
# unica razon por la que `armar_payload` necesitaba red era traducir el codigo
# de cuenta a UUID, que es una busqueda exacta sin ningun juicio adentro.
reg.mapa_cuentas = lambda: {
    "620.05": "8bd21ee6-561a-4774-77d6-08dd1014e167",   # Comunicacion
    "620.09": "af1e1fcd-a160-4f55-77da-08dd1014e167",   # Gasto ISC
    "690.05": "ad2603f9-fcba-46e0-77fa-08dd1014e167",   # Otros Impuestos
}

# La propuesta REAL del trabajo 0534fc90, como la escribio el modelo.
NC_CLARO = {
    "ncf": "E340009998496",
    "rnc": "101001577",
    "fecha": "2026-07-04",
    "itbis": -3.87,
    "monto": -27.95,
    "moneda": "DOP",
    "proveedor": "Compania Dominicana De Telefonos S A",
    "documento_adm": "VendorBills",          # el campo que miente
    "ncf_modificado": "E310016002709",
    "factura_original_docid": "FP00001066",
    "lineas": [
        {"cuenta": "620.05", "precio": -21.50, "cantidad": 1, "itbis": -3.87,
         "descripcion": "Ajuste Averia en Servicio (reversa)"},
        {"cuenta": "620.09", "precio": -2.15, "cantidad": 1, "itbis": 0,
         "descripcion": "Ajuste ISC 10% (reversa)"},
        {"cuenta": "690.05", "precio": -0.43, "cantidad": 1, "itbis": 0,
         "descripcion": "CDT 2% (reversa)"},
    ],
}

# Lo que ADM guardo de verdad en la NCP00000006: (Price, lleva ITBIS, TaxPercent).
NCP00000006 = [(21.50, True, 18.0), (2.15, False, 0.0), (0.43, False, 0.0)]
NCP_TOTAL, NCP_ITBIS = 27.95, 3.87

UUID_FACTURA = "a06ee909-7d89-488e-af73-08de5fa79b81"


def muere(fn, *a, **kw):
    """True si la funcion llama a morir(). `morir` hace sys.exit(1).

    Se traga el stderr: el motivo que imprime `morir` es correcto y esperado, y
    verlo suelto en la salida de un test que pasa se lee como si algo hubiera
    fallado."""
    ruido, sys.stderr = sys.stderr, open(os.devnull, "w")
    try:
        fn(*a, **kw)
        return False
    except SystemExit:
        return True
    finally:
        sys.stderr.close()
        sys.stderr = ruido


def main():
    fallos = []

    def check(cond, msg):
        if not cond:
            fallos.append(msg)

    # (1) El discriminador. Angosto: mira el NCF, y solo el tipo 34.
    check(reg.es_nota_credito(NC_CLARO), "no reconocio la NC de Claro (E34)")
    check(reg.es_nota_credito({"ncf": "  e340000157349 "}),
          "el discriminador no tolera espacios ni minusculas")
    check(not reg.es_nota_credito({"ncf": "E310016002709"}),
          "tomo una factura E31 por nota de credito")
    check(not reg.es_nota_credito({}),
          "un papel sin NCF no es una nota de credito, y hay 45 facturas asi")
    check(not reg.es_nota_credito({"ncf": "E3400", "documento_adm": "BankCharges"})
          is None, "es_nota_credito tiene que decidir sin mirar documento_adm")

    # (2) La normalizacion. Enderezar, no adivinar.
    p = reg.normalizar_nota_credito(NC_CLARO)
    check(p["monto"] == 27.95 and p["itbis"] == 3.87,
          "la cabecera quedo en negativo: %s / %s" % (p["monto"], p["itbis"]))
    check([l["precio"] for l in p["lineas"]] == [21.50, 2.15, 0.43],
          "las lineas no quedaron positivas: %s" % [l["precio"] for l in p["lineas"]])
    check(NC_CLARO["monto"] == -27.95,
          "normalizar_nota_credito MUTO la propuesta original; tiene que copiar")

    mezclada = json.loads(json.dumps(NC_CLARO))
    mezclada["lineas"][1]["precio"] = 2.15          # una positiva entre negativas
    check(muere(reg.normalizar_nota_credito, mezclada),
          "acepto una nota con los signos MEZCLADOS en vez de morir")

    # (3) El payload, contra lo que ADM guardo de verdad.
    payload = reg.armar_payload(p, "rel-uuid", "termino-uuid",
                                "VendorCreditNotes", UUID_FACTURA)
    reales = [(i["Price"], bool(i["TaxScheduleID"]), i["TaxPercent"])
              for i in payload["Items"]]
    check(reales == NCP00000006,
          "los renglones no son los de la NCP00000006: %s" % (reales,))
    check("PaymentTermID" not in payload,
          "la nota de credito lleva PaymentTermID, que en las dos NCP viene null")
    check("InvoiceModificationReasonID" not in payload,
          "se mando el motivo, que viene null en las dos NCP: seria inventarlo")
    check(payload.get("InvoiceID") == UUID_FACTURA,
          "no quedo el rastro a la factura que corrige")
    check(payload["NCF"] == payload["Reference"] == "E340009998496",
          "Reference tiene que ser el NCF de la propia nota")
    check(all(i["AccountID"] for i in payload["Items"]),
          "alguna linea quedo sin cuenta")

    sin_link = reg.armar_payload(p, "rel-uuid", "termino-uuid",
                                 "VendorCreditNotes", None)
    check("InvoiceID" not in sin_link,
          "sin factura resuelta no se manda InvoiceID vacio")

    # (4) El cuadre, que con negativos se salteaba EN SILENCIO.
    total = cuadre.total_segun_adm(payload["Items"])
    check(float(total) == NCP_TOTAL,
          "ADM guardaria %s y el papel dice %s" % (total, NCP_TOTAL))
    check(not muere(reg.verificar_cuadre, p, payload),
          "el verificador rechaza una nota que en ADM cuadra al centavo")

    # Y que el cuadre CORRA de verdad: con el total en negativo, cuadrar_items
    # cortaba por `objetivo <= 0` y devolvia los renglones intactos sin avisar.
    torcida = reg.normalizar_nota_credito(NC_CLARO)
    torcida["lineas"][0]["precio"] = 21.49          # un centavo de menos
    ajustado = reg.armar_payload(torcida, "rel", "term", "VendorCreditNotes")
    check(float(cuadre.total_segun_adm(ajustado["Items"])) == NCP_TOTAL,
          "el cuadre no corrigio el centavo: quedo en %s"
          % cuadre.total_segun_adm(ajustado["Items"]))

    # (5) La factura normal, intacta.
    factura = {
        "ncf": "E310016002709", "fecha": "2026-07-01", "monto": 25.37,
        "itbis": 3.87, "proveedor": "X", "rnc": "101001577",
        "lineas": [{"cuenta": "620.05", "precio": 21.50, "cantidad": 1,
                    "itbis": 3.87, "descripcion": "Telefono"}],
    }
    fp = reg.armar_payload(factura, "rel-uuid", "termino-uuid")
    check(fp.get("PaymentTermID") == "termino-uuid",
          "la factura perdio el PaymentTermID, que ahi SI es obligatorio")
    check("InvoiceID" not in fp, "una factura no lleva InvoiceID")
    check(fp["Items"][0]["TaxPercent"] == 18.0,
          "la factura dejo de resolver su tasa: %s" % fp["Items"][0]["TaxPercent"])

    print("nota de credito de referencia : NCP00000006 (E340009998496)")
    print("renglones esperados           : %s" % (NCP00000006,))
    print("total / itbis                 : %.2f / %.2f" % (NCP_TOTAL, NCP_ITBIS))
    if fallos:
        print("\nFALLA:")
        for f in fallos:
            print("  - %s" % f)
        return 1
    print("\nOK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
