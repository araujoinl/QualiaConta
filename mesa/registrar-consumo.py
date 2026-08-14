#!/usr/bin/env python3
"""Guarda el consumo diario del contable antes de que la rotación se lo lleve.

Por qué existe: Hermes ya escribe por cada llamada la línea con todo lo que hace
falta —`API call #15: model=… in=52943 out=124 total=53067 latency=6.4s
cache=52544/52943 (99%)`— pero `agent.log` rota y conserva UNA sola generación.
Al 2026-08-14 el histórico anterior al 03-ago ya no existía: los datos se
generaban y se tiraban, y cualquier pregunta sobre la tendencia del costo se
contestaba de oído. `mesa/medir-turnos.py` sabe hacer el análisis fino, pero se
corre a mano y sobre lo que quede en el log — no sirve de memoria.

Esto NO analiza: acumula. Una fila por día, apendeada a un TSV que no rota, para
que dentro de seis meses se pueda mirar la curva. El análisis sigue siendo de
`medir-turnos.py`, que ahora tiene de dónde leer.

Sin tabla nueva a propósito: guardar esto en la base sería crear una tabla, y
eso lo decide Carlos. Un TSV en el disco resuelve el problema de hoy —no perder
la historia— sin tocar el esquema.

Idempotente. Recalcula los días que todavía están en el log y conserva los que
ya no están: correrlo dos veces el mismo día actualiza la fila de hoy en vez de
duplicarla, y correrlo después de una rotación no borra lo viejo.

Uso:
    registrar-consumo.py                      # lee del contenedor y acumula
    registrar-consumo.py --salida /otro.tsv
    registrar-consumo.py --ver                # muestra lo acumulado y no escribe

Cron: 50 23 * * *  (justo antes de medianoche UTC, con el día casi completo)
"""
import argparse
import os
import re
import statistics
import subprocess
import sys

CONTENEDOR = os.environ.get("QUALIA_CONTENEDOR", "qualiaconta-blackbox")
LOGS = ("/opt/data/logs/agent.log.1", "/opt/data/logs/agent.log")
SALIDA = os.environ.get("QUALIA_CONSUMO_TSV", "/home/codebox/qualia-consumo.tsv")

COLUMNAS = ["fecha", "llamadas", "tokens_in", "tokens_out",
            "cache_pct", "latencia_p50", "latencia_p90", "proveedores"]

# `in=` y `out=` son obligatorios; `cache=` no aparece en todas las líneas (la
# de OpenRouter sin caché no lo trae), así que va aparte y opcional.
LINEA = re.compile(
    r"^(?P<fecha>\d{4}-\d{2}-\d{2})\s.*?API call #\d+:.*?"
    r"provider=(?P<prov>\S+).*?"
    r"\bin=(?P<in>\d+)\s+out=(?P<out>\d+)\b.*?"
    r"latency=(?P<lat>[\d.]+)s"
)
CACHE = re.compile(r"cache=(?P<hit>\d+)/(?P<tot>\d+)")


