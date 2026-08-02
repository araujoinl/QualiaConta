#!/usr/bin/env bash
# Inyector de lotes de destilación — preentrenamiento QualiaConta (Blackbox)
#
# Es el --script del cron agente de Hermes (plan-preentrenamiento §1.3): su
# stdout se inyecta ARRIBA del prompt base de cada turno (bloque
# "## Script Output"). Emite UN lote — agregados pendientes + plan de cuentas
# condensado + plantilla de salida + reglas duras anti-alucinación — y avanza
# el cursor. Cuando NO corresponde turno (destilación completa, tope diario de
# tokens superado, o insumos aún no generados) → stdout VACÍO y el motivo por
# stderr; el prompt base del cron debe decir "sin bloque de lote → respondé
# SIN-LOTE y terminá" para no quemar el turno.
#
# USO:
#   inyector-destilacion.sh [--dry-run] [--estado F] [--agg D] [--plan F]
#                           [--usage F] [--tope N] [--max-tokens-lote N]
#
#   --dry-run          emite el lote SIN avanzar el cursor (prueba)
#   --estado F         cursor JSON   (default /opt/data/preentrenamiento/estado-destilacion.json)
#   --agg D            dir agregados (default /opt/data/preentrenamiento/agg)
#   --plan F           plan de cuentas (default <agg>/plan-cuentas.json)
#   --usage F          usage.jsonl   (default /opt/data/preentrenamiento/usage.jsonl)
#   --tope N           tope diario de tokens (default 500000). Cuenta
#                      input+output+reasoning del día UTC; cache_read NO cuenta.
#   --max-tokens-lote  presupuesto estimado (chars/4) de agregados por lote
#                      (default 12000; el techo total del turno es 35k input)
#
# CRON (el runner exige el script bajo /opt/data/scripts/ → symlink una vez):
#   ln -sf /opt/data/memoria/scripts/inyector-destilacion.sh /opt/data/scripts/
#   hermes cron create "0 * * * *" --name destilacion --script inyector-destilacion.sh \
#     --repeat 30 --deliver local --model glm-5.2 --skill consultar-admcloud \
#     "Sos el contable de Blackbox en fase de preentrenamiento. Si arriba NO hay \
#      un bloque '## Script Output' que empiece con '=== LOTE', respondé exactamente \
#      SIN-LOTE y terminá. Si lo hay, seguí sus instrucciones al pie de la letra."
#
# Si el cron no soporta --usage-file, correr los turnos como one-shots (plan B
# del plan §7): hermes -z "$(/opt/data/memoria/scripts/inyector-destilacion.sh)" \
#   --accept-hooks --usage-file /opt/data/preentrenamiento/usage.jsonl
#
# Rebobinar un lote fallido: el bloque "historial" de estado-destilacion.json
# guarda fase y rango de cada emisión; editar a mano el cursor de esa fase.
#
# Cero LLM y cero red: solo lee/escribe archivos locales del volumen.

set -euo pipefail
exec python3 - "$@" <<'PY'
import argparse, datetime, json, os, re, sys, tempfile

RAIZ = "/opt/data/preentrenamiento"

