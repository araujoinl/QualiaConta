#!/usr/bin/env python3
"""
Agregación determinista del preentrenamiento — Capa B (QualiaConta / Blackbox)

Lee los volcados crudos de ADM Cloud que dejó la Capa A (extraer-adm.py) en
/opt/data/preentrenamiento/raw/ y produce agregados compactos en
/opt/data/preentrenamiento/agg/ — el material que después ve el GLM en la
Capa C. Cero llamadas de red, cero LLM: puro disco y stdlib.

USO:
    python3 agregar-preentrenamiento.py                  # raw/ -> agg/
    python3 agregar-preentrenamiento.py --dry-run        # procesa y reporta, no escribe
    python3 agregar-preentrenamiento.py --raw DIR --out DIR

SALIDAS (en --out):
    vendors-agg.jsonl   una línea JSON por proveedor con actividad: cuentas de
                        gasto usadas (código+nombre+frecuencia+% del monto),
                        ITBIS/retenciones, tipos NCF, vía de pago, plazo medio,
                        FP* vs PI*. Cada línea ronda 300-600 tokens.
    journals-agg.json   asientos agrupados por patrón de Reference
                        (nomina|sueldo / tss / infotep) con el asiento tipo de
                        un ejemplar real por patrón + lista sin-patrón.
    bancos-agg.json     cargos bancarios por concepto/cuenta y traspasos por
                        par de cuentas. (El cruce banco<->ADM vive en
                        conciliar-entradas.py; acá no se duplica.)
    plan-cuentas.json   las cuentas contables con jerarquía, flags y uso real
                        (n líneas del histórico que tocan cada cuenta).
    ventas-agg.json     solo estadística de forma (volúmenes, NCF, por mes).

CONTRATO DE ENTRADA (robusto a raw parcial: procesa lo que haya y reporta lo
que falta). Archivos .json (array) o .jsonl (un doc por línea) cuyo nombre,
normalizado a minúsculas sin separadores, contenga el nombre del recurso:
vendors, vendorbills, journals, bankcharges, bankbanktransfers, billpayments,
accountpayments, accounts, deposits, cashinvoices, cashreceipts,
creditinvoices, salesdetailed. Acepta variantes con sufijo (-detalle, etc.)
y registros envueltos ({success,message,data} de la API, {_id,data} de
extraer-adm.py) o en tupla ({Item1,Item2}).
Si de un recurso hay headers y detalles, se fusionan por ID prefiriendo el
registro con líneas.

REQUISITOS: solo stdlib (python3). No usa red ni credenciales.
"""

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

# ======================================================================
# DESCUBRIMIENTO Y PARSEO DEL RAW
# ======================================================================

# Orden importa: la primera clave contenida en el nombre normalizado gana
# (vendorbills antes que vendors, bankbanktransfers antes que bankcharges...).
RECURSOS = [
    ("bankbanktransfers", ("bankbanktransfers", "banktransfers", "traspasos")),
    ("accountpayments",   ("accountpayments",)),
    ("billpayments",      ("billpayments",)),
    ("vendorbills",       ("vendorbills",)),
    ("vendors",           ("vendors", "proveedores")),
    ("bankcharges",       ("bankcharges", "cargosbancarios")),
    ("deposits",          ("deposits", "depositos")),
    ("journals",          ("journals", "asientos")),
    ("cashinvoices",      ("cashinvoices",)),
    ("cashreceipts",      ("cashreceipts",)),
    ("creditinvoices",    ("creditinvoices",)),
    ("salesdetailed",     ("salesdetailed", "salesdetail")),
    ("accounts",          ("accounts", "plancuentas")),
    ("customers",         ("customers", "clientes")),
]


def normalizar_nombre(stem):
    return re.sub(r"[^a-z0-9]", "", stem.lower())


def descubrir_archivos(raw_dir):
    """Clasifica los archivos del raw por recurso. Devuelve (mapa, ignorados)."""
    mapa = defaultdict(list)
    ignorados = []
    for p in sorted(raw_dir.iterdir()):
        if not p.is_file() or p.suffix not in (".json", ".jsonl"):
            if p.is_file():
                ignorados.append(p.name)
            continue
        stem = normalizar_nombre(p.stem)
        for recurso, claves in RECURSOS:
            if any(c in stem for c in claves):
                mapa[recurso].append(p)
                break
        else:
            ignorados.append(p.name)
    return mapa, ignorados


