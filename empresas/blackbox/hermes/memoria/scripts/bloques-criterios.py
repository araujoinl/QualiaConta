#!/usr/bin/env python3
"""
Troceador de borradores a trabajos de mesa — preentrenamiento QualiaConta.

Lee los borradores de memoria (/opt/data/memoria/*.md con front-matter
`estado: borrador`), los trocea en 8-12 bloques temáticos y crea UN trabajo
tipo='criterio' por bloque en qualia_trabajos (mesa web) para su ratificación
por bloque (plan-preentrenamiento §3). No usa LLM: es corte y empaquetado.

USO:
    python3 bloques-criterios.py --dry-run [--dir /opt/data/memoria]
        imprime los bloques SIN insertar (no necesita base)
    python3 bloques-criterios.py [--dir /opt/data/memoria]
        inserta; requiere env QUALIA_DSN y QUALIA_EMPRESA_ID (contenedor)

QUÉ INSERTA (contrato docs/mesa-de-trabajo.md):
    tipo='criterio', origen='preentrenamiento', estado='propuesta',
    resumen="Criterios: <bloque> (<n> reglas)",
    propuesta jsonb: {bloque, archivo, n_reglas,
                      reglas: [{titulo, enunciado, evidencia, alcance}], detalle}

IDEMPOTENTE por bloque: si ya existe un trabajo tipo='criterio' con el mismo
propuesta->>'bloque' en estado propuesta o aprobada, NO se duplica (los
rechazados sí se re-emiten: el bloque corregido vuelve como trabajo nuevo).

Los valores viajan como variables psql (-v) e interpolación :'var', nunca
concatenados en el SQL. INDEX.md y api-admcloud.md no se trocean (convención
y conocimiento de herramienta: no requieren ratificación contable).
"""

# ─────────────────────────────────────────────────────────────────────────────
# NO CORRAS ESTE SCRIPT. Fuera de servicio desde el 2026-08-06. Se conserva
# como registro de cómo se pensó la migración masiva del preentrenamiento.
#
# No está roto: la cadena entera lo atendería. Un click y se dispara. Por eso se
# retira en vez de dejarse instalado.
#
# El motivo de fondo no es que empaquete mal: es QUÉ AUTORIDAD le da al
# resultado. Al aprobarse un bloque, la skill mesa-de-trabajo pone
# `estado: ratificado` al ARCHIVO ENTERO, y una memoria ratificada MANDA SOBRE
# EL AGG. O sea: un click congela la foto del 2026-08-02 por encima del
# destilado que `refrescar-precedentes.sh` regenera todas las noches a las 5:20.
#
# Tres razones, medidas el 2026-08-06 contra su propio --dry-run (5 bloques,
# 79 reglas) y contra raw/vendor-bills-detalle.jsonl:
#
#   1. Emite bloques de 30 reglas, y adentro hay basura. Las fichas ponderan por
#      MONTO y `buscar-precedente.py` cuenta DOCUMENTOS — nadie había notado que
#      son dos ejes distintos. En 6 de las 73 fichas eso invierte la cuenta
#      principal. La peor es la de mayor volumen, Banco Múltiple Santa Cruz:
#      encabeza con 230.02 (57,8% del monto, pero 3 facturas de 203) y deja
#      última a 640.02 (0,5% del monto, pero 136 de 203 — dos de cada tres).
#      Ratificarla enseña a mandar a la cuenta del préstamo lo que casi siempre
#      es un cargo por cheque de RD$0,15. Y ratificar 30 tratamientos con un
#      click, en una mesa que aprobó 48 filas en un minuto (2026-08-03 23:24 UTC,
#      verificado), es exactamente cómo se instala una regla equivocada.
#
#   2. Ratifica por ARCHIVO lo que trocea por BLOQUE. Aprobar el primero de los
#      tres bloques de proveedores.md marca las 73 fichas, 43 de ellas sin que
#      nadie las mire, y deja los otros dos bloques imposibles de re-emitir:
#      este script sólo trocea BORRADORES. Lo mismo con nomina.md, que se
#      autodeclara «estructura NO verificada línea a línea» y cuya cuarta
#      «regla» es la sección «Qué falta confirmar en F4» — una lista de
#      preguntas abiertas convertida en precedente de primera clase.
#
#   3. Las 79 reglas nacen con «(sin alcance)». Una regla sin borde se aplica
#      donde no debe, y es justo lo que el mecanismo existía para evitar.
#
# El reemplazo no es otro script: la memoria se ratifica DE A UNA regla, cuando
# el dueño corrige algo de verdad. Lo inserta el propio contable desde la rama
# `respuesta` de skills/mesa-de-trabajo/SKILL.md, con una sola regla, su alcance
# escrito y SIN `archivo` — para que ratificar una regla no ratifique un archivo.
# ─────────────────────────────────────────────────────────────────────────────
import sys as _sys

