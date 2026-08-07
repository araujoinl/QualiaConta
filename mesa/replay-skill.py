#!/usr/bin/env python3
"""Banco de pruebas A/B: ¿el contable decide lo mismo con la skill partida?

Partir la skill abarata cada turno —el núcleo pesa una fracción de los 26.652
tokens que hoy se inyectan siempre—, pero abaratar no sirve de nada si el
contable empieza a clasificar distinto. Este script contesta esa pregunta ANTES
de desplegar, y la contesta con las decisiones que ya tomó de verdad.

Cómo: rebobina cada sesión real hasta el turno EXACTO en que escribió su
propuesta, le cambia UNA sola cosa —el mensaje de skill que Hermes le inyectó—
y le pide que vuelva a decidir. Todo lo demás (system prompt, herramientas,
comandos que corrió, salidas que recibió) queda idéntico. Lo que salga distinto
sale por la única variable que se movió.

    entera   = el SKILL.md de hoy, los 1.533 renglones
    partida  = el núcleo + SOLO la rama que le toca a esa fila

CERO EFECTOS. No abre Supabase, no toca ADM, no escribe en el server. Lee un
state.db copiado a local y habla con el endpoint del modelo. Nada más.

    ssh codebox 'docker exec qualiaconta-blackbox cat /opt/data/state.db' > /tmp/state.db

Uso:
    export GLM_API_KEY=...                  # o --llave-desde-contenedor
    python3 mesa/replay-skill.py                       # 40 casos, la matriz entera
    python3 mesa/replay-skill.py -n 12 --efforts low   # una pasada corta
    python3 mesa/replay-skill.py --verificar-render    # candados, sin gastar cuota
    python3 mesa/replay-skill.py --verificar-ruteo --bash /opt/homebrew/bin/bash

QUÉ MIDE Y QUÉ NO
─────────────────
Mide el CONTENIDO de las instrucciones: si con menos texto delante el contable
elige el mismo documento de ADM, las mismas cuentas y los mismos montos.

NO mide el ENVOLTORIO. En producción la rama no viaja en el mensaje de skill:
la sirve `abrir-trabajo.sh` como resultado de la primera herramienta, dentro de
sus vallas <<<MESA:INSTRUCCIONES>>>. Acá se inyecta pegada al núcleo porque el
prefijo histórico de cada sesión empieza con el `psql` viejo, y reescribirlo al
mundo nuevo movería DOS variables a la vez y el A/B dejaría de probar nada. Si
un día hay que medir también el envoltorio, el corpus para eso son las sesiones
que corran YA con el router, no éstas.

Tampoco mide las ramas que no dejaron rastro. De las 554 sesiones del state.db
sólo hay ~121 turnos de decisión, y son casi todos facturas `pendiente`: las
sugerencias las escribe el cron detector, no el contable, así que ese estrato
viene VACÍO por más que se lo pida. El reporte lo dice en la cara en vez de
presentar una muestra «balanceada» que no lo está. Las ramas de escribir_libro
y registro_pendiente tampoco producen propuesta: quedan fuera por construcción.

LOS DOS CANDADOS
────────────────
  --verificar-render  arma el mensaje de skill con el SKILL.md viejo y exige
                      que dé BYTE A BYTE el que Hermes guardó en state.db. Si
                      falla, el prompt de la variante `partida` tampoco es el
                      que va a ver el contable y ningún número de acá vale.
  --verificar-ruteo   cruza la tabla de ruteo de este archivo contra la del
                      router de verdad, combinación por combinación. Existe
                      porque acá abajo hay una SEGUNDA copia de esas reglas
                      (ver la lápida en RUTEO) y dos copias derivan solas.
"""

import argparse
import concurrent.futures
import hashlib
import json
import os
import random
import re
import shutil
import sqlite3
import statistics
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SKILL_DIR_REPO = RAIZ / "skills" / "mesa-de-trabajo"
# La ruta con la que Hermes ve la skill DENTRO del contenedor. Va literal en el
# mensaje inyectado ("[Skill directory: ...]" y la lista de archivos sueltos),
# así que tiene que ser la del contenedor y no la del repo local: si acá se
# colara /Users/... el prompt de prueba dejaría de ser el de producción.
SKILL_DIR_CONTENEDOR = "/opt/data/skills/qualiaconta/mesa-de-trabajo"
CONTENEDOR = "qualiaconta-blackbox"

ENDPOINT = "https://api.z.ai/api/coding/paas/v4/chat/completions"
MODELO = "glm-5.2"

# Los códigos con los que z.AI dice «se te acabó la cuota» (no «andá más
# despacio»). Ante éstos NO se reintenta: esperar no los arregla y cada intento
# es una llamada muerta contra la ventana de 5 h. Los mira alerta-cuota.sh con
# la misma lista.
CODIGOS_DE_CUOTA = {"1308", "1310"}


# ══════════════════════════════════════════════════════════════════════════
# 1. El corpus: sacar de state.db las decisiones que el contable ya tomó
# ══════════════════════════════════════════════════════════════════════════

# El motivo viaja al final del mensaje inyectado, en la instrucción del webhook.
PAT_MOTIVO = re.compile(
    r"Actividad en la mesa de trabajo \(([a-z_]+)\): trabajo ([0-9a-f-]{36})"
)
PAT_INSTRUCCION = re.compile(
    r"The user has provided the following instruction alongside the skill invocation: (.*)\Z",
    re.S,
)
CABECERA_SKILL = '[IMPORTANT: The user has invoked the "mesa-de-trabajo" skill'

TIPOS = ("factura", "sugerencia", "criterio", "caso")
ESTADOS = ("pendiente", "analizando", "propuesta", "esperando_respuesta",
           "aprobada", "rechazada", "registrada", "error")

# Un turno de decisión es un comando que ESCRIBE la propuesta en la fila. El
# filtro no puede ser sólo la palabra "propuesta": ése es también el nombre de
# un ESTADO, y `set estado='propuesta'` aparece en media base sin que nadie haya
# decidido nada. Lo que discrimina es que `propuesta` esté del lado izquierdo de
# una asignación, o en la lista de columnas de un insert.
PAT_ESCRIBE_PROPUESTA = re.compile(r"\bpropuesta\s*=|\bpropuesta\s*\)|propuesta\s*,", re.I)
PAT_DML = re.compile(r"\b(update|insert)\b", re.I)

# Claves que sólo tiene una propuesta de verdad. Sirven para no confundirla con
# cualquier otro JSON que ande dando vueltas en el mismo comando (un payload de
# ADM, un dossier del preparador).
CLAVES_DE_PROPUESTA = {"documento_adm", "cuenta_contable", "lineas", "tipo_gasto",
                       "monto", "itbis", "proveedor", "ncf"}


def bloques_balanceados(texto):
    """Todo `{...}` con las llaves cerradas, del más largo al más corto.

    Se busca el más largo primero a propósito: la propuesta ENVUELVE a sus
    sub-objetos (`tipo_gasto`, `dgii`, cada línea), y quedarse con el primero
    que parsee devolvería un pedazo en vez del entero.
    """
    encontrados, pila = [], []
    for i, ch in enumerate(texto):
        if ch == "{":
            pila.append(i)
        elif ch == "}" and pila:
            ini = pila.pop()
            if not pila:
                encontrados.append(texto[ini:i + 1])
    return sorted(encontrados, key=len, reverse=True)


