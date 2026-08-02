#!/usr/bin/env python3
"""Destila del histórico de VendorBills el mapa proveedor → cuentas usadas.

Determinista, 0 tokens de LLM. Es el "preentrenamiento" de la clasificación
contable: para cada proveedor, con qué cuenta(s) registró la contabilidad REAL
sus facturas y con qué frecuencia. El contable lo consulta ANTES de razonar la
cuenta: proveedor conocido con cuenta dominante = precedente instantáneo.

Fuente:  preentrenamiento/raw/vendor-bills-detalle.jsonl (líneas {_id, docid, data})
         preentrenamiento/raw/vendors.jsonl (el RNC vive acá como FiscalID,
         NO en el VendorBill: se une por vendors.ID == bill.RelationshipID)
Salida:  preentrenamiento/agg/proveedor-cuentas.json — "proveedores" (mapa
         directo) y "cuentas" (índice invertido cuenta → quién la usa, para
         resolver un proveedor nuevo sin inventar categorías)

Re-correr cuando el pipeline de extracción refresque el raw:
    python3 memoria/scripts/generar-proveedor-cuentas.py

Este archivo destila SOLO la cuenta contable, que es propia de cada empresa:
el mismo código significa cosas distintas en dos empresas (verificado
2026-08-02: 36 colisiones entre BlackBox y Planchas; 620.11 es Combustible en
una y "Otros gastos" en la otra). El TIPO DE GASTO del 606 NO se destila acá
porque no es de la empresa sino de la DGII: vive en
nucleo-contable/agg/rnc-tipo-gasto.json, por RNC, alimentado por todas.

La cuenta sale de data.Items[] (AccountCode/AccountName: la clasificación del
gasto). Si una factura no trae Items, se usan data.Accounts[] con débito > 0,
excluyendo ITBIS adelantado (118*) y CxP (2*): son mecánica del asiento, no
clasificación.
"""
import collections
import datetime
import json
import os
import re
import sys

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "preentrenamiento")
CRUDO = os.path.join(BASE, "raw", "vendor-bills-detalle.jsonl")
CRUDO_VENDORS = os.path.join(BASE, "raw", "vendors.jsonl")
SALIDA = os.path.join(BASE, "agg", "proveedor-cuentas.json")

# El VendorBill no trae RNC: se indexa el maestro de suplidores por ID y se une
# por RelationshipID. (ComercialName/ShortName se descartaron como alias: ADM
# no los puebla en ningún suplidor, verificado 2026-08-02 sobre los 169.)
vendors = {}
try:
    for linea in open(CRUDO_VENDORS, encoding="utf-8"):
        try:
            v = json.loads(linea)
        except ValueError:
            continue
        v = v.get("data") or v
        vid = str(v.get("ID") or "").strip()
        if not vid:
            continue
        fiscal = re.sub(r"\D", "", str(v.get("FiscalID") or ""))
        vendors[vid] = {"rnc": fiscal if len(fiscal) in (9, 11) else None}
except IOError:
    print("AVISO: no se pudo leer %s — los RNC quedan vacíos" % CRUDO_VENDORS,
          file=sys.stderr)

proveedores = {}
n_facturas = 0
n_sin_cuenta = 0

