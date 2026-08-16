#!/bin/bash
# Notas de débito del banco — cron --no-agent del gateway Hermes. CERO tokens.
#
# Una nota de débito es plata que salió del banco y NADA MÁS: el estado de
# cuenta dice "Nota De Débito" a secas, sin beneficiario y sin concepto. Puede
# ser el pago del ITBIS, la TSS, aduanas, un abono a un préstamo o a una línea
# de crédito. Clasificarla por su descripción es imposible — no hay descripción.
#
# LA PREGUNTA QUE LO RESUELVE NO ES "QUÉ TIPO ES" SINO "¿YA ESTÁ EN ADM?".
# El humano no le cuenta al banco lo que hizo, pero sí se lo cuenta a ADM: los
# pagos a factura los sube él a mano, con su comprobante. Entonces se cruza cada
# nota de débito contra los pagos registrados y el resultado decide todo:
#
#   YA ESTÁ + beneficiario fiscal  → falta el VOLANTE del impuesto (el papel de
#         DGII que dice cuánto se debe). NO el comprobante de pago: ese ya lo
#         subió él por ADM. No hay nada contable que hacer, sólo adjuntar.
#   YA ESTÁ + cualquier otro       → NO se sugiere. Está registrado y se concilia
#         solo; recordárselo sería ruido.
#   NO ESTÁ                        → nadie lo asentó, y no va a llegar por el
#         flujo de facturas. Es el préstamo o la línea de crédito. Ahí sí hay
#         trabajo y se propone.
#
# Se limita a las notas de débito A PROPÓSITO. Toda salida sin registrar serían
# 90 filas en julio (RD$7,4 MM), y 79 de ellas son pagos a proveedor que el
# humano sube por rutina: el sistema estaría reclamándole su propio trabajo
# pendiente y enterrando lo que sí necesita decisión. Lo opaco es lo que se
# sugiere; lo que se explica solo, no.
#
# El cruce va contra el ESPEJO local (preentrenamiento/raw), no contra la API:
# mismo patrón que sugerir-transferencias.sh. `mesa/refrescar-precedentes.sh` lo
# baja cada noche — si ese refresco se rompe, el espejo envejece y todo empieza
# a verse como "no registrado". Es la falla a vigilar.
#
# Env: QUALIA_DSN, QUALIA_EMPRESA_ID. Opcional QUALIA_RAW (default
# /opt/data/preentrenamiento/raw). stdout vacío = silencio (--no-agent).

set -euo pipefail
: "${QUALIA_DSN:?falta QUALIA_DSN}"
: "${QUALIA_EMPRESA_ID:?falta QUALIA_EMPRESA_ID}"
RAW="${QUALIA_RAW:-/opt/data/preentrenamiento/raw}"