def desescapes(cadena):
    """El mismo JSON escapado de las cuatro formas en que aparece en los logs.

    El contable escribe la propuesta de tres maneras distintas —heredoc
    `<<'SQL'` sin escapar, `psql -c "..."` con las comillas escapadas, y
    cualquiera de las dos con `RD\\$` para que bash no expanda el peso— y encima
    Postgres duplica la comilla simple. Probarlas todas recupera 121 decisiones;
    probar sólo la forma cruda recupera 38.
    """
    vistos = set()
    for comilla in (False, True):
        for peso in (False, True):
            for sql in (False, True):
                x = cadena
                if comilla:
                    x = x.replace('\\"', '"')
                if peso:
                    x = x.replace("\\$", "$")
                if sql:
                    x = x.replace("''", "'")
                if x not in vistos:
                    vistos.add(x)
                    yield x


def extraer_propuesta(comando):
    """La propuesta que ese comando de terminal estaba escribiendo, o None."""
    for bloque in bloques_balanceados(comando):
        claves = set(re.findall(r'\\?"(\w+)\\?"\s*:', bloque))
        if not (CLAVES_DE_PROPUESTA & claves):
            continue
        for candidato in desescapes(bloque):
            try:
                dato = json.loads(candidato)
            except Exception:
                continue
            if isinstance(dato, dict) and (CLAVES_DE_PROPUESTA & set(dato)):
                return dato
    return None


def comando_de(tool_call):
    """El texto del comando de un tool_call de terminal."""
    fn = tool_call.get("function") or {}
    crudo = fn.get("arguments") or ""
    try:
        return json.loads(crudo).get("command") or ""
    except Exception:
        return crudo


def fila_del_transcript(mensajes):
    """(estado, tipo) de la fila, leídos de la primera salida de psql.

    Se leen del transcript y no de la base porque la base ya se movió: esa fila
    hoy está `registrada` y ruteada por otra regla. Lo que hay que reproducir es
    el estado que tenía cuando el contable decidió.
    """
    for m in mensajes[:12]:
        if m["role"] != "tool" or not m["content"]:
            continue
        try:
            salida = json.loads(m["content"]).get("output", "")
        except Exception:
            continue
        for linea in salida.strip().splitlines()[:3]:
            campos = [c.strip() for c in linea.split("|")]
            estado = next((c for c in campos if c in ESTADOS), None)
            tipo = next((c for c in campos if c in TIPOS), None)
            if estado:
                return estado, tipo
    return None, None


def voz_del_transcript(mensajes):
    """Si el hilo ya tenía voz del humano cuando el contable abrió la fila.

    Decide R4 contra R5 en el router, o sea rama-accion-usuario contra
    rama-pendiente: no es un detalle. Se busca en las salidas de la lectura de
    `qualia_eventos`, que es lo que hacía el «Paso 0» del SKILL.md viejo.
    """
    for m in mensajes[:16]:
        if m["role"] != "tool" or not m["content"]:
            continue
        try:
            salida = json.loads(m["content"]).get("output", "")
        except Exception:
            continue
        for linea in salida.splitlines():
            if re.match(r"^\s*\d*\|?\s*usuario\|", linea) or "|usuario|" in linea:
                return "usuario"
    return ""


def hay_precedente(mensajes):
    """Si `buscar-precedente.py` encontró al proveedor en las 1103 históricas.

    Es propiedad de la ENTRADA, no del resultado: se puede usar para estratificar
    la muestra sin contaminarla con la respuesta que se va a puntuar. Y separa
    los dos regímenes que de verdad se comportan distinto — copiar un precedente
    contra razonar de cero.
    """
    for m in mensajes:
        if m["role"] != "tool" or not m["content"]:
            continue
        if "SIN PRECEDENTE" in m["content"]:
            return False
        if "PRECEDENTE" in m["content"]:
            return True
    return None


