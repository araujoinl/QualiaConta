#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verificar-corte.sh — el candado de reensamblado de la mesa de trabajo.
#
# Qué demuestra: que partir SKILL.md en núcleo + ramas NO perdió ni reescribió
# texto. Reconstruye el archivo de hoy pegando, en el orden original de líneas,
# los pedazos que quedaron en cada archivo, y lo compara contra el original.
#
# Sólo acepta cuatro clases de diferencia, y las lista una por una:
#   H1            los títulos nuevos que encabezan cada archivo de rama
#   SECCION_NUEVA la sección «Dónde está el resto» del núcleo
#   PUNTERO       los punteros reescritos que estaban en el plan
#   PROMOVIDO     los bloques que subieron al núcleo (mismo texto, otra posición)
# Cualquier otra diferencia —texto que desapareció o que cambió de redacción—
# es un fallo: sale con código 1 y muestra el diff exacto.
#
# Uso:  bash mesa/verificar-corte.sh [SKILL.md-original] [dir-del-skill-cortado]
#       (por default /tmp/SKILL-original.md y skills/mesa-de-trabajo del repo;
#        el segundo argumento existe para probar el candado contra una copia
#        alterada a propósito, sin tocar el repo)
# ---------------------------------------------------------------------------
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORIGINAL="${1:-/tmp/SKILL-original.md}"
SKILLDIR="${2:-$REPO/skills/mesa-de-trabajo}"

if [ ! -f "$ORIGINAL" ]; then
  echo "ERROR: no encuentro el SKILL.md original en $ORIGINAL" >&2
  echo "       pasalo como primer argumento, o dejalo en /tmp/SKILL-original.md" >&2
  exit 2
fi

exec python3 - "$ORIGINAL" "$SKILLDIR" <<'PYEOF'
# -*- coding: utf-8 -*-
"""Reensambla el skill partido y demuestra que no se perdió texto."""
import sys, os, json, difflib, unicodedata

ORIGINAL, SKILLDIR = sys.argv[1], sys.argv[2]

