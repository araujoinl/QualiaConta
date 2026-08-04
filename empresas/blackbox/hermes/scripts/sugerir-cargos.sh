#!/bin/bash
# Sugerencias de conciliación — cron --no-agent del gateway Hermes. CERO tokens.
#
# Siembra en la mesa de trabajo los movimientos bancarios que la contabilidad
# debe registrar y que no vienen de ventas ni de facturas de compra:
#
#   EGRESOS  → comisiones, impuestos (Imp. 2.0 por 1000, Desc. 1% DGII),
#              manejo/mantenimiento de cuenta, retención por estado de cuenta,
#              sobregiro, intereses.
#   INGRESOS → capitalización de intereses, créditos por pago total,
#              reversos/devoluciones del banco. (Los pagos de clientes NO:
#              esos viven en la conciliación de entradas.)
#
# Las NOTAS DE DÉBITO quedaron fuera a propósito (2026-08-03): no son gasto del
# banco sino pagos a terceros —DGII, Aduanas, TSS— que el estado de cuenta
# refleja con esa descripción genérica y sin beneficiario. Contablemente van
# contra la obligación que cancelan, no contra 640.01, y el banco no da con qué
# identificarlas: sólo el monto, la fecha y un número de referencia. Su lugar es
# la conciliación, donde se cruzan con el recibo del pago. Sembrarlas acá sólo
# lograba que engordaran la cola de decisión sin que nadie pudiera decidirlas
# (9 en julio por RD$479.564,07).
#
# Las regex de detección salen del vocabulario REAL de los estados de cuenta
# (query sobre openbanking_transactions, 2026-08-02). Dedup por
# propuesta->>'banco_tx_id': un movimiento se sugiere UNA sola vez.
#
# Cada sugerencia nace ADEMÁS con su propuesta contable: el bloque `cargos` de
# mapa-cuentas.yaml (regex → cuenta de ADM, sembrado del histórico de 159
# BankCharges) decide la contrapartida, y el bloque `cuentas` pone la cuenta
# contable del banco. Con ambos lados la propuesta trae la partida doble
# (`lineas`) y un `detalle` que dice exactamente qué se registrará. Sin match
# en el mapa ⇒ la sugerencia lo dice y pide ojo humano. La escritura real en
# ADM sigue siendo de la Entrega 2; aprobar solo deja la decisión tomada.
#
# Env: QUALIA_DSN, QUALIA_EMPRESA_ID. Opcional QUALIA_MAPA_CUENTAS (default
# /mapa-cuentas.yaml, el mount ro del contenedor). stdout vacío = silencio
# (--no-agent).

set -euo pipefail
: "${QUALIA_DSN:?falta QUALIA_DSN}"
: "${QUALIA_EMPRESA_ID:?falta QUALIA_EMPRESA_ID}"
MAPA="${QUALIA_MAPA_CUENTAS:-/mapa-cuentas.yaml}"