# `uv run` y no `python3` a secas: bajo el cron del gateway el PATH resuelve al
# venv de Hermes y por un `docker exec` pelado a /usr/bin/python3. Con python3 el
# script anda en el cron pero no se puede probar a mano. Ver sugerir-cargos.sh.
SQL=$(RAW="$RAW" uv run --quiet python - <<'PY'
import json, os, re, sys
from datetime import date, timedelta

empresa_id = os.environ["QUALIA_EMPRESA_ID"].strip()
if not re.fullmatch(r"[0-9a-fA-F-]{36}", empresa_id):
    print(f"QUALIA_EMPRESA_ID no parece UUID: {empresa_id!r}", file=sys.stderr)
    sys.exit(1)

raw = os.environ["RAW"]
# Ventana del espejo: los pagos viejos no pueden explicar una nota de débito
# reciente y sólo engordan el CTE.
corte = (date.today() - timedelta(days=150)).isoformat()


def lit(v):
    """Literal SQL con comillas escapadas; None -> NULL."""
    if v is None:
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


pagos = []
for archivo in ("bill-payments.jsonl", "account-payments.jsonl"):
    ruta = os.path.join(raw, archivo)
    if not os.path.exists(ruta):
        print(f"falta el espejo {ruta}", file=sys.stderr)
        sys.exit(1)
    with open(ruta, encoding="utf-8") as f:
        for linea in f:
            linea = linea.strip()
            if not linea:
                continue
            d = json.loads(linea)
            fecha = str(d.get("DocDate") or "")[:10]
            if not fecha or fecha < corte:
                continue
            monto = abs(float(d.get("TotalAmount") or 0))
            if monto <= 0:
                continue
            pagos.append(
                f"({lit(fecha)}::date, {monto:.2f}, {lit(d.get('CurrencyID') or 'DOP')}, "
                f"{lit(d.get('Beneficiary') or d.get('RelationshipName'))}, {lit(d.get('DocID'))})"
            )

# El CTE tiene que existir aunque el espejo esté vacío: una fila imposible.
pagos_values = ",\n         ".join(pagos) or "('1900-01-01'::date, -1, 'DOP', null, null)"

# A quién se le paga un impuesto. Sale de los beneficiarios REALES del espejo,
# no de una lista inventada; se amplía cuando aparezca un organismo nuevo.
RX_FISCAL = r"dgii|impuestos internos|tesoreria|seguridad social|\mtss\M|aduanas|\mdga\M"

print(f"""
with pagos_adm(fecha, monto, moneda, beneficiario, docid) as (
  values {pagos_values}
),
notas as (
  select t.id, t.fecha_posteo as fecha, abs(t.monto) as monto, a.moneda,
         trim(t.descripcion) as descripcion, t.nro_referencia,
         a.banco, a.nombre as cuenta_nombre, a.numero as cuenta_numero
    from openbanking_transactions t
    join openbanking_accounts a on a.id = t.account_id
   where a.empresa_id = '{empresa_id}'
     and t.monto < 0
     and t.fecha_posteo >= current_date - interval '120 days'
     and t.descripcion ~* 'nota de debito'
     -- Ya reclamada por un trabajo VIVO — mismo bloque que sugerir-cargos.sh
     -- y que `idsLevantados()` en la mesa. Las dos mitades importan:
     --
     -- Vivo: un documento anulado o borrado en ADM deja de reclamar su
     -- movimiento, porque anular es casi siempre el paso previo a registrarlo
     -- bien. Sin esto, la primera sugerencia se quedaba con la nota para
     -- siempre y corregir un registro equivocado no tenía salida.
     --
     -- Y las CINCO formas de reclamar, no sólo `banco_tx_id`: el comprobante
     -- fiscal reclama sus movimientos por el array `movimientos` y la
     -- transferencia por sus dos patas. El 2026-08-04, mirando sólo
     -- `banco_tx_id`, 40 cargos con su comprobante vivo volvieron a sugerirse
     -- uno por uno — acá el mismo agujero re-sugería la nota aunque otro
     -- trabajo ya la tuviera amparada.
     and not exists (
       select 1 from qualia_trabajos q
        where q.empresa_id = '{empresa_id}'
          and q.propuesta->'registro_adm'->>'anulado_en' is null
          and q.propuesta->'registro_adm'->>'eliminado_en' is null
          and ( q.propuesta->>'banco_tx_id' = t.id::text
             or q.propuesta->'origen'->>'banco_tx_id' = t.id::text
             or q.propuesta->'destino'->>'banco_tx_id' = t.id::text
             or q.propuesta->'banco_tx_ids' @> to_jsonb(t.id::text)
             or q.propuesta->'movimientos' @> to_jsonb(t.id::text) )
     )
   order by t.fecha_posteo
   limit 40
),
-- El cruce: misma moneda, fecha con holgura (el asiento en ADM no siempre lleva
-- el día del banco) y monto hasta UN PESO de diferencia.
--
-- El peso de tolerancia no es pereza: medido el 2026-08-04, la nota de débito
-- del 30/06 por RD$6.195,19 es el pago a Claro que ADM tiene como RD$6.195,16
-- —tres centavos, el mismo día— y con tolerancia de un centavo se perdía. El
-- siguiente candidato más cercano de todo el espejo está a 28 pesos, así que un
-- peso separa sin inventar. Cuando la diferencia pasa del centavo, la propuesta
-- lo dice (`dif_monto`) en vez de afirmar que son idénticos.
cruce as (
  select n.*, p.beneficiario, p.docid, p.fecha as fecha_adm,
         round(abs(p.monto - n.monto), 2) as dif_monto
    from notas n
    left join lateral (
      select * from pagos_adm pa
       where pa.moneda = n.moneda
         and abs(pa.monto - n.monto) < 1.00
         and abs(pa.fecha - n.fecha) <= 5
       order by abs(pa.monto - n.monto), abs(pa.fecha - n.fecha)
       limit 1
    ) p on true
),
clasificadas as (
  select c.*,
         case
           when c.docid is null then 'registrar'
           when coalesce(c.beneficiario, '') ~* '{RX_FISCAL}' then 'volante'
           else 'nada'
         end as accion
    from cruce c
)
insert into qualia_trabajos (empresa_id, tipo, origen, estado, resumen, propuesta)
select '{empresa_id}', 'sugerencia', 'cron_conciliacion', 'propuesta',
       case when c.accion = 'volante'
            then 'Falta el volante: ' || coalesce(c.beneficiario, 'impuesto') || ' ' ||
                 to_char(c.fecha, 'DD/MM') || ' — ' ||
                 case when c.moneda = 'USD' then 'US$' else 'RD$' end ||
                 to_char(c.monto, 'FM999,999,990.00') || ' (ya registrado, ' || c.docid || ')'
            else 'Nota de débito sin identificar ' || to_char(c.fecha, 'DD/MM') || ' — ' ||
                 case when c.moneda = 'USD' then 'US$' else 'RD$' end ||
                 to_char(c.monto, 'FM999,999,990.00') ||
                 ' (' || c.banco || ' · ' || coalesce(c.cuenta_nombre, c.cuenta_numero) || ')'
       end,
       jsonb_strip_nulls(jsonb_build_object(
         'banco_tx_id', c.id::text,
         'clase', 'nota_debito',
         -- Lo que hay que HACER, que es distinto de lo que la cosa ES. La
         -- pantalla agrupa por esto: un volante se adjunta, una nota sin
         -- identificar se decide.
         'accion', case when c.accion = 'volante' then 'adjuntar_volante' else 'registrar' end,
         'direccion', 'cargo',
         'fecha', c.fecha,
         'monto', c.monto,
         'moneda', c.moneda,
         'descripcion', c.descripcion,
         'referencia_banco', c.nro_referencia,
         'banco', c.banco,
         'cuenta_banco', coalesce(c.cuenta_nombre, ''),
         'cuenta_numero', coalesce(c.cuenta_numero, ''),
         'metodo', 'script',
         'confianza', case when c.accion = 'volante' then 0.9 else 0.4 end,
         -- El pago que ya existe en ADM, cuando lo hay. Es la prueba de que no
         -- hay que registrar nada.
         'pago_adm', case when c.docid is not null then jsonb_strip_nulls(jsonb_build_object(
           'docid', c.docid, 'fecha', c.fecha_adm, 'beneficiario', c.beneficiario,
           -- Sólo si NO es idéntico: un cero acá se leería como ruido, y una
           -- diferencia callada como certeza que no hay.
           'dif_monto', case when c.dif_monto > 0.01 then c.dif_monto end)) end,
         -- SIN documento_adm a propósito: el poller sólo automatiza el registro
         -- de VendorBills y BankCharges, y ninguna de estas dos ramas se
         -- registra sola. Falla cerrada.
         'detalle', case when c.accion = 'volante' then
             'Este pago YA está registrado en ADM (' || c.docid || ', ' ||
             coalesce(c.beneficiario, '') || '). No hay nada contable que hacer: falta el ' ||
             'VOLANTE del impuesto —el papel de la declaración, no el comprobante de pago— ' ||
             'para soportar el gasto.'
           else
             'Ningún pago registrado en ADM coincide con este monto y fecha, así que no ' ||
             'llegó por el flujo de facturas: suele ser un abono a préstamo o a línea de ' ||
             'crédito. Referencia del banco: ' || coalesce(c.nro_referencia, 's/n') ||
             '. Identificá contra qué va antes de registrarlo.'
         end
       ))
  from clasificadas c
 where c.accion <> 'nada'
returning resumen;
""")
PY
)

# Ensayo: corre el INSERT de verdad y lo deshace. Con --no-agent el cron entrega
# el stdout y nada más, así que "sin salida" es ambiguo entre "no había nada" y
# "el script murió"; el ensayo es la única forma de distinguirlos sin sembrar.
if [ "${QUALIA_DRY_RUN:-0}" = "1" ]; then
  echo "=== ENSAYO (nada se guarda) ==="
  PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -q -c "begin; $SQL rollback;"
  exit 0
fi

nuevas=$(PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -t -A -q -c "$SQL" | grep -c . || true)

if [ "${nuevas:-0}" -gt 0 ]; then
  echo "Mesa de trabajo: $nuevas nota(s) de débito del banco que necesitan una mano — volante de impuesto o identificar contra qué van."
fi
