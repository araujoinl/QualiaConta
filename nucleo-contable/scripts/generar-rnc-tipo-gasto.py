#!/usr/bin/env python3
"""Destila el mapa RNC → tipo de gasto DGII (606) a nivel GENERAL, no de empresa.

Por qué este vive fuera de `empresas/` y el de cuentas no (medido 2026-08-02):

  - El **tipo de gasto** es de la DGII: el catálogo 01-11 es nacional y el
    suplidor no cambia de naturaleza según quién le compre. Si Tupaq es "02
    Trabajos y Servicios" para una empresa, lo es para todas. Se comparte.
  - La **cuenta contable** NO se comparte. Se compararon los planes de BlackBox
    y Planchas Comerciales contra `/api/Accounts`: de 182 códigos en común, 36
    significan cosas distintas. `620.11` es Combustible en una y Otros gastos en
    la otra; `620.12` es Software en una y Combustible en la otra — están
    cruzadas. Globalizar el mapa proveedor→cuenta habría mandado la gasolina a
    "Otros gastos" con un precedente del 97% respaldándola.

Privacidad: la salida guarda RNC, tipo de gasto y conteos. **Nunca qué empresa
le compró a quién** — si algún día entran clientes de terceros, eso es dato de
ellos, no del que consulta la libreta.

Fuente:  <empresa>/preentrenamiento/raw/vendor-bills-detalle.jsonl (ExpenseTypeID)
         <empresa>/preentrenamiento/raw/vendors.jsonl              (FiscalID = RNC)
         <empresa>/preentrenamiento/raw/expense-types.jsonl        (catálogo 01-11)
Salida:  nucleo-contable/agg/rnc-tipo-gasto.json (montado :ro en el contenedor)

Recorre TODAS las empresas que tengan raw; hoy sólo BlackBox lo tiene, y por eso
el archivo nace con lo mismo que ya sabíamos. El valor aparece cuando se prenda
la segunda: arranca con el tipo de gasto resuelto para cientos de suplidores.
"""
import collections
import datetime
import glob
import json
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))          # nucleo-contable/scripts
REPO = os.path.dirname(os.path.dirname(AQUI))
EMPRESAS = os.path.join(REPO, "empresas")
SALIDA = os.path.join(REPO, "nucleo-contable", "agg", "rnc-tipo-gasto.json")

DOMINANTE_MIN = 70.0
MUESTRA_MIN = 3


def leer_jsonl(ruta):
    try:
        with open(ruta, encoding="utf-8") as f:
            for linea in f:
                try:
                    o = json.loads(linea)
                except ValueError:
                    continue
                yield o.get("data") or o
    except IOError:
        return


def main():
    por_rnc = collections.defaultdict(collections.Counter)
    nombres = collections.defaultdict(collections.Counter)
    catalogo = {}
    n_empresas = 0
    n_facturas = n_sin_rnc = n_sin_tipo = 0

    for raw in sorted(glob.glob(os.path.join(EMPRESAS, "*", "*", "preentrenamiento", "raw"))):
        if not os.path.isfile(os.path.join(raw, "vendor-bills-detalle.jsonl")):
            continue
        n_empresas += 1

        tipos = {}
        for t in leer_jsonl(os.path.join(raw, "expense-types.jsonl")):
            if t.get("ID") and t.get("FiscalCode"):
                tipos[t["ID"]] = (t["FiscalCode"], (t.get("Name") or "").strip())
                catalogo.setdefault(t["FiscalCode"], (t.get("Name") or "").strip())

        # El RNC del suplidor: del maestro por ID, y del propio bill como respaldo
        # (no siempre coinciden, ver generar-proveedor-cuentas.py).
        maestro = {}
        for v in leer_jsonl(os.path.join(raw, "vendors.jsonl")):
            fid = re.sub(r"\D", "", str(v.get("FiscalID") or ""))
            if v.get("ID") and len(fid) in (9, 11):
                maestro[v["ID"]] = fid

        for d in leer_jsonl(os.path.join(raw, "vendor-bills-detalle.jsonl")):
            n_facturas += 1
            rnc = maestro.get(str(d.get("RelationshipID") or "").strip()) or ""
            if not rnc:
                rnc = re.sub(r"\D", "", str(d.get("FiscalID") or ""))
            if len(rnc) not in (9, 11):
                n_sin_rnc += 1
                continue
            tipo = tipos.get(d.get("ExpenseTypeID"))
            if not tipo:
                n_sin_tipo += 1
                continue
            por_rnc[rnc][tipo[0]] += 1
            nom = (d.get("RelationshipName") or "").strip()
            if nom:
                nombres[rnc][nom] += 1

    suplidores = []
    for rnc, cuenta in por_rnc.items():
        total = sum(cuenta.values())
        tipos_l = [{"codigo": cod, "nombre": catalogo.get(cod, ""), "usos": n,
                    "pct": round(100.0 * n / total, 1)}
                   for cod, n in sorted(cuenta.items(), key=lambda kv: (-kv[1], kv[0]))]
        top = tipos_l[0]
        suplidores.append({
            "rnc": rnc,
            # El nombre es orientativo, para que un humano reconozca la fila.
            "nombre": nombres[rnc].most_common(1)[0][0] if nombres[rnc] else "",
            "facturas": total,
            "dominante": top["codigo"] if (total >= MUESTRA_MIN
                                           and top["pct"] >= DOMINANTE_MIN) else None,
            "tipos": tipos_l,
        })
    suplidores.sort(key=lambda x: -x["facturas"])

    idx = collections.Counter()
    provs = collections.Counter()
    for s in suplidores:
        for t in s["tipos"]:
            idx[t["codigo"]] += t["usos"]
            provs[t["codigo"]] += 1

    salida = {
        "_meta": {
            "generado": datetime.datetime.now(datetime.timezone.utc)
                        .strftime("%Y-%m-%dT%H:%M:%SZ"),
            "alcance": "GENERAL (DGII) — vale para cualquier empresa; el tipo de "
                       "gasto 606 no depende de quién compra. La cuenta contable "
                       "NO se comparte: vive en cada empresa.",
            "n_empresas_aportantes": n_empresas,
            "n_suplidores": len(suplidores),
            "n_facturas": n_facturas,
            "n_sin_rnc": n_sin_rnc,
            "n_sin_tipo_gasto": n_sin_tipo,
            "n_con_dominante": sum(1 for s in suplidores if s["dominante"]),
        },
        "catalogo": [{"codigo": c, "nombre": catalogo.get(c, ""), "usos": idx[c],
                      "n_suplidores": provs[c]}
                     for c in sorted(catalogo, key=lambda c: -idx[c])],
        "suplidores": suplidores,
    }

    if not suplidores:
        sys.exit("No se encontró ningún raw con facturas: no escribo nada.")

    os.makedirs(os.path.dirname(SALIDA), exist_ok=True)
    tmp = SALIDA + ".tmp"
    json.dump(salida, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    os.replace(tmp, SALIDA)
    print("%d suplidores (%d con tipo dominante) de %d empresa(s), %d facturas "
          "-> %s" % (len(suplidores), salida["_meta"]["n_con_dominante"],
                     n_empresas, n_facturas, SALIDA))


if __name__ == "__main__":
    main()
