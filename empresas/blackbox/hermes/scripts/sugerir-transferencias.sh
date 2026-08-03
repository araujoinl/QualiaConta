#!/bin/bash
# Sugerencias de transferencias entre cuentas propias — cron --no-agent del
# gateway Hermes. CERO tokens. Hermano de sugerir-cargos.sh.
#
# Mover plata de una cuenta propia a otra no es ingreso ni gasto, pero SÍ es un
# documento que la contabilidad tiene que registrar: en ADM es una
# "Transferencia Banco a Banco" (BankBankTransfers). El banco la reporta como
# DOS movimientos —un débito en la cuenta que da y un crédito en la que
# recibe— y la mesa los muestra como UNA sola fila: se aprueba la transferencia
# entera, no cada pata por separado.
#
# LA SEÑAL: las dos patas comparten el `nro_referencia` del banco. No se
# empareja por monto y fecha (eso confunde dos pagos iguales del mismo día);
# se empareja por la referencia, y sólo se acepta una referencia que describa
# UN movimiento: exactamente una salida, exactamente una entrada, en dos
# cuentas distintas. Una referencia con más patas es otra cosa (un cargo y su
# impuesto comparten referencia en Santa Cruz) y se descarta entera.
#
# CAMBIO DE MONEDA: una transferencia DOP -> USD tiene montos distintos en cada
# pata. ADM lo modela nativamente (TotalAmount en la moneda de origen, ToAmount
# en la de destino, ExchangeRate). La tasa sale de dividir el lado en pesos
# entre el lado en dólares — es aritmética, no criterio — pero la propuesta
# nace con menos confianza porque la tasa del libro puede diferir de la del
# banco y esa diferencia es una partida más.
#
# ANTI-DUPLICADO, dos capas:
#   1) contra la mesa: ninguna de las dos patas puede estar ya en un trabajo.
#   2) contra ADM: el espejo de BankBankTransfers (preentrenamiento/raw) dice
#      qué transferencias ya están registradas. Sin esta capa el detector
#      propondría de nuevo lo que la contabilidad ya asentó — medido el
#      2026-08-03: 8 de 11 pares del mes ya estaban en ADM. El espejo lo
#      refresca mesa/refrescar-precedentes.sh cada madrugada; si faltara, el
#      script AVISA y no siembra nada (mejor callado que duplicando).
#
# Aprobar NO registra en ADM todavía: asienta la decisión en el libro. La
# escritura de este tipo de documento es trabajo aparte.
#
# Env: QUALIA_DSN, QUALIA_EMPRESA_ID. Opcionales QUALIA_MAPA_CUENTAS
# (default /mapa-cuentas.yaml) y QUALIA_ADM_TRANSFERENCIAS (default el espejo).
# stdout vacío = silencio (--no-agent).

set -euo pipefail
: "${QUALIA_DSN:?falta QUALIA_DSN}"
: "${QUALIA_EMPRESA_ID:?falta QUALIA_EMPRESA_ID}"
MAPA="${QUALIA_MAPA_CUENTAS:-/mapa-cuentas.yaml}"
ESPEJO="${QUALIA_ADM_TRANSFERENCIAS:-/opt/data/preentrenamiento/raw/bank-transfers-detalle.jsonl}"
CUENTAS_ADM="${QUALIA_ADM_CUENTAS:-/opt/data/preentrenamiento/raw/accounts.jsonl}"

# Días hacia atrás que se miran. Las patas se leen con margen extra: una
# transferencia cuyo crédito cae un día después del corte quedaría con una sola
# pata visible y la referencia se descartaría por "incompleta".
DIAS="${QUALIA_DIAS_TRANSFERENCIAS:-30}"
MARGEN=5