for linea in open(CRUDO, encoding="utf-8"):
    try:
        d = json.loads(linea).get("data") or {}
    except ValueError:
        continue
    rid = str(d.get("RelationshipID") or "").strip()
    nombre = (d.get("RelationshipName") or "").strip()
    if not rid and not nombre:
        continue
    n_facturas += 1
    clave = rid or nombre.lower()
    p = proveedores.setdefault(clave, {
        "nombre": nombre, "relationship_id": rid or None,
        "rnc": None, "facturas": 0, "_rncs_doc": collections.Counter(),
        "_cuentas": collections.Counter(), "_nombres": {}})
    p["facturas"] += 1
    v = vendors.get(rid) or {}
    if v.get("rnc"):
        p["rnc"] = v["rnc"]
    # El RNC impreso en la factura no siempre es el del maestro: hay 10
    # facturas de 5 proveedores donde difieren, y en un caso el RNC impreso
    # en facturas de Totalenergies es el del maestro de OTRO proveedor. Si
    # sólo se guardara el del maestro, buscar por el RNC que trae el
    # documento caería en el proveedor vecino con confianza alta. Se guardan
    # todos los vistos. (El campo del bill es FiscalID, no RNC; a veces con
    # guiones: 1-31-16538-9.)
    rnc_doc = re.sub(r"\D", "", str(d.get("FiscalID") or ""))
    if len(rnc_doc) in (9, 11):
        p["_rncs_doc"][rnc_doc] += 1

    cuentas_doc = set()
    for it in (d.get("Items") or []):
        cod = str(it.get("AccountCode") or "").strip()
        if cod:
            cuentas_doc.add((cod, (it.get("AccountName") or "").strip()))
    if not cuentas_doc:
        for a in (d.get("Accounts") or []):
            try:
                deb = float(a.get("Debit") or 0)
            except (TypeError, ValueError):
                deb = 0
            cod = str(a.get("AccountCode") or "").strip()
            if deb > 0 and cod and not cod.startswith(("118", "2")):
                cuentas_doc.add((cod, (a.get("AccountName") or "").strip()))
    if not cuentas_doc:
        n_sin_cuenta += 1
    for cod, nom in cuentas_doc:
        p["_cuentas"][cod] += 1
        if nom:
            p["_nombres"][cod] = nom

lista = []
for p in proveedores.values():
    total = sum(p["_cuentas"].values())
    # Desempate por código: most_common() no define el orden de los empates y
    # el destilado corre todas las noches — sin esto el JSON se reordena solo.
    ordenadas = sorted(p["_cuentas"].items(), key=lambda kv: (-kv[1], kv[0]))
    cuentas = [{"codigo": cod, "nombre": p["_nombres"].get(cod, ""),
                "usos": usos, "pct": round(100.0 * usos / total, 1)}
               for cod, usos in ordenadas] if total else []
    vistos = [r for r, _ in p["_rncs_doc"].most_common()]
    rnc = p["rnc"] or (vistos[0] if vistos else None)
    lista.append({"nombre": p["nombre"], "relationship_id": p["relationship_id"],
                  "rnc": rnc, "rncs_alt": [r for r in vistos if r != rnc],
                  "facturas": p["facturas"], "cuentas": cuentas})
lista.sort(key=lambda x: -x["facturas"])

# Índice invertido. Sin esto, un proveedor ausente obliga al contable a
# improvisar una "categoría" que no existe en ADM: acá ve la cuenta real, su
# nombre exacto y qué proveedores comparables la usan.
idx = {}
for p in lista:
    for c in p["cuentas"]:
        e = idx.setdefault(c["codigo"], {"codigo": c["codigo"], "nombre": c["nombre"],
                                         "usos": 0, "proveedores": []})
        if c["nombre"] and not e["nombre"]:
            e["nombre"] = c["nombre"]
        e["usos"] += c["usos"]
        e["proveedores"].append({"nombre": p["nombre"], "usos": c["usos"]})
cuentas_idx = sorted(idx.values(), key=lambda x: -x["usos"])

for e in cuentas_idx:
    e["proveedores"].sort(key=lambda x: -x["usos"])
    e["n_proveedores"] = len(e["proveedores"])
    e["proveedores"] = e["proveedores"][:12]

os.makedirs(os.path.dirname(SALIDA), exist_ok=True)
tmp = SALIDA + ".tmp"
json.dump({"_meta": {
    "generado": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "n_proveedores": len(lista), "n_facturas": n_facturas,
    "n_facturas_sin_cuenta": n_sin_cuenta,
    "n_con_rnc": sum(1 for x in lista if x["rnc"]),
    "n_con_rnc_alterno": sum(1 for x in lista if x["rncs_alt"]),
    "n_cuentas": len(cuentas_idx),
    "fuente": "raw/vendor-bills-detalle.jsonl + raw/vendors.jsonl"},
    "proveedores": lista, "cuentas": cuentas_idx},
    open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
os.replace(tmp, SALIDA)
print(f"{len(lista)} proveedores ({sum(1 for x in lista if x['rnc'])} con RNC), "
      f"{len(cuentas_idx)} cuentas, {n_facturas} facturas "
      f"({n_sin_cuenta} sin cuenta) -> {SALIDA}")