def desenvolver_registro(reg):
    """Desenvuelve envolturas a registros: {success,message,data} (API),
    {_id,data} (extraer-adm.py) y tuplas {Item1,Item2}."""
    if not isinstance(reg, dict):
        return []
    if isinstance(reg.get("data"), (dict, list)) and "ID" not in reg:
        d = reg["data"]
        if isinstance(d, dict) and isinstance(d.get("Item1"), list):
            return d["Item1"]
        if isinstance(d, list):
            return d
        if isinstance(d, dict):
            return [d]
        return []
    if isinstance(reg.get("Item1"), list) and "ID" not in reg:
        return reg["Item1"]
    return [reg]


def leer_archivo(path):
    regs = []
    if path.suffix == ".jsonl":
        with open(path, encoding="utf-8") as f:
            for num, linea in enumerate(f, 1):
                linea = linea.strip()
                if not linea:
                    continue
                try:
                    obj = json.loads(linea)
                except json.JSONDecodeError:
                    print(f"  AVISO: {path.name}:{num} no es JSON válido, se salta", file=sys.stderr)
                    continue
                if isinstance(obj, list):
                    for o in obj:
                        regs.extend(desenvolver_registro(o))
                else:
                    regs.extend(desenvolver_registro(obj))
    else:
        with open(path, encoding="utf-8") as f:
            obj = json.load(f)
        if isinstance(obj, list):
            for o in obj:
                regs.extend(desenvolver_registro(o))
        else:
            regs.extend(desenvolver_registro(obj))
    return regs


def tiene_detalle(reg):
    return bool(reg.get("Accounts")) or bool(reg.get("Items")) or bool(reg.get("Documents"))


def cargar_recurso(paths):
    """Fusiona todos los archivos de un recurso, dedupe por ID (gana el detalle)."""
    por_id = {}
    sueltos = []
    for p in paths:
        for reg in leer_archivo(p):
            if not isinstance(reg, dict):
                continue
            rid = reg.get("ID")
            if not rid:
                sueltos.append(reg)
                continue
            previo = por_id.get(rid)
            if previo is None:
                por_id[rid] = reg
            else:
                score_nuevo = (tiene_detalle(reg), len(reg))
                score_previo = (tiene_detalle(previo), len(previo))
                if score_nuevo > score_previo:
                    por_id[rid] = reg
    return list(por_id.values()) + sueltos


# ======================================================================
# UTILIDADES
# ======================================================================

def fecha(s):
    return s[:10] if isinstance(s, str) and len(s) >= 10 else None


def d2(x):
    try:
        return round(float(x), 2)
    except (TypeError, ValueError):
        return 0.0


def prefijo_doc(doc_id):
    m = re.match(r"^([A-Z]+)", doc_id or "")
    return m.group(1) if m else "?"


def tipo_ncf(ncf):
    m = re.match(r"^([A-Z]\d{2})", str(ncf or ""))
    return m.group(1) if m else None


def sin_acentos(s):
    return unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode()


def rango_fechas(fechas):
    fs = sorted(f for f in fechas if f)
    return [fs[0], fs[-1]] if fs else None


def activos(docs):
    """Filtra documentos anulados."""
    return [d for d in docs if not d.get("Void")]


def estimar_tokens(texto):
    return len(texto) // 4


# ======================================================================
# AGREGADO 1 — vendors-agg.jsonl
# ======================================================================

