#!/usr/bin/env bash
#
# verificar-punteros.sh — el candado de los punteros colgados.
#
# Despues del corte del SKILL.md en ramas, cada sesion del contable recibe UN
# archivo: el nucleo (SKILL.md, siempre inyectado) mas la rama que le abre
# abrir-trabajo.sh. Un puntero que diga «la seccion de arriba» o «como se dijo»
# apuntando a texto que se fue a OTRO archivo manda al lector a un lugar que en
# su turno no existe — y no hay forma de que se entere: no ve un error, ve un
# vacio. Este script lo caza antes de que llegue al contenedor.
#
# Que hace: barre SKILL.md y references/*.md, encuentra toda referencia interna
# (seccion entre comillas angulares, «el paso N», direccionales, la rama de un
# motivo) y resuelve el destino contra el inventario de titulos y anclas de
# TODOS los archivos. Un puntero pasa si su destino esta en el MISMO archivo, o
# si el propio texto nombra donde vive (un path .md, o la palabra «nucleo»).
#
# Salidas:
#   COLGADO  — el destino no esta en este archivo y el archivo no dice donde
#              esta. Falla (exit 1).
#   REVISAR  — direccional sin destino nombrado («la regla de abajo»). No falla
#              solo; con --estricto tambien cuenta.
#
# Uso:
#   mesa/verificar-punteros.sh [--estricto] [<dir del skill>]
#
set -uo pipefail

ESTRICTO=0
DIR=""
for arg in "$@"; do
  case "$arg" in
    --estricto) ESTRICTO=1 ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) DIR="$arg" ;;
  esac
done

if [[ -z "$DIR" ]]; then
  # por defecto, el skill de este mismo repo
  RAIZ_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  DIR="$RAIZ_REPO/skills/mesa-de-trabajo"
fi

if [[ ! -f "$DIR/SKILL.md" ]]; then
  echo "verificar-punteros: no encuentro $DIR/SKILL.md" >&2
  exit 2
fi

python3 - "$DIR" "$ESTRICTO" <<'PY'
import bisect
import glob
import os
import re
import sys
import unicodedata

DIR = sys.argv[1]
ESTRICTO = sys.argv[2] == "1"

SKILL = os.path.join(DIR, "SKILL.md")
ARCHIVOS = [SKILL] + sorted(glob.glob(os.path.join(DIR, "references", "*.md")))

# En la particion ANGOSTA los cuatro motivos del poller ya no son cuatro
# archivos: `manual.md` los tiene a los cuatro adentro. Nombrar un motivo dejo
# de ser mandar al lector a otro lado.
RAMA_POR_MOTIVO = {}

# Archivos que son EXTRACTOS verbatim de manual.md. Sus punteros hacia afuera no
# cuelgan: el manual entero esta a un `cat` y su propio encabezado lo dice. Sin
# esto el candado marcaria como colgado cada «ver la seccion X» que el extracto
# heredo del original, que es texto que nadie escribio para vivir suelto.
EXTRACTOS = ("libro.md", "registro.md")
ESCAPE = "references/manual.md"

MIN_SUBCADENA = 12  # bajo esto solo vale la igualdad exacta: «el tuyo» no es una seccion


def norm(s):
    """Texto comparable: sin tildes, sin markdown, sin puntuacion."""
    s = s.replace("«", " ").replace("»", " ")
    s = re.sub(r"[`*_#]", "", s)
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return s.strip()