# ---------------------------------------------------------------------------
# DATOS: el manifiesto de reensamblado y la lista blanca de diferencias.
#
# manifiesto: [orig_desde, orig_hasta, archivo, arch_desde, arch_hasta]
#   "las líneas orig_desde..orig_hasta del original las aporta el archivo
#    <archivo>, en sus líneas arch_desde..arch_hasta". Los tramos van en el
#    orden del original y tienen que cubrirlo entero, sin huecos ni solapes.
#
# permitidos: cada diferencia que se acepta, con su texto viejo y su texto
#   nuevo VERBATIM. Está escrito a mano después de revisar hunk por hunk: si
#   alguien retoca una de esas frases, el hash deja de calzar y el script falla.
# ---------------------------------------------------------------------------
DATOS = json.loads(r"""
{
 "manifiesto": [
  [
   1,
   47,
   "SKILL.md",
   1,
   47
  ],
  [
   48,
   55,
   "SKILL.md",
   48,
   112
  ],
  [
   56,
   92,
   "SKILL.md",
   113,
   149
  ],
  [
   93,
   116,
   "SKILL.md",
   150,
   173
  ],
  [
   117,
   232,
   "references/rama-pendiente.md",
   2,
   85
  ],
  [
   233,
   452,
   "references/ref-clasificacion.md",
   2,
   378
  ],
  [
   453,
   585,
   "references/rama-pendiente.md",
   87,
   225
  ],
  [
   586,
   587,
   "SKILL.md",
   199,
   208
  ],
  [
   588,
   763,
   "references/rama-pendiente.md",
   226,
   314
  ],
  [
   764,
   771,
   "SKILL.md",
   175,
   182
  ],
  [
   772,
   773,
   "references/rama-pendiente.md",
   316,
   317
  ],
  [
   774,
   785,
   "references/rama-accion-usuario.md",
   2,
   17
  ],
  [
   786,
   798,
   "SKILL.md",
   184,
   197
  ],
  [
   799,
   1014,
   "references/ref-registro-adm.md",
   2,
   218
  ],
  [
   1015,
   1020,
   "references/rama-accion-usuario.md",
   18,
   24
  ],
  [
   1021,
   1146,
   "references/rama-accion-usuario.md",
   25,
   150
  ],
  [
   1147,
   1176,
   "references/rama-escribir-libro.md",
   2,
   32
  ],
  [
   1177,
   1220,
   "references/rama-registro-pendiente.md",
   2,
   52
  ],
  [
   1221,
   1254,
   "references/rama-criterio.md",
   2,
   36
  ],
  [
   1255,
   1262,
   "SKILL.md",
   209,
   216
  ],
  [
   1263,
   1420,
   "references/rama-caso.md",
   2,
   162
  ],
  [
   1421,
   1424,
   "SKILL.md",
   218,
   221
  ],
  [
   1425,
   1510,
   "references/rama-caso.md",
   163,
   256
  ],
  [
   1511,
   1534,
   "SKILL.md",
   222,
   245
  ]
 ],
 "permitidos": [
  {
   "id": 1,
   "cat": "PUNTERO",
   "motivo": "El item 5 del protocolo pasa a nombrar abrir-trabajo.sh, que reemplaza al psql.",
   "orig": [
    "5. **Tu PRIMER comando es siempre leer la fila** (está abajo). Ningún otro tool",
    "   antes de eso."
   ],
   "nuevo": [
    "5. **Tu PRIMER comando es siempre `abrir-trabajo.sh` (está abajo).** Ningún otro",
    "   tool antes de eso: ese script te imprime la fila Y la rama que te toca."
   ]
  },
  {
   "id": 2,
   "cat": "PUNTERO",
   "motivo": "Anuncia que el comando ademas entrega el procedimiento de la fila.",
   "orig": [
    "según su estado real, no según el mensaje que te despertó."
   ],
   "nuevo": [
    "según su estado real, no según el mensaje que te despertó. Eso lo hace un solo",
    "comando, que además te entrega el procedimiento que corresponde a esa fila:"
   ]
  },
  {
   "id": 3,
   "cat": "PUNTERO",
   "motivo": "El psql de apertura se reemplaza por abrir-trabajo.sh (decision 4 del plan).",
   "orig": [
    "psql \"$QUALIA_DSN\" -t -A -c \"select estado, tipo, archivo_url, archivo_nombre, resumen, updated_at from qualia_trabajos where id='<trabajo_id>' and empresa_id='$QUALIA_EMPRESA_ID'\""
   ],
   "nuevo": [
    "bash /opt/data/skills/qualiaconta/mesa-de-trabajo/scripts/abrir-trabajo.sh <trabajo_id>"
   ]
  },
  {
   "id": 4,
   "cat": "SECCION_NUEVA",
   "motivo": "Explicacion de abrir-trabajo.sh + la seccion nueva «Donde esta el resto» con el router R1..R11, la excepcion de puntero explicito, y R9/R10 partido en dos sub-viñetas segun DocID (3a tanda).",
   "orig": [
    "**Guardá ese `updated_at`**: es tu referencia PRE-claim para juzgar si el",
    "dossier del preparador está vigente (el claim lo va a cambiar)."
   ],
   "nuevo": [
    "Imprime la fila (estado, tipo, archivo_url, archivo_nombre, resumen, updated_at)",
    "y a continuación el texto de la rama que te toca. **Lo que te imprima ES tu",
    "procedimiento**: no busques otro archivo ni supongas pasos que no estén ahí. Si",
    "no pudo decidir la rama te imprime TODAS y te lo dice por stderr — trabajás",
    "igual, leyendo la que corresponda a esta fila.",
    "",
    "**Guardá ese `updated_at`**: es tu referencia PRE-claim, y si tu rama la usa te",
    "va a decir para qué (el claim lo va a cambiar).",
    "",
    "## Dónde está el resto",
    "",
    "Este archivo es el núcleo: lo que vale para CUALQUIER trabajo. El procedimiento",
    "de cada situación vive aparte, en",
    "`/opt/data/skills/qualiaconta/mesa-de-trabajo/references/`.",
    "",
    "**Vos no elegís la rama a ojo: te la abre `abrir-trabajo.sh`.** Ese script lee",
    "la fila y te imprime, pegado a la salida, el texto de la rama que le",
    "corresponde: eso es tu procedimiento. Si por lo que sea corriste sin él, hacé",
    "`cat` del archivo que corresponda ANTES de tocar la fila; y si no sabés cuál es,",
    "hacé `cat` de todos — trabajar con medio cerebro es peor que leer de más.",
    "",
    "**Y no abras las que no te tocan.** Hermes te lista los archivos de",
    "`references/` al pie de este skill: la tentación es mirarlos. Una rama que no es",
    "la tuya no te dice nada de esta fila y se come el turno.",
    "",
    "**La excepción, y es una sola: si el texto que estás leyendo te MANDA a un",
    "archivo por su nombre, andá.** Un puntero explícito gana sobre esta regla",
    "siempre. Cuando una rama te nombra otro archivo es porque ahí está el",
    "procedimiento que te falta, y quedarte sin él por obediencia es el peor de los",
    "dos errores: preferimos que leas de más antes que que inventes.",
    "",
    "El router NO mira el motivo del webhook: mira el TIPO y el ESTADO reales de la",
    "fila, por lo mismo que dice el protocolo — el motivo es un puntero y la base es",
    "la única verdad. Las reglas se evalúan en orden y gana la primera (`R` es el",
    "número que el propio script te imprime en la cabecera). Todas las rutas son",
    "relativas a `/opt/data/skills/qualiaconta/mesa-de-trabajo/references/`:",
    "",
    "- **R1** `tipo='caso'`, sea cual sea el estado → `rama-caso.md` +",
    "  `ref-clasificacion.md` (el caso también elige documento y cuenta, y abre",
    "  trabajos hijos que necesitan la forma de la propuesta).",
    "- **R2** `tipo='criterio'`, sea cual sea el estado → `rama-criterio.md`",
    "- **R3** `analizando` → nada: la fila la tiene otro turno.",
    "- **R4** `pendiente` pero la última voz del hilo es del humano → NO es un",
    "  análisis nuevo: `rama-accion-usuario.md`",
    "- **R5** `pendiente` → `rama-pendiente.md` + `ref-clasificacion.md`",
    "- **R6** `aprobada` y todavía sin `docid` → `rama-registro-pendiente.md` +",
    "  `ref-registro-adm.md`",
    "- **R7/R8** `registrada`, o `aprobada` con `docid`, y sin entrada de libro →",
    "  `rama-escribir-libro.md`",
    "- **R9/R10** el resto —`propuesta`, `esperando_respuesta`, `rechazada`, `error`,",
    "  o una cerrada en la que el humano volvió a hablar—:",
    "  - **sin `docid`** → `rama-accion-usuario.md` + `rama-pendiente.md` +",
    "    `ref-clasificacion.md`. Manda el primero: qué hacer con lo que dijo el",
    "    humano. Los otros dos son tu biblioteca de procedimiento, porque corregir",
    "    un dato visto es rehacer el análisis, no contestar una pregunta.",
    "  - **con `docid`** → `rama-accion-usuario.md` + `rama-escribir-libro.md`.",
    "    Ya está registrado: no hay propuesta que rehacer ni nada que registrar.",
    "- **R11** cerrada, registrada y con su libro escrito → nada que hacer."
   ]
  },
  {
   "id": 6,
   "cat": "PUNTERO",
   "motivo": "«anda a la rama evento respuesta del accion_usuario» pasa a nombrar el archivo de la rama.",
   "orig": [
    "repetir un análisis que ya fue corregido**: andá a la rama «evento `respuesta`»",
    "del `accion_usuario` y tratá lo que dijo como dato, no arranques de cero. El"
   ],
   "nuevo": [
    "repetir un análisis que ya fue corregido**: pará con esto, leé la otra rama",
    "(`cat /opt/data/skills/qualiaconta/mesa-de-trabajo/references/rama-accion-usuario.md`,",
    "viñeta «evento `respuesta`») y tratá lo que dijo como dato, no arranques de",
    "cero. El"
   ]
  },
  {
   "id": 7,
   "cat": "PUNTERO",
   "motivo": "«mas abajo» pasa a nombrar references/ref-clasificacion.md (cruce de rama).",
   "orig": [
    "  - **La cuenta contable**: seguí la sección «Cómo clasificás la cuenta»",
    "    (más abajo — aplica CON y SIN dossier)."
   ],
   "nuevo": [
    "  - **La cuenta contable**: seguí la sección «Cómo clasificás la cuenta» de",
    "    `references/ref-clasificacion.md` (aplica CON y SIN dossier)."
   ]
  },
  {
   "id": 8,
   "cat": "PUNTERO",
   "motivo": "«pasos 1 y 3 / paso 2» -> «niveles»: el numero de paso apuntaba a la lista de la otra rama.",
   "orig": [
    "**Un solo comando resuelve los pasos 1 y 3 de abajo** (el paso 2, tu memoria"
   ],
   "nuevo": [
    "**Un solo comando resuelve los niveles 1 y 3 de abajo** (el nivel 2, tu memoria"
   ]
  },
  {
   "id": 9,
   "cat": "PUNTERO",
   "motivo": "«la conversion de HEIC del paso 3» -> «la conversion de HEIC»: el paso 3 vive en otra rama.",
   "orig": [
    "La prohibición es para CONSULTAR LOS AGG y nada más: la conversión de HEIC del",
    "paso 3 (`uv run --with pillow-heif python -c ...`) sigue igual de válida —"
   ],
   "nuevo": [
    "La prohibición es para CONSULTAR LOS AGG y nada más: la conversión de HEIC",
    "(`uv run --with pillow-heif python -c ...`) sigue igual de válida —"
   ]
  },
  {
   "id": 10,
   "cat": "PUNTERO",
   "motivo": "«El paso 6 del protocolo completo» -> «El paso <<Busca precedente>>»: el numero vivia en otra rama.",
   "orig": [
    "El paso 6 del protocolo completo usa ESTA misma jerarquía:"
   ],
   "nuevo": [
    "El paso «Buscá precedente» del protocolo completo (`references/rama-pendiente.md`)",
    "usa ESTA misma jerarquía:"
   ]
  },
  {
   "id": 11,
   "cat": "PUNTERO",
   "motivo": "«la REGLA DURA del borrador» -> cita nominal a la regla, ya promovida al nucleo (cruce 4 del plan).",
   "orig": [
    "   la REGLA DURA del borrador**: este agg NO es memoria en borrador — es"
   ],
   "nuevo": [
    "   la «REGLA DURA — un borrador no es precedente» del núcleo**: este agg NO es",
    "   memoria en borrador — es"
   ]
  },
  {
   "id": 12,
   "cat": "PUNTERO",
   "motivo": "«el script de arriba» -> buscar-precedente.py por nombre.",
   "orig": [
    "   Lo resuelve el script de arriba — por nombre o por RNC, da igual:"
   ],
   "nuevo": [
    "   Lo resuelve `buscar-precedente.py` — por nombre o por RNC, da igual:"
   ]
  },
  {
   "id": 14,
   "cat": "PUNTERO",
   "motivo": "«el comando de la seccion Como clasificas la cuenta» -> nombra el script y el archivo de la referencia.",
   "orig": [
    "6. **Buscá precedente** — primero el comando de la sección «Cómo clasificás",
    "   la cuenta» (`buscar-precedente.py`, nunca `python3 -c`), y después"
   ],
   "nuevo": [
    "6. **Buscá precedente** — primero `buscar-precedente.py` (nunca `python3 -c`),",
    "   con la jerarquía de «Cómo clasificás la cuenta» de",
    "   `references/ref-clasificacion.md`, y después"
   ]
  },
  {
   "id": 17,
   "cat": "PROMOVIDO",
   "motivo": "Bloque del libro de accion promovido al nucleo: mismo texto, sin la sangria de 2 espacios (el H2 que lo encabeza va en el hunk de arriba, pegado al final de rama-accion-usuario.md).",
   "orig": [
    "  Escribí la entrada en tu libro de acción — archivo NUEVO en",
    "  `libro-de-accion/` (append-only, jamás editar uno existente), con **Aprobó:**",
    "  el `aprobado_por_nombre` de la fila, «por la mesa web», y su **Alcance**.",
    "  Espejala en la tabla para la vista web:"
   ],
   "nuevo": [
    "Escribí la entrada en tu libro de acción — archivo NUEVO en",
    "`libro-de-accion/` (append-only, jamás editar uno existente), con **Aprobó:**",
    "el `aprobado_por_nombre` de la fila, «por la mesa web», y su **Alcance**.",
    "Espejala en la tabla para la vista web:"
   ]
  },
  {
   "id": 18,
   "cat": "PROMOVIDO",
   "motivo": "Cierre del bloque del libro de accion, promovido al nucleo: mismo texto sin sangria.",
   "orig": [
    "  Si la decisión trae Alcance, actualizá tu memoria curada (proveedores.md /",
    "  criterios.md) para no volver a preguntar lo mismo."
   ],
   "nuevo": [
    "Si la decisión trae Alcance, actualizá tu memoria curada (proveedores.md /",
    "criterios.md) para no volver a preguntar lo mismo."
   ]
  },
  {
   "id": 19,
   "cat": "PUNTERO",
   "motivo": "«el padron del 5c» -> «el padron de RNC de DGII» (cruce 2 del plan).",
   "orig": [
    "  `rnc_emisor.razon_social` del dossier, o la consulta al padrón del §5c"
   ],
   "nuevo": [
    "  `rnc_emisor.razon_social` del dossier, o la consulta al padrón de RNC de DGII"
   ]
  },
  {
   "id": 20,
   "cat": "PUNTERO",
   "motivo": "«Esta rama NO aplica si el trabajo es tipo criterio» -> lo resuelve abrir-trabajo.sh cortando por motivo Y tipo, y la frase de qué no puede hacer un criterio rechazado se mudo a references/rama-criterio.md (2a tanda).",
   "orig": [
    "  nada. **Esta rama NO aplica si el trabajo es tipo `criterio`** — ese caso lo",
    "  manda la sección «Si el trabajo es tipo `criterio`», y un criterio rechazado",
    "  JAMÁS engendra otro criterio: se muerde la cola."
   ],
   "nuevo": [
    "  nada. **Si el trabajo es tipo `criterio` no estás en este archivo** —",
    "  `abrir-trabajo.sh` corta por motivo Y tipo y te habría dado",
    "  `references/rama-criterio.md`, que es donde vive lo que un criterio rechazado",
    "  no puede hacer."
   ]
  },
  {
   "id": 21,
   "cat": "PUNTERO",
   "motivo": "«el mismo insert de la rama aprobada» -> nombra la seccion del nucleo.",
   "orig": [
    "3. Espejalo en `qualia_libro` (el mismo `insert` de la rama `aprobada`)."
   ],
   "nuevo": [
    "3. Espejalo en `qualia_libro` con el `insert` de «El libro de acción — cómo se",
    "   escribe una entrada» (está en el núcleo, siempre inyectado)."
   ]
  },
  {
   "id": 22,
   "cat": "PUNTERO",
   "motivo": "«la regla dura de mas arriba» -> nombra la REGLA DURA y su archivo (cruce 3 del plan).",
   "orig": [
    "   adivinar. Eso NO se resuelve reintentando — se resuelve preguntando (ver la",
    "   regla dura de más arriba)."
   ],
   "nuevo": [
    "   adivinar. Eso NO se resuelve reintentando — se resuelve preguntando (ver",
    "   «REGLA DURA: un documento de ADM es «el tuyo» solo si podés PROBARLO» en",
    "   `references/ref-registro-adm.md`)."
   ]
  },
  {
   "id": 23,
   "cat": "PUNTERO",
   "motivo": "«la seccion de arriba» -> nombra la seccion y su archivo (cruce 3 del plan).",
   "orig": [
    "   los registrás vos, con todos los cuidados de la sección de arriba."
   ],
   "nuevo": [
    "   los registrás vos, con todos los cuidados de «Cargo bancario, transferencia",
    "   o asiento: sin NCF no hay red contra el doble registro», en",
    "   `references/ref-registro-adm.md`."
   ]
  },
  {
   "id": 24,
   "cat": "PUNTERO",
   "motivo": "«lo mismo que en la rama aprobada de accion_usuario» -> nombra references/ref-registro-adm.md.",
   "orig": [
    "Hacé exactamente lo mismo que en la rama `aprobada` de `accion_usuario`: leé la",
    "fila, registrá en ADM con el script, subí el adjunto, escribí el libro y cerrá",
    "la fila. Dos cuidados propios de un reintento:"
   ],
   "nuevo": [
    "Hacé exactamente lo que dice `references/ref-registro-adm.md` —",
    "`abrir-trabajo.sh` te lo imprimió junto con este archivo; si no lo ves, hacele",
    "`cat`—: leé la fila, registrá en ADM con el script, subí el adjunto, escribí el",
    "libro (el `insert` está en el núcleo) y cerrá la fila. Dos cuidados propios de",
    "un reintento:"
   ]
  },
  {
   "id": 25,
   "cat": "PUNTERO",
   "motivo": "«la regla dura de arriba» -> nombra la REGLA DURA y su archivo.",
   "orig": [
    "  preguntá y dejá la fila en `esperando_respuesta`. Ver la regla dura de arriba",
    "  — se saltó una vez y costó el `CB00000169` duplicado."
   ],
   "nuevo": [
    "  preguntá y dejá la fila en `esperando_respuesta`. Ver «REGLA DURA: un",
    "  documento de ADM es «el tuyo» solo si podés PROBARLO» en",
    "  `references/ref-registro-adm.md` — se saltó una vez y costó el `CB00000169`",
    "  duplicado."
   ]
  },
  {
   "id": 26,
   "cat": "PUNTERO",
   "motivo": "Saca el «mas abajo» de una referencia que ya es intra-archivo.",
   "orig": [
    "transición es EXCLUSIVA del humano — ver «Nunca cerrás el caso vos» más abajo."
   ],
   "nuevo": [
    "transición es EXCLUSIVA del humano — ver «Nunca cerrás el caso vos»."
   ]
  },
  {
   "id": 29,
   "cat": "PUNTERO",
   "motivo": "Nombra ref-clasificacion.md para las dos secciones citadas y para la tabla de contrapartidas.",
   "orig": [
    "esto», se clasifica la cuenta con «Cómo clasificás la cuenta», se arman las",
    "`lineas` con la misma forma según el tipo elegido. Lo que cambia es el origen"
   ],
   "nuevo": [
    "esto» y se clasifica la cuenta con «Cómo clasificás la cuenta» — las dos",
    "secciones están en `references/ref-clasificacion.md`, que `abrir-trabajo.sh` te",
    "imprimió junto con este archivo (si no lo ves, hacele `cat`). Las `lineas` van",
    "con la forma que la tabla de contrapartidas de ese mismo archivo le asigna al",
    "tipo que elegiste. Lo que cambia es el origen"
   ]
  },
  {
   "id": 30,
   "cat": "PUNTERO",
   "motivo": "«la rama evento respuesta» -> nombra references/rama-accion-usuario.md.",
   "orig": [
    "mecánica general de la rama evento `respuesta`: retomás el análisis con lo"
   ],
   "nuevo": [
    "mecánica general de la viñeta evento `respuesta` de",
    "`references/rama-accion-usuario.md` (hacele `cat`): retomás el análisis con lo"
   ]
  },
  {
   "id": 31,
   "cat": "PUNTERO",
   "motivo": "«regla dura de la seccion de criterios de arriba» -> cita nominal a la regla ya promovida al nucleo (cruce 4 del plan).",
   "orig": [
    "- La memoria con `estado: borrador` no es precedente: regla dura de la",
    "  seccion de criterios de arriba. Aplica en TODO analisis, no solo en los",
    "  trabajos tipo `criterio`."
   ],
   "nuevo": [
    "- La memoria con `estado: borrador` no es precedente: ver la **REGLA DURA — un",
    "  borrador no es precedente** de este mismo archivo. Aplica en TODO analisis,",
    "  no solo en los trabajos tipo `criterio`."
   ]
  },
  {
   "id": 32,
   "cat": "PUNTERO",
   "motivo": "El aviso corto que da el dossier del preparador nombra al núcleo como fuente del tono.",
   "orig": [
    "  hablado, con el tono de la sección «Cómo le hablás al humano»."
   ],
   "nuevo": [
    "  hablado, con el tono de la sección «Cómo le hablás al humano» (núcleo)."
   ]
  },
  {
   "id": 34,
   "cat": "PUNTERO",
   "motivo": "Misma cita «Qué documento de ADM es esto», nombrando esta vez el archivo desde ref-registro-adm.md.",
   "orig": [
    "  decidiste con «Qué documento de ADM es esto», y ahí el NCF no jugó — es regla"
   ],
   "nuevo": [
    "  decidiste con «Qué documento de ADM es esto» (`references/ref-clasificacion.md`),",
    "  y ahí el NCF no jugó — es regla"
   ]
  },
  {
   "id": 35,
   "cat": "PUNTERO",
   "motivo": "Aclara que la regla «si te escribió, contestale a él primero» vive en el núcleo, no en esta rama.",
   "orig": [
    "  vas a hacer con eso (regla «si te escribió, contestale a él primero»). Un"
   ],
   "nuevo": [
    "  vas a hacer con eso (regla «si te escribió, contestale a él primero», núcleo). Un"
   ]
  },
  {
   "id": 36,
   "cat": "PUNTERO",
   "motivo": "El encabezado que contrasta con la rama pendiente nombra el archivo donde vive esa rama.",
   "orig": [
    "### Por qué «Si está `pendiente`: analizalo» no aplica acá"
   ],
   "nuevo": [
    "### Por qué «Si está `pendiente`: analizalo» (`references/rama-pendiente.md`) no aplica acá"
   ]
  },
  {
   "id": 37,
   "cat": "PUNTERO",
   "motivo": "«Cómo le hablás al humano» (rama caso) nombra al núcleo como su fuente, igual que en rama-pendiente.md.",
   "orig": [
    "al humano», nombrando qué trabajo(s) abriste. Abrir los trabajos no aprueba la"
   ],
   "nuevo": [
    "al humano» (núcleo), nombrando qué trabajo(s) abriste. Abrir los trabajos no aprueba la"
   ]
  },
  {
   "id": 38,
   "cat": "PROMOVIDO",
   "motivo": "Bloque GASTO NO ADMITIDO promovido al núcleo, y ahora el guard de escribir en qualia_libro por trabajo_id ANTES de escribir (3a tanda) queda pegado justo abajo, sin ancla entre medio.",
   "orig": [
    "     Y si al aprobarla ves en el hilo una nota que dice **GASTO NO ADMITIDO**,",
    "     respetalo: al escribir el libro, el ITBIS no se toma como crédito fiscal."
   ],
   "nuevo": [
    "Y si al aprobarla ves en el hilo una nota que dice **GASTO NO ADMITIDO**,",
    "respetalo: al escribir el libro, el ITBIS no se toma como crédito fiscal.",
    "",
    "**Antes de escribir, revisá `qualia_libro` por `trabajo_id`: el libro es",
    "append-only y puede que ya lo hayas hecho.** Vale para los cuatro caminos que",
    "escriben libro, no sólo para la rama que lo dice. Los barridos del poller",
    "re-despiertan la misma fila cada pocos minutos durante horas hasta ver su",
    "entrada, así que sin este chequeo la duplicación no es un accidente raro: es lo",
    "que pasa. Y cada entrada del libro es precedente de primera clase — duplicarla",
    "no ensucia una tabla, ensucia lo que el contable va a citar mañana."
   ]
  },
  {
   "id": 39,
   "cat": "PUNTERO",
   "motivo": "El ítem 8 del protocolo («Cerrá con la propuesta») se mudó entero a ref-clasificacion.md: lo necesitan tres ramas que rehacen o crean propuestas (pendiente, caso y accion_usuario sin docid), y sólo rama-pendiente.md lo tenía. Acá queda como puntero de 4 líneas; la numeración 1-9 del protocolo no se podía romper. El hunk real se come también «¿Te falta algo para decidir?» (antes id15, de SKILL.md) porque queda pegada sin ancla entre medio; se fusiona acá.",
   "orig": [
    "8. **Cerrá con la propuesta** (jsonb con la forma del contrato) y el `resumen`.",
    "   Ejemplo COMPLETO y coherente (VendorBills en forma de items, aritmética que",
    "   cuadra: 38,305.08 + 6,894.92 = 45,200.00):",
    "",
    "```sql",
    "update qualia_trabajos",
    "   set estado='propuesta',",
    "       resumen='Factura Isla Dominicana — RD$45,200 combustible flotilla',",
    "       propuesta='{\"proveedor\":\"Isla Dominicana De Petroleo Corporation\",\"rnc\":\"101008172\",\"ncf\":\"E310000012345\",\"fecha\":\"2026-08-01\",\"moneda\":\"DOP\",\"monto\":45200.00,\"itbis\":6894.92,\"tipo_gasto\":{\"codigo\":\"02\",\"nombre\":\"Gastos por Trabajos, Suministros y Servicios\"},\"documento_adm\":\"VendorBills\",\"lineas\":[{\"descripcion\":\"Gasoil flotilla\",\"cantidad\":1,\"precio\":38305.08,\"grupo_impuesto\":\"ITBIS\",\"itbis\":6894.92,\"cuenta\":\"620.11\",\"cuenta_nombre\":\"Combustible\"}],\"metodo\":\"precedente\",\"precedente_ref\":\"agg:proveedor-cuentas.json#101008172\",\"confianza\":0.95,\"detalle\":\"Combustible de flotilla. Cuenta 620.11 por precedente: 94 de 96 usos de cuenta sobre 96 facturas históricas de este proveedor.\"}'::jsonb",
    " where id='<trabajo_id>' and empresa_id='$QUALIA_EMPRESA_ID' and estado='analizando';",
    "```",
    "",
    "   **`tipo_gasto` es OBLIGATORIO en toda factura** y es un eje DISTINTO de la",
    "   cuenta contable — no los confundas:",
    "",
    "   - **Tipo de gasto** = la clasificación DGII del **606**, catálogo fijo 01-11,",
    "     **UNA por documento**. Es lo que ADM pide en la cabecera de la factura.",
    "     Forma: `\"tipo_gasto\":{\"codigo\":\"05\",\"nombre\":\"Gastos de Representación\"}`.",
    "   - **Cuenta contable** = dónde impacta el asiento, **por renglón**.",
    "",
    "   Un restaurante ilustra los dos a la vez: tipo de gasto **05 Representación**",
    "   para toda la factura, y por renglón la cuenta **611.17 Dieta y Viáticos** para",
    "   el consumo más **690.06 Propina Legal** para la propina.",
    "",
    "   El tipo de gasto sale del MISMO precedente que la cuenta, y de hecho es el",
    "   más firme de los dos: `buscar-precedente.py` te lo imprime como",
    "   `TIPO DE GASTO 606:` — 40 suplidores tienen uno citable (con 3 facturas o",
    "   más), y esos 40 cubren el 85% de las facturas del histórico. Sin",
    "   precedente, elegilo del catálogo con `--tipos` por la naturaleza del",
    "   documento.",
    "",
    "   **NO pongas `cuenta_destino`**: se retiró del contrato el 2026-08-02. La",
    "   factura no tiene UNA cuenta — la tiene cada renglón, en `lineas[].cuenta`.",
    "   Si los renglones van todos a la misma cuenta, igual va en cada renglón; y si",
    "   uno contradice la naturaleza de los demás (un mueble, un equipo), ese va a la",
    "   suya y está bien que la factura quede con cuentas mezcladas. La única que",
    "   lleva cuenta de cabecera es la sugerencia de cargo bancario, en",
    "   `cuenta_contable`.",
    "",
    "   **Las `lineas`, por tipo de documento** — obligatorias en toda propuesta;",
    "   su forma depende de `documento_adm` (VendorBills | BillPayments | BankCharges",
    "   | BankBankTransfers | Journals — son CINCO, y el tipo lo elegiste con las",
    "   preguntas de «Qué documento de ADM es esto»), imitando la pantalla REAL de ADM:",
    "",
    "   - **VendorBills (facturas de proveedor): lineas de ITEMS**, como la pestaña",
    "     \"Articulos y Servicios\" de ADM.",
    "",
    "     **REGLA QUE NO SE ROMPE: TODO renglon que sume al total va como item, con",
    "     su propia cuenta contable.** No solo los productos/servicios: tambien la",
    "     **propina legal del 10%** (restaurantes, Ley 16-92), recargos por servicio,",
    "     impuesto selectivo al consumo, tasas, seguros, gastos administrativos,",
    "     cargos varios y **cualquier impuesto adicional, sean los que sean**. Cada",
    "     uno es una linea propia porque cada uno se clasifica distinto — nunca los",
    "     sumes al precio de otro renglon ni los omitas.",
    "",
    "     **La suma de items DEBE dar el total del documento.** Antes de cerrar la",
    "     propuesta, verificalo vos: `sum(precio*cantidad) + sum(itbis)` contra",
    "     `monto`, con el MISMO umbral que valida la web: diferencia < 0.05.",
    "     Si no cuadra, te falta un renglon (casi siempre la propina legal o un",
    "     impuesto): en el protocolo completo (sin dossier) volve al documento y",
    "     encontralo; si venis del dossier del preparador, aplica SU regla —",
    "     patron conocido → renglon inferido; sin patron → pregunta al humano con",
    "     la diferencia exacta, sin releer. NO cierres una propuesta que no cuadra",
    "     — la web la marca en rojo y no sirve para registrar.",
    "",
    "     **Que sume NO alcanza.** Esa verificación la podés hacer pasar siempre:",
    "     con la cabecera sola (total + ITBIS) elegís la base y el resto lo mandás a",
    "     un renglón exento, y da. Por eso, si alguna línea quedó exenta, revisá",
    "     ANTES de cerrar que ese exento salga del papel y no de la resta: probá las",
    "     otras tasas legales (`base = itbis/tasa`) y mirá si alguna cierra con",
    "     exento CERO. Si alguna cierra sola, esa es la tasa buena y la tuya está",
    "     mal. El script de registro tiene el mismo chequeo y te va a frenar ahí",
    "     (`verificar_cuadre`), pero para entonces el humano ya aprobó algo falso.",
    "",
    "     Ejemplo restaurante (asi debe quedar): items de comida con su ITBIS + una",
    "     linea \"Propina legal 10%\" con su precio y `itbis: 0` (la propina no se",
    "     grava) y la cuenta que corresponda. Cada item:",
    "     `{\"descripcion\":\"FLETE AEREO PRIORITY\",\"cantidad\":1,\"precio\":429.41,\"grupo_impuesto\":\"ITBIS\",\"itbis\":77.29,\"cuenta\":\"620.10\",\"cuenta_nombre\":\"Envios y Correspondencias\"}`",
    "     — un item por renglon del documento (si la factura desglosa flete, airport",
    "     fee, combustible, DGA, van SEPARADOS, no sumados); `precio` sin ITBIS;",
    "     `grupo_impuesto` \"ITBIS\" o \"Exento\"; `cuenta` = la clasificacion contable",
    "     de ESE item (pueden diferir entre items). La web muestra Subtotal =",
    "     suma(precio*cantidad), Impuesto = suma(itbis) y Total, y valida que",
    "     cuadren con `monto`/`itbis` de la propuesta.",
    "   - **Journals / BankCharges / BankBankTransfers: partida doble**. Cada linea",
    "     `{\"cuenta\",\"cuenta_nombre\",\"descripcion\",\"debito\",\"credito\"}` con cuentas",
    "     EXACTAS del plan; total debitos = total creditos (la web lo marca en rojo",
    "     si no cuadra); el ITBIS aprovechable como linea propia.",
    "",
    "   Estas lineas seran el payload del registro real cuando la escritura se",
    "   encienda: escribilas como si ya estuvieras llenando la pantalla de ADM.",
    "",
    "   ¿Te falta algo para decidir? Preguntá y esperá:"
   ],
   "nuevo": [
    "8. **Cerrá con la propuesta** — la forma del contrato NO está en este archivo:",
    "   vive en `references/ref-clasificacion.md`, que `abrir-trabajo.sh` te imprime",
    "   pegado a éste. Ahí está el ejemplo completo, el `tipo_gasto` obligatorio, el",
    "   cuadre de los ítems y por qué «que sume NO alcanza».",
    "¿Te falta algo para decidir? Preguntá y esperá:"
   ]
  },
  {
   "id": 40,
   "cat": "SECCION_NUEVA",
   "motivo": "Dos secciones nuevas instaladas al final de ref-clasificacion.md, verbatim, en el mismo insert (sin ancla entre medio): «La aritmética del documento — antes de repartir nada» (el bloque mudado de rama-pendiente.md, 3a tanda) y, debajo, «Cómo se escribe la propuesta — la forma del contrato» (2a tanda, con el párrafo de banco_tx_id agregado encima en esta tanda).",
   "orig": [],
   "nuevo": [
    "",
    "## La aritmética del documento — antes de repartir nada",
    "",
    "Lo lee todo el que escribe o REESCRIBE una propuesta. Vivía dentro del paso del",
    "dossier de `references/rama-pendiente.md`, y ahí la veía sólo el análisis nuevo:",
    "el turno en que el humano corrige un monto —10 de cada 19 correcciones reales—",
    "recibía «probá las otras tasas legales» sin que nadie le dijera cuáles son.",
    "",
    "    **La aritmética correcta** (corrección del dueño, 2026-08-02): el ITBIS es",
    "    un porcentaje de la BASE GRAVADA, JAMÁS del total. La verificación es",
    "    `base + itbis + exentos + propina/cargos == monto`.",
    "",
    "    **La tasa NO se asume: se despeja y se compara.** Son tres las legales —",
    "    18% general, 16% reducida (café, cacao, azúcar, mantequilla, yogurt: art.",
    "    343) y 0%/exento. Probá las que apliquen contra la cabecera: para cada una,",
    "    `base = itbis/tasa` y `exentos = monto - itbis - base`. La lectura buena es",
    "    la que deja `exentos` en CERO, o en renglones que de verdad leíste del",
    "    papel. **Si tenés que inventar un renglón exento para que cierre, esa tasa",
    "    está mal** — probá la otra ANTES de proponer.",
    "",
    "    Pasó el 2026-08-04 con la FP00001120 (Carrefour, café): dividir por 0.18",
    "    dio base 287.33 y dejó 35.90 sueltos, que se fueron a un renglón «Productos",
    "    exentos (no individualizados por el preparador)». Al 16% —la tasa del",
    "    café— la misma cabecera cierra sola: base 323.23, cero exentos. Se registró",
    "    en ADM con un 18% que el papel nunca dijo, reclamando un crédito fiscal de",
    "    más. Un renglón exento que sale de una resta y no del documento es la firma",
    "    de este error: si lo estás escribiendo, pará y probá la otra tasa.",
    "",
    "    **Restaurantes: los cargos son DOS, siempre** (regla del dueño): ITBIS 18%",
    "    + propina legal 10% (Ley 16-92), ambos impresos. Esperalos de ENTRADA como",
    "    estructura del documento — si solo ves uno, el otro existe y está en los",
    "    números; no lo \"descubras\" por descuadre ni lo verifiques dos veces. Que",
    "    `monto != base*1.18` NO es incoherencia — es la anatomía normal (y suele",
    "    haber renglones exentos además).",
    "    **Y si NO cuadra, en este orden (regla del dueño, 2026-08-02: lo obvio se",
    "    resuelve a la primera, sin releer y sin preguntar):**",
    "    1. Si el dossier trae `propina` (capturada o `propina_inferida`: el prep",
    "       ya infiere la propina cuando el descuadre calza exacto con el 10% de",
    "       la base) → proponé DIRECTO con ese renglón, explicándolo en `detalle`.",
    "    2. Si la diferencia calza vos mismo con un patrón conocido de este",
    "       mercado (propina 10% de la base ±1 peso, un ISC de bebidas, un",
    "       recargo impreso) → renglón inferido + explicación en `detalle`, y",
    "       proponé. La aprobación del humano ES la confirmación.",
    "    3. SOLO si la diferencia no calza con ningún patrón: NO reeleas la",
    "       imagen — PREGUNTALE al humano con evento `pregunta` +",
    "       `esperando_respuesta`, con la diferencia exacta y tu mejor hipótesis.",
    "       Él tiene el documento a un click. Con su respuesta, cerrás.",
    "",
    "",
    "## Cómo se escribe la propuesta — la forma del contrato",
    "",
    "**Si la propuesta resuelve un movimiento del banco, `banco_tx_id` va SIEMPRE,",
    "y sobrevive a cada reescritura.** El paso 8 pisa la `propuesta` entera, no la",
    "mezcla: si al corregir no lo volvés a poner, desaparece. Y no es adorno — la",
    "mesa descarta de su lista de movimientos sin conciliar los que algún trabajo ya",
    "reclamó, y ese descarte mira `banco_tx_id`. Sin él, el mismo movimiento vuelve",
    "a Sugerencias mientras su solución ya está propuesta, y la misma plata se",
    "cuenta dos veces.",
    "",
    "Lo lee todo el que ESCRIBE una propuesta: el análisis nuevo, el turno en que el",
    "humano corrige una que ya habías mandado, y el caso cuando abre sus trabajos",
    "hijos. Conserva la numeración del protocolo de `references/rama-pendiente.md`,",
    "que es de donde salió.",
    "",
    "8. **Cerrá con la propuesta** (jsonb con la forma del contrato) y el `resumen`.",
    "   Ejemplo COMPLETO y coherente (VendorBills en forma de items, aritmética que",
    "   cuadra: 38,305.08 + 6,894.92 = 45,200.00):",
    "",
    "```sql",
    "update qualia_trabajos",
    "   set estado='propuesta',",
    "       resumen='Factura Isla Dominicana — RD$45,200 combustible flotilla',",
    "       propuesta='{\"proveedor\":\"Isla Dominicana De Petroleo Corporation\",\"rnc\":\"101008172\",\"ncf\":\"E310000012345\",\"fecha\":\"2026-08-01\",\"moneda\":\"DOP\",\"monto\":45200.00,\"itbis\":6894.92,\"tipo_gasto\":{\"codigo\":\"02\",\"nombre\":\"Gastos por Trabajos, Suministros y Servicios\"},\"documento_adm\":\"VendorBills\",\"lineas\":[{\"descripcion\":\"Gasoil flotilla\",\"cantidad\":1,\"precio\":38305.08,\"grupo_impuesto\":\"ITBIS\",\"itbis\":6894.92,\"cuenta\":\"620.11\",\"cuenta_nombre\":\"Combustible\"}],\"metodo\":\"precedente\",\"precedente_ref\":\"agg:proveedor-cuentas.json#101008172\",\"confianza\":0.95,\"detalle\":\"Combustible de flotilla. Cuenta 620.11 por precedente: 94 de 96 usos de cuenta sobre 96 facturas históricas de este proveedor.\"}'::jsonb",
    " where id='<trabajo_id>' and empresa_id='$QUALIA_EMPRESA_ID' and estado='analizando';",
    "```",
    "",
    "   **`tipo_gasto` es OBLIGATORIO en toda factura** y es un eje DISTINTO de la",
    "   cuenta contable — no los confundas:",
    "",
    "   - **Tipo de gasto** = la clasificación DGII del **606**, catálogo fijo 01-11,",
    "     **UNA por documento**. Es lo que ADM pide en la cabecera de la factura.",
    "     Forma: `\"tipo_gasto\":{\"codigo\":\"05\",\"nombre\":\"Gastos de Representación\"}`.",
    "   - **Cuenta contable** = dónde impacta el asiento, **por renglón**.",
    "",
    "   Un restaurante ilustra los dos a la vez: tipo de gasto **05 Representación**",
    "   para toda la factura, y por renglón la cuenta **611.17 Dieta y Viáticos** para",
    "   el consumo más **690.06 Propina Legal** para la propina.",
    "",
    "   El tipo de gasto sale del MISMO precedente que la cuenta, y de hecho es el",
    "   más firme de los dos: `buscar-precedente.py` te lo imprime como",
    "   `TIPO DE GASTO 606:` — 40 suplidores tienen uno citable (con 3 facturas o",
    "   más), y esos 40 cubren el 85% de las facturas del histórico. Sin",
    "   precedente, elegilo del catálogo con `--tipos` por la naturaleza del",
    "   documento.",
    "",
    "   **NO pongas `cuenta_destino`**: se retiró del contrato el 2026-08-02. La",
    "   factura no tiene UNA cuenta — la tiene cada renglón, en `lineas[].cuenta`.",
    "   Si los renglones van todos a la misma cuenta, igual va en cada renglón; y si",
    "   uno contradice la naturaleza de los demás (un mueble, un equipo), ese va a la",
    "   suya y está bien que la factura quede con cuentas mezcladas. La única que",
    "   lleva cuenta de cabecera es la sugerencia de cargo bancario, en",
    "   `cuenta_contable`.",
    "",
    "   **Las `lineas`, por tipo de documento** — obligatorias en toda propuesta;",
    "   su forma depende de `documento_adm` (VendorBills | BillPayments | BankCharges",
    "   | BankBankTransfers | Journals — son CINCO, y el tipo lo elegiste con las",
    "   preguntas de «Qué documento de ADM es esto»), imitando la pantalla REAL de ADM:",
    "",
    "   - **VendorBills (facturas de proveedor): lineas de ITEMS**, como la pestaña",
    "     \"Articulos y Servicios\" de ADM.",
    "",
    "     **REGLA QUE NO SE ROMPE: TODO renglon que sume al total va como item, con",
    "     su propia cuenta contable.** No solo los productos/servicios: tambien la",
    "     **propina legal del 10%** (restaurantes, Ley 16-92), recargos por servicio,",
    "     impuesto selectivo al consumo, tasas, seguros, gastos administrativos,",
    "     cargos varios y **cualquier impuesto adicional, sean los que sean**. Cada",
    "     uno es una linea propia porque cada uno se clasifica distinto — nunca los",
    "     sumes al precio de otro renglon ni los omitas.",
    "",
    "     **La suma de items DEBE dar el total del documento.** Antes de cerrar la",
    "     propuesta, verificalo vos: `sum(precio*cantidad) + sum(itbis)` contra",
    "     `monto`, con el MISMO umbral que valida la web: diferencia < 0.05.",
    "     Si no cuadra, te falta un renglon (casi siempre la propina legal o un",
    "     impuesto): en el protocolo completo (sin dossier) volve al documento y",
    "     encontralo; si venis del dossier del preparador, aplica SU regla —",
    "     patron conocido → renglon inferido; sin patron → pregunta al humano con",
    "     la diferencia exacta, sin releer. NO cierres una propuesta que no cuadra",
    "     — la web la marca en rojo y no sirve para registrar.",
    "",
    "     **Que sume NO alcanza.** Esa verificación la podés hacer pasar siempre:",
    "     con la cabecera sola (total + ITBIS) elegís la base y el resto lo mandás a",
    "     un renglón exento, y da. Por eso, si alguna línea quedó exenta, revisá",
    "     ANTES de cerrar que ese exento salga del papel y no de la resta: probá las",
    "     otras tasas legales (`base = itbis/tasa`) y mirá si alguna cierra con",
    "     exento CERO. Si alguna cierra sola, esa es la tasa buena y la tuya está",
    "     mal. El script de registro tiene el mismo chequeo y te va a frenar ahí",
    "     (`verificar_cuadre`), pero para entonces el humano ya aprobó algo falso.",
    "",
    "     Ejemplo restaurante (asi debe quedar): items de comida con su ITBIS + una",
    "     linea \"Propina legal 10%\" con su precio y `itbis: 0` (la propina no se",
    "     grava) y la cuenta que corresponda. Cada item:",
    "     `{\"descripcion\":\"FLETE AEREO PRIORITY\",\"cantidad\":1,\"precio\":429.41,\"grupo_impuesto\":\"ITBIS\",\"itbis\":77.29,\"cuenta\":\"620.10\",\"cuenta_nombre\":\"Envios y Correspondencias\"}`",
    "     — un item por renglon del documento (si la factura desglosa flete, airport",
    "     fee, combustible, DGA, van SEPARADOS, no sumados); `precio` sin ITBIS;",
    "     `grupo_impuesto` \"ITBIS\" o \"Exento\"; `cuenta` = la clasificacion contable",
    "     de ESE item (pueden diferir entre items). La web muestra Subtotal =",
    "     suma(precio*cantidad), Impuesto = suma(itbis) y Total, y valida que",
    "     cuadren con `monto`/`itbis` de la propuesta.",
    "   - **Journals / BankCharges / BankBankTransfers: partida doble**. Cada linea",
    "     `{\"cuenta\",\"cuenta_nombre\",\"descripcion\",\"debito\",\"credito\"}` con cuentas",
    "     EXACTAS del plan; total debitos = total creditos (la web lo marca en rojo",
    "     si no cuadra); el ITBIS aprovechable como linea propia.",
    "",
    "   Estas lineas seran el payload del registro real cuando la escritura se",
    "   encienda: escribilas como si ya estuvieras llenando la pantalla de ADM."
   ]
  },
  {
   "id": 41,
   "cat": "PROMOVIDO",
   "motivo": "«y un criterio rechazado JAMÁS engendra otro criterio: se muerde la cola» se mudó de rama-accion-usuario.md a la viñeta `rechazada` de rama-criterio.md: una sesión de criterio nunca ve el otro archivo.",
   "orig": [
    "  preentrenamiento."
   ],
   "nuevo": [
    "  preentrenamiento. Y un criterio rechazado JAMÁS engendra otro criterio: se",
    "  muerde la cola."
   ]
  },
  {
   "id": 42,
   "cat": "PUNTERO",
   "motivo": "«La aritmética correcta»/las tres tasas legales/la regla de los restaurantes (original 166-204) se mudó VERBATIM a ref-clasificacion.md: la necesitan tres ramas que corrigen o rehacen propuestas, y sólo el análisis nuevo la tenía. Queda un puntero de 5 líneas.",
   "orig": [
    "    **La aritmética correcta** (corrección del dueño, 2026-08-02): el ITBIS es",
    "    un porcentaje de la BASE GRAVADA, JAMÁS del total. La verificación es",
    "    `base + itbis + exentos + propina/cargos == monto`.",
    "",
    "    **La tasa NO se asume: se despeja y se compara.** Son tres las legales —",
    "    18% general, 16% reducida (café, cacao, azúcar, mantequilla, yogurt: art.",
    "    343) y 0%/exento. Probá las que apliquen contra la cabecera: para cada una,",
    "    `base = itbis/tasa` y `exentos = monto - itbis - base`. La lectura buena es",
    "    la que deja `exentos` en CERO, o en renglones que de verdad leíste del",
    "    papel. **Si tenés que inventar un renglón exento para que cierre, esa tasa",
    "    está mal** — probá la otra ANTES de proponer.",
    "",
    "    Pasó el 2026-08-04 con la FP00001120 (Carrefour, café): dividir por 0.18",
    "    dio base 287.33 y dejó 35.90 sueltos, que se fueron a un renglón «Productos",
    "    exentos (no individualizados por el preparador)». Al 16% —la tasa del",
    "    café— la misma cabecera cierra sola: base 323.23, cero exentos. Se registró",
    "    en ADM con un 18% que el papel nunca dijo, reclamando un crédito fiscal de",
    "    más. Un renglón exento que sale de una resta y no del documento es la firma",
    "    de este error: si lo estás escribiendo, pará y probá la otra tasa.",
    "",
    "    **Restaurantes: los cargos son DOS, siempre** (regla del dueño): ITBIS 18%",
    "    + propina legal 10% (Ley 16-92), ambos impresos. Esperalos de ENTRADA como",
    "    estructura del documento — si solo ves uno, el otro existe y está en los",
    "    números; no lo \"descubras\" por descuadre ni lo verifiques dos veces. Que",
    "    `monto != base*1.18` NO es incoherencia — es la anatomía normal (y suele",
    "    haber renglones exentos además).",
    "    **Y si NO cuadra, en este orden (regla del dueño, 2026-08-02: lo obvio se",
    "    resuelve a la primera, sin releer y sin preguntar):**",
    "    1. Si el dossier trae `propina` (capturada o `propina_inferida`: el prep",
    "       ya infiere la propina cuando el descuadre calza exacto con el 10% de",
    "       la base) → proponé DIRECTO con ese renglón, explicándolo en `detalle`.",
    "    2. Si la diferencia calza vos mismo con un patrón conocido de este",
    "       mercado (propina 10% de la base ±1 peso, un ISC de bebidas, un",
    "       recargo impreso) → renglón inferido + explicación en `detalle`, y",
    "       proponé. La aprobación del humano ES la confirmación.",
    "    3. SOLO si la diferencia no calza con ningún patrón: NO reeleas la",
    "       imagen — PREGUNTALE al humano con evento `pregunta` +",
    "       `esperando_respuesta`, con la diferencia exacta y tu mejor hipótesis.",
    "       Él tiene el documento a un click. Con su respuesta, cerrás."
   ],
   "nuevo": [
    "    **La aritmética del ITBIS, las tres tasas legales y la regla de los",
    "    restaurantes están en `references/ref-clasificacion.md`**, que",
    "    `abrir-trabajo.sh` te imprime pegado a éste. No las supongas de memoria: el",
    "    16% del art. 343 no es conocimiento general y por no tenerlo se registró la",
    "    FP00001120 con una tasa que el papel nunca dijo."
   ]
  },
  {
   "id": 43,
   "cat": "SECCION_NUEVA",
   "motivo": "Nombra admcloud-get.sh de la skill hermana consultar-admcloud como el medio para verificar en ADM — la REGLA DURA de duplicados ya lo pedía, sin decir cómo (3a tanda).",
   "orig": [],
   "nuevo": [
    "     Para hablarle a la API de ADM usá `admcloud-get.sh` de la skill hermana",
    "     `consultar-admcloud`",
    "     (`/opt/data/skills/qualiaconta/consultar-admcloud/scripts/admcloud-get.sh`):",
    "     trae host, credenciales y pagina solo. Sin él esta regla se cumple de",
    "     mentira — te quedás con el histórico local, que dos renglones más arriba",
    "     se llama a sí mismo «una FOTO vieja»."
   ]
  },
  {
   "id": 44,
   "cat": "SECCION_NUEVA",
   "motivo": "Nombra admcloud-get.sh en rama-caso.md, misma regla que en rama-pendiente.md: el medio para cumplir la REGLA DURA de «verificá en ADM antes de proponer» (3a tanda).",
   "orig": [],
   "nuevo": [
    "**Para verificar en ADM usá `admcloud-get.sh` de la skill hermana",
    "`consultar-admcloud`**",
    "(`/opt/data/skills/qualiaconta/consultar-admcloud/scripts/admcloud-get.sh`).",
    "Una regla dura que ordena verificar, sin el medio para hacerlo, se cumple",
    "mintiendo: así nació el asiento del Caso #1 contra un «Adelanto de Clientes»",
    "que nadie había registrado nunca.",
    ""
   ]
  },
  {
   "id": 45,
   "cat": "PUNTERO",
   "motivo": "La viñeta `aprobada` de rama-accion-usuario.md distingue ahora el caso normal (con docid, no le imprimen ref-registro-adm.md) de la carrera (sin docid, SÍ hay que hacerle `cat` a mano — única excepción a «no abras las que no te tocan») (3a tanda). El hunk real se come también el H2 «## El libro de acción…» de SKILL.md, pegado sin ancla — misma trampa que id16 en tandas anteriores.",
   "orig": [
    "  dice `escribir_libro`."
   ],
   "nuevo": [
    "  dice `references/rama-escribir-libro.md`, que `abrir-trabajo.sh` te imprimió",
    "  pegado a éste. Si NO está, estás en la carrera: el procedimiento de registro es",
    "  `references/ref-registro-adm.md` y NO te lo imprimieron, porque esta rama",
    "  normalmente no registra. **Éste es el único caso en que sí tenés que hacerle",
    "  `cat`** — la regla de «no abras las que no te tocan» (núcleo) no aplica acá.",
    "## El libro de acción — cómo se escribe una entrada"
   ]
  }
 ]
}
""")

