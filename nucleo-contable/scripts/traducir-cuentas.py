#!/usr/bin/env python3
"""Traduce el mapa proveedor→cuenta de una empresa al plan de cuentas de otra.

Para qué sirve: una empresa nueva no tiene historia, así que no tiene precedente
de cuenta. Pero si su plan de cuentas es copia del de una empresa que sí la
tiene, el precedente es aprovechable — sólo hay que reescribir los códigos.

**La traducción es por NOMBRE, jamás por número.** Medido el 2026-08-02 entre
BlackBox y Planchas: de 182 códigos en común, 36 significan cosas distintas.
`620.11` es Combustible en una y "Otros gastos" en la otra; `620.12` es Software
en una y Combustible en la otra — están cruzadas. Copiar por número habría
mandado 351 facturas de gasolina a "Otros gastos" con un precedente del 97%
respaldándolas. Por eso acá el código de origen se ignora por completo: se busca
el nombre en el plan del destino y se adopta SU código.

Si el plan del destino es copia del origen, la traducción da 100% y la herencia
es total sin configurar nada. Si el destino tiene su propio plan, se traduce lo
que casa y se REPORTA lo que no — nunca se adivina.

    traducir-cuentas.py --origen <proveedor-cuentas.json> \\
                        --plan-destino <accounts.json|accounts.jsonl> \\
                        [--salida <proveedor-cuentas.json del destino>]

Sin --salida sólo informa: sirve para ver cuánto se hereda antes de decidir.
"""
import argparse
import json
import os
import re
import sys
import unicodedata


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9 ]+", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()


def cargar_plan(ruta):
    """Acepta la salida de la edge function admcloud-accounts ({data:[...]}), un
    array pelado, o el accounts.jsonl del extractor (una línea por cuenta)."""
    texto = open(ruta, encoding="utf-8").read().strip()
    filas = []
    try:
        d = json.loads(texto)
        filas = d.get("data") if isinstance(d, dict) else d
    except ValueError:
        for linea in texto.splitlines():
            try:
                o = json.loads(linea)
            except ValueError:
                continue
            filas.append(o.get("data") or o)

    plan = {}
    for c in filas or []:
        cod = str(c.get("codigo") or c.get("Code") or c.get("AccountCode") or "").strip()
        nom = str(c.get("nombre") or c.get("Name") or c.get("AccountName") or "").strip()
        if cod and nom:
            # Primero gana: los planes traen duplicados de nombre en subcuentas.
            plan.setdefault(norm(nom), (cod, nom))
    return plan


def raiz(palabra):
    """Recorta plurales y géneros simples para que 'correspondencias' y
    'correspondencia' colisionen. No es un stemmer: es lo mínimo que hace falta."""
    return re.sub(r"(es|s)$", "", palabra) if len(palabra) > 4 else palabra


