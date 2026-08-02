#!/usr/bin/env bash
# Registra una corrida nocturna en qualia_actualizaciones (la Supabase de
# Labs_Inv), para que se vea desde la web en Configuracion > Bancos >
# QualiaConta. Hasta ahora estas corridas solo dejaban rastro en un log del
# disco de esta maquina, que nadie mira.
#
# Por que asi: los scripts de la mesa corren en el HOST y no tienen
# credenciales de la base; el sidecar del poller si las trae en su entorno
# (QUALIA_DSN y QUALIA_EMPRESA_ID). Es el mismo camino que ya usa
# respaldo-documentos.sh para leer qualia_trabajos.
#
# Uso: registrar-corrida.sh TAREA INICIO_ISO FIN_ISO OK FALLAS RESUMEN_JSON ARCHIVO_DETALLE
#      OK es 'true' o 'false' (literal SQL).
#
# Nunca hace fallar a quien lo llama: la corrida ya ocurrio, y perder su
# bitacora no debe convertirse en un fallo del trabajo real.

set -u

CONTENEDOR_MESA="${CONTENEDOR_MESA:-qualiaconta-mesa-blackbox}"
TOPE_DETALLE=100000   # 100 KB: mas que eso no aporta y engorda la fila

tarea="${1:?falta tarea}"
inicio="${2:?falta inicio}"
fin="${3:?falta fin}"
ok="${4:?falta ok}"
fallas="${5:-0}"
resumen="${6:-{\}}"
detalle_archivo="${7:-/dev/null}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTENEDOR_MESA"; then
    echo "[registrar-corrida] $CONTENEDOR_MESA no esta corriendo, no registro nada" >&2
    exit 0
fi

detalle=$(tail -c "$TOPE_DETALLE" "$detalle_archivo" 2>/dev/null || true)

# El detalle y el resumen van con dollar-quoting: son texto multilinea con
# comillas y simbolos. empresa_id sale del entorno del contenedor, no del host.
if ! docker exec -i "$CONTENEDOR_MESA" sh -c \
        'psql "$QUALIA_DSN" -v ON_ERROR_STOP=1 -v empresa="$QUALIA_EMPRESA_ID" -q -f -' <<SQL 2>/dev/null
insert into public.qualia_actualizaciones
    (empresa_id, tarea, inicio, fin, ok, fallas, resumen, detalle)
values
    (:'empresa'::uuid, '${tarea}', '${inicio}'::timestamptz, '${fin}'::timestamptz,
     ${ok}, ${fallas}, \$json\$${resumen}\$json\$::jsonb, \$detalle\$${detalle}\$detalle\$)
on conflict (empresa_id, tarea, inicio) do update
    set fin = excluded.fin, ok = excluded.ok, fallas = excluded.fallas,
        resumen = excluded.resumen, detalle = excluded.detalle;
SQL
then
    echo "[registrar-corrida] no pude registrar la corrida de $tarea" >&2
fi

exit 0
