#!/usr/bin/env bash
# Aplica la configuración de modelos del contable. Idempotente.
#
#   ./configurar-modelo.sh                      -> blackbox, modo normal
#   ./configurar-modelo.sh otra-empresa
#   ./configurar-modelo.sh blackbox respaldo    -> primario por OpenRouter
#
# El MODO decide quién atiende primero:
#
#   normal    z.AI adelante y OpenRouter al final de la fila. Es el estado de
#             siempre: el trabajo corre sobre el plan de z.AI, que ya está pago.
#   respaldo  OpenRouter adelante y los tres de z.AI detrás. Para cuando la
#             cuota de z.AI está agotada, que es por CUENTA y no por modelo.
#             Con el orden normal, cada turno del contable gasta TRES llamadas
#             muertas —una por cada modelo de z.AI— antes de llegar al que
#             atiende; y como el cooldown de Hermes es de 60 segundos fijos
#             (`_rate_limited_until = time.monotonic() + 60` en
#             agent/chat_completion_helpers.py, que ignora la hora de reset que
#             el propio 429 trae), el turno siguiente vuelve a empezar por el
#             principal y repite las tres. Una factura subida durante el tope
#             se arrastra así hasta que el humano se cansa de mirar
#             «analizando» — pasó el 2026-08-04 con la FC de flete de Pier 17.
#
# Los tres de z.AI NO se borran en modo respaldo, se mueven atrás: siguen
# siendo la red buena para el otro fallo, el de un modelo suelto sobrecargado.
# Lo que no sirve es probarlos cuando la que se agotó es la cuenta.
#
# Nadie llama al modo respaldo a mano: lo conmuta seguir-cuota.sh mirando
# qualia_servicio.cuota_bloqueada_hasta, que es donde el poller ya deja anotado
# hasta cuándo dura el tope.
#
# Existe porque config.yaml vive dentro del volumen del contenedor y está
# fuera de git: si el volumen se rehace, esta configuración se pierde y no
# queda forma de reconstruirla. Acá está, verificada contra Hermes v0.19.0.
# Por eso también administra el `reasoning_effort` (abajo): es un ajuste que se
# eligió con medición y que, sin estar acá, se evaporaba con el volumen y
# volvía al default sin que nadie lo notara — el síntoma habría sido «el
# contable volvió a ir lento», seis semanas después y sin causa a la vista.
#
# El trabajo corre sobre Z.ai / GLM, con OpenRouter SOLO como red de seguridad.
# La razón está medida, no supuesta: el plan de z.AI topa por cuenta cada 5
# horas, y cuando topa devuelve 429 código 1308 para TODOS sus modelos a la vez.
# El 2026-08-03 el contable recorrió sus tres modelos de respaldo —todos de
# z.AI— y murió contra el mismo error en los tres: dos horas mudo en plena
# tarde. Una cadena de respaldo dentro del mismo proveedor cubre la caída de un
# modelo, nunca la de la cuenta.
#
# NO usa `hermes config set`, aunque sea el camino obvio. Ese comando reescribe
# el YAML con un round-trip y se lleva puestos los comentarios del archivo,
# incluido el bloque que explica por qué approvals.deny bloquea la firma de
# e-CF (comprobado el 2026-08-03: un `set` con el MISMO valor los borró). Un
# comentario que documenta una barrera de seguridad no se sacrifica por
# comodidad, así que todo se escribe como texto.

set -euo pipefail

EMPRESA="${1:-blackbox}"
MODO="${2:-normal}"
case "$MODO" in
  normal|respaldo) ;;
  *) echo "Modo desconocido '$MODO' — usá: normal | respaldo"; exit 1 ;;
esac
RAIZ="/home/codebox/qualiaconta/repo"
CONF="${RAIZ}/empresas/${EMPRESA}/hermes/config.yaml"
ENV_EMPRESA="${RAIZ}/empresas/${EMPRESA}/.env"
CONTENEDOR="qualiaconta-${EMPRESA}"

