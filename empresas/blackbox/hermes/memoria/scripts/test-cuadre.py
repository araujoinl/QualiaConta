#!/usr/bin/env python3
"""Regresion del cuadre de facturas contra la aritmetica de ADM.

    python3 test-cuadre.py

Corre sin base y sin red: los 63 casos de `casos-cuadre.json` son las facturas
que la mesa registro de verdad en BlackBox hasta el 2026-08-05, congeladas.

Lo que protege, en orden de importancia:

 1. QUE NADIE DEJE DE REGISTRARSE. El cambio toca el camino por el que entran
    TODAS las facturas: si el verificador empieza a rechazar una que antes
    pasaba, la mesa se traba y nadie sube nada. Este es el test que manda.

 2. Que el total que ADM va a guardar sea el del papel. Sin el ajuste cuadran
    49 de 63; con el, 62. La que falta no es trabajo pendiente: es una factura
    mal capturada que el verificador tiene que RECHAZAR, y el test comprueba
    justamente que la rechace (ver RECHAZO_ESPERADO).

 3. Que lo que no cuadre quede por ENCIMA de la tolerancia del verificador. Una
    diferencia que sobrevive al ajuste y ademas pasa por debajo del umbral es lo
    peor de los dos mundos: se registra torcida y nadie se entera. Eso es lo que
    venia pasando con 13 facturas hasta el 2026-08-05.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cuadre  # noqa: E402

# La tolerancia del verificador de `registrar-en-adm.py`. Por encima de esto
# muere y no registra.
TOLERANCIA = 0.05

# La unica que NO cuadra, y no se espera que cuadre: tiene que ser RECHAZADA.
#
# FP00001063 no es un problema de redondeo. Sus renglones dan 4.518,53 contra un
# papel de 4.520,47: RD$1,94 de diferencia, dos ordenes de magnitud por encima
# de un centavo. Es la factura del incidente del 2026-08-03 —ADM le cobro 69,79
# de ITBIS de mas sobre esas mismas lineas— y en ADM ya no existe: se elimino,
# que era la unica salida. Su propuesta quedo en la mesa con las lineas mal
# leidas, y por eso sigue en el fixture: es el caso que prueba que el
# verificador FRENA lo que no puede arreglar en vez de registrarlo torcido.
#
# Si alguna vez esta lista crece, no es un caso conocido mas: es que el ajuste
# de precio dejo de resolver algo que resolvia.
RECHAZO_ESPERADO = {"FP00001063"}


def items_de(caso):
    """Los renglones como los arma `armar_payload`, con la tasa deducida del
    ITBIS capturado — que es lo que hace `resolver_tasa_linea` alla."""
    items = []
    for l in caso["lineas"]:
        desc = float(l.get("descuento") or 0)
        base = (float(l.get("cantidad") or 1) * float(l.get("precio") or 0)
                * (1 - desc / 100.0))
        imp = float(l.get("itbis") or 0)
        pct = round(imp / base * 100) if base > 0 and imp > 0 else 0
        items.append({
            "Quantity": float(l.get("cantidad") or 1),
            "Price": float(l.get("precio") or 0),
            "DiscountPercent": desc,
            "TaxScheduleID": ("sched" if pct else None),
            "TaxPercent": pct,
        })
    return items


def main():
    ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), "casos-cuadre.json")
    casos = json.load(open(ruta, encoding="utf-8"))
    fallos = []
    cuadran_antes = cuadran_despues = 0
    no_cuadran = []

    for caso in casos:
        docid = caso["docid"]
        papel = cuadre.r2(caso["monto"])
        items = items_de(caso)

        antes = cuadre.total_segun_adm(items)
        if antes == papel:
            cuadran_antes += 1

        ajustados, ajuste = cuadre.cuadrar_items(items, caso["monto"])
        despues = cuadre.total_segun_adm(ajustados)

        # (1) nadie deja de registrarse: el ajuste no puede EMPEORAR la
        #     diferencia ni empujarla por encima de la tolerancia.
        d_antes = abs(float(antes - papel))
        d_despues = abs(float(despues - papel))
        if d_despues > d_antes + 1e-9:
            fallos.append("%s: el ajuste EMPEORO la diferencia (%.2f -> %.2f)"
                          % (docid, d_antes, d_despues))
        if d_despues > TOLERANCIA >= d_antes:
            fallos.append("%s: quedaria RECHAZADA por el verificador y antes pasaba"
                          % docid)

        # (2) el ajuste mueve centavos, no pesos.
        if ajuste and abs(float(ajuste["movido"])) > 0.10:
            fallos.append("%s: el ajuste movio %.2f, demasiado para un redondeo"
                          % (docid, float(ajuste["movido"])))

        if despues == papel:
            cuadran_despues += 1
        else:
            no_cuadran.append(docid)
            # (3) lo que no cuadra tiene que quedar POR ENCIMA de la tolerancia,
            #     o sea que el verificador lo frena. Una diferencia que sobrevive
            #     al ajuste y ademas pasa por debajo del umbral es lo peor de los
            #     dos mundos: se registra torcida y nadie se entera.
            if d_despues <= TOLERANCIA:
                fallos.append("%s: no cuadra (%.2f) pero pasaria el verificador; "
                              "se registraria con un total que no es el del papel"
                              % (docid, d_despues))

    # (4) la lista es exacta: ni una mas (regresion de la regla) ni una menos
    #     (quedo desactualizada y el comentario esta mintiendo).
    sobran = set(no_cuadran) - RECHAZO_ESPERADO
    faltan = RECHAZO_ESPERADO - set(no_cuadran)
    if sobran:
        fallos.append("dejaron de cuadrar facturas que antes si: %s" % sorted(sobran))
    if faltan:
        fallos.append("estas ya cuadran y siguen listadas como rechazo esperado, "
                      "actualiza la lista: %s" % sorted(faltan))

    print("casos: %d" % len(casos))
    print("cuadraban con ADM antes del ajuste : %d" % cuadran_antes)
    print("cuadran despues del ajuste         : %d" % cuadran_despues)
    print("rechazadas a proposito             : %s" % sorted(no_cuadran))
    if fallos:
        print("\nFALLA:")
        for f in fallos:
            print("  - %s" % f)
        return 1
    print("\nOK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
