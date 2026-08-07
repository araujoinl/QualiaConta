#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verificar-corte.sh — el candado de la partición angosta de la mesa.
#
# Qué demuestra, con dos afirmaciones y nada más:
#
#   1. DURO — `libro.md` y `registro.md` son extractos VERBATIM de `manual.md`:
#      cada uno se arma pegando tramos contiguos de él, sin una palabra escrita
#      de nuevo. Lo único propio de cada archivo es su encabezado. Esta es la
#      invariante que tiene que valer SIEMPRE, incluso después de que alguien
#      edite el manual: si se toca una regla, se re-corta, y el candado avisa.
#
#   2. INFORMATIVO — cuánto se despegó `manual.md` del SKILL.md que el contable
#      leía antes del corte. Al publicar tiene que ser CERO; después, cada
#      diferencia es una edición deliberada y se imprime para que se vea. No
#      falla: un manual congelado para siempre no es un manual.
#
# Por qué así y no como antes: la versión ancha del corte necesitaba un
# manifiesto de rangos y una lista blanca de diferencias, y toda edición
# legítima de una rama la invalidaba — un candado que hay que re-ratificar a
# cada rato termina apagado. Éste no tiene datos que mantener: alinea los
# archivos contra el original y listo.
#
# Uso:  bash mesa/verificar-corte.sh [SKILL.md-original] [dir-del-skill]
#       (por default /tmp/SKILL-original.md y skills/mesa-de-trabajo del repo)
# ---------------------------------------------------------------------------
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORIGINAL="${1:-/tmp/SKILL-original.md}"
SKILLDIR="${2:-$REPO/skills/mesa-de-trabajo}"

if [ ! -f "$ORIGINAL" ]; then
  echo "ERROR: no encuentro el SKILL.md original en $ORIGINAL" >&2
  echo "       pasalo como primer argumento, o dejalo en /tmp/SKILL-original.md" >&2
  exit 2
fi

exec python3 - "$ORIGINAL" "$SKILLDIR" <<'PYEOF'
# -*- coding: utf-8 -*-
import sys
from pathlib import Path

ORIGINAL, SKILLDIR = Path(sys.argv[1]), Path(sys.argv[2])
texto_original = ORIGINAL.read_text(encoding="utf-8")
orig = texto_original.split("\n")
ref = SKILLDIR / "references"
fallos = []


def fallar(titulo, cuerpo=""):
    fallos.append((titulo, cuerpo))


MAX_ENCABEZADO = 8   # tope duro: el encabezado propio no es un lugar donde escribir


def sin_titulo(lineas, original):
    """Separa el encabezado propio del archivo del cuerpo extraído.

    El encabezado es el H1 más, si lo hay, el aviso de que esto es un extracto y
    dónde está el manual entero. Se reconoce por lo que NO es: líneas que no
    existen en el original. Se corta a las 8 para que nadie use el encabezado
    como puerta trasera para escribir prosa nueva, y se imprime siempre — lo que
    no se ve, no está verificado.
    """
    if not lineas or not lineas[0].startswith("# "):
        return None, lineas
    en_original = set(original)
    i = 1
    while (i < len(lineas) and i <= MAX_ENCABEZADO
           and (lineas[i] == "" or lineas[i] not in en_original)):
        i += 1
    return lineas[:i], lineas[i:]


def tramos(extracto, original):
    """Descompone el extracto en tramos contiguos del original.

    Devuelve (tramos, huerfanas): cada tramo es (desde, hasta) en líneas 1-based
    del original; huerfanas son las líneas del extracto que no se pudieron
    ubicar. Avanza greedy: desde cada posición busca el arranque que dé la
    corrida más larga. Una línea en blanco no ancla nada —aparece mil veces—,
    así que se saltea.
    """
    salida, huerfanas, i = [], [], 0
    indice = {}
    for n, l in enumerate(original):
        indice.setdefault(l, []).append(n)
    while i < len(extracto):
        if extracto[i].strip() == "":
            i += 1
            continue
        mejor_ini = mejor_largo = 0
        for arranque in indice.get(extracto[i], []):
            k = 0
            while (i + k < len(extracto) and arranque + k < len(original)
                   and extracto[i + k] == original[arranque + k]):
                k += 1
            if k > mejor_largo:
                mejor_largo, mejor_ini = k, arranque
        if not mejor_largo:
            huerfanas.append((i + 1, extracto[i]))
            i += 1
            continue
        salida.append((mejor_ini + 1, mejor_ini + mejor_largo))
        i += mejor_largo
    return salida, huerfanas


