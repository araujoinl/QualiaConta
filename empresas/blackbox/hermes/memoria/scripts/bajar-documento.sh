#!/bin/bash
# Baja a disco el documento de un trabajo de la mesa. Imprime la ruta local.
#
# Existe para que el contable NUNCA manipule la URL firmada a mano: es larga,
# lleva un JWT y varios '&', y cada vez que la copió de su contexto o la pasó a
# curl sin comillas terminó rota (HTTP 400 InvalidJWT) y culpó al vencimiento.
# Acá la URL se lee de la base y se usa entrecomillada, siempre.
#
# Uso:  bajar-documento.sh <trabajo_id>
# Sale 0 e imprime la ruta; sale 1 con el motivo por stderr.

set -u
: "${QUALIA_DSN:?falta QUALIA_DSN}"
ID="${1:?uso: bajar-documento.sh <trabajo_id>}"

fila=$(PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -t -A -q -F $'\t' \
  -c "select coalesce(archivo_nombre,'documento'), coalesce(archivo_url,'') from qualia_trabajos where id='$ID'" 2>/dev/null)

nombre=$(printf '%s' "$fila" | cut -f1)
url=$(printf '%s' "$fila" | cut -f2)

if [ -z "$url" ]; then
  echo "el trabajo $ID no tiene archivo (¿es una sugerencia o un bloque de criterios?)" >&2
  exit 1
fi

destino="/tmp/mesa/$ID"
mkdir -p "$destino"

# Mismo saneo de nombre que el preparador (preparar-trabajo.sh): así el
# short-circuit de abajo encuentra el archivo que él dejó, aunque el nombre
# original traiga caracteres raros.
base=$(basename -- "$nombre")
base=$(printf '%s' "$base" | tr -c 'A-Za-z0-9._ -' '_')
base="${base#.}"
[ -n "$base" ] || base="documento"
case "$base" in
  dossier.json|texto.txt) base="doc-$base" ;;
esac
if [ "${#base}" -gt 140 ]; then base="${base: -140}"; fi
salida="$destino/$base"

# Pista de tipo por stderr para que al agente le alcance la salida del script,
# sin encadenar comandos extra. Solo depende de la extensión.
case "${salida##*.}" in
  [jJ][pP][gG]|[jJ][pP][eE][gG]|[pP][nN][gG]|[wW][eE][bB][pP]) tipo="imagen (usar vision_analyze)" ;;
  [pP][dD][fF])   tipo="PDF (probar pypdf primero; si no trae texto, es escaneado -> vision)" ;;
  [xX][lL][sS]*)  tipo="Excel (openpyxl/pandas via uv)" ;;
  [xX][mM][lL])   tipo="XML e-CF (datos exactos)" ;;
  *)              tipo="desconocido" ;;
esac

# Short-circuit: si ya está en disco (>100 bytes, mismo umbral que valida la
# descarga) no se vuelve a pedir la URL. Lo normal es que lo haya dejado el
# preparador (preparar-trabajo.sh) o una corrida anterior; así no se
# re-descarga ni se depende de que la firma siga viva.
bytes=$(wc -c < "$salida" 2>/dev/null || echo 0)
if [ "$bytes" -gt 100 ]; then
  echo "ya estaba bajado: $(( bytes / 1024 )) KB, $tipo (no se re-descargó)" >&2
  echo "$salida"
  exit 0
fi

code=$(curl -sL -o "$salida" -w "%{http_code}" -m 90 "$url")
bytes=$(wc -c < "$salida" 2>/dev/null || echo 0)

if [ "$code" != "200" ] || [ "$bytes" -lt 100 ]; then
  rm -f "$salida"
  echo "no se pudo bajar (HTTP $code, $bytes bytes). La URL firmada dura 30 días;" >&2
  echo "si de verdad venció, pedile al humano que abra «Ver original» en la web:" >&2
  echo "eso la regenera. NO reescribas archivo_url: no tenés permiso y la romperías." >&2
  exit 1
fi

echo "bajado ok: $(( bytes / 1024 )) KB, $tipo" >&2

echo "$salida"
