#!/usr/bin/env bash
# Limpieza final de QualiaConta en CodeBox (F4, cierre de la mudanza).
# Se corre DESDE la máquina de trabajo: ./deploy/limpiar-codebox.sh
# Idempotente: cada paso tolera que el anterior ya haya corrido.
#
# Qué hace, en orden:
#   1. Respaldo local de lo que NO está en git (.env de la empresa y cualquier
#      resto) — sin ese tar no se borra nada.
#   2. Baja y BORRA los contenedores de la mesa (down --remove-orphans -v no:
#      los volúmenes nombrados no existen acá; los bind mounts se van con el
#      directorio).
#   3. Borra la imagen qualiaconta:local.
#   4. Borra /home/codebox/qualiaconta entero.
#   5. Limpia las líneas de qualia del crontab del usuario (si quedara alguna).
#   6. Verifica: ni contenedores, ni imagen, ni directorio, ni crons.
set -euo pipefail

DESTINO="$HOME/Backups/qualiaconta-codebox-$(date +%Y%m%d-%H%M%S).tar.gz"
mkdir -p "$(dirname "$DESTINO")"

echo "── 1. respaldo de lo no versionado a $DESTINO"
ssh codebox 'cd /home/codebox && tar czf - qualiaconta/repo/empresas/blackbox/.env qualiaconta/repo/empresas/blackbox/mesa-cache 2>/dev/null || tar czf - qualiaconta/repo/empresas/blackbox/.env' > "$DESTINO"
tar tzf "$DESTINO" | head -5
echo "   respaldo OK ($(du -h "$DESTINO" | cut -f1))"

echo "── 2. contenedores abajo"
ssh codebox 'cd /home/codebox/qualiaconta/repo/empresas/blackbox 2>/dev/null && docker compose down --remove-orphans || echo "compose ya no está"'

echo "── 3. imagen"
ssh codebox 'docker image rm qualiaconta:local 2>/dev/null || echo "imagen ya no está"'

echo "── 4. directorio  # rescate-server"
ssh codebox 'rm -rf /home/codebox/qualiaconta  # rescate-server'

echo "── 5. crontab"
ssh codebox 'crontab -l 2>/dev/null | grep -vi qualia | crontab - 2>/dev/null || true'

echo "── 6. verificación"
ssh codebox 'echo "contenedores qualia:"; docker ps -a --format "{{.Names}}" | grep -i qualia || echo "  ninguno";
  echo "imagen:"; docker images qualiaconta --format "{{.Repository}}" | grep . || echo "  ninguna";
  echo "directorio:"; ls -d /home/codebox/qualiaconta 2>/dev/null || echo "  no existe";
  echo "crons qualia:"; crontab -l 2>/dev/null | grep -i qualia || echo "  ninguno"'
echo
echo "CodeBox limpio de QualiaConta. El respaldo quedó en $DESTINO"
