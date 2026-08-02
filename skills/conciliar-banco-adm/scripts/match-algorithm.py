#!/usr/bin/env python3
"""
Algoritmo de cruce banco ↔ ADM Cloud para conciliación.

Cruza por RONDAS de prioridad (no single-pass greedy) para evitar que un
match cercano "robe" el lugar de un match exacto que aparece después.

Uso:
    from match_algorithm import normalize_name, names_match, run_match

    matched, unmatched_bank, unmatched_adm = run_match(bank_txs, adm_txs)
"""

import re
import unicodedata
from datetime import datetime


def normalize_name(name: str) -> str:
    """Normaliza un nombre de cliente/banco para comparación fuzzy.

    1. Quita tildes
    2. Lowercase
    3. Quita sufijos legales (S.A., SRL, SAS, Corp, Inc, Ltda)
    4. Quita palabras comunes del banco (transferencia, recibida, etc.)
    5. Quita números
    6. Limpia espacios
    """
    if not name or not name.strip():
        return ""
    # 1. Tildes
    name = unicodedata.normalize("NFD", name)
    name = name.encode("ascii", "ignore").decode("ascii")
    # 2. Lowercase
    name = name.lower().strip()
    # 3. Sufijos legales
    name = re.sub(
        r"\b(s\.?\s*a\.?\s*s?|s\.?\s*r\.?\s*l?|srl|sas|sa|s\.a\.?|"
        r"c\.?\s*por\s*a\.?|corporation|corp|inc|ltda|company|co)\b",
        "",
        name,
    )
    # 4. Palabras del banco
    name = re.sub(
        r"\b(transferencia|recibida|de|env|dev|por|factura|vencidas|"
        r"credito|debito|ach|lbtr|fen|imp|comision|transf)\b",
        "",
        name,
    )
    # 5. Números
    name = re.sub(r"\d+", "", name)
    # 6. Limpiar
    name = re.sub(r"[^a-z\s]", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name


def names_match(bank_desc: str, adm_name: str) -> bool:
    """Compara dos nombres normalizados. True si hay overlap suficiente."""
    bn = normalize_name(bank_desc)
    an = normalize_name(adm_name)
    if not bn or not an:
        return False
    if bn == an:
        return True
    if bn in an or an in bn:
        return True
    # Palabras distintivas compartidas
    bn_words = set(w for w in bn.split() if len(w) > 2)
    an_words = set(w for w in an.split() if len(w) > 2)
    if bn_words and an_words and (bn_words & an_words):
        return True
    return False


def date_diff(d1: str, d2: str) -> int:
    """Diferencia en días entre dos fechas YYYY-MM-DD."""
    try:
        return abs(
            (
                datetime.strptime(d1, "%Y-%m-%d")
                - datetime.strptime(d2, "%Y-%m-%d")
            ).days
        )
    except (ValueError, TypeError):
        return 999


COMISION_TARJETA = 0.05395
PATRON_TARJETA = "servicios digita"


def is_credit_card(desc: str) -> bool:
    """Detecta pagos de tarjeta de crédito (vía 'Servicios Digita')."""
    return PATRON_TARJETA in (desc or "").lower()


def revertir_comision(monto_neto: float) -> float:
    """Revierte la comisión del 5.395% para obtener el monto original.

    El banco descuenta la comisión antes de depositar. Para conciliar contra
    ADM (que tiene el monto original de la factura), hay que revertirla:

        monto_original = monto_banco / (1 - 0.05395)

    Ejemplo: banco=6,663.31 → original=7,043.30 → ADM=7,043.29
    """
    return monto_neto / (1 - COMISION_TARJETA)


def run_match(bank_txs: list, adm_txs: list):
    """
    Cruza transacciones del banco contra ADM por rondas de prioridad.

    Cada tx de bank_txs debe tener: fecha, monto, descripcion.
    Opcionalmente: is_credit_card (bool), monto_original (float).
    Si no tiene is_credit_card, se detecta automáticamente.
    Cada tx de adm_txs debe tener: fecha, monto, descripcion (o cliente).

    El algoritmo corre 8 rondas: 5 para transacciones normales y 3 para
    tarjetas de crédito (usando el monto original con comisión revertida,
    sin nombre porque el banco dice "Servicios Digita").

    Devuelve: (matched, unmatched_bank, unmatched_adm)
    donde matched es una lista de {"bank": ..., "adm": ...}.
    """
    # Asegurar que cada tx tenga los campos de tarjeta
    for bt in bank_txs:
        if "is_credit_card" not in bt:
            bt["is_credit_card"] = is_credit_card(bt.get("descripcion", ""))
        if "monto_original" not in bt:
            bt["monto_original"] = (
                revertir_comision(bt["monto"]) if bt["is_credit_card"] else bt["monto"]
            )

    used_bank = set()
    used_adm = set()
    matched = []

    def try_round(amt_fn, max_days, require_name=False, use_original=False):
        """Una ronda de matching. amt_fn(diff, target) -> bool."""
        for bi, bt in enumerate(bank_txs):
            if bi in used_bank:
                continue
            # Tarjetas solo participan en rondas use_original
            if bt["is_credit_card"] and not use_original:
                continue
            compare = bt["monto_original"] if bt["is_credit_card"] else bt["monto"]
            target = abs(compare)
            best = None
            best_dd = 999
            best_ad = 999

            for ai, at in enumerate(adm_txs):
                if ai in used_adm:
                    continue
                amt_diff = abs(target - abs(at["monto"]))
                if not amt_fn(amt_diff, target):
                    continue
                dd = date_diff(bt["fecha"], at["fecha"])
                if dd > max_days:
                    continue
                # Name matching solo para no-tarjetas
                if require_name and not bt["is_credit_card"]:
                    if not names_match(
                        bt.get("descripcion", ""), at.get("descripcion", "")
                    ):
                        continue
                if dd < best_dd or (dd == best_dd and amt_diff < best_ad):
                    best_dd = dd
                    best_ad = amt_diff
                    best = ai

            if best is not None:
                used_bank.add(bi)
                used_adm.add(best)
                matched.append({"bank": bt, "adm": adm_txs[best]})

    # --- Rondas normales (5) ---
    # Ronda 1: monto exacto + mismo nombre + fecha ±10
    try_round(lambda d, t: d < 0.50, 10, require_name=True)
    # Ronda 2: monto exacto sin nombre + fecha ±7
    try_round(lambda d, t: d < 0.50, 7)
    # Ronda 3: monto cercano (<0.5%) + mismo nombre + fecha ±7
    try_round(lambda d, t: t > 0 and d / t < 0.005, 7, require_name=True)
    # Ronda 4: monto cercano (<0.5%) sin nombre + fecha ±5
    try_round(lambda d, t: t > 0 and d / t < 0.005, 5)
    # Ronda 5: monto fuzzy (<1%) + mismo nombre + fecha ±5
    try_round(lambda d, t: t > 0 and d / t < 0.01, 5, require_name=True)

    # --- Rondas tarjetas (3) — monto original, sin nombre ---
    # Ronda 6: monto original exacto + fecha ±10
    try_round(lambda d, t: d < 1.00, 10, use_original=True)
    # Ronda 7: monto original cercano (<0.5%) + fecha ±7
    try_round(lambda d, t: t > 0 and d / t < 0.005, 7, use_original=True)
    # Ronda 8: monto original fuzzy (<1%) + fecha ±5
    try_round(lambda d, t: t > 0 and d / t < 0.01, 5, use_original=True)

    unmatched_bank = [bank_txs[i] for i in range(len(bank_txs)) if i not in used_bank]
    unmatched_adm = [adm_txs[i] for i in range(len(adm_txs)) if i not in used_adm]

    return matched, unmatched_bank, unmatched_adm