PRINCIPAL='glm-5.2'
RESPALDO='glm-5-turbo'
LIVIANO='glm-4.7'
VISION='glm-4.6v'

# Los mismos pesos, servidos por OpenRouter, que tiene saldo aparte. Los nombres
# van con el prefijo de la organización: allá el modelo se llama 'z-ai/glm-5.2',
# no 'glm-5.2'.
OR_PRINCIPAL='z-ai/glm-5.2'
OR_LIVIANO='z-ai/glm-4.7'
OR_VISION='z-ai/glm-4.6v'

# --------------------------------------------------------------------------
# Cuánto piensa el contable antes de contestar
# --------------------------------------------------------------------------
# `low`, y la razón está medida, no supuesta.
#
# Lo que hace lento a este agente es la SALIDA, y su salida es casi toda
# razonamiento: una sesión real cerró con out=67.714 tokens de los cuales
# reasoning=61.086 — el 90%. Sobre 5.448 llamadas del log, la latencia
# correlaciona 0,76 con los tokens de salida y 0,04 con los de entrada; o sea
# que el prompt gigante no le cuesta segundos (el caché de prefijo de z.AI pega
# al 91%), pero pensar sí. Medido contra el endpoint de producción con el
# prompt real: medium 14,8 s · low 8,8 s · minimal 3,7 s.
#
# Por qué no `medium`: son 6 segundos por llamada, con mediana de 10 llamadas
# por sesión, sin que ninguna decisión mejore de forma visible.
#
# Por qué no `minimal`: ahí el razonamiento se APAGA, y el modo de falla de
# este agente no es tardar — es inventar. La FP00001120 se registró con una
# tasa de ITBIS que el papel nunca dijo porque el preparador despejó la base
# para que la aritmética cerrara; ése es el error que un turno sin pensar
# comete más seguido, y cuesta un asiento mal hecho en ADM, no seis segundos.
# La prueba de verdad no es un banco: es la compuerta de la mesa. El contable
# NO toca ADM sin aprobación humana —deja la propuesta y ahí se queda—, así que
# un nivel de razonamiento que degrade se ve leyendo las propuestas antes de
# aprobarlas. Al bajarlo, mirá con lupa la tasa de ITBIS (que la base sea
# itbis/tasa y no haya un renglón «exentos» que salga de una resta) y el tipo de
# documento (que un movimiento de banco no salga como Journals): son los dos
# lugares donde pensar menos duele. Revertir es una línea y un reinicio.
# (Hay además un banco de replay offline en la rama `abaratar-el-turno-del-contable`,
# `mesa/replay-skill.py`, que compara contra las decisiones históricas.)
#
# Se puede probar otro nivel sin editar el script:
#   MESA_REASONING_EFFORT=minimal ./configurar-modelo.sh
ESFUERZO="${MESA_REASONING_EFFORT:-low}"

# La lista sale de VALID_REASONING_EFFORTS en hermes_constants.py de esta
# versión. Se valida acá y no se deja pasar: ante un valor desconocido Hermes
# NO falla — escribe un warning en el log y sigue con su default. O sea que un
# typo dejaría el contable en `medium` para siempre y el script diría "listo".
# Ojo también con YAML: `no`, `off` y `false` son BOOLEANOS, y para Hermes eso
# significa razonamiento APAGADO, que no es lo mismo que un nivel bajo.
case "$ESFUERZO" in
  minimal|low|medium|high|xhigh|max|ultra) ;;
  *) echo "MESA_REASONING_EFFORT='$ESFUERZO' no existe — usá: minimal | low | medium | high | xhigh | max | ultra"; exit 1 ;;
esac