def cargar_corpus(ruta_db):
    """Las sesiones del contable que llegaron a escribir una propuesta."""
    if not Path(ruta_db).exists():
        sys.exit(f"no existe {ruta_db}. Copialo con:\n"
                 f"  ssh codebox 'docker exec {CONTENEDOR} cat /opt/data/state.db' > {ruta_db}")
    con = sqlite3.connect(f"file:{ruta_db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row

    prompts = {r["id"]: r["system_prompt"] for r in con.execute(
        "select id, system_prompt from sessions")}

    por_sesion = defaultdict(list)
    for m in con.execute("select id, session_id, role, content, tool_call_id, "
                         "tool_calls, tool_name from messages order by id"):
        por_sesion[m["session_id"]].append(dict(m))

    casos, descartes = [], Counter()
    for sid, mensajes in por_sesion.items():
        primero = mensajes[0]
        if primero["role"] != "user" or not (primero["content"] or "").startswith(CABECERA_SKILL):
            descartes["no arranca con la skill inyectada"] += 1
            continue
        mot = PAT_MOTIVO.search(primero["content"])
        ins = PAT_INSTRUCCION.search(primero["content"])
        if not mot or not ins:
            descartes["sin motivo o sin instrucción del webhook"] += 1
            continue

        decision = None
        for m in mensajes:
            if m["role"] != "assistant" or not m["tool_calls"]:
                continue
            for tc in json.loads(m["tool_calls"]):
                cmd = comando_de(tc)
                if "qualia_trabajos" not in cmd:
                    continue
                if not PAT_ESCRIBE_PROPUESTA.search(cmd) or not PAT_DML.search(cmd):
                    continue
                prop = extraer_propuesta(cmd)
                if prop:
                    decision = (m["id"], prop)
                    break
            if decision:
                break
        if not decision:
            descartes["nunca escribió una propuesta"] += 1
            continue

        estado, tipo = fila_del_transcript(mensajes)
        if not estado:
            descartes["no pude leer el estado de la fila"] += 1
            continue

        prefijo, motivo_corte = armar_prefijo(mensajes, decision[0])
        if prefijo is None:
            descartes[motivo_corte] += 1
            continue

        casos.append({
            "sesion": sid,
            "motivo": mot.group(1),
            "trabajo_id": mot.group(2),
            "instruccion": ins.group(1).strip(),
            "system_prompt": prompts.get(sid) or "",
            "estado": estado,
            "tipo": tipo or "",
            "voz": voz_del_transcript(mensajes),
            "precedente": hay_precedente(mensajes),
            "prefijo": prefijo,
            "referencia": decision[1],
            "msg_decision": decision[0],
        })
    return casos, descartes, len(por_sesion)


def armar_prefijo(mensajes, id_decision):
    """La conversación tal cual quedó, hasta el turno de decisión sin incluirlo.

    Devuelve (mensajes, None) o (None, motivo del descarte). El mensaje de skill
    NO va: lo pone la variante. Cada assistant con tool_calls tiene que quedar
    seguido por UN resultado por llamada y en el orden de las llamadas — el API
    rechaza cualquier otra cosa, y el state.db guarda los resultados en orden de
    llegada, que no siempre es el de salida.
    """
    resultados = {m["tool_call_id"]: m for m in mensajes
                  if m["role"] == "tool" and m["tool_call_id"]}
    fuera = []
    for m in mensajes:
        if m["id"] >= id_decision:
            break
        if m["role"] == "session_meta":
            continue
        if m["role"] == "user":
            if m is mensajes[0]:
                continue          # el mensaje de skill lo pone la variante
            fuera.append({"role": "user", "content": m["content"] or ""})
        elif m["role"] == "assistant":
            msg = {"role": "assistant", "content": m["content"] or ""}
            if m["tool_calls"]:
                llamadas = json.loads(m["tool_calls"])
                # Un tool_call sin resultado deja la conversación inválida. Pasa
                # en 9 de 554 sesiones (turnos que murieron a mitad), así que se
                # descarta el caso entero antes que fabricarle una salida: una
                # salida inventada cambia lo que el modelo decide, que es
                # justamente lo que este banco mide.
                if any(tc["id"] not in resultados for tc in llamadas):
                    return None, "turno con tool_call sin resultado"
                msg["tool_calls"] = [{
                    "id": tc["id"],
                    "type": "function",
                    "function": {"name": tc["function"]["name"],
                                 "arguments": tc["function"]["arguments"]},
                } for tc in llamadas]
                fuera.append(msg)
                for tc in llamadas:
                    r = resultados[tc["id"]]
                    fuera.append({"role": "tool", "tool_call_id": tc["id"],
                                  "content": r["content"] or ""})
                continue
            if msg["content"]:
                fuera.append(msg)
        # los role='tool' ya se emitieron pegados a su assistant
    return fuera, None


# ══════════════════════════════════════════════════════════════════════════
# 2. El prompt: reproducir el mensaje que Hermes inyecta
# ══════════════════════════════════════════════════════════════════════════

NOTA_ACTIVACION = ('[IMPORTANT: The user has invoked the "mesa-de-trabajo" skill, '
                   "indicating they want you to follow its instructions. "
                   "The full skill content is loaded below.]")


def render_mensaje_skill(cuerpo, instruccion, satelites):
    """Copia fiel de `_build_skill_message` (agent/skill_commands.py de Hermes).

    Se reproduce en vez de aproximarse porque el bloque de archivos satélite y
    la línea del directorio son parte del prompt que paga la cuota, y porque el
    candado `--verificar-render` sólo cierra si esto sale idéntico al byte.

    `satelites` son las rutas relativas de references/, templates/, scripts/ y
    assets/, ordenadas; Hermes las lista siempre que existan, mire el agente esos
    archivos o no.
    """
    partes = [NOTA_ACTIVACION, "", cuerpo.strip()]
    partes += ["", f"[Skill directory: {SKILL_DIR_CONTENEDOR}]",
               "Resolve any relative paths in this skill (e.g. `scripts/foo.js`, "
               "`templates/config.yaml`) against that directory, then run them "
               "with the terminal tool using the absolute path."]
    if satelites:
        partes += ["", "[This skill has supporting files:]"]
        for s in satelites:
            partes.append(f"- {s}  ->  {SKILL_DIR_CONTENEDOR}/{s}")
        partes.append(f'\nLoad any of these with skill_view(name="qualiaconta/mesa-de-trabajo", '
                      f'file_path="<path>"), or run scripts directly by absolute path '
                      f"(e.g. `node {SKILL_DIR_CONTENEDOR}/scripts/foo.js`).")
    if instruccion:
        partes += ["", "The user has provided the following instruction alongside "
                       f"the skill invocation: {instruccion}"]
    return "\n".join(partes)


def satelites_del_repo(skill_dir):
    """Los archivos que Hermes va a listar al pie de la skill."""
    fuera = []
    for sub in ("references", "templates", "scripts", "assets"):
        d = skill_dir / sub
        if not d.exists():
            continue
        for f in sorted(d.rglob("*")):
            if f.is_file() and not f.is_symlink():
                fuera.append(str(f.relative_to(skill_dir)))
    return fuera


# ── Ruteo ────────────────────────────────────────────────────────────────
#
# ⚠ LÁPIDA — ESTA ES UNA SEGUNDA COPIA DE LAS REGLAS DEL ROUTER.
#
# La autoridad es `skills/mesa-de-trabajo/scripts/abrir-trabajo.sh` (reglas
# R1-R11). Acá se repiten porque ese script lee la fila con `psql` contra la
# base viva, y este banco tiene que rutear por el estado que la fila tenía HACE
# DÍAS —el que quedó en el transcript—, no por el de hoy. Encima el script usa
# un heredoc dentro de `$( )` que bash 3.2 (el de macOS) no parsea, así que en
# la máquina de trabajo ni siquiera arranca.
#
# Dos copias derivan solas. Por eso existe `--verificar-ruteo`, que corre el
# router de verdad sobre TODA la grilla (tipo × estado × voz × docid × libro) y
# exige que las dos digan lo mismo. Si tocás una de las dos tablas y no corrés
# esa verificación, los números de este banco pasan a medir una partición que
# nadie va a desplegar.
#
# `docid` y `libro` no salen del transcript: se asumen ausentes/cero, que es lo
# que vale para una fila que todavía está decidiéndose. El campo `ruteo_asumido`
# del JSON marca los casos donde esa suposición podía cambiar la rama.
RUTEO_TODAS = "TODAS"


def rutear(tipo, estado, voz, docid="", libro="0"):
    """Qué rama le toca a esa fila. Devuelve el nombre del archivo o RUTEO_TODAS."""
    if tipo not in TIPOS:
        return RUTEO_TODAS
    if tipo == "caso":
        return "rama-caso.md"                       # R1
    if tipo == "criterio":
        return "rama-criterio.md"                   # R2
    if estado not in ESTADOS:
        return RUTEO_TODAS
    if estado == "analizando":
        return None                                 # R3 — nada que hacer
    if estado == "pendiente" and voz == "usuario":
        return "rama-accion-usuario.md"             # R4
    if estado == "pendiente":
        return "rama-pendiente.md"                  # R5
    if estado == "aprobada" and not docid:
        return "rama-registro-pendiente.md"         # R6
    if estado == "registrada" and libro == "0":
        return "rama-escribir-libro.md"             # R7
    if estado == "aprobada" and docid and libro == "0":
        return "rama-escribir-libro.md"             # R8
    if estado in ("propuesta", "esperando_respuesta", "rechazada", "error"):
        return "rama-accion-usuario.md"             # R9
    if estado in ("aprobada", "registrada") and voz == "usuario":
        return "rama-accion-usuario.md"             # R10
    if estado in ("aprobada", "registrada"):
        return None                                 # R11 — nada que hacer
    return RUTEO_TODAS


# La rama `pendiente` se entrega en tres archivos por mantenibilidad, pero es
# UNA sola rama: así la definió `archivos_de_rama()` del router y así se aprobó
# el alcance (SKILL.md 118-774).
ORDEN_CANONICO = [
    "rama-pendiente.md", "ref-registro-adm.md", "ref-clasificacion.md",
    "rama-accion-usuario.md", "rama-escribir-libro.md", "rama-registro-pendiente.md",
    "rama-criterio.md", "rama-caso.md",
]


def archivos_de(rama, skill_dir, docid=""):
    """Qué archivos compone cada rama — se lo pregunta AL ROUTER, no lo copia.

    Tener la tabla acá fue un error y se pagó enseguida: la copia le daba
    `ref-registro-adm.md` al análisis (que no le toca, 12.048 chars de más) y
    dejaba a `accion_usuario` sin ninguno de los dos refs. O sea que el banco
    medía payloads que en producción no existen, y habría dado por buena una
    partición distinta de la que corre. Una sola fuente de verdad:
    `abrir-trabajo.sh --archivos-de`.
    """
    if rama == RUTEO_TODAS:
        rama = "TODAS"      # el degrade también lo dicta el router, y el ORDEN importa
    router = Path(skill_dir) / "scripts" / "abrir-trabajo.sh"
    entorno = dict(os.environ, DOCID=docid or "")
    salida = subprocess.run(["bash", str(router), "--archivos-de", rama],
                            capture_output=True, text=True, env=entorno)
    if salida.returncode != 0 or not salida.stdout.strip():
        sys.exit(f"el router no supo qué archivos lleva {rama}: "
                 f"{salida.stderr.strip()[:200]}")
    return salida.stdout.split()


def cuerpo_partido(caso, skill_dir):
    """Núcleo + la rama del caso, tal cual saldría del router."""
    rama = rutear(caso["tipo"], caso["estado"], caso["voz"])
    if rama is None:
        # R3/R11: el router diría «no hay nada que hacer». Un caso así no
        # debería estar en el corpus (llegó a escribir una propuesta), así que
        # degrada a todas: no adivinar es la regla, acá también.
        rama = RUTEO_TODAS
    partes = [(skill_dir / "SKILL.md").read_text(encoding="utf-8").strip()]
    for archivo in archivos_de(rama, skill_dir, caso.get("docid", "")):
        ruta = skill_dir / "references" / archivo
        if not ruta.exists():
            sys.exit(f"falta la rama {ruta} — ¿está publicada la partición?")
        partes.append(ruta.read_text(encoding="utf-8").strip())
    return "\n\n".join(partes), rama


# ══════════════════════════════════════════════════════════════════════════
# 3. Las herramientas que ve el modelo
# ══════════════════════════════════════════════════════════════════════════

# Las tres del canal webhook. Se bajan del contenedor porque una descripción de
# herramienta distinta cambia lo que el modelo hace con ella, y `terminal` sola
# pesa varios miles de caracteres de prosa. Si no se pueden bajar se usa el
# molde mínimo de abajo: las DOS variantes reciben exactamente el mismo toolset,
# así que un desvío ahí baja la fidelidad absoluta pero no sesga la comparación.
MOLDE_MINIMO = [
    {"type": "function", "function": {
        "name": "terminal",
        "description": "Execute shell commands on a Linux environment.",
        "parameters": {"type": "object", "properties": {
            "command": {"type": "string"},
            "timeout": {"type": "integer"}}, "required": ["command"]}}},
    {"type": "function", "function": {
        "name": "vision_analyze",
        "description": "Analyze an image and answer a question about it.",
        "parameters": {"type": "object", "properties": {
            "image_url": {"type": "string"},
            "question": {"type": "string"}}, "required": ["image_url", "question"]}}},
]

VOLCADO_TOOLS = r"""
import sys, json
sys.path.insert(0, '/opt/hermes')
from tools.terminal_tool import TERMINAL_SCHEMA
from tools.vision_tools import VISION_ANALYZE_SCHEMA
import tools.process_registry as pr
proc = [v for v in vars(pr).values() if isinstance(v, dict) and v.get('name') == 'process']
esquemas = [TERMINAL_SCHEMA, VISION_ANALYZE_SCHEMA] + proc[:1]
print(json.dumps([{'type': 'function', 'function': e} for e in esquemas]))
"""


def herramientas(cache_dir, sin_ssh):
    destino = cache_dir / "tools.json"
    if destino.exists():
        return json.loads(destino.read_text()), "contenedor (cacheado)"
    if sin_ssh:
        return MOLDE_MINIMO, "molde mínimo (--sin-ssh)"
    r = subprocess.run(["ssh", "codebox", f"docker exec -i {CONTENEDOR} python3 -"],
                       input=VOLCADO_TOOLS, capture_output=True, text=True)
    linea = (r.stdout or "").strip().splitlines()[-1:] or [""]
    try:
        esquemas = json.loads(linea[0])
    except Exception:
        print("AVISO: no pude bajar los esquemas de herramientas del contenedor; "
              "uso el molde mínimo. La comparación sigue siendo válida (las dos "
              "variantes reciben lo mismo), la fidelidad absoluta baja.",
              file=sys.stderr)
        return MOLDE_MINIMO, "molde mínimo (ssh falló)"
    destino.write_text(json.dumps(esquemas))
    return esquemas, "contenedor"


# ══════════════════════════════════════════════════════════════════════════
# 4. La llamada al modelo
# ══════════════════════════════════════════════════════════════════════════

class CuotaAgotada(Exception):
    """429 de cuota (1308/1310): esperar no lo arregla."""


_freno = threading.Lock()
_frenado_hasta = [0.0]


def llamar_modelo(llave, mensajes, tools, effort, intentos=5, timeout=300):
    """Una llamada. Devuelve (respuesta, latencia). Backoff ante 429 de ritmo."""
    cuerpo = {
        "model": MODELO,
        "messages": mensajes,
        "tools": tools,
        "tool_choice": "auto",
        "stream": False,
        # Top-level, que es como lo manda Hermes (verificado en sus dumps). Los
        # SDK que lo meten adentro de `reasoning_config` obtienen un 200 con el
        # razonamiento igual de largo: el campo se ignora en silencio, y eso es
        # peor que un error porque la medición sale falsa.
        "reasoning_effort": effort,
    }
    datos = json.dumps(cuerpo).encode()
    ultimo = None
    for intento in range(intentos):
        # Un 429 de ritmo frena a TODOS los hilos, no sólo al que lo comió: con
        # 18 en paralelo z.AI devolvió 464 rechazos seguidos, que es lo que pasa
        # cuando cada hilo reintenta por su cuenta contra un tope compartido.
        with _freno:
            espera = _frenado_hasta[0] - time.monotonic()
        if espera > 0:
            time.sleep(espera)
        req = urllib.request.Request(
            ENDPOINT, data=datos,
            headers={"Authorization": f"Bearer {llave}",
                     "Content-Type": "application/json"})
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read()), time.monotonic() - t0
        except urllib.error.HTTPError as exc:
            crudo = exc.read().decode(errors="ignore")
            ultimo = f"HTTP {exc.code}: {crudo[:300]}"
            if exc.code == 429:
                codigo = re.search(r'"code"\s*:\s*"?(\d{4})"?', crudo)
                if codigo and codigo.group(1) in CODIGOS_DE_CUOTA:
                    raise CuotaAgotada(f"z.AI code {codigo.group(1)} — cuota de 5 h agotada")
                pausa = min(60, 4 * (2 ** intento))
                with _freno:
                    _frenado_hasta[0] = max(_frenado_hasta[0], time.monotonic() + pausa)
                continue
            if exc.code < 500:
                break
            time.sleep(2 * (intento + 1))
        except Exception as exc:                       # red, timeout
            ultimo = f"{type(exc).__name__}: {exc}"
            time.sleep(2 * (intento + 1))
    raise RuntimeError(ultimo or "sin respuesta")