class Doc:
    def __init__(self, path):
        self.path = path
        self.nombre = os.path.basename(path)
        with open(path, encoding="utf-8") as fh:
            self.texto = fh.read()
        self.lineas = self.texto.split("\n")
        # offset de arranque de cada linea, para traducir posicion -> linea
        self.inicios = []
        acc = 0
        for ln in self.lineas:
            self.inicios.append(acc)
            acc += len(ln) + 1
        self.anclas = self._anclas()
        self.pasos = self._pasos()

    def _anclas(self):
        """Todo lo que un puntero puede nombrar: titulos y negritas."""
        anclas = set()
        for ln in self.lineas:
            m = re.match(r"\s{0,3}#{1,6}\s+(.+?)\s*$", ln)
            if m:
                anclas.add(norm(m.group(1)))
        for m in re.finditer(r"\*\*([^*]{3,300}?)\*\*", self.texto, re.S):
            anclas.add(norm(m.group(1)))
        anclas.discard("")
        return anclas

    def _pasos(self):
        """Numeros de paso de las listas numeradas del archivo."""
        pasos = set()
        for ln in self.lineas:
            m = re.match(r"\s{0,6}(?:\*\*)?(\d{1,2})[.)]\s", ln)
            if m:
                pasos.add(int(m.group(1)))
        return pasos

    def linea_de(self, pos):
        return bisect.bisect_right(self.inicios, pos)  # 1-indexado

    def contexto(self, ini, fin, radio=2):
        a = max(0, self.linea_de(ini) - 1 - radio)
        b = min(len(self.lineas), self.linea_de(fin) + radio)
        return "\n".join(self.lineas[a:b])

    def tiene_ancla(self, objetivo):
        o = norm(objetivo)
        if not o:
            return False
        for a in self.anclas:
            if a == o:
                return True
            # Solo el puntero puede quedar corto (las angulares anidadas truncan
            # la captura). Al reves NO: una cita larga que por dentro contiene
            # una negrita corta no esta apuntando a esa negrita.
            if len(o) >= MIN_SUBCADENA and o in a:
                return True
        return False

    def es_titulo(self, linea):
        return bool(re.match(r"\s{0,3}#{1,6}\s", self.lineas[linea - 1]))

    def en_bloque_de_codigo(self, linea):
        vallas = 0
        for ln in self.lineas[: linea - 1]:
            if re.match(r"\s*```", ln):
                vallas += 1
        return vallas % 2 == 1


DOCS = {}
for p in ARCHIVOS:
    d = Doc(p)
    DOCS[d.nombre] = d


def donde_vive(objetivo, tipo="ancla"):
    """En que archivos existe el destino."""
    out = []
    for nombre, d in DOCS.items():
        if tipo == "ancla" and d.tiene_ancla(objetivo):
            out.append(nombre)
        elif tipo == "paso" and objetivo in d.pasos:
            out.append(nombre)
    return out


def archivos_nombrados(ctx, propio):
    """Los archivos que el propio texto del puntero dice donde buscar."""
    nombrados = set()
    for m in re.finditer(r"[A-Za-z0-9_\-./]+\.md", ctx):
        base = os.path.basename(m.group(0))
        if base in DOCS:
            nombrados.add(base)
    # «el nucleo», «SKILL.md», «siempre inyectado» -> el nucleo
    if re.search(r"n[uú]cleo", ctx, re.I):
        nombrados.add("SKILL.md")
    if re.search(r"est[e|a] mismo archivo", ctx, re.I):
        nombrados.add(propio)
    # Un extracto declara su escape UNA vez, en su encabezado, y con eso alcanza
    # para todos sus punteros: lo que no este en el extracto esta en el manual,
    # que es el original entero y esta a un `cat`. Exigirle a cada renglon
    # heredado que se auto-explique seria pedirle al texto viejo que sepa que lo
    # extrajeron.
    if propio in EXTRACTOS and ESCAPE in CABECERAS.get(propio, ""):
        nombrados.add(ESCAPE)
        nombrados.add(os.path.basename(ESCAPE))   # `vive` habla en basenames
        nombrados.add(propio)
    return nombrados


# Encabezado de cada archivo (su H1 y lo que lo sigue hasta el primer H2): ahi
# es donde un extracto declara de donde salio y a que archivo caer.
CABECERAS = {}
for _p in ARCHIVOS:
    _txt = open(_p, encoding="utf-8").read().split("\n## ")[0]
    CABECERAS[os.path.basename(_p)] = _txt

colgados = []
revisar = []

