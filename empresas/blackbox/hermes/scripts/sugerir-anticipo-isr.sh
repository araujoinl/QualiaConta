#!/bin/bash
# Anticipo mensual del ISR — cron --no-agent del gateway Hermes. CERO tokens.
#
# Detecta que este mes toca pagar el anticipo de ISR y crea la sugerencia en la
# pestaña con el asiento PRECARGADO (Dr. 210.11 / Cr. 101.05 por la cuota) y la
# deuda actual de 210.11. El humano solo sube el volante de la DGII y confirma
# la transferencia; al aprobar, registrar-pago-cuenta.py crea el Pago a Cuentas.
#
# COMO SABE la cuota y la deuda: lee el espejo local (extraer-adm.py), no la API.
#   - La cuota mensual fija sale del ultimo Pago a Cuentas a "DGII ISR" (es la
#     cuota del ano fiscal vigente; la fija la DGII al abrir el ano).
#   - La deuda actual (saldo de 210.11) = total de la provision anual menos los
#     pagos a DGII ISR desde esa provision. Hasta que el SQL de ADM se habilite,
#     se calcula por diferencia; cuando se habilite, se valida contra el mayor.
#   - El banco (CashAccountID) y las cuentas (210.11, 101.05) salen del propio
#     pago historico, no hardcodeados: si el plan cambia, este script no miente.
#
# NO sugiere si:
#   - no hay provision anual (sin base para decir cuanto se debe), o
#   - ya hay un pago a DGII ISR este mes calendario (ya pago), o
#   - no hay cuota conocida (nunca se pago un anticipo), o
#   - ya existe sugerencia de anticipo_isr del periodo (idempotente).
#
# Env: QUALIA_DSN, QUALIA_EMPRESA_ID. Opcional QUALIA_RAW, QUALIA_HOY
# (YYYY-MM-DD, para probar), QUALIA_DRY_RUN=1. stdout vacío = silencio.

set -euo pipefail
: "${QUALIA_DSN:?falta QUALIA_DSN}"
: "${QUALIA_EMPRESA_ID:?falta QUALIA_EMPRESA_ID}"
RAW="${QUALIA_RAW:-/opt/data/preentrenamiento/raw}"
HOY="${QUALIA_HOY:-$(TZ=America/Santo_Domingo date +%F)}"