def uso_de(respuesta):
    """prompt/cached/completion, aceptando las tres formas en que vienen."""
    u = respuesta.get("usage") or {}
    det = u.get("prompt_tokens_details") or {}
    cacheados = (det.get("cached_tokens")
                 or u.get("prompt_cache_hit_tokens")
                 or u.get("cached_tokens") or 0)
    return {
        "prompt_tokens": u.get("prompt_tokens") or 0,
        "cached_tokens": cacheados,
        "completion_tokens": u.get("completion_tokens") or 0,
        "reasoning_tokens": ((u.get("completion_tokens_details") or {})
                             .get("reasoning_tokens") or 0),
    }


def propuesta_de_la_respuesta(respuesta):
    """Lo que el modelo propuso en ESE turno, o None si no propuso nada.

    «No propuso» no es un error del banco: es un resultado. Si con la skill
    partida el contable pide una consulta más antes de decidir, eso cuesta un
    turno y hay que verlo en la tabla, no taparlo con un reintento.
    """
    msg = ((respuesta.get("choices") or [{}])[0].get("message")) or {}
    for tc in msg.get("tool_calls") or []:
        cmd = comando_de(tc)
        if "qualia_trabajos" not in cmd:
            continue
        if not PAT_ESCRIBE_PROPUESTA.search(cmd) or not PAT_DML.search(cmd):
            continue
        prop = extraer_propuesta(cmd)
        if prop:
            return prop
    return None