MANIFIESTO = DATOS['manifiesto']
PERMITIDOS = DATOS['permitidos']

ROJO, VERDE, AMAR, GRIS, FIN = '\033[31m', '\033[32m', '\033[33m', '\033[90m', '\033[0m'
if not sys.stdout.isatty():
    ROJO = VERDE = AMAR = GRIS = FIN = ''

fallos = []
def fallar(titulo, cuerpo=''):
    fallos.append((titulo, cuerpo))

def leer(p):
    with open(p, encoding='utf-8') as fh:
        return fh.read().split('\n')

orig = leer(ORIGINAL)
archivos = {}
for _, _, f, _, _ in MANIFIESTO:
    if f not in archivos:
        archivos[f] = leer(os.path.join(SKILLDIR, f))

# archivos de references/ que existen pero que el manifiesto no menciona:
# serían texto nuevo que nadie está verificando.
en_disco = sorted('references/' + n for n in os.listdir(os.path.join(SKILLDIR, 'references'))
                  if n.endswith('.md'))
huerfanos = [f for f in en_disco if f not in archivos]
if huerfanos:
    fallar('Archivos de references/ que el manifiesto no cubre',
           '\n'.join('  ' + f for f in huerfanos))

print(f'{GRIS}original :{FIN} {ORIGINAL}  ({len(orig)-1} líneas, {sum(len(l)+1 for l in orig[:-1])} chars)')
print(f'{GRIS}corte    :{FIN} {SKILLDIR}')
print(f'{GRIS}archivos :{FIN} ' + ', '.join(sorted(archivos)))
print()

