#!/usr/bin/env python3
"""Aplica el cierre de un turno de la mesa — eventos + propuesta + estado — en
UNA transacción y una sola llamada de herramienta.

El mismo motivo que leer-contexto.sh: cada tool call re-paga el prompt entero
contra la cuota de z.AI. El protocolo viejo cerraba con 3-6 psql sueltos
(evento de plan, propuesta, evento de estado…); esto es un archivo JSON y una
corrida. Y de paso mata una trampa que ya mordió DOS veces: el UPDATE cuyo
guard no matchea escribe «UPDATE 0» sin fallar y el turno sigue como si
hubiera cerrado — acá, cero filas es un ERROR que se ve, y la transacción
entera se revierte (los eventos no quedan huérfanos de su cambio de estado).

Uso:
    aplicar-propuesta.py <archivo.json>     # o '-' para stdin

Forma del JSON:
    {
      "trabajo_id": "<uuid>",
      "eventos": [{"tipo": "progreso|pregunta|nota", "contenido": "..."}],
      "estado": "propuesta" | "esperando_respuesta" | "error" | null,
      "resumen": "...",              // solo con estado=propuesta
      "propuesta": {...},            // solo con estado=propuesta (jsonb entero)
      "error_detalle": "..."         // solo con estado=error
    }

`estado: null` (u omitido) = solo eventos, sin tocar la fila. Los guards son
los del contrato de la mesa y no se eligen: propuesta exige venir de
`analizando`; esperando_respuesta, de `analizando` o `aprobada` (la transición
habilitada el 2026-08-07); error, de cualquier estado no terminal.
"""
import json
import os
import re
import subprocess
import sys


def morir(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


def env(nombre):
    v = os.environ.get(nombre)
    if not v:
        morir("falta la variable de entorno %s" % nombre)
    return v


GUARDS = {
    "propuesta": "('analizando')",
    "esperando_respuesta": "('analizando','aprobada')",
    "error": "('pendiente','analizando','propuesta','esperando_respuesta','aprobada')",
}
TIPOS_EVENTO = {"progreso", "pregunta", "nota", "estado"}


def main():
    if len(sys.argv) != 2:
        morir("uso: aplicar-propuesta.py <archivo.json | ->")
    crudo = sys.stdin.read() if sys.argv[1] == "-" else open(sys.argv[1], encoding="utf-8").read()
    try:
        d = json.loads(crudo)
    except ValueError as e:
        morir("JSON ilegible: %s" % e)

    tid = str(d.get("trabajo_id") or "")
    if not re.fullmatch(r"[0-9a-f-]{36}", tid):
        morir("trabajo_id invalido: no es un UUID")
    estado = d.get("estado")
    if estado is not None and estado not in GUARDS:
        morir("estado '%s' no existe en este script: los que cambian por acá "
              "son %s (aprobada/rechazada son del humano, registrada del "
              "registro)" % (estado, ", ".join(sorted(GUARDS))))
    eventos = d.get("eventos") or []
    for e in eventos:
        if not isinstance(e, dict) or e.get("tipo") not in TIPOS_EVENTO \
           or not str(e.get("contenido") or "").strip():
            morir("evento invalido: %s" % json.dumps(e, ensure_ascii=False)[:120])
    if estado == "propuesta" and (not d.get("propuesta") or not d.get("resumen")):
        morir("estado=propuesta exige 'propuesta' y 'resumen' (contrato de la mesa)")
    if estado == "error" and not str(d.get("error_detalle") or "").strip():
        morir("estado=error exige error_detalle legible: un trabajo mudo es un "
              "trabajo perdido")

    # UNA transacción (-1): si el UPDATE no matchea, el RAISE la revierte
    # entera y ni los eventos quedan. psql interpola con :'var' — ningún valor
    # del turno se concatena en el texto del SQL.
    partes = []
    variables = {"id": tid, "emp": env("QUALIA_EMPRESA_ID")}
    for i, e in enumerate(eventos):
        variables["ev%d" % i] = e["contenido"]
        variables["tp%d" % i] = e["tipo"]
        partes.append(
            "insert into qualia_eventos (trabajo_id, autor, tipo, contenido) "
            "values (:'id', 'contable', :'tp%d', :'ev%d');" % (i, i))
    if estado:
        sets = ["estado = :'nuevo'"]
        variables["nuevo"] = estado
        if estado == "propuesta":
            variables["prop"] = json.dumps(d["propuesta"], ensure_ascii=False)
            variables["res"] = str(d["resumen"])
            sets += ["propuesta = :'prop'::jsonb", "resumen = :'res'"]
        if estado == "error":
            variables["det"] = str(d["error_detalle"])
            sets.append("error_detalle = :'det'")
        # El candado contra la trampa del UPDATE 0: el SELECT ... FOR UPDATE
        # verifica el guard Y bloquea la fila; si no matchea, el \gset de psql
        # falla con "no rows returned" y ON_ERROR_STOP + -1 revierten TODO,
        # eventos incluidos. (No un CASE con 1/0: el planner de Postgres
        # constant-foldea la división y revienta aunque la rama esté muerta.)
        partes.append("""
select id as fila_guard from qualia_trabajos
 where id = :'id' and empresa_id = :'emp'
   and estado in %s
 for update;
\\gset guard_
update qualia_trabajos set %s
 where id = :'id' and empresa_id = :'emp';""" % (GUARDS[estado], ", ".join(sets)))

    consulta = "\n".join(partes)
    cmd = ["psql", env("QUALIA_DSN"), "-X", "-q", "-t", "-A", "-1",
           "-v", "ON_ERROR_STOP=1"]
    for k, v in variables.items():
        cmd += ["-v", "%s=%s" % (k, v)]
    r = subprocess.run(cmd, input=consulta, capture_output=True, text=True)
    if r.returncode != 0:
        err = r.stderr.strip()[:300]
        if "no rows returned" in err:
            morir("NADA SE ESCRIBIO: el guard de estado no matcheo — la fila "
                  "ya no esta en %s. Releé el contexto (leer-contexto.sh) "
                  "antes de decidir." % GUARDS.get(estado))
        morir("la transaccion fallo (nada se escribio): %s" % err)

    print("APLICADO: %d evento(s)%s" % (
        len(eventos), (", estado→%s" % estado) if estado else ", sin cambio de estado"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