# --------------------------------------------------------------------------
# Cuántas llamadas puede hacer una sesión antes de que Hermes la corte
# --------------------------------------------------------------------------
# `agent.max_turns` — "max tool-calling iterations (shared with subagents)",
# cli.py:474 de esta versión. El default de fábrica es 500, que en la práctica
# es "sin tope": la sesión desbocada del log llegó a 184 llamadas y quemó ~5M
# de tokens de entrada — UN TERCIO de la ventana de 5 h de z.AI en una sola
# sesión, sin producir nada que 20 llamadas no hubieran producido.
#
# 60 = ~3× el p90 real (21 llamadas por sesión, mediana 9, medido 2026-08-07
# con mesa/medir-turnos.py sobre 471 sesiones): ninguna sesión legítima del
# histórico lo habría rozado, y una en bucle muere a tiempo. Si Hermes corta,
# la fila del trabajo queda en 'analizando' y las redes del poller la rescatan
# (reserva muerta a los 20 min → pendiente → re-aviso), así que el costo de un
# corte es un reintento, no un trabajo perdido.
MAX_TURNS="${MESA_MAX_TURNS:-60}"
case "$MAX_TURNS" in
  ''|*[!0-9]*) echo "MESA_MAX_TURNS='$MAX_TURNS' no es un entero"; exit 1 ;;
esac
if [ "$MAX_TURNS" -lt 25 ] || [ "$MAX_TURNS" -gt 500 ]; then
  echo "MESA_MAX_TURNS=$MAX_TURNS fuera de rango sano (25-500): por debajo del p90×tolerancia corta sesiones legítimas"
  exit 1
fi

[ -f "$CONF" ] || { echo "No existe $CONF"; exit 1; }
[ -f "$ENV_EMPRESA" ] || { echo "No existe $ENV_EMPRESA"; exit 1; }

# Se lee variable por variable en vez de sourcear el .env entero. Sourcearlo con
# `set -e` es una trampa: un valor con espacios y sin comillas —ADMCLOUD_ROLE lo
# tiene— hace que bash intente correr la segunda palabra como comando, eso
# devuelve 127 y el script muere acá con un mensaje que ni menciona al .env.
# Además, sourcear ejecuta lo que haya adentro; leer, no.
leer_env() {
  sed -n "s/^$1=//p" "$ENV_EMPRESA" | tail -1 | sed 's/^"\(.*\)"$/\1/'
}
GLM_API_KEY=$(leer_env GLM_API_KEY)
OPENROUTER_API_KEY=$(leer_env OPENROUTER_API_KEY)

# --------------------------------------------------------------------------
# Guardia: que los códigos de modelo existan de verdad
# --------------------------------------------------------------------------
# Sin esto se puede configurar un modelo inexistente y el síntoma no lo dice:
# Hermes responde "empty response" y cae al fallback, no "modelo desconocido".
# Paso con glm-5.2[1m], que no existe en z.AI.
: "${GLM_API_KEY:?falta GLM_API_KEY en el .env — el proveedor zai lee de ahi}"
DISPONIBLES=$(curl -s --max-time 20 -H "Authorization: Bearer ${GLM_API_KEY}" \
  "https://api.z.ai/api/coding/paas/v4/models" \
  | python3 -c 'import json,sys; print(" ".join(m["id"] for m in json.load(sys.stdin).get("data",[])))' 2>/dev/null)
if [ -z "$DISPONIBLES" ]; then
  # En modo respaldo esto NO es fatal, y la razón es la que da nombre al modo:
  # se conmuta JUSTO cuando z.AI está topado o caído. Exigirle el catálogo para
  # poder dejar de llamarlo es pedirle que conteste para dejar de molestarlo, y
  # dejaría al contable clavado en el proveedor muerto — el fallo que este modo
  # existe para evitar. Los nombres los validó el modo normal la última vez que
  # corrió, y acá viajan a la COLA de la cadena, no al frente.
  [ "$MODO" = respaldo ] || { echo "No pude listar los modelos de z.AI — reviso la llave"; exit 1; }
  echo "AVISO: z.AI no contesta el catálogo — sigo, es lo esperable durante el tope"
else
  for M in "$PRINCIPAL" "$RESPALDO" "$LIVIANO"; do
    case " $DISPONIBLES " in
      *" $M "*) ;;
      *) echo "El modelo '$M' no existe en z.AI. Disponibles: $DISPONIBLES"; exit 1 ;;
    esac
  done
