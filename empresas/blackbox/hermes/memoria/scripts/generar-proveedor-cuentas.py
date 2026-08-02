#!/usr/bin/env python3
"""Destila del histórico de VendorBills el mapa proveedor → cuentas usadas.

Determinista, 0 tokens de LLM. Es el "preentrenamiento" de la clasificación
contable: para cada proveedor, con qué cuenta(s) registró la contabilidad REAL
sus facturas y con qué frecuencia. El contable lo consulta ANTES de razonar la
cuenta: proveedor conocido con cuenta dominante = precedente instantáneo.

Fuente:  preentrenamiento/raw/vendor-bills-detalle.jsonl (líneas {_id, docid, data})
Salida:  preentrenamiento/agg/proveedor-cuentas.json

Re-correr cuando el pipeline de extracción refresque el raw:
    python3 memoria/scripts/generar-proveedor-cuentas.py

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
SALIDA = os.path.join(BASE, "agg", "proveedor-cuentas.json")

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
        "rnc": None, "facturas": 0,
        "_cuentas": collections.Counter(), "_nombres": {}})
    p["facturas"] += 1
    rnc = re.sub(r"\D", "", str(d.get("RNC") or ""))
    if len(rnc) in (9, 11):
        p["rnc"] = rnc

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
    cuentas = [{"codigo": cod, "nombre": p["_nombres"].get(cod, ""),
                "usos": usos, "pct": round(100.0 * usos / total, 1)}
               for cod, usos in p["_cuentas"].most_common()] if total else []
    lista.append({"nombre": p["nombre"], "relationship_id": p["relationship_id"],
                  "rnc": p["rnc"], "facturas": p["facturas"], "cuentas": cuentas})
lista.sort(key=lambda x: -x["facturas"])

os.makedirs(os.path.dirname(SALIDA), exist_ok=True)
tmp = SALIDA + ".tmp"
json.dump({"_meta": {
    "generado": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "n_proveedores": len(lista), "n_facturas": n_facturas,
    "n_facturas_sin_cuenta": n_sin_cuenta,
    "fuente": "raw/vendor-bills-detalle.jsonl"},
    "proveedores": lista},
    open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
os.replace(tmp, SALIDA)
print(f"{len(lista)} proveedores, {n_facturas} facturas ({n_sin_cuenta} sin cuenta) -> {SALIDA}")
