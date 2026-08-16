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
#   respuestas.md ← rama-respuestas.md, re-tajada al turno (§5.3) y anotada

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

# ── comun.md: tal cual ───────────────────────────────────────────────────────
emitir comun.md      < "$REF/comun-asientos.md"

# ── respuestas.md: la rama re-tajada al turno serverless ─────────────────────
# Cada bloque reemplaza UN tramo de rama-respuestas.md (del ancla a su fin) y
# lleva su anotación <!-- adaptado: … -->. Se traduce la MECÁNICA —psql, los
# scripts de /opt/data, el guardián de comandos— a las tools del contrato
# (§2 y §3 de docs/contrato-turno.md); las reglas contables, los umbrales, las
# prohibiciones y las lápidas quedan palabra por palabra.
#
# El corte grande: en F3 el turno NO postea a ADM (contrato §6.1) — registrar es
# de la pieza que registra (el mesa hasta F4, qualia-registrador después). La
# regla de orden «ADM primero, libro después» y las lápidas del registro quedan
# ESCRITAS, para quien las ejecute; lo que muere es el «hacelo vos».

R_RESP_CAB=$(cat <<'FIN'
<!-- adaptado: la rama ya no la sirve scripts/abrir-trabajo.sh — la sirve el harness
del turno, que rutea por el ESTADO REAL de la fila y precarga el dossier. Sigue siendo
la rama de respuestas, correcciones, aprobaciones y rechazos, y la que se sirve para
registro_pendiente; lo que cambia es que en F3 ese motivo es SOLO diagnóstico. Re-tajada
de la tajada verbatim de a14c7d0 según contrato-turno.md §5.3: muere la mecánica del
chasis viejo, quedan las reglas contables y las lápidas. -->
FIN
)

R_RESP_CTX=$(cat <<'FIN'
<!-- adaptado: muere `bash /opt/data/memoria/scripts/leer-contexto.sh <trabajo_id>` — no hay shell.
El contexto entero viene PRECARGADO en la primera iteración (tool `dossier_completo`,
contrato §2.1) y el claim lo hace el harness. La regla de fondo queda: el contexto se
lee completo de una vez, no a pedacitos. -->
Contexto completo en una corrida: ya lo tenés delante (`dossier_completo`, servido de
oficio). Acá no hay claim que ganar: el harness ya reclamó la fila. Si tras una
corrección necesitás el hilo entero, volvé a llamar la tool pidiéndolo.
FIN
)

R_RESP_LIBRO=$(cat <<'FIN'
<!-- adaptado: mueren el archivo escrito al filesystem y el insert a `qualia_libro` por psql — los hace la tool
`escribir_libro`, en el orden fijo tabla → GitHub → `ref_git` (contrato §2.6). El `docid`
y el `aprobado_por_nombre` los toma la tool de la FILA, jamás de tu salida (enmienda
NORMATIVA 1). La doctrina queda entera: archivo NUEVO, append-only, Aprobó, Alcance, y el
espejo en la tabla para la vista web. -->
  Escribí la entrada en tu libro de acción con la tool `escribir_libro`: nace un
  archivo NUEVO en `libro-de-accion/` (append-only, jamás editar uno existente),
  con **Aprobó:** el `aprobado_por_nombre` de la fila, «por la mesa web», y su
  **Alcance**. La tool la espeja sola en `qualia_libro` para la vista web y es
  idempotente por trabajo: si la entrada ya está, no la dupliques.
FIN
)

R_RESP_MEMORIA=$(cat <<'FIN'
<!-- adaptado: muere «actualizá tu memoria curada» como acción tuya: la memoria viaja
empaquetada en este contexto y ratificarla o ampliarla es operación de repo + redeploy
(contrato §6.7 y enmienda 6a). La regla de fondo queda: sin Alcance escrito, se vuelve a
preguntar lo mismo. -->
  Si la decisión trae Alcance, escribilo en la entrada del libro y dejalo dicho
  ahí: reflejarlo en la memoria curada (proveedores.md / criterios.md) no es tuyo
  —se hace en el repo— y qualia-salud avisa cuando queda sin reflejar.
FIN
)

R_RESP_REGISTRO=$(cat <<'FIN'
<!-- adaptado: mueren `registrar-en-adm.py --trabajo` y `--simular`, el curl a /api/Storage del adjunto (y su %20), y el `update ... estado='registrada'` por psql: en F3 el turno NO postea a ADM ni cierra la fila (contrato §6.1 y §3.4).
Eso lo hace la pieza que registra —el mesa hasta F4, `qualia-registrador` después—; vos
solo diagnosticás y avisás. Muere también el guardián de comandos con sus 15-30s, que se
va con el shell. La regla de orden y las lápidas quedan escritas para quien registre. -->
  **VOS NO REGISTRÁS EN ADM CLOUD.** Registrar lo que un humano aprobó es de otra
  pieza del sistema; acá ADM es solo lectura (`leer_adm`). Ante un registro
  pendiente tu parte es diagnosticar con lo que ADM ya tiene y contestar:
  `preguntar_al_humano` si falta una decisión, `responder` si es un acuse.

  **El orden no se negocia, y sigue escrito acá porque lo hereda quien registre:
  ADM primero, libro después**, para que la entrada nazca con su número. Si el
  registro falla, el libro NO se escribe: el trabajo queda en `error` y se
  reintenta. Jamás una entrada de libro sin el documento que la generó — por eso
  `escribir_libro` toma el DocID de la fila, y sin DocID no hay entrada: se cierra
  con `responder` avisando.

  **Cuando el registro falló, el diagnóstico es tuyo.** Los casos previstos son
  proveedor sin RNC válido, cuenta contable que no existe en el catálogo, factura
  ya registrada y NCF que no verifica en DGII. **Ninguno se resuelve insistiendo**:
  o falta un dato de la propuesta o hay que preguntarle al humano. Verificá con
  `leer_adm` —el vendor por `FiscalID` exacto, la cuenta contra el plan VIVO, el
  listado de su tipo— y con `consultar_dgii` solo si el dossier trae el campo
  ausente o `no verificable`.
FIN
)

R_RESP_GEMELO=$(cat <<'FIN'
<!-- adaptado: muere el puntero «la sección vive en references/rama-facturas-1.md, por si
necesitás releerla» (no hay filesystem que releer) y muere «lo armás vos con la API»: en
F3 el turno no postea nada (§6.1). La regla dura del NCF con sus 96 contraejemplos y la
doctrina del duplicado quedan; lo de abajo pasa a ser criterio de DIAGNÓSTICO. -->
  **Esta sección habla de DUPLICADOS, no de clasificación.** El tipo ya lo
  decidiste con «Qué documento de ADM es esto», y ahí el NCF no jugó — es regla
  dura, con 96 contraejemplos; si el tipo te queda en duda se pregunta, no se
  relee un archivo que acá no existe. Lo que cambia es otra cosa: lo que sale de
  una sugerencia —`BankCharges`, `BankBankTransfers`, `Journals`— no lleva NCF, y
  sin NCF ninguna de las dos redes que frenan el doble registro de una factura
  existe: ADM deja crear el mismo cargo diez veces.
FIN
)

R_RESP_PASOS=$(cat <<'FIN'
<!-- adaptado: los cuatro pasos son la spec de la pieza que registra (F4): `Reference` =
banco_tx_id, buscar paginado antes del POST, readback por UUID, no adoptar sin prueba. En
F3 el turno los usa para DIAGNOSTICAR con `leer_adm{listado}` y cierra con
`preguntar_al_humano` (contrato §3.4). Muere el POST y muere el evento suelto con su
cambio de estado a mano; las reglas y la lápida CB00000169 quedan enteras. -->
  Entonces, frente a uno de estos —lo registre quien lo registre— lo que aportás
  vos es la PRUEBA:

  - **La llave es el `banco_tx_id` de la propuesta** (el uuid del movimiento del
    banco) viajando en `Reference`: es lo único que distingue dos cargos gemelos.
    Los 166 `BankCharges` de esta empresa tienen `Reference` en null porque nunca
    nadie lo mandó (medido 2026-08-04), así que todavía no se sabe si el campo se
    persiste. Si lo ves poblado, decilo — desde ahí es LA llave. Si sigue en null,
    avisá: hay que buscar otra y no se puede seguir registrando gemelos a ciegas.
  - **Buscar no es opcional**: `leer_adm{listado}` de su tipo, paginado, y fijate
    si alguno trae ESA referencia. **Ojo: el listado no trae los anulados**
    (medido 2026-08-04: `/api/BankCharges` devolvió 166 filas, cero con `Void`, y
    los que el dueño acababa de anular no estaban). No encontrarlo es la respuesta
    correcta para registrar: si lo anularon, hay que volver a registrarlo igual.
  - **La prueba se cierra por UUID**: `leer_adm{documento}` y que el `ID` devuelto
    sea el que pediste. Un parecido no prueba nada.
  - **Si no podés probar que el documento es tuyo, NO lo des por adoptado y NO
    pidas que se re-registre**: cerrá con `preguntar_al_humano` contando lo que
    viste («hay un CB00000169 idéntico del mismo día; no puedo saber si es este
    movimiento o el otro»). Un DocID prestado es un descuadre silencioso; una
    pregunta la contesta el dueño en diez segundos.
FIN
)

