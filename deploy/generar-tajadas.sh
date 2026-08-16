#!/usr/bin/env bash
# generar-tajadas.sh — regenera supabase/functions/qualia-contable/tajadas/
# desde las fuentes del repo. Idempotente: correrlo dos veces da bytes idénticos.
# Falla ruidoso si falta una fuente o si un ancla de corte/adaptación no aparece
# (fuente cambió = fallar acá, nunca generar una tajada a medias en silencio).
#
# Mapa (contrato-turno.md §1 «Tajada por rama» + enmienda NORMATIVA 2):
#   system.md     ← empresas/blackbox/hermes/SOUL.md, adaptado y anotado
#   comun.md      ← references/comun-asientos.md, tal cual
#   facturas.md   ← rama-facturas-1.md + rama-facturas-2.md, concatenadas
#   casos.md      ← rama-casos.md + secciones de facturas EMBEBIDAS (enmienda 2)
#   respuestas.md ← rama-respuestas.md, tal cual

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF="$REPO/skills/mesa-de-trabajo/references"
SOUL="$REPO/empresas/blackbox/hermes/SOUL.md"
OUT="$REPO/supabase/functions/qualia-contable/tajadas"

HEADER='<!-- GENERADO por deploy/generar-tajadas.sh — NO editar a mano -->'

die() { echo "generar-tajadas: ERROR: $*" >&2; exit 1; }

# ── fuentes: todas presentes o nada ──────────────────────────────────────────
FUENTES=(
  "$SOUL"
  "$REF/comun-asientos.md"
  "$REF/rama-facturas-1.md"
  "$REF/rama-facturas-2.md"
  "$REF/rama-casos.md"
  "$REF/rama-respuestas.md"
)
for f in "${FUENTES[@]}"; do
  [ -f "$f" ] || die "fuente ausente: $f"
done

mkdir -p "$OUT"

TSYS="$(mktemp)"; T5P="$(mktemp)"; TCLAS="$(mktemp)"; TJER="$(mktemp)"
trap 'rm -f "$TSYS" "$T5P" "$TCLAS" "$TJER"' EXIT

# emitir <nombre> — escribe stdin en $OUT/<nombre> con el header, atómico
emitir() {
  local tmp
  tmp="$(mktemp "$OUT/.tmp.XXXXXX")"
  { printf '%s\n\n' "$HEADER"; cat; } > "$tmp"
  mv "$tmp" "$OUT/$1"
}

# extraer <archivo> <regex inicio> [<regex fin, exclusivo>] — corta una sección.
# Sin fin: hasta EOF. Revienta si el ancla de inicio no aparece.
extraer() {
  awk -v ini="$2" -v fin="${3-}" '
    dentro && fin != "" && $0 ~ fin { dentro=0 }
    !hallado && $0 ~ ini { dentro=1; hallado=1 }
    dentro { print }
    END { if (!hallado) exit 1 }
  ' "$1" || die "ancla no encontrada en $1: $2"
}

# ── system.md: el SOUL adaptado al turno serverless ──────────────────────────
# Cada bloque reemplaza UN párrafo del SOUL (del ancla a la línea en blanco) y
# lleva su anotación <!-- adaptado: … -->. Identidad, prohibiciones y reglas
# duras quedan verbatim. Nota: el SOUL vigente no menciona Telegram — no hay
# nada que quitar ahí (verificado 2026-08-16).
#
# RESUELTO 2026-08-16: `/nucleo-contable/dgii` (monte solo-lectura
# del contenedor). El mandato de adaptación nombra SOLO las rutas /opt/data y
# Telegram, así que esa sección queda verbatim; si el bundle del turno no sirve
# el núcleo DGII bajo esa ruta, decidir cómo se referencia y adaptar acá.

R_MESA=$(cat <<'FIN'
<!-- adaptado: el aviso ya no entra por el webhook `mesa` de Hermes ni existe la
tool `clarify`; en el turno el poke lo arma el harness. La regla de fondo queda:
el sistema no es una persona. -->
También te habla **el sistema de la mesa de trabajo**: avisos automáticos de que
hay un trabajo en la cola. No es una persona — jamás le preguntes nada, porque
nadie contesta. Quién aprobó cada cosa viene en la columna `aprobado_por_nombre`
de la mesa.
FIN
)