# ---------------------------------------------------------------------------
# 1. El manifiesto tiene que cubrir el original entero, sin huecos ni solapes.
# ---------------------------------------------------------------------------
esperado = 1
for desde, hasta, f, _, _ in MANIFIESTO:
    if desde != esperado:
        fallar('El manifiesto no cubre el original de corrido',
               f'  esperaba la línea {esperado}, el tramo de {f} empieza en {desde}')
    esperado = hasta + 1
if esperado - 1 != len(orig):
    fallar('El manifiesto no llega al final del original',
           f'  cubre hasta la línea {esperado-1}, el original tiene {len(orig)}')

# ---------------------------------------------------------------------------
# 2. Reensamblado.
# ---------------------------------------------------------------------------
recon = []
usadas = {f: set() for f in archivos}
for desde, hasta, f, a, b in MANIFIESTO:
    recon += archivos[f][a-1:b]
    usadas[f].update(range(a, b+1))

# ---------------------------------------------------------------------------
# 3. Ninguna línea de los archivos nuevos puede quedar fuera del reensamblado
#    salvo el H1 de cada rama y las líneas en blanco que separan tramos. Sin
#    este control se podría esconder texto agregado simplemente no citándolo
#    en el manifiesto.
# ---------------------------------------------------------------------------
h1_vistos = []
sobrantes = []
for f in sorted(archivos):
    for i, linea in enumerate(archivos[f], 1):
        if i in usadas[f]:
            continue
        if i == 1 and linea.startswith('# ') and f.startswith('references/'):
            h1_vistos.append((f, linea))
            continue
        if linea.strip() == '':
            continue          # blanco separador entre tramos contiguos
        sobrantes.append((f, i, linea))