# ══════════════════════════════════════════════════════════════════════════
# 5. La comparación: sólo lo que mueve plata
# ══════════════════════════════════════════════════════════════════════════
#
# El texto libre (`resumen`, `detalle`, `notas`) NO se puntúa. Difiere SIEMPRE,
# entre dos corridas de la misma variante también, y no cambia un asiento.
# Puntuarlo daría un porcentaje de coincidencia bajo y sin significado, que es
# la forma más rápida de que un banco de pruebas deje de leerse.

# Los alias salen del censo de las 121 propuestas reales, no de suposiciones:
# `monto` 119, `itbis` 117. `base` NO existe como clave de primer nivel —hay 2
# `base_gravada` en todo el corpus—, así que se puntúa cuando aparece y se
# reporta «n/a» cuando no, en vez de contar como acierto un campo que ninguna de
# las dos partes escribió.
ALIAS_MONTO = {
    "monto": ("monto", "total", "monto_total"),
    "itbis": ("itbis", "impuesto"),
    "base": ("base", "base_gravada", "subtotal_gravado", "subtotal"),
}


def _primero(dic, claves):
    for k in claves:
        if k in dic and dic[k] is not None:
            return dic[k]
    return None


def campos_que_mueven_plata(prop):
    """Los campos comparables de una propuesta. None = no lo escribió."""
    if not isinstance(prop, dict):
        return {}
    tg = prop.get("tipo_gasto")
    if isinstance(tg, dict):
        tg = tg.get("codigo")
    elif isinstance(tg, str):
        tg = tg.strip().split()[0] if tg.strip() else None

    lineas = prop.get("lineas")
    cuentas = None
    if isinstance(lineas, list):
        # Multiset y no lista: el ORDEN de los renglones es cosmético, lo que
        # mueve plata es a qué cuentas va y cuántas veces. Ordenarlas evita
        # marcar como distinta una propuesta idéntica escrita al revés.
        cuentas = sorted(str(l.get("cuenta")).strip()
                         for l in lineas if isinstance(l, dict) and l.get("cuenta") is not None)

    campos = {
        "documento_adm": (str(prop["documento_adm"]).strip()
                          if prop.get("documento_adm") is not None else None),
        "cuenta_contable": (str(prop["cuenta_contable"]).strip()
                            if prop.get("cuenta_contable") is not None else None),
        "tipo_gasto": str(tg).strip() if tg is not None else None,
        "lineas_cuentas": cuentas,
    }
    for nombre, claves in ALIAS_MONTO.items():
        v = _primero(prop, claves)
        try:
            campos[nombre] = round(float(v), 2) if v is not None else None
        except (TypeError, ValueError):
            campos[nombre] = None
    return campos


def comparar(referencia, candidata):
    """{campo: 'igual' | 'distinto' | 'n/a'} + el detalle de lo distinto."""
    a, b = campos_que_mueven_plata(referencia), campos_que_mueven_plata(candidata)
    veredicto, diffs = {}, {}
    for campo in ("documento_adm", "cuenta_contable", "tipo_gasto",
                  "lineas_cuentas", "monto", "itbis", "base"):
        va, vb = a.get(campo), b.get(campo)
        if va is None and vb is None:
            veredicto[campo] = "n/a"       # ninguna de las dos lo escribió
            continue
        if campo in ("monto", "itbis", "base"):
            igual = (va is not None and vb is not None and abs(va - vb) < 0.005)
        elif campo == "lineas_cuentas":
            igual = va == vb
        else:
            igual = (va or "").lower() == (vb or "").lower()
        veredicto[campo] = "igual" if igual else "distinto"
        if not igual:
            diffs[campo] = {"real": va, "replay": vb}
    return veredicto, diffs


# ══════════════════════════════════════════════════════════════════════════
# 6. Muestreo
# ══════════════════════════════════════════════════════════════════════════

def estrato(caso):
    prec = {True: "con precedente", False: "sin precedente", None: "precedente ?"}[caso["precedente"]]
    return f"{caso['tipo'] or '¿tipo?'}/{caso['estado']} · {prec}"


def muestrear(casos, n, semilla):
    """Round-robin entre estratos: cada uno aporta antes de que ninguno repita.

    No se rellena el estrato vacío con casos de otro. Si de `sugerencia` no hay
    decisiones en el state.db, la muestra sale sin sugerencias y el reporte lo
    dice — una muestra que se dice balanceada sin serlo es peor que una chica.
    """
    grupos = defaultdict(list)
    for c in sorted(casos, key=lambda c: c["sesion"]):
        grupos[estrato(c)].append(c)
    rnd = random.Random(semilla)
    for g in grupos.values():
        rnd.shuffle(g)
    elegidos, claves = [], sorted(grupos)
    while len(elegidos) < n and any(grupos[k] for k in claves):
        for k in claves:
            if grupos[k] and len(elegidos) < n:
                elegidos.append(grupos[k].pop())
    return elegidos


# ══════════════════════════════════════════════════════════════════════════
# 7. Candados
# ══════════════════════════════════════════════════════════════════════════