def agregar_vendors(vendors, bills, billpayments, faltantes):
    maestro = {v.get("ID"): v for v in vendors if v.get("ID")}

    # Pagos por proveedor: vía de pago, banco, y plazo por doc aplicado
    pagos_por_rel = defaultdict(list)
    for p in activos(billpayments):
        rel = p.get("RelationshipID")
        if rel:
            pagos_por_rel[rel].append(p)

    grupos = defaultdict(list)
    for b in activos(bills):
        rel = b.get("RelationshipID") or f"sin-rel:{b.get('Name')}"
        grupos[rel].append(b)

    con_detalle_global = 0
    lineas_salida = []
    for rel, docs in grupos.items():
        v = maestro.get(rel, {})
        # el detalle de la factura no trae Name: buscar en maestro y en
        # cualquier doc del grupo (Name/RelationshipName/Beneficiary)
        nombre = v.get("Name") or next(
            (b.get("Name") or b.get("RelationshipName") or b.get("Beneficiary")
             for b in docs
             if b.get("Name") or b.get("RelationshipName") or b.get("Beneficiary")),
            "?")
        rnc = v.get("FiscalID") or next(
            (b.get("FiscalID") for b in docs if b.get("FiscalID")), None)

        cuentas = defaultdict(lambda: {"n": 0, "monto": 0.0, "nombre": ""})
        monto_lineas = 0.0
        itbis_con = itbis_sin = sin_detalle = 0
        tasas = Counter()
        ret_docs = 0
        ret_monto = 0.0
        ncfs = Counter()
        docs_pref = Counter()
        total_moneda = defaultdict(float)

        for b in docs:
            docs_pref[prefijo_doc(b.get("DocID"))] += 1
            t = tipo_ncf(b.get("NCF"))
            if t:
                ncfs[t] += 1
            total_moneda[b.get("CurrencyID") or "?"] += d2(b.get("TotalAmount"))

            items = b.get("Items") or []
            lineas = [i for i in items if i.get("AccountCode") or i.get("AccountName")]
            origen_items = bool(lineas)
            if not lineas:
                # fallback: líneas contables al debe (excluye la contrapartida CxP)
                lineas = [a for a in (b.get("Accounts") or []) if d2(a.get("Debit")) > 0]
            if not lineas:
                sin_detalle += 1
                continue
            con_detalle_global += 1

            doc_itbis = 0.0
            doc_ret = 0.0
            for ln in lineas:
                cod = ln.get("AccountCode") or "?"
                monto = d2(ln.get("NetAmount")) if origen_items else d2(ln.get("Debit"))
                c = cuentas[cod]
                c["n"] += 1
                c["monto"] += abs(monto)
                c["nombre"] = ln.get("AccountName") or c["nombre"]
                monto_lineas += abs(monto)
                if origen_items:
                    doc_itbis += d2(ln.get("TaxAmount"))
                    doc_ret += d2(ln.get("TaxRetentionAmount"))
                    tp = d2(ln.get("TaxPercent"))
                    if tp:
                        tasas[f"{tp:g}"] += 1
            if origen_items:
                if doc_itbis > 0:
                    itbis_con += 1
                else:
                    itbis_sin += 1
                if doc_ret > 0:
                    ret_docs += 1
                    ret_monto += doc_ret

        # Retenciones aplicadas al pagar (vienen en los Documents del pago)
        pagos = pagos_por_rel.get(rel, [])
        plazos = []
        tipos_pago = Counter()
        bancos = Counter()
        for p in pagos:
            if p.get("PaymentTypeName"):
                tipos_pago[p["PaymentTypeName"]] += 1
            if p.get("BankAccountName"):
                bancos[p["BankAccountName"]] += 1
            fp = fecha(p.get("DocDate"))
            for ap in p.get("Documents") or []:
                r = d2(ap.get("TaxRetentionAmount_BasedTax")) + d2(ap.get("TaxRetentionAmount_BasedTotal"))
                if r > 0:
                    ret_monto += r
                fb = fecha(ap.get("DocDate"))
                if fp and fb:
                    delta = (datetime.fromisoformat(fp) - datetime.fromisoformat(fb)).days
                    if 0 <= delta <= 365:
                        plazos.append(delta)

        top_cuentas = sorted(cuentas.items(), key=lambda kv: -kv[1]["monto"])[:8]
        linea = {
            "proveedor": nombre,
            "rnc": rnc,
            "rel_id": rel if not rel.startswith("sin-rel:") else None,
            "n_facturas": len(docs),
            "rango": rango_fechas(fecha(b.get("DocDate")) for b in docs),
            "total": {k: d2(t) for k, t in sorted(total_moneda.items())},
            "docs": dict(docs_pref.most_common()),
            "cuentas": [
                {
                    "c": cod,
                    "n": inf["nombre"],
                    "lineas": inf["n"],
                    "pct_monto": round(100 * inf["monto"] / monto_lineas, 1) if monto_lineas else 0,
                }
                for cod, inf in top_cuentas
            ],
            "itbis": {"con": itbis_con, "sin": itbis_sin, "tasas": dict(tasas.most_common(3))},
            "retenciones": {"docs": ret_docs, "monto": d2(ret_monto)},
            "ncf": dict(ncfs.most_common(4)),
            "pagos": {
                "n": len(pagos),
                "tipos": dict(tipos_pago.most_common(3)),
                "bancos": dict(bancos.most_common(4)),
            },
            "plazo_medio_dias": round(sum(plazos) / len(plazos), 1) if plazos else None,
            "sin_detalle": sin_detalle,
            "ejemplos": [b.get("DocID") for b in docs[:3]],
        }
        lineas_salida.append(linea)

    lineas_salida.sort(key=lambda x: (-x["n_facturas"], x["proveedor"]))

    if bills and not con_detalle_global:
        faltantes.append("vendorbills sin líneas (solo headers): cuentas/ITBIS/retenciones quedan vacíos — falta el detalle de la Capa A")
    if not billpayments:
        faltantes.append("billpayments ausente: vía de pago y plazo medio quedan nulos")

    inactivos = len([v for v in vendors if v.get("ID") not in grupos])
    meta = {
        "generado": datetime.now().isoformat(timespec="seconds"),
        "proveedores_con_actividad": len(lineas_salida),
        "proveedores_maestro_sin_facturas": inactivos,
        "facturas_procesadas": len(activos(bills)),
        "facturas_con_detalle": con_detalle_global,
    }
    return lineas_salida, meta