fi

# $VISION queda FUERA de este guardia a propósito: el catálogo del endpoint de
# coding no lo lista, pero sí lo atiende. La evidencia es la sonda de cuota de
# mesa/poller.sh, que pega justamente a ese endpoint con ese modelo y recibe un
# 429 de cuota (código 1308) — o sea que el nombre lo acepta y llega hasta el
# control de cuota. Si algún día vision deja de leer facturas escaneadas, este
# comentario es el primer lugar donde mirar.

# --------------------------------------------------------------------------
# Guardia: que la red de seguridad exista de verdad
# --------------------------------------------------------------------------
# Un respaldo mal configurado no da señales hasta el día que hace falta, y ese
# día ya es tarde. Se verifica que la llave responda Y que los modelos existan
# con ese nombre exacto, porque el prefijo de organización es fácil de errar.
: "${OPENROUTER_API_KEY:?falta OPENROUTER_API_KEY en el .env — sin eso no hay red de seguridad}"
OR_DISPONIBLES=$(curl -s --max-time 30 -H "Authorization: Bearer ${OPENROUTER_API_KEY}" \
  "https://openrouter.ai/api/v1/models" \
  | python3 -c 'import json,sys; print(" ".join(m["id"] for m in json.load(sys.stdin).get("data",[])))' 2>/dev/null)
[ -n "$OR_DISPONIBLES" ] || { echo "No pude listar los modelos de OpenRouter — reviso la llave"; exit 1; }
for M in "$OR_PRINCIPAL" "$OR_LIVIANO" "$OR_VISION"; do
  case " $OR_DISPONIBLES " in
    *" $M "*) ;;
    *) echo "El modelo '$M' no existe en OpenRouter"; exit 1 ;;
  esac
done

