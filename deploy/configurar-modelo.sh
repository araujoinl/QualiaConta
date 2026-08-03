#!/usr/bin/env bash
# Aplica la configuración de modelos del contable. Idempotente.
#
#   ./configurar-modelo.sh                 -> empresa blackbox
#   ./configurar-modelo.sh otra-empresa
#
# Existe porque config.yaml vive dentro del volumen del contenedor y está
# fuera de git: si el volumen se rehace, esta configuración se pierde y no
# queda forma de reconstruirla. Acá está, verificada contra Hermes v0.19.0.
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
[ -n "$DISPONIBLES" ] || { echo "No pude listar los modelos de z.AI — reviso la llave"; exit 1; }
for M in "$PRINCIPAL" "$RESPALDO" "$LIVIANO"; do
  case " $DISPONIBLES " in
    *" $M "*) ;;
    *) echo "El modelo '$M' no existe en z.AI. Disponibles: $DISPONIBLES"; exit 1 ;;
  esac
done

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
CONF="$CONF" PRINCIPAL="$PRINCIPAL" RESPALDO="$RESPALDO" LIVIANO="$LIVIANO" VISION="$VISION" \
OR_PRINCIPAL="$OR_PRINCIPAL" OR_LIVIANO="$OR_LIVIANO" OR_VISION="$OR_VISION" \
python3 - <<'PY'
import os, shutil, yaml

conf = os.environ["CONF"]
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


respaldo_archivo = conf + ".antes-configurar"
shutil.copy2(conf, respaldo_archivo)
lineas = open(conf, encoding="utf-8").read().split("\n")

# --- 1) modelo principal ---
lineas = reemplazar_bloque(lineas, "model", [
    f"  default: {PRINCIPAL}", "  provider: zai", "  base_url: ''", "  api_key: ''",
])

# --- 3) cadena principal (el respaldo del modelo del chat) ---
cadena = []
for m in (RESPALDO, LIVIANO):
    cadena += ["  - provider: zai", f"    model: {m}"]
cadena += entrada_or(OR_PRINCIPAL, 2)
lineas = reemplazar_bloque(lineas, "fallback_providers", cadena)

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
    assert cad[-1].get("provider") == "openrouter", "la última entrada no es openrouter"
    assert cad[-1].get("key_env") == OR_KEY, "la entrada de openrouter no declara key_env"
    for tarea, (prov, modelo, _b, _k, respaldo_modelo) in AUX.items():
        r = cfg.get("auxiliary", {}).get(tarea) or {}
        assert r.get("provider") == prov and r.get("model") == modelo, f"{tarea}: mal escrita"
        c = r.get("fallback_chain") or []
        assert len(c) == 1 and c[0].get("model") == respaldo_modelo, f"{tarea}: sin red"
    assert (cfg.get("model") or {}).get("default") == PRINCIPAL, "el modelo principal no quedó"
    # Lo que el script NO administra y no puede haber tocado.
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
CONF="$CONF" PRINCIPAL="$PRINCIPAL" LIVIANO="$LIVIANO" VISION="$VISION" python3 - <<'PY'
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
m = c.get("model", {}) or {}
if m.get("base_url") or m.get("api_key"):
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