R_RESP_REFSCRIPT=$(cat <<'FIN'
<!-- adaptado: la sección entera era la referencia interna de registrar-en-adm.py (alta de proveedor, POST, adjunto, cierre de fila) — spec de la pieza que registra (F4), y acá no hay script que explicar ni curl que rehacer.
Queda lo que sirve para LEER y diagnosticar: las trampas de la API que `leer_adm` hereda,
la aritmética del ITBIS y las lápidas, todas con su medición. -->
  ### Referencia: lo que hay que saber para diagnosticar un registro

  **Esto NO es un procedimiento a seguir**: en este turno no hay POST. Está acá
  para que entiendas por qué un registro falló y puedas explicárselo al humano.

  - **El proveedor se busca por `FiscalID` exacto, nunca por nombre** — se escribe
    de veinte formas distintas — y su nombre oficial es la razón social de DGII,
    no lo impreso. **Si el RNC no verifica en DGII, el proveedor no se crea:
    preguntá.** Y «DGII no me dio la razón social» no es motivo de error mientras
    tengas el RNC: está `rnc_emisor.razon_social` del dossier y está el padrón
    (`consultar_dgii{modo:'padron'}`). Recién si el padrón responde NO ENCONTRADO
    o no verificable, parás y lo explicás.
  - **El duplicado de una factura se busca paginando el listado y filtrando LOCAL
    por NCF.** `?Reference=` y `?DocID=` están **prohibidos**: el primero devuelve
    cero para referencias que sí existen y el segundo se ignora — buscar con ellos
    es licenciar el doble registro. ADM además lo frena por dos claves propias
    (mismo NCF de ese RNC; misma referencia de ese proveedor): es una red, no un
    permiso para saltarse el chequeo.
  - **El ITBIS no se manda como monto: se calcula sobre `Quantity × Price`.** Con
    cantidad 1 no se nota; con 0.50 la diferencia fue 10.63 contra 21.25 y el
    total se iba a 173.88 con `success:true`. Es la misma aritmética que tu
    propuesta tiene que cuadrar.
  - **El asiento no se manda: ADM lo deriva** (débito a la cuenta de cada línea,
    débito a ITBIS Operativo, crédito a Cuentas por Pagar). Mandarlo descuadra.
  - **El `Reference` de una factura es el número PROPIO del suplidor**
    (`extraccion.numero_factura_suplidor`), NO el NCF. Está poblado en las
    1050/1050 facturas del libro. Registrar una factura de proveedor **no emite,
    ni firma, ni declara** ante DGII; el e-CF se manda igual que un B01.
  - **La lectura de vuelta es por UUID y no es opcional**: el POST devuelve solo
    el UUID y el número humano (`FP########`) sale del readback. Pasarle un DocID,
    un NCF o una referencia devuelve *otro documento* con `success:true` — por eso
    `leer_adm{documento}` se pide por UUID y se comprueba el `ID` devuelto.
  - **Registrar no se reintenta a ciegas**: no hay clave de idempotencia, un
    reintento crea una segunda factura, y revertir en ADM **borra** el documento
    (no lo anula). Ante la duda se cuenta primero.
  - **Sin adjunto la factura queda sin respaldo**, y la fila no llega a
    `registrada` sin su DocID: lo impide el CHECK de la base. Las cuatro primeras
    facturas (2026-08-03) quedaron registradas en ADM con `registrada` = 0 porque
    ese renglón no existía en ninguna capa del sistema, y la mesa las mostró
    pendientes PARA SIEMPRE. Hoy ese cierre es de la pieza que registra: si ves
    una fila así, es un diagnóstico para contar, no algo que vos destrabes.
FIN
)

R_RESP_RECHAZOS=$(cat <<'FIN'
<!-- adaptado: muere la consulta psql del batch de rechazos — la corre el harness y te
precarga en el prompt los rechazos recientes sin respuesta (contrato §1 y §3.4). Los
filtros y el porqué de cada uno quedan escritos abajo, tal cual; el acuse se escribe con
`responder`. -->
  **Atendé TODOS los rechazos recientes, no sólo el que te nombraron.** El
  poller agrupa: cuando caen varios seguidos —lo normal al rehacer el plan de un
  caso, donde se rechazan tres o cuatro pasos de un tirón— sólo el primero abre
  sesión, y los demás quedan esperando que vos los mires en ésta. Antes se
  despertaba uno por cada uno: cuatro sesiones de LLM que llenaban el cupo y
  dejaban el trabajo de verdad haciendo cola detrás.

  Ya los tenés precargados: los `rechazada` de los últimos 15 minutos que todavía
  no respondiste, sin los que cerró el cron por comprobante fiscal.
FIN
)

R_RESP_CRITNEG=$(cat <<'FIN'
<!-- adaptado: el INSERT a mano de la fila `tipo='criterio'` pasa a la tool
`proponer_criterio`, que ya trae las cuatro reglas en el schema y NO tiene campo
`archivo` (contrato §2.5). El carril, la promesa de la pantalla y la prohibición de
citar borradores quedan igual. -->
  **Y si explicó el porqué, esa explicación es un criterio negativo — mismo
  carril, ningún atajo.** La pantalla se lo prometió al aprobar el rechazo («si
  explicás el porqué, el contable lo guarda como criterio»), así que no puede
  terminar en un archivo de memoria: los tres que hay están en `borrador` y un
  borrador no es precedente ni se cita jamás. Usá `proponer_criterio` igual que en
  la rama `respuesta`, con el enunciado en negativo («no proponer gastos de
  <comercio>, RNC <rnc>: son personales») y el alcance acotado a ese comercio.
FIN
)

R_RESP_RETOME=$(cat <<'FIN'
<!-- adaptado: muere el `update ... estado='analizando'` por psql — el retome es el claim del
harness al llegar la respuesta (`esperando_respuesta`/`propuesta`/`error` → `analizando`,
contrato §1 y §3.4). La lápida de los estados de origen queda escrita abajo, tal cual. -->
- **evento `respuesta`**: el humano te está contestando o corrigiendo. La fila ya
  la retomó el harness a `analizando` cuando llegó la respuesta
FIN
)

R_RESP_CRITERIO=$(cat <<'FIN'
<!-- adaptado: muere el INSERT por psql — la fila de criterio la abre la tool
`proponer_criterio{titulo, enunciado, alcance, sosten}`; el tipo, el origen y el
`origen_trabajo` los pone el harness, `reglas` es un array de UN elemento por schema y el
campo `archivo` NO EXISTE en la firma (contrato §2.5). Las cuatro reglas de abajo quedan
enteras: ahora son schema, no memoria. -->
  Cuando SÍ es criterio, llamá `proponer_criterio` y seguí con lo tuyo — la
  ratifica el dueño, no vos. Va UNA regla, con su `titulo` (qué decide, en una
  línea), su `enunciado` (la regla con el hecho que la sostiene), su `alcance`
  (hasta dónde vale: este proveedor, esta cuenta, esta empresa) y su `sosten`
  (cuántos documentos del histórico lo respaldan, o «palabra del dueño»).
FIN
)

R_RESP_MARCADOR=$(cat <<'FIN'
<!-- adaptado: muere el insert del evento por psql — el marcador lo escribe `responder`
(`criterio: 'si'`, o `'no'` con su `motivo_no`), y es obligatorio justo en este carril: el
de correcciones y rechazos explicados (enmienda NORMATIVA 5). -->
  **Y cerrá siempre con el marcador**, generalice o no — es lo que vuelve
  auditable el carril: si un día hay que revisar qué correcciones se perdieron, se
  buscan los hilos sin marcador. `responder` con `criterio: 'si'` cuando lo
  propusiste; con `criterio: 'no'` y su motivo cuando corrige el dato de este
  documento y no la regla.
FIN
)

TRESP="$(mktemp)"
awk -v r_cab="${R_RESP_CAB//$'\n'/\\n}" \
    -v r_ctx="${R_RESP_CTX//$'\n'/\\n}" \
    -v r_libro="${R_RESP_LIBRO//$'\n'/\\n}" \
    -v r_mem="${R_RESP_MEMORIA//$'\n'/\\n}" \
    -v r_reg="${R_RESP_REGISTRO//$'\n'/\\n}" \
    -v r_gem="${R_RESP_GEMELO//$'\n'/\\n}" \
    -v r_pasos="${R_RESP_PASOS//$'\n'/\\n}" \
    -v r_ref="${R_RESP_REFSCRIPT//$'\n'/\\n}" \
    -v r_rech="${R_RESP_RECHAZOS//$'\n'/\\n}" \
    -v r_neg="${R_RESP_CRITNEG//$'\n'/\\n}" \
    -v r_ret="${R_RESP_RETOME//$'\n'/\\n}" \
    -v r_crit="${R_RESP_CRITERIO//$'\n'/\\n}" \
    -v r_marc="${R_RESP_MARCADOR//$'\n'/\\n}" '
  # salta: regex de fin del tramo reemplazado. incl=1 → la línea de fin también
  # se come (cierre de un bloque de código); incl=0 → se procesa normal, así un
  # tramo puede terminar justo en el ancla del siguiente.
  salta != "" {
    if ($0 !~ salta) next
    hasta = incl; salta = ""; incl = 0
    if (hasta) next
  }
  /^<!-- Rama servida por scripts\/abrir-trabajo\.sh/ {
    print r_cab; c_cab++; salta="^$"; incl=0; next }
  /^Contexto completo en una corrida/ {
    print r_ctx; c_ctx++; salta="^ *```$"; incl=1; next }
  /^  Escribí la entrada en tu libro de acción/ {
    print r_libro; c_libro++; salta="^ *```$"; incl=1; next }
  /^  Si la decisión trae Alcance/ {
    print r_mem; c_mem++; salta="^$"; incl=0; next }
  /^  \*\*REGISTRÁ EN ADM CLOUD\.\*\*/ {
    print r_reg; print ""; c_reg++; salta="^  ### Cargo bancario"; incl=0; next }
  /^  \*\*Esta sección habla de DUPLICADOS/ {
    print r_gem; c_gem++; salta="^$"; incl=0; next }
  /^  Entonces, al registrar uno de estos:/ {
    print r_pasos; print ""; c_pasos++; salta="^  ### Referencia"; incl=0; next }
  /^  ### Referencia: qué hace el script por dentro/ {
    print r_ref; print ""; c_ref++; salta="^- \\*\\*`rechazada`\\*\\*"; incl=0; next }
  /^  \*\*Atendé TODOS los rechazos recientes/ {
    print r_rech; c_rech++; salta="^ *```$"; incl=1; next }
  /^  \*\*Y si explicó el porqué/ {
    print r_neg; c_neg++; salta="^$"; incl=0; next }
  /^- \*\*evento `respuesta`\*\*/ {
    print r_ret; c_ret++; salta="^  — y seguí el análisis"; incl=0; next }
  /^  Cuando SÍ es criterio/ {
    print r_crit; c_crit++; salta="^ *```$"; incl=1; next }
  /^  \*\*Y cerrá siempre con el marcador\*\*/ {
    print r_marc; c_marc++; salta="^ *```$"; incl=1; next }
  { print }
  END {
    if (c_cab!=1 || c_ctx!=1 || c_libro!=1 || c_mem!=1 || c_reg!=1 || c_gem!=1 ||
        c_pasos!=1 || c_ref!=1 || c_rech!=1 || c_neg!=1 || c_ret!=1 ||
        c_crit!=1 || c_marc!=1) {
      printf "anclas de adaptación en rama-respuestas.md: cabecera=%d contexto=%d libro=%d memoria=%d registro=%d gemelo=%d pasos=%d refscript=%d rechazos=%d criterio_negativo=%d retome=%d criterio=%d marcador=%d (todas deben ser 1)\n",
             c_cab, c_ctx, c_libro, c_mem, c_reg, c_gem, c_pasos, c_ref, c_rech,
             c_neg, c_ret, c_crit, c_marc > "/dev/stderr"
      exit 1
    }
  }' "$REF/rama-respuestas.md" > "$TRESP" \
  || { rm -f "$TRESP"; die "la re-tajada de rama-respuestas.md falló — ver arriba"; }

