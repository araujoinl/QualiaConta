#!/bin/bash
# Facturas recurrentes — cron --no-agent del gateway Hermes. CERO tokens.
#
# Reporta el ESTADO del mes de cada proveedor que factura todos los meses: la que
# llegó y la que no. Antes sólo emitía las ausencias, y por eso la caja no podía
# contestar «¿y las demás?»: el dato de que ya había llegado se calculaba y se
# tiraba en un `continue`. Ahora esa misma línea decide `llego` en vez de saltar.
#
# El riesgo de la caja no cambió: es AVISAR DE MÁS. Si avisa por el supermercado,
# se aprende a ignorarla y deja de servir para el caso que importa. Por eso los
# cortes siguen intactos y el rechazo sigue siendo para siempre.
#
# LOS DOS CORTES, calibrados contra las 1.103 facturas reales y verificados el
# 2026-08-04 (reproducen la tabla del plan al decimal):
#
#   facturas por mes <= 1,3   Un servicio factura una vez al mes; la gasolina
#                             factura cinco. Este corte solo mata a SHELL (5,26),
#                             AXXON (4,84), TUPAQ (6,30) y los restaurantes.
#   dispersión del día <= 7   El supermercado pasa el corte anterior (1,25) pero
#                             cae acá con 7,7: comprás cualquier día del mes. Un
#                             servicio cae siempre en la misma fecha.
#
# Los tres que califican hoy: HumanoSeguros (20 meses), Claro (19) y Account NE
# (19). Luz y agua no aparecen en el histórico de BlackBox: el detector NO
# inventa proveedores, sólo reporta los que ya tienen patrón.
#
# LO QUE NO SIRVE COMO FILTRO: la regularidad del monto. Humano Seguros varía un
# 50% mes a mes porque cambia la nómina, y es el recurrente más claro que hay.
#
# APRENDE DEL RECHAZO, y eso es lo que de verdad lo hace confiable: si avisó por
# algo que no correspondía y lo rechazaste, ese proveedor no vuelve a aparecer
# nunca. En dos meses la lista se calibra con tus casos y no con estos umbrales.
#
# LA IDENTIDAD ES EL RelationshipID, NUNCA EL NOMBRE. Claro aparece en el
# histórico con SIETE grafías distintas —«Claro», «Claro-», «Claro'-Compañia
# Dominicana de Teléfonos, S.A»…— y Humano con tres, todas bajo un único
# RelationshipID. Deduplicar por nombre partiría un proveedor de 21 facturas en
# siete de tres y ninguno llegaría al mínimo de meses. El nombre que se muestra
# es el primero que aparece en el archivo, así que puede venir sucio: es
# etiqueta, no llave.
#
# CORRE TODOS LOS DÍAS y es idempotente: una fila por proveedor y período. Si en
# la corrida de hoy el proveedor ya facturó y ayer no, la fila se ACTUALIZA — sin
# eso, un «no llegó» de principio de mes se quedaba mintiendo hasta fin de mes.
#
# Env: QUALIA_DSN, QUALIA_EMPRESA_ID. Opcional QUALIA_RAW, QUALIA_HOY
# (YYYY-MM-DD, para probar), QUALIA_DRY_RUN=1. stdout vacío = silencio.

set -euo pipefail
: "${QUALIA_DSN:?falta QUALIA_DSN}"
: "${QUALIA_EMPRESA_ID:?falta QUALIA_EMPRESA_ID}"
RAW="${QUALIA_RAW:-/opt/data/preentrenamiento/raw}"
# El contenedor corre en UTC: después de las 20:00 AST un `date +%F` da el día
# siguiente, y acá el día del mes decide si ya toca avisar.
HOY="${QUALIA_HOY:-$(TZ=America/Santo_Domingo date +%F)}"

