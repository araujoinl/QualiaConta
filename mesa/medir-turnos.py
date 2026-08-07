#!/usr/bin/env python3
"""Mide lo que cuesta cada turno del contable, leyendo su propio log.

Existe porque el costo del contable se discutió mucho tiempo de oído —"va
lentísimo", "el prompt es enorme"— y las dos cosas resultaron falsas por
separado. Hermes ya escribe por cada llamada una línea con todo lo que hace
falta para decidir, y nadie la estaba leyendo:

    API call #15: model=glm-5.2 provider=zai in=52943 out=124 total=53067
                  latency=6.4s cache=52544/52943 (99%)

Lo que ese log contestó el 2026-08-07, y que este script recalcula:

  * La latencia NO la manda la entrada. Sobre 5.448 llamadas reales:
    corr(salida, latencia) = 0,76 · corr(entrada, latencia) = 0,04.
    Comprobado además contra el endpoint de producción con la misma salida de
    700 tokens: prompt de 1.141 → 12,0 s, prompt de 27.822 → 11,9 s. El caché
    de prefijo de z.AI pega al 91,4%, así que los 27k de la skill viajan
    gratis en segundos.
  * La latencia la manda el RAZONAMIENTO. El 90-95% de los tokens de salida
    son reasoning: una sesión real cerró con out=67.714 y reasoning=61.086.
  * Pero la CUOTA sí la manda la entrada, y ahí los cacheados cuentan igual.
    Los dos cortes de 5 h que hay en el log se produjeron con 15,20 M y
    15,10 M de tokens de entrada (0,7% de diferencia) contra 666 y 690
    llamadas (3,5%). El tope se mide en tokens, no en prompts.

O sea: el archivo grande no te cuesta segundos, te cuesta la ventana de 5
horas. Por eso el corte de la skill se justifica con la columna de entrada y
el `reasoning_effort` con la de salida, y no al revés.

Uso:
    python3 mesa/medir-turnos.py                 # baja el log del server
    python3 mesa/medir-turnos.py agent.log ...   # sobre archivos locales
    python3 mesa/medir-turnos.py --desde 2026-08-06

Solo lee. No toca el contenedor ni la base.
"""

import argparse
import datetime
import math
import re
import subprocess
import sys
from collections import defaultdict

# El formato lo escribe agent/conversation_loop de Hermes. Si un update lo
# cambia, este regex deja de matchear y el script reporta 0 llamadas en vez de
# mentir con números viejos — por eso no hay fallback silencioso.
LLAMADA = re.compile(
    r"^(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+ \w+ "
    r"\[(?P<sid>\d{8}_\d{6}_[0-9a-f]+)\] agent\.conversation_loop: "
    r"API call #(?P<n>\d+): model=(?P<modelo>\S+) provider=(?P<prov>\S+) "
    r"in=(?P<inp>\d+) out=(?P<out>\d+) total=\d+ "
    r"latency=(?P<lat>[\d.]+)s cache=(?P<cache>\d+)/\d+"
)

# El 429 de cuota agotada. Sirve para acotar la ventana de 5 h y ver con
# cuánto se topó: es la única forma de saber en qué unidad mide z.AI.
CUOTA = re.compile(
    r"^(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+.*"
    r"Usage limit reached for 5 hour\. Your limit will reset at "
    r"(?P<reset>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})"
)

LOGS_REMOTOS = ("/opt/data/logs/agent.log.1", "/opt/data/logs/agent.log")

# El motivo con el que el poller despertó al contable NO está en agent.log
# (verificado: cero coincidencias en los dos archivos). Viaja en el prompt del
# webhook, o sea dentro del mensaje que Hermes guarda en state.db. Y el
# state.db pesa 150 MB, así que la consulta corre DENTRO del contenedor y solo
# vuelve el mapa sesión→motivo, que son unos kilobytes.
CONSULTA_MOTIVOS = r"""
import sqlite3, re, json
c = sqlite3.connect('file:/opt/data/state.db?mode=ro', uri=True)
pat = re.compile(r'Actividad en la mesa de trabajo \(([a-z_]+)\)')
out = {}
q = "select session_id, content from messages where role='user' and content like '%Actividad en la mesa%'"
for sid, contenido in c.execute(q):
    m = pat.search(contenido or '')
    if m:
        out.setdefault(sid, m.group(1))
print(json.dumps(out))
"""