emitir respuestas.md < "$TRESP"
rm -f "$TRESP"

# ── facturas.md: las dos mitades re-tajadas y concatenadas ───────────────────
# Mismo patrón que arriba: cada bloque R_FAC_* (primera mitad) y R_FA2_* (segunda)
# reemplaza UN tramo de su fuente —del ancla hasta su fin— y lleva su anotación
# <!-- adaptado: … -->. Se traduce SOLO la MECÁNICA del chasis viejo —el psql del
# hilo, `leer-contexto.sh --claim`, `bajar-documento.sh`, `buscar-precedente.py`,
# los dos scripts de DGII, `aplicar-propuesta.py`, `vision_analyze`, el guardián
# de comandos, los ficheros de /tmp/mesa y los SQL de referencia— a las tools del
# contrato (§2 y §3 de docs/contrato-turno.md).
#
# NO se toca la doctrina: la aritmética del ITBIS y sus tres tasas, las 5
# preguntas de `documento_adm`, la jerarquía de clasificación, los umbrales de
# cuadre, el auto-chequeo de contrapartida y las lápidas (FP00001120 de Carrefour,
# CB00000258 de Formax, la DGA, Claro, FP00001114/1115, 672eacb4 → 646ed1cf)
# quedan palabra por palabra.

R_FAC_CAB=$(cat <<'FIN'
<!-- adaptado: la rama la sirve el harness (no scripts/abrir-trabajo.sh) y las dos mitades van
concatenadas. Re-tajada de a14c7d0 según contrato-turno.md §5.3: muere la mecánica del
chasis viejo, quedan las reglas contables y las lápidas. -->
FIN
)

R_FAC_PASO0=$(cat <<'FIN'
<!-- adaptado: psql del hilo y `cat rama-respuestas.md` → hilo en el dossier, ruteo del harness. -->
Antes de nada, mirá si alguien ya te dijo algo sobre esta fila: los últimos eventos
del hilo ya vienen en el dossier, y `dossier_completo {hilo_completo: true}` te trae
el hilo entero.

Si hay una respuesta del usuario posterior a una propuesta tuya, **estás por
repetir un análisis que ya fue corregido**: el harness te sirve la rama «evento
`respuesta`» en lugar de ésta, y lo que dijo el humano es dato, no un arranque de
cero. El motivo del poke puede llegar equivocado —el poke es un puntero y la base
es la única verdad— y **el dossier del preparador NO contiene eventos**: si el
documento no cambió te lo entrega idéntico al de antes de la corrección, así que
leerlo te devuelve exactamente el razonamiento que el humano acaba de rechazar.
FIN
)

R_FAC_DOSSIER=$(cat <<'FIN'
<!-- adaptado: `leer-contexto.sh --claim` y el dossier.json de /tmp/mesa → claim del harness,
dossier precargado y `avisar_progreso`. La regla —un movimiento y no cinco— queda. -->
Antes de despertarte, un preparador determinista (sin LLM) dejó el trabajo masticado,
y **ya tenés su dossier**: la iteración 1 llega con la fila, el hilo, el rastro del
proponedor determinista si lo hubo (`clasificacion.json`: por qué el camino sin LLM
NO propuso — ése es tu punto de partida, no lo re-descubras), el dossier y el
precedente del proveedor ya buscado. No lo vuelvas a pedir: `dossier_completo` es
para releer el hilo entero o mirarlo tras una corrección. El claim tampoco es tuyo:
nunca ves la carrera.

- **Con dossier** (lo normal): el documento ya lo procesó el preparador
  (convertido a jpg si era HEIC, con su texto extraído si lo hubo), y la
  extracción, la verificación DGII y el chequeo
  de duplicados YA están hechos. **SALTATE los pasos 2-5** y andá DIRECTO al
  precedente y la propuesta (pasos 6-8). **Tu PRIMER movimiento tras leer el
  dossier es UNA llamada a `avisar_progreso` corta anunciando SOLO tu plan y tu
  juicio** — sin repetir proveedor/monto/DGII, que ya están en el evento del
  preparador — p.ej. «Este comprobante no pasó la verificación de DGII, así
  que no sirve como crédito fiscal: te preparo la propuesta para registrarlo
  como gasto no admitido» o «A este proveedor siempre lo registramos como
  combustible; te armo la propuesta igual que las anteriores». Corto pero
  hablado, con el tono de la sección «Cómo le hablás al humano».
  Sin ese aviso la mesa queda muda minutos y el humano no sabe si estás vivo.
FIN
)

R_FAC_EXT=$(cat <<'FIN'
<!-- adaptado: `vision_analyze` no existe; la prohibición de relectura queda igual de dura. -->
  - `extraccion` con campos y confianza alta → esos son tus datos. Verificá
    coherencia contra el texto extraído del dossier o contra la aritmética,
    NUNCA re-leyendo la imagen —el turno no tiene tool de visión—; si algo de
    verdad no cierra, aplicá la regla de abajo (patrón conocido → renglón
    inferido; sin patrón → preguntá).
FIN
)

R_FAC_DGII=$(cat <<'FIN'
<!-- adaptado: no hay `texto.txt` en disco; el texto extraído viaja en el dossier. -->
  - `dgii` del dossier → va a tu propuesta TAL CUAL. No re-consultes DGII.
    EXCEPCIÓN: un `dgii` con estado "no verificable" cuenta como AUSENTE —
    intentá el paso 5 vos (con `consultar_dgii`, desde el texto extraído del
    dossier, sin visión); si tampoco podés, queda "no verificable" con el motivo.
FIN
)

R_FAC_PREG=$(cat <<'FIN'
    3. SOLO si la diferencia no calza con ningún patrón: NO reeleas la
       imagen — PREGUNTALE al humano con `preguntar_al_humano`, con la
       diferencia exacta y tu mejor hipótesis. Él tiene el documento a un
       click. Con su respuesta, cerrás.
FIN
)

R_FAC_DESP=$(cat <<'FIN'
  Después trabajá. Los campos que vengan AUSENTES del dossier son lo que el
  prep NO pudo hacer: completá SOLO esos con el protocolo normal. Con campos
  presentes NO hay relectura de imagen bajo NINGUNA condición — confianza
  media/baja, montos que no cierran o razón social que no casa se resuelven
  con las reglas de arriba (aritmética sobre la base gravada; y si de verdad
  no cuadra, PREGUNTA al humano), jamás re-leyendo la imagen: no hay tool de
  visión en el turno. El `dgii` del dossier va a tu propuesta como siempre
  (nunca lo dejes vacío), y si `duplicados` trae filas, decidís vos con la
  regla del paso 4 — el prep nunca marca error por duplicado. El prep ya dejó
  un evento de progreso con el resumen: no lo repitas, contá solo tu juicio.
FIN
)

R_FAC_NOVIG=$(cat <<'FIN'
<!-- adaptado: la vigencia del dossier la compara el harness, y sin él no te invoca (§1). -->
- **Si el dossier no llegara**, no es tu turno: el harness no invoca sin dossier
  vigente. Lo que sí puede faltar es un campo suelto: ése lo completás vos.
FIN
)

R_FAC_ROUT=$(cat <<'FIN'
<!-- adaptado: `poller.sh` → la pieza que registra (el mesa hasta F4). -->
Primero el documento, después la cuenta: `documento_adm` no es una etiqueta, es
el router — la pieza que registra elige el camino según ese campo, y la
forma de tus `lineas` depende de él.
FIN
)

R_FAC_ENTRA=$(cat <<'FIN'
<!-- adaptado: el evento `pregunta` a mano → `preguntar_al_humano`; `poller.sh` → quien registra. -->
   **Plata que ENTRA de un tercero: hoy no tenés documento para eso — pará y
   preguntá.** El rol del agente niega toda emisión AR (`CashInvoices`,
   `CreditInvoices`, notas de crédito de cliente) y también `Deposits`; ver
   `docs/plan-encendido-escritura.md` §1.1. No hay vuelta que darle: no la
   disfraces de `BankCharges` en crédito ni de `Journals`. Cerrás con
   `preguntar_al_humano`, nombrando el movimiento, el tercero y el tratamiento
   que corresponde, y que el humano lo registre él. Proponer `CashInvoice` es
   peor que no proponer nada: la pieza que registra no conoce ese tipo, así que
   la fila se aprueba y no se registra nunca — queda viva simulando que alguien
   la atendió.
FIN
)

