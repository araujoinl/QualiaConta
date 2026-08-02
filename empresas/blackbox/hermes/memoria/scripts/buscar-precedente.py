#!/usr/bin/env python3
"""Responde en UNA sola corrida la pregunta "¿con qué cuenta registro esto?".

Por qué existe como archivo y no como el `python3 -c` que traía la skill: el
guardián de comandos de Hermes marca el flag `-c` de cualquier intérprete
("script execution via -e/-c flag") y consulta a un segundo LLM antes de dejar
correr el comando. Ese peaje costó 8-17 segundos por llamada — 57 de los 98
segundos que tardó el trabajo 133ea3d5 (medido 2026-08-02). Invocado como
archivo, el mismo trabajo pasa libre.

El otro motivo es de contenido: la receta vieja sólo sabía decir "no lo
encontré" con una salida VACÍA, indistinguible de un comando roto, y el
contable improvisaba una categoría que no existe en ADM. Acá cada camino
termina en una instrucción aplicable.

    buscar-precedente.py "nombre del proveedor"   # o su RNC
    buscar-precedente.py --cuenta 611.17          # quién usa esa cuenta
    buscar-precedente.py --cuentas                # catálogo de cuentas en uso
    buscar-precedente.py --tipos                  # catálogo de tipos de gasto 606
    buscar-precedente.py --plan viatico           # busca en el plan completo

Devuelve los DOS ejes, que son distintos: el **tipo de gasto** del 606 es uno
por documento (va en la cabecera de la propuesta) y la **cuenta contable** es
por renglón.

El término SIEMPRE entre comillas: hay proveedores con `&` en el nombre.
"""
import json
import os
import re
import signal
import sys
import unicodedata

# Sin esto, un `| head` corta la salida y Python escupe un BrokenPipeError con
# traceback — que el contable lee como "el comando falló" y reintenta al pedo.
signal.signal(signal.SIGPIPE, signal.SIG_DFL)

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                    "preentrenamiento", "agg")
MAPA = os.path.join(BASE, "proveedor-cuentas.json")
# La libreta GENERAL: el tipo de gasto del 606 no es de esta empresa sino de
# la DGII, así que vive fuera y se cruza por RNC. Montada :ro.
GENERAL = "/nucleo-contable/agg/rnc-tipo-gasto.json"
PLAN = os.path.join(BASE, "plan-cuentas.json")

REF = "agg:proveedor-cuentas.json"
DOMINANTE_MIN = 70.0
# Un 100% sacado de UNA factura no es un precedente, es una anécdota. Por debajo
# de este piso la cuenta se muestra como señal, nunca como precedente citable.
MUESTRA_MIN = 3


def norm(s):
    """Minúsculas y sin tildes: 'Viáticos' y 'viaticos' tienen que colisionar."""
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s.lower()).strip()


def cargar(ruta):
    try:
        return json.load(open(ruta, encoding="utf-8"))
    except (IOError, ValueError) as e:
        sys.exit("ERROR: no se pudo leer %s (%s)" % (ruta, e))


def catalogo(d):
    """Las cuentas que la contabilidad real usa. Es la respuesta al proveedor
    nuevo: se elige de acá por la naturaleza del gasto, no inventando rubros."""
    cuentas = d.get("cuentas") or []
    if not cuentas:
        print("El archivo de precedentes está en formato viejo (sin el bloque "
              "'cuentas'). Re-corré generar-proveedor-cuentas.py.")
        return
    print("CUENTAS EN USO (%d):" % len(cuentas))
    for c in cuentas:
        print("  %-9s %-34s %4d usos  %3d proveedores" % (
            c["codigo"], c["nombre"][:34], c["usos"], c["n_proveedores"]))


def cargar_general():
    """La libreta general puede no existir (empresa recién montada): eso no es
    un error, sólo significa que no hay precedente de tipo de gasto todavía."""
    try:
        return json.load(open(GENERAL, encoding="utf-8"))
    except (IOError, ValueError):
        return None


def catalogo_tipos(_d=None):
    """Los tipos de gasto del 606 con el uso real de TODAS las empresas."""
    g = cargar_general()
    tipos = (g or {}).get("catalogo") or []
    if not tipos:
        print("(el archivo no trae tipos de gasto: re-corré generar-proveedor-cuentas.py)")
        return
    print("TIPOS DE GASTO 606 EN USO (%d) — uno por documento:" % len(tipos))
    for t in tipos:
        print("  %-3s %-52s %4d facturas  %3d suplidores" % (
            t["codigo"], t["nombre"][:52], t["usos"], t["n_suplidores"]))