# Orden y plantilla de cada fase (plan-preentrenamiento §1.3 y §2).
FASES = [
    {
        "id": "proveedores",
        "agg": "vendors-agg.jsonl",
        "max_items": 12,
        "destino": "/opt/data/memoria/proveedores.md",
        "instrucciones": """Destilá CADA proveedor del bloque AGREGADOS a una sección de
/opt/data/memoria/proveedores.md (creá el archivo si no existe, con front-matter:
estado: borrador / aprobo: / evidencia: extracción 2026-08-02). Una sección por
proveedor con actividad (>=2 docs); los de 1 doc van a la tabla residual del final.

Plantilla por sección (respetala tal cual):
## <Nombre del proveedor>
- RNC: <rnc>
- Cuenta(s) de gasto típica(s): <código nombre> (<NN>% del monto histórico)
- ITBIS / retenciones observados: <qué se vio>
- NCF típico: <tipo>
- Vía de pago: <PP|PC> + <cuenta banco>
- Plazo medio de pago: <n días>
- Tratamiento típico: 1-3 líneas en llano. Evidencia: <n> docs, DocIDs <1-2 ejemplos>

Si dos cuentas se reparten ~50/50, la sección se marca `AMBIGUO — preguntar` y
NO propone cuenta única. No inventes datos que el agregado no trae.""",
    },
    {
        "id": "asientos",
        "agg": "journals-agg.json",
        "max_items": 2,
        "destino": "/opt/data/memoria/nomina.md y /opt/data/memoria/criterios.md",
        "instrucciones": """Cada item es un PATRÓN de asientos de diario con su asiento tipo.
Los patrones de nómina (NOMINA / REG. TSS EMPLEADOR / REG.INFOTEP) van a
/opt/data/memoria/nomina.md: el asiento tipo completo (estructura de cuentas
debe/haber, SIN montos por empleado) + mapeo al plan de cuentas + nota "no
verificado línea a línea". Los demás patrones se destilan como criterios
numerados (C-0XX) en /opt/data/memoria/criterios.md: enunciado, evidencia,
alcance propuesto. Los asientos "sin patrón" se listan como pendientes de
revisión, sin inventarles regla. Front-matter estado: borrador en ambos.""",
    },
    {
        "id": "banco",
        "agg": "bancos-agg.json",
        "max_items": 3,
        "destino": "/opt/data/memoria/banco.md",
        "instrucciones": """Destilá a /opt/data/memoria/banco.md (front-matter estado: borrador):
mapa de cuentas bancarias ADM<->openbanking, patrones de cargos (CB*) por
concepto y cuenta, traspasos típicos entre cuentas, y reglas de conciliación
(tarjetas al 5.395%, cuenta de Impact excluida). Cada regla como criterio con
enunciado + evidencia + alcance propuesto.""",
    },
    {
        "id": "ventas",
        "agg": "ventas-agg.json",
        "max_items": 4,
        "destino": "/opt/data/memoria/ventas.md",
        "instrucciones": """Destilá a /opt/data/memoria/ventas.md (front-matter estado: borrador).
SOLO contexto: tipos de comprobante, secuencias, volúmenes por mes, quién
factura (la empresa, jamás QualiaConta) y qué NO tocará nunca el agente.
Ventas no será dominio autónomo: corto por diseño, sin reglas de registro.""",
    },
]

REGLAS_DURAS = """REGLAS DURAS DEL TURNO:
- SOLO podés citar códigos de cuenta que aparezcan en el bloque PLAN DE CUENTAS
  de este prompt. Ningún otro. Si un dato pide una cuenta que no figura ahí,
  escribí "CUENTA NO IDENTIFICADA — revisar" en su lugar.
- Toda regla que enuncies lleva su evidencia: n docs y 1-2 DocIDs de ejemplo
  tomados de los agregados. Sin DocIDs no hay regla.
- Todo archivo de memoria que toques lleva front-matter `estado: borrador`;
  jamás lo pases a ratificado vos (eso lo hace la mesa).
- Un borrador NO es precedente: no lo cites como si lo fuera.
- Nada de credenciales, URLs firmadas ni GUIDs de company en la memoria.
- Cero escrituras fuera de /opt/data/memoria/. Cero llamadas POST a ADM Cloud.
- Al terminar respondé UNA línea: LOTE-OK <fase> <rango> + secciones escritas."""


def ahora_utc():
    return datetime.datetime.now(datetime.timezone.utc)


def est_tokens(texto):
    return len(texto) // 4


