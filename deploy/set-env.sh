#!/usr/bin/env bash
# Escribe un valor en el .env de una empresa sin abrir editor.
#
#   ./set-env.sh ADMCLOUD_APPID            -> pregunta y guarda, empresa blackbox
#   ./set-env.sh TELEGRAM_ALLOWED_USERS otra-empresa
#
# Existe porque editar el .env a mano por ssh deja sesiones colgadas, archivos
# de intercambio y buffers viejos que pisan cambios. Esto entra, escribe una
# línea y sale.

set -euo pipefail

CLAVE="${1:?uso: set-env.sh CLAVE [empresa]}"
EMPRESA="${2:-blackbox}"
ARCHIVO="/home/codebox/qualiaconta/repo/empresas/${EMPRESA}/.env"

[ -f "$ARCHIVO" ] || { echo "No existe $ARCHIVO"; exit 1; }
grep -q "^${CLAVE}=" "$ARCHIVO" || {
  echo "El campo ${CLAVE} no existe en el archivo. Campos disponibles:"
  grep -oE "^[A-Z][A-Z0-9_]*=" "$ARCHIVO" | tr -d '=' | sed 's/^/  /'
  exit 1
}

read -rp "${CLAVE}: " VALOR
[ -n "$VALOR" ] || { echo "Vacío — no cambio nada."; exit 1; }

CLAVE="$CLAVE" VALOR="$VALOR" ARCHIVO="$ARCHIVO" python3 - <<'PY'
import os, re
clave, valor, archivo = os.environ["CLAVE"], os.environ["VALOR"], os.environ["ARCHIVO"]
texto = open(archivo, encoding="utf-8").read()
# Reemplazo con lambda: así un valor con barras o símbolos no se interpreta.
texto = re.sub(rf"^{re.escape(clave)}=.*$", lambda _: f"{clave}={valor}", texto, flags=re.M)
open(archivo, "w", encoding="utf-8").write(texto)
print(f"✓ {clave} guardado")
PY

chmod 600 "$ARCHIVO"

echo
echo "Campos que faltan por llenar:"
grep -E "^[A-Z][A-Z0-9_]*=$" "$ARCHIVO" | tr -d '=' | sed 's/^/  /' || echo "  (ninguno)"