# --- patrones -------------------------------------------------------------
# 1. Seccion entre comillas angulares. No toda «...» es un puntero: en estos
#    archivos las angulares tambien citan al humano, encierran strings y
#    definen terminos («crédito fiscal», «606»). Hacen falta las DOS senales:
#    (a) un verbo o sustantivo de remision justo antes, y (b) que lo de adentro
#    nombre un titulo o una negrita que existe en algun archivo del skill.
RE_SECCION = re.compile(r"«([^»]{3,200})»")
RE_REMISION = re.compile(
    r"(secci[oó]n|vi[nñ]eta|reglas?|cuidados|preguntas?|tono|jerarqu[ií]a|mec[aá]nica"
    r"|pasos?|bloque|excepci[oó]n|insert|ver|v[eé]ase|dice[n]?|decidiste|elegiste"
    r"|clasific\w+|resolv\w+|forma|tabla|criterio|nota|con|segun|seg[uú]n)"
    r"\s*(?:[\w`'\"()]+\s+){0,3}$",
    re.I,
)
# 2. «el paso N», «volve al paso N», «pasos 2-5», «paso 5b».
#    Los espacios van como \s+ en todos los patrones: la prosa esta envuelta a
#    80 columnas y un puntero se parte al medio con la misma naturalidad.
RE_PASO = re.compile(
    r"\b(?:al\s+|el\s+|los\s+|del\s+|ver\s+|volv[eé]\s+al\s+|segu[ií]\s+el\s+)?"
    r"pasos?\s+(\d{1,2})\s*(?:[-–a]\s*(\d{1,2}))?[a-c]?\b",
    re.I,
)
# 3. Direccionales y remisiones sin destino nombrado.
RE_DIRECCIONAL = re.compile(
    r"\b(m[aá]s\s+arriba|m[aá]s\s+abajo|de\s+arriba|de\s+abajo|ac[aá]\s+arriba|ac[aá]\s+abajo"
    r"|est[aá]\s+abajo|est[aá]\s+arriba|ver\s+abajo|ver\s+arriba|m[aá]s\s+adelante"
    r"|como\s+se\s+dijo|como\s+(?:ya\s+)?dij\w+|como\s+siempre|como\s+ya\s+(?:se\s+)?\w+"
    r"|lo\s+anterior|la\s+secci[oó]n\s+anterior|antes\s+dicho|supra|§)\b",
    re.I,
)
# 4. La rama de otro motivo, nombrada con un verbo de «anda a leer».
RE_RAMA = re.compile(
    r"(?:and[aá]\s+(?:derecho\s+)?a\s+|lo\s+que\s+dice\s+|le[eé]\s+la\s+rama\s+"
    r"|segu[ií]\s+la\s+rama\s+|mir[aá]\s+la\s+rama\s+|hac[eé]\s+lo\s+que\s+dice\s+)"
    r"(?:lo\s+que\s+dice\s+)?(?:la\s+rama\s+)?[`'\"«]?"
    r"(escribir_libro|accion_usuario|registro_pendiente|trabajo_nuevo)",
    re.I,
)