def tokens_hoy(path):
    """Suma input+output+reasoning del día UTC en usage.jsonl (tolerante a
    JSONL, objeto suelto o arreglo). Registros sin fecha cuentan como hoy."""
    if not os.path.exists(path):
        print(f"aviso: no existe {path}; tope diario no verificable, sigo", file=sys.stderr)
        return 0
    crudo = open(path, encoding="utf-8").read().strip()
    if not crudo:
        return 0
    regs = []
    try:
        d = json.loads(crudo)
        regs = d if isinstance(d, list) else [d]
    except json.JSONDecodeError:
        for ln in crudo.splitlines():
            ln = ln.strip()
            if ln:
                try:
                    regs.append(json.loads(ln))
                except json.JSONDecodeError:
                    pass
    hoy = ahora_utc().strftime("%Y%m%d")
    total = 0
    for r in regs:
        if not isinstance(r, dict):
            continue
        fecha = None
        m = re.match(r"^(\d{8})_", str(r.get("session_id", "")))
        if m:
            fecha = m.group(1)
        else:
            for k in ("ts", "timestamp", "date", "fecha"):
                m2 = re.search(r"(\d{4})-?(\d{2})-?(\d{2})", str(r.get(k, "")))
                if m2:
                    fecha = "".join(m2.groups())
                    break
        if fecha is None:
            fecha = hoy
        if fecha != hoy:
            continue
        total += int(r.get("input_tokens") or 0) + int(r.get("output_tokens") or 0) \
               + int(r.get("reasoning_tokens") or 0)
    return total


def cargar_plan(path):
    """Plan de cuentas condensado: una línea por cuenta con código real.
    Tolera lista de dicts, {"cuentas": [...]}, o dict codigo->info."""
    d = json.load(open(path, encoding="utf-8"))
    cuentas = None
    if isinstance(d, list):
        cuentas = d
    elif isinstance(d, dict):
        for k in ("cuentas", "accounts", "data", "plan"):
            if isinstance(d.get(k), list):
                cuentas = d[k]
                break
        if cuentas is None:
            cuentas = [dict(v, __code=k) if isinstance(v, dict) else {"__code": k, "nombre": str(v)}
                       for k, v in d.items()]
    lineas = []
    for c in cuentas or []:
        if not isinstance(c, dict):
            continue
        code = c.get("__code") or c.get("codigo") or c.get("Code") or c.get("code") or c.get("Codigo")
        if not code or not re.match(r"^\d+([.-]\d+)*$", str(code)):
            continue  # cuentas sin código contable (GUID) no entran al universo citable
        nombre = c.get("nombre") or c.get("Name") or c.get("name") or ""
        tipo = c.get("tipo") or c.get("AccountTypeName") or c.get("tipo_nombre") or ""
        uso = c.get("uso") or c.get("n_lineas") or c.get("uso_real")
        marca = "  <- sin uso histórico: NO usar" if uso == 0 else ""
        lineas.append(f"{code}  {nombre}" + (f"  [{tipo}]" if tipo else "") + marca)
    return lineas


def cargar_items(path):
    """Items de una fase: .jsonl = una línea por item; .json = elementos del
    arreglo, o la lista bajo patrones/items/grupos, o pares clave-valor."""
    if path.endswith(".jsonl"):
        return [ln.strip() for ln in open(path, encoding="utf-8") if ln.strip()]
    d = json.load(open(path, encoding="utf-8"))
    if isinstance(d, list):
        return [json.dumps(x, ensure_ascii=False) for x in d]
    if isinstance(d, dict):
        for k in ("patrones", "items", "grupos", "bloques"):
            if isinstance(d.get(k), list):
                items = [json.dumps(x, ensure_ascii=False) for x in d[k]]
                resto = {kk: vv for kk, vv in d.items() if kk != k}
                if resto:
                    items.insert(0, json.dumps({"contexto_general": resto}, ensure_ascii=False))
                return items
        return [json.dumps({k: v}, ensure_ascii=False) for k, v in d.items()]
    return [json.dumps(d, ensure_ascii=False)]


def cargar_estado(path):
    if os.path.exists(path):
        return json.load(open(path, encoding="utf-8"))
    return {"version": 1, "fases": {}, "historial": []}