_sys.exit(
    "bloques-criterios.py está fuera de servicio desde el 2026-08-06 — "
    "leé el comentario de la cabecera antes de revivirlo."
)

import argparse
import json
import os
import re
import subprocess
import sys

# Estrategia por archivo: chunk = varias secciones por bloque; unico = 1 bloque.
ARCHIVOS = {
    "proveedores.md": {"modo": "chunk", "max": 30, "etiqueta": "Proveedores"},
    "criterios.md": {"modo": "chunk", "max": 12, "etiqueta": "Criterios transversales"},
    "nomina.md": {"modo": "unico", "etiqueta": "Nómina"},
    "banco.md": {"modo": "unico", "etiqueta": "Criterios banco"},
    "ventas.md": {"modo": "unico", "etiqueta": "Ventas (contexto)"},
    "plan-de-cuentas.md": {"modo": "unico", "etiqueta": "Plan de cuentas anotado"},
}
MAX_REGLAS_JSON = 60      # tope de reglas volcadas al jsonb (el resto se resume)
MAX_ENUNCIADO = 400       # chars por enunciado dentro del jsonb
DOCID = re.compile(r"\b(?:FP|PI|PC|PP|CB|FC|FCC|JN|DP|NC|TR)[A-Z]*\d{3,}\b")


def leer_front_matter(lineas):
    """Busca `estado: X` en las primeras 15 líneas (con o sin cerco ---)."""
    for ln in lineas[:15]:
        m = re.match(r"^estado:\s*(\S+)", ln.strip())
        if m:
            return m.group(1)
    return None


def partir_secciones(texto):
    """Secciones de nivel `## `; lo previo al primer heading se descarta
    (front-matter e intro no son reglas)."""
    secciones, titulo, cuerpo = [], None, []
    for ln in texto.splitlines():
        if ln.startswith("## "):
            if titulo:
                secciones.append((titulo, "\n".join(cuerpo).strip()))
            titulo, cuerpo = ln[3:].strip(), []
        elif titulo:
            cuerpo.append(ln)
    if titulo:
        secciones.append((titulo, "\n".join(cuerpo).strip()))
    return secciones


def campo_etiquetado(cuerpo, etiqueta):
    m = re.search(rf"^\s*[-*]?\s*\**{etiqueta}\**\s*:\s*(.+)$", cuerpo,
                  re.IGNORECASE | re.MULTILINE)
    return m.group(1).strip() if m else ""


def seccion_a_regla(titulo, cuerpo):
    enunciado = (campo_etiquetado(cuerpo, r"(?:Tratamiento t[ií]pico|Enunciado|Decisi[oó]n)")
                 or cuerpo)
    evidencia = campo_etiquetado(cuerpo, "Evidencia")
    if not evidencia:
        docids = DOCID.findall(cuerpo)
        evidencia = ", ".join(dict.fromkeys(docids[:4])) if docids else ""
    return {
        "titulo": titulo,
        "enunciado": enunciado[:MAX_ENUNCIADO],
        "evidencia": evidencia,
        "alcance": campo_etiquetado(cuerpo, "Alcance"),
    }


def inicial(texto):
    m = re.search(r"[A-Za-z0-9]", texto)
    return m.group(0).upper() if m else "?"


def trocear(nombre, texto):
    """Devuelve la lista de bloques de un archivo: (bloque, reglas)."""
    cfg = ARCHIVOS[nombre]
    secciones = partir_secciones(texto)
    if not secciones:
        return []
    reglas = [seccion_a_regla(t, c) for t, c in secciones]
    if cfg["modo"] == "unico":
        return [(cfg["etiqueta"], reglas)]
    bloques, tam = [], cfg["max"]
    trozos = [reglas[i:i + tam] for i in range(0, len(reglas), tam)]
    for i, trozo in enumerate(trozos):
        if nombre == "proveedores.md":
            nom = f"{cfg['etiqueta']} {inicial(trozo[0]['titulo'])}–{inicial(trozo[-1]['titulo'])}"
        else:
            nom = cfg["etiqueta"] + (f" {i + 1}/{len(trozos)}" if len(trozos) > 1 else "")
        bloques.append((nom, trozo))
    return bloques