if sobrantes:
    fallar('Líneas de los archivos nuevos que el reensamblado no usa '
           '(texto agregado sin verificar)',
           '\n'.join(f'  {f}:{i}  {l}' for f, i, l in sobrantes))

# ---------------------------------------------------------------------------
# 4. Diff contra el original y clasificación de cada diferencia.
# ---------------------------------------------------------------------------
sm = difflib.SequenceMatcher(None, orig, recon, autojunk=False)
hunks = [(orig[i1:i2], recon[j1:j2], i1+1, i2)
         for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag != 'equal']

pendientes = list(PERMITIDOS)
casados, intrusos = [], []
for viejo, nuevo, li, lf in hunks:
    for p in pendientes:
        if p['orig'] == viejo and p['nuevo'] == nuevo:
            casados.append((p, li, lf))
            pendientes.remove(p)
            break
    else:
        intrusos.append((viejo, nuevo, li, lf))

# ---------------------------------------------------------------------------
# 5. Control independiente del manifiesto: toda línea con contenido del
#    original tiene que existir literal en algún archivo nuevo, o estar en el
#    lado viejo de una diferencia permitida. Detecta pérdida aunque el
#    manifiesto esté mal escrito.
# ---------------------------------------------------------------------------
corpus = set()
for f in archivos:
    corpus.update(archivos[f])
