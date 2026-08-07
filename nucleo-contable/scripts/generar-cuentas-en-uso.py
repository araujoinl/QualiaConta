#!/usr/bin/env python3
"""Genera doctrina/cuentas-en-uso.md desde el agg del histórico.

La tabla es EVIDENCIA determinista (qué cuenta, cuánto se usa, quiénes la
usan, qué tipo dice el plan); la columna «Qué es / qué NO va acá» es SEMÁNTICA
y la dicta Carlos en la ratificación — este script la preserva entre corridas
(lee el .md existente y re-inyecta lo dictado), así regenerar la evidencia no
borra la doctrina.

Uso:
    generar-cuentas-en-uso.py [--agg DIR] [--salida RUTA]

Defaults pensados para el server (rutas del repo en CodeBox); el backtest y
la corrida local los sobreescriben por flag.
"""
import argparse
import datetime
import json
import os
import re

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))


def cargar(ruta):
    with open(ruta, encoding="utf-8") as fh:
        return json.load(fh)


def semantica_previa(ruta_md):
    """codigo -> texto dictado, leído del doc existente. Solo se consideran
    dictadas las filas cuya última columna no sea el placeholder."""
    if not os.path.exists(ruta_md):
        return {}
    dictado = {}
    for linea in open(ruta_md, encoding="utf-8"):
        m = re.match(r"^\| `([\d.]+)` \|.*\| ([^|]+) \|$", linea.strip())
        if m:
            texto = m.group(2).strip()
            if texto and not texto.startswith("—"):
                dictado[m.group(1)] = texto
    return dictado


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--agg", default=os.path.join(
        RAIZ, "empresas", "blackbox", "hermes", "preentrenamiento", "agg"))
    ap.add_argument("--salida", default=os.path.join(
        RAIZ, "nucleo-contable", "doctrina", "cuentas-en-uso.md"))
    args = ap.parse_args()

    agg = cargar(os.path.join(args.agg, "proveedor-cuentas.json"))
    plan = {str(c.get("codigo")): c
            for c in cargar(os.path.join(args.agg, "plan-cuentas.json")).get("cuentas", [])}
    dictado = semantica_previa(args.salida)

    cuentas = sorted(agg.get("cuentas") or [], key=lambda c: str(c["codigo"]))
    meta = agg.get("_meta") or {}
    hoy = datetime.date.today().isoformat()

    filas = []
    for c in cuentas:
        cod = str(c["codigo"])
        tipo = (plan.get(cod) or {}).get("tipo") or "?"
        provs = ", ".join(p["nombre"][:24] for p in (c.get("proveedores") or [])[:3])
        sem = dictado.get(cod, "— (dictar en ratificación)")
        filas.append("| `%s` | %s | %s | %d | %d | %s | %s |" % (
            cod, c["nombre"][:38], tipo, c["usos"], c["n_proveedores"],
            provs or "—", sem))

    contenido = """---
estado: borrador
aprobo:
evidencia: destilado determinista del agg (%s facturas históricas de ADM), regenerado %s
---

# Cuentas en uso — semántica y evidencia

Las cuentas que la contabilidad REAL de la empresa usa, con su evidencia. La
última columna es la doctrina: **qué es esta cuenta y qué NO va acá** — la
dicta Carlos y este generador la preserva entre corridas. Una cuenta sin
dictado se usa solo por precedente del agg (arranque), nunca para razonar un
caso nuevo.

Dos aprendizajes de la auditoría 2026-08-07 esperan su fila (dictarlos acá al
ratificar): capitalizables NO van a cuentas de gasto (el inversor de Suena →
activo, P-004) y la membresía de fitness es representación.

Regenerar (la evidencia; la semántica dictada sobrevive):

    python3 nucleo-contable/scripts/generar-cuentas-en-uso.py

| Cuenta | Nombre | Tipo (plan) | Usos | Provs | Proveedores típicos | Qué es / qué NO va acá |
|---|---|---|---|---|---|---|
%s
""" % (meta.get("n_facturas", "?"), hoy, "\n".join(filas))

    os.makedirs(os.path.dirname(args.salida), exist_ok=True)
    with open(args.salida, "w", encoding="utf-8") as fh:
        fh.write(contenido)
    print("escrito %s (%d cuentas, %d con semántica dictada)"
          % (args.salida, len(filas), len(dictado)))


if __name__ == "__main__":
    main()