# ======================================================================
# AGREGADO 2 — journals-agg.json
# ======================================================================

PATRONES_JOURNAL = [
    ("infotep", re.compile(r"infotep", re.I)),
    ("tss", re.compile(r"\btss\b", re.I)),
    ("nomina", re.compile(r"nomina|sueldo", re.I)),
]


def agregar_journals(journals, faltantes):
    grupos = defaultdict(list)
    sin_patron = []
    for j in activos(journals):
        ref = sin_acentos(f"{j.get('Reference') or ''} {j.get('Notes') or ''}")
        for nombre, rx in PATRONES_JOURNAL:
            if rx.search(ref):
                grupos[nombre].append(j)
                break
        else:
            sin_patron.append(j)

    def asiento_tipo(docs):
        """El ejemplar real más reciente que tenga líneas."""
        con_lineas = [d for d in docs if d.get("Accounts")]
        if not con_lineas:
            return None
        ej = max(con_lineas, key=lambda d: fecha(d.get("DocDate")) or "")
        return {
            "doc_id": ej.get("DocID"),
            "fecha": fecha(ej.get("DocDate")),
            "referencia": (ej.get("Reference") or "")[:60],
            "total": d2(ej.get("TotalAmount")),
            "lineas": [
                {
                    "c": a.get("AccountCode"),
                    "n": a.get("AccountName"),
                    "debe": d2(a.get("Debit")),
                    "haber": d2(a.get("Credit")),
                }
                for a in sorted(ej["Accounts"], key=lambda a: a.get("RowOrder") or 0)
            ],
        }

    patrones = {}
    algun_detalle = False
    for nombre, docs in sorted(grupos.items()):
        at = asiento_tipo(docs)
        algun_detalle = algun_detalle or at is not None
        patrones[nombre] = {
            "n_asientos": len(docs),
            "rango": rango_fechas(fecha(d.get("DocDate")) for d in docs),
            "total_sumado": d2(sum(d2(d.get("TotalAmount")) for d in docs)),
            "referencias_ejemplo": sorted({(d.get("Reference") or "")[:40] for d in docs})[:5],
            "asiento_tipo": at,
        }

    if journals and not algun_detalle and grupos:
        faltantes.append("journals sin líneas (solo headers): no hay asiento tipo — falta el detalle de la Capa A")

    return {
        "_meta": {
            "generado": datetime.now().isoformat(timespec="seconds"),
            "asientos_procesados": len(activos(journals)),
            "con_patron": sum(len(v) for v in grupos.values()),
            "sin_patron": len(sin_patron),
        },
        "patrones": patrones,
        "sin_patron": [
            {
                "doc_id": j.get("DocID"),
                "fecha": fecha(j.get("DocDate")),
                "referencia": (j.get("Reference") or "")[:60],
                "total": d2(j.get("TotalAmount")),
            }
            for j in sorted(sin_patron, key=lambda x: fecha(x.get("DocDate")) or "")
        ],
    }


