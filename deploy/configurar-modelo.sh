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
# Todo corre sobre Z.ai / GLM. Ningún otro proveedor.

set -euo pipefail

EMPRESA="${1:-blackbox}"
RAIZ="/home/codebox/qualiaconta/repo"
CONF="${RAIZ}/empresas/${EMPRESA}/hermes/config.yaml"
CONTENEDOR="qualiaconta-${EMPRESA}"

PRINCIPAL='glm-5.2'
RESPALDO='glm-5-turbo'
LIVIANO='glm-4.7'

[ -f "$CONF" ] || { echo "No existe $CONF"; exit 1; }

# --------------------------------------------------------------------------
# Guardia: que los códigos de modelo existan de verdad
# --------------------------------------------------------------------------
# Sin esto se puede configurar un modelo inexistente y el síntoma no lo dice:
# Hermes responde "empty response" y cae al fallback, no "modelo desconocido".
# Paso con glm-5.2[1m], que no existe en z.AI.
set -a; . "${RAIZ}/empresas/${EMPRESA}/.env"; set +a
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

# --------------------------------------------------------------------------
# Modelo principal
# --------------------------------------------------------------------------
# NO se fija base_url a propósito: con provider=zai, Hermes prueba los cuatro
# endpoints de Z.ai con la llave (detect_zai_endpoint) y cachea el que
# responde. Fijarlo a mano rompe esa detección cuando cambia el tipo de plan.
docker exec "$CONTENEDOR" hermes config set model.provider zai        >/dev/null
docker exec "$CONTENEDOR" hermes config set model.default "$PRINCIPAL" >/dev/null
docker exec "$CONTENEDOR" hermes config set model.base_url ''         >/dev/null
docker exec "$CONTENEDOR" hermes config set model.api_key  ''         >/dev/null

# --------------------------------------------------------------------------
# Ranuras auxiliares
# --------------------------------------------------------------------------
# Los nombres salen de _AUX_TASKS en hermes_cli/main.py de esta versión, no de
# suposiciones. Las livianas van al modelo barato; comprimir contexto va al
# fuerte porque de eso depende que no se pierda información entre sesiones.
for RANURA in skills_hub mcp approval web_extract vision; do
  docker exec "$CONTENEDOR" hermes config set "auxiliary.${RANURA}.provider" zai      >/dev/null
  docker exec "$CONTENEDOR" hermes config set "auxiliary.${RANURA}.model" "$LIVIANO"  >/dev/null
done
docker exec "$CONTENEDOR" hermes config set auxiliary.compression.provider zai          >/dev/null
docker exec "$CONTENEDOR" hermes config set auxiliary.compression.model "$PRINCIPAL"    >/dev/null

# --------------------------------------------------------------------------
# Cadena de respaldo
# --------------------------------------------------------------------------
# `hermes config set` guarda cualquier valor como texto, así que una lista de
# diccionarios queda como string y Hermes no la ve. Se escribe como YAML real.
RESPALDO="$RESPALDO" CONF="$CONF" python3 - <<'PY'
import os
conf, modelo = os.environ["CONF"], os.environ["RESPALDO"]
lineas = open(conf, encoding="utf-8").read().split("\n")
nuevo = ["fallback_providers:", "- provider: zai", f"  model: {modelo}"]
for i, l in enumerate(lineas):
    if l.startswith("fallback_providers:"):
        # Borra la entrada anterior completa (la clave y sus ítems indentados).
        fin = i + 1
        while fin < len(lineas) and (lineas[fin].startswith(" ") or lineas[fin].startswith("-")):
            fin += 1
        lineas[i:fin] = nuevo
        break
else:
    lineas.extend(nuevo)
open(conf, "w", encoding="utf-8").write("\n".join(lineas))
PY

# --------------------------------------------------------------------------
# Verificación — que cada ranura haya resuelto a lo pedido y no a un default
# --------------------------------------------------------------------------
echo
docker exec "$CONTENEDOR" hermes fallback list 2>&1 | grep -E "Primary|[0-9]\." | sed 's/^/  /'
echo
CONF="$CONF" PRINCIPAL="$PRINCIPAL" LIVIANO="$LIVIANO" python3 - <<'PY'
import os, yaml
c = yaml.safe_load(open(os.environ["CONF"], encoding="utf-8"))
aux = c.get("auxiliary", {}) or {}
principal, liviano = os.environ["PRINCIPAL"], os.environ["LIVIANO"]
esperado = {k: liviano for k in ("skills_hub", "mcp", "approval", "web_extract", "vision")}
esperado["compression"] = principal
malas = 0
for k, v in esperado.items():
    s = aux.get(k) or {}
    ok = s.get("provider") == "zai" and s.get("model") == v
    malas += 0 if ok else 1
    print(f"  {'OK ' if ok else 'MAL'} {k:<14} {s.get('provider') or '-':<6} {s.get('model') or '-'}")
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