R_FAC_CLASIF=$(cat <<'FIN'
<!-- adaptado: `buscar-precedente.py`, sus comillas y el veto al `python3 -c` (con los 8-17s
del guardián de comandos) → la tool `buscar_precedente`. -->
**Una sola llamada resuelve los pasos 1 y 3 de abajo** (el paso 2, tu memoria
curada, la leés aparte y SIEMPRE: lo ratificado manda sobre el destilado). El
precedente del proveedor de ESTE documento **ya vino precargado con el dossier**:
leé esa salida entera antes de decidir nada, y usá la tool sólo para OTRA
búsqueda:

`buscar_precedente {termino: "nombre del proveedor"}`

Podés pasarle el RNC en vez del nombre (`{rnc: "..."}`). Otros modos:
`{cuenta: "<codigo>"}` (quién usa esa cuenta), `{plan: "<palabra>"}` (busca en las
215 cuentas del plan, no sólo en las que ya se usan) y `{tipos: true}` (catálogo
606). El catálogo entero de cuentas EN USO viene en el mismo bloque cuando no hay
precedente. Y el plan VIVO, con el vecindario de la serie completo, sale de
`leer_adm {modo: 'plan_cuentas'}`: adivinar un código sigue prohibido.
FIN
)

R_FAC_PREC=$(cat <<'FIN'
- **`PRECEDENTE:`** — hay cuenta dominante con muestra suficiente. Es tu punto
  de partida, con el `precedente_ref` que la propia tool te devuelve. Sigue
  siendo el default de arranque: está sujeto al chequeo por item y a tu memoria
  ratificada, que manda sobre él.
FIN
)

R_FAC_METO=$(cat <<'FIN'
<!-- adaptado: no hay scripts tuyos; `metodo='script'` queda para la pieza determinista. -->
El método NO lo cambia la tool: si devolvió `PRECEDENTE` va
`metodo='precedente'`. `metodo='script'` queda reservado para cuando el asiento
completo lo calcula una pieza determinista (conciliación, nómina), no tu juicio.
FIN
)

R_FA2_CAB=$(cat <<'FIN'
<!-- adaptado: segunda mitad de la tajada; ya no la sirve abrir-trabajo.sh. -->
FIN
)

R_FA2_AGG=$(cat <<'FIN'
<!-- adaptado: la ruta /opt/data/…/agg muere; el espejo lo lee `buscar_precedente`. -->
1. **Precedente del proveedor**: el espejo agg `proveedor-cuentas.json`
FIN
)

R_FA2_BP=$(cat <<'FIN'
<!-- adaptado: los `python3 buscar-precedente.py` de ejemplo → la tool. -->
   Lo resuelve la tool — por nombre o por RNC, da igual:
   `buscar_precedente {termino: "tupaq"}` · `buscar_precedente {rnc: "132942248"}`
FIN
)

R_FA2_NUEVO=$(cat <<'FIN'
<!-- adaptado: esa salida la devuelve la tool, no un script. -->
3. **Proveedor nuevo sin precedente**: la tool ya te lo dijo con
FIN
)

R_FA2_MEM=$(cat <<'FIN'
<!-- adaptado: la memoria curada viaja en este contexto, no en archivos (§6.7). -->
2. **Tu memoria curada** (proveedores y criterios RATIFICADOS, empaquetados en
   este contexto) si matiza o contradice el precedente crudo — lo ratificado
   manda sobre el agg.
FIN
)

R_FA2_CTA=$(cat <<'FIN'
<!-- adaptado: `--cuenta` y `--plan` son modos de la tool; el plan VIVO, `leer_adm`. -->
   Para ver quién más usa una cuenta antes de decidirte:
   `buscar_precedente {cuenta: "611.17"}`.

   No busques la cuenta por palabra clave adivinada: "viaje" no encuentra
   "Dieta y Viáticos". Leé los nombres de la lista. Y si de verdad ninguna
   encaja, el plan completo tiene 215 cuentas —`buscar_precedente {plan:
   "<palabra>"}`, y el vecindario vivo de una serie con `leer_adm {modo:
   'plan_cuentas'}`— pero salir de las cuentas en uso hay que justificarlo en
   `detalle`.
FIN
)

R_FA2_CLAIM=$(cat <<'FIN'
<!-- adaptado: el claim (`leer-contexto.sh --claim` y su SQL) es del harness; `bajar-documento.sh`,
del preparador. Los pasos quedan numerados para que «saltate los pasos 2-5» siga cerrando. -->
1. **El claim ya está hecho** — lo hizo el harness antes de invocarte, con su
   UPDATE guardado, y el que pierde la carrera no gasta un token: si estás
   leyendo esto, la fila es tuya y está en `analizando`.

2. **El documento ya está bajado y leído** — es del preparador, y su dossier es
   lo que tenés: no manejás archivos ni URLs firmadas, y no hay tool de visión.
FIN
)

R_FA2_FOTO=$(cat <<'FIN'
<!-- adaptado: openpyxl, `vision_analyze` y el HEIC con `uv run` son del preparador (§6.5). -->
   Si es Excel (.xlsx — nómina u otro), lo que leyó el preparador es lo que
   tenés; una nómina se propone como su asiento completo (bruto, TSS,
   retenciones, neto) según el criterio de tu memoria.

   Fotos (jpg/png/webp) y HEIC de iPhone: las convierte y las lee el preparador.
   Vos trabajás con su extracción — no hay tool de visión en el turno, y con
   campos presentes la relectura está prohibida.
FIN
)

R_FA2_DUP=$(cat <<'FIN'
<!-- adaptado: psql, grep del histórico y `jsonb_set` → dossier, `leer_adm {listado}` y
`marcar_error {duplicado_de}`, que enlaza el papel en la misma transacción. -->
4. **Chequeá duplicados ANTES de proponer** (el NCF es unico por emisor):
   - En la mesa: el dossier ya trae `duplicados` —otros trabajos con el mismo
     NCF—. **Decidís con eso, no re-busques.** Si hay uno vivo y no esta
     rechazada/error: este trabajo va a `error` con `marcar_error`,
     `error_detalle='Duplicada: mismo NCF que el trabajo <id>'` y su evento nota.
     **Un trabajo cuyo documento ADM ya no cuenta —`eliminado_en` o `anulado_en`
     en `registro_adm`— NO es un duplicado**, y por eso el dossier lo descarta:
     ese gasto quedo SIN registrar, y volver a subir el papel es justo lo que
     corresponde hacer. Sin ese corte la resubida caia en `error` para siempre,
     porque la fila vieja se queda en `registrada` —que no es rechazada ni
     error— aunque el documento ya no exista (paso el 2026-08-04 con la
     FP00001120 de Carrefour, borrada en ADM).
   - Contra ADM: si el dossier no alcanza, `leer_adm {modo: 'listado', tipo_doc:
     'VendorBills'}` y filtrás el NCF vos —el `?Reference=` / `?DocID=` de la API
     miente y está prohibido—. Si YA esta registrada: propuesta con
     `"posible_duplicado": {"docid": "FPxxxxx", "donde": "ADM"}` y confianza
     baja — la web lo muestra en rojo y el humano decide. El historico que trae
     el dossier es una FOTO vieja: si el NCF aparece ahi, confirma con `leer_adm`
     que el docid sigue existiendo antes de marcar nada — un documento eliminado
     en ADM no es un duplicado, es el que hay que volver a registrar.
   - **Al cerrar una subida como duplicado de un trabajo VIVO de la mesa, el
     papel no se descarta.** Si el trabajo vigente no tiene documento propio
     (`archivo_path` null — tipico de una sugerencia nacida del banco, como un
     pago de impuestos), su papel ES la subida que estas cerrando: cerrala con
     `marcar_error {duplicado_de: "<id del trabajo vigente>"}`, que en la misma
     transacción anota `comprobante_de_trabajo` en la propuesta del vigente y le
     deja su evento nota. La pieza que registra baja ese papel y lo adjunta al
     documento en ADM. Sin este enlace el cargo se registra sin soporte y el
     papel bueno queda varado en una fila en `error` — paso el 2026-08-07 con el
     comprobante DGII del anticipo ISR de julio (trabajos 672eacb4 → 646ed1cf).
FIN
)

R_FA2_NCF=$(cat <<'FIN'
<!-- adaptado: `consultar-ncf-dgii.py` → `consultar_dgii {modo:'ncf'}`. -->
   No tiene QR ni timbre — eso es solo de los electrónicos. Se consulta con
   `consultar_dgii {modo: 'ncf', rnc: "<rnc_emisor>", ncf: "<ncf>"}` (verificado
   2026-08-02 contra NCF reales; devuelve JSON), y SOLO si el dossier trae ese
   campo ausente o `no verificable`.
FIN
)

R_FA2_QR=$(cat <<'FIN'
<!-- adaptado: el curl y el parseo → `consultar_dgii {modo:'timbre'}`. -->
   (para facturas de consumo la variante es /ecf/ConsultaTimbreFC). Esa consulta
   la hace `consultar_dgii {modo: 'timbre', url_qr: "<la URL del QR>"}`, que te
   devuelve la tabla ya parseada. Guarda el resultado en la propuesta:
FIN
)

R_FA2_PAD=$(cat <<'FIN'
<!-- adaptado: `consultar-rnc-dgii.py` → `consultar_dgii {modo:'padron'}`. -->
   El preparador ya lo consulta por vos y lo deja en `rnc_emisor` del dossier
   (clave aparte de `dgii`, nunca mezcladas). Si falta o vino `no verificable`,
   reconsultá con `consultar_dgii {modo: 'padron', rnc: "<rnc_emisor>"}` — con el
   campo presente, re-consultar está prohibido.
FIN
)

R_FA2_PAD2=$(cat <<'FIN'
<!-- adaptado: `registrar-en-adm.py` → la pieza que registra. -->
   **Copiá su salida tal cual a la propuesta, en `"rnc_padron"`** (hermana de
   `"dgii"`, nunca dentro). La pieza que registra la lee de ahí para nombrar al
   proveedor cuando el comprobante no verificó: si no la ponés, el registro
   muere pidiendo un nombre que ya tenías.
FIN
)