SALDO=$(curl -s --max-time 20 -H "Authorization: Bearer ${OPENROUTER_API_KEY}" \
  "https://openrouter.ai/api/v1/credits" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; print(round(d["total_credits"]-d["total_usage"],2))' 2>/dev/null)
echo "Saldo de la red de seguridad (OpenRouter): US\$${SALDO:-desconocido}"
if [ "$MODO" = respaldo ]; then
  echo "Modo respaldo: atiende OpenRouter, z.AI queda de reserva"
else
  echo "Modo normal: atiende z.AI, OpenRouter queda de reserva"
fi

# --------------------------------------------------------------------------
# Escritura
# --------------------------------------------------------------------------
# Tres cosas, todas como texto sobre el archivo:
#
#   1. El modelo principal. NO se fija base_url ni api_key a propósito: con
#      provider=zai, Hermes prueba los cuatro endpoints de Z.ai con la llave
#      (detect_zai_endpoint) y cachea el que responde. Fijarlo a mano rompe esa
#      detección cuando cambia el tipo de plan.
#
#   2. Las ranuras auxiliares. Los nombres salen de _AUX_TASKS en
#      hermes_cli/main.py de esta versión, no de suposiciones. Las livianas van
#      al modelo barato; comprimir contexto va al fuerte porque de eso depende
#      que no se pierda información entre sesiones.
#
#   3. Las cadenas de respaldo. Cada ranura necesita la SUYA: una ranura fijada
#      a un proveedor concreto —como todas las de acá— nunca lee
#      fallback_providers, eso sólo lo hacen las que están en 'auto'. Sin cadena
#      propia el modelo principal sobrevive al tope pero el contable se queda
#      sin leer imágenes ni comprimir contexto, que es una forma peor de estar
#      caído porque desde afuera parece que funciona.
#
#   4. El esfuerzo de razonamiento, que va en `agent:` y NO en `model:`.
#      Cuesta creerlo porque es una propiedad del modelo principal, pero el
#      único lugar donde Hermes lo lee es `agent.reasoning_effort`
#      (resolve_reasoning_config en hermes_constants.py, el chokepoint que usan
#      todas las superficies). Escrito adentro de `model:` no rompe nada: se
#      ignora en silencio y el contable sigue en el default. Existe además
#      `agent.reasoning_overrides` por modelo, y a propósito NO se usa: la
#      cadena de respaldo llama al mismo peso con OTRO nombre
#      ('z-ai/glm-5.2'), así que un override por nombre dejaría el modo
#      respaldo pensando distinto que el normal sin que nadie se entere.
CONF="$CONF" PRINCIPAL="$PRINCIPAL" RESPALDO="$RESPALDO" LIVIANO="$LIVIANO" VISION="$VISION" \
OR_PRINCIPAL="$OR_PRINCIPAL" OR_LIVIANO="$OR_LIVIANO" OR_VISION="$OR_VISION" MODO="$MODO" \
ESFUERZO="$ESFUERZO" MAX_TURNS="$MAX_TURNS" \
python3 - <<'PY'
import os, shutil, yaml

conf = os.environ["CONF"]
MODO = os.environ["MODO"]
ESFUERZO = os.environ["ESFUERZO"]
OR_BASE, OR_KEY = "https://openrouter.ai/api/v1", "OPENROUTER_API_KEY"
PRINCIPAL, RESPALDO = os.environ["PRINCIPAL"], os.environ["RESPALDO"]
LIVIANO, VISION = os.environ["LIVIANO"], os.environ["VISION"]
OR_PRINCIPAL, OR_LIVIANO = os.environ["OR_PRINCIPAL"], os.environ["OR_LIVIANO"]
OR_VISION = os.environ["OR_VISION"]

# (proveedor, modelo, base_url, api_key, modelo_de_respaldo) por ranura.
# vision va con proveedor 'custom' y el endpoint escrito a mano: así estaba en
# el config vivo del 2026-08-03 y así se deja. Pasarlo a provider=zai como las
# demás es un cambio de comportamiento que nadie verificó, y el precio de
# equivocarse es que el contable deje de leer facturas escaneadas.
AUX = {
    "vision":      ("custom", VISION,    "https://api.z.ai/api/coding/paas/v4", "${GLM_API_KEY}", OR_VISION),
    "web_extract": ("zai",    LIVIANO,   None, None, OR_LIVIANO),
    "compression": ("zai",    PRINCIPAL, None, None, OR_PRINCIPAL),
    "skills_hub":  ("zai",    LIVIANO,   None, None, OR_LIVIANO),
    "approval":    ("zai",    LIVIANO,   None, None, OR_LIVIANO),
    "mcp":         ("zai",    LIVIANO,   None, None, OR_LIVIANO),
}


def entrada_or(modelo, sangria):
    # base_url y key_env se declaran explícitos, nunca por descubrimiento: el
    # .env define OPENAI_API_KEY y OPENAI_BASE_URL apuntando a z.AI, y si el
    # cliente de OpenRouter cae en esa resolución manda la llave equivocada al
    # host equivocado. El síntoma sería un 401 en plena caída, o sea en el peor
    # momento posible para descubrirlo.
    s = " " * sangria
    return [f"{s}- provider: openrouter", f"{s}  model: {modelo}",
            f"{s}  base_url: {OR_BASE}", f"{s}  key_env: {OR_KEY}"]


def fin_de_bloque(lineas, i, sangria_min):
    """Índice de la primera línea que ya no pertenece al bloque abierto en i."""
    j = i + 1
    while j < len(lineas):
        if not lineas[j].strip():
            j += 1
            continue
        if len(lineas[j]) - len(lineas[j].lstrip()) < sangria_min:
            break
        j += 1
    return j


def reemplazar_bloque(lineas, clave, cuerpo):
    for i, l in enumerate(lineas):
        if l.startswith(clave + ":"):
            lineas[i:fin_de_bloque(lineas, i, 1)] = [clave + ":"] + cuerpo
            return lineas
    raise SystemExit(f"no encontré {clave}: en el config")


def fijar_escalar(lineas, bloque, clave, valor):
    """Escribe UNA clave adentro de un bloque, sin tocar el resto.

    Hace falta porque `agent:` no se puede reemplazar entero: adentro vive
    `personalities`, catorce personajes con textos multilínea que este script
    no administra y que no tiene por qué reescribir. Si la clave ya está se
    pisa en su lugar; si no, entra pegada a la cabecera del bloque.
    """
    for i, l in enumerate(lineas):
        if not l.startswith(bloque + ":"):
            continue
        fin = fin_de_bloque(lineas, i, 1)
        for j in range(i + 1, fin):
            if lineas[j].startswith(f"  {clave}:"):
                lineas[j] = f"  {clave}: {valor}"
                return lineas
        lineas.insert(i + 1, f"  {clave}: {valor}")
        return lineas
    raise SystemExit(f"no encontré {bloque}: en el config")


respaldo_archivo = conf + ".antes-configurar"
shutil.copy2(conf, respaldo_archivo)
lineas = open(conf, encoding="utf-8").read().split("\n")

# --- 1 y 3) modelo principal + su cadena, según el modo ---
if MODO == "respaldo":
    # Acá SÍ se fijan base_url y api_key, al revés que en modo normal. Con
    # provider=openrouter no hay descubrimiento que valga, y el .env define
    # OPENAI_API_KEY/OPENAI_BASE_URL apuntando a z.AI: si el cliente cae en esa
    # resolución manda la llave equivocada al host equivocado. El síntoma sería
    # un 401 justo durante el tope, o sea en el peor momento para descubrirlo.
    lineas = reemplazar_bloque(lineas, "model", [
        f"  default: {OR_PRINCIPAL}", "  provider: openrouter",
        f"  base_url: {OR_BASE}", "  api_key: ${OPENROUTER_API_KEY}",
    ])
    # Los tres de z.AI pasan atrás en bloque, incluido el principal. No se
    # borran: si el tope se levanta antes de que el vigilante lo note, la
    # cadena los encuentra igual y el trabajo vuelve solo al plan que ya
    # está pago.
    cadena = []
    for m in (PRINCIPAL, RESPALDO, LIVIANO):
        cadena += ["  - provider: zai", f"    model: {m}"]
else:
    lineas = reemplazar_bloque(lineas, "model", [
        f"  default: {PRINCIPAL}", "  provider: zai", "  base_url: ''", "  api_key: ''",
    ])
    cadena = []
    for m in (RESPALDO, LIVIANO):
        cadena += ["  - provider: zai", f"    model: {m}"]
    cadena += entrada_or(OR_PRINCIPAL, 2)
lineas = reemplazar_bloque(lineas, "fallback_providers", cadena)

# --- 4) cuánto piensa, para el principal y para toda su cadena ---
lineas = fijar_escalar(lineas, "agent", "reasoning_effort", ESFUERZO)

# --- 5) el freno de sesión (ver el comentario de MAX_TURNS arriba) ---
lineas = fijar_escalar(lineas, "agent", "max_turns", os.environ["MAX_TURNS"])

# --- 2 y 3) ranuras auxiliares, cada una con su cadena ---
inicio = next((i for i, l in enumerate(lineas) if l.startswith("auxiliary:")), None)
if inicio is None:
    raise SystemExit("no encontré auxiliary: en el config")
fin, vistas, i = fin_de_bloque(lineas, inicio, 1), set(), inicio + 1
while i < fin:
    linea = lineas[i]
    nombre = linea.strip().rstrip(":")
    if (not linea.strip() or len(linea) - len(linea.lstrip()) != 2
            or not linea.rstrip().endswith(":") or nombre not in AUX):
        i += 1
        continue
    prov, modelo, base, llave, respaldo_modelo = AUX[nombre]
    cuerpo = [f"    provider: {prov}", f"    model: {modelo}"]
    if base:
        cuerpo.append(f"    base_url: {base}")
    if llave:
        cuerpo.append(f"    api_key: {llave}")
    cuerpo += ["    fallback_chain:"] + entrada_or(respaldo_modelo, 6)
    fin_tarea = fin_de_bloque(lineas, i, 4)
    largo_viejo = fin_tarea - (i + 1)
    lineas[i + 1:fin_tarea] = cuerpo
    vistas.add(nombre)
    fin += len(cuerpo) - largo_viejo
    i += 1 + len(cuerpo)

faltan = set(AUX) - vistas
if faltan:
    raise SystemExit(f"estas ranuras no estaban en el config: {sorted(faltan)}")

open(conf, "w", encoding="utf-8").write("\n".join(lineas))

# --- verificación estructural; si algo no cuadra, se restaura ---
try:
    texto = open(conf, encoding="utf-8").read()
    cfg = yaml.safe_load(texto)
    cad = cfg.get("fallback_providers") or []
    assert len(cad) == 3, f"la cadena quedó con {len(cad)} entradas"
    m_cfg = cfg.get("model") or {}
    if MODO == "respaldo":
        assert m_cfg.get("default") == OR_PRINCIPAL, "el primario no quedó en OpenRouter"
        assert m_cfg.get("provider") == "openrouter", "el primario no quedó en OpenRouter"
        assert m_cfg.get("base_url") == OR_BASE, "el primario no declara base_url"
        # Que TODA la cadena sea de z.AI es la prueba de que el proveedor vivo
        # quedó al frente y solo: si se colara una entrada de openrouter acá,
        # sería que el bloque model no se conmutó y el orden sigue invertido.
        assert all(e.get("provider") == "zai" for e in cad), "la cadena no quedó en z.AI"
    else:
        assert m_cfg.get("default") == PRINCIPAL, "el modelo principal no quedó"
        assert cad[-1].get("provider") == "openrouter", "la última entrada no es openrouter"
        assert cad[-1].get("key_env") == OR_KEY, "la entrada de openrouter no declara key_env"
    for tarea, (prov, modelo, _b, _k, respaldo_modelo) in AUX.items():
        r = cfg.get("auxiliary", {}).get(tarea) or {}
        assert r.get("provider") == prov and r.get("model") == modelo, f"{tarea}: mal escrita"
        c = r.get("fallback_chain") or []
        assert len(c) == 1 and c[0].get("model") == respaldo_modelo, f"{tarea}: sin red"
    ag = cfg.get("agent") or {}
    # Se compara contra el string, no contra "hay algo": un `no`/`off` en el YAML
    # llegaría acá como el booleano False, que para Hermes es el razonamiento
    # APAGADO. Un `assert ag.get("reasoning_effort")` lo dejaría pasar como
    # "distinto de vacío" y el contable arrancaría sin pensar.
    assert ag.get("reasoning_effort") == ESFUERZO, \
        f"reasoning_effort quedó en {ag.get('reasoning_effort')!r}, no en {ESFUERZO!r}"
    # Entero exacto, no "hay algo": un string colado ('60s') lo ignoraría
    # Hermes en silencio y el freno quedaría en el default 500.
    assert ag.get("max_turns") == int(os.environ["MAX_TURNS"]), \
        f"max_turns quedó en {ag.get('max_turns')!r}, no en {os.environ['MAX_TURNS']}"
    # Lo que el script NO administra y no puede haber tocado.
    assert len(ag.get("personalities") or {}) >= 10, "se llevó puestas las personalities"
    assert (cfg.get("approvals") or {}).get("deny"), "se perdió approvals.deny"
    assert "Candado de flujo contra la firma" in texto, "se perdieron los comentarios de approvals"
except (AssertionError, yaml.YAMLError) as exc:
    shutil.copy2(respaldo_archivo, conf)
    raise SystemExit(f"FALLÓ la verificación, restauré el archivo: {exc}")
PY

# --------------------------------------------------------------------------
# Verificación — que cada ranura haya resuelto a lo pedido y no a un default
# --------------------------------------------------------------------------
echo
docker exec "$CONTENEDOR" hermes fallback list 2>&1 | grep -E "Primary|[0-9]\." | sed 's/^/  /'
echo
CONF="$CONF" PRINCIPAL="$PRINCIPAL" LIVIANO="$LIVIANO" VISION="$VISION" \
OR_PRINCIPAL="$OR_PRINCIPAL" MODO="$MODO" ESFUERZO="$ESFUERZO" MAX_TURNS="$MAX_TURNS" python3 - <<'PY'
import os, yaml
c = yaml.safe_load(open(os.environ["CONF"], encoding="utf-8"))
aux = c.get("auxiliary", {}) or {}
principal, liviano, vision = os.environ["PRINCIPAL"], os.environ["LIVIANO"], os.environ["VISION"]
esperado = {k: ("zai", liviano) for k in ("skills_hub", "mcp", "approval", "web_extract")}
esperado["compression"] = ("zai", principal)
esperado["vision"] = ("custom", vision)
malas = 0
for k, (prov, v) in esperado.items():
    s = aux.get(k) or {}
    red = (s.get("fallback_chain") or [{}])[0]
    # Una ranura sin respaldo propio muere con z.AI aunque el principal
    # sobreviva, así que tener red es parte de "está bien configurada".
    ok = (s.get("provider") == prov and s.get("model") == v
          and red.get("provider") == "openrouter" and bool(red.get("model")))
    malas += 0 if ok else 1
    print(f"  {'OK ' if ok else 'MAL'} {k:<14} {s.get('provider') or '-':<7}"
          f" {s.get('model') or '-':<10} -> {red.get('model') or 'SIN RED'}")
# El esfuerzo se verifica igual que las ranuras y por el mismo motivo: es una
# ranura más que puede haber quedado en el default sin avisar. Se lee de
# `agent`, que es el único lugar de donde Hermes lo levanta, y se compara con el
# string exacto — `is not None` daría por bueno un False (razonamiento apagado).
esf = (c.get("agent") or {}).get("reasoning_effort")
esperado_esf = os.environ["ESFUERZO"]
ok = esf == esperado_esf
malas += 0 if ok else 1
print(f"  {'OK ' if ok else 'MAL'} {'razonamiento':<14} {'agent':<7} {esf if esf is not None else 'SIN FIJAR'}")
mt = (c.get("agent") or {}).get("max_turns")
ok = mt == int(os.environ["MAX_TURNS"])
malas += 0 if ok else 1
print(f"  {'OK ' if ok else 'MAL'} {'max_turns':<14} {'agent':<7} {mt if mt is not None else 'SIN FIJAR (default 500)'}")

m = c.get("model", {}) or {}
modo, or_principal = os.environ["MODO"], os.environ["OR_PRINCIPAL"]
if modo == "respaldo":
    # Al revés que en normal: acá los dos campos son obligatorios (ver el
    # comentario del bloque de escritura — sin ellos el cliente resuelve por
    # OPENAI_* y le manda la llave de z.AI a OpenRouter).
    ok = (m.get("provider") == "openrouter" and m.get("model", m.get("default")) == or_principal
          and m.get("base_url") and m.get("api_key"))
    malas += 0 if ok else 1
    print(f"  {'OK ' if ok else 'MAL'} {'primario':<14} {m.get('provider') or '-':<7}"
          f" {m.get('default') or '-'}")
elif m.get("base_url") or m.get("api_key"):
    malas += 1
    print("  MAL model.base_url/api_key deberían estar vacíos con provider=zai")
raise SystemExit(1 if malas else 0)
PY

echo
echo "Recordá: el proveedor zai lee la llave de GLM_API_KEY (o ZAI_API_KEY /"
echo "Z_AI_API_KEY), NUNCA de OPENAI_API_KEY. Si falta, arranca limpio y falla"
echo "al responder con un error que parece otra cosa."
echo
echo "Y ojo con esto, que costó una hora de diagnóstico: el contenedor toma las"
echo "variables cuando se CREA. Si agregaste o cambiaste OPENROUTER_API_KEY en"
echo "el .env, hay que recrearlo — 'docker compose up -d' desde la carpeta de la"
echo "empresa. Verificá con:"
echo "  docker exec ${CONTENEDOR} sh -c 'echo \${OPENROUTER_API_KEY:+PRESENTE}'"
