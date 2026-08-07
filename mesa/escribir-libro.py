#!/usr/bin/env python3
"""Escribe la entrada del libro de acción de un trabajo YA registrado, por
plantilla y sin sesión LLM.

Hasta ahora, tras cada registro directo el poller despertaba al contable con
motivo `escribir_libro`: una sesión completa (~9 llamadas, ~200k tokens — el
11,9% de todas las llamadas medidas al 2026-08-07) para redactar un markdown
de 15 líneas cuyos datos YA están todos en la fila. Este script es esa
plantilla. La sesión LLM queda como red de seguridad (bloque 4 del poller)
para cuando esto falle, y para los tipos que no pasan por acá.

De dónde sale cada campo:
  - El "Por qué" y el "Alcance" vienen de `propuesta.borrador_libro` si la
    sesión de análisis lo dejó (caso razonado), o del `detalle` de la
    propuesta (caso del proponedor determinista, donde el detalle ya cita el
    precedente con sus números). Nunca se inventa prosa nueva: este script
    ORDENA lo que ya se decidió, no decide.
  - "Aprobó" es `aprobado_por_nombre` de la fila (SPEC decisión 19: la
    persona, siempre) y el DocID sale de `registro_adm.docid` — la skill
    manda no escribir libro sin documento, y acá es compuerta dura.

Contratos que respeta:
  - Libro append-only: si el archivo destino existe, NO se toca — se crea con
    sufijo numerado. Editar una entrada existente es un error, no un cambio.
  - No duplicar: si `qualia_libro` ya tiene fila para este trabajo, sale sin
    escribir nada (el barrido de los 30 min re-dispara este script y el
    segundo pase debe ser inofensivo).
  - El archivo queda del HERMES_UID (el sidecar corre root; el libro tiene
    que quedar commiteable desde afuera, como los archivos del prep).

Uso:
    escribir-libro.py --trabajo <uuid> [--simular]

Exit: 0 = entrada escrita (o ya existía; idempotente) · 1 = no se pudo (el
poller degrada al poke `escribir_libro` de siempre).

Env: QUALIA_DSN, QUALIA_EMPRESA_ID. Rutas: QUALIA_LIBRO_DIR (default /libro),
HERMES_UID/HERMES_GID (default 1000).
"""
import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import unicodedata