# El SQL lo arma python: interpola el mapa como CTEs VALUES con literales
# escapados, así el heredoc de bash no pelea con los $ y las regex.
#
# `uv run --with pyyaml` y no `python3` a secas porque **`python3` resuelve a
# dos intérpretes distintos según quién invoque el script**: bajo el cron del
# gateway el PATH arranca con `/opt/hermes/.venv/bin`, cuyo python SÍ trae
# PyYAML; por un `docker exec` pelado cae a `/usr/bin/python3`, que NO lo trae y
# muere con ModuleNotFoundError. Con `python3` el script sólo se podía ejecutar
# desde el cron — probarlo a mano fallaba y parecía un script roto. uv lo
# resuelve igual en los dos contextos (toma el venv activo si ya lo tiene) y es
# el mismo mecanismo con el que la imagen resuelve pypdf y pillow-heif.
SQL=$(MAPA="$MAPA" uv run --quiet --with pyyaml python - <<'PY'
import os, re, sys

import yaml

empresa_id = os.environ["QUALIA_EMPRESA_ID"].strip()
if not re.fullmatch(r"[0-9a-fA-F-]{36}", empresa_id):
    print(f"QUALIA_EMPRESA_ID no parece UUID: {empresa_id!r}", file=sys.stderr)
    sys.exit(1)

with open(os.environ["MAPA"], encoding="utf-8") as f:
    config = yaml.safe_load(f) or {}

empresas = (config.get("empresas") or {})
bloque = next(
    (e for e in empresas.values() if str(e.get("empresa_id", "")).lower() == empresa_id.lower()),
    None,
)
if bloque is None and len(empresas) == 1:
    bloque = next(iter(empresas.values()))
bloque = bloque or {}

def lit(v):
    """Literal SQL con comillas escapadas; None -> NULL."""
    if v is None:
        return "null"
    return "'" + str(v).replace("'", "''") + "'"

reglas = []
for i, r in enumerate(bloque.get("cargos") or []):
    if not r.get("match") or r.get("direccion") not in ("cargo", "credito"):
        continue
    reglas.append(
        f"({i}, {lit(r['direccion'])}, {lit(r['match'])}, "
        f"{lit(r.get('cuenta'))}, {lit(r.get('cuenta_nombre'))}, {lit(r.get('revisar'))})"
    )
bancos = []
for c in bloque.get("cuentas") or []:
    if c.get("numero") and c.get("cuenta_contable"):
        bancos.append(
            f"({lit(str(c['numero']))}, {lit(c['cuenta_contable'])}, {lit(c.get('cuenta_nombre') or c.get('alias'))})"
        )

# Sin reglas o sin bancos el CTE igual debe existir: una fila imposible
# (regex POSIX válida que jamás matchea — ~* no soporta lookahead).
mapa_values = ",\n         ".join(reglas) or "(0, 'nunca', '___nunca___', null, null, null)"
bancos_values = ",\n         ".join(bancos) or "('__sin_mapa__', null, null)"

print(f"""
with mapa(prio, dir, rx, cuenta, cuenta_nombre, revisar) as (
  values {mapa_values}
),
bancos_gl(numero, gl_codigo, gl_nombre) as (
  values {bancos_values}
),
candidatos as (
  select t.id, t.fecha_posteo as fecha, abs(t.monto) as monto, a.moneda,
         trim(t.descripcion) as descripcion,
         a.banco, a.nombre as cuenta_nombre, a.numero as cuenta_numero,
         case when t.monto < 0 then 'cargo' else 'credito' end as direccion
    from openbanking_transactions t
    join openbanking_accounts a on a.id = t.account_id
   where a.empresa_id = '{empresa_id}'
     and t.fecha_posteo >= current_date - interval '30 days'
     and (
       ( t.monto < 0 and t.descripcion ~* '(comisi|cargo|manejo|mantenim|retencion|imp\\.|impuesto|desc\\. *1|dgii|interes|sobregiro|est\\. *cta|transferencia internacional)' )
       or
       ( t.monto > 0 and t.descripcion ~* '(capitalizaci|credito por pago|interes|reverso|devoluci)' )
     )
     and not exists (
       select 1 from qualia_trabajos q
        where q.empresa_id = '{empresa_id}'
          and q.propuesta->>'banco_tx_id' = t.id::text
     )
   order by t.fecha_posteo
   limit 40
),
clasificados as (
  select c.*, m.cuenta, m.cuenta_nombre as contra_nombre, m.revisar,
         b.gl_codigo, b.gl_nombre
    from candidatos c
    left join lateral (
      select * from mapa m
       where m.dir = c.direccion and c.descripcion ~* m.rx
       order by m.prio limit 1
    ) m on true
    left join bancos_gl b on b.numero = c.cuenta_numero
)
insert into qualia_trabajos (empresa_id, tipo, origen, estado, resumen, propuesta)
select '{empresa_id}', 'sugerencia', 'cron_conciliacion', 'propuesta',
       case when c.direccion = 'cargo' then 'Cargo' else 'Crédito' end ||
         ' bancario ' || to_char(c.fecha, 'DD/MM') || ': ' || left(c.descripcion, 45) ||
         ' — ' || case when c.moneda = 'USD' then 'US$' else 'RD$' end ||
         to_char(c.monto, 'FM999,999,990.00') ||
         ' (' || c.banco || ' · ' || coalesce(c.cuenta_nombre, c.cuenta_numero) || ')',
       jsonb_strip_nulls(jsonb_build_object(
         'banco_tx_id', c.id::text,
         'direccion', c.direccion,
         'fecha', c.fecha,
         'monto', c.monto,
         'moneda', c.moneda,
         'descripcion', c.descripcion,
         'banco', c.banco,
         'cuenta_banco', coalesce(c.cuenta_nombre, ''),
         'cuenta_numero', coalesce(c.cuenta_numero, ''),
         'proveedor', 'Banco ' || c.banco,
         'metodo', 'script',
         'confianza', case when c.cuenta is not null then 0.8 else 0.5 end,
         'documento_adm', 'BankCharges',
         'cuenta_contable', case when c.cuenta is not null
           then jsonb_build_object('codigo', c.cuenta, 'nombre', c.contra_nombre) end,
         'lineas', case when c.cuenta is not null and c.gl_codigo is not null then
           case when c.direccion = 'cargo' then jsonb_build_array(
             jsonb_build_object('cuenta', c.cuenta, 'cuenta_nombre', c.contra_nombre,
                                'descripcion', c.descripcion, 'debito', c.monto, 'credito', 0),
             jsonb_build_object('cuenta', c.gl_codigo, 'cuenta_nombre', c.gl_nombre,
                                'descripcion', c.banco || ' · ' || coalesce(c.cuenta_nombre, c.cuenta_numero),
                                'debito', 0, 'credito', c.monto))
           else jsonb_build_array(
             jsonb_build_object('cuenta', c.gl_codigo, 'cuenta_nombre', c.gl_nombre,
                                'descripcion', c.banco || ' · ' || coalesce(c.cuenta_nombre, c.cuenta_numero),
                                'debito', c.monto, 'credito', 0),
             jsonb_build_object('cuenta', c.cuenta, 'cuenta_nombre', c.contra_nombre,
                                'descripcion', c.descripcion, 'debito', 0, 'credito', c.monto))
           end end,
         'detalle', case
           when c.cuenta is not null and c.gl_codigo is not null and c.direccion = 'cargo' then
             'Se registrará en ADM como Cargo Bancario: débito a ' || c.cuenta || ' ' || c.contra_nombre ||
             ', crédito al banco ' || c.gl_codigo || ' ' || c.gl_nombre ||
             '. Cuenta según el mapa de cargos (histórico ADM); el registro se hace al aprobar cuando se encienda la Entrega 2.'
           when c.cuenta is not null and c.gl_codigo is not null then
             'Se registrará en ADM como Cargo Bancario (crédito): débito al banco ' || c.gl_codigo || ' ' || c.gl_nombre ||
             ', crédito a ' || c.cuenta || ' ' || c.contra_nombre ||
             '. Cuenta según el mapa de cargos (histórico ADM); el registro se hace al aprobar cuando se encienda la Entrega 2.'
           when c.cuenta is not null then
             'Contrapartida ' || c.cuenta || ' ' || c.contra_nombre ||
             ' según el mapa de cargos, pero la cuenta bancaria ' || c.cuenta_numero ||
             ' no está en mapa-cuentas.yaml — completala para armar el asiento.'
           when c.revisar is not null then 'SIN CUENTA ASIGNADA — ' || c.revisar || '.'
           else 'SIN CUENTA ASIGNADA — ninguna regla del mapa de cargos reconoce esta descripción. Revisala con el contable antes de aprobar.'
         end
       ))
  from clasificados c
returning id;
""")
PY
)

# Ensayo: corre el INSERT de verdad y lo deshace. Mismo mecanismo que
# sugerir-transferencias.sh. Hace falta porque con --no-agent el cron entrega
# el stdout y nada mas: una corrida sin salida queda registrada como "silent
# (empty output)", que se lee igual si no habia nada que sugerir que si el
# script murio. El ensayo es la unica forma de distinguir los dos casos sin
# sembrar.
if [ "${QUALIA_DRY_RUN:-0}" = "1" ]; then
  echo "=== ENSAYO (nada se guarda) ==="
  # El RETURNING va por variable: bash se come las comillas simples dentro de
  # un ${var/patron/reemplazo}.
  RET="returning resumen;"
  PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -q \
    -c "begin; ${SQL/returning id;/$RET} rollback;"
  exit 0
fi

nuevas=$(PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -t -A -q -c "$SQL" | grep -c . || true)

if [ "${nuevas:-0}" -gt 0 ]; then
  echo "Mesa de trabajo: $nuevas movimiento(s) bancario(s) sin registrar, sembrados como sugerencia con su cuenta contable propuesta."
fi