def verificar_render(ruta_db, skill_original):
    """El renderizador tiene que reproducir el mensaje que Hermes ya guardó.

    Se compara contra el SKILL.md VIEJO (sin references/, o sea sin bloque de
    satélites) porque es el que produjo los mensajes que están en state.db. Si
    esto no cierra al byte, el prompt de la variante `partida` tampoco es el que
    va a ver el contable y no hay número de este banco que valga.

    Se cuenta la RACHA desde la sesión más nueva hacia atrás, no el total: el
    SKILL.md se editó decenas de veces y los mensajes viejos llevan el texto de
    ese día. Un total bajo no dice nada; una racha de cero sí — significaría que
    ni siquiera el mensaje de ayer se puede reproducir.
    """
    cuerpo = Path(skill_original).read_text(encoding="utf-8")
    con = sqlite3.connect(f"file:{ruta_db}?mode=ro", uri=True)
    filas = con.execute(
        "select session_id, content from messages where role='user' "
        "and content like ? order by id desc limit 400", (CABECERA_SKILL + "%",)).fetchall()
    racha, corte = 0, None
    for sid, contenido in filas:
        ins = PAT_INSTRUCCION.search(contenido)
        if not ins:
            continue
        armado = render_mensaje_skill(cuerpo, ins.group(1).strip(), satelites=[])
        if armado == contenido:
            racha += 1
            continue
        corte = (sid, armado, contenido)
        break

    print(f"render: {racha} mensajes reproducidos byte a byte, desde el más nuevo")
    if corte:
        sid, armado, real = corte
        print(f"        la racha se corta en {sid} (armado {len(armado)} b, real {len(real)} b).")
        for i, (x, y) in enumerate(zip(armado, real)):
            if x != y:
                print(f"        primer byte distinto en {i}")
                print(f"          armado: ...{armado[max(0, i - 70):i + 70]!r}")
                print(f"          real  : ...{real[max(0, i - 70):i + 70]!r}")
                break
        else:
            sobra = (armado if len(armado) > len(real) else real)[min(len(armado), len(real)):]
            print(f"        uno es prefijo del otro; sobra: {sobra[:200]!r}")
        print("        Si el desvío es texto de la skill, es una edición de ese día y está")
        print("        bien. Si es la envoltura (la nota de activación, el bloque de")
        print("        satélites, la línea de la instrucción), el renderizador está mal.")
    if racha == 0:
        print("FALLA: no reproduje NI UNO. El prompt de prueba no es el de producción.",
              file=sys.stderr)
    return 0 if racha else 1


def verificar_ruteo(bash, skill_dir):
    """La tabla de acá contra el router de verdad, combinación por combinación.

    Se le habla al router con un `psql` de mentira en el PATH que le sirve una
    fila armada a mano: así corre su ruteo REAL sin tocar la base. Necesita bash
    ≥ 4 — el de macOS es 3.2 y no parsea el heredoc dentro de `$( )` del script.
    """
    router = skill_dir / "scripts" / "abrir-trabajo.sh"
    if not router.exists():
        print(f"no existe {router}", file=sys.stderr)
        return 1
    ver = subprocess.run([bash, "-c", "echo $BASH_VERSINFO"], capture_output=True, text=True)
    if not (ver.stdout or "0").strip().isdigit() or int(ver.stdout.strip()) < 4:
        print(f"'{bash}' es bash {ver.stdout.strip() or '?'}: el router necesita ≥ 4.\n"
              "En macOS: brew install bash, y después --bash /opt/homebrew/bin/bash.",
              file=sys.stderr)
        return 2

    tmp = Path(tempfile.mkdtemp(prefix="replay-ruteo-"))
    (tmp / "bin").mkdir()
    shim = tmp / "bin" / "psql"
    shim.write_text('#!/bin/sh\ncat -- "$MESA_REPLAY_FILA"\n')
    shim.chmod(0o755)
    (tmp / "dossier").mkdir()
    fila_txt = tmp / "fila.txt"

    entorno = dict(os.environ)
    entorno.update({
        "PATH": f"{tmp / 'bin'}:{entorno['PATH']}",
        "MESA_REPLAY_FILA": str(fila_txt),
        "QUALIA_DSN": "postgresql://replay/no-se-usa",
        "QUALIA_EMPRESA_ID": "00000000-0000-0000-0000-000000000001",
        "MESA_RAMAS_DIR": str(skill_dir / "references"),
        "MESA_DOSSIER_DIR": str(tmp / "dossier"),
    })
    ID = "11111111-2222-3333-4444-555555555555"

    desacuerdos = probadas = 0
    for tipo in TIPOS + ("desconocido",):
        for estado in ESTADOS + ("desconocido",):
            for voz in ("", "usuario", "contable"):
                for docid in ("", "FP00000001"):
                    for libro in ("0", "1"):
                        campos = [tipo, estado, "web", "2026-08-01T00:00:00.000000Z",
                                  "x.pdf", "no", "r", "", "", "", docid, "",
                                  "0", libro, voz, "", "1"]
                        # El separador es US (0x1f), NO tab: es el que usa el
                        # router (`SEP=$'\x1f'`) justamente porque el US no es
                        # whitespace y los campos vacíos se conservan. Con tabs
                        # el router leía la fila entera como un solo campo, no
                        # reconocía el tipo y degradaba a las 8 ramas — o sea
                        # que este chequeo daba 540 desacuerdos de 540 y no
                        # probaba nada.
                        fila_txt.write_text("@@FILA@@\n" + "\x1f".join(campos) +
                                            "\n@@PROPUESTA@@\n\n@@CLAVES@@\n\n"
                                            "@@EVENTOS@@\n(sin eventos)\n")
                        r = subprocess.run([bash, str(router), ID], env=entorno,
                                           capture_output=True, text=True)
                        archivos_router = re.findall(
                            r"<<<MESA:INSTRUCCIONES rama=([^>]+)>>>", r.stdout)
                        mio = rutear(tipo, estado, voz, docid, libro)
                        # Lo que se compara acá es `rutear()` — QUÉ rama elige,
                        # que sigue siendo una reimplementación independiente
                        # del router. La lista de archivos ya no lo es: se la
                        # pide al propio router, justamente para que no vuelva a
                        # desincronizarse. Este check cubre la mitad que importa.
                        archivos_mios = ([] if mio is None
                                         else archivos_de(mio, Path(router).parent.parent, docid))
                        probadas += 1
                        if archivos_router != archivos_mios:
                            desacuerdos += 1
                            if desacuerdos <= 8:
                                print(f"DESACUERDO tipo={tipo} estado={estado} voz={voz!r} "
                                      f"docid={bool(docid)} libro={libro}\n"
                                      f"  router : {archivos_router}\n"
                                      f"  replay : {archivos_mios}")
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"ruteo: {probadas} combinaciones · {desacuerdos} desacuerdos")
    return 0 if desacuerdos == 0 else 1


# ══════════════════════════════════════════════════════════════════════════
# 8. Orquestación
# ══════════════════════════════════════════════════════════════════════════