# `uv run --with pyyaml` y no `python3` a secas porque **`python3` resuelve a
# dos intérpretes distintos según quién invoque el script**: bajo el cron del
# gateway el PATH arranca con `/opt/hermes/.venv/bin`, cuyo python SÍ trae
# PyYAML; por un `docker exec` pelado cae a `/usr/bin/python3`, que NO lo trae.
# Con uv el script corre igual en los dos contextos, que es lo que permite
# ensayarlo a mano (QUALIA_DRY_RUN=1) sin depender del cron.
SQL=$(MAPA="$MAPA" ESPEJO="$ESPEJO" CUENTAS_ADM="$CUENTAS_ADM" DIAS="$DIAS" MARGEN="$MARGEN" \
      uv run --quiet --with pyyaml python - <<'PY'
import json, os, re, sys

import yaml

empresa_id = os.environ["QUALIA_EMPRESA_ID"].strip()
if not re.fullmatch(r"[0-9a-fA-F-]{36}", empresa_id):
    print(f"QUALIA_EMPRESA_ID no parece UUID: {empresa_id!r}", file=sys.stderr)
    sys.exit(1)

dias = int(os.environ["DIAS"])
margen = int(os.environ["MARGEN"])

with open(os.environ["MAPA"], encoding="utf-8") as f:
    config = yaml.safe_load(f) or {}

empresas = config.get("empresas") or {}
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


# --- Cuenta contable de cada cuenta bancaria -------------------------------
bancos = []
for c in bloque.get("cuentas") or []:
    if c.get("numero") and c.get("cuenta_contable"):
        bancos.append(
            f"({lit(str(c['numero']))}, {lit(c['cuenta_contable'])}, "
            f"{lit(c.get('cuenta_nombre') or c.get('alias'))})"
        )
bancos_values = ",\n         ".join(bancos) or "('__sin_mapa__', null, null)"

# --- Lo que ADM ya tiene registrado ----------------------------------------
# Sin espejo no se siembra: proponer a ciegas duplica asientos, y un asiento
# duplicado en el banco no lo frena nadie (ADM no valida transferencias
# repetidas). Se aborta con aviso.
# Una línea ilegible no puede matar la corrida: el espejo lo escribe otro
# proceso y una bajada interrumpida deja la última línea a medias. Se saltan
# las rotas y se sigue; si NINGUNA sirve, ahí sí se aborta.
def filas(ruta):
    with open(ruta, encoding="utf-8") as f:
        for linea in f:
            linea = linea.strip()
            if not linea:
                continue
            try:
                yield (json.loads(linea) or {}).get("data") or {}
            except json.JSONDecodeError:
                continue


try:
    codigo_de_cuenta = {}
    for d in filas(os.environ["CUENTAS_ADM"]):
        if d.get("ID"):
            codigo_de_cuenta[d["ID"]] = d.get("Code")

    registradas = []
    for d in filas(os.environ["ESPEJO"]):
        fecha = (d.get("DocDate") or "")[:10]
        if not fecha or d.get("Void"):
            continue
        registradas.append(
            f"({lit(fecha)}::date, {float(d.get('TotalAmount') or 0):.2f}, "
            f"{float(d.get('ToAmount') or 0):.2f}, "
            f"{lit(codigo_de_cuenta.get(d.get('CashAccountID')))}, "
            f"{lit(codigo_de_cuenta.get(d.get('DebitAccountID')))})"
        )
except OSError as e:
    print(f"no puedo leer el espejo de transferencias de ADM ({e}); no siembro nada", file=sys.stderr)
    sys.exit(2)

if not registradas:
    print(f"el espejo de transferencias de ADM está vacío ({os.environ['ESPEJO']}); no siembro nada", file=sys.stderr)
    sys.exit(2)

adm_values = ",\n         ".join(registradas)

print(f"""
with bancos_gl(numero, gl_codigo, gl_nombre) as (
  values {bancos_values}
),
adm_reg(fecha, monto_origen, monto_destino, cta_origen, cta_destino) as (
  values {adm_values}
),
patas as (
  select t.id, t.account_id, a.numero, a.nombre as cuenta_banco, a.moneda, a.banco,
         t.fecha_posteo as fecha, t.monto, trim(t.descripcion) as descripcion,
         nullif(trim(t.nro_referencia), '') as ref
    from openbanking_transactions t
    join openbanking_accounts a on a.id = t.account_id
   where a.empresa_id = '{empresa_id}'
     and t.fecha_posteo >= current_date - interval '{dias + margen} days'
     and nullif(trim(t.nro_referencia), '') is not null
),
-- Una referencia sirve sólo si describe UN movimiento entre DOS cuentas.
-- (En Santa Cruz un cargo y su impuesto comparten referencia: dos débitos en
-- la misma cuenta. Eso no es una transferencia y la referencia entera cae.)
refs_limpias as (
  select ref
    from patas
   group by ref
  having count(*) filter (where monto < 0) = 1
     and count(*) filter (where monto > 0) = 1
     and count(distinct account_id) = 2
),
pares as (
  select s.id as salida_id, e.id as entrada_id, s.ref,
         s.fecha, s.banco,
         abs(s.monto) as monto_origen, e.monto as monto_destino,
         s.moneda as moneda_origen, e.moneda as moneda_destino,
         s.numero as origen_numero, s.cuenta_banco as origen_banco, s.descripcion as origen_desc,
         e.numero as destino_numero, e.cuenta_banco as destino_banco, e.descripcion as destino_desc
    from patas s
    join patas e on e.ref = s.ref and s.monto < 0 and e.monto > 0
   where s.ref in (select ref from refs_limpias)
     and s.fecha >= current_date - interval '{dias} days'
     and abs(e.fecha - s.fecha) <= 3
),
enriquecidos as (
  select p.*,
         o.gl_codigo as origen_gl, o.gl_nombre as origen_gl_nombre,
         d.gl_codigo as destino_gl, d.gl_nombre as destino_gl_nombre,
         (p.moneda_origen is distinct from p.moneda_destino) as cambia_moneda,
         -- El asiento se escribe en pesos: si un lado es DOP, ése manda.
         case when p.moneda_origen = 'DOP' then p.monto_origen
              when p.moneda_destino = 'DOP' then p.monto_destino
              else p.monto_origen end as monto_asiento,
         case when p.moneda_origen is distinct from p.moneda_destino then
           round(
             (case when p.moneda_origen = 'DOP' then p.monto_origen else p.monto_destino end)
             / nullif(case when p.moneda_origen = 'DOP' then p.monto_destino else p.monto_origen end, 0)
           , 4) end as tasa
    from pares p
    left join bancos_gl o on o.numero = p.origen_numero
    left join bancos_gl d on d.numero = p.destino_numero
),
nuevos as (
  select p.* from enriquecidos p
   where not exists (
           select 1 from qualia_trabajos q
            where q.empresa_id = '{empresa_id}'
              and ( q.propuesta->>'banco_tx_id' in (p.salida_id::text, p.entrada_id::text)
                 or exists (
                      select 1
                        from jsonb_array_elements_text(
                               case when jsonb_typeof(q.propuesta->'banco_tx_ids') = 'array'
                                    then q.propuesta->'banco_tx_ids' else '[]'::jsonb end) x(v)
                       where x.v in (p.salida_id::text, p.entrada_id::text)) )
         )
     and not exists (
           select 1 from adm_reg r
            where abs(r.fecha - p.fecha) <= 5
              and abs(r.monto_origen - p.monto_origen) < 0.01
              and abs(r.monto_destino - p.monto_destino) < 0.01
              and (r.cta_origen is null or p.origen_gl is null or r.cta_origen = p.origen_gl)
              and (r.cta_destino is null or p.destino_gl is null or r.cta_destino = p.destino_gl)
         )
   order by p.fecha
   limit 40
)
insert into qualia_trabajos (empresa_id, tipo, origen, estado, resumen, propuesta)
select '{empresa_id}', 'sugerencia', 'cron_conciliacion', 'propuesta',
       'Transferencia entre cuentas ' || to_char(n.fecha, 'DD/MM') || ': ' ||
         coalesce(n.origen_banco, n.origen_numero) || ' → ' ||
         coalesce(n.destino_banco, n.destino_numero) || ' — ' ||
         case when n.moneda_origen = 'USD' then 'US$' else 'RD$' end ||
         to_char(n.monto_origen, 'FM999,999,990.00') ||
         case when n.cambia_moneda then
           ' → ' || case when n.moneda_destino = 'USD' then 'US$' else 'RD$' end ||
           to_char(n.monto_destino, 'FM999,999,990.00')
         else '' end ||
         ' (' || n.banco || ')',
       jsonb_strip_nulls(jsonb_build_object(
         'documento_adm', 'BankBankTransfers',
         'banco_tx_ids', jsonb_build_array(n.salida_id::text, n.entrada_id::text),
         'nro_referencia', n.ref,
         'fecha', n.fecha,
         'banco', n.banco,
         -- Cabecera: lo que salió. Es lo que la tabla de la mesa ordena y suma.
         'monto', n.monto_origen,
         'moneda', n.moneda_origen,
         'descripcion', 'Transferencia ' || coalesce(n.origen_banco, n.origen_numero) ||
                        ' → ' || coalesce(n.destino_banco, n.destino_numero),
         'origen', jsonb_build_object(
           'cuenta_banco', coalesce(n.origen_banco, ''), 'cuenta_numero', n.origen_numero,
           'moneda', n.moneda_origen, 'monto', n.monto_origen,
           'cuenta', n.origen_gl, 'cuenta_nombre', n.origen_gl_nombre,
           'descripcion', n.origen_desc, 'banco_tx_id', n.salida_id::text),
         'destino', jsonb_build_object(
           'cuenta_banco', coalesce(n.destino_banco, ''), 'cuenta_numero', n.destino_numero,
           'moneda', n.moneda_destino, 'monto', n.monto_destino,
           'cuenta', n.destino_gl, 'cuenta_nombre', n.destino_gl_nombre,
           'descripcion', n.destino_desc, 'banco_tx_id', n.entrada_id::text),
         'cambio_moneda', n.cambia_moneda,
         'tasa', n.tasa,
         'metodo', 'script',
         'confianza', case when n.origen_gl is null or n.destino_gl is null then 0.4
                           when n.cambia_moneda then 0.6 else 0.9 end,
         -- Partida doble en pesos: entra la cuenta que recibe, sale la que da.
         'lineas', case when n.origen_gl is not null and n.destino_gl is not null then
           jsonb_build_array(
             jsonb_build_object('cuenta', n.destino_gl, 'cuenta_nombre', n.destino_gl_nombre,
               'descripcion', 'Entra a ' || coalesce(n.destino_banco, n.destino_numero),
               'debito', n.monto_asiento, 'credito', 0),
             jsonb_build_object('cuenta', n.origen_gl, 'cuenta_nombre', n.origen_gl_nombre,
               'descripcion', 'Sale de ' || coalesce(n.origen_banco, n.origen_numero),
               'debito', 0, 'credito', n.monto_asiento))
         end,
         'detalle', case
           when n.origen_gl is null or n.destino_gl is null then
             'FALTA UNA CUENTA EN EL MAPA — la cuenta bancaria ' ||
             coalesce(case when n.origen_gl is null then n.origen_numero end, n.destino_numero) ||
             ' no está en mapa-cuentas.yaml, así que no se puede armar el asiento. Completala y volvé a correr el detector.'
           when n.cambia_moneda then
             'Se registrará en ADM como Transferencia Banco a Banco con cambio de moneda: sale ' ||
             to_char(n.monto_origen, 'FM999,999,990.00') || ' ' || n.moneda_origen || ' de ' ||
             n.origen_gl || ' ' || n.origen_gl_nombre || ' y entran ' ||
             to_char(n.monto_destino, 'FM999,999,990.00') || ' ' || n.moneda_destino || ' a ' ||
             n.destino_gl || ' ' || n.destino_gl_nombre || '. Tasa implícita del banco: ' ||
             to_char(n.tasa, 'FM999,990.0000') ||
             ' RD$ por US$ — verificala contra la tasa del libro antes de aprobar; si difieren, la diferencia cambiaria es una partida aparte.'
           else
             'Se registrará en ADM como Transferencia Banco a Banco: débito a ' ||
             n.destino_gl || ' ' || n.destino_gl_nombre || ', crédito a ' ||
             n.origen_gl || ' ' || n.origen_gl_nombre ||
             '. Las dos patas del banco comparten la referencia ' || n.ref ||
             ', así que el par no es una coincidencia de monto.'
         end
       ))
  from nuevos n
returning id;
""")
PY
)

# Ensayo: corre el INSERT de verdad y lo deshace. Muestra exactamente lo que
# sembraría sin sembrarlo — un detector que no se puede ensayar es un detector
# que nadie se anima a tocar.
if [ "${QUALIA_DRY_RUN:-0}" = "1" ]; then
  echo "=== ENSAYO (nada se guarda) ==="
  # El RETURNING va por variable: las comillas simples dentro de un
  # ${var/patron/reemplazo} se las come bash y `propuesta->>'detalle'` llegaba
  # a psql sin comillas, como si `detalle` fuera una columna.
  RET="returning resumen, propuesta->>'detalle' as detalle;"
  PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -q \
    -c "begin; ${SQL/returning id;/$RET} rollback;"
  exit 0
fi

nuevas=$(PGCONNECT_TIMEOUT=10 psql "$QUALIA_DSN" -t -A -q -c "$SQL" | grep -c . || true)

if [ "${nuevas:-0}" -gt 0 ]; then
  echo "Mesa de trabajo: $nuevas transferencia(s) entre cuentas propias sin registrar, agrupadas entrada+salida y sembradas como sugerencia."
fi