def leer_logs():
    """Las líneas de los dos logs del contenedor. El log viejo primero, que es
    como quedan en orden cronológico."""
    cmd = ["docker", "exec", CONTENEDOR, "sh", "-lc",
           "cat " + " ".join(LOGS) + " 2>/dev/null"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as e:
        sys.exit("no pude leer el log del contenedor: %s" % e)
    if r.returncode != 0 and not r.stdout:
        sys.exit("no pude leer el log del contenedor: %s" % r.stderr.strip()[:200])
    return r.stdout.splitlines()


def agregar(lineas):
    """{fecha: fila}. Una pasada, acumulando por día."""
    dias = {}
    for ln in lineas:
        m = LINEA.search(ln)
        if not m:
            continue
        d = dias.setdefault(m.group("fecha"), {
            "llamadas": 0, "in": 0, "out": 0,
            "cache_hit": 0, "cache_tot": 0, "lat": [], "prov": {},
        })
        d["llamadas"] += 1
        d["in"] += int(m.group("in"))
        d["out"] += int(m.group("out"))
        d["lat"].append(float(m.group("lat")))
        p = m.group("prov")
        d["prov"][p] = d["prov"].get(p, 0) + 1
        c = CACHE.search(ln)
        if c:
            d["cache_hit"] += int(c.group("hit"))
            d["cache_tot"] += int(c.group("tot"))

    filas = {}
    for fecha, d in dias.items():
        lat = sorted(d["lat"])
        # p90 por índice, sin interpolar: con pocas muestras interpolar inventa
        # un número que no ocurrió, y esto se lee como "cuánto tardó de verdad".
        p90 = lat[min(len(lat) - 1, int(len(lat) * 0.9))] if lat else 0.0
        prov = ",".join("%s:%d" % (k, v)
                        for k, v in sorted(d["prov"].items(), key=lambda x: -x[1]))
        filas[fecha] = {
            "fecha": fecha,
            "llamadas": str(d["llamadas"]),
            "tokens_in": str(d["in"]),
            "tokens_out": str(d["out"]),
            "cache_pct": ("%.1f" % (100.0 * d["cache_hit"] / d["cache_tot"])
                          if d["cache_tot"] else ""),
            "latencia_p50": "%.1f" % statistics.median(lat) if lat else "",
            "latencia_p90": "%.1f" % p90,
            "proveedores": prov,
        }
    return filas


def leer_acumulado(ruta):
    if not os.path.exists(ruta):
        return {}
    filas = {}
    with open(ruta, encoding="utf-8") as f:
        cab = f.readline().rstrip("\n").split("\t")
        for ln in f:
            v = ln.rstrip("\n").split("\t")
            if len(v) != len(cab):
                continue
            fila = dict(zip(cab, v))
            filas[fila.get("fecha", "")] = fila
    filas.pop("", None)
    return filas


def escribir(ruta, filas):
    """Escritura atómica: si el proceso muere a mitad, el archivo viejo sigue
    entero. Es la memoria de meses; no se arriesga por una corrida."""
    tmp = ruta + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\t".join(COLUMNAS) + "\n")
        for fecha in sorted(filas):
            f.write("\t".join(filas[fecha].get(c, "") for c in COLUMNAS) + "\n")
    os.replace(tmp, ruta)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--salida", default=SALIDA)
    ap.add_argument("--ver", action="store_true",
                    help="muestra lo acumulado y no escribe nada")
    args = ap.parse_args()

    acumulado = leer_acumulado(args.salida)

    if args.ver:
        if not acumulado:
            print("todavía no hay nada acumulado en %s" % args.salida)
            return
        print("\t".join(COLUMNAS))
        for fecha in sorted(acumulado):
            print("\t".join(acumulado[fecha].get(c, "") for c in COLUMNAS))
        return

    nuevas = agregar(leer_logs())
    if not nuevas:
        print("el log no trae ninguna línea de métrica; no toco el acumulado")
        return

    # Las recién calculadas mandan sobre las guardadas: el día en curso se
    # recalcula entero en cada corrida. Los días que ya rotaron no están en
    # `nuevas` y sobreviven porque el update no los pisa.
    antes = len(acumulado)
    acumulado.update(nuevas)
    escribir(args.salida, acumulado)

    print("%d día(s) en el log, %d en el acumulado (antes %d) -> %s"
          % (len(nuevas), len(acumulado), antes, args.salida))
    for fecha in sorted(nuevas)[-3:]:
        f = nuevas[fecha]
        print("  %s  %s llamadas  in=%s out=%s  cache=%s%%  p50=%ss p90=%ss  %s"
              % (fecha, f["llamadas"], f["tokens_in"], f["tokens_out"],
                 f["cache_pct"] or "-", f["latencia_p50"] or "-",
                 f["latencia_p90"] or "-", f["proveedores"]))


if __name__ == "__main__":
    main()
