#!/bin/bash
# Reconstruye la imagen qualiaconta:local DE PUNTA A PUNTA.
#
# Existe porque la cadena de build tiene dos eslabones y el primero es
# efímero: la limpieza diaria de Docker (Coolify, 00:00) borra
# hermes-agent:local en cuanto ningún contenedor la usa — y ninguno la usa,
# porque los contenedores corren qualiaconta:local. Un `docker build` de la
# capa fina a secas falla entonces en el FROM (pasó el 2026-08-02).
#
# Este script hace los DOS builds en orden y deja la imagen lista:
#   bash /home/codebox/qualiaconta/repo/deploy/rebuild.sh
#
# La base se construye desde la fuente pineada (Hermes v0.19.0 @ 14abd64,
# ~15-30 min la primera vez; el build cache acelera las siguientes mientras
# la limpieza no lo reclame). Después, la capa fina (~1 min).

set -euo pipefail

FUENTE=/home/codebox/qualiaconta/hermes-agent
DEPLOY="$(cd "$(dirname "$0")" && pwd)"
PIN=14abd64

actual=$(git -C "$FUENTE" rev-parse --short HEAD)
if [ "$actual" != "$PIN" ]; then
  echo "AVISO: la fuente de Hermes está en $actual, no en el pin $PIN." >&2
  echo "Si es intencional, actualizá PIN acá y el comentario del compose." >&2
  exit 1
fi

echo "== 1/2: hermes-agent:local desde la fuente ($PIN) =="
docker build -t hermes-agent:local "$FUENTE"

echo "== 2/2: qualiaconta:local (capa fina) =="
docker build -t qualiaconta:local -f "$DEPLOY/Dockerfile" "$DEPLOY"

echo "Listo. Para aplicar: cd empresas/<empresa> && docker compose up -d --force-recreate"
