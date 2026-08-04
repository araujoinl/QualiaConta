#!/bin/bash
# Consumos de tarjeta que YA tienen su factura en ADM — cron --no-agent. CERO tokens.
#
# Cada consumo con la tarjeta corporativa amerita su factura: sin ella el gasto
# no se deduce y el ITBIS se pierde. Pero la mitad de los consumos YA tiene su
# factura cargada en ADM, y mostrarlos como pendientes entierra a los que de
# verdad les falta el papel — que son los únicos sobre los que hay algo que hacer.
#
# Medido el 2026-08-04: de 51 consumos pendientes, 26 casan con una factura de
# proveedor por MONTO + FECHA (±7 días) + una palabra del comercio en común
# ('SHELL VILLA MELLA' ↔ 'SHELL VILLA MELLA IVILLA'). La caja pasa de 51 filas a
# 25 de trabajo real.
#
# LAS TRES SEÑALES SON OBLIGATORIAS JUNTAS. Sólo monto + fecha da 13 matches más
# que NO se siembran a propósito: en una tarjeta que carga gasolina de RD$750
# casi todos los días, el monto y la fecha solos casan con cualquier cosa. El
# nombre del comercio es lo que convierte una coincidencia en evidencia, y es
# justamente lo que la tarjeta SÍ dice y una transferencia no.
#
# SE SIEMBRA `registrada`, NO `propuesta`: no hay nada que decidir —la factura
# está en ADM y se puede ver— así que la fila no entra a la cola de decisión ni
# infla el contador de Sugerencias. Lo único que hace es reclamar el movimiento
# del banco (`banco_tx_id`), y con eso el consumo desaparece de la caja: es la
# misma mecánica con la que una sugerencia registrada saca su movimiento de la
# mesa. Lo que queda en la caja es lo que falta, que es de lo que la caja habla.
#
# El estado `registrada` exige evidencia por CHECK (migración
# 20260803010000_qualia_conta_registrada_con_evidencia): sin `registro_adm.docid`
# el INSERT muere. Acá el docid es el de la factura que ya está en ADM.
#
# Env: QUALIA_DSN, QUALIA_EMPRESA_ID. Opcional QUALIA_RAW, QUALIA_DIAS (±7),
# QUALIA_DRY_RUN=1. stdout vacío = silencio (--no-agent).

set -euo pipefail
: "${QUALIA_DSN:?falta QUALIA_DSN}"
: "${QUALIA_EMPRESA_ID:?falta QUALIA_EMPRESA_ID}"
RAW="${QUALIA_RAW:-/opt/data/preentrenamiento/raw}"
DIAS="${QUALIA_DIAS:-7}"