# ¿Ya existe sugerencia de anticipo ISR del periodo? (idempotencia)
EXISTE=$(PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -At -c "
select id from qualia_trabajos
 where empresa_id = '${QUALIA_EMPRESA_ID}'
   and propuesta->>'clase' = 'anticipo_isr'
   and propuesta->>'periodo' = '${HOY:0:7}'
   and estado not in ('rechazada') limit 1;" 2>/dev/null || true)

SQL=$(RAW="$RAW" HOY="$HOY" EMPRESA="$QUALIA_EMPRESA_ID" python3 - <<'PY'
import datetime, json, os, sys

RAW = os.environ["RAW"]
HOY = datetime.date.fromisoformat(os.environ["HOY"])
EMPRESA = os.environ["EMPRESA"]
periodo = HOY.strftime("%Y-%m")
c2 = lambda x: round(float(x or 0), 2)
esc = lambda s: "null" if s is None else "'" + str(s).replace("'", "''") + "'"


def leer(path):
    try:
        f = open(path)
    except FileNotFoundError:
        return
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except Exception:
            continue
        yield d.get("data", d)


# 1) Provision anual vigente: journal con reference "P/R Anticipos ...", la mas
#    reciente por fecha. De ahi sale el total que abrio 210.11 este ano fiscal.
provision = None
for d in leer(RAW + "/journals-detalle.jsonl"):
    if d.get("Void"):
        continue
    ref = str(d.get("Reference") or "")
    if "P/R Anticipos" not in ref:
        continue
    fecha = str(d.get("DocDate") or "")[:10]
    if not fecha:
        continue
    cand = {"docid": d.get("DocID"), "fecha": fecha, "total": c2(d.get("TotalAmount")),
            "reference": ref}
    if provision is None or fecha > provision["fecha"]:
        provision = cand

if provision is None:
    sys.exit(0)  # sin provision anual no hay base para sugerir

# 2) Pagos a DGII ISR (anticipo), ordenados por fecha. De ahi: cuota, banco,
#    cuentas y cuantos ya se pagaron este ano fiscal.
pagos = []
for d in leer(RAW + "/account-payments-detalle.jsonl"):
    if d.get("Void"):
        continue
    ben = str(d.get("Beneficiary") or "")
    ref = str(d.get("Reference") or "")
    # "DGII ISR" es el beneficiario del anticipo; "DGII ITBIS"/"DGII IR-3" son
    # otros impuestos. El reference suele traer "Anticipo ... Renta".
    if "DGII ISR" not in ben.upper() and "ANTICIPO" not in ref.upper():
        continue
    fecha = str(d.get("DocDate") or "")[:10]
    if not fecha:
        continue
    pagos.append({"docid": d.get("DocID"), "fecha": fecha,
                  "monto": c2(d.get("TotalAmount")),
                  "banco_id": d.get("CashAccountID"),
                  "accounts": d.get("Accounts") or []})

if not pagos:
    sys.exit(0)  # sin un pago previo no hay cuota conocida que sugerir

pagos.sort(key=lambda p: p["fecha"])
ultimo = pagos[-1]

# 3) ¿Ya pago este mes calendario? Si hay un pago DGII ISR con DocDate del mes
#    actual, no se sugiere: ya esta.
if any(p["fecha"][:7] == periodo for p in pagos):
    sys.exit(0)

# 4) Cuota, banco y cuentas — salen del ultimo pago, no hardcodeadas.
cuota = ultimo["monto"]
banco_id = ultimo.get("banco_id")
cuenta_isr = cuenta_banco = None
for ln in ultimo.get("accounts", []):
    if float(ln.get("Debit") or 0) > 0:
        cuenta_isr = str(ln.get("AccountCode") or "")
        cuenta_isr_nom = str(ln.get("AccountName") or "")
    elif float(ln.get("Credit") or 0) > 0:
        cuenta_banco = str(ln.get("AccountCode") or "")
        cuenta_banco_nom = str(ln.get("AccountName") or "")
if not (cuenta_isr and cuenta_banco and banco_id):
    sys.exit(0)  # el pago historico no exponia las lineas; no adivinamos

# 5) Deuda actual de 210.11: provision menos los pagos desde la provision.
pagos_periodo = [p for p in pagos if p["fecha"] >= provision["fecha"]]
pagado = sum(p["monto"] for p in pagos_periodo)
deuda = round(provision["total"] - pagado, 2)

# 6) Propuesta con asiento PRECARGADO (lo que pidio el dueno: monto + deuda).
propuesta = {
    "clase": "anticipo_isr",
    "metodo": "script",
    "documento_adm": "AccountPayments",
    "banco_id": banco_id,
    "monto": cuota,
    "moneda": "DOP",
    "beneficiario": "DGII ISR",
    # Fecha del dia; el humano la ajusta a la del volante al aprobar si hace falta.
    "fecha": HOY.isoformat(),
    "periodo": periodo,
    "lineas": [
        {"cuenta": cuenta_isr, "debito": cuota, "credito": 0,
         "cuenta_nombre": cuenta_isr_nom},
        {"cuenta": cuenta_banco, "debito": 0, "credito": cuota,
         "cuenta_nombre": cuenta_banco_nom},
    ],
    "deuda_actual": deuda,
    "cuotas_pagadas": len(pagos_periodo),
    "provision": {"docid": provision["docid"], "total": provision["total"],
                  "fecha": provision["fecha"]},
    "detalle": (f"Anticipo del ISR de {periodo}. Cuota del ano fiscal: "
                f"RD${cuota:,.2f}. Deuda actual de {cuenta_isr} ({cuenta_isr_nom}): "
                f"RD${deuda:,.2f} ({len(pagos_periodo)} cuota(s) pagada(s) sobre "
                f"la provision {provision['docid']} de RD${provision['total']:,.2f}). "
                f"Subi el volante de la DGII y confirmá la transferencia del "
                f"{cuenta_banco_nom}; al aprobar se crea el Pago a Cuentas."),
}
resumen = f"Anticipo ISR {periodo} — RD${cuota:,.2f}"

print("insert into qualia_trabajos (empresa_id, tipo, origen, estado, resumen, propuesta) values")
print(f"({esc(EMPRESA)}::uuid, 'sugerencia', 'cron_conciliacion', 'propuesta', "
      f"{esc(resumen[:200])}, {esc(json.dumps(propuesta, ensure_ascii=False))}::jsonb);")
PY
)

if [ -z "$EXISTE" ] && [ -n "$SQL" ]; then
  if [ "${QUALIA_DRY_RUN:-0}" = "1" ]; then
    echo "[dry-run] sugeriria anticipo ISR $HOY:"
    echo "$SQL"
    PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -q -c "begin; $SQL rollback;"
    echo "[dry-run] el SQL corrio en transaccion y se deshizo."
  else
    PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -q -c "$SQL"
    echo "Anticipo ISR: sugerencia creada para ${HOY:0:7}."
  fi
else
  :  # silencioso: ya pago este mes, ya existe la sugerencia, o sin base. stdout
     # vacio = el cron no registra nada (mismo contrato que sugerir-recurrentes).
fi