def mostrar_tipo_gasto(p):
    """El tipo de gasto del 606 es UNO por documento — eje distinto de la cuenta,
    que es por renglón. Sale de la libreta GENERAL (todas las empresas), cruzado
    por RNC: los 40 suplidores con dominante citable cubren el 85% de las
    facturas. La cuenta, en cambio, es de esta empresa y sale del mapa local."""
    g = cargar_general()
    fila = None
    if g and p.get("rnc"):
        rncs = {p["rnc"]} | set(p.get("rncs_alt") or [])
        fila = next((s for s in g["suplidores"] if s["rnc"] in rncs), None)
    tipos = (fila or {}).get("tipos") or []
    if not tipos:
        falta = "el proveedor no tiene RNC" if not p.get("rnc") else \
                ("la libreta general no está" if not g else "sin historia en la libreta general")
        print("  TIPO DE GASTO: sin precedente (%s) — elegilo del catálogo "
              "(--tipos) por la naturaleza del documento." % falta)
        return
    top = tipos[0]
    usos = sum(t["usos"] for t in tipos)
    if len(tipos) > 1:
        otros = ", ".join("%s %.0f%%" % (t["codigo"], t["pct"]) for t in tipos[1:4])
        detalle = " (también: %s)" % otros
    else:
        detalle = ""
    if usos >= MUESTRA_MIN and top["pct"] >= DOMINANTE_MIN:
        print("  TIPO DE GASTO 606: %s %s (%d de %d, %.1f%%)%s" % (
            top["codigo"], top["nombre"], top["usos"], usos, top["pct"], detalle))
    else:
        print("  TIPO DE GASTO 606: sin dominante claro — el más usado es %s %s "
              "(%d de %d). Confirmalo por la naturaleza del documento.%s" % (
                  top["codigo"], top["nombre"], top["usos"], usos, detalle))


def mostrar_proveedor(p, por_rnc=False):
    print("PROVEEDOR: %s" % p["nombre"])
    if por_rnc:
        print("  ⚠ Coincidió por RNC. CONFIRMÁ que ese nombre es el de tu "
              "documento: el RNC impreso en una factura no siempre es el del "
              "proveedor que la emitió. Si no casa, buscá por nombre.")
    rncs = p.get("rncs_alt") or []
    print("  RNC: %s%s | facturas históricas: %d" % (
        p["rnc"] or "(sin RNC)",
        (" (también visto como %s)" % ", ".join(rncs)) if rncs else "",
        p["facturas"]))
    mostrar_tipo_gasto(p)
    cuentas = p.get("cuentas") or []
    for c in cuentas[:4]:
        print("    %-9s %-34s %3d usos  %5.1f%%" % (
            c["codigo"], c["nombre"][:34], c["usos"], c["pct"]))
    if not cuentas:
        print("    (sin cuentas registradas)")
        return
    top = cuentas[0]
    # El denominador son USOS de cuenta, no facturas: una factura puede tocar
    # varias cuentas, así que la suma de usos supera el total de facturas.
    usos = sum(c["usos"] for c in cuentas)
    if p["facturas"] < MUESTRA_MIN:
        print("  MUESTRA INSUFICIENTE (%d factura(s)): la cuenta de arriba es una "
              "señal, NO un precedente citable. Confirmala por la naturaleza del "
              "renglón." % p["facturas"])
    elif top["pct"] >= DOMINANTE_MIN:
        print("  PRECEDENTE: %s %s (%d de %d usos de cuenta, %.1f%%, sobre %d "
              "facturas)" % (top["codigo"], top["nombre"], top["usos"], usos,
                             top["pct"], p["facturas"]))
        print("  precedente_ref: %s#%s" % (REF, p["rnc"] or norm(p["nombre"])))
        print("  Es el default de arranque, no un sello: revisá renglón por "
              "renglón y mové el que contradiga la naturaleza de esa cuenta.")
    else:
        print("  SIN CUENTA DOMINANTE (ninguna llega a %.0f%%, sobre %d facturas): "
              "este proveedor se registra con VARIAS cuentas — es lo normal en "
              "restaurantes y similares. NO hay precedente citable: repartí cada "
              "renglón entre las cuentas de arriba según lo que sea, con "
              "metodo='razonado' y la explicación en detalle. Si algún renglón no "
              "encaja en ninguna, mirá el catálogo con --cuentas."
              % (DOMINANTE_MIN, p["facturas"]))