def leer_del_server():
    """Trae los logs del contenedor sin escribir nada en el server."""
    cmd = ["ssh", "codebox", "docker exec qualiaconta-blackbox cat " + " ".join(LOGS_REMOTOS)]
    salida = subprocess.run(cmd, capture_output=True, text=True, errors="ignore")
    if salida.returncode != 0:
        sys.exit(f"no pude leer el log del contenedor: {salida.stderr.strip()[:200]}")
    return salida.stdout.splitlines()


def leer_motivos():
    """Mapa sesión→motivo desde el state.db del contenedor. Nunca revienta.

    Si no se puede, devuelve None y el reporte lo dice: un bloque vacío se lee
    como "no hubo", que es distinto de "no pude mirar".
    """
    cmd = ["ssh", "codebox", "docker exec -i qualiaconta-blackbox python3 -"]
    r = subprocess.run(cmd, input=CONSULTA_MOTIVOS, capture_output=True, text=True, errors="ignore")
    if r.returncode != 0 or not r.stdout.strip():
        return None
    try:
        import json
        return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        return None


def leer_locales(rutas):
    lineas = []
    for r in rutas:
        with open(r, errors="ignore") as fh:
            lineas.extend(fh.read().splitlines())
    return lineas


# La métrica del SPEC §4.6 — "qué porcentaje del trabajo se resuelve sin el
# modelo grande. Si no sube, el sistema no está aprendiendo por más que lo
# parezca." La fuente es la BASE, no agent.log: lo que NO pasó por el modelo
# no deja rastro en el log del modelo. El psql corre dentro del sidecar (que
# ya tiene DSN); acá solo vuelven los contadores.
CONSULTA_SIN_LLM = r"""
select
  count(*) filter (where tipo='factura'
                     and estado in ('propuesta','aprobada','registrada','rechazada')),
  count(*) filter (where tipo='factura'
                     and estado in ('propuesta','aprobada','registrada','rechazada')
                     and propuesta ? 'proponedor'),
  (select count(*) from qualia_libro l
    where l.empresa_id = t.empresa_id and l.created_at > now() - interval '%(dias)s days'),
  (select count(distinct e.trabajo_id) from qualia_eventos e
    where e.contenido like '📖 Entrada del libro escrita por plantilla%%'
      and e.created_at > now() - interval '%(dias)s days')
from qualia_trabajos t
where created_at > now() - interval '%(dias)s days'
group by empresa_id;
"""


def medir_sin_llm(dias=14):
    """(facturas, por_proponedor, entradas_libro, libro_plantilla) o None."""
    cmd = ["ssh", "codebox",
           "docker exec -i qualiaconta-mesa-blackbox sh -c "
           "'psql \"$QUALIA_DSN\" -t -A -F \"|\"'"]
    r = subprocess.run(cmd, input=CONSULTA_SIN_LLM % {"dias": dias},
                       capture_output=True, text=True, errors="ignore")
    if r.returncode != 0 or not r.stdout.strip():
        return None
    try:
        return [int(x) for x in r.stdout.strip().splitlines()[0].split("|")]
    except (ValueError, IndexError):
        return None


def correlacion(xs, ys):
    if len(xs) < 2:
        return float("nan")
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    return cov / (sx * sy) if sx and sy else float("nan")