def guardar_estado(path, estado):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(estado, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--estado", default=os.path.join(RAIZ, "estado-destilacion.json"))
    ap.add_argument("--agg", default=os.path.join(RAIZ, "agg"))
    ap.add_argument("--plan", default=None)
    ap.add_argument("--usage", default=os.path.join(RAIZ, "usage.jsonl"))
    ap.add_argument("--tope", type=int, default=500_000)
    ap.add_argument("--max-tokens-lote", type=int, default=12_000)
    args = ap.parse_args()
    plan_path = args.plan or os.path.join(args.agg, "plan-cuentas.json")

    # 1. Tope diario: sin presupuesto no hay lote (stdout vacío = turno nulo).
    gastado = tokens_hoy(args.usage)
    if gastado > args.tope:
        print(f"tope diario superado: {gastado} > {args.tope} tokens hoy (UTC); "
              f"sin lote hasta mañana", file=sys.stderr)
        return 0

    # 2. Plan de cuentas: sin él no se puede cerrar el universo citable.
    if not os.path.exists(plan_path):
        print(f"falta {plan_path}; sin plan de cuentas no hay lote "
              f"(la regla anti-alucinación lo exige). Corré antes la agregación (Capa B).",
              file=sys.stderr)
        return 0
    plan_lineas = cargar_plan(plan_path)
    if not plan_lineas:
        print(f"{plan_path} no trae cuentas con código; lote abortado", file=sys.stderr)
        return 0

    # 3. Elegir fase: la primera, en orden, con agregado presente y sin terminar.
    estado = cargar_estado(args.estado)
    fase = items = None
    for f in FASES:
        st = estado["fases"].setdefault(f["id"], {"cursor": 0, "done": False})
        if st["done"]:
            continue
        ruta = os.path.join(args.agg, f["agg"])
        if not os.path.exists(ruta):
            print(f"aviso: fase {f['id']} sin agregado aún ({f['agg']}); pruebo la siguiente",
                  file=sys.stderr)
            continue
        todos = cargar_items(ruta)
        if st["cursor"] >= len(todos):
            st["done"] = True
            if not args.dry_run:
                guardar_estado(args.estado, estado)
            continue
        fase, items = f, todos
        break
    if fase is None:
        print("sin lotes pendientes: destilación completa (o faltan todos los agregados)",
              file=sys.stderr)
        return 0

    # 4. Armar el lote: corta por cantidad o por presupuesto de tokens.
    st = estado["fases"][fase["id"]]
    ini = st["cursor"]
    lote, tokens = [], 0
    for it in items[ini:ini + fase["max_items"]]:
        t = est_tokens(it)
        if lote and tokens + t > args.max_tokens_lote:
            break
        lote.append(it)
        tokens += t
    fin = ini + len(lote)

    # 5. Emitir el prompt del turno.
    out = []
    out.append(f"=== LOTE DE DESTILACION — fase {fase['id']}, items {ini + 1}-{fin} de {len(items)} ===")
    out.append("")
    out.append(f"Destino: {fase['destino']}")
    out.append("")
    out.append(fase["instrucciones"].strip())
    out.append("")
    out.append(REGLAS_DURAS)
    out.append("")
    out.append(f"=== PLAN DE CUENTAS (universo permitido, {len(plan_lineas)} cuentas) ===")
    out.extend(plan_lineas)
    out.append("")
    out.append("=== AGREGADOS DEL LOTE ===")
    for i, it in enumerate(lote, start=ini + 1):
        out.append(f"--- item {i} ---")
        out.append(it)
    print("\n".join(out))

    # 6. Avanzar cursor (salvo dry-run) y dejar rastro para rebobinar.
    if not args.dry_run:
        st["cursor"] = fin
        if fin >= len(items):
            st["done"] = True
        estado["historial"].append({
            "ts": ahora_utc().isoformat(timespec="seconds"),
            "fase": fase["id"], "desde": ini, "hasta": fin,
            "n_items": len(lote), "tokens_estimados": tokens,
            "tokens_gastados_hoy": gastado,
        })
        guardar_estado(args.estado, estado)
    else:
        print(f"dry-run: cursor de {fase['id']} queda en {ini} (no avanzó)", file=sys.stderr)
    return 0


sys.exit(main())
PY