CONSUMOS=$(PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -At -c "
with levantados as (
  select (propuesta->>'banco_tx_id')::uuid as tx from qualia_trabajos where propuesta ? 'banco_tx_id'
  union select (jsonb_array_elements_text(propuesta->'banco_tx_ids'))::uuid from qualia_trabajos where propuesta ? 'banco_tx_ids'
  union select (jsonb_array_elements_text(propuesta->'movimientos'))::uuid from qualia_trabajos where propuesta ? 'movimientos'
)
select coalesce(json_agg(json_build_object(
         'id', t.id, 'fecha', t.fecha_posteo, 'monto', abs(t.monto),
         'descripcion', t.descripcion, 'banco', a.banco,
         'cuenta_banco', a.nombre, 'cuenta_numero', a.numero, 'moneda', a.moneda)), '[]')
from openbanking_transactions t
join openbanking_accounts a on a.id = t.account_id
where a.empresa_id = '${QUALIA_EMPRESA_ID}'
  and a.tipo = 'tarjeta'
  and t.estado_conciliacion = 'pendiente'
  -- Sólo los CONSUMOS. Lo positivo de una tarjeta es cashback o el pago de la
  -- tarjeta: otros dos trabajos, y ninguno tiene factura de proveedor detrás.
  and t.monto < 0
  and t.id not in (select tx from levantados where tx is not null)
")

TOMADOS=$(PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -At -c "
select coalesce(json_agg(propuesta->'registro_adm'->>'docid'), '[]')
from qualia_trabajos
where empresa_id = '${QUALIA_EMPRESA_ID}'
  and propuesta->'registro_adm' ? 'docid'
  and not (propuesta->'registro_adm' ? 'anulado_en')
  and not (propuesta->'registro_adm' ? 'eliminado_en')
")

SQL=$(RAW="$RAW" DIAS="$DIAS" CONSUMOS="$CONSUMOS" TOMADOS="$TOMADOS" python3 - <<'PY'
import collections, datetime, json, os, re, unicodedata

RAW = os.environ["RAW"]
DIAS = int(os.environ["DIAS"])
EMPRESA = os.environ["QUALIA_EMPRESA_ID"].strip()
c2 = lambda x: round(float(x or 0), 2)
esc = lambda s: "null" if s is None else "'" + str(s).replace("'", "''") + "'"
dia = lambda s: datetime.date.fromisoformat(str(s)[:10])

# Palabras que aparecen en medio mundo y no distinguen nada: si el match se
# apoyara en ellas, 'ESTACION SHELL' casaría con 'ESTACION TEXACO'.
VACIAS = {"SRL", "SA", "EIRL", "CXA", "ESTACION", "COMERCIAL", "DOMINICANA",
          "DE", "DEL", "LA", "EL", "LOS", "LAS", "Y", "S", "R", "L", "C", "POR", "A"}


def palabras(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().upper()
    return {w for w in re.sub(r"[^A-Z0-9 ]", " ", s).split() if len(w) > 2 and w not in VACIAS}


facturas = collections.defaultdict(list)
for line in open(f"{RAW}/vendor-bills-detalle.jsonl"):
    d = json.loads(line)["data"]
    if d.get("Void"):
        continue
    facturas[c2(d.get("TotalAmount"))].append({
        "docid": d["DocID"], "fecha": d["DocDate"][:10],
        "benef": d.get("Beneficiary") or "", "tok": palabras(d.get("Beneficiary")),
        "uuid": d.get("ID"),
    })

# UNA FACTURA RESPALDA UN SOLO CONSUMO. Con 22 cargas de SHELL de RD$750 y
# varias facturas de SHELL por RD$750, el "mas cercano en fecha" hacia que dos
# consumos reclamaran la misma: lo atajo el indice parcial
# `qualia_trabajos_docid_vivo_unico`, que existe justamente para eso (un
# documento VIVO de ADM pertenece a un solo trabajo). Se lleva el registro acá
# en vez de dejar que reviente el INSERT, y el consumo que se queda sin factura
# libre sigue en la caja diciendo "falta" — que es lo honesto: no se puede
# probar cual de las facturas es la suya.
usados = set(json.loads(os.environ.get("TOMADOS") or "[]"))

# Los consumos se recorren de mas viejo a mas nuevo para que el reparto sea
# estable: sin orden fijo, dos corridas atan facturas distintas a los mismos
# consumos.
filas = []
for mov in sorted(json.loads(os.environ["CONSUMOS"]), key=lambda m: (m["fecha"], m["id"])):
    monto = c2(mov["monto"])
    tok = palabras(mov["descripcion"])
    if not tok:
        continue
    cands = [f for f in facturas.get(monto, [])
             if f["docid"] not in usados
             and abs((dia(f["fecha"]) - dia(mov["fecha"])).days) <= DIAS and (tok & f["tok"])]
    if not cands:
        continue  # le falta la factura: eso lo dice la caja, no hace falta fila
    # El más cercano en fecha; el empate se rompe por docid para que dos
    # corridas sobre los mismos datos elijan siempre lo mismo.
    f = sorted(cands, key=lambda x: (abs((dia(x["fecha"]) - dia(mov["fecha"])).days), x["docid"]))[0]
    usados.add(f["docid"])

    propuesta = {
        "clase": "gasto_tarjeta",
        "metodo": "script",
        "banco": mov["banco"], "fecha": mov["fecha"], "monto": monto,
        "moneda": mov["moneda"] or "DOP", "direccion": "cargo",
        "descripcion": mov["descripcion"],
        "cuenta_banco": mov["cuenta_banco"], "cuenta_numero": mov["cuenta_numero"],
        "banco_tx_id": mov["id"],
        "confianza": 0.9,
        "detalle": (f"El consumo ya tiene su factura en ADM: {f['docid']} de {f['benef']} "
                    f"por RD${monto:,.2f} del {f['fecha']}. Casó por monto, fecha y comercio, "
                    "así que no hay nada que subir."),
        "registro_adm": {"docid": f["docid"], "uuid": f["uuid"],
                         "documento": "VendorBills", "fecha": f["fecha"]},
    }
    resumen = f"Consumo con factura: {mov['descripcion']} → {f['docid']}"
    filas.append(f"({esc(EMPRESA)}::uuid, 'sugerencia', 'cron_conciliacion', 'registrada', "
                 f"{esc(resumen[:200])}, {esc(json.dumps(propuesta, ensure_ascii=False))}::jsonb)")

if filas:
    print("insert into qualia_trabajos (empresa_id, tipo, origen, estado, resumen, propuesta) values")
    print(",\n".join(filas) + ";")
PY
)

if [ -z "$SQL" ]; then
  exit 0
fi

if [ "${QUALIA_DRY_RUN:-0}" = "1" ]; then
  echo "[dry-run] se ataría su factura a $(grep -c "::jsonb)" <<<"$SQL") consumos de tarjeta"
  PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -q -c "begin; $SQL rollback;"
  echo "[dry-run] el INSERT corrió dentro de una transacción y se deshizo."
else
  PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -q -c "$SQL"
  echo "Atada su factura de ADM a $(grep -c "::jsonb)" <<<"$SQL") consumos de tarjeta."
fi