# ======================================================================
# AGREGADO 3 — bancos-agg.json
# ======================================================================

def agregar_bancos(charges, transfers, cuentas_por_id, faltantes):
    cargos = defaultdict(lambda: {"n": 0, "monto": 0.0, "fechas": [], "ejemplos": []})
    sin_detalle = 0
    for c in activos(charges):
        banco = c.get("BankAccountName")
        if not banco:
            cta = cuentas_por_id.get(c.get("CashAccountID") or c.get("BankAccountID"))
            banco = (cta or {}).get("Name") or "?"
        lineas = c.get("Accounts") or []
        if not lineas:
            sin_detalle += 1
            lineas = [{"AccountCode": "?", "AccountName": "(sin detalle)", "Debit": c.get("TotalAmount")}]
        for ln in lineas:
            clave = (banco, ln.get("AccountCode") or "?", ln.get("AccountName") or "?")
            g = cargos[clave]
            g["n"] += 1
            g["monto"] += abs(d2(ln.get("Debit")) or d2(ln.get("NetAmount")))
            g["fechas"].append(fecha(c.get("DocDate")))
            if len(g["ejemplos"]) < 2:
                g["ejemplos"].append(c.get("DocID"))

    traspasos = defaultdict(lambda: {"n": 0, "monto": 0.0, "fechas": [], "ejemplos": []})
    for t in activos(transfers):
        origen = t.get("FromCashAccountName") or "?"
        destino = t.get("ToCashAccountName") or "?"
        if origen == "?" and destino == "?":
            # detalle: solo IDs
            origen = (cuentas_por_id.get(t.get("CashAccountID")) or {}).get("Name") or "?"
            destino = (cuentas_por_id.get(t.get("DebitAccountID")) or {}).get("Name") or "?"
        g = traspasos[(origen, destino)]
        g["n"] += 1
        g["monto"] += d2(t.get("TotalAmount"))
        g["fechas"].append(fecha(t.get("DocDate")))
        if len(g["ejemplos"]) < 2:
            g["ejemplos"].append(t.get("DocID"))

    if charges and sin_detalle == len(activos(charges)):
        faltantes.append("bankcharges sin líneas (solo headers): conceptos sin cuenta de gasto")

    return {
        "_meta": {
            "generado": datetime.now().isoformat(timespec="seconds"),
            "cargos_procesados": len(activos(charges)),
            "cargos_sin_detalle": sin_detalle,
            "traspasos_procesados": len(activos(transfers)),
            "nota": "el cruce banco<->ADM vive en conciliar-entradas.py; no se duplica aqui",
        },
        "cargos": [
            {
                "banco": banco,
                "cuenta": {"c": cod, "n": nom},
                "n": g["n"],
                "total": d2(g["monto"]),
                "rango": rango_fechas(g["fechas"]),
                "ejemplos": g["ejemplos"],
            }
            for (banco, cod, nom), g in sorted(cargos.items(), key=lambda kv: -kv[1]["monto"])
        ],
        "traspasos": [
            {
                "de": o,
                "a": dst,
                "n": g["n"],
                "total": d2(g["monto"]),
                "rango": rango_fechas(g["fechas"]),
                "ejemplos": g["ejemplos"],
            }
            for (o, dst), g in sorted(traspasos.items(), key=lambda kv: -kv[1]["monto"])
        ],
    }


# ======================================================================
# AGREGADO 4 — plan-cuentas.json
# ======================================================================

def contar_uso_cuentas(colecciones):
    """Cuenta líneas del histórico por AccountID y por AccountCode.

    Por documento usa las líneas contables (Accounts); cae a Items solo si no
    hay Accounts — así no se doble-cuenta el gasto que aparece en ambas."""
    uso_id = Counter()
    uso_cod = Counter()
    for docs in colecciones:
        for d in activos(docs):
            lineas = d.get("Accounts") or d.get("Items") or []
            for ln in lineas:
                if not isinstance(ln, dict):
                    continue
                if ln.get("AccountID"):
                    uso_id[ln["AccountID"]] += 1
                elif ln.get("AccountCode"):
                    uso_cod[ln["AccountCode"]] += 1
    return uso_id, uso_cod