for nombre, d in DOCS.items():
    lineas_resueltas = set()   # lineas donde ya resolvio un puntero con nombre
    pendientes_direccional = []

    def ignorable(pos):
        """Un titulo declara, no apunta; y en un bloque de codigo no hay prosa."""
        linea = d.linea_de(pos)
        return d.es_titulo(linea) or d.en_bloque_de_codigo(linea)

    def registrar(pos_ini, pos_fin, texto_puntero, destino, tipo):
        linea = d.linea_de(pos_ini)
        ctx = d.contexto(pos_ini, pos_fin)
        nombrados = archivos_nombrados(ctx, nombre)
        vive = donde_vive(destino, tipo)

        if nombre in vive:
            lineas_resueltas.add(linea)
            return
        if any(f in nombrados for f in vive):
            lineas_resueltas.add(linea)
            return
        # El nucleo se INYECTA en todas las sesiones: un puntero hacia el
        # SKILL.md nunca cuelga, este en el archivo que este.
        if "SKILL.md" in vive:
            lineas_resueltas.add(linea)
            return
        # Grupos co-servidos: abrir-trabajo.sh entrega estas piezas JUNTAS
        # (el analisis viaja en dos salidas encadenadas), asi que un puntero
        # entre ellas siempre encuentra su destino en la misma sesion.
        # ⚠ Espejo de archivos_de_rama() en scripts/abrir-trabajo.sh: si alla
        # cambia la composicion de una rama, esto se actualiza a mano.
        CO_SERVIDOS = [
            {"rama-facturas-1.md", "comun-asientos.md", "rama-facturas-2.md"},
        ]
        for grupo in CO_SERVIDOS:
            if nombre in grupo and any(f in grupo for f in vive):
                lineas_resueltas.add(linea)
                return

        colgados.append({
            "archivo": nombre,
            "linea": linea,
            "puntero": texto_puntero,
            "vive": vive,
            "texto": d.lineas[linea - 1].strip(),
        })

    for m in RE_SECCION.finditer(d.texto):
        if ignorable(m.start()):
            continue
        objetivo = m.group(1)
        # el renglon anterior cuenta: los punteros se parten con el margen
        antes = re.sub(r"\s+", " ", d.texto[max(0, m.start() - 90):m.start()])
        if not RE_REMISION.search(antes):
            continue
        vive = donde_vive(objetivo, "ancla")
        if not vive:
            # No nombra ninguna seccion conocida: es una cita, un string, una
            # frase del humano. Solo interesa si el verbo es de los duros.
            if re.search(r"(secci[oó]n|vi[nñ]eta|ver|v[eé]ase|regla dura de)\s+$", antes, re.I):
                colgados.append({
                    "archivo": nombre,
                    "linea": d.linea_de(m.start()),
                    "puntero": "«%s»" % re.sub(r"\s+", " ", objetivo)[:70],
                    "vive": [],
                    "texto": d.lineas[d.linea_de(m.start()) - 1].strip(),
                })
            continue
        registrar(m.start(), m.end(), "«%s»" % re.sub(r"\s+", " ", objetivo)[:70], objetivo, "ancla")

    for m in RE_PASO.finditer(d.texto):
        if ignorable(m.start()):
            continue
        nums = [int(g) for g in m.groups() if g]
        for n in nums:
            registrar(m.start(), m.end(), m.group(0).strip(), n, "paso")

    for m in RE_RAMA.finditer(d.texto):
        if ignorable(m.start()):
            continue
        motivo = m.group(1)
        # En la particion angosta ningun motivo tiene archivo propio: los cuatro
        # viven dentro de manual.md, asi que nombrarlos no manda a ningun lado.
        if motivo not in RAMA_POR_MOTIVO:
            continue
        destino = RAMA_POR_MOTIVO[motivo]
        linea = d.linea_de(m.start())
        ctx = d.contexto(m.start(), m.end())
        nombrados = archivos_nombrados(ctx, nombre)
        if destino == nombre or destino in nombrados:
            lineas_resueltas.add(linea)
            continue
        colgados.append({
            "archivo": nombre,
            "linea": linea,
            "puntero": re.sub(r"\s+", " ", m.group(0).strip()) + "`",
            "vive": [destino],
            "texto": d.lineas[linea - 1].strip(),
        })

    for m in RE_DIRECCIONAL.finditer(d.texto):
        if ignorable(m.start()):
            continue
        pendientes_direccional.append((d.linea_de(m.start()), re.sub(r"\s+", " ", m.group(0))))

    for linea, frase in pendientes_direccional:
        if linea in lineas_resueltas:
            continue  # el mismo renglon ya nombra un destino que resolvio
        revisar.append({
            "archivo": nombre,
            "linea": linea,
            "puntero": frase,
            "texto": d.lineas[linea - 1].strip(),
        })

# --- paths .md que no existen --------------------------------------------
for nombre, d in DOCS.items():
    for m in re.finditer(r"[A-Za-z0-9_\-./]*references/[A-Za-z0-9_\-.]+\.md", d.texto):
        base = os.path.basename(m.group(0))
        if base not in DOCS:
            colgados.append({
                "archivo": nombre,
                "linea": d.linea_de(m.start()),
                "puntero": m.group(0),
                "vive": [],
                "texto": d.lineas[d.linea_de(m.start()) - 1].strip(),
            })

# --- informe --------------------------------------------------------------
def clave(x):
    return (x["archivo"] != "SKILL.md", x["archivo"], x["linea"])


colgados.sort(key=clave)
revisar.sort(key=clave)

print("Candado de punteros — %s" % DIR)
print("%d archivos: SKILL.md + %d ramas\n" % (len(DOCS), len(DOCS) - 1))

if colgados:
    print("PUNTEROS COLGADOS (%d) — el destino no esta en ese archivo y el archivo no dice donde esta:\n" % len(colgados))
    for c in colgados:
        print("  %s:%d" % (c["archivo"], c["linea"]))
        print("    puntero : %s" % c["puntero"])
        if c["vive"]:
            print("    vive en : %s" % ", ".join(c["vive"]))
        else:
            print("    vive en : NINGUN archivo del skill")
        print("    renglon : %s" % c["texto"][:150])
        print()
else:
    print("PUNTEROS COLGADOS: ninguno.\n")

if revisar:
    print("A REVISAR (%d) — direccional sin destino nombrado; confirma a mano que el referente sigue en el archivo:\n" % len(revisar))
    for r in revisar:
        print("  %-28s:%-4d %-18s %s" % (r["archivo"], r["linea"], "«%s»" % r["puntero"], r["texto"][:90]))
    print()

print("%d colgados · %d a revisar" % (len(colgados), len(revisar)))

fallo = len(colgados) > 0 or (ESTRICTO and len(revisar) > 0)
sys.exit(1 if fallo else 0)
PY
