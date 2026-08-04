#!/bin/bash
# Asignación de pagos a facturas — cron --no-agent del gateway Hermes. CERO tokens.
#
# El banco muestra que salió plata y NUNCA dice a quién. Repetir «no sé qué es»
# no agrega nada —eso ya se ve en Conciliación—: lo que agrega valor es decir
# CONTRA QUÉ FACTURAS de ADM va ese pago. Esto lo intenta, y cuando lo logra la
# fila deja de ser un misterio y pasa a ser un BillPayment listo para registrar.
#
# SÓLO HABLA CUANDO TIENE ALGO QUE DECIR. Un pago que no casa con nada no genera
# sugerencia: es la misma regla que sugerir-notas-debito.sh («lo opaco es lo que
# se sugiere; lo que se explica solo, no»), y es lo que evita sembrar las ~47
# salidas mensuales que el humano sube a ADM por rutina.
#
# EL ALGORITMO, y por qué estos cuatro intentos y no otros:
#
#   1. una factura sola que dé el monto exacto;
#   2. suma corrida desde la MÁS VIEJA — es como se paga de verdad, se salda lo
#      más viejo primero, y es UNA pasada y no una explosión combinatoria (TUPAQ
#      tiene 47 facturas abiertas: probar subconjuntos serían 2⁴⁷);
#   2b. la corrida menos UNA del medio — el caso «todas menos la que estaba en
#      disputa»;
#   3. corte por mes calendario — se paga el mes cerrado, no un número de
#      facturas.
#
# LO QUE LO HACE SEGURO NO ES EL ALGORITMO, ES NO ELEGIR CUANDO HAY EMPATE.
# Backtest sobre los 729 pagos históricos ya aplicados (memoria/scripts/
# backtest-asignacion.py, reproducible): 593 aciertos con candidato único, 20
# ambiguos —y en los 20 la factura real estaba entre las listadas— y CERO
# equivocados. Sin la regla de ambigüedad se equivocaba en 7, TODOS de Isla
# Dominicana y Mecari: los dos que facturan montos redondos y repetidos
# (mediana RD$600), donde varias facturas distintas dan el mismo total. Con más
# de un candidato la propuesta los lista y la web bloquea el aprobar. Si alguien
# saca esa regla, vuelven los 7 pagos aplicados a la factura equivocada.
#
# El saldo pendiente sale del espejo: `TotalAmount - AppliedPayments` de
# vendor-bills-detalle.jsonl. Si `mesa/refrescar-precedentes.sh` se rompe, el
# espejo envejece y las facturas ya pagadas vuelven a verse abiertas — es la
# falla a vigilar, la misma de sugerir-notas-debito.sh.
#
# Env: QUALIA_DSN, QUALIA_EMPRESA_ID. Opcional QUALIA_RAW (default
# /opt/data/preentrenamiento/raw), QUALIA_DESDE (default 2026-06-01),
# QUALIA_DRY_RUN=1 (INSERT real dentro de una transacción que se deshace).
# stdout vacío = silencio (--no-agent).

set -euo pipefail
: "${QUALIA_DSN:?falta QUALIA_DSN}"
: "${QUALIA_EMPRESA_ID:?falta QUALIA_EMPRESA_ID}"
RAW="${QUALIA_RAW:-/opt/data/preentrenamiento/raw}"
DESDE="${QUALIA_DESDE:-2026-06-01}"