def agregar_plan_cuentas(cuentas, uso_id, uso_cod, faltantes):
    por_id = {c.get("ID"): c for c in cuentas if c.get("ID")}

    salida = []
    for c in cuentas:
        padre = por_id.get(c.get("ParentAccountID"))
        flags = [
            nombre
            for campo, nombre in [
                ("RequireDepartment", "depto"),
                ("RequireProject", "proyecto"),
                ("RequireLocation", "localidad"),
                ("RequireDivision", "division"),
                ("RequireRelationship", "relacion"),
                ("RequireItemClass", "clase_articulo"),
            ]
            if c.get(campo)
        ]
        uso = uso_id.get(c.get("ID"), 0) + (uso_cod.get(c.get("Code"), 0) if c.get("Code") else 0)
        salida.append({
            "codigo": c.get("Code"),
            "nombre": c.get("Name"),
            "tipo": c.get("AccountTypeName"),
            "prefijo": c.get("Prefix"),
            "clase": c.get("AccountClassName"),
            "padre": (padre or {}).get("Code") or (padre or {}).get("Name"),
            "grupo": bool(c.get("GroupAccount")),
            "banco": bool(c.get("IsCashAccount")),
            "moneda": c.get("CurrencyID"),
            "inactiva": bool(c.get("Inactive")),
            "requiere": flags,
            "uso_lineas": uso,
        })

    salida.sort(key=lambda x: (x["codigo"] is None, x["codigo"] or "", x["nombre"] or ""))
    usadas = len([c for c in salida if c["uso_lineas"]])
    return {
        "_meta": {
            "generado": datetime.now().isoformat(timespec="seconds"),
            "n_cuentas": len(salida),
            "cuentas_con_uso": usadas,
            "cuentas_sin_uso": len(salida) - usadas,
        },
        "cuentas": salida,
    }


# ======================================================================
# AGREGADO 5 — ventas-agg.json
# ======================================================================

def resumen_forma(docs):
    docs = activos(docs)
    por_mes = defaultdict(lambda: {"n": 0, "monto": 0.0})
    ncfs = Counter()
    total_moneda = defaultdict(float)
    for d in docs:
        f = fecha(d.get("DocDate"))
        if f:
            m = por_mes[f[:7]]
            m["n"] += 1
            m["monto"] += d2(d.get("TotalAmount"))
        t = tipo_ncf(d.get("NCF"))
        if t:
            ncfs[t] += 1
        total_moneda[d.get("CurrencyID") or "?"] += d2(d.get("TotalAmount"))
    return {
        "n_docs": len(docs),
        "rango": rango_fechas(fecha(d.get("DocDate")) for d in docs),
        "total": {k: d2(v) for k, v in sorted(total_moneda.items())},
        "ncf_tipos": dict(ncfs.most_common()),
        "por_mes": {m: {"n": v["n"], "monto": d2(v["monto"])} for m, v in sorted(por_mes.items())},
    }


def agregar_ventas(fuentes):
    ventas = {
        "_meta": {
            "generado": datetime.now().isoformat(timespec="seconds"),
            "nota": "solo estadistica de forma: ventas se destila como contexto, no como dominio autonomo",
        }
    }
    for nombre, docs in fuentes.items():
        if docs:
            ventas[nombre] = resumen_forma(docs)
    return ventas


# ======================================================================
# MAIN
# ======================================================================