R_REG=$(cat <<'FIN'
<!-- adaptado: en F3 el turno NO postea a ADM Cloud (contrato-turno.md §6.1) — el
registro de lo aprobado es de otra pieza (el mesa hasta F4, el registrador
después). El original decía «Registras en ADM Cloud lo que un humano ya aprobó»;
se conserva la regla de fondo: jamás decir que se registró lo que no se
registró. -->
**En ADM Cloud solo leés.** Registrar lo que un humano aprobó es trabajo de otra
pieza del sistema, no tuyo: ante un registro pendiente, tu parte es diagnosticar
con lo que ADM ya tiene y contestar — nunca postear. Nunca registras algo que
nadie aprobó, y nunca dices que algo se registró si su DocID no está en la fila:
eso sería mentir sobre el libro contable de una empresa.
FIN
)

R_PROV=$(cat <<'FIN'
<!-- adaptado: el alta de proveedor (POST /api/Vendors) era parte de registrar, y
registrar no es del turno (F4); se retira ese permiso. La distinción se
conserva: un proveedor no es un artículo. -->
El alta de un proveedor es parte de registrar la factura — y registrar es de la
pieza que registra, no tuyo. Un proveedor no es un artículo, pero en este turno
no das de alta ni lo uno ni lo otro.
FIN
)

R_MEM=$(cat <<'FIN'
<!-- adaptado: se quita la ruta /opt/data/memoria del contenedor — la memoria
curada viaja empaquetada en el contexto del turno; ratificarla o mejorarla es
operación de repo, no tuya (contrato-turno.md §6.7). -->
Lo que sabes de BlackBox —proveedores, plan de cuentas, criterios propios— viaja
contigo en este contexto. Lo ratificado manda sobre el destilado.
FIN
)

R_LIBRO=$(cat <<'FIN'
<!-- adaptado: se quita la ruta /opt/data/libro-de-accion del contenedor — el
libro se escribe con la tool `escribir_libro`, que aplica estas mismas reglas. -->
El libro de acción: cada decisión contable que se toma queda registrada ahí, y
tiene tres reglas duras:
FIN
)

R_FISCAL=$(cat <<'FIN'
<!-- adaptado: se quita la ruta /nucleo-contable/dgii del contenedor — las
reglas fiscales viajan empaquetadas en este mismo contexto (tajada del núcleo,
plan §4.5); no hay filesystem que recorrer ni INDEX.md que abrir. -->
Las reglas fiscales de la DGII viajan contigo en este contexto, con su índice de
qué hay y qué está marcado para verificar.
FIN
)

# el awk de macOS no acepta newlines literales en -v: van escapados como \n y
# awk los des-escapa al asignar (los bloques no contienen backslashes propios)
awk -v r_mesa="${R_MESA//$'\n'/\\n}" -v r_reg="${R_REG//$'\n'/\\n}" \
    -v r_fiscal="${R_FISCAL//$'\n'/\\n}" \
    -v r_prov="${R_PROV//$'\n'/\\n}" -v r_mem="${R_MEM//$'\n'/\\n}" \
    -v r_libro="${R_LIBRO//$'\n'/\\n}" '
  /^También te habla \*\*el sistema de la mesa de trabajo\*\*/ {
    print r_mesa; c_mesa++; saltando=1; next }
  /^\*\*Registras en ADM Cloud lo que un humano ya aprobó\.\*\*/ {
    print r_reg; c_reg++; saltando=1; next }
  /^\*\*Proveedores sí los das de alta\*\*/ {
    print r_prov; c_prov++; saltando=1; next }
  /^En `\/opt\/data\/memoria`/ {
    print r_mem; c_mem++; saltando=1; next }
  /^En `\/opt\/data\/libro-de-accion`/ {
    print r_libro; c_libro++; saltando=1; next }
  /^Viven en `\/nucleo-contable\/dgii`/ {
    print r_fiscal; c_fiscal++; saltando=1; next }
  saltando && /^$/ { saltando=0; print; next }
  saltando { next }
  { print }
  END {
    if (c_mesa!=1 || c_reg!=1 || c_prov!=1 || c_mem!=1 || c_libro!=1 || c_fiscal!=1) {
      printf "anclas de adaptación en SOUL.md: mesa=%d registro=%d proveedores=%d memoria=%d libro=%d fiscal=%d (todas deben ser 1)\n",
             c_mesa, c_reg, c_prov, c_mem, c_libro, c_fiscal > "/dev/stderr"
      exit 1
    }
  }' "$SOUL" > "$TSYS" || die "la adaptación del SOUL falló — ver arriba"

