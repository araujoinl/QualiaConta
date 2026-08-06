# Capa fina sobre Hermes: le agrega el cliente de Postgres y las herramientas
# del preparador de la mesa.
#
# Hermes no los trae. Sin psql el contable no puede consultar los movimientos
# del banco aunque tenga la conexión; sin `file` y poppler-utils (pdftotext)
# el preparador (mesa/preparar-trabajo.sh) no puede detectar el tipo real del
# documento ni extraer texto de un PDF sin gastar turnos de LLM. Es una capa
# de segundos sobre una imagen de 4 GB que no se reconstruye.
#
#   cd /home/codebox/qualiaconta/repo/deploy
#   docker build -t qualiaconta:local -f Dockerfile .
#
# La imagen base se construye desde la fuente de Hermes v0.19.0 (commit 14abd64):
#   cd /home/codebox/qualiaconta/hermes-agent && docker build -t hermes-agent:local .

FROM hermes-agent:local

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client file poppler-utils \
 && rm -rf /var/lib/apt/lists/*

# Pre-calentar el cache de uv con las ruedas que usa el preparador (pypdf de
# respaldo para PDFs, pillow-heif para fotos de iPhone, zxing-cpp para el QR del
# e-CF): sin esto, la PRIMERA factura tras cada recreación del contenedor
# pagaría la descarga en frío y podría comerse el timeout de la conversión. Si
# falla (sin red en el build), la imagen sirve igual — solo vuelve el costo de
# arranque en frío.
RUN uv run --with pypdf python -c "import pypdf" \
 && uv run --with pillow-heif python -c "import pillow_heif" \
 && uv run --with zxing-cpp --with pillow python -c "import zxingcpp, PIL" \
 || true
USER root

# El entrypoint de la base es ["/init", "/opt/hermes/docker/main-wrapper.sh"] y
# /init tiene que seguir siendo el primer comando de la cadena: hereda de la
# imagen base a propósito, no se redefine acá.