tolerado = set()
for p in PERMITIDOS:
    tolerado.update(p['orig'])
perdidas = [(i, l) for i, l in enumerate(orig, 1)
            if l.strip() and l not in corpus and l not in tolerado]

# ---------------------------------------------------------------------------
# 6. Cuentas.
# ---------------------------------------------------------------------------
def chars(ls):
    return sum(len(l) + 1 for l in ls[:-1]) if ls and ls[-1] == '' else sum(len(l) + 1 for l in ls)

c_orig = chars(orig)
c_recon = chars(recon)
c_corte = sum(chars(archivos[f]) for f in archivos)

# ---------------------------------------------------------------------------
# Informe.
# ---------------------------------------------------------------------------
print('=' * 78)
print('DIFERENCIAS ACEPTADAS')
print('=' * 78)
for f, h1 in h1_vistos:
    print(f'  {VERDE}[H1]{FIN}            {f}')
    print(f'                  + {h1}')
por_cat = {}
for p, li, lf in casados:
    por_cat.setdefault(p['cat'], []).append((p, li, lf))
for cat in ('SECCION_NUEVA', 'PROMOVIDO', 'PUNTERO'):
    for p, li, lf in por_cat.get(cat, []):
        print(f'  {VERDE}[{cat}]{FIN} orig:{li}-{lf}  {p["motivo"]}')
        for l in p['orig'][:2]:
            print(f'{GRIS}                  - {l[:100]}{FIN}')
        if len(p['orig']) > 2:
            print(f'{GRIS}                    … {len(p["orig"])-2} línea(s) más{FIN}')
        for l in p['nuevo'][:2]:
            print(f'{GRIS}                  + {l[:100]}{FIN}')
        if len(p['nuevo']) > 2:
            print(f'{GRIS}                    … {len(p["nuevo"])-2} línea(s) más{FIN}')