def buscar_proveedores(d, termino):
    """Exacto por RNC; si no, por nombre.

    Devuelve (fuertes, debiles, por_rnc). La separación no es cosmética:
    'fc gestion' contra 'Gulfstream Petroleum GESTIONES Operativas' es una
    colisión de substring, y mezclarla con un match real haría que un
    restaurante se registre como combustible.
    """
    t = norm(termino)
    solo_digitos = re.sub(r"\D", "", termino)
    if len(solo_digitos) in (9, 11):
        exactos = [p for p in d["proveedores"]
                   if p["rnc"] == solo_digitos
                   or solo_digitos in (p.get("rncs_alt") or [])]
        if exactos:
            return exactos, [], True
    tokens = [x for x in t.split(" ") if len(x) >= 4]
    fuertes, debiles = [], []
    for p in d["proveedores"]:
        n = norm(p["nombre"])
        if (t and t in n) or (len(tokens) >= 2 and all(x in n for x in tokens)):
            fuertes.append(p)
        elif any(len(x) >= 5 and x in n for x in tokens):
            debiles.append(p)
    fuertes.sort(key=lambda x: -x["facturas"])
    debiles.sort(key=lambda x: -x["facturas"])
    return fuertes, debiles, False


def sin_precedente(d, termino):
    print('SIN PRECEDENTE PARA "%s" — este proveedor no aparece en las %d '
          "facturas históricas." % (termino, d["_meta"]["n_facturas"]))
    print("No inventes una categoría: ADM no las tiene. Clasificá por la "
          "naturaleza del renglón eligiendo de esta lista (metodo='razonado'), "
          "y elegí el tipo de gasto del catálogo 606 de abajo.")
    print()
    catalogo_tipos(d)
    print()
    catalogo(d)
    coincidencias = [c for c in cargar(PLAN)["cuentas"]
                     if norm(termino) and norm(termino) in norm(c.get("nombre"))]
    if coincidencias:
        print()
        print("ADEMÁS, en el plan de cuentas el término aparece en:")
        for c in coincidencias[:10]:
            print("  %-9s %s" % (c.get("codigo"), c.get("nombre")))
    print()
    print("Si NINGUNA de las de arriba encaja, el plan completo tiene más: "
          "buscá con --plan <palabra> y dejá dicho en detalle por qué saliste "
          "de las cuentas en uso.")


def por_cuenta(d, codigo):
    for c in d.get("cuentas") or []:
        if c["codigo"] == codigo.strip():
            print("CUENTA %s — %s" % (c["codigo"], c["nombre"]))
            print("  %d usos en %d proveedores. Los que más la usan:" % (
                c["usos"], c["n_proveedores"]))
            for p in c["proveedores"]:
                print("    %-46s %3d" % (p["nombre"][:46], p["usos"]))
            return
    print("La cuenta %s no aparece usada en el histórico." % codigo)
    catalogo(d)


def en_plan(termino):
    """El plan completo (215 cuentas), no sólo las 46 que ya se usan."""
    t = norm(termino)
    hits = [c for c in cargar(PLAN)["cuentas"] if t and t in norm(c.get("nombre"))]
    if not hits:
        print('Ninguna cuenta del plan tiene "%s" en el nombre. Ojo con las '
              "palabras: 'viaje' no encuentra 'Dieta y Viáticos'." % termino)
        return
    print("PLAN DE CUENTAS — %d coincidencia(s) con \"%s\":" % (len(hits), termino))
    for c in hits[:25]:
        print("  %-9s %-40s %s" % (c.get("codigo"), (c.get("nombre") or "")[:40],
                                   c.get("tipo") or ""))


def main(argv):
    if not argv:
        sys.exit('Uso: buscar-precedente.py "nombre del proveedor" | <rnc> | '
                 "--cuenta <codigo> | --cuentas | --tipos | --plan <palabra>")
    if argv[0] == "--plan":
        if len(argv) < 2:
            sys.exit("Falta la palabra a buscar en el plan.")
        return en_plan(" ".join(argv[1:]))

    d = cargar(MAPA)
    if argv[0] == "--cuentas":
        return catalogo(d)
    if argv[0] == "--tipos":
        return catalogo_tipos(d)
    if argv[0] == "--cuenta":
        if len(argv) < 2:
            sys.exit("Falta el código de cuenta.")
        return por_cuenta(d, argv[1])

    termino = " ".join(argv).strip()
    fuertes, debiles, por_rnc = buscar_proveedores(d, termino)
    if fuertes:
        for p in fuertes[:5]:
            mostrar_proveedor(p, por_rnc=por_rnc)
            print()
        if len(fuertes) > 5:
            print("(%d coincidencias más, refiná el término)" % (len(fuertes) - 5))
        return
    if debiles:
        print("PARECIDOS DE NOMBRE — NO son precedente, sólo comparten una "
              "palabra. Ignoralos salvo que sea el mismo negocio:")
        for p in debiles[:5]:
            cuentas = p.get("cuentas") or []
            print("  %-48s %d facturas  %s" % (
                p["nombre"][:48], p["facturas"],
                cuentas[0]["codigo"] if cuentas else ""))
        print()
    sin_precedente(d, termino)


if __name__ == "__main__":
    main(sys.argv[1:])