def percentil(valores, p):
    if not valores:
        return 0
    orden = sorted(valores)
    return orden[min(len(orden) - 1, int(p * len(orden)))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("logs", nargs="*", help="archivos de log locales; sin esto los baja del server")
    ap.add_argument("--desde", help="fecha ISO: ignora las llamadas anteriores")
    args = ap.parse_args()

    lineas = leer_locales(args.logs) if args.logs else leer_del_server()
    corte = datetime.datetime.fromisoformat(args.desde) if args.desde else None

    llamadas = []
    cortes_cuota = {}

    for linea in lineas:
        m = LLAMADA.match(linea)
        if m:
            ts = datetime.datetime.fromisoformat(m["ts"])
            if corte and ts < corte:
                continue
            llamadas.append(
                dict(ts=ts, sid=m["sid"], modelo=m["modelo"], prov=m["prov"],
                     inp=int(m["inp"]), out=int(m["out"]),
                     lat=float(m["lat"]), cache=int(m["cache"]))
            )
            continue
        c = CUOTA.match(linea)
        if c:
            cortes_cuota.setdefault(c["reset"], datetime.datetime.fromisoformat(c["ts"]))

    motivo_de = leer_motivos()

    if not llamadas:
        sys.exit("no encontré ni una llamada: ¿cambió el formato del log de Hermes?")

    lat = [c["lat"] for c in llamadas]
    out = [c["out"] for c in llamadas]
    inp = [c["inp"] for c in llamadas]
    cache = [c["cache"] for c in llamadas]
    por_sesion = defaultdict(int)
    for c in llamadas:
        por_sesion[c["sid"]] += 1
    n = sorted(por_sesion.values())

    print(f"ventana         {llamadas[0]['ts']}  ..  {llamadas[-1]['ts']}")
    print(f"sesiones        {len(por_sesion)}   llamadas {len(llamadas)}")
    print()
    print(f"entrada         total {sum(inp)/1e6:6.2f} M   promedio {sum(inp)/len(inp):8,.0f}   mediana {percentil(inp,.5):8,}")
    print(f"  cacheada      total {sum(cache)/1e6:6.2f} M   = {100*sum(cache)/sum(inp):.1f}% de la entrada")
    print(f"salida          total {sum(out)/1e6:6.3f} M   promedio {sum(out)/len(out):8,.0f}   p90 {percentil(out,.9):8,}")
    print(f"latencia        total {sum(lat)/3600:6.2f} h   mediana  {percentil(lat,.5):8.1f}s  p90 {percentil(lat,.9):7.1f}s")
    print()
    print(f"corr(salida,  latencia) = {correlacion(out, lat):5.2f}   <- lo que te hace lento")
    print(f"corr(entrada, latencia) = {correlacion(inp, lat):5.2f}   <- lo que NO te hace lento")
    print()
    print(f"llamadas por sesión: mediana {percentil(n,.5)}  p90 {percentil(n,.9)}  max {max(n)}")

    print()
    if motivo_de is None:
        print("llamadas por motivo: NO PUDE LEERLAS (state.db del contenedor inaccesible).")
        print("  No es que no haya: es que no miré. El motivo no está en agent.log.")
    else:
        print("llamadas por motivo (es lo que decide cuánto pesa partir la skill):")
        agrupado = defaultdict(int)
        for c in llamadas:
            agrupado[motivo_de.get(c["sid"], "sin motivo (no vino del webhook)")] += 1
        total = sum(agrupado.values())
        for k, v in sorted(agrupado.items(), key=lambda x: -x[1]):
            print(f"  {k:34s} {v:6,}  {100*v/total:5.1f}%")

    sin_llm = medir_sin_llm()
    print()
    if sin_llm is None:
        print("trabajo sin modelo grande (SPEC §4.6): NO PUDE MEDIR (la base no")
        print("  contestó por ssh). No es que sea cero: es que no miré.")
    else:
        fact, prop, libro, plantilla = sin_llm
        print("trabajo sin modelo grande (SPEC §4.6, últimos 14 días — si no sube,")
        print("no está aprendiendo por más que lo parezca):")
        if fact:
            print("  facturas propuestas sin sesión LLM   %3d de %3d  (%.0f%%)"
                  % (prop, fact, 100.0 * prop / fact))
        else:
            print("  sin facturas en la ventana")
        if libro:
            print("  entradas de libro por plantilla      %3d de %3d  (%.0f%%)"
                  % (plantilla, libro, 100.0 * plantilla / libro))
        print("  (la factura del proponedor ya no toca el modelo en TODO su ciclo:")
        print("   propuesta, registro y libro corren por scripts)")

    if cortes_cuota:
        print()
        print("cortes de cuota de 5 h — con cuánto se topó cada uno:")
        print("  (si la columna de entrada es la que coincide entre cortes, el tope se mide en tokens)")
        for reset, primero in sorted(cortes_cuota.items(), key=lambda x: x[1]):
            ventana = [c for c in llamadas
                       if primero - datetime.timedelta(hours=5) <= c["ts"] <= primero and c["prov"] == "zai"]
            if not ventana:
                continue
            print(f"  reset {reset}  llamadas {len(ventana):5,}   "
                  f"entrada {sum(x['inp'] for x in ventana)/1e6:5.2f} M   "
                  f"salida {sum(x['out'] for x in ventana)/1e6:5.3f} M")


if __name__ == "__main__":
    main()