# Lo ya emitido este período y lo ya rechazado. El rechazo es PARA SIEMPRE y por
# proveedor —no por mes—: si no correspondía una vez, no corresponde nunca.
#
# `emitidas` trae el id y el `llego` guardado para poder ACTUALIZAR la fila
# cuando la factura llega después de haberla reportado como ausente. Se indexa
# por proveedor_id, que es la llave estable; las filas viejas no lo tienen y se
# reconocen por nombre, que es lo único que guardaban.
ESTADO=$(PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -At -c "
select json_build_object(
  'emitidas', coalesce((select json_agg(json_build_object(
                          'id', id,
                          'prov', coalesce(propuesta->>'proveedor_id', propuesta->>'proveedor'),
                          'periodo', propuesta->>'periodo',
                          'llego', coalesce((propuesta->>'llego')::boolean, false),
                          'aldia', (propuesta ? 'vencido')))
                        from qualia_trabajos
                        where empresa_id = '${QUALIA_EMPRESA_ID}'
                          and propuesta->>'clase' = 'factura_faltante'
                          and estado not in ('rechazada')), '[]'),
  'rechazados', coalesce((select json_agg(distinct coalesce(propuesta->>'proveedor_id', propuesta->>'proveedor'))
                          from qualia_trabajos
                          where empresa_id = '${QUALIA_EMPRESA_ID}'
                            and propuesta->>'clase' = 'factura_faltante'
                            and estado = 'rechazada'), '[]'))
")

SQL=$(RAW="$RAW" HOY="$HOY" ESTADO="$ESTADO" python3 - <<'PY'
import calendar, collections, datetime, json, os, statistics

RAW = os.environ["RAW"]
HOY = datetime.date.fromisoformat(os.environ["HOY"])
EMPRESA = os.environ["QUALIA_EMPRESA_ID"].strip()
estado = json.loads(os.environ["ESTADO"])
rechazados = set(estado.get("rechazados") or [])
c2 = lambda x: round(float(x or 0), 2)
esc = lambda s: "null" if s is None else "'" + str(s).replace("'", "''") + "'"

MESES_MINIMOS = 6      # sin media docena de meses no hay patrón, hay casualidad
MAX_POR_MES = 1.3
MAX_DISPERSION = 7.0

periodo = HOY.strftime("%Y-%m")
# Lo ya emitido de ESTE período, por proveedor. Las corridas viejas indexaban por
# nombre; se aceptan las dos llaves para no re-emitir sobre lo que ya existe.
emitidas = {}
for e in (estado.get("emitidas") or []):
    if e.get("periodo") == periodo and e.get("prov"):
        emitidas[e["prov"]] = e

facturas = collections.defaultdict(list)
nombres = {}
for line in open(f"{RAW}/vendor-bills-detalle.jsonl"):
    d = json.loads(line)["data"]
    if d.get("Void"):
        continue
    p = d.get("RelationshipID")
    nombres.setdefault(p, d.get("Beneficiary") or "?")
    facturas[p].append({"fecha": d["DocDate"][:10], "monto": c2(d.get("TotalAmount")),
                        "docid": d.get("DocID")})

inserts, updates = [], []
for prov, fs in facturas.items():
    nombre = nombres[prov]
    if prov in rechazados or nombre in rechazados:
        continue                                   # dijiste que no. Nunca más.
    meses = sorted({f["fecha"][:7] for f in fs})
    if len(meses) < MESES_MINIMOS:
        continue
    if len(fs) / len(meses) > MAX_POR_MES:
        continue                                   # factura seguido: es compra, no servicio
    dias = [int(f["fecha"][8:10]) for f in fs]
    dispersion = statistics.pstdev(dias) if len(dias) > 1 else 0.0
    if dispersion > MAX_DISPERSION:
        continue                                   # cae cualquier día: no es un contrato

    fs.sort(key=lambda f: f["fecha"])
    delmes = [f for f in fs if f["fecha"][:7] == periodo]
    llego = bool(delmes)

    dia_habitual = round(statistics.median(dias))
    margen = max(3, round(dispersion))
    # El margen YA NO decide si la fila existe, sino si la ausencia es un
    # problema. Cuando esta caja avisaba, esperar tenía sentido: decir «no llegó»
    # el día 2 de algo que factura el día 4 es ruido. Pero la caja pasó a
    # reportar el ESTADO del mes, y ahí esperar esconde justo lo que se viene a
    # mirar — con el corte puesto, hoy 4 se veía 1 de 3 recurrentes y los otros
    # dos no existían hasta el día 7 y el 11.
    #
    # Así que están los tres desde el día 1, y el margen se guarda en `vencido`:
    # false = todavía puede llegar, true = ya se pasó de su fecha habitual.
    vencido = HOY.day >= min(28, dia_habitual + margen)

    # La fila va con la fecha en que ESTE proveedor factura, no con la de la
    # corrida: la columna del listado decía «hoy» para las tres y no informaba
    # nada. La que llegó lleva la fecha real de su factura; la que falta, la
    # esperada de este mes. Se recorta al último día del mes porque un proveedor
    # que factura el 31 no tiene 31 en febrero.
    dia_esperado = min(dia_habitual, calendar.monthrange(HOY.year, HOY.month)[1])
    fecha_esperada = HOY.replace(day=dia_esperado).isoformat()

    montos = sorted(f["monto"] for f in fs[-6:])
    tipico = montos[len(montos) // 2]
    propuesta = {
        "clase": "factura_faltante",
        "metodo": "script",
        "proveedor": nombre,
        "proveedor_id": prov,
        "periodo": periodo,
        "fecha": fecha_esperada,
        "fecha_esperada": fecha_esperada,
        "moneda": "DOP",
        "direccion": "cargo",
        "confianza": 0.7,
        "llego": llego,
        "vencido": vencido,
        "dia_habitual": dia_habitual,
        "historial": {"meses": len(meses), "facturas": len(fs),
                      "por_mes": round(len(fs) / len(meses), 2),
                      "dia_habitual": dia_habitual, "dispersion_dia": round(dispersion, 1)},
    }
    if llego:
        u = delmes[-1]
        propuesta.update({
            # La que llegó vale por el día en que facturó de verdad, no por el
            # promedio: ahí ya no hay nada que estimar.
            "fecha": u["fecha"],
            "monto": u["monto"],
            "descripcion": f"{nombre} — facturó {periodo}",
            # El pago NO se declara: `AppliedPayments` viene en 0 y
            # `UnappliedAmount` es 0 en las 1.103 facturas del histórico, así que
            # no distingue «impaga» de «sin dato». Inventar un `pagada: false`
            # sería peor que no decirlo. Sale de ADM en vivo, no de este dump.
            "factura": {"docid": u["docid"], "fecha": u["fecha"], "monto": u["monto"]},
            "detalle": (f"Ya facturó {periodo}: {u['docid']} del {u['fecha']} por "
                        f"RD${u['monto']:,.2f}. Factura {len(meses)} de los últimos meses, "
                        f"siempre alrededor del día {dia_habitual}."),
        })
        resumen = f"{nombre} facturó {periodo} ({u['docid']})"
    elif vencido:
        propuesta.update({
            "monto": tipico,
            "descripcion": f"{nombre} — no facturó {periodo}",
            "detalle": (f"Facturó {len(meses)} de los últimos meses, siempre alrededor del día "
                        f"{dia_habitual}, por unos RD${tipico:,.2f}. De {periodo} no hay ninguna y "
                        f"hoy es {HOY.day}. Si no corresponde, rechazala con el motivo: no vuelvo "
                        "a avisar por este proveedor."),
        })
        resumen = f"No llegó la factura de {nombre} ({periodo})"
    else:
        # Todavía en ventana. Se muestra igual —es uno de los recurrentes del
        # mes— pero NO se pide decidir nada: no hay ausencia que reclamar sobre
        # una factura que aún no debería haber llegado.
        propuesta.update({
            "monto": tipico,
            "descripcion": f"{nombre} — todavía no facturó {periodo}",
            "detalle": (f"Factura {len(meses)} de los últimos meses, alrededor del día "
                        f"{dia_habitual}, por unos RD${tipico:,.2f}. De {periodo} todavía no hay "
                        f"ninguna, pero hoy es {HOY.day}: está dentro de su fecha habitual."),
        })
        resumen = f"{nombre} todavía no facturó {periodo}"

    ya = emitidas.get(prov) or emitidas.get(nombre)
    if ya is None:
        inserts.append(f"({esc(EMPRESA)}::uuid, 'sugerencia', 'cron_conciliacion', 'propuesta', "
                       f"{esc(resumen[:200])}, {esc(json.dumps(propuesta, ensure_ascii=False))}::jsonb)")
    elif bool(ya.get("llego")) != llego or not ya.get("aldia"):
        # Cuando el estado CAMBIÓ, o cuando la fila viene de la versión que sólo
        # emitía ausencias y no trae `vencido`: ésa se quedó además con la fecha
        # de la corrida en vez de la del proveedor, así que hay que reescribirla
        # una vez. Fuera de esos dos casos no se toca — reescribirla todos los
        # días movería `updated_at` sin que haya pasado nada y la mesa lo leería
        # como actividad del contable.
        updates.append(f"update qualia_trabajos set resumen = {esc(resumen[:200])}, "
                       f"propuesta = {esc(json.dumps(propuesta, ensure_ascii=False))}::jsonb "
                       f"where id = {esc(ya['id'])}::uuid;")

if inserts:
    print("insert into qualia_trabajos (empresa_id, tipo, origen, estado, resumen, propuesta) values")
    print(",\n".join(inserts) + ";")
for u in updates:
    print(u)
PY
)

if [ -z "$SQL" ]; then
  exit 0
fi

NUEVAS=$(grep -c "::jsonb)" <<<"$SQL" || true)
CAMBIADAS=$(grep -c "^update " <<<"$SQL" || true)

if [ "${QUALIA_DRY_RUN:-0}" = "1" ]; then
  echo "[dry-run] $NUEVAS fila(s) nueva(s), $CAMBIADAS actualizada(s)"
  echo "$SQL"
  PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -q -c "begin; $SQL rollback;"
  echo "[dry-run] el SQL corrió dentro de una transacción y se deshizo."
else
  PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -q -c "$SQL"
  echo "Recurrentes: $NUEVAS nueva(s), $CAMBIADAS actualizada(s)."
fi