def morir(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


def env(nombre):
    v = os.environ.get(nombre)
    if not v:
        morir("falta la variable de entorno %s" % nombre)
    return v


def sql(consulta, **variables):
    cmd = ["psql", env("QUALIA_DSN"), "-X", "-t", "-A", "-F", "\t", "-q",
           "-v", "ON_ERROR_STOP=1"]
    for k, v in variables.items():
        cmd += ["-v", "%s=%s" % (k, v)]
    r = subprocess.run(cmd, input=consulta, capture_output=True, text=True)
    if r.returncode != 0:
        morir("consulta a la mesa fallo: %s" % r.stderr.strip()[:200])
    return [l.split("\t") for l in r.stdout.strip().splitlines() if l.strip()]


def slug(texto, tope=60):
    s = unicodedata.normalize("NFKD", str(texto or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:tope].rstrip("-") or "sin-titulo"


def moneda_fmt(propuesta):
    simbolo = "US$" if propuesta.get("moneda") == "USD" else "RD$"
    try:
        return "%s%s" % (simbolo, format(float(propuesta.get("monto")), ",.2f"))
    except (TypeError, ValueError):
        return "%s?" % simbolo


def decision_de(propuesta):
    """Resume las líneas como decisión contable. Dos formas de línea (las
    mismas dos de la mesa): items de factura y partida doble."""
    lineas = propuesta.get("lineas") or []
    partes = []
    if lineas and "precio" in lineas[0]:
        por_cuenta = {}
        for l in lineas:
            try:
                base = round(float(l["precio"]) * float(l["cantidad"]), 2)
            except (KeyError, TypeError, ValueError):
                continue
            clave = "%s %s" % (l.get("cuenta"), l.get("cuenta_nombre") or "")
            por_cuenta[clave] = round(por_cuenta.get(clave, 0) + base, 2)
        for cuenta, base in sorted(por_cuenta.items()):
            partes.append("%s → %s" % (format(base, ",.2f"), cuenta.strip()))
    else:
        for l in lineas:
            deb = l.get("debito")
            cred = l.get("credito")
            lado = ("débito %s" % format(float(deb), ",.2f") if deb
                    else "crédito %s" % format(float(cred or 0), ",.2f"))
            partes.append("%s → %s %s" % (lado, l.get("cuenta"),
                                          l.get("cuenta_nombre") or ""))
    tg = propuesta.get("tipo_gasto") or {}
    encabezado = "%s %s" % (propuesta.get("documento_adm") or "documento",
                            moneda_fmt(propuesta))
    if tg.get("codigo"):
        encabezado += ", tipo de gasto 606: %s %s" % (tg["codigo"], tg.get("nombre") or "")
    if not partes:
        return encabezado
    return encabezado + ". Renglones: " + "; ".join(partes)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trabajo", required=True)
    ap.add_argument("--simular", action="store_true")
    args = ap.parse_args()
    if not re.fullmatch(r"[0-9a-f-]{36}", args.trabajo):
        morir("trabajo invalido: no es un UUID")
    empresa_id = env("QUALIA_EMPRESA_ID")
    libro_dir = os.environ.get("QUALIA_LIBRO_DIR") or "/libro"

    filas = sql("""
select estado, coalesce(resumen, ''), coalesce(aprobado_por_nombre, ''),
       coalesce(propuesta::text, '{}')
  from qualia_trabajos
 where id = :'id' and empresa_id = :'emp';""", id=args.trabajo, emp=empresa_id)
    if not filas:
        morir("sin fila para ese trabajo")
    estado, resumen, aprobo, prop_txt = (filas[0] + ["", "", "", "{}"])[:4]
    try:
        propuesta = json.loads(prop_txt)
    except ValueError:
        morir("propuesta ilegible")

    if estado != "registrada":
        morir("estado '%s': el libro por plantilla es solo para registradas" % estado)
    docid = ((propuesta.get("registro_adm") or {}).get("docid") or "").strip()
    if not docid:
        # La skill lo dice para el LLM y vale igual acá: una entrada sin
        # documento es peor que ninguna.
        morir("sin registro_adm.docid: no se inventa la entrada")
    if not aprobo:
        morir("sin aprobado_por_nombre: el campo Aprobó no es decorativo (SPEC 19)")

    ya = sql("select 1 from qualia_libro where trabajo_id = :'id' limit 1;",
             id=args.trabajo)
    if ya:
        print("el libro ya tiene la entrada de este trabajo; nada que hacer")
        return 0

    borrador = propuesta.get("borrador_libro") or {}
    proveedor = propuesta.get("proveedor") or resumen or "documento"
    hoy = datetime.date.today().isoformat()
    titulo = borrador.get("titulo") or (resumen or "%s — %s" % (proveedor, docid))
    caso = borrador.get("caso") or (resumen or "%s de %s" % (
        propuesta.get("documento_adm") or "documento", proveedor))
    por_que = borrador.get("por_que") or propuesta.get("detalle") or \
        "Registro por el camino directo de la mesa; ver propuesta aprobada."
    if propuesta.get("precedente_ref"):
        sosten = "Precedente: %s" % propuesta["precedente_ref"]
    else:
        sosten = borrador.get("sosten") or "Método: %s" % (propuesta.get("metodo") or "?")
    alcance = borrador.get("alcance") or ""
    if not alcance and propuesta.get("precedente_ref"):
        # Sin alcance la entrada documenta pero no automatiza (SPEC 3). La
        # entrada determinista RATIFICA un precedente que ya existe: ese es su
        # alcance, y decirlo mantiene la cadena citable.
        alcance = ("Ratifica el precedente %s para facturas de %s con el "
                   "mismo reparto." % (propuesta["precedente_ref"], proveedor))
    if not alcance:
        alcance = "— (documenta este caso; sin alcance no automatiza)"

    entrada = """# %s

- **Fecha:** %s
- **Caso:** %s
- **Decisión:** %s DocID %s.
- **Por qué:** %s
- **Sostén:** %s
- **Aprobó:** %s, por la mesa web
- **Alcance:** %s
- **Deroga:** —
""" % (titulo, hoy, caso, decision_de(propuesta), docid, por_que, sosten,
       aprobo, alcance)

    nombre = "%s-%s-%s.md" % (hoy, slug(proveedor, 40), docid.lower())
    destino = os.path.join(libro_dir, nombre)
    n = 2
    while os.path.exists(destino):
        # Append-only: un archivo existente jamás se pisa. Si el nombre choca
        # (dos documentos del mismo proveedor y DocID no puede ser, pero un
        # reintento a mitad sí), la entrada nueva vive al lado.
        destino = os.path.join(libro_dir, "%s-%s-%s-%d.md"
                               % (hoy, slug(proveedor, 40), docid.lower(), n))
        n += 1

    if args.simular:
        print("--- %s ---" % destino)
        print(entrada)
        return 0

    if not os.path.isdir(libro_dir):
        morir("el directorio del libro (%s) no esta montado" % libro_dir)
    tmp = destino + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(entrada)
    os.replace(tmp, destino)
    try:
        os.chown(destino, int(os.environ.get("HERMES_UID", "1000")),
                 int(os.environ.get("HERMES_GID", "1000")))
    except (OSError, ValueError):
        pass   # sin permiso de chown (corriendo como no-root): ya es nuestro

    ref_git = "libro-de-accion/%s" % os.path.basename(destino)
    sql("""
insert into qualia_libro (empresa_id, trabajo_id, entrada, metodo,
                          precedente_ref, aprobado_por_nombre, ref_git)
values (:'emp', :'id', :'entrada', :'metodo',
        nullif(:'ref', ''), :'aprobo', :'refgit');""",
        emp=empresa_id, id=args.trabajo, entrada=entrada,
        metodo=propuesta.get("metodo") or "precedente",
        ref=propuesta.get("precedente_ref") or "", aprobo=aprobo,
        refgit=ref_git)
    sql("""
insert into qualia_eventos (trabajo_id, autor, tipo, contenido)
values (:'id', 'contable', 'progreso', :'cont');""",
        id=args.trabajo,
        cont="📖 Entrada del libro escrita por plantilla: %s" % ref_git)
    print("LIBRO %s" % ref_git)
    return 0


if __name__ == "__main__":
    sys.exit(main())