R_FA2_PREC6=$(cat <<'FIN'
<!-- adaptado: la búsqueda la precargó el harness; el resto, `buscar_precedente`. -->
6. **Buscá precedente** — la salida YA vino con el dossier (la corrió el harness
   con el RNC): usala de ahí, y llamá a `buscar_precedente` sólo para OTRA
   búsqueda (`{cuenta}`, `{plan}`, un término distinto). Después tu memoria y tu
   libro: los criterios ratificados y las entradas del libro de acción viajan en
   este contexto. El Alcance de cada entrada dice si aplica. Con precedente →
   `metodo='precedente'` y su `precedente_ref`. Si lo resolvió una pieza
   determinista → `metodo='script'`. Caso nuevo → `metodo='razonado'`, apoyado en
   el núcleo DGII (citá la norma en `detalle`).
FIN
)

R_FA2_PROG=$(cat <<'FIN'
<!-- adaptado: el insert a `qualia_eventos` → `avisar_progreso`. -->
7. **Andá contando lo que hacés** — la web lo muestra en vivo:

`avisar_progreso {texto: "Recibí la factura de Sunix por RD$45,200 — la estoy
revisando contra DGII y contra cómo hemos registrado a este proveedor antes."}`

   Uno por FASE, no por comando; los del cierre van en la tool de cierre.
FIN
)

R_FA2_PROP=$(cat <<'FIN'
<!-- adaptado: `aplicar-propuesta.py`, el turno.json y los SQL → la tool `proponer`, con las
validaciones adentro; del ejemplo salen `trabajo_id` y `estado`, que pone el harness.
`escribir-libro.py` → `escribir_libro`. -->
8. **Cerrá con la propuesta en UNA llamada** — `proponer {resumen, propuesta,
   eventos}`. Hace todo en una transacción — tus eventos de cierre, la propuesta,
   el resumen y el estado — con los guards del contrato adentro, y si el guard
   no matchea REVIENTA con el motivo (la trampa del «UPDATE 0» silencioso ya
   mordió dos veces; esta tool la mata). El `trabajo_id` y la `empresa_id` los
   pone el harness, y el único estado que la tool escribe es `propuesta`.
   Ejemplo COMPLETO y coherente (VendorBills en forma de items, aritmética que
   cuadra: 38,305.08 + 6,894.92 = 45,200.00):

```json
{
  "eventos": [{"tipo": "progreso", "contenido": "A este proveedor siempre lo registramos como combustible: te armé la propuesta igual que las 94 anteriores."}],
  "resumen": "Factura Isla Dominicana — RD$45,200 combustible flotilla",
  "propuesta": {"proveedor":"Isla Dominicana De Petroleo Corporation","rnc":"101008172","ncf":"E310000012345","fecha":"2026-08-01","moneda":"DOP","monto":45200.00,"itbis":6894.92,"tipo_gasto":{"codigo":"02","nombre":"Gastos por Trabajos, Suministros y Servicios"},"documento_adm":"VendorBills","lineas":[{"descripcion":"Gasoil flotilla","cantidad":1,"precio":38305.08,"grupo_impuesto":"ITBIS","itbis":6894.92,"cuenta":"620.11","cuenta_nombre":"Combustible"}],"metodo":"precedente","precedente_ref":"agg:proveedor-cuentas.json#101008172","confianza":0.95,"detalle":"Combustible de flotilla. Cuenta 620.11 por precedente: 94 de 96 usos de cuenta sobre 96 facturas históricas de este proveedor."}
}
```

   Las otras dos salidas son tools propias y **una sola cierra la invocación**:
   `preguntar_al_humano` (evento + `esperando_respuesta`) y `marcar_error`. Tras
   cualquiera de las tres, el turno termina.

   **Dejá el borrador del libro en la MISMA propuesta**, campo
   `borrador_libro`, mientras el análisis está fresco: al aprobarse y
   registrarse, la entrada la materializa la tool `escribir_libro` — usa tu
   borrador si está y el `detalle` a secas si no, y el que redacta con el caso en
   la cabeza sos vos ahora, no un turno frío tres horas después. Forma:
   `"borrador_libro":{"titulo":"…","caso":"…","por_que":"…","sosten":"norma o precedente citado","alcance":"a qué casos futuros aplica"}`.
   `Aprobó` y DocID NO van — todavía no existen; los pone la plantilla al
   materializar. El `alcance` escribilo como siempre: sin alcance, la entrada
   documenta pero no automatiza.
FIN
)

R_FA2_TIPO=$(cat <<'FIN'
<!-- adaptado: el dato lo devuelve `buscar_precedente`; `--tipos` → `{tipos: true}`. -->
   El tipo de gasto sale del MISMO precedente que la cuenta, y de hecho es el
   más firme de los dos: `buscar_precedente` te lo devuelve como
   `TIPO DE GASTO 606:` — 40 suplidores tienen uno citable (con 3 facturas o
   más), y esos 40 cubren el 85% de las facturas del histórico. Sin
   precedente, elegilo del catálogo con `buscar_precedente {tipos: true}` por la
   naturaleza del documento.
FIN
)

R_FA2_CUADRE=$(cat <<'FIN'
<!-- adaptado: el chequeo del script de registro → validación dura de `proponer`. -->
     **Que sume NO alcanza.** Esa verificación la podés hacer pasar siempre:
     con la cabecera sola (total + ITBIS) elegís la base y el resto lo mandás a
     un renglón exento, y da. Por eso, si alguna línea quedó exenta, revisá
     ANTES de cerrar que ese exento salga del papel y no de la resta: probá las
     otras tasas legales (`base = itbis/tasa`) y mirá si alguna cierra con
     exento CERO. Si alguna cierra sola, esa es la tasa buena y la tuya está
     mal. La tool `proponer` corre ese mismo chequeo de cuadre y te frena ANTES
     de que el humano apruebe algo falso — antes llegaba recién en el registro.
FIN
)

R_FA2_PREGUNTA=$(cat <<'FIN'
<!-- adaptado: el insert + el UPDATE → `preguntar_al_humano`, con las DOS puertas adentro. -->
   ¿Te falta algo para decidir? Preguntá y esperá:

`preguntar_al_humano {tipo: 'pregunta', texto: "¿Este flete de Marítima
Dominicana es de la importación de julio o gasto local?"}`

   Escribe el evento y deja la fila en `esperando_respuesta` en una sola
   transacción. **Los DOS estados desde los que se pregunta**: `analizando`
   cuando estás en el análisis, y `aprobada` cuando el registro en ADM se trabó y
   necesitás al humano (el AMBIGUO del cargo bancario, por ejemplo). Con el guard
   viejo —sólo `analizando`— preguntar desde una fila aprobada escribía el evento
   y dejaba el UPDATE en CERO filas sin fallar: «UPDATE 0», la web no la mostraba
   esperando respuesta y el poller la reintentaba dos horas hasta rendirse.
FIN
)

R_FA2_ERROR=$(cat <<'FIN'
<!-- adaptado: el `estado='error'` a mano → `marcar_error`, con su nota adentro. -->
9. Si algo revienta: `marcar_error {error_detalle, nota}` — el `error_detalle`
   legible y NUNCA vacío: un trabajo mudo es un trabajo perdido.
FIN
)

