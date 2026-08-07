#!/usr/bin/env python3
"""Genera los dos extractos mecánicos a partir de `references/manual.md`.

Los extractos NO se editan a mano. Se declaran acá como una lista de anclas —el
primer y el último renglón de cada tramo— y el script los recorta del manual
verbatim. Así, cuando alguien corrija una regla, la corrige en UN lugar (el
manual) y vuelve a correr esto; `mesa/verificar-corte.sh` comprueba después que
lo publicado sigue siendo tajadas exactas.

Las anclas son texto, no números de línea, a propósito: un rango numérico se
pudre en cuanto alguien agrega un párrafo arriba, y se pudre en silencio.

    python3 mesa/cortar-extractos.py
"""

import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
REF = RAIZ / "skills/mesa-de-trabajo/references"

AVISO = (
    "> Esto es un EXTRACTO verbatim del manual, armado para este trabajo.\n"
    "> Si un renglón te manda a una sección que no está acá, no la inventes:\n"
    "> `cat /opt/data/skills/qualiaconta/mesa-de-trabajo/references/manual.md`\n"
)

# (primera línea del tramo, última línea del tramo). Ambas EXACTAS.
PROLOGO   = ("# La mesa de trabajo",
             "con la diferencia exacta y tu hipótesis. El humano tiene el papel a un click.")
PREGUNTA  = ("   ¿Te falta algo para decidir? Preguntá y esperá:",
             "```")
LIBRO     = ("  Escribí la entrada en tu libro de acción — archivo NUEVO en",
             "  criterios.md) para no volver a preguntar lo mismo.")
ADM       = ("  **REGISTRÁ EN ADM CLOUD.** Encendido el 2026-08-02 con la primera factura real",
             "  evidencia» la da el CHECK de la base, no la atomicidad.")
MOT_LIBRO = ("## Si el motivo es `escribir_libro`",
             "  sin documento es peor que ninguna.")
MOT_REG   = ("## Si el motivo es `registro_pendiente`",
             "el `error_detalle` es lo que lo hace visible en la web.")
REGLAS    = ("## Reglas", None)          # None = hasta el final del manual

EXTRACTOS = {
    "libro.md": (
        "# Escribir el libro — la fila ya está registrada en ADM y le falta su entrada.",
        [PROLOGO, LIBRO, MOT_LIBRO, REGLAS],
    ),
    "registro.md": (
        "# Registrar en ADM — la fila está aprobada y el poller no pudo registrarla.",
        [PROLOGO, PREGUNTA, LIBRO, ADM, MOT_REG, REGLAS],
    ),
}


def ubicar(lineas, ancla, desde=0):
    """Índice de una línea exacta. Si aparece dos veces, es un ancla mala."""
    hits = [i for i, l in enumerate(lineas) if i >= desde and l == ancla]
    if not hits:
        sys.exit(f"ancla no encontrada en manual.md: {ancla!r}")
    return hits[0]


def main():
    manual_p = REF / "manual.md"
    manual = manual_p.read_text(encoding="utf-8").split("\n")
    # el H1 propio del manual no se recorta nunca
    cuerpo_ini = 1

    for nombre, (titulo, tramos) in EXTRACTOS.items():
        piezas, cursor = [], cuerpo_ini
        for primera, ultima in tramos:
            a = ubicar(manual, primera, cursor)
            b = len(manual) - 1 if ultima is None else ubicar(manual, ultima, a)
            piezas.append("\n".join(manual[a:b + 1]).strip("\n"))
            cursor = b + 1
        texto = titulo + "\n\n" + AVISO + "\n" + "\n\n".join(piezas) + "\n"
        (REF / nombre).write_text(texto, encoding="utf-8")
        print(f"{nombre:14s} {len(texto):7,} chars  {len(tramos)} tramos")


if __name__ == "__main__":
    main()