# Los candidatos: salidas del banco de ESTA empresa, todavía pendientes, que
# ninguna propuesta reclamó. Las tres llaves de reclamo son tres tipos de
# documento distintos y hay que mirar las tres — con sólo `banco_tx_id` se
# colaban las que ampara un NCF y las dos patas de una transferencia.
CANDIDATOS=$(PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -At -c "
with levantados as (
  select (propuesta->>'banco_tx_id')::uuid as tx from qualia_trabajos where propuesta ? 'banco_tx_id'
  union select (jsonb_array_elements_text(propuesta->'banco_tx_ids'))::uuid from qualia_trabajos where propuesta ? 'banco_tx_ids'
  union select (jsonb_array_elements_text(propuesta->'movimientos'))::uuid from qualia_trabajos where propuesta ? 'movimientos'
)
select coalesce(json_agg(json_build_object(
         'id', t.id, 'fecha', t.fecha_posteo, 'monto', abs(t.monto),
         'descripcion', t.descripcion, 'referencia', t.nro_referencia,
         'banco', a.banco, 'cuenta_banco', a.nombre, 'cuenta_numero', a.numero,
         'moneda', a.moneda)), '[]')
from openbanking_transactions t
join openbanking_accounts a on a.id = t.account_id
where a.empresa_id = '${QUALIA_EMPRESA_ID}'
  and a.tipo is distinct from 'tarjeta'
  and t.estado_conciliacion = 'pendiente'
  and t.monto < 0
  and t.fecha_posteo >= '${DESDE}'
  -- Los cargos del propio banco tienen su detector (sugerir-cargos.sh) y su
  -- comprobante fiscal: no son pagos a proveedor y no se buscan acá.
  and t.descripcion !~* 'comisi|imp\\.|manejo|mantenimiento|retenci|norma dgii|sobregiro'
  -- El pago de la tarjeta tampoco es un pago a proveedor: es la pata de una
  -- transferencia contra 203.11 Tarjeta Corporativa, y la mesa ya la empareja
  -- del lado de la tarjeta. Sin esta linea el algoritmo le encontraba 17 cargas
  -- de gasolina de 750 pesos que sumaban los 15.000 justos.
  and t.descripcion !~* 'pago\\s+(de\\s+)?tarjeta'
  and t.id not in (select tx from levantados where tx is not null)
")

SQL=$(RAW="$RAW" CANDIDATOS="$CANDIDATOS" python3 - <<'PY'
import collections, io, json, os, re

RAW = os.environ["RAW"]
EMPRESA = os.environ["QUALIA_EMPRESA_ID"].strip()
c2 = lambda x: round(float(x or 0), 2)
esc = lambda s: "null" if s is None else "'" + str(s).replace("'", "''") + "'"

BANCOS = {}
_num = None
for _l in io.open(os.environ.get("QUALIA_MAPA_CUENTAS", "/mapa-cuentas.yaml"), encoding="utf-8"):
    _m = re.match(r'\s*numero:\s*"?([0-9]+)"?', _l)
    if _m:
        _num = _m.group(1)
        continue
    _m = re.match(r'\s*cuenta_contable:\s*"?([0-9.]+)"?', _l)
    if _m and _num:
        BANCOS[_num] = _m.group(1)
        _num = None

# ── Las facturas que siguen abiertas, por proveedor ─────────────────────────
abiertas = collections.defaultdict(list)
nombre_prov = {}
for line in open(f"{RAW}/vendor-bills-detalle.jsonl"):
    d = json.loads(line)["data"]
    if d.get("Void"):
        continue
    pendiente = round(c2(d.get("TotalAmount")) - c2(d.get("AppliedPayments")), 2)
    if pendiente <= 0.005:
        continue
    prov = d.get("RelationshipID")
    nombre_prov.setdefault(prov, d.get("Beneficiary") or "")
    abiertas[prov].append({
        "docid": d["DocID"], "fecha": d["DocDate"][:10],
        "monto": pendiente, "moneda": d.get("CurrencyID") or "DOP",
    })
for v in abiertas.values():
    v.sort(key=lambda f: (f["fecha"], f["docid"]))


# La cuenta contable del banco que pagó, del bloque `cuentas` de
# mapa-cuentas.yaml. Es la UNICA que hay que confirmar: en las 671 registradas,
# ADM debita "Cuentas por Pagar Proveedores" —que deriva del proveedor y no
# tiene codigo en el plan— y acredita el banco. Inventarle un codigo al debe
# seria adivinar; el haber si es una decision, y por eso viaja.
def cuenta_del_banco(numero):
    return BANCOS.get(str(numero or "").strip())


def montos_irregulares(grupo):
    """Lo que hace confiable una suma corrida NO es cuantas facturas son sino
    que sus montos sean IRREGULARES: quince facturas de 282,66 / 706,68 / 220,76
    que cierran al centavo no pueden ser casualidad, pero veinte de RD$750 que
    dan RD$15.000 cierran de mil maneras distintas y no prueban nada.

    Caso real que lo motivo: el pago de la tarjeta caso con 17 cargas de
    gasolina de AXXON, todas de RD$750. Un grupo asi no se propone -ni siquiera
    como candidato- porque no hay forma de que el humano lo verifique.
    """
    if len(grupo) < 3:
        return True
    return len({f["monto"] for f in grupo}) / len(grupo) >= 0.5


def grupos_que_cierran(facturas, objetivo):
    """Todos los grupos que dan el objetivo, en orden de preferencia. Se
    devuelven TODOS y no el primero: el empate es la información que hace
    segura la propuesta, y descartarlo sería elegir por el humano."""
    out = []
    vistos = set()

    def sumar(metodo, grupo):
        clave = frozenset(f["docid"] for f in grupo)
        if clave in vistos or not grupo or not montos_irregulares(grupo):
            return
        vistos.add(clave)
        out.append({"metodo": metodo, "facturas": grupo})

    for f in facturas:                                    # 1 · exacta
        if abs(f["monto"] - objetivo) < 0.005:
            sumar("exacta", [f])

    acc, grupo = 0.0, []                                  # 2 · suma corrida
    for f in facturas:
        acc = round(acc + f["monto"], 2)
        grupo.append(f)
        if abs(acc - objetivo) < 0.005:
            sumar("corrida", list(grupo))
            break
        if acc > objetivo + 0.005:
            for quitar in grupo[:-1]:                     # 2b · menos una
                if abs(round(acc - quitar["monto"], 2) - objetivo) < 0.005:
                    sumar("corrida", [x for x in grupo if x is not quitar])
            break

    meses = collections.defaultdict(list)                 # 3 · corte por mes
    for f in facturas:
        meses[f["fecha"][:7]].append(f)
    for mes in sorted(meses):
        g = meses[mes]
        if abs(round(sum(x["monto"] for x in g), 2) - objetivo) < 0.005:
            sumar("periodo", g)
    return out


filas = []
for mov in json.loads(os.environ["CANDIDATOS"]):
    objetivo = c2(mov["monto"])
    hallados = []
    for prov, facturas in abiertas.items():
        # Sólo facturas ANTERIORES al pago y de la misma moneda: pagar una
        # factura que todavía no existía es imposible, y cruzar monedas sin
        # tasa sería inventar el monto.
        cands = [f for f in facturas
                 if f["fecha"] <= mov["fecha"] and f["moneda"] == (mov["moneda"] or "DOP")]
        for g in grupos_que_cierran(cands, objetivo):
            hallados.append({
                "proveedor": (nombre_prov.get(prov) or "")[:60],
                "metodo": g["metodo"],
                "suma": round(sum(f["monto"] for f in g["facturas"]), 2),
                "facturas": [{"docid": f["docid"], "fecha": f["fecha"], "monto": f["monto"]}
                             for f in g["facturas"]],
            })
    if not hallados:
        continue  # silencio: sin nada que decir no se siembra una fila

    # Un solo grupo → propuesta con nombre y apellido. Varios → se listan y el
    # humano elige; la web no deja aprobar hasta entonces.
    mejor = hallados[0]
    ambiguo = len(hallados) > 1
    asignacion = dict(mejor)
    if ambiguo:
        asignacion["candidatos"] = hallados

    detalle = (
        f"Cuadran {len(hallados)} combinaciones distintas de facturas por este mismo monto, "
        "así que la fecha y el importe no alcanzan para elegir: mirá las opciones y decidí cuál es."
        if ambiguo else
        f"Parece pagar {len(mejor['facturas'])} factura(s) de {mejor['proveedor']} "
        f"por RD${mejor['suma']:,.2f} ({mejor['metodo']}). Verificá contra el comprobante antes de aprobar."
    )
    propuesta = {
        "clase": "pago_sin_asignar",
        "documento_adm": "BillPayments",
        "metodo": "script",
        "banco": mov["banco"], "fecha": mov["fecha"], "monto": objetivo,
        "moneda": mov["moneda"] or "DOP", "direccion": "cargo",
        "descripcion": mov["descripcion"], "referencia_banco": mov["referencia"],
        "cuenta_banco": mov["cuenta_banco"], "cuenta_numero": mov["cuenta_numero"],
        "banco_tx_id": mov["id"],
        "confianza": 0.5 if ambiguo else 0.9,
        "detalle": detalle,
        "asignacion": asignacion,
    }
    gl = cuenta_del_banco(mov["cuenta_numero"])
    if gl:
        propuesta["cuenta_contable"] = {"codigo": gl, "nombre": f"Banco {mov['cuenta_banco']}"}
        propuesta["lineas"] = [
            {"cuenta": "CxP", "cuenta_nombre": "Cuentas por Pagar Proveedores",
             "debito": objetivo, "credito": 0,
             "descripcion": f"Pago a {mejor['proveedor']}" if not ambiguo else "Pago a proveedor"},
            {"cuenta": gl, "cuenta_nombre": f"Banco {mov['cuenta_banco']}",
             "debito": 0, "credito": objetivo,
             "descripcion": f"{mov['banco']} · {mov['cuenta_banco']}"},
        ]
    else:
        propuesta["detalle"] += (" OJO: la cuenta contable de este banco no esta en"
                                 " el mapa, asi que no se puede aprobar hasta agregarla.")
    resumen = (f"Pago sin asignar: {mov['descripcion']} — "
               f"{'varios candidatos' if ambiguo else mejor['proveedor']}")
    filas.append(f"({esc(EMPRESA)}::uuid, 'sugerencia', 'cron_conciliacion', 'propuesta', "
                 f"{esc(resumen[:200])}, {esc(json.dumps(propuesta, ensure_ascii=False))}::jsonb)")

if filas:
    print("insert into qualia_trabajos (empresa_id, tipo, origen, estado, resumen, propuesta) values")
    print(",\n".join(filas) + ";")
PY
)

if [ -z "$SQL" ]; then
  exit 0   # nada que sugerir: silencio, que es lo que --no-agent espera
fi

if [ "${QUALIA_DRY_RUN:-0}" = "1" ]; then
  echo "[dry-run] se sembrarían $(grep -c "::jsonb)" <<<"$SQL") sugerencias de asignación"
  PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -q -c "begin; $SQL rollback;"
  echo "[dry-run] el INSERT corrió dentro de una transacción y se deshizo."
else
  PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -q -c "$SQL"
  echo "Sembradas $(grep -c "::jsonb)" <<<"$SQL") sugerencias de asignación de pagos."
fi