def main():
    ap = argparse.ArgumentParser(description="Capa B: agrega el raw del preentrenamiento (0 tokens, 0 red)")
    ap.add_argument("--raw", default="/opt/data/preentrenamiento/raw", help="directorio de entrada")
    ap.add_argument("--out", default="/opt/data/preentrenamiento/agg", help="directorio de salida")
    ap.add_argument("--dry-run", action="store_true", help="procesa y reporta sin escribir archivos")
    args = ap.parse_args()

    raw_dir = Path(args.raw)
    out_dir = Path(args.out)
    if not raw_dir.is_dir():
        print(f"ERROR: no existe el directorio raw: {raw_dir}", file=sys.stderr)
        sys.exit(1)

    mapa, ignorados = descubrir_archivos(raw_dir)
    print(f"Raw: {raw_dir}")
    datos = {}
    for recurso, _ in RECURSOS:
        paths = mapa.get(recurso, [])
        if paths:
            datos[recurso] = cargar_recurso(paths)
            detalle = sum(1 for d in datos[recurso] if tiene_detalle(d))
            print(f"  {recurso:18} {len(datos[recurso]):>5} docs ({detalle} con detalle) <- {', '.join(p.name for p in paths)}")
        else:
            datos[recurso] = []
    if ignorados:
        print(f"  ignorados: {', '.join(ignorados[:10])}")

    faltantes = [f"{r} ausente en raw" for r, _ in RECURSOS if not datos[r]
                 and r not in ("customers", "salesdetailed", "deposits")]

    # --- agregaciones ---
    vendors_lineas, vendors_meta = agregar_vendors(
        datos["vendors"], datos["vendorbills"], datos["billpayments"], faltantes)
    journals_agg = agregar_journals(datos["journals"], faltantes)

    cuentas_por_id = {c.get("ID"): c for c in datos["accounts"] if c.get("ID")}
    bancos_agg = agregar_bancos(datos["bankcharges"], datos["bankbanktransfers"], cuentas_por_id, faltantes)

    uso_id, uso_cod = contar_uso_cuentas([
        datos["vendorbills"], datos["journals"], datos["bankcharges"],
        datos["billpayments"], datos["accountpayments"], datos["deposits"],
        datos["cashinvoices"], datos["cashreceipts"], datos["creditinvoices"],
    ])
    plan_agg = agregar_plan_cuentas(datos["accounts"], uso_id, uso_cod, faltantes) if datos["accounts"] else None

    ventas_agg = agregar_ventas({
        "cash_invoices": datos["cashinvoices"],
        "cash_receipts": datos["cashreceipts"],
        "credit_invoices": datos["creditinvoices"],
        "sales_detailed": datos["salesdetailed"],
    })

    vendors_meta["faltantes"] = faltantes
    for agg in (journals_agg, bancos_agg, ventas_agg):
        agg["_meta"]["faltantes"] = faltantes
    if plan_agg:
        plan_agg["_meta"]["faltantes"] = faltantes

    # --- tamaño de los agregados de proveedor (objetivo 300-600 tokens) ---
    tamanos = sorted(estimar_tokens(json.dumps(l, ensure_ascii=False)) for l in vendors_lineas)
    if tamanos:
        mediana = tamanos[len(tamanos) // 2]
        print(f"\nProveedores: {len(vendors_lineas)} lineas; tokens/linea mediana ~{mediana}, max ~{tamanos[-1]}")

    print("Faltantes:", "; ".join(faltantes) if faltantes else "ninguno")

    if args.dry_run:
        print("\n--dry-run: no se escribe nada. Ejemplo de agregado de proveedor:")
        if vendors_lineas:
            print(json.dumps(vendors_lineas[0], ensure_ascii=False, indent=2))
        return

    out_dir.mkdir(parents=True, exist_ok=True)

    with open(out_dir / "vendors-agg.jsonl", "w", encoding="utf-8") as f:
        f.write(json.dumps({"_meta": vendors_meta}, ensure_ascii=False) + "\n")
        for linea in vendors_lineas:
            f.write(json.dumps(linea, ensure_ascii=False) + "\n")

    escritos = ["vendors-agg.jsonl"]
    for nombre, contenido in [
        ("journals-agg.json", journals_agg),
        ("bancos-agg.json", bancos_agg),
        ("plan-cuentas.json", plan_agg),
        ("ventas-agg.json", ventas_agg),
    ]:
        if contenido is None:
            print(f"  SALTADO {nombre} (falta su fuente en raw)")
            continue
        with open(out_dir / nombre, "w", encoding="utf-8") as f:
            json.dump(contenido, f, ensure_ascii=False, indent=1)
        escritos.append(nombre)

    print(f"\nEscritos en {out_dir}: {', '.join(escritos)}")


if __name__ == "__main__":
    main()