print(f'\n  {len(h1_vistos)} H1 + {len(casados)} diferencias permitidas '
      f'(de {len(PERMITIDOS)} declaradas).')

if pendientes:
    fallar('Diferencias declaradas en la lista blanca que YA NO aparecen '
           '(la lista quedó vieja, o el corte cambió)',
           '\n'.join(f'  [{p["cat"]}] #{p["id"]}  '
                     f'{(p["orig"][0] if p["orig"] else "(insert puro, sin orig) " + p["nuevo"][0])[:90]}'
                     for p in pendientes))

if intrusos:
    cuerpo = []
    for viejo, nuevo, li, lf in intrusos:
        cuerpo.append(f'  --- original línea {li}-{lf} '
                      f'({len(viejo)} línea(s) fuera, {len(nuevo)} adentro)')
        for l in viejo:
            cuerpo.append(f'    - {l}')
        for l in nuevo:
            cuerpo.append(f'    + {l}')
        cuerpo.append('')
    fallar('Diferencias NO permitidas (texto perdido o reescrito)', '\n'.join(cuerpo))

if perdidas:
    fallar('Líneas del original que no existen literal en ningún archivo nuevo',
           '\n'.join(f'  {i:5d}| {l}' for i, l in perdidas))

print()
print('=' * 78)
print('CUENTAS')
print('=' * 78)
print(f'  original                : {c_orig:>8,} chars   {len(orig)-1:>5} líneas')
print(f'  reensamblado            : {c_recon:>8,} chars   {len(recon)-1:>5} líneas')
d = c_recon - c_orig
print(f'  diferencia              : {d:>+8,} chars   '
      f'{(len(recon)-len(orig)):>+5} líneas   (todo lo agregado por el corte)')
print(f'  suma de los archivos    : {c_corte:>8,} chars '
      f'(incluye los H1 y los blancos separadores)')
print()

if fallos:
    print('=' * 78)
    print(f'{ROJO}FALLA{FIN}')
    print('=' * 78)
    for titulo, cuerpo in fallos:
        print(f'{ROJO}✗ {titulo}{FIN}')
        if cuerpo:
            print(cuerpo)
        print()
    print(f'{ROJO}El corte NO reconstruye el original. {len(fallos)} problema(s).{FIN}')
    sys.exit(1)

print(f'{VERDE}✓ El corte reconstruye el original byte a byte, salvo las '
      f'diferencias listadas arriba.{FIN}')
sys.exit(0)
PYEOF