print(f"original : {ORIGINAL}  ({len(orig)} líneas, {len(texto_original):,} chars)")
print(f"corte    : {SKILLDIR}")
print()

# --- 1. cuánto se despegó el manual del archivo pre-corte (informativo) ------
manual_p = ref / "manual.md"
manual_cuerpo = []
if not manual_p.exists():
    fallar("Falta references/manual.md — sin él no hay a qué caer cuando el turno es contable")
else:
    h1, cuerpo = sin_titulo(manual_p.read_text(encoding="utf-8").split("\n"), orig)
    if h1 is None:
        fallar("references/manual.md no arranca con un título H1 propio")
    cierre = next(i for i, l in enumerate(orig[1:], 1) if l.strip() == "---")
    esperado = orig[cierre + 1:]
    while esperado and esperado[0] == "":
        esperado.pop(0)
    manual_cuerpo = cuerpo
    a = "\n".join(cuerpo).rstrip("\n")
    b = "\n".join(esperado).rstrip("\n")
    if a == b:
        print(f"  OK  manual.md      = el SKILL.md viejo entero, byte por byte ({len(b):,} chars)")
    else:
        import difflib
        d = [x for x in difflib.unified_diff(b.split("\n"), a.split("\n"),
                                             "pre-corte", "manual.md", lineterm="", n=0)
             if x[:1] in "+-" and x[:3] not in ("+++", "---")]
        print(f"  ··  manual.md      se despegó del archivo pre-corte en "
              f"{len(d)} renglón(es) — ediciones deliberadas, se listan abajo:")
        for x in d[:20]:
            print(f"        {x[:118]}")

# --- 2. los extractos son verbatim -------------------------------------------
for nombre in ("libro.md", "registro.md"):
    p = ref / nombre
    if not p.exists():
        fallar(f"Falta references/{nombre}")
        continue
    h1, cuerpo = sin_titulo(p.read_text(encoding="utf-8").split("\n"), manual_cuerpo)
    if h1 is None:
        fallar(f"references/{nombre} no arranca con un título H1 propio")
    tr, huerfanas = tramos(cuerpo, manual_cuerpo)
    if huerfanas:
        fallar(f"references/{nombre} tiene texto que NO está en manual.md "
               f"({len(huerfanas)} línea(s)) — se mueve, no se escribe",
               "\n".join(f"  {nombre}:{n}  {l[:110]}" for n, l in huerfanas[:12]))
    else:
        chars = len(p.read_text(encoding="utf-8"))
        print(f"  OK  {nombre:14s} = {len(tr)} tramo(s) verbatim de manual.md "
              f"({chars:,} chars, {100 * chars / len(texto_original):.0f}% del manual)")
        print(f"      líneas {' · '.join(f'{x}-{y}' for x, y in tr)}")
        for l in [x for x in h1 if x.strip()]:
            print(f"      propio: {l[:100]}")

# --- 3. no hay archivos de más ------------------------------------------------
sobran = sorted(p.name for p in ref.glob("*.md")
                if p.name not in ("manual.md", "libro.md", "registro.md"))
if sobran:
    fallar("Hay archivos en references/ que el router no rutea — Hermes se los lista "
           "al contable al pie del skill, así que un archivo huérfano es un "
           "procedimiento que alguien va a leer sin que nadie se lo haya dado",
           "\n".join(f"  {n}" for n in sobran))

print()
if fallos:
    for titulo, cuerpo in fallos:
        print(f"✗ {titulo}")
        if cuerpo:
            print(cuerpo)
        print()
    print(f"El corte NO cierra. {len(fallos)} problema(s).")
    sys.exit(1)
print("✓ Los dos extractos son tajadas verbatim del manual.")
PYEOF