def armar_trabajo(bloque, archivo, reglas):
    recorte = len(reglas) > MAX_REGLAS_JSON
    detalle = (f"Bloque de {len(reglas)} reglas destiladas de memoria/{archivo} "
               f"(preentrenamiento, pendiente de ratificación). Al aprobarse: una "
               f"entrada de libro de acción por regla y el archivo pasa a ratificado.")
    if recorte:
        detalle += (f" El jsonb lista las primeras {MAX_REGLAS_JSON}; el resto "
                    f"se revisa en el archivo.")
    propuesta = {
        "bloque": bloque,
        "archivo": archivo,
        "n_reglas": len(reglas),
        "reglas": reglas[:MAX_REGLAS_JSON],
        "detalle": detalle,
    }
    plural = "regla" if len(reglas) == 1 else "reglas"
    resumen = f"Criterios: {bloque} ({len(reglas)} {plural})"
    return resumen, propuesta


def psql(dsn, sql, variables, capturar=False):
    cmd = ["psql", dsn, "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A"]
    for k, v in variables.items():
        cmd += ["-v", f"{k}={v}"]
    r = subprocess.run(cmd, input=sql, capture_output=True, text=True)
    if r.returncode != 0:
        # el stderr de psql no refleja secretos (el DSN va por argv, no en el SQL)
        print(f"psql falló: {r.stderr.strip()[:300]}", file=sys.stderr)
        sys.exit(3)
    return r.stdout.strip() if capturar else None


def existe_bloque(dsn, empresa, bloque):
    sql = ("select count(*) from qualia_trabajos "
           "where empresa_id = :'empresa'::uuid and tipo = 'criterio' "
           "and estado in ('propuesta','aprobada') "
           "and propuesta->>'bloque' = :'bloque';")
    return int(psql(dsn, sql, {"empresa": empresa, "bloque": bloque}, capturar=True) or 0) > 0


def insertar(dsn, empresa, resumen, propuesta):
    sql = ("insert into qualia_trabajos (empresa_id, tipo, origen, estado, resumen, propuesta) "
           "values (:'empresa'::uuid, 'criterio', 'preentrenamiento', 'propuesta', "
           ":'resumen', :'prop'::jsonb);")
    psql(dsn, sql, {"empresa": empresa, "resumen": resumen,
                    "prop": json.dumps(propuesta, ensure_ascii=False)})


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1].strip())
    ap.add_argument("--dir", default="/opt/data/memoria")
    ap.add_argument("--dry-run", action="store_true",
                    help="imprime los bloques sin insertar (no necesita base)")
    args = ap.parse_args()

    trabajos = []
    for nombre in ARCHIVOS:
        ruta = os.path.join(args.dir, nombre)
        if not os.path.exists(ruta):
            print(f"aviso: no existe {nombre}, lo salto", file=sys.stderr)
            continue
        texto = open(ruta, encoding="utf-8").read()
        estado = leer_front_matter(texto.splitlines())
        if estado != "borrador":
            print(f"aviso: {nombre} con estado '{estado}' (solo troceo borradores), lo salto",
                  file=sys.stderr)
            continue
        for bloque, reglas in trocear(nombre, texto):
            trabajos.append((nombre,) + armar_trabajo(bloque, nombre, reglas))

    if not trabajos:
        print("nada que trocear: sin borradores en " + args.dir, file=sys.stderr)
        return 0
    n = len(trabajos)
    if not 8 <= n <= 12:
        print(f"aviso: salieron {n} bloques (la meta del plan es 8-12); "
              f"ajustar 'max' en ARCHIVOS si molesta", file=sys.stderr)

    if args.dry_run:
        print(f"DRY-RUN: {n} bloque(s), nada insertado\n")
        for archivo, resumen, propuesta in trabajos:
            print(f"BLOQUE: {propuesta['bloque']}  [{archivo}]  "
                  f"{propuesta['n_reglas']} reglas")
            print(f"  resumen: {resumen}")
            for r in propuesta["reglas"]:
                print(f"  - {r['titulo']} | alcance: {r['alcance'] or '(sin alcance)'} "
                      f"| evidencia: {r['evidencia'] or '(sin evidencia)'}")
            print(f"  propuesta: {json.dumps(propuesta, ensure_ascii=False)[:400]}...\n")
        return 0

    dsn = os.environ.get("QUALIA_DSN")
    empresa = os.environ.get("QUALIA_EMPRESA_ID")
    if not dsn or not empresa:
        print("faltan QUALIA_DSN / QUALIA_EMPRESA_ID en el entorno", file=sys.stderr)
        return 2

    nuevos = saltados = 0
    for archivo, resumen, propuesta in trabajos:
        if existe_bloque(dsn, empresa, propuesta["bloque"]):
            print(f"ya en mesa (propuesta/aprobada), salto: {propuesta['bloque']}",
                  file=sys.stderr)
            saltados += 1
            continue
        insertar(dsn, empresa, resumen, propuesta)
        print(f"insertado: {resumen}")
        nuevos += 1
    print(f"listo: {nuevos} trabajo(s) nuevos, {saltados} ya existentes", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
