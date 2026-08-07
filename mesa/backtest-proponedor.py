#!/usr/bin/env python3
"""Backtest del proponedor determinista contra lo que el humano YA aprobó.

Es el gate de estreno de proponer-directo.py (plan proponedor-determinista,
F1): antes de que el poller lo corra en producción, se re-juega cada factura
aprobada/registrada de la mesa con su dossier real y se compara la propuesta
del proponedor contra la que el humano aprobó. La vara no es "se parece": es
el REPARTO POR CUENTA — sumar la base de cada renglón por cuenta contable y
que coincida al centavo (±0.05, el mismo umbral de la web). La granularidad
de renglones puede diferir (el humano fusiona líneas); el reparto no.

Un NO_PROPONE acá no es un fallo: es la compuerta trabajando — ese documento
habría ido a sesión LLM como hoy. Los fallos de verdad son PROPUSO_DISTINTO:
cada uno se lista entero, porque uno solo sin explicación frena el estreno.

Corre donde estén los datos (no necesita base viva):
    backtest-proponedor.py --filas trabajos.jsonl --dossiers <dir>

  trabajos.jsonl: una línea por trabajo, jsonb_build_object('id', id,
    'estado', estado, 'propuesta', propuesta) de qualia_trabajos con
    tipo='factura' y estado in ('aprobada','registrada').
  <dir>/<id>/dossier.json: el dossier real del prep (mesa-cache).

Env que hereda el proponedor: QUALIA_EMPRESA_ID, GLM_API_KEY /
OPENROUTER_API_KEY, QUALIA_AGG_DIR, QUALIA_NUCLEO_AGG, QUALIA_MEMORIA_DIR.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
UMBRAL = 0.05


def reparar_artefactos(trabajos, dossiers_dir):
    """El re-juego tiene UN artefacto objetivo: el dossier re-preparado DESPUÉS
    del registro ve el propio documento en el histórico de ADM (el delta
    nocturno ya lo bajó) y el dedup se marca a sí mismo. En producción el prep
    corre ANTES del registro, así que ese duplicado no existe. Se limpia SOLO
    cuando los DocID del dedup son exactamente el del propio trabajo — un
    duplicado real (otro DocID) se queda y corta, como debe.

    Copia los dossiers a un dir temporal: los originales no se tocan."""
    docid_de = {}
    for t in trabajos:
        docid = ((t.get("propuesta") or {}).get("registro_adm") or {}).get("docid")
        if docid:
            docid_de[t["id"]] = str(docid)
    fix = tempfile.mkdtemp(prefix="backtest-dossiers-")
    reparados = 0
    for t in trabajos:
        tid = t["id"]
        origen = os.path.join(dossiers_dir, tid, "dossier.json")
        if not os.path.exists(origen):
            continue
        destino_dir = os.path.join(fix, tid)
        os.makedirs(destino_dir, exist_ok=True)
        shutil.copy2(origen, os.path.join(destino_dir, "dossier.json"))
        texto = os.path.join(dossiers_dir, tid, "texto.txt")
        if os.path.exists(texto):
            shutil.copy2(texto, os.path.join(destino_dir, "texto.txt"))
        propio = docid_de.get(tid)
        if not propio:
            continue
        ruta = os.path.join(destino_dir, "dossier.json")
        try:
            d = json.load(open(ruta, encoding="utf-8"))
        except ValueError:
            continue
        dup = d.get("duplicados") or {}
        adm = dup.get("adm") or []
        if adm and all(str(x) == propio for x in adm):
            dup["adm"] = []
            dup["nota_backtest"] = ("dedup ADM traia solo el DocID propio "
                                    "(%s): artefacto del re-juego, limpiado" % propio)
            json.dump(d, open(ruta, "w", encoding="utf-8"),
                      ensure_ascii=False, indent=2)
            reparados += 1
    print("artefactos de re-juego reparados: %d (dossiers copiados a %s)"
          % (reparados, fix))
    return fix


def reparto_por_cuenta(lineas):
    """cuenta -> base (precio*cantidad) redondeada. El ITBIS se compara aparte
    en el total de cabecera: el reparto contable vive en la base."""
    r = {}
    for l in lineas or []:
        try:
            base = round(float(l["precio"]) * float(l["cantidad"]), 2)
            cuenta = str(l["cuenta"]).strip()
        except (KeyError, TypeError, ValueError):
            continue
        r[cuenta] = round(r.get(cuenta, 0) + base, 2)
    return r


def comparar(mia, humana):
    """Lista de diferencias que rompen el gate; vacía = coinciden."""
    difs = []
    rep_mio = reparto_por_cuenta(mia.get("lineas"))
    rep_hum = reparto_por_cuenta(humana.get("lineas"))
    for cuenta in sorted(set(rep_mio) | set(rep_hum)):
        a, b = rep_mio.get(cuenta), rep_hum.get(cuenta)
        if a is None or b is None or abs(a - b) > UMBRAL:
            difs.append("cuenta %s: proponedor %s vs humano %s"
                        % (cuenta, a if a is not None else "—",
                           b if b is not None else "—"))
    tg_mio = (mia.get("tipo_gasto") or {}).get("codigo")
    tg_hum = (humana.get("tipo_gasto") or {}).get("codigo")
    if tg_hum and tg_mio != tg_hum:
        difs.append("tipo_gasto: %s vs %s" % (tg_mio, tg_hum))
    for campo in ("monto", "ncf", "rnc"):
        a, b = mia.get(campo), humana.get(campo)
        if campo == "monto":
            try:
                if a is not None and b is not None and abs(float(a) - float(b)) > UMBRAL:
                    difs.append("monto: %s vs %s" % (a, b))
            except (TypeError, ValueError):
                difs.append("monto ilegible: %r vs %r" % (a, b))
        elif b and str(a or "").strip().upper() != str(b).strip().upper():
            difs.append("%s: %s vs %s" % (campo, a, b))
    return difs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--filas", required=True)
    ap.add_argument("--dossiers", required=True)
    ap.add_argument("--pausa", type=float, default=2.0,
                    help="segundos entre llamadas al modelo (límite de ritmo)")
    args = ap.parse_args()

    trabajos = []
    for linea in open(args.filas, encoding="utf-8"):
        linea = linea.strip()
        if linea:
            trabajos.append(json.loads(linea))

    args.dossiers = reparar_artefactos(trabajos, args.dossiers)

    conteo = {"PROPUSO_IGUAL": 0, "PROPUSO_DISTINTO": 0,
              "NO_PROPUSO": 0, "SIN_DOSSIER": 0, "NO_VENDORBILLS": 0}
    distintos, no_propuso = [], {}

    for i, t in enumerate(trabajos):
        tid = t["id"]
        humana = t.get("propuesta") or {}
        if humana.get("documento_adm") not in (None, "VendorBills"):
            conteo["NO_VENDORBILLS"] += 1
            continue
        dossier = os.path.join(args.dossiers, tid, "dossier.json")
        if not os.path.exists(dossier):
            conteo["SIN_DOSSIER"] += 1
            continue

        r = subprocess.run(
            [sys.executable, os.path.join(AQUI, "proponer-directo.py"),
             "--trabajo", tid, "--simular", "--dossier", dossier, "--sin-base"],
            capture_output=True, text=True)
        try:
            salida = json.loads(r.stdout)
        except ValueError:
            salida = {"propone": False,
                      "motivos": ["salida ilegible: %s" % (r.stderr.strip()[:120]
                                                           or r.stdout.strip()[:120])]}
        if salida.get("propone"):
            difs = comparar(salida["propuesta"], humana)
            if difs:
                conteo["PROPUSO_DISTINTO"] += 1
                distintos.append((tid, humana.get("proveedor") or "?", difs))
                marca = "DISTINTO"
            else:
                conteo["PROPUSO_IGUAL"] += 1
                marca = "IGUAL"
            time.sleep(args.pausa)   # hubo llamada al modelo: no atropellar
        else:
            conteo["NO_PROPUSO"] += 1
            motivo = (salida.get("motivos") or ["?"])[0]
            no_propuso[motivo.split(":")[0]] = no_propuso.get(motivo.split(":")[0], 0) + 1
            marca = "no propone (%s)" % motivo[:70]
        print("[%2d/%d] %s %s — %s" % (i + 1, len(trabajos), tid[:8],
                                       (humana.get("proveedor") or "?")[:36], marca))

    total_prop = conteo["PROPUSO_IGUAL"] + conteo["PROPUSO_DISTINTO"]
    evaluables = total_prop + conteo["NO_PROPUSO"]
    print()
    print("=== resumen ===")
    for k, v in conteo.items():
        print("  %-18s %d" % (k, v))
    if evaluables:
        print("  cobertura (propuso / evaluables): %d/%d = %.0f%%"
              % (total_prop, evaluables, 100.0 * total_prop / evaluables))
    if total_prop:
        print("  acierto sobre propuestos: %d/%d = %.0f%%"
              % (conteo["PROPUSO_IGUAL"], total_prop,
                 100.0 * conteo["PROPUSO_IGUAL"] / total_prop))
    if no_propuso:
        print()
        print("por qué no propuso (primera compuerta que cortó):")
        for k, v in sorted(no_propuso.items(), key=lambda x: -x[1]):
            print("  %3d  %s" % (v, k))
    if distintos:
        print()
        print("== DISCREPANCIAS (cada una frena el estreno hasta explicarse) ==")
        for tid, prov, difs in distintos:
            print("  %s %s" % (tid, prov))
            for d in difs:
                print("      %s" % d)
    print()
    print("GATE: %s" % ("VERDE — cero discrepancias" if not distintos
                        else "ROJO — %d discrepancia(s)" % len(distintos)))
    return 0 if not distintos else 1


if __name__ == "__main__":
    sys.exit(main())
