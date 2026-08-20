#!/usr/bin/env python3
"""Genera la salida esperada del banco de cuadre para el port TS (F4, prec. 9).

Corre cuadre.py sobre los 63 casos reales de casos-cuadre.json —los renglones
armados EXACTAMENTE como items_de() de test-cuadre.py— y vuelca el resultado a
JSON. El test Deno de _shared/cuadre.test.ts compara su propia corrida contra
este archivo, caso por caso y campo por campo: la precondición dice "contra la
salida de cuadre.py", no contra el esperado del fixture.

Uso:
    dump-cuadre-esperado.py > ../../../../..../_shared/cuadre-esperado.json
    (el Makefile real es deploy/generar-banco-cuadre.sh)
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cuadre  # noqa: E402


def items_de(caso):
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
    salida = []
    for caso in casos:
        items = items_de(caso)
        antes = cuadre.total_segun_adm(items)
        ajustados, ajuste = cuadre.cuadrar_items(items, caso["monto"])
        despues = cuadre.total_segun_adm(ajustados)
        salida.append({
            "docid": caso["docid"],
            "monto": str(cuadre.r2(caso["monto"])),
            "items": items,
            "total_antes": str(antes),
            "total_despues": str(despues),
            "precios_finales": [i["Price"] for i in ajustados],
            "ajuste": None if ajuste is None else {
                "renglon": ajuste["renglon"],
                "antes": str(ajuste["antes"]),
                "despues": str(ajuste["despues"]),
                "movido": str(ajuste["movido"]),
            },
        })
    json.dump(salida, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