def parecidas(nombre, plan, minimo=0.6, tope=3):
    """Candidatas del plan destino por solapamiento de palabras. Sólo se imprimen
    como pregunta: aplicar un parecido a ciegas es cómo se cuela un mapeo
    equivocado con cara de precedente."""
    a = {raiz(p) for p in norm(nombre).split() if len(p) > 2}
    if not a:
        return []
    salida = []
    for clave, (cod, nom) in plan.items():
        b = {raiz(p) for p in clave.split() if len(p) > 2}
        if not b:
            continue
        score = len(a & b) / float(len(a | b))
        if score >= minimo:
            salida.append((score, cod, nom))
    salida.sort(key=lambda x: -x[0])
    return [(c, n) for _, c, n in salida[:tope]]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--origen", required=True)
    ap.add_argument("--plan-destino", required=True)
    ap.add_argument("--salida")
    args = ap.parse_args()

    origen = json.load(open(args.origen, encoding="utf-8"))
    plan = cargar_plan(args.plan_destino)
    if not plan:
        sys.exit("El plan del destino vino vacío: no traduzco nada.")

    # Se traduce el catálogo de cuentas UNA vez y se reusa por proveedor.
    traduccion, sin_traducir = {}, []
    for c in origen.get("cuentas") or []:
        destino = plan.get(norm(c["nombre"]))
        if destino:
            traduccion[c["codigo"]] = {"codigo": destino[0], "nombre": destino[1]}
        else:
            sin_traducir.append(c)

    total_usos = sum(c["usos"] for c in origen.get("cuentas") or [])
    usos_ok = sum(c["usos"] for c in (origen.get("cuentas") or [])
                  if c["codigo"] in traduccion)
    iguales = sum(1 for k, v in traduccion.items() if k == v["codigo"])

    print("PLAN DEL DESTINO: %d cuentas con nombre único" % len(plan))
    print("CUENTAS DEL PRECEDENTE: %d" % len(origen.get("cuentas") or []))
    print("  traducidas por nombre: %d  (de esas, %d conservan el mismo código)"
          % (len(traduccion), iguales))
    print("  SIN equivalente:       %d" % len(sin_traducir))
    print("cobertura por uso: %d de %d usos (%.0f%%)"
          % (usos_ok, total_usos, 100.0 * usos_ok / total_usos if total_usos else 0))

    cambian = [(k, v) for k, v in traduccion.items() if k != v["codigo"]]
    if cambian:
        print("\nCAMBIAN DE CÓDIGO (por esto no se copia por número):")
        for viejo, nuevo in sorted(cambian)[:25]:
            print("  %-9s -> %-9s %s" % (viejo, nuevo["codigo"], nuevo["nombre"][:40]))
    if sin_traducir:
        print("\nNO EXISTEN EN EL DESTINO (hay que crearlas o mapearlas a mano):")
        for c in sorted(sin_traducir, key=lambda x: -x["usos"]):
            print("  %-9s %-38s %4d usos" % (c["codigo"], c["nombre"][:38], c["usos"]))
            # Sugerencias por parecido, NUNCA aplicadas solas: "Envios y
            # Correspondencias" contra "Envios y correspondencia" es obviamente
            # la misma cuenta, pero "Seguros" contra "Seguros de Vehículos" no lo
            # es, y la diferencia sólo la sabe un humano.
            for cand in parecidas(c["nombre"], plan):
                print("      ¿será?  %-9s %s" % (cand[0], cand[1]))

    if not args.salida:
        print("\n(sin --salida: no escribí nada)")
        return

    proveedores = []
    for p in origen.get("proveedores") or []:
        cuentas = []
        for c in p.get("cuentas") or []:
            t = traduccion.get(c["codigo"])
            if t:
                cuentas.append(dict(c, codigo=t["codigo"], nombre=t["nombre"]))
        # Un proveedor cuyas cuentas no se pudieron traducir NO se hereda a
        # medias: sin cuentas el precedente sería una mentira con formato.
        if cuentas:
            proveedores.append(dict(p, cuentas=cuentas))

    idx = {}
    for p in proveedores:
        for c in p["cuentas"]:
            e = idx.setdefault(c["codigo"], {"codigo": c["codigo"], "nombre": c["nombre"],
                                             "usos": 0, "proveedores": []})
            e["usos"] += c["usos"]
            e["proveedores"].append({"nombre": p["nombre"], "usos": c["usos"]})
    cuentas_idx = sorted(idx.values(), key=lambda x: -x["usos"])
    for e in cuentas_idx:
        e["proveedores"].sort(key=lambda x: -x["usos"])
        e["n_proveedores"] = len(e["proveedores"])
        e["proveedores"] = e["proveedores"][:12]

    salida = {
        "_meta": dict(origen.get("_meta") or {}, **{
            "heredado_de": os.path.abspath(args.origen),
            "plan_destino": os.path.abspath(args.plan_destino),
            "traducido_por": "nombre de cuenta (nunca por código)",
            "n_cuentas_sin_equivalente": len(sin_traducir),
            "cobertura_por_uso_pct": round(100.0 * usos_ok / total_usos, 1) if total_usos else 0,
        }),
        "proveedores": proveedores,
        "cuentas": cuentas_idx,
    }
    tmp = args.salida + ".tmp"
    os.makedirs(os.path.dirname(os.path.abspath(args.salida)), exist_ok=True)
    json.dump(salida, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    os.replace(tmp, args.salida)
    print("\n%d proveedores heredados -> %s" % (len(proveedores), args.salida))


if __name__ == "__main__":
    main()
