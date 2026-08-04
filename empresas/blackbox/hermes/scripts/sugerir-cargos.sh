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
-- ===========================================================================
-- CARRIL A — los cargos que el banco SÍ factura, agrupados por comprobante.
--
-- Un NCF ampara todos los cargos de (cuenta + concepto + día): las 7 comisiones
-- LBTR del 30/07 son UN comprobante de RD$700, y así es como la contabilidad
-- los registra (un documento por NCF, verificado contra los 159 históricos).
-- ===========================================================================
lineas_comprobante as (
  select c.ncf, c.fecha_emision, c.monto_dop as monto_comprobante,
         l->>'cuenta'            as cuenta,
         l->>'concepto'          as concepto,
         (l->>'montoDop')::numeric as monto_linea,
         (l->>'fecha')::date     as fecha_linea,
         a.id as account_id, a.moneda, a.banco, a.nombre as cuenta_banco
    from openbanking_comprobantes c
    cross join lateral jsonb_array_elements(c.lineas) l
    -- El join por cuenta es lo que ata el comprobante a ESTA empresa, y de paso
    -- deja fuera solos a los productos que no son cuenta corriente (un leasing,
    -- un préstamo): su cargo no aparece en ningún estado de cuenta, así que no
    -- hay nada que conciliar y se tratan aparte.
    join openbanking_accounts a
      on a.numero = l->>'cuenta' and a.empresa_id = '{empresa_id}'
   where c.fecha_emision >= current_date - interval '60 days'
     and not exists (
       select 1 from qualia_trabajos q
        where q.empresa_id = '{empresa_id}'
          and q.propuesta->>'documento_adm' = 'BankCharges'
          and q.propuesta->>'ncf' = c.ncf
     )
),
-- Los cargos de esa cuenta y concepto sumados DÍA POR DÍA. Sumar la ventana
-- entera mezclaría comprobantes vecinos: el 31/07 hay dos NCF del mismo
-- impuesto, uno por los cargos del 30 y otro por los del 31.
por_dia as (
  select li.ncf, li.concepto, li.cuenta, li.monto_linea, li.moneda,
         t.fecha_posteo as dia,
         count(*)                       as movs,
         round(sum(abs(t.monto)), 2)    as suma,
         -- Los ids viajan como texto separado por comas y no como array: un
         -- array_agg de arrays da un multidimensional que unnest no sabe abrir.
         string_agg(t.id::text, ',' order by t.id) as ids
    from lineas_comprobante li
    join openbanking_transactions t
      on t.account_id = li.account_id
     and t.monto < 0
     and upper(trim(t.descripcion)) = upper(li.concepto)
     -- 4 días hacia atrás: el comprobante se emite el día hábil siguiente y un
     -- lunes tiene que poder alcanzar al viernes.
     and t.fecha_posteo between li.fecha_linea - 4 and li.fecha_linea
   group by li.ncf, li.concepto, li.cuenta, li.monto_linea, li.moneda, t.fecha_posteo
),
-- El día bueno es aquel cuya suma CIERRA. En cuentas en dólares nunca va a
-- cerrar —el comprobante viene en pesos— así que ahí se valida que la tasa
-- implícita sea plausible y se guarda para que el humano la vea.
dia_bueno as (
  select *, case when moneda = 'USD' then round(monto_linea / nullif(suma, 0), 4) end as tasa
    from por_dia
   where (moneda <> 'USD' and abs(suma - monto_linea) < 0.01)
      or (moneda =  'USD' and monto_linea / nullif(suma, 0) between 40 and 90)
),
-- Un solo día candidato = resuelto sin ambigüedad. Si hay dos, no se adivina.
linea_resuelta as (
  select ncf, concepto, cuenta, monto_linea, moneda,
         min(dia) as dia, min(movs) as movs, min(suma) as suma_banco,
         min(tasa) as tasa, (array_agg(ids order by dia))[1] as ids,
         count(*) as dias_candidatos
    from dia_bueno
   group by ncf, concepto, cuenta, monto_linea, moneda
),
comprobantes as (
  select li.ncf, li.fecha_emision, li.monto_comprobante, li.banco,
         li.moneda, li.cuenta, li.cuenta_banco,
         count(*)                                             as lineas_total,
         count(r.ncf) filter (where r.dias_candidatos = 1)     as lineas_ok,
         sum(coalesce(r.movs, 0))                              as movs_total,
         max(r.tasa)                                           as tasa,
         string_agg(distinct li.concepto, ' + ')               as conceptos,
         coalesce(string_to_array(string_agg(r.ids, ','), ','), '{{}}'::text[]) as movimiento_ids,
         jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'concepto', li.concepto,
           'cuenta_banco', li.cuenta,
           'monto', li.monto_linea,
           'fecha_cargo', r.dia,
           'movimientos', r.movs,
           'suma_banco', r.suma_banco,
           'tasa_usd', r.tasa,
           'cuenta', m.cuenta,
           'cuenta_nombre', m.cuenta_nombre,
           'sin_resolver', case when r.dias_candidatos is distinct from 1 then true end
         )) order by li.concepto)                              as desglose,
         count(distinct m.cuenta)                              as cuentas_distintas,
         min(m.cuenta)                                         as cuenta_unica,
         min(m.cuenta_nombre)                                  as cuenta_unica_nombre,
         min(b.gl_codigo)                                      as gl_codigo,
         min(b.gl_nombre)                                      as gl_nombre
    from lineas_comprobante li
    left join linea_resuelta r
           on r.ncf = li.ncf and r.concepto = li.concepto and r.cuenta = li.cuenta
    left join lateral (
      select * from mapa mm where mm.dir = 'cargo' and li.concepto ~* mm.rx
       order by mm.prio limit 1
    ) m on true
    left join bancos_gl b on b.numero = li.cuenta
   group by li.ncf, li.fecha_emision, li.monto_comprobante, li.banco,
            li.moneda, li.cuenta, li.cuenta_banco
),
-- ===========================================================================
-- CARRIL B — lo que NINGÚN comprobante ampara: el banco no lo factura (la
-- retención del 1%, los intereses que paga) o todavía no emitió el NCF. Sigue
-- yendo de a un movimiento, como siempre.
-- ===========================================================================
amparados as (
  select unnest(movimiento_ids)::uuid as id from comprobantes
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
     and t.id not in (select id from amparados)
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
),
ins_comprobantes as (
insert into qualia_trabajos (empresa_id, tipo, origen, estado, resumen, propuesta)
select '{empresa_id}', 'sugerencia', 'cron_conciliacion', 'propuesta',
       'Comprobante ' || k.ncf || ' ' || to_char(k.fecha_emision, 'DD/MM') || ': ' ||
         left(k.conceptos, 45) || ' — RD$' || to_char(k.monto_comprobante, 'FM999,999,990.00') ||
         ' (' || k.movs_total || ' cargo' || case when k.movs_total = 1 then '' else 's' end || ')' ||
         ' (' || k.banco || ' · ' || coalesce(k.cuenta_banco, k.cuenta) || ')',
       jsonb_strip_nulls(jsonb_build_object(
         'ncf', k.ncf,
         'direccion', 'cargo',
         'fecha', k.fecha_emision,
         -- El comprobante SIEMPRE viene en pesos, aunque los cargos sean de una
         -- cuenta en dólares: es lo que el banco declaró a DGII y lo que se
         -- registra. La tasa que usó queda en 'tasa_usd' para que se pueda ver.
         'monto', k.monto_comprobante,
         'moneda', 'DOP',
         'tasa_usd', k.tasa,
         'descripcion', k.conceptos,
         'banco', k.banco,
         'cuenta_banco', coalesce(k.cuenta_banco, ''),
         'cuenta_numero', k.cuenta,
         'proveedor', 'Banco ' || k.banco,
         'metodo', 'script',
         'documento_adm', 'BankCharges',
         -- Los movimientos que este comprobante ampara. Van adentro para que la
         -- conciliación sepa qué cubre el documento: sin esto, registrar por
         -- comprobante perdería el vínculo con el estado de cuenta.
         'movimientos', to_jsonb(k.movimiento_ids),
         'movimientos_n', k.movs_total,
         'desglose', k.desglose,
         'confianza', case when k.lineas_ok = k.lineas_total and k.cuentas_distintas = 1 then 0.9
                           when k.lineas_ok = k.lineas_total then 0.7 else 0.4 end,
         -- Cabecera sólo si TODAS las líneas caen en la misma cuenta; si el
         -- comprobante mezcla naturalezas, cada una vive en su renglón.
         'cuenta_contable', case when k.cuentas_distintas = 1 and k.cuenta_unica is not null
           then jsonb_build_object('codigo', k.cuenta_unica, 'nombre', k.cuenta_unica_nombre) end,
         'lineas', case when k.gl_codigo is not null and k.cuentas_distintas >= 1 then
           coalesce((select jsonb_agg(jsonb_build_object(
                       'cuenta', d->>'cuenta', 'cuenta_nombre', d->>'cuenta_nombre',
                       'descripcion', d->>'concepto',
                       'debito', (d->>'monto')::numeric, 'credito', 0))
                      from jsonb_array_elements(k.desglose) d
                     where d->>'cuenta' is not null), '[]'::jsonb)
           || jsonb_build_array(jsonb_build_object(
                'cuenta', k.gl_codigo, 'cuenta_nombre', k.gl_nombre,
                'descripcion', k.banco || ' · ' || coalesce(k.cuenta_banco, k.cuenta),
                'debito', 0, 'credito', k.monto_comprobante))
           end,
         'detalle', case
           when k.lineas_ok < k.lineas_total then
             'OJO: no pude atar todos los cargos de este comprobante a movimientos del banco. ' ||
             'Revisá el desglose antes de aprobar.'
           when k.cuentas_distintas > 1 then
             'Se registrará en ADM como Cargo Bancario con NCF ' || k.ncf ||
             ', por RD$' || to_char(k.monto_comprobante, 'FM999,999,990.00') ||
             ', amparando ' || k.movs_total || ' cargo(s). Mezcla conceptos, así que la cuenta va por renglón.'
           when k.cuenta_unica is null then
             'Ninguna regla del mapa de cargos reconoce «' || k.conceptos ||
             '». Asignale la cuenta antes de aprobar.'
           else
             'Se registrará en ADM como Cargo Bancario con NCF ' || k.ncf ||
             ': débito a ' || k.cuenta_unica || ' ' || coalesce(k.cuenta_unica_nombre, '') ||
             ', crédito al banco ' || coalesce(k.gl_codigo, '?') || ' ' || coalesce(k.gl_nombre, '') ||
             ', por RD$' || to_char(k.monto_comprobante, 'FM999,999,990.00') ||
             ' que ampara ' || k.movs_total || ' cargo(s) del banco.'
         end
       ))
  from comprobantes k
returning resumen
),
ins_movimientos as (
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
returning resumen
)
select resumen from ins_comprobantes
union all
select resumen from ins_movimientos;
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
  # Los dos INSERT ya devuelven `resumen`, así que el ensayo corre el MISMO SQL
  # que la corrida real: antes había que reescribir el RETURNING al vuelo y eso
  # dejaba al ensayo probando una sentencia que no era la de producción.
  PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -q -c "begin; $SQL rollback;"
  exit 0
fi

nuevas=$(PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -t -A -q -c "$SQL" | grep -c . || true)

if [ "${nuevas:-0}" -gt 0 ]; then
  echo "Mesa de trabajo: $nuevas sugerencia(s) nueva(s) — comprobantes fiscales del banco y los cargos que ninguno ampara, con su cuenta contable propuesta."
fi