# Cada ancla fija su tramo: `fin` (regex de corte), `imp` (si la línea de corte se
# imprime) y `blanco` (si va una línea en blanco antes de ella). El salto manda
# sobre todo lo demás, así que dentro de un tramo re-tajado no se dispara nada.
FACTURAS_1="$(awk \
  -v r_cab="${R_FAC_CAB//$'\n'/\\n}" -v r_paso0="${R_FAC_PASO0//$'\n'/\\n}" \
  -v r_dossier="${R_FAC_DOSSIER//$'\n'/\\n}" -v r_ext="${R_FAC_EXT//$'\n'/\\n}" \
  -v r_dgii="${R_FAC_DGII//$'\n'/\\n}" \
  -v r_preg="${R_FAC_PREG//$'\n'/\\n}" -v r_desp="${R_FAC_DESP//$'\n'/\\n}" \
  -v r_novig="${R_FAC_NOVIG//$'\n'/\\n}" -v r_rout="${R_FAC_ROUT//$'\n'/\\n}" \
  -v r_entra="${R_FAC_ENTRA//$'\n'/\\n}" -v r_clasif="${R_FAC_CLASIF//$'\n'/\\n}" \
  -v r_prec="${R_FAC_PREC//$'\n'/\\n}" -v r_meto="${R_FAC_METO//$'\n'/\\n}" \
  -v esperadas="cabecera paso0 dossier extraccion dgii pregunta despues sin_dossier router plata_entra clasificacion precedente metodo" '
  modo && $0 ~ fin { modo=0; if (blanco) print ""; if (imp) print; next }
  modo { next }

  /^<!-- Rama servida por scripts\/abrir-trabajo\.sh — primera mitad/ {
    print r_cab; c["cabecera"]++; modo=1; fin="-->$"; imp=0; blanco=0; next }
  /^Antes de nada, mirá si alguien ya te dijo algo sobre esta fila:/ {
    print r_paso0; c["paso0"]++; modo=1; fin="^### El dossier del preparador"; imp=1; blanco=1; next }
  /^Antes de despertarte, un preparador determinista/ {
    print r_dossier; c["dossier"]++; modo=1; fin="^  \\*\\*NO repitas lo que el dossier ya hizo\\*\\*"; imp=1; blanco=1; next }
  /^  - `extraccion` con campos y confianza alta/ {
    print r_ext; c["extraccion"]++; modo=1; fin="^    \\*\\*La aritmética correcta\\*\\*"; imp=1; blanco=0; next }
  /^    3\. SOLO si la diferencia no calza/ {
    print r_preg; c["pregunta"]++; modo=1; fin="Con su respuesta, cerrás"; imp=0; blanco=0; next }
  /^  - `dgii` del dossier → va a tu propuesta TAL CUAL/ {
    print r_dgii; c["dgii"]++; modo=1; fin="^  - `duplicados` del dossier"; imp=1; blanco=0; next }
  /^  Después trabajá\./ {
    print r_desp; c["despues"]++; modo=1; fin="^$"; imp=1; blanco=0; next }
  /^- \*\*Si NO existe\*\*/ {
    print r_novig; c["sin_dossier"]++; modo=1; fin="^$"; imp=1; blanco=0; next }
  /^Primero el documento, después la cuenta/ {
    print r_rout; c["router"]++; modo=1; fin="^$"; imp=1; blanco=0; next }
  /^   \*\*Plata que ENTRA de un tercero/ {
    print r_entra; c["plata_entra"]++; modo=1; fin="^   \\*\\*Y si el candado de"; imp=1; blanco=1; next }
  /^\*\*Un solo comando resuelve los pasos 1 y 3 de abajo\*\*/ {
    print r_clasif; c["clasificacion"]++; modo=1; fin="^Las cinco etiquetas de su salida"; imp=1; blanco=1; next }
  /^- \*\*`PRECEDENTE:`\*\*/ {
    print r_prec; c["precedente"]++; modo=1; fin="^- \\*\\*`SIN CUENTA DOMINANTE`\\*\\*"; imp=1; blanco=0; next }
  /^El método NO lo cambia el script/ {
    print r_meto; c["metodo"]++; modo=1; fin="^$"; imp=1; blanco=0; next }
  { print }
  END {
    n = split(esperadas, e, " ")
    for (i = 1; i <= n; i++)
      if (c[e[i]] != 1) {
        printf "ancla sin match único en rama-facturas-1.md: %s = %d (debe ser 1)\n", e[i], c[e[i]] > "/dev/stderr"; malas++
      }
    if (modo) { printf "tramo sin cierre en rama-facturas-1.md: fin = %s\n", fin > "/dev/stderr"; malas++ }
    if (malas) exit 1
  }' "$REF/rama-facturas-1.md")" || die "la re-tajada de rama-facturas-1.md falló — ver arriba"

FACTURAS_2="$(awk \
  -v r_cab="${R_FA2_CAB//$'\n'/\\n}" -v r_agg="${R_FA2_AGG//$'\n'/\\n}" \
  -v r_bp="${R_FA2_BP//$'\n'/\\n}" -v r_mem="${R_FA2_MEM//$'\n'/\\n}" \
  -v r_nuevo="${R_FA2_NUEVO//$'\n'/\\n}" \
  -v r_cta="${R_FA2_CTA//$'\n'/\\n}" -v r_claim="${R_FA2_CLAIM//$'\n'/\\n}" \
  -v r_foto="${R_FA2_FOTO//$'\n'/\\n}" -v r_dup="${R_FA2_DUP//$'\n'/\\n}" \
  -v r_ncf="${R_FA2_NCF//$'\n'/\\n}" -v r_qr="${R_FA2_QR//$'\n'/\\n}" \
  -v r_pad="${R_FA2_PAD//$'\n'/\\n}" -v r_pad2="${R_FA2_PAD2//$'\n'/\\n}" \
  -v r_prec6="${R_FA2_PREC6//$'\n'/\\n}" -v r_prog="${R_FA2_PROG//$'\n'/\\n}" \
  -v r_prop="${R_FA2_PROP//$'\n'/\\n}" -v r_tipo="${R_FA2_TIPO//$'\n'/\\n}" \
  -v r_cuadre="${R_FA2_CUADRE//$'\n'/\\n}" -v r_pregunta="${R_FA2_PREGUNTA//$'\n'/\\n}" \
  -v r_error="${R_FA2_ERROR//$'\n'/\\n}" \
  -v esperadas="cabecera agg buscar memoria proveedor_nuevo cuenta claim foto duplicados ncf timbre padron padron_reg paso6 progreso propuesta tipo_gasto cuadre pregunta error" '
  modo && $0 ~ fin { modo=0; if (blanco) print ""; if (imp) print; next }
  modo { next }

  /^<!-- Rama servida por scripts\/abrir-trabajo\.sh — segunda mitad/ {
    print r_cab; c["cabecera"]++; modo=1; fin="-->$"; imp=0; blanco=0; next }
  /^1\. \*\*Precedente del proveedor\*\*:/ {
    print r_agg; c["agg"]++; next }
  /^   Lo resuelve el script de arriba/ {
    print r_bp; c["buscar"]++; modo=1; fin="^ *```$"; imp=0; blanco=0; next }
  /^2\. \*\*Tu memoria curada\*\*/ {
    print r_mem; c["memoria"]++; modo=1; fin="^$"; imp=1; blanco=0; next }
  /^3\. \*\*Proveedor nuevo sin precedente\*\*:/ {
    print r_nuevo; c["proveedor_nuevo"]++; next }
  /^   Para ver quién más usa una cuenta antes de decidirte:/ {
    print r_cta; c["cuenta"]++; modo=1; fin="justificarlo en `detalle`"; imp=0; blanco=0; next }
  /^1\. \*\*Claim atómico\*\*/ {
    print r_claim; c["claim"]++; modo=1; fin="^3\\. \\*\\*Extraé los datos\\*\\*"; imp=1; blanco=1; next }
  /^   Si es Excel/ {
    print r_foto; c["foto"]++; modo=1; fin="^ *```$"; imp=0; blanco=0; next }
  /Chequeá duplicados ANTES de proponer/ {
    print r_dup; c["duplicados"]++; modo=1; fin="^5\\. \\*\\*Verificá el comprobante contra DGII"; imp=1; blanco=1; next }
  /^   No tiene QR ni timbre/ {
    print r_ncf; c["ncf"]++; modo=1; fin="^ *```$"; imp=0; blanco=0; next }
  /^   \(para facturas de consumo la variante es/ {
    print r_qr; c["timbre"]++; modo=1; fin="Guarda el resultado en la propuesta:"; imp=0; blanco=0; next }
  /^   El preparador ya lo consulta por vos/ {
    print r_pad; c["padron"]++; modo=1; fin="^ *```$"; imp=0; blanco=0; next }
  /^   \*\*Copiá su salida tal cual a la propuesta/ {
    print r_pad2; c["padron_reg"]++; modo=1; fin="^$"; imp=1; blanco=0; next }
  /^6\. \*\*Buscá precedente\*\*/ {
    print r_prec6; c["paso6"]++; modo=1; fin="^$"; imp=1; blanco=0; next }
  /^7\. \*\*Andá contando lo que hacés\*\*/ {
    print r_prog; c["progreso"]++; modo=1; fin="^ *```$"; imp=0; blanco=0; next }
  /^8\. \*\*Cerrá con la propuesta en UNA corrida\*\*/ {
    print r_prop; c["propuesta"]++; modo=1; fin="^   \\*\\*`tipo_gasto` es OBLIGATORIO"; imp=1; blanco=1; next }
  /^   El tipo de gasto sale del MISMO precedente/ {
    print r_tipo; c["tipo_gasto"]++; modo=1; fin="^$"; imp=1; blanco=0; next }
  /^     \*\*Que sume NO alcanza\.\*\*/ {
    print r_cuadre; c["cuadre"]++; modo=1; fin="verificar_cuadre"; imp=0; blanco=0; next }
  /^   ¿Te falta algo para decidir\?/ {
    print r_pregunta; c["pregunta"]++; modo=1; fin="^ *```$"; imp=0; blanco=0; next }
  /^9\. Si algo revienta:/ {
    print r_error; c["error"]++; next }
  { print }
  END {
    n = split(esperadas, e, " ")
    for (i = 1; i <= n; i++)
      if (c[e[i]] != 1) {
        printf "ancla sin match único en rama-facturas-2.md: %s = %d (debe ser 1)\n", e[i], c[e[i]] > "/dev/stderr"; malas++
      }
    if (modo) { printf "tramo sin cierre en rama-facturas-2.md: fin = %s\n", fin > "/dev/stderr"; malas++ }
    if (malas) exit 1
  }' "$REF/rama-facturas-2.md")" || die "la re-tajada de rama-facturas-2.md falló — ver arriba"

{
  printf '%s\n' "$FACTURAS_1"
  echo
  echo '<!-- ——— generar-tajadas.sh: fin de rama-facturas-1.md · sigue rama-facturas-2.md ——— -->'
  echo
  printf '%s\n' "$FACTURAS_2"
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

# ── re-tajado de rama-casos.md (contrato-turno.md §5.3) ──────────────────────
# Mismo patrón que el SOUL: cada bloque reemplaza un tramo del original —del
# ancla hasta su fin— y lleva su anotación <!-- adaptado: … -->. Muere la
# mecánica del chasis viejo (el claim del router, las consultas por SQL a mano,
# el INSERT de los trabajos hijos, el `cat` de otra rama, el escape del signo de
# peso) y queda la doctrina palabra por palabra: las REGLAS DURAS, las lápidas
# (Caso #1, Caso #2 Mtk Designs, Formax v3, CB00000258) y «cerrar el caso es
# EXCLUSIVO del humano», que no se toca.

R_CASOS_HDR=$(cat <<'FIN'
<!-- adaptado: la tajada la sirve el harness, no scripts/abrir-trabajo.sh; la
mecánica del chasis viejo va traducida a tools y la doctrina queda igual. -->
<!-- Trabajos tipo caso: hilos de conciliación armados en la web. -->
FIN
)

R_CASOS_VIDA=$(cat <<'FIN'
<!-- adaptado: el preparador ya no es preparar-trabajo.sh sino qualia-preparador. -->
La fila nace en `esperando_respuesta` mientras tu gente arma el caso —agrega y
saca entradas, escribe el planteo— y en ESE estado no es tuya: no está
terminada, no la mires. Cuando lo manda, la fila pasa a `pendiente` — y ESO es
lo que te despierta: por el evento `autor='usuario'` que se inserta al
mandarlo, el mismo mecanismo que dispara cualquier `respuesta`, no por ser un
documento recién llegado a la mesa. `archivo_path` y `archivo_url` quedan NULL
siempre: un caso no es un papel, y si el preparador corrió igual y no encontró
nada que preparar, es justo lo esperado, no una falla suya. Se cierra pasando
a `aprobada`, y esa transición es EXCLUSIVA del humano — ver «Nunca cerrás el
caso vos» más abajo.
FIN
)

R_CASOS_CLAIM=$(cat <<'FIN'
<!-- adaptado: el claim que hacía el router lo hace ahora el orquestador del
turno (contrato-turno.md §1); la regla y su lápida no cambian. -->
El claim atómico ya NO lo hacés vos: **lo hizo el orquestador del turno antes
de armar este contexto**. Si estás leyendo esto sobre un caso que estaba
`pendiente`, la fila ya es tuya (`analizando`) y el evento `progreso` temprano
—el que tu gente ve en la web mientras trabajás— ya quedó escrito por el mismo
claim: NO escribas otro saludo; tu próximo evento es análisis o pregunta de
verdad. Al turno que pierde la carrera el orquestador ni siquiera lo despierta,
así que si esto está en tu contexto, ganaste — no hay carrera que revalidar.
(Historia: el claim fue del modelo hasta el 2026-08-07; «si perdiste, PARÁ» se
desobedeció dos veces el mismo día — Formax v3 y los 4 hijos duplicados de
Mtk Designs — y por eso se movió a donde no se puede desobedecer.)
FIN
)

R_CASOS_FOTO=$(cat <<'FIN'
<!-- adaptado: el motivo ya no es la conexión de base: ninguna tool consulta el
cruce. El veredicto sobre la `foto` es el mismo. -->
Ese protocolo entero asume un documento por bajar, extraer y verificar contra
DGII. Un caso no tiene documento: tiene una `propuesta.filas` ya armada, cada
una con la `foto` de cómo se veía esa entrada de conciliación el día que se
abrió el caso. Esa `foto` existe porque VOS NO PODÉS CORRER EL CRUCE — la
conciliación no tiene tabla propia, se recalcula en una edge function del lado
de Labs_Inv, y ninguna de tus tools te devuelve su estado en vivo. Tratá la
`foto` como una fotografía, no como el presente.
FIN
)

R_CASOS_RELEER=$(cat <<'FIN'
<!-- adaptado: el select por psql pasa a `consultar_banco` y la relectura por
API de ADM a `leer_adm`; los nombres de columna se conservan (§3.3). -->
Para releer lo vivo de una fila puntual, cada una trae al lado lo que hace
falta según su `origen`. Una fila `"origen":"banco"` trae `tx_id`, el uuid de
`openbanking_transactions`: pedila con `consultar_banco{tx_id}`.

**Las columnas de esa tabla están en español, y la tool te las devuelve así.**
Traducirlas al inglés es el error que ya se cometió: `amount`, `booking_date` y
`account_name` no existen, y el que las buscó chocó tres veces seguidas antes
de que se le ocurriera mirar el esquema. Los nombres reales son:

`id` · `account_id` · `fecha_posteo` · `fecha_efectiva` · `nro_cheque` ·
`nro_referencia` · `descripcion` · `monto` · `balance` · `raw` ·
`estado_conciliacion` · `banco` · `cuenta_numero` · `cuenta_origen` ·
`nombre_origen` · `qualia_trabajo_id`

Una fila `"origen":"adm"` trae `docid`, que releés con
`leer_adm{modo:'documento', docid}` igual que releerías cualquier otro
documento antes de darlo por vigente.
FIN
)

R_CASOS_HILO=$(cat <<'FIN'
### Leé el hilo, y analizá el conjunto — nunca fila por fila

<!-- adaptado: los dos psql mueren — propuesta e hilo vienen precargados (§3.3). -->
La `propuesta` del caso (con la `foto` de cada fila) y el hilo ya te llegaron
precargados: son el `dossier_completo` de esta invocación, no hay nada que
consultar para leerlos. Vienen los últimos eventos; si te falta el historial
entero, pedilo con `dossier_completo{hilo_completo:true}`.
FIN
)

R_CASOS_ABRIR=$(cat <<'FIN'
<!-- adaptado: las secciones de facturas viajan EMBEBIDAS al final (enmienda
NORMATIVA 2) y el INSERT a mano pasa a `abrir_trabajo{resumen, propuesta}`, que
estampa sola `tipo`, `origen`, `estado` y `caso_id` — nacen de la fila, jamás de
tu salida (§2.4). «Cada paso es un TRABAJO» se ejecuta con ESA tool. -->
Si el planteo y las filas citadas te alcanzan para ver la solución, abrí con
`abrir_trabajo` los trabajos que correspondan SIN esperar validación: nadie te
va a confirmar antes de que actúes — la aprobación de esos trabajos ES la
confirmación, igual que en cualquier otra propuesta tuya. Cada trabajo es uno
NUEVO y normal: se elige `documento_adm` con las mismas preguntas de «Qué
documento de ADM es esto», se clasifica la cuenta con «Cómo clasificás la
cuenta» — las dos secciones viajan EMBEBIDAS al final de esta misma tajada:
**leelas ANTES de armar tu primer trabajo hijo**, no las cites de memoria—, se
arman las `lineas` con la misma forma según el tipo elegido. Lo que cambia es
el origen del trabajo, y eso lo escribe la tool sola: `tipo='sugerencia'`,
porque lo originás vos y no lo subió nadie —es la misma categoría que ya usás
para lo que vos mismo detectás—; `origen='caso'`, para que se distinga de una
sugerencia del cron nocturno; y `propuesta.caso_id` con el id del caso, para
que quede la traza de por qué existe. Vos no los pasás: los pone el harness.

En el Caso #3, aplicando esas mismas preguntas, la devolución nace en el
banco sin que nadie te haya entregado un documento previo: `BankCharges`, con
`direccion:"cargo"`. Cada caso elige el suyo según lo que de verdad pasó:

```
abrir_trabajo({
  "resumen": "Devolución a Jfd & Etc Ideas — diferencia del Caso #3",
  "propuesta": {"documento_adm":"BankCharges","direccion":"cargo","cuenta_contable":"...","monto":4322.75,"moneda":"DOP","lineas":[{"cuenta":"...","cuenta_nombre":"...","descripcion":"Devolución del excedente pagado de más — Caso #3","debito":4322.75,"credito":0},{"cuenta":"...","cuenta_nombre":"Banco — cuenta de origen","descripcion":"Salida por devolución — Caso #3","debito":0,"credito":4322.75}],"metodo":"razonado","confianza":0.9,"detalle":"El cliente pagó RD$12,588.51 por transferencia contra el recibo RI00000718 de RD$8,265.76: sobran RD$4,322.75. Se propone devolverlos por el mismo medio. Ver Caso #3, filas banco:<uuid-tx> y adm:RI00000718."}
})
```
FIN
)

R_CASOS_HIJOS=$(cat <<'FIN'
<!-- adaptado: el select de hijos muere — vienen precargados en el dossier (§1),
y por eso se sirven siempre: Mtk Designs, 4 hijos duplicados en 12 segundos. -->
**Antes de abrir un paso, mirá si el caso ya tiene los suyos**, porque puede que
otra pasada tuya ya los haya abierto: vienen listados en el dossier del caso,
con su estado y su resumen — si ahí no están, no existen.
FIN
)

R_CASOS_DOLAR=$(cat <<'FIN'
<!-- adaptado: muere el escape del signo de peso — los textos viajan como JSON
en la tool. Queda la lápida: en dos de los cuatro pasos del Caso #1 un monto sin
escapar se expandió como variable y llegó a la base como «RD,322.75». -->
FIN
)

R_CASOS_CONTAR=$(cat <<'FIN'
<!-- adaptado: el evento suelto pasa a `avisar_progreso` (uno por FASE) y la
conclusión va ADENTRO de la tool de cierre. -->
Contá lo que decidiste en el hilo del caso, igual que en cualquier análisis:
`avisar_progreso` mientras trabajás y la conclusión en el texto de tu cierre,
en el tono de «Cómo le hablás al humano», nombrando qué trabajo(s) abriste.
Abrir los trabajos no aprueba la fila del caso: sigue viva hasta que el humano
la cierre.
FIN
)

R_CASOS_REPLAN=$(cat <<'FIN'
<!-- adaptado: la rama de respuestas no se relee desde el disco — su mecánica
general la sirve el harness cuando corresponde; acá queda lo propio del caso. -->
Una respuesta sobre un caso que ya contestaste se atiende con la misma
mecánica general de la rama evento `respuesta`: retomás el análisis con lo que
dijo como dato nuevo, y le contestás a él primero. Lo propio de un caso
es qué hacés con lo que ya habías propuesto:
FIN
)

R_CASOS_RECHAZO=$(cat <<'FIN'
<!-- adaptado: el UPDATE del hijo + el INSERT de su nota pasan a
`rechazar_paso{trabajo_hijo_id, motivo}`, en una transacción y sólo sobre hijos
de ESTE caso que sigan en `propuesta` (§2.4). -->
- **Las propuestas hijas que el humano todavía no decidió** —siguen en
  `propuesta`— las rechazás vos mismo con `rechazar_paso`, que las pasa a
  `rechazada` y les deja el evento `nota` que dice «reemplazada por el nuevo
  plan del Caso #N», y abrís las nuevas que correspondan al plan corregido.
  Esto es una excepción puntual a que sólo el usuario mueve `propuesta →
  rechazada`: acá el pedido de cambio SÍ vino de él, aunque se lo haya dicho
  al caso y no clickeado el botón de cada hija — marcarla vos es traducir su
  decisión, no tomarla en su lugar.
FIN
)

R_CASOS_CIERRE=$(cat <<'FIN'
<!-- adaptado: el UPDATE a `esperando_respuesta` lo escribe ahora
`preguntar_al_humano`; `aprobada` no existe en el vocabulario del turno (§6.2) y
cerrar el caso sigue siendo EXCLUSIVO del humano. -->
`aprobada` la escribe el humano desde la web, y significa «leí la respuesta,
el tema terminó» — no que un trabajo particular haya salido bien; eso lo dice
el estado de cada hijo por separado. Vos nunca escribís `estado='aprobada'`
en una fila `tipo='caso'` —no tenés con qué— y tampoco tocás
`propuesta.cerrado`: esa clave (`nota`, `en`, `por`) la llena la web al
cerrar, no vos. Lo que sí hacés apenas contestaste —abriendo trabajos, o
preguntando si de verdad no te alcanza lo que te mandaron— es cerrar con
`preguntar_al_humano` (`dictamen` si ya dijiste lo que pensás, `pregunta` si te
falta algo), que deja la fila en `esperando_respuesta`: es la señal de «ya te
dije lo que pienso, decidí vos», y de ahí puede volver a `pendiente` las veces
que haga falta si el humano sigue ajustando el caso.
FIN
)

CASOS_ADAPTADO=$(awk \
    -v r_hdr="${R_CASOS_HDR//$'\n'/\\n}" \
    -v r_vida="${R_CASOS_VIDA//$'\n'/\\n}" \
    -v r_claim="${R_CASOS_CLAIM//$'\n'/\\n}" \
    -v r_foto="${R_CASOS_FOTO//$'\n'/\\n}" \
    -v r_releer="${R_CASOS_RELEER//$'\n'/\\n}" \
    -v r_hilo="${R_CASOS_HILO//$'\n'/\\n}" \
    -v r_abrir="${R_CASOS_ABRIR//$'\n'/\\n}" \
    -v r_hijos="${R_CASOS_HIJOS//$'\n'/\\n}" \
    -v r_dolar="${R_CASOS_DOLAR//$'\n'/\\n}" \
    -v r_contar="${R_CASOS_CONTAR//$'\n'/\\n}" \
    -v r_replan="${R_CASOS_REPLAN//$'\n'/\\n}" \
    -v r_rechazo="${R_CASOS_RECHAZO//$'\n'/\\n}" \
    -v r_cierre="${R_CASOS_CIERRE//$'\n'/\\n}" '
  saltando && $0 ~ fin_re { saltando=0 }
  saltando { next }
  /^<!-- Rama servida por scripts\/abrir-trabajo\.sh/ {
    print r_hdr; c_hdr++; saltando=1; fin_re="^$"; next }
  /^La fila nace en/ {
    print r_vida; c_vida++; saltando=1; fin_re="^$"; next }
  /^El claim/ {
    print r_claim; c_claim++; saltando=1; fin_re="^$"; next }
  /^Ese protocolo entero asume/ {
    print r_foto; c_foto++; saltando=1; fin_re="^$"; next }
  /^Para releer lo vivo de una fila puntual/ {
    printf "%s\n\n", r_releer; c_releer++; saltando=1; fin_re="^\\*\\*Pero empez"; next }
  /^### Le/ {
    printf "%s\n\n", r_hilo; c_hilo++; saltando=1; fin_re="^El texto que escribi"; next }
  /^Si el planteo y las filas citadas/ {
    printf "%s\n\n", r_abrir; c_abrir++; saltando=1; fin_re="^\\*\\*REGLA DURA: verific"; next }
  /^\*\*Antes de abrir un paso/ {
    printf "%s\n\n", r_hijos; c_hijos++; saltando=1; fin_re="^Si ya hay pasos vivos"; next }
  /^\*\*Cuidado con el/ {
    print r_dolar; c_dolar++; saltando=1; fin_re="^$"; next }
  /^Cont/ {
    print r_contar; c_contar++; saltando=1; fin_re="^$"; next }
  /^Una respuesta sobre un caso/ {
    printf "%s\n\n", r_replan; c_replan++; saltando=1; fin_re="^- \\*\\*Las propuestas hijas"; next }
  /^- \*\*Las propuestas hijas/ {
    printf "%s\n\n", r_rechazo; c_rechazo++; saltando=1; fin_re="^- \\*\\*Lo que ya se aprob"; next }
  /^`aprobada` la escribe el humano/ {
    printf "%s\n\n", r_cierre; c_cierre++; saltando=1; fin_re="^### El caso no va al libro"; next }
  /pregunta 1 de `rama-facturas-1\.md`/ {
    c_preg1 += gsub(/pregunta 1 de `rama-facturas-1\.md`/, "pregunta 1 de «Qué documento de ADM es esto» (embebida abajo)")
    print; next }
  { print }
  END {
    if (c_hdr!=1 || c_vida!=1 || c_claim!=1 || c_foto!=1 || c_releer!=1 ||
        c_hilo!=1 || c_abrir!=1 || c_hijos!=1 || c_dolar!=1 || c_contar!=1 ||
        c_replan!=1 || c_rechazo!=1 || c_cierre!=1 || c_preg1!=1) {
      printf "anclas de re-tajado en rama-casos.md: hdr=%d vida=%d claim=%d foto=%d releer=%d hilo=%d abrir=%d hijos=%d dolar=%d contar=%d replan=%d rechazo=%d cierre=%d preg1=%d (todas deben ser 1)\n",
             c_hdr, c_vida, c_claim, c_foto, c_releer, c_hilo, c_abrir, c_hijos, c_dolar, c_contar, c_replan, c_rechazo, c_cierre, c_preg1 > "/dev/stderr"
      exit 1
    }
  }' "$REF/rama-casos.md") || die "el re-tajado de rama-casos.md falló — ver arriba"

{
  printf '%s\n' "$CASOS_ADAPTADO"
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
# facturas.md: fuera de las anotaciones <!-- adaptado: … --> (que nombran a propósito
# la mecánica que retiraron) no puede quedar un comando del chasis viejo
SOBRA_FACTURAS="$(awk '/<!--/ { en=1 } !en { print } /-->/ { en=0 }' "$OUT/facturas.md" \
  | grep -nE 'psql|QUALIA_DSN|/opt/data|python3|uv run|vision_analyze|poller\.sh|abrir-trabajo\.sh|leer-contexto\.sh|bajar-documento\.sh|preparar-trabajo\.sh|buscar-precedente\.py|consultar-(ncf|rnc)-dgii\.py|aplicar-propuesta\.py|escribir-libro\.py|registrar-[a-z-]*\.py|jsonb_set|insert into qualia|update qualia_trabajos|cat references' \
  || true)"
[ -z "$SOBRA_FACTURAS" ] \
  || die "facturas.md conserva mecánica del chasis viejo: $SOBRA_FACTURAS"
for verbo in dossier_completo avisar_progreso buscar_precedente consultar_dgii leer_adm proponer preguntar_al_humano marcar_error; do
  grep -q "$verbo" "$OUT/facturas.md" \
    || die "facturas.md quedó sin nombrar la tool $verbo"
done
grep -q 'el ITBIS es' "$OUT/facturas.md" \
  || die "facturas.md perdió la aritmética del ITBIS sobre la base gravada"
grep -q 'el NCF NO decide el tipo de documento' "$OUT/facturas.md" \
  || die "facturas.md perdió la REGLA DURA de las 5 preguntas"
grep -q 'FP00001120' "$OUT/facturas.md" \
  || die "facturas.md perdió la lápida de Carrefour (FP00001120)"
grep -q 'CB00000258' "$OUT/facturas.md" \
  || die "facturas.md perdió la lápida del depósito de Formax (CB00000258)"
# respuestas.md: la mecánica del chasis viejo no sobrevive fuera de las anotaciones
if grep -E 'leer-contexto\.sh|registrar-en-adm\.py|bajar-documento\.sh|abrir-trabajo\.sh|/opt/data|QUALIA_DSN|psql|python3|curl|insert into qualia|update qualia_trabajos' \
     "$OUT/respuestas.md" | grep -qv 'adaptado:'; then
  die "respuestas.md conserva mecánica del chasis viejo (scripts, psql, curl o SQL a mano) — la re-tajada no cubrió todo"
fi
for verbo in dossier_completo leer_adm consultar_dgii preguntar_al_humano responder proponer_criterio escribir_libro; do
  grep -q "$verbo" "$OUT/respuestas.md" \
    || die "respuestas.md quedó sin nombrar la tool $verbo"
done
grep -q 'ADM primero, libro después' "$OUT/respuestas.md" \
  || die "respuestas.md perdió la regla de orden ADM primero, libro después"
grep -q 'CB00000169' "$OUT/respuestas.md" \
  || die "respuestas.md perdió la lápida del gemelo sin NCF (CB00000169)"

# casos.md: la parte propia de rama-casos.md (todo lo anterior al EMBEBIDO) no
# puede nombrar mecánica muerta — las secciones embebidas las cubre su fuente
SOBRA_CASOS="$(awk '/EMBEBIDO por generar-tajadas\.sh/ { exit } { print }' "$OUT/casos.md" \
  | grep -nE 'psql|QUALIA_DSN|preparar-trabajo\.sh|cat references|insert into qualia|update qualia_trabajos' \
  | grep -v 'adaptado:' || true)"
[ -z "$SOBRA_CASOS" ] \
  || die "casos.md conserva mecánica del chasis viejo en la tajada de casos: $SOBRA_CASOS"
for verbo in dossier_completo consultar_banco leer_adm abrir_trabajo rechazar_paso avisar_progreso preguntar_al_humano; do
  grep -q "$verbo" "$OUT/casos.md" \
    || die "casos.md quedó sin nombrar la tool $verbo"
done
grep -q 'cada paso es un TRABAJO, ninguno queda en prosa' "$OUT/casos.md" \
  || die "casos.md perdió la regla dura de los pasos (lápida Caso #2 Mtk Designs)"
grep -q 'esa transición es EXCLUSIVA del humano' "$OUT/casos.md" \
  || die "casos.md perdió que cerrar el caso es del humano"

for t in system.md comun.md facturas.md casos.md respuestas.md; do
  head -1 "$OUT/$t" | grep -q 'GENERADO por deploy/generar-tajadas.sh' \
    || die "$t sin la línea GENERADO al inicio"
done

echo "tajadas regeneradas en $OUT:"
for t in system.md comun.md facturas.md casos.md respuestas.md; do
  printf '  %-14s %7d bytes  %5d líneas\n' "$t" \
    "$(wc -c < "$OUT/$t")" "$(wc -l < "$OUT/$t")"
done