def leer_llave(desde_contenedor):
    """La llave sale del entorno o de la memoria del contenedor. Nunca del disco.

    No se cachea, no se imprime, no entra al JSON de resultados. `--llave-desde-
    contenedor` existe para no tener que pegarla en la shell (y en el historial).
    """
    llave = os.environ.get("GLM_API_KEY") or ""
    if llave:
        return llave
    if desde_contenedor:
        r = subprocess.run(
            ["ssh", "codebox", f"docker exec {CONTENEDOR} printenv GLM_API_KEY"],
            capture_output=True, text=True)
        llave = (r.stdout or "").strip()
    if not llave:
        sys.exit("falta GLM_API_KEY. Exportala, o usá --llave-desde-contenedor.")
    return llave


def clave_de_cache(caso, variante, effort, mensajes):
    """Huella del prompt COMPLETO, no del caso.

    Cachear por (caso, variante, effort) a secas sería una trampa: al editar una
    rama, la corrida siguiente devolvería las respuestas de la partición vieja y
    el reporte diría que todo sigue igual. Con la huella del prompt, tocar un
    archivo invalida sólo lo que cambió.
    """
    h = hashlib.sha256()
    h.update(json.dumps(mensajes, sort_keys=True, ensure_ascii=False).encode())
    h.update(f"|{MODELO}|{effort}".encode())
    return f"{caso['sesion']}.{variante}.{effort}.{h.hexdigest()[:16]}.json"


def una_corrida(caso, variante, effort, llave, tools, cache_dir, skill_dir,
                skill_original, satelites):
    if variante == "entera":
        cuerpo = Path(skill_original).read_text(encoding="utf-8")
        rama = "(entera)"
        sats = []          # el mundo viejo no tenía references/
    else:
        cuerpo, rama = cuerpo_partido(caso, skill_dir)
        sats = satelites

    mensajes = []
    if caso["system_prompt"]:
        mensajes.append({"role": "system", "content": caso["system_prompt"]})
    mensajes.append({"role": "user",
                     "content": render_mensaje_skill(cuerpo, caso["instruccion"], sats)})
    mensajes += caso["prefijo"]

    archivo = cache_dir / clave_de_cache(caso, variante, effort, mensajes)
    if archivo.exists():
        salida = json.loads(archivo.read_text())
        salida["cacheado"] = True
        return salida

    respuesta, latencia = llamar_modelo(llave, mensajes, tools, effort)
    propuesta = propuesta_de_la_respuesta(respuesta)
    veredicto, diffs = comparar(caso["referencia"], propuesta) if propuesta else ({}, {})
    salida = {
        "sesion": caso["sesion"], "trabajo_id": caso["trabajo_id"],
        "motivo": caso["motivo"], "tipo": caso["tipo"], "estado": caso["estado"],
        "estrato": estrato(caso), "variante": variante, "effort": effort,
        "rama": rama, "propuso": propuesta is not None,
        "veredicto": veredicto, "diffs": diffs,
        "propuesta_replay": propuesta, "propuesta_real": caso["referencia"],
        "latencia_s": round(latencia, 2), "uso": uso_de(respuesta),
        "cacheado": False,
    }
    archivo.write_text(json.dumps(salida, ensure_ascii=False, indent=1))
    return salida


CAMPOS = ("documento_adm", "cuenta_contable", "tipo_gasto", "lineas_cuentas",
          "monto", "itbis", "base")

# La ventana de z.AI se mide en TOKENS DE ENTRADA, y los cacheados cuentan
# igual: los dos cortes que hay en el log se produjeron con 15,20 M y 15,10 M de
# entrada (0,7% de diferencia) contra 666 y 690 llamadas (3,5%). Cada caso de
# este banco arrastra ~38k tokens de prompt, así que una matriz completa de 40
# casos gasta más de la mitad de la ventana. Reventarla no es un inconveniente
# del banco: deja al contable mudo cinco horas, con las facturas subidas
# esperando. Por eso la corrida se frena sola y hay que decirle que sí.
TOPE_VENTANA = 15_000_000
CHARS_POR_TOKEN = 3.34            # medido sobre la skill real