{
  echo '<!-- Fuente: empresas/blackbox/hermes/SOUL.md, adaptado al turno serverless; cada adaptación está anotada en su lugar. -->'
  echo
  cat "$TSYS"
} | emitir system.md

# ── comun.md y respuestas.md: tal cual ───────────────────────────────────────
emitir comun.md      < "$REF/comun-asientos.md"
emitir respuestas.md < "$REF/rama-respuestas.md"

# ── facturas.md: las dos mitades concatenadas ────────────────────────────────
{
  cat "$REF/rama-facturas-1.md"
  echo
  echo '<!-- ——— generar-tajadas.sh: fin de rama-facturas-1.md · sigue rama-facturas-2.md ——— -->'
  echo
  cat "$REF/rama-facturas-2.md"
} | emitir facturas.md

# ── casos.md: la rama + las secciones embebidas (enmienda NORMATIVA 2) ───────
# rama-casos ordena releer rama-facturas-1 antes del primer trabajo hijo y en el
# turno no hay shell: las secciones «Qué documento de ADM es esto» (las 5
# preguntas) y «Cómo clasificás la cuenta» viajan acá, tal cual, más la
# jerarquía del paso 6 que las continúa en rama-facturas-2.md.
extraer "$REF/rama-facturas-1.md" '^### Qué documento de ADM es esto' '^### Cómo clasificás la cuenta' > "$T5P"
extraer "$REF/rama-facturas-1.md" '^### Cómo clasificás la cuenta' > "$TCLAS"
extraer "$REF/rama-facturas-2.md" '^El paso 6 del protocolo completo' 'La extracción del dossier es auto-generada' > "$TJER"
[ -s "$T5P" ]   || die "sección vacía: las 5 preguntas (rama-facturas-1.md)"
[ -s "$TCLAS" ] || die "sección vacía: clasificación de cuenta (rama-facturas-1.md)"
[ -s "$TJER" ]  || die "sección vacía: jerarquía del paso 6 (rama-facturas-2.md)"

{
  cat "$REF/rama-casos.md"
  echo
  echo '<!-- EMBEBIDO por generar-tajadas.sh — enmienda NORMATIVA 2 del contrato-turno.md: rama-casos ordena releer rama-facturas-1 antes del primer trabajo hijo y en el turno no hay shell. Las secciones viajan acá tal cual sus fuentes (rama-facturas-1.md y la jerarquía del paso 6 de rama-facturas-2.md). -->'
  echo
  cat "$T5P"
  cat "$TCLAS"
  echo
  cat "$TJER"
} | emitir casos.md

# ── verificación final: lo generado dice lo que debe decir ───────────────────
# (las anotaciones <!-- adaptado: … --> nombran la ruta que quitaron; esas no cuentan)
if grep -E '/opt/data|/nucleo-contable' "$OUT/system.md" | grep -qv 'adaptado:'; then
  die "system.md conserva rutas del contenedor (/opt/data o /nucleo-contable) — la adaptación no cubrió todo"
fi
grep -q '^### Qué documento de ADM es esto' "$OUT/casos.md" \
  || die "casos.md quedó sin la sección de las 5 preguntas"
grep -q '^### Cómo clasificás la cuenta' "$OUT/casos.md" \
  || die "casos.md quedó sin la sección de clasificación de cuenta"
grep -q 'El paso 6 del protocolo completo' "$OUT/casos.md" \
  || die "casos.md quedó sin la jerarquía del paso 6"
grep -q 'fin de rama-facturas-1.md' "$OUT/facturas.md" \
  || die "facturas.md quedó sin el separador de mitades"
for t in system.md comun.md facturas.md casos.md respuestas.md; do
  head -1 "$OUT/$t" | grep -q 'GENERADO por deploy/generar-tajadas.sh' \
    || die "$t sin la línea GENERADO al inicio"
done

echo "tajadas regeneradas en $OUT:"
for t in system.md comun.md facturas.md casos.md respuestas.md; do
  printf '  %-14s %7d bytes  %5d líneas\n' "$t" \
    "$(wc -c < "$OUT/$t")" "$(wc -l < "$OUT/$t")"
done
