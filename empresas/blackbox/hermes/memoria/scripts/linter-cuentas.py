#!/usr/bin/env python3
"""
Linter anti-alucinación de cuentas contables — preentrenamiento QualiaConta.

Valida que todo código de cuenta citado en los .md de la memoria exista en el
plan de cuentas agregado (agg/plan-cuentas.json, salida de la Capa B). Es el
gate determinista del plan-preentrenamiento §5.3: cero códigos inventados.

USO:
    python3 linter-cuentas.py [--dir /opt/data/memoria] \
                              [--plan /opt/data/preentrenamiento/agg/plan-cuentas.json]

SALIDA:
    exit 0  limpio (resumen por stderr)
    exit 1  violaciones listadas por stdout: archivo:línea: código
    exit 2  no se pudo cargar el plan de cuentas

QUÉ CUENTA COMO "CÓDIGO CITADO" (calibrado con los códigos reales de ADM,
forma punteada tipo 101 / 101.04):
  - tokens numéricos con separadores ('.' o '-') cuya raíz tiene el mismo
    largo que las raíces del plan (ej. 101.04, 611-01); '-' se normaliza a '.'
  - números pelados precedidos por la palabra "cuenta" (ej. "cuenta 101")
  Se excluyen fechas (AAAA-MM-DD / AAAA-MM), montos con decimales tras
  símbolo de moneda y cifras con miles (45,200.00).
Los .md en subdirectorios (scripts/) no se lintan; INDEX.md sí.
"""

import argparse
import json
import os
import re
import sys

# Los montos con prefijo de moneda (USD 567.27, RD$1,234.56) NO son codigos
# de cuenta: el lookbehind variable no existe en re, asi que la exclusion de
# moneda se hace post-match mirando los ~6 chars previos.
CANDIDATO = re.compile(r"(?<![\w.,$-])(\d+(?:[.-]\d+)+)(?![\d,])")
MONEDA_PREVIA = re.compile(r"(?:USD|RD\$|US\$|EUR|DOP|\$)\s*$", re.IGNORECASE)
FECHA = re.compile(r"^\d{4}-\d{2}(-\d{2})?$")
CUENTA_PELADA = re.compile(r"\bcuentas?\s*:?\s*(\d{2,6})\b", re.IGNORECASE)


def cargar_codigos(path):
    """Devuelve el set de códigos del plan (normalizados '-'->'.').
    Tolera lista de dicts, {"cuentas": [...]}, o dict codigo->info."""
    d = json.load(open(path, encoding="utf-8"))
    cuentas = None
    if isinstance(d, list):
        cuentas = d
    elif isinstance(d, dict):
        for k in ("cuentas", "accounts", "data", "plan"):
            if isinstance(d.get(k), list):
                cuentas = d[k]
                break
        if cuentas is None:  # dict codigo -> info
            cuentas = [{"codigo": k} for k in d.keys()]
    codigos = set()
    for c in cuentas or []:
        if not isinstance(c, dict):
            continue
        code = c.get("codigo") or c.get("Code") or c.get("code") or c.get("Codigo")
        if code and re.match(r"^\d+([.-]\d+)*$", str(code)):
            codigos.add(str(code).replace("-", "."))
    return codigos


def es_codigo_posible(token, raices, largos_seg):
    """¿El token TIENE FORMA de código del plan? Solo esos se lintan; el
    resto (montos, versiones) se ignora para no dar falsos positivos."""
    if FECHA.match(token):
        return False
    partes = token.replace("-", ".").split(".")
    if len(partes[0]) not in raices:
        return False
    return all(len(p) in largos_seg for p in partes[1:])


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1].strip())
    ap.add_argument("--dir", default="/opt/data/memoria")
    ap.add_argument("--plan", default="/opt/data/preentrenamiento/agg/plan-cuentas.json")
    args = ap.parse_args()

    try:
        codigos = cargar_codigos(args.plan)
    except (OSError, json.JSONDecodeError) as e:
        print(f"no pude cargar el plan {args.plan}: {type(e).__name__}", file=sys.stderr)
        return 2
    if not codigos:
        print(f"el plan {args.plan} no trae códigos de cuenta; nada que validar", file=sys.stderr)
        return 2

    # La gramática de "parece código" sale del plan mismo, no de una constante.
    raices = {len(c.split(".")[0]) for c in codigos}
    largos_seg = {len(p) for c in codigos for p in c.split(".")[1:]} or {2}

    archivos = sorted(
        f for f in os.listdir(args.dir)
        if f.endswith(".md") and os.path.isfile(os.path.join(args.dir, f))
    )
    violaciones = []
    for nombre in archivos:
        ruta = os.path.join(args.dir, nombre)
        for nlin, linea in enumerate(open(ruta, encoding="utf-8"), 1):
            vistos = set()
            for m in CANDIDATO.finditer(linea):
                tok = m.group(1)
                if MONEDA_PREVIA.search(linea[: m.start()]):
                    continue  # monto con prefijo de moneda, no codigo de cuenta
                if es_codigo_posible(tok, raices, largos_seg):
                    vistos.add(tok.replace("-", "."))
            for m in CUENTA_PELADA.finditer(linea):
                vistos.add(m.group(1))
            for cod in sorted(vistos):
                if cod not in codigos:
                    violaciones.append((nombre, nlin, cod))

    if violaciones:
        print(f"VIOLACIONES: {len(violaciones)} código(s) citados que NO existen en el plan de cuentas")
        for nombre, nlin, cod in violaciones:
            print(f"  {nombre}:{nlin}: {cod}")
        return 1
    print(f"limpio: {len(archivos)} archivo(s) revisados contra {len(codigos)} cuentas del plan",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