def reportar(resultados, corpus, muestra, descartes, n_sesiones, origen_tools,
             ruteo_verificado):
    print()
    print(f"corpus     {len(corpus)} turnos de decisión utilizables, de {n_sesiones} sesiones del state.db")
    for k, v in descartes.most_common():
        print(f"           {v:5d} descartadas: {k}")
    print()
    print(f"muestra    {len(muestra)} casos")
    for k, v in sorted(Counter(estrato(c) for c in muestra).items()):
        print(f"           {v:5d}  {k}")
    faltan = {"sugerencia", "criterio"} - {c["tipo"] for c in muestra}
    if faltan:
        print(f"           OJO: sin casos de tipo {', '.join(sorted(faltan))} — esas ramas")
        print("                NO quedan probadas por esta corrida (el state.db no tiene")
        print("                decisiones suyas: las escribe el cron, no el contable).")
    print()
    print(f"tools      {origen_tools}")
    print(f"ruteo      {'verificado contra abrir-trabajo.sh' if ruteo_verificado else 'NO verificado contra el router (corré --verificar-ruteo)'}")

    if not resultados:
        return
    print()
    print("            propuso  " + "  ".join(f"{c[:9]:>9}" for c in CAMPOS)
          + "   lat_s   in    cache   out")
    for variante in ("entera", "partida"):
        for effort in ("medium", "low", "minimal"):
            filas = [r for r in resultados if r["variante"] == variante and r["effort"] == effort]
            if not filas:
                continue
            propusieron = [r for r in filas if r["propuso"]]
            celdas = []
            for campo in CAMPOS:
                vals = [r["veredicto"].get(campo) for r in propusieron]
                comparables = [v for v in vals if v in ("igual", "distinto")]
                if not comparables:
                    celdas.append(f"{'n/a':>9}")
                else:
                    pct = 100 * sum(v == "igual" for v in comparables) / len(comparables)
                    celdas.append(f"{pct:6.0f}% {len(comparables):>2}")
            lat = statistics.median(r["latencia_s"] for r in filas) if filas else 0
            def prom(k):
                vs = [r["uso"].get(k, 0) for r in filas]
                return sum(vs) / len(vs) if vs else 0
            print(f"{variante:<8}{effort:<8}{len(propusieron):>3}/{len(filas):<4}"
                  + "  ".join(celdas)
                  + f"  {lat:6.1f} {prom('prompt_tokens'):7,.0f} "
                    f"{prom('cached_tokens'):7,.0f} {prom('completion_tokens'):6,.0f}")
    print("            (cada celda: % de coincidencia · casos comparables — "
          "'n/a' = ninguna de las dos partes escribió el campo)")

    distintos = [r for r in resultados if r["diffs"]]
    if distintos:
        print()
        print(f"donde difirió ({len(distintos)} de {len(resultados)}):")
        for r in sorted(distintos, key=lambda r: (r["variante"], r["effort"], r["sesion"])):
            print(f"  {r['variante']:<8}{r['effort']:<8}{r['sesion']}  {r['rama']}")
            for campo, d in r["diffs"].items():
                print(f"      {campo:<16} real={d['real']!r}  replay={d['replay']!r}")

    mudos = [r for r in resultados if not r["propuso"]]
    if mudos:
        etiquetas = sorted({r["variante"] + "/" + r["effort"] for r in mudos})
        print()
        print(f"no decidieron en el turno ({len(mudos)}): " + ", ".join(etiquetas))
        print("  Un turno extra por caso es costo real: mirá si se concentra en una variante.")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("-n", "--casos", type=int, default=40)
    ap.add_argument("--efforts", default="medium,low,minimal",
                    help="lista separada por comas")
    ap.add_argument("--variantes", default="entera,partida")
    ap.add_argument("--db", default="/tmp/state.db")
    ap.add_argument("--skill-original", default="/tmp/SKILL-original.md",
                    help="el SKILL.md de 1.533 líneas, antes de partirlo")
    ap.add_argument("--skill-dir", default=str(SKILL_DIR_REPO))
    ap.add_argument("--cache-dir", default="/tmp/replay-skill")
    ap.add_argument("--salida", default="/tmp/replay-skill/resultados.json")
    ap.add_argument("--concurrencia", type=int, default=3,
                    help="bajo a propósito: con 18 en paralelo z.AI devolvió 464 rechazos")
    ap.add_argument("--semilla", type=int, default=20260807)
    ap.add_argument("--llave-desde-contenedor", action="store_true")
    ap.add_argument("--tope-ventana-pct", type=float, default=40.0,
                    help="freno: %% de la ventana de 5 h que la corrida puede gastar")
    ap.add_argument("--acepto-la-cuota", action="store_true",
                    help="corré igual aunque pase el tope (deja al contable mudo si la agota)")
    ap.add_argument("--sin-ssh", action="store_true",
                    help="no habla con codebox ni para bajar los esquemas de tools")
    ap.add_argument("--verificar-render", action="store_true")
    ap.add_argument("--verificar-ruteo", action="store_true")
    ap.add_argument("--solo-corpus", action="store_true",
                    help="censo y muestra, sin gastar una sola llamada")
    ap.add_argument("--bash", default="bash", help="un bash ≥ 4 para --verificar-ruteo")
    args = ap.parse_args()

    skill_dir = Path(args.skill_dir)
    if args.verificar_render or args.verificar_ruteo:
        rc = 0
        if args.verificar_render:
            rc |= verificar_render(args.db, args.skill_original)
        if args.verificar_ruteo:
            rc |= verificar_ruteo(args.bash, skill_dir)
        sys.exit(rc)

    cache_dir = Path(args.cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    corpus, descartes, n_sesiones = cargar_corpus(args.db)
    if not corpus:
        sys.exit("no encontré ni un turno de decisión: ¿cambió el formato de state.db?")
    muestra = muestrear(corpus, args.casos, args.semilla)

    if args.solo_corpus:
        reportar([], corpus, muestra, descartes, n_sesiones,
                 origen_tools="(no se bajaron: --solo-corpus)", ruteo_verificado=False)
        print()
        print("qué rama le tocaría a cada caso de la muestra:")
        for rama, cuantos in Counter(
                rutear(c["tipo"], c["estado"], c["voz"]) or RUTEO_TODAS
                for c in muestra).most_common():
            print(f"  {cuantos:5d}  {rama}")
        entera = len(Path(args.skill_original).read_text(encoding="utf-8"))
        print()
        print(f"tamaño     entera {entera:,} chars")
        for rama in sorted({rutear(c['tipo'], c['estado'], c['voz']) or RUTEO_TODAS
                            for c in muestra}, key=str):
            cuerpo, _ = cuerpo_partido(
                next(c for c in muestra
                     if (rutear(c["tipo"], c["estado"], c["voz"]) or RUTEO_TODAS) == rama),
                skill_dir)
            print(f"           partida ({rama}) {len(cuerpo):,} chars "
                  f"— {100 * len(cuerpo) / entera:.0f}% de la entera")
        return

    llave = leer_llave(args.llave_desde_contenedor)
    tools, origen_tools = herramientas(cache_dir, args.sin_ssh)
    satelites = satelites_del_repo(skill_dir)

    trabajos = [(c, v, e)
                for c in muestra
                for v in args.variantes.split(",")
                for e in args.efforts.split(",")]

    # Presupuesto, antes de gastar. Se cuentan sólo los que NO están cacheados:
    # reanudar una corrida cortada no vuelve a pagar lo ya pagado.
    entera = len(Path(args.skill_original).read_text(encoding="utf-8"))
    chars = 0
    for caso, variante, effort in trabajos:
        cuerpo = entera if variante == "entera" else len(cuerpo_partido(caso, skill_dir)[0])
        chars += (cuerpo + len(caso["system_prompt"])
                  + sum(len(json.dumps(x, ensure_ascii=False)) for x in caso["prefijo"]))
    tokens = int(chars / CHARS_POR_TOKEN)
    porcion = 100 * tokens / TOPE_VENTANA
    print(f"presupuesto: {len(trabajos)} llamadas ≈ {tokens:,} tokens de entrada "
          f"= {porcion:.0f}% de la ventana de 5 h", file=sys.stderr)
    if porcion > args.tope_ventana_pct and not args.acepto_la_cuota:
        sys.exit(f"Eso pasa el {args.tope_ventana_pct}% de la ventana y el contable se queda "
                 f"mudo si la agota.\nBajá -n, sacá efforts, o pasá --acepto-la-cuota.")

    resultados, cortado = [], None
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrencia) as pool:
        futuros = {pool.submit(una_corrida, c, v, e, llave, tools, cache_dir,
                               skill_dir, args.skill_original, satelites): (c, v, e)
                   for c, v, e in trabajos}
        hechos = 0
        for fut in concurrent.futures.as_completed(futuros):
            caso, variante, effort = futuros[fut]
            hechos += 1
            try:
                r = fut.result()
            except CuotaAgotada as exc:
                cortado = str(exc)
                for f in futuros:
                    f.cancel()
                break
            except Exception as exc:
                print(f"  [{hechos}/{len(trabajos)}] FALLÓ {caso['sesion']} "
                      f"{variante}/{effort}: {exc}", file=sys.stderr)
                continue
            resultados.append(r)
            marca = "cache" if r["cacheado"] else f"{r['latencia_s']:.1f}s"
            print(f"  [{hechos}/{len(trabajos)}] {variante:<8}{effort:<8}"
                  f"{caso['sesion']}  {marca}", file=sys.stderr)

    Path(args.salida).parent.mkdir(parents=True, exist_ok=True)
    Path(args.salida).write_text(json.dumps(resultados, ensure_ascii=False, indent=1))

    reportar(resultados, corpus, muestra, descartes, n_sesiones, origen_tools,
             ruteo_verificado=False)
    print()
    print(f"detalle    {args.salida}")
    print(f"caché      {cache_dir} (borrala para rehacer las llamadas)")
    if cortado:
        print()
        print(f"CORTADA: {cortado}")
        print("Los resultados de arriba son parciales. La cuota se repone sola; "
              "volvé a correr el mismo comando y la caché retoma donde quedó.")
        sys.exit(2)


if __name__ == "__main__":
    main()
