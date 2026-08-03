#!/bin/bash
# Pre-procesador determinista de la mesa de trabajo — SIN LLM.
#
# El poller lo corre ANTES de despertar al contable, por cada trabajo
# 'pendiente'. Deja un dossier masticado en /tmp/mesa/<id>/ (documento local,
# texto extraído, campos, verificación DGII, duplicados) para que el agente no
# gaste 15-25 turnos de terminal en pasos mecánicos y vaya directo al juicio
# contable. Si el dossier no llega a armarse, el agente sigue su protocolo
# completo: por eso acá TODO paso falla suave (se anota en errores_prep y se
# sigue) salvo la descarga, que es el único caso fatal.
#
# Contrato duro (SPEC — no negociable):
#   - NO cambia estado, salvo descarga imposible -> estado='error' guardado
#     con `where estado='pendiente'`. El claim pendiente->analizando sigue
#     siendo del contable; su candado anti doble-aviso no se toca.
#   - Deja UN evento de progreso (autor='contable') con un resumen humano
#     corto. Sin URLs, sin cuerpos de API.
#   - El poke al webhook lo hace el poller, no este script.
#   - Idempotente: si el dossier existente coincide con updated_at, sale 0.
#
# Uso:  preparar-trabajo.sh <trabajo_id>
#   (el poller lo invoca con `timeout 120`; ese es el tope global real)
#
# Env requerido: QUALIA_DSN, QUALIA_EMPRESA_ID
# Opcional:
#   GLM_API_KEY                                visión de imágenes (glm-4.6v)
#   GLM_VISION_BASE / GLM_VISION_MODEL         override del endpoint de visión
#   QUALIA_EMPRESA_RNC                         RNC comprador para timbre e-CF
#   MESA_SCRIPTS_DIR                           default /memoria-scripts
#   PREENTRENAMIENTO_DIR                       default /preentrenamiento
#   HERMES_UID / HERMES_GID                    default 1000 (dueño de /tmp/mesa)
#
# Nota deliberada: el prep NO habla con la API de ADM Cloud. El listado de
# VendorBills viene con NCF:null y su parámetro `search` no filtra (verificado
# 2026-08-02 contra la API real: un NCF inexistente devuelve el mismo registro
# que uno real) — consultarla sería una verificación falsa. Los duplicados
# contra ADM se resuelven con el histórico local del preentrenamiento
# (vendor-bills-detalle.jsonl, que SÍ trae NCF), y así el sidecar tampoco
# necesita credenciales de ADM.

set -u
umask 022
export LC_ALL=C

: "${QUALIA_DSN:?falta QUALIA_DSN}"
: "${QUALIA_EMPRESA_ID:?falta QUALIA_EMPRESA_ID}"

ID="${1:?uso: preparar-trabajo.sh <trabajo_id>}"

# trabajo_id y empresa_id viajan a SQL, rutas y logs: se validan ANTES de todo.
if ! [[ "$ID" =~ ^[0-9a-f-]{36}$ ]]; then
  echo "[prep] trabajo_id invalido: no es un UUID" >&2
  exit 1
fi
if ! [[ "$QUALIA_EMPRESA_ID" =~ ^[0-9a-f-]{36}$ ]]; then
  echo "[prep] QUALIA_EMPRESA_ID invalido: no es un UUID" >&2
  exit 1
fi

TAB=$'\t'
SCRIPTS="${MESA_SCRIPTS_DIR:-/memoria-scripts}"
PRE_DIR="${PREENTRENAMIENTO_DIR:-/preentrenamiento}"

log() { echo "[prep ${ID:0:8}] $(date -u +%H:%M:%S) $*"; }

# El sidecar corre como root; el contable como HERMES_UID. Todo lo que quede en
# /tmp/mesa/<id> debe terminar siendo del contable, incluso si el prep muere a
# mitad (timeout del poller manda TERM): sin esto el agente no podría escribir
# al lado del documento.
entregar() { [ -d "${DIR:-}" ] && chown -R "${HERMES_UID:-1000}:${HERMES_GID:-1000}" "$DIR" 2>/dev/null; true; }
# TERM/INT deben TERMINAR el script (un trap sin exit anula el `timeout` del
# poller: el script seguía corriendo tras la señal — hallazgo de auditoría).
trap entregar EXIT
trap 'entregar; exit 143' TERM INT

# python: el del venv de Hermes es el único garantizado en la imagen; el del
# PATH queda de respaldo. Sin python el prep degrada a solo-descarga.
PY="/opt/hermes/.venv/bin/python3"
[ -x "$PY" ] || PY="$(command -v python3 || true)"

sql() {
  # SQL SIEMPRE por stdin (heredoc) con valores por -v: psql los interpola con
  # :'var' entrecomillado. Nunca se concatena un dato del documento en el texto
  # del query (todo valor extraído es input hostil, SPEC seguridad).
  PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -X -q -t -A -F "$TAB" \
    -v ON_ERROR_STOP=1 "$@" 2>/dev/null
}

# ───────────────────────── 1. La fila y sus compuertas ─────────────────────────

fila=$(sql -v id="$ID" -v emp="$QUALIA_EMPRESA_ID" <<'SQL'
select estado,
       to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
       coalesce(archivo_nombre, 'documento'),
       coalesce(archivo_url, '')
  from qualia_trabajos
 where id = :'id' and empresa_id = :'emp';
SQL
) || fila=""

if [ -z "$fila" ]; then
  log "sin fila para ese id (o base inalcanzable); nada que preparar"
  exit 0
fi
IFS="$TAB" read -r ESTADO UPD NOMBRE URL <<< "$fila"

# El prep solo trabaja sobre 'pendiente'. Cualquier otro estado significa que
# el contable o el usuario ya están en eso: no se toca nada.
if [ "$ESTADO" != "pendiente" ]; then
  log "estado='$ESTADO', no es pendiente; no toco nada"
  exit 0
fi

DIR="/tmp/mesa/$ID"
PREP="$DIR/.prep"
DOSSIER="$DIR/dossier.json"

# Idempotencia (SPEC 9): el poller puede re-llamar cada 4s mientras el agente
# no reclama el trabajo. Si el dossier ya refleja este updated_at, no hay nada
# nuevo que preparar.
if [ -f "$DOSSIER" ] && [ -n "$PY" ]; then
  previo=$("$PY" -c 'import json,sys; print(json.load(open(sys.argv[1])).get("row_updated_at",""))' "$DOSSIER" 2>/dev/null || true)
  if [ -n "$previo" ] && [ "$previo" = "$UPD" ]; then
    log "dossier vigente (updated_at sin cambios); nada que hacer"
    exit 0
  fi
fi

# Sin archivo no hay nada que masticar (sugerencias y bloques de criterios no
# pasan por acá; si un pendiente viene sin URL, que lo resuelva el agente).
if [ -z "$URL" ]; then
  log "el trabajo no tiene archivo; nada que preparar"
  exit 0
fi

