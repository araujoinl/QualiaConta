# Capa fina sobre Hermes: le agrega el cliente de Postgres.
#
# Hermes no lo trae, y sin él el contable no puede consultar los movimientos
# del banco aunque tenga la conexión. Es una capa de segundos sobre una imagen
# de 4 GB que no se reconstruye.
#
#   cd /home/codebox/qualiaconta/repo/deploy
#   docker build -t qualiaconta:local -f Dockerfile .
#
# La imagen base se construye desde la fuente de Hermes v0.19.0 (commit 14abd64):
#   cd /home/codebox/qualiaconta/hermes-agent && docker build -t hermes-agent:local .

FROM hermes-agent:local

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client \
 && rm -rf /var/lib/apt/lists/*
USER root

# El entrypoint de la base es ["/init", "/opt/hermes/docker/main-wrapper.sh"] y
# /init tiene que seguir siendo el primer comando de la cadena: hereda de la
# imagen base a propósito, no se redefine acá.