# GC del cache: cuando un trabajo se borra desde la web, su carpeta en
# /tmp/mesa sobrevive y su dossier se vuelve un FANTASMA que contamina el
# dedup (pasó el 2026-08-02: "2 duplicados en mesa" que eran carpetas de
# trabajos ya borrados). Se barren en UN solo viaje a la base (antes era una
# conexión por carpeta y la latencia crecía con la historia de la mesa).
# Nunca la carpeta del trabajo actual. Los nombres pasan la regex UUID antes
# de entrar al literal del array — sin eso no se interpolan.
CARPETAS=()
for d in /tmp/mesa/*/; do
  otro=$(basename "$d")
  [ "$otro" = "$ID" ] && continue
  [[ "$otro" =~ ^[0-9a-f-]{36}$ ]] && CARPETAS+=("$otro")
done
if [ "${#CARPETAS[@]}" -gt 0 ]; then
  lista="{$(IFS=,; echo "${CARPETAS[*]}")}"
  if vivos=$(sql -v ids="$lista" <<'SQL'
select id from qualia_trabajos where id = any(:'ids'::uuid[]);
SQL
  ); then
    # Query OK: lo que no volvió, no existe → se barre. Base caída → no tocar.
    for otro in "${CARPETAS[@]}"; do
      if ! grep -qx "$otro" <<< "$vivos"; then
        rm -rf "/tmp/mesa/$otro"
        log "GC: carpeta huérfana $otro barrida (trabajo borrado en la web)"
      fi
    done
  fi
fi
# Poda por edad: a los 35 días la URL firmada ya venció y el respaldo nocturno
# tiene el documento — la carpeta se retira aunque el trabajo siga vivo.
find /tmp/mesa -mindepth 1 -maxdepth 1 -type d -mtime +35 ! -name "$ID" -exec rm -rf {} + 2>/dev/null || true

# Workdir limpio: los fragmentos de una corrida anterior no deben contaminar
# esta (updated_at cambió = petición nueva). El dossier viejo queda hasta que
# el nuevo lo reemplace de forma atómica. .prep queda al final como diagnóstico.
mkdir -p "$PREP"
rm -rf "$PREP"
mkdir -p "$PREP"
rm -f "$DIR/texto.txt"
ERRORES="$PREP/errores.txt"

anotar_error() {
  # Falla suave: queda en errores_prep del dossier y en el log del sidecar.
  printf '%s\n' "$1" >> "$ERRORES"
  log "aviso: $1"
}

# ───────────────────────── 2. Descarga (único paso fatal) ─────────────────────────

# Nombre saneado: basename + lista blanca de caracteres. Es lo único del
# documento que toca el filesystem antes de validarse.
base=$(basename -- "$NOMBRE")
base=$(printf '%s' "$base" | tr -c 'A-Za-z0-9._ -' '_')
base="${base#.}"
[ -n "$base" ] || base="documento"
case "$base" in
  dossier.json|texto.txt) base="doc-$base" ;;   # que no pise nuestros artefactos
esac
if [ "${#base}" -gt 140 ]; then base="${base: -140}"; fi   # cola: conserva la extensión
SALIDA="$DIR/$base"

ext=""
case "$base" in *.*) ext="${base##*.}" ;; esac
ext=$(printf '%s' "$ext" | tr 'A-Z' 'a-z')

marcar_error_descarga() {
  # ÚNICO caso en que el prep toca el estado (SPEC, diseño 1). El guard
  # `estado='pendiente'` respeta el claim del contable: si alguien tomó el
  # trabajo entre medio, acá no se escribe nada. Sin URL en el mensaje.
  local det="No se pudo descargar el documento (HTTP $1, $2 bytes). La URL firmada dura 30 días; si venció, abrir «Ver original» en la web la regenera."
  local marcado
  marcado=$(sql -v id="$ID" -v emp="$QUALIA_EMPRESA_ID" -v det="$det" <<'SQL'
update qualia_trabajos
   set estado = 'error', error_detalle = :'det'
 where id = :'id' and empresa_id = :'emp' and estado = 'pendiente'
 returning id;
SQL
) || marcado=""
  if [ -n "$marcado" ]; then
    sql -v id="$ID" -v det="$det" <<'SQL' || true
insert into qualia_eventos (trabajo_id, autor, tipo, contenido)
values (:'id', 'contable', 'nota', :'det');
SQL
    log "descarga imposible (HTTP $1, $2 bytes): trabajo marcado en error"
  else
    log "descarga imposible (HTTP $1), pero el trabajo ya no está pendiente; no toco nada"
  fi
  exit 1
}

# Short-circuit: si el archivo ya está en el cache compartido con >100 bytes,
# no se re-descarga (misma regla que bajar-documento.sh). La URL firmada solo
# vive en $URL, siempre entrecomillada; jamás en logs, eventos ni dossier.
BYTES=0
if [ -f "$SALIDA" ]; then
  BYTES=$(wc -c 2>/dev/null < "$SALIDA" | tr -d '[:space:]')
  BYTES="${BYTES:-0}"
fi
if [ "$BYTES" -ge 100 ]; then
  log "documento ya en cache ($((BYTES / 1024)) KB); no re-descargo"
else
  # A .part + mv atómico: un TERM/KILL a mitad de curl no deja un archivo
  # parcial que el short-circuit (>100 bytes) sirva como bueno para siempre.
  code=$(curl -sSL -m 75 -o "$SALIDA.part" -w '%{http_code}' "$URL" 2>/dev/null) || code=000
  [[ "$code" =~ ^[0-9]{3}$ ]] || code=000
  BYTES=0
  [ -f "$SALIDA.part" ] && { BYTES=$(wc -c 2>/dev/null < "$SALIDA.part" | tr -d '[:space:]'); BYTES="${BYTES:-0}"; }
  if [ "$code" != "200" ] || [ "$BYTES" -lt 100 ]; then
    rm -f "$SALIDA.part"
    if [ "$code" = "000" ]; then
      # curl matado o red caída: transitorio — NO se marca error (el re-aviso
      # de los 300s reintenta y el agente tiene bajar-documento de respaldo).
      log "descarga cortada (curl sin código); fallo suave, sin tocar estado"
      exit 1
    fi
    marcar_error_descarga "$code" "$BYTES"
  fi
  mv -f "$SALIDA.part" "$SALIDA"
  log "descargado ($((BYTES / 1024)) KB)"
fi

if [ -z "$PY" ]; then
  # Sin python no hay extracción, dossier ni evento: el documento local ya es
  # ganancia (el agente se ahorra la descarga) y el resto lo hace él.
  log "sin python3 en la imagen: dejo solo el documento descargado"
  chown -R "${HERMES_UID:-1000}:${HERMES_GID:-1000}" "$DIR" 2>/dev/null || true
  exit 0
fi

# ───────────────────────── 3. Tipo de documento ─────────────────────────

TIPO=desconocido
ES_HEIC=no
CONVERTIDO=no
case "$ext" in
  pdf)               TIPO=pdf ;;
  jpg|jpeg|png|webp)
    TIPO=imagen
    # iPhone/WhatsApp renombran HEIC como .jpg al compartir: el CONTENIDO
    # manda — sin este sniff, la visión recibía bytes HEIC como image/jpeg
    # y fallaba en silencio (hallazgo de auditoría).
    if command -v file >/dev/null 2>&1; then
      case "$(file -b --mime-type "$SALIDA" 2>/dev/null)" in
        image/heic|image/heif) ES_HEIC=si ;;
      esac
    fi
    ;;
  heic|heif)         TIPO=imagen; ES_HEIC=si ;;
  xml)               TIPO=xml ;;
  xls|xlsx)          TIPO=excel ;;
  *)
    # Extensión fuera de la lista blanca: NO se renombra (se preserva la
    # convención de nombres del agente); se clasifica por contenido si `file`
    # existe (el Dockerfile lo agrega) y si no, queda desconocido sin extracción.
    if command -v file >/dev/null 2>&1; then
      case "$(file -b --mime-type "$SALIDA" 2>/dev/null)" in
        application/pdf)                 TIPO=pdf ;;
        image/jpeg|image/png|image/webp) TIPO=imagen ;;
        image/heic|image/heif)           TIPO=imagen; ES_HEIC=si ;;
        text/xml|application/xml)        TIPO=xml ;;
      esac
    fi
    if [ "$TIPO" = "desconocido" ]; then
      anotar_error "extension '.$ext' fuera de la lista blanca; sin extraccion"
    fi
    ;;
esac

# ───────────────────────── 4. Extracción por tipo ─────────────────────────

TXT="$DIR/texto.txt"
NOTA_EXTR="extraccion automatica; el agente DEBE verificar contra el documento"

frag_ninguno() {
  # $1 = motivo (texto fijo, sin datos del documento — es JSON armado a mano)
  printf '{"metodo": "ninguno", "nota": "%s"}\n' "$1" > "$PREP/extraccion.json"
}

extraer_campos_texto() {
  # Regex prudentes sobre texto.txt (SPEC 6): NCF, RNC, montos con contexto
  # TOTAL/ITBIS, fecha, moneda, y los extras del e-CF impreso (código de
  # seguridad + fecha de firma) que habilitan el timbre. Confianza media.
  local metodo="$1"
  if ! "$PY" - "$TXT" "$PREP/extraccion.json" "$metodo" 2>/dev/null <<'PY'
import json, re, sys
textop, outp, metodo = sys.argv[1:4]
NOTA = "extraccion automatica; el agente DEBE verificar contra el documento"
texto = open(textop, encoding="utf-8", errors="replace").read()
out = {"metodo": metodo, "confianza": "media", "nota": NOTA}

# NCF: regex del SPEC, validado a largo exacto (B+10 / E+12)
for m in re.finditer(r"\b[BE]\d{10,12}\b", texto):
    if re.fullmatch(r"B\d{10}|E\d{12}", m.group(0)):
        out["ncf"] = m.group(0)
        break

# RNC: con contexto. El primero etiquetado se asume del emisor (encabeza el
# documento); el segundo distinto, del comprador — habilita el timbre e-CF.
rncs = []
for m in re.finditer(r"RNC[^0-9]{0,20}(\d[\d.\- ]{6,14}\d)", texto, re.I):
    limpio = re.sub(r"\D", "", m.group(1))
    if len(limpio) in (9, 11) and limpio not in rncs:
        rncs.append(limpio)
if not rncs:
    m = re.search(r"\b(\d{9})\b", texto)   # último recurso: 9 dígitos sueltos
    if m:
        rncs.append(m.group(1))
if rncs:
    out["rnc"] = rncs[0]
if len(rncs) > 1:
    out["rnc_comprador"] = rncs[1]

MONTO = r"(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})"
def montos_en(linea):
    return [float(x.replace(",", "")) for x in re.findall(MONTO, linea)]
tot, itb = [], []
for linea in texto.splitlines():
    if re.search(r"\bITBIS\b", linea, re.I):
        itb += montos_en(linea)
    if re.search(r"\bTOTAL\b", linea, re.I) and not re.search(r"SUB\s*-?\s*TOTAL", linea, re.I):
        tot += montos_en(linea)
if tot:
    out["monto"] = max(tot)          # el total final es el mayor de las líneas TOTAL
if itb:
    cand = [x for x in itb if "monto" not in out or x <= out["monto"]]
    if cand:
        out["itbis"] = max(cand)

m = (re.search(r"Fecha\s*(?:de\s*)?Emisi[oó]n[^0-9]{0,20}(\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2})", texto, re.I)
     or re.search(r"\bFecha\b[^0-9]{0,20}(\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2})", texto, re.I))
if m:
    f = m.group(1).replace("/", "-")
    mm = re.fullmatch(r"(\d{1,2})-(\d{1,2})-(\d{4})", f)
    out["fecha"] = "%s-%02d-%02d" % (mm.group(3), int(mm.group(2)), int(mm.group(1))) if mm else f

usd = bool(re.search(r"US\$|\bUSD\b", texto))
dop = bool(re.search(r"RD\$|\bDOP\b", texto))
if dop != usd:
    out["moneda"] = "DOP" if dop else "USD"

# Teléfono del emisor, SOLO si viene impreso (regla del dueño: el contacto
# sale del documento o de ningún lado).
m = re.search(r"(?:Tel[eé]?f?o?n?o?|TEL)\.?\s*:?\s*(\+?[\d\- \(\)\.]{7,20}\d)", texto, re.I)
if m:
    tel = re.sub(r"[^\d+]", "", m.group(1))
    if 10 <= len(tel) <= 14:
        out["telefono"] = tel

# Extras del e-CF: sirven para verificar el timbre (SPEC 7)
m = re.search(r"C[oó]digo\s+de\s+Seguridad[^A-Za-z0-9+/=]{0,15}([A-Za-z0-9+/=]{6})", texto, re.I)
if m:
    out["codigo_seguridad"] = m.group(1)
m = re.search(r"Fecha\s*(?:de\s*)?Firma[^0-9]{0,20}(\d{1,2}[-/]\d{1,2}[-/]\d{4}\s+\d{1,2}:\d{2}:\d{2})", texto, re.I)
if m:
    v = m.group(1).replace("/", "-")
    mm = re.fullmatch(r"(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})", v)
    if mm:
        out["fecha_firma"] = "%02d-%02d-%s %02d:%s:%s" % (
            int(mm.group(1)), int(mm.group(2)), mm.group(3),
            int(mm.group(4)), mm.group(5), mm.group(6))

json.dump(out, open(outp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
  then
    anotar_error "extraccion de campos del texto fallo"
    frag_ninguno "sin extraccion automatica; el agente sigue el protocolo completo"
  fi
}

extraccion_xml() {
  # e-CF en XML: datos exactos con la stdlib (SPEC 6). También deja texto.txt
  # (tag: valor por línea) para que el agente lea sin re-parsear.
  if ! "$PY" - "$SALIDA" "$PREP/extraccion.json" "$TXT" 2>"$PREP/xml.err" <<'PY'
import json, re, sys
import xml.etree.ElementTree as ET
xmlp, outp, textop = sys.argv[1:4]
NOTA = "extraccion automatica; el agente DEBE verificar contra el documento"

def local(tag):
    return tag.rsplit("}", 1)[-1]

try:
    arbol = ET.parse(xmlp)
except ET.ParseError as e:
    print("XML invalido: %s" % str(e)[:80], file=sys.stderr)
    sys.exit(1)

campos, lineas = {}, []
for el in arbol.iter():
    tag = local(el.tag)
    txt = (el.text or "").strip()
    if txt:
        lineas.append("%s: %s" % (tag, txt))
        campos.setdefault(tag, txt)   # primer valor gana: el encabezado va antes que los items
open(textop, "w", encoding="utf-8").write("\n".join(lineas) + "\n")

def num(v):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None

def fecha_iso(v):
    m = re.fullmatch(r"(\d{2})-(\d{2})-(\d{4})", v or "")
    return "%s-%s-%s" % (m.group(3), m.group(2), m.group(1)) if m else v

out = {"metodo": "xml", "confianza": "alta", "nota": NOTA}
mapa = [("RNCEmisor", "rnc"), ("RazonSocialEmisor", "proveedor"),
        ("eNCF", "ncf"), ("ENCF", "ncf"), ("FechaEmision", "fecha"),
        ("TipoMoneda", "moneda"), ("MontoTotal", "monto"),
        ("TotalITBIS", "itbis"), ("RNCComprador", "rnc_comprador"),
        ("FechaHoraFirma", "fecha_firma")]
for tag, clave in mapa:
    if tag in campos and clave not in out:
        out[clave] = campos[tag]
if "monto" in out:
    out["monto"] = num(out["monto"])
if "itbis" in out:
    out["itbis"] = num(out["itbis"])
if "fecha" in out:
    out["fecha"] = fecha_iso(out["fecha"])
out.setdefault("moneda", "DOP")   # el e-CF omite TipoMoneda cuando es peso dominicano
if out.get("ncf"):
    out["ncf"] = str(out["ncf"]).strip().upper()
for clave in ("rnc", "rnc_comprador"):
    if out.get(clave):
        out[clave] = re.sub(r"\D", "", str(out[clave]))
out = {k: v for k, v in out.items() if v not in (None, "")}
json.dump(out, open(outp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
  then
    anotar_error "parseo XML fallo: $(head -c 120 "$PREP/xml.err" 2>/dev/null || echo sin detalle)"
    frag_ninguno "XML no parseable; el agente sigue el protocolo completo"
    rm -f "$TXT"
  fi
}

extraccion_pdf() {
  # pdftotext -layout primero (lo agrega el Dockerfile); pypdf vía uv de
  # respaldo. Si el texto sale vacío es un escaneado: decisión del SPEC, acá
  # NO se hace visión sobre PDFs — metodo='ninguno' y el agente decide.
  local metodo=""
  if command -v pdftotext >/dev/null 2>&1; then
    if timeout 30 pdftotext -layout "$SALIDA" "$TXT" 2>/dev/null; then
      metodo="pdftotext"
    fi
  fi
  if [ -z "$metodo" ] && command -v uv >/dev/null 2>&1; then
    if timeout 60 uv run --with pypdf python - "$SALIDA" "$TXT" >/dev/null 2>&1 <<'PY'
import sys
from pypdf import PdfReader
pdf, destino = sys.argv[1:3]
open(destino, "w", encoding="utf-8").write(
    "\n".join((p.extract_text() or "") for p in PdfReader(pdf).pages))
PY
    then
      metodo="pypdf"
    fi
  fi
  if [ -z "$metodo" ]; then
    anotar_error "no pude extraer texto del PDF (ni pdftotext ni pypdf)"
    frag_ninguno "sin extraccion automatica; el agente sigue el protocolo completo"
    rm -f "$TXT"
    return
  fi
  if ! grep -q '[^[:space:]]' "$TXT" 2>/dev/null; then
    rm -f "$TXT"
    frag_ninguno "PDF sin capa de texto (posible escaneado); el agente decide si aplica vision"
    return
  fi
  extraer_campos_texto "$metodo"
}

extraccion_imagen() {
  # UNA llamada a glm-4.6v (SPEC 6): imagen en data URL base64, prompt fijo
  # pidiendo SOLO JSON, temperatura 0, timeout 60s por intento, 1 reintento.
  # Tope duro de 90s alrededor de todo. Si falla, el agente hará visión.
  #
  # Las fotos son el único camino lento del prep (~20-30s): se avisa al hilo
  # que ya se está leyendo, para que la espera no parezca cola muerta. Los
  # PDF/XML terminan en segundos y no necesitan este aviso.
  sql -v id="$ID" <<'SQL' || true
insert into qualia_eventos (trabajo_id, autor, tipo, contenido)
values (:'id', 'contable', 'progreso', '⚙️ Preparador: leyendo la foto…');
SQL
  local IMG="$SALIDA"
  if [ "$ES_HEIC" = "si" ]; then
    local JPG="${SALIDA%.*}.jpg"
    if command -v uv >/dev/null 2>&1 && \
       timeout 60 uv run --with pillow-heif python -c \
         "import sys, pillow_heif, PIL.Image as I; pillow_heif.register_heif_opener(); I.open(sys.argv[1]).convert('RGB').save(sys.argv[2], quality=90)" \
         "$SALIDA" "$JPG" >/dev/null 2>&1 && [ -s "$JPG" ]; then
      CONVERTIDO=si
      IMG="$JPG"
      log "HEIC convertido a jpg"
    else
      anotar_error "conversion HEIC fallo; sin vision en el prep"
      frag_ninguno "HEIC sin convertir; el agente convierte y decide"
      return
    fi
  fi
  if [ -z "${GLM_API_KEY:-}" ]; then
    anotar_error "GLM_API_KEY ausente; sin vision en el prep"
    frag_ninguno "sin vision en el prep (falta GLM_API_KEY); el agente aplica vision"
    return
  fi
  local peso
  peso=$(wc -c < "$IMG" 2>/dev/null | tr -d '[:space:]') || peso=0
  if [ "${peso:-0}" -gt 10000000 ]; then
    anotar_error "imagen mayor a 10 MB; sin vision en el prep"
    frag_ninguno "imagen muy grande para el prep; el agente aplica vision"
    return
  fi
  if ! timeout 90 "$PY" - "$IMG" "$PREP/extraccion.json" 2>"$PREP/vision.err" <<'PY'
import base64, json, os, re, sys, urllib.request
img, outp = sys.argv[1:3]
NOTA = "extraccion automatica; el agente DEBE verificar contra el documento"
base = os.environ.get("GLM_VISION_BASE", "https://api.z.ai/api/coding/paas/v4").rstrip("/")
modelo = os.environ.get("GLM_VISION_MODEL", "glm-4.6v")
llave = os.environ["GLM_API_KEY"]
ext = img.rsplit(".", 1)[-1].lower()
mime = {"png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")
b64 = base64.b64encode(open(img, "rb").read()).decode()
prompt = (
    "Lee esta imagen de un comprobante fiscal dominicano y responde SOLO un JSON "
    "(sin markdown, sin texto extra). DATO CLAVE: si es de restaurante/bar, en "
    "Republica Dominicana el consumo lleva SIEMPRE DOS cargos: ITBIS 18% Y "
    "propina legal 10% (Ley 16-92) — busca AMBOS renglones, los dos estan "
    "impresos. Forma exacta: "
    '{"proveedor": str|null, "rnc": str|null (solo digitos del RNC del emisor), '
    '"ncf": str|null, "fecha": "YYYY-MM-DD"|null, "moneda": "DOP"|"USD"|null, '
    '"monto": number|null (total del documento), "itbis": number|null, '
    '"codigo_seguridad": str|null (6 caracteres, solo si es e-CF y se lee), '
    '"fecha_firma": "DD-MM-YYYY HH:MM:SS"|null (solo si se lee), '
    '"telefono": str|null (telefono del emisor IMPRESO en el documento), '
    '"numero_factura_suplidor": str|null (el numero PROPIO del proveedor, '
    "distinto del NCF: suele decir Factura No., No. Factura, Invoice, "
    "Documento o Pedido, y suele traer letras y guion como FTGAZ-025375), "
    '"items": [{"descripcion": str, "cantidad": number, "precio": number '
    "(unitario sin ITBIS), "
    '"itbis": number (ITBIS de ese renglon, 0 si exento)}] '
    "(un item por renglon de consumo del documento; null si no se leen), "
    '"propina": number|null (propina legal 10%: puede decir Propina, 10% Ley, '
    "Ley 16-92, Servicio, Service o Prop. — cualquier renglon de ~10% sobre el "
    "consumo), "
    '"confianza": "alta"|"media"|"baja"}. '
    "Usa null en lo que no puedas leer. No inventes valores ni renglones."
)
cuerpo = json.dumps({
    "model": modelo,
    "temperature": 0,
    # glm-4.6v es un modelo pensante: pensando, el prompt de items se pasaba
    # del timeout (2 visiones paralelas murieron a los 90s el 2026-08-02) o
    # gastaba el tope en reasoning_content y entregaba content vacio.
    # Extraer renglones no requiere razonamiento profundo: thinking APAGADO
    # -> respuesta directa en ~15s (medido con factura real).
    "thinking": {"type": "disabled"},
    "max_tokens": 3000,
    "messages": [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": "data:%s;base64,%s" % (mime, b64)}},
        {"type": "text", "text": prompt},
    ]}],
}).encode()
resp, ultimo = None, "sin intento"
for intento in (1, 2):   # 1 reintento (SPEC)
    try:
        req = urllib.request.Request(
            base + "/chat/completions", data=cuerpo,
            headers={"Authorization": "Bearer " + llave, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            resp = json.load(r)
        break
    except Exception as e:
        ultimo = type(e).__name__   # solo el tipo: nada de cuerpos ni URLs en stderr
if resp is None:
    print("vision fallo (%s)" % ultimo, file=sys.stderr)
    sys.exit(1)
datos = None
mensaje = resp.get("choices", [{}])[0].get("message", {})
# El JSON puede venir en content o — si el modelo agoto el tope pensando —
# solo en reasoning_content: se buscan ambos, en ese orden.
for origen in ("content", "reasoning_content"):
    contenido = mensaje.get(origen) or ""
    m = re.search(r"\{.*\}", contenido, re.S)
    if not m:
        continue
    try:
        datos = json.loads(m.group(0))
        break
    except ValueError:
        continue
if datos is None:
    print("vision: la respuesta no trajo JSON parseable", file=sys.stderr)
    sys.exit(1)
out = {"metodo": "vision-glm4.6v", "nota": NOTA}
out["confianza"] = datos.get("confianza") if datos.get("confianza") in ("alta", "media", "baja") else "media"
for clave in ("proveedor", "rnc", "ncf", "fecha", "moneda"):
    v = datos.get(clave)
    if isinstance(v, str) and v.strip():
        out[clave] = v.strip()
for clave in ("monto", "itbis"):
    v = datos.get(clave)
    if isinstance(v, (int, float)):
        out[clave] = float(v)
    elif isinstance(v, str):
        try:
            out[clave] = float(v.replace(",", ""))
        except ValueError:
            pass
if out.get("ncf"):
    out["ncf"] = out["ncf"].upper().replace(" ", "")
if out.get("rnc"):
    out["rnc"] = re.sub(r"\D", "", out["rnc"])
# Extras del timbre e-CF, si la foto los trae (el bash los re-valida igual):
cs = str(datos.get("codigo_seguridad") or "").strip()
if re.fullmatch(r"[A-Za-z0-9+/=]{6}", cs):
    out["codigo_seguridad"] = cs
ff = str(datos.get("fecha_firma") or "").strip().replace("/", "-")
if re.fullmatch(r"\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}", ff):
    out["fecha_firma"] = ff
# Teléfono del emisor: SOLO el impreso en el documento (regla del dueño) —
# es lo único que la propuesta puede ofrecer como contacto.
tel = re.sub(r"[^\d+]", "", str(datos.get("telefono") or ""))
if 10 <= len(tel) <= 14:
    out["telefono"] = tel

# Items del documento: la tabla que el contable necesita para las líneas.
# Validados uno a uno; ante cualquier cosa rara el renglón se descarta (mejor
# tabla incompleta que inventada — el agente nota el faltante por aritmética).
def numero(v):
    return round(float(v), 2) if isinstance(v, (int, float)) and v >= 0 and v < 10**9 else None

items = []
for it in (datos.get("items") or [])[:40]:
    if not isinstance(it, dict):
        continue
    desc = str(it.get("descripcion") or "").strip()[:80]
    cant = numero(it.get("cantidad"))
    prec = numero(it.get("precio"))
    itb = numero(it.get("itbis"))
    if desc and cant and prec is not None:
        items.append({"descripcion": desc, "cantidad": cant,
                      "precio": prec, "itbis": itb if itb is not None else 0})
prop = numero(datos.get("propina"))
if items:
    out["items"] = items
    if prop:
        out["propina"] = prop
    # Aritmética verificada acá, determinista: base + ITBIS + propina vs total.
    if isinstance(out.get("monto"), (int, float)):
        base = round(sum(i["precio"] * i["cantidad"] for i in items), 2)
        itbis_items = round(sum(i["itbis"] for i in items), 2)
        calc = round(base + itbis_items + (prop or 0), 2)
        diff = round(out["monto"] - calc, 2)
        # La visión a veces pierde el renglón de la propina aunque esté
        # IMPRESO: si el descuadre calza EXACTO con el 10% de la base (±1
        # peso), eso ES la propina legal — se infiere acá, determinista,
        # para que el contable proponga a la primera sin preguntar (regla
        # del dueño 2026-08-02: lo obvio se resuelve solo).
        if prop is None and diff > 0 and abs(diff - round(0.10 * base, 2)) <= 1.0:
            prop = diff
            out["propina"] = prop
            out["propina_inferida"] = True
            calc = round(base + itbis_items + prop, 2)
        # Umbral 0.05: el MISMO que valida la web al aprobar. Con 1.0 había
        # una zona muerta (0.05-1.00) donde el dossier decía cuadra y la web
        # pintaba rojo (hallazgo de auditoría).
        out["aritmetica"] = {"base_items": base, "itbis_items": itbis_items,
                            "propina": prop or 0, "calculado": calc,
                            "monto_documento": out["monto"],
                            "cuadra": abs(calc - out["monto"]) <= 0.05}
        if out.get("propina_inferida"):
            out["aritmetica"]["nota"] = ("propina legal 10% inferida del "
                                         "descuadre exacto; verificable en el documento")
json.dump(out, open(outp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
  then
    anotar_error "vision: $(head -c 120 "$PREP/vision.err" 2>/dev/null || echo fallo)"
    frag_ninguno "vision fallo en el prep; el agente aplica vision"
  fi
}

case "$TIPO" in
  xml)    extraccion_xml ;;
  pdf)    extraccion_pdf ;;
  imagen) extraccion_imagen ;;
  excel)  frag_ninguno "Excel: la nomina u hoja la razona el agente (sin extraccion en el prep)" ;;
  *)      frag_ninguno "tipo desconocido; el agente sigue el protocolo completo" ;;
esac

# ───────────── 5. Campos extraídos, re-validados antes de usarse ─────────────

# TODO valor que salió del documento es input hostil (SPEC seguridad): solo
# entra a URLs, SQL (-v) o comandos si pasa su regex acá. Lo que no pasa se
# queda en el dossier como dato informativo, pero no se usa.
leer_campo() {
  [ -f "$PREP/extraccion.json" ] || return 0
  "$PY" -c 'import json, sys
v = json.load(open(sys.argv[1])).get(sys.argv[2], "")
print("" if v is None else v)' "$PREP/extraccion.json" "$1" 2>/dev/null || true
}

NCF=$(leer_campo ncf)
[[ "$NCF" =~ ^(B[0-9]{10}|E[0-9]{12})$ ]] || NCF=""
RNC=$(leer_campo rnc)
[[ "$RNC" =~ ^([0-9]{9}|[0-9]{11})$ ]] || RNC=""

# Rescate del NCF impreso con UN digito de mas. La vision mete un digito
# espurio con frecuencia (2026-08-02: leyo B01000000500 donde el papel decia
# B0100000050) y el regex de arriba, que esta bien puesto porque esto es input
# hostil, lo descarta entero. Sin NCF no hay DGII ni dedup, y el agente vuelve
# a la imagen con vision: 8 minutos de reloj y una propuesta equivocada (declaro
# gasto no admitido sobre una factura que SI daba credito fiscal).
# Se prueban solo las candidatas de borrar un digito, cada una re-validada por
# el MISMO regex antes de tocar la red, y gana la primera que DGII de VIGENTE.
# Si ninguna verifica, NCF sigue vacio: no se adivina.
# Numero propio del suplidor (el `Reference` de ADM, no el NCF). Formato
# libre entre proveedores, asi que solo se acota largo y juego de
# caracteres: entra a un campo de texto de la API, nunca a SQL ni a URLs.
NUM_SUPLIDOR=$(leer_campo numero_factura_suplidor)
[[ "$NUM_SUPLIDOR" =~ ^[A-Za-z0-9][A-Za-z0-9./-]{1,39}$ ]] || NUM_SUPLIDOR=""

# Si la vision no lo saco pero hay texto (los e-CF en PDF se leen por texto),
# se busca impreso: "Factura No.: FTGAZ-025375" y sus variantes.
if [ -z "$NUM_SUPLIDOR" ] && [ -f "$DIR/texto.txt" ]; then
  NUM_SUPLIDOR=$(grep -aoiE "(factura|invoice|documento|pedido)[[:space:]]*(no\.?|num(ero)?\.?|#)?[[:space:]]*:?[[:space:]]*[A-Za-z0-9][A-Za-z0-9./-]{2,39}" "$DIR/texto.txt" 2>/dev/null \
    | head -1 | grep -aoE "[A-Za-z0-9][A-Za-z0-9./-]{2,39}$" || true)
  [[ "$NUM_SUPLIDOR" =~ ^[A-Za-z0-9][A-Za-z0-9./-]{1,39}$ ]] || NUM_SUPLIDOR=""
  # El NCF no es el numero del suplidor: si el regex agarro el NCF, se descarta.
  [ "$NUM_SUPLIDOR" = "$NCF" ] && NUM_SUPLIDOR=""
fi

NCF_CRUDO=$(leer_campo ncf)
NCF_RESCATADO=""
if [ -z "$NCF" ] && [ -n "$RNC" ] && [[ "$NCF_CRUDO" =~ ^B[0-9]{11}$ ]] \
   && [ -f "$SCRIPTS/consultar-ncf-dgii.py" ]; then
  intentos=0
  while read -r cand; do
    [ -n "$cand" ] || continue
    [[ "$cand" =~ ^B[0-9]{10}$ ]] || continue
    intentos=$((intentos + 1))
    [ "$intentos" -gt 8 ] && break
    if timeout 20 "$PY" "$SCRIPTS/consultar-ncf-dgii.py" --rnc "$RNC" --ncf "$cand" \
         > "$PREP/dgii_try.json" 2>/dev/null \
       && grep -q '"estado": *"VIGENTE"' "$PREP/dgii_try.json"; then
      NCF="$cand"
      NCF_RESCATADO="$cand"
      log "NCF rescatado: lei $NCF_CRUDO (formato invalido) -> $cand VIGENTE en DGII"
      break
    fi
  done < <("$PY" - "$NCF_CRUDO" <<'PYNCF'
import sys
crudo = sys.argv[1]
# Solo borrado de un digito: la letra inicial no se toca y el caso "falta un
# digito" no se intenta (serian 100 candidatas y 100 consultas a DGII).
vistas = []
for i in range(1, len(crudo)):
    c = crudo[:i] + crudo[i + 1:]
    if c not in vistas:
        vistas.append(c)
print("\n".join(vistas))
PYNCF
  )
  rm -f "$PREP/dgii_try.json"
fi
FECHA=$(leer_campo fecha)
[[ "$FECHA" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || FECHA=""
MONTO=$(leer_campo monto)
[[ "$MONTO" =~ ^[0-9]+(\.[0-9]+)?$ ]] || MONTO=""
MONTO_FMT=""
[ -n "$MONTO" ] && MONTO_FMT=$(printf '%.2f' "$MONTO")
CODIGO=$(leer_campo codigo_seguridad)
[[ "$CODIGO" =~ ^[A-Za-z0-9+/=]{6}$ ]] || CODIGO=""
FFIRMA=$(leer_campo fecha_firma)
RE_FF='^[0-9]{2}-[0-9]{2}-[0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2}$'
[[ "$FFIRMA" =~ $RE_FF ]] || FFIRMA=""
RNCC=$(leer_campo rnc_comprador)
[[ "$RNCC" =~ ^([0-9]{9}|[0-9]{11})$ ]] || RNCC=""
if [ -z "$RNCC" ] && [ -n "${QUALIA_EMPRESA_RNC:-}" ]; then
  [[ "$QUALIA_EMPRESA_RNC" =~ ^([0-9]{9}|[0-9]{11})$ ]] && RNCC="$QUALIA_EMPRESA_RNC"
fi

# ───────────────────────── 6. Verificación DGII ─────────────────────────

escribir_dgii_nv() {
  # $1 = motivo (texto fijo del script, sin datos del documento)
  printf '{"estado": "no verificable", "motivo": "%s"}\n' "$1" > "$PREP/dgii.json"
}

if [ -z "$NCF" ]; then
  # Distinguir "no habia NCF" de "lo lei mal" es lo que evita que el agente
  # concluya que el documento no lo trae y vuelva a la imagen con vision.
  # Longitudes fijas de DGII: impreso B+10 = 11 posiciones, e-CF E+12 = 13.
  if [ -n "$NCF_CRUDO" ]; then
    escribir_dgii_nv "se leyó un NCF con formato inválido (${#NCF_CRUDO} posiciones; el impreso lleva 11 y el e-CF 13): confirmá el número contra el documento antes de descartarlo"
  else
    escribir_dgii_nv "sin NCF extraído"
  fi
elif [[ "$NCF" == B* ]]; then
  # NCF impreso: consulta pública de DGII vía el script ya probado (SPEC 7).
  if [ -z "$RNC" ]; then
    escribir_dgii_nv "NCF impreso sin RNC emisor extraído; verificar manualmente"
  elif [ ! -f "$SCRIPTS/consultar-ncf-dgii.py" ]; then
    escribir_dgii_nv "consultar-ncf-dgii.py no montado en el sidecar"
  elif ! timeout 45 "$PY" "$SCRIPTS/consultar-ncf-dgii.py" --rnc "$RNC" --ncf "$NCF" > "$PREP/dgii.json" 2>/dev/null \
       || [ ! -s "$PREP/dgii.json" ]; then
    anotar_error "consulta DGII del NCF impreso fallo o excedio el tiempo"
    escribir_dgii_nv "la consulta a DGII fallo o excedio el tiempo"
  fi
else
  # e-CF: SOLO si del documento salieron código de seguridad y fecha de firma
  # (SPEC 7); además el timbre exige RNCs, fecha de emisión y monto exactos.
  if [ -z "$CODIGO" ] || [ -z "$FFIRMA" ]; then
    escribir_dgii_nv "faltan codigo/fecha firma; verificar timbre manualmente"
  elif [ -z "$RNC" ] || [ -z "$RNCC" ] || [ -z "$FECHA" ] || [ -z "$MONTO_FMT" ]; then
    escribir_dgii_nv "faltan datos para armar la consulta del timbre (RNC emisor/comprador, fecha o monto); verificar manualmente"
  elif ! timeout 40 "$PY" - "$PREP/dgii.json" \
         "rnc_emisor=$RNC" "rnc_comprador=$RNCC" "encf=$NCF" \
         "fecha_emision=$FECHA" "monto=$MONTO_FMT" \
         "fecha_firma=$FFIRMA" "codigo=$CODIGO" 2>/dev/null <<'PY'
import datetime, json, re, sys, urllib.parse, urllib.request
outp = sys.argv[1]
p = {}
for arg in sys.argv[2:]:
    k, _, v = arg.partition("=")
    p[k] = v
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

def ddmmaaaa(f):
    a, m, d = f.split("-")
    return "%s-%s-%s" % (d, m, a)

tipo = p["encf"][1:3]
ruta = "ConsultaTimbreFC" if tipo == "32" else "ConsultaTimbre"
salida = {"tipo": "ecf", "encf": p["encf"], "fuente": "ecf.dgii.gov.do/ecf/" + ruta}
try:
    # quote_via=quote: el espacio de FechaFirma viaja como %20, no '+' — es el
    # formato del QR real (SKILL.md §5b).
    qs = urllib.parse.urlencode({
        "RncEmisor": p["rnc_emisor"], "RncComprador": p["rnc_comprador"],
        "ENCF": p["encf"], "FechaEmision": ddmmaaaa(p["fecha_emision"]),
        "MontoTotal": p["monto"], "FechaFirma": p["fecha_firma"],
        "CodigoSeguridad": p["codigo"]}, quote_via=urllib.parse.quote)
    req = urllib.request.Request(
        "https://ecf.dgii.gov.do/ecf/%s?%s" % (ruta, qs),
        headers={"User-Agent": UA, "Accept-Language": "es-DO,es;q=0.9"})
    with urllib.request.urlopen(req, timeout=30) as r:
        html = r.read().decode("utf-8", "replace")
    # mismo aplanado de HTML que consultar-ncf-dgii.py
    t = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html)
    t = re.sub(r"(?i)<br\s*/?>|</tr>|</p>|</div>", "\n", t)
    t = re.sub(r"(?i)</t[dh]>", " | ", t)
    t = re.sub(r"<[^>]+>", " ", t).replace("&nbsp;", " ")
    t = re.sub(r"[ \t]{2,}", " ", t)
    campos = [
        (r"Estado", "estado"),
        (r"RNC\s*Emisor", "rnc_emisor"),
        (r"Raz[oó]n\s+Social\s+(?:del\s+)?Emisor", "razon_social_emisor"),
        (r"RNC\s*Comprador", "rnc_comprador"),
        (r"Raz[oó]n\s+Social\s+(?:del\s+)?Comprador", "razon_social_comprador"),
        (r"Total\s*(?:de\s*)?ITBIS", "total_itbis"),
        (r"Monto\s*Total", "monto_total"),
        (r"Fecha\s*(?:de\s*)?Emisi[oó]n", "fecha_emision"),
    ]
    for patron, clave in campos:
        m = re.search(patron + r"\s*[:|]\s*([^\n|]{1,80})", t, re.I)
        if m:
            v = m.group(1).strip(" .|")
            if v and not re.fullmatch(r"[-–—]*", v):
                salida.setdefault(clave, v)
    for clave in ("total_itbis", "monto_total"):
        if clave in salida:
            crudo = salida[clave].replace("RD$", "").replace("$", "").replace(",", "").strip()
            try:
                salida[clave] = float(crudo)
            except ValueError:
                pass
    if "estado" not in salida:
        # La tabla no trajo la etiqueta "Estado": barrido por palabra clave
        # (el orden importa: "Aceptado Condicional" antes que "Aceptado").
        for patron, valor in (
                (r"Aceptado\s+Condicional", "Aceptado Condicional"),
                (r"\bAceptado\b", "Aceptado"),
                (r"\bRechazado\b", "Rechazado"),
                (r"\bEn\s+Proceso\b", "En Proceso"),
                (r"no\s+(?:se\s+encontr|existe)", "NO ENCONTRADO")):
            if re.search(patron, t, re.I):
                salida["estado"] = valor
                break
    if "estado" not in salida:
        salida["estado"] = "no verificable"
        salida["motivo"] = "la respuesta del timbre no trajo un estado reconocible"
    salida["verificado_en"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
except Exception as e:
    salida["estado"] = "no verificable"
    salida["motivo"] = "consulta de timbre fallo: %s" % type(e).__name__
json.dump(salida, open(outp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
  then
    anotar_error "consulta del timbre e-CF fallo o excedio el tiempo"
    escribir_dgii_nv "la consulta del timbre fallo o excedio el tiempo"
  fi
fi

# ──────────────── 6b. Padrón de RNC: de quién es el RNC del emisor ────────────────

# Pregunta distinta a la del bloque 6 (¿el comprobante vale?) y por eso vive en
# su propia clave del dossier: acá solo se resuelve el NOMBRE OFICIAL del dueño
# del RNC. Corre SIEMPRE que haya RNC, no solo cuando el bloque 6 falla, porque
# el agente también lo necesita para el contraste "razón social de DGII contra
# el proveedor que leí" (SKILL §5a) y para crear el proveedor en ADM (§«Nombre»).
#
# Es el fallback que rescata al e-CF sin código de seguridad legible: el timbre
# exige QR/código + fecha de firma y se queda sin razón social cuando la foto no
# los deja leer, mientras que el padrón solo pide el RNC, que siempre se lee.
if [ -n "$RNC" ]; then
  if [ ! -f "$SCRIPTS/consultar-rnc-dgii.py" ]; then
    printf '{"estado": "no verificable", "motivo": "%s"}\n' \
      "consultar-rnc-dgii.py no montado en el sidecar" > "$PREP/rnc.json"
  elif ! timeout 45 "$PY" "$SCRIPTS/consultar-rnc-dgii.py" --rnc "$RNC" > "$PREP/rnc.json" 2>/dev/null \
       || [ ! -s "$PREP/rnc.json" ]; then
    anotar_error "consulta del padron de RNC fallo o excedio el tiempo"
    printf '{"estado": "no verificable", "motivo": "%s"}\n' \
      "la consulta al padron de RNC fallo o excedio el tiempo" > "$PREP/rnc.json"
  fi
fi

# ───────────────────────── 7. Duplicados (solo con NCF) ─────────────────────────

# El prep NUNCA marca error por duplicado (SPEC 8): reporta en el dossier y el
# agente decide con su regla existente.
DUP_VERIFICADO=si
DUP_MOTIVO=""
agregar_motivo() { DUP_MOTIVO="${DUP_MOTIVO:+$DUP_MOTIVO; }$1"; }

if [ -n "$NCF" ]; then
  # 7a. En la mesa: trabajos con ese NCF ya en su propuesta (query del SPEC).
  if ! sql -v emp="$QUALIA_EMPRESA_ID" -v ncf="$NCF" -v id="$ID" > "$PREP/dup_mesa.txt" <<'SQL'
select id, estado
  from qualia_trabajos
 where empresa_id = :'emp'
   and propuesta->>'ncf' = :'ncf'
   and id != :'id';
SQL
  then
    DUP_VERIFICADO=no
    agregar_motivo "mesa: consulta fallo"
    anotar_error "duplicados en la mesa: consulta fallo"
  fi
  # 7b. Dossiers de otros trabajos en el cache: cubre pendientes que aún no
  # tienen propuesta pero cuyo prep ya extrajo ese NCF (SPEC 8: guardar el NCF
  # en el propio dossier basta — esto es el otro lado de esa moneda).
  for f in /tmp/mesa/*/dossier.json; do
    [ -e "$f" ] || continue
    otro=$(basename "$(dirname "$f")")
    [ "$otro" = "$ID" ] && continue
    [[ "$otro" =~ ^[0-9a-f-]{36}$ ]] || continue
    if grep -qF "\"$NCF\"" "$f" 2>/dev/null; then
      printf '%s\t%s\n' "$otro" "dossier" >> "$PREP/dup_mesa.txt"
    fi
  done
  # 7c. Contra ADM, por el HISTÓRICO local del preentrenamiento. La API en vivo
  # no sirve para esto (listado con NCF:null y `search` que no filtra — ver el
  # encabezado); el detalle jsonl SÍ trae el NCF y se refresca con el pipeline
  # de preentrenamiento. Se reportan los DocID coincidentes.
  if [ -d "$PRE_DIR/raw" ]; then
    if ! grep -hsF -- "\"$NCF\"" "$PRE_DIR"/raw/vendor-bills*.jsonl 2>/dev/null \
      | "$PY" -c '
import json, sys
ncf = sys.argv[1]
docids = []
for linea in sys.stdin:
    try:
        d = json.loads(linea)
    except ValueError:
        continue
    if str(d.get("NCF", "")).strip().upper() != ncf:
        continue
    doc = str(d.get("DocID") or d.get("ID") or "").strip()
    if doc and doc not in docids:
        docids.append(doc)
print(json.dumps(docids))
' "$NCF" > "$PREP/dup_adm.json" 2>/dev/null; then
      DUP_VERIFICADO=no
      agregar_motivo "historico ADM: parseo fallo"
      anotar_error "duplicados historico ADM: parseo fallo"
    fi
  else
    DUP_VERIFICADO=no
    agregar_motivo "historico ADM (preentrenamiento) no montado"
  fi
else
  DUP_VERIFICADO=no
  if [ -n "$NCF_CRUDO" ]; then
    agregar_motivo "NCF leído con formato inválido: no se pudo buscar duplicados"
  else
    agregar_motivo "sin NCF extraído"
  fi
fi

# ───────────────── 9. Dossier (atómico) + evento de progreso ─────────────────

if PREP="$PREP" DIRW="$DIR" TRABAJO_ID="$ID" ROW_UPD="$UPD" \
   ARCHIVO_PATH="$SALIDA" ARCHIVO_BYTES="$BYTES" ARCHIVO_TIPO="$TIPO" \
   CONVERTIDO="$CONVERTIDO" ARCHIVO_JPG="${SALIDA%.*}.jpg" DURACION="$SECONDS" \
   DUP_VERIFICADO="$DUP_VERIFICADO" DUP_MOTIVO="$DUP_MOTIVO" \
   NCF_OK="$NCF" MONTO_OK="$MONTO_FMT" \
   NCF_CRUDO="$NCF_CRUDO" NCF_RESCATADO="$NCF_RESCATADO" \
   NUM_SUPLIDOR="$NUM_SUPLIDOR" \
   "$PY" - <<'PY'
import json, os

prep = os.environ["PREP"]
dirw = os.environ["DIRW"]

def carga(nombre):
    ruta = os.path.join(prep, nombre)
    if not os.path.exists(ruta):
        return None
    try:
        return json.load(open(ruta, encoding="utf-8"))
    except Exception:
        return None

def entero(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0

errores = []
ruta_err = os.path.join(prep, "errores.txt")
if os.path.exists(ruta_err):
    errores = [l.strip() for l in open(ruta_err, encoding="utf-8") if l.strip()]

d = {"version": 1,
     "trabajo_id": os.environ["TRABAJO_ID"],
     "row_updated_at": os.environ["ROW_UPD"],
     "archivo": {"path": os.environ["ARCHIVO_PATH"],
                 "bytes": entero(os.environ.get("ARCHIVO_BYTES")),
                 "tipo": os.environ["ARCHIVO_TIPO"],
                 "convertido_de_heic": os.environ.get("CONVERTIDO") == "si"}}
if d["archivo"]["convertido_de_heic"]:
    d["archivo"]["path_jpg"] = os.environ.get("ARCHIVO_JPG", "")

extr = carga("extraccion.json") or {
    "metodo": "ninguno",
    "nota": "sin extraccion automatica; el agente sigue el protocolo completo"}
texto = os.path.join(dirw, "texto.txt")
if os.path.exists(texto):
    extr["texto_path"] = texto
d["extraccion"] = extr

dgii = carga("dgii.json")
if not isinstance(dgii, dict) or "estado" not in dgii:
    if dgii is not None:
        errores.append("dgii: salida invalida del verificador")
    dgii = {"estado": "no verificable",
            "motivo": "verificacion no ejecutada o con salida invalida"}
d["dgii"] = dgii

# Padron: quien es el dueno del RNC. Separado de "dgii" a proposito — que el
# comprobante no se pueda verificar no dice nada del RNC, y viceversa. Solo va
# al dossier si hubo RNC que consultar; ausente = no habia RNC extraido.
rnc_padron = carga("rnc.json")
if isinstance(rnc_padron, dict) and "estado" in rnc_padron:
    d["rnc_emisor"] = rnc_padron
elif rnc_padron is not None:
    errores.append("rnc: salida invalida del consultor del padron")

# Si el NCF se rescato, el agente TIENE que saberlo: el numero que va a la
# propuesta no es el que dice la foto, y eso se explica en el detalle.
# El numero propio del suplidor: va al `Reference` de ADM, que ademas es una
# de las dos claves de unicidad del server. Si no se leyo, el agente lo busca
# en el documento antes de registrar; no se inventa.
num_sup = os.environ.get("NUM_SUPLIDOR", "")
if num_sup:
    extr["numero_factura_suplidor"] = num_sup

crudo = os.environ.get("NCF_CRUDO", "")
rescatado = os.environ.get("NCF_RESCATADO", "")
if crudo and not os.environ.get("NCF_OK"):
    # Se leyó algo pero no pasó el formato y tampoco se pudo rescatar. El
    # agente tiene que saber que el número EXISTE en el documento: le queda
    # corregirlo desde el texto, no re-descubrirlo con visión.
    d["ncf_invalido"] = {
        "leido": crudo[:20],
        "posiciones": len(crudo),
        "esperado": "11 el impreso (B + 10 dígitos), 13 el e-CF (E + 12)",
    }
if rescatado:
    d["ncf_rescatado"] = {
        "leido_por_vision": os.environ.get("NCF_CRUDO", ""),
        "corregido": rescatado,
        "como": "un digito de mas; se probaron los borrados de un digito y "
                "DGII confirmo este como VIGENTE",
    }

mesa = []
ruta_dm = os.path.join(prep, "dup_mesa.txt")
if os.path.exists(ruta_dm):
    for linea in open(ruta_dm, encoding="utf-8"):
        partes = linea.rstrip("\n").split("\t")
        if len(partes) >= 2 and partes[0]:
            mesa.append({"id": partes[0], "estado": partes[1]})
adm = carga("dup_adm.json")   # DocIDs del histórico local de VendorBills
if not isinstance(adm, list):
    adm = []
dup = {"mesa": mesa, "adm": adm,
       "verificado": os.environ.get("DUP_VERIFICADO") == "si"}
if os.environ.get("DUP_MOTIVO"):
    dup["motivo"] = os.environ["DUP_MOTIVO"]
d["duplicados"] = dup

d["errores_prep"] = errores
d["duracion_seg"] = entero(os.environ.get("DURACION"))

tmp = os.path.join(dirw, "dossier.json.tmp")
json.dump(d, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
os.replace(tmp, os.path.join(dirw, "dossier.json"))

# Resumen humano para el evento de progreso (SPEC 4). Solo campos del dossier:
# nada de URLs ni cuerpos de API.
# El evento se arma SOLO con valores re-validados: el proveedor acotado a
# 120 chars, y NCF/monto desde las variables que bash ya pasó por regex
# (NCF_OK/MONTO_OK) — nunca los crudos de extraccion.json, que son input
# hostil y llegaban al hilo sin filtro (hallazgo de auditoría).
quien = (str(extr["proveedor"])[:120] if extr.get("proveedor")
         else "archivo " + d["archivo"]["tipo"])
partes = [quien]
ncf_ok = os.environ.get("NCF_OK", "")
if ncf_ok:
    etiqueta = "e-NCF" if ncf_ok.startswith("E") else "NCF"
    partes.append("%s %s" % (etiqueta, ncf_ok))
monto_ok = os.environ.get("MONTO_OK", "")
if monto_ok:
    simbolo = "US$" if extr.get("moneda") == "USD" else "RD$"
    partes.append("%s%s" % (simbolo, format(float(monto_ok), ",.2f")))
if rescatado:
    partes.append("NCF corregido (la foto se leia %s)" % crudo[:20])
elif "ncf_invalido" in d:
    partes.append("NCF ilegible (lei %s)" % crudo[:20])
partes.append("DGII: %s" % dgii.get("estado", "no verificable"))
# Si el comprobante no se pudo verificar pero el padron sí dio el nombre, decilo
# en el hilo: es la diferencia entre "no sé nada" y "sé de quién es la factura".
razon_padron = (d.get("rnc_emisor") or {}).get("razon_social")
if razon_padron and dgii.get("estado") not in ("Aceptado", "VIGENTE"):
    partes.append("padrón RNC: %s" % str(razon_padron)[:120])
n_dup = len(mesa) + len(adm)
if n_dup:
    partes.append("posible duplicado (mesa: %d, ADM: %d)" % (len(mesa), len(adm)))
elif dup["verificado"]:
    partes.append("sin duplicados")
else:
    partes.append("duplicados no verificados")
msj = "⚙️ Preparador: documento listo. " + ", ".join(partes) + "."
if errores:
    msj += " Prep parcial (%d paso(s) fallaron)." % len(errores)
msj += " Analizando…"
open(os.path.join(prep, "evento.txt"), "w", encoding="utf-8").write(msj)
PY
then
  log "dossier listo"
else
  log "no pude armar el dossier; el contable seguira el protocolo completo"
fi

# UN evento de progreso (SPEC 4). Si falla, no es fatal: el dossier ya está.
if [ -s "$PREP/evento.txt" ]; then
  cont=$(cat "$PREP/evento.txt")
  if ! sql -v id="$ID" -v cont="$cont" <<'SQL'
insert into qualia_eventos (trabajo_id, autor, tipo, contenido)
values (:'id', 'contable', 'progreso', :'cont');
SQL
  then
    log "no pude insertar el evento de progreso"
  fi
fi

# ───────────────────────── 10. Cierre ─────────────────────────

# La entrega (chown al HERMES_UID) la hace el trap de arriba en TODA salida,
# incluida ésta.
log "listo en ${SECONDS}s (tipo=$TIPO, ncf=${NCF:-no}, dgii=$([ -s "$PREP/dgii.json" ] && echo si || echo no))"
exit 0
