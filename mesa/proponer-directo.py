#!/usr/bin/env python3
"""Propone en la mesa una factura de proveedor CONOCIDO, sin sesión LLM.

Es el simétrico de entrada de `registrar_directo` (poller): así como registrar
lo ya aprobado no necesita al contable, PROPONER lo ya resuelto cien veces
tampoco. El turno de análisis completo (mediana 9 llamadas, ~200k tokens de
entrada, ~3 min) se reemplaza por UNA llamada de clasificación (~5k tokens,
~15-30s) — medido 2026-08-07: un documento cerrado costaba ~730k tokens de
entrada y la cuota de z.AI es ~15,1 M por ventana de 5 h.

Lo que este script NO es: un sello a ciegas. La regla del dueño (2026-08-02)
manda que el precedente es un default POR ITEM, y acá se cumple con una llamada
de clasificación que lee CADA renglón contra la cuenta dominante — y con
compuertas deterministas que ante cualquier duda devuelven el trabajo al camino
de siempre (sesión LLM). Preferimos el camino caro al camino equivocado.

Caminos:
  - PRECEDENTE: cuenta dominante >=70% con muestra >=3 (los umbrales de
    buscar-precedente.py). metodo='precedente', precedente_ref del agg.
  - MULTI-CUENTA: proveedor conocido sin dominante (restaurante: consumo +
    propina). La llamada reparte entre las cuentas del HISTORICO del proveedor,
    jamás fuera de ellas, y nunca hacia pasivos (230.xx: el reparto
    capital/interés exige la tabla de amortización, que no existe — ROADMAP
    2b.4). metodo='razonado', sin precedente_ref.

Compuertas que mandan a sesión (NO_PROPONE, exit 3):
  proveedor nuevo o muestra <3 · bloque AMBIGUO en la memoria curada · sin
  items ni texto legible · sin NCF o duplicado posible · DGII no verificada ·
  aritmética que no cuadra · tipo de gasto 606 sin dominante · el modelo
  declara contradicción o confianza <0.90 · cuenta propuesta fuera del
  histórico del proveedor · error de red o de parseo.

La fila sólo se toca en modo real y con claim atómico (pendiente→analizando→
propuesta). En NO_PROPONE no se escribe estado: queda `clasificacion.json` en
la carpeta del trabajo como contexto para la sesión, y el poller hace el poke
de siempre.

Uso:
    proponer-directo.py --trabajo <uuid>              # propone o NO_PROPONE
    proponer-directo.py --trabajo <uuid> --simular    # imprime, no escribe
    proponer-directo.py --trabajo <uuid> --simular --dossier <ruta> --sin-base
        # backtest: dossier explícito y sin tocar la base (ni para leer)

Exit: 0 = propuso (o simulación completa) · 3 = NO_PROPONE (que lo vea la
sesión) · 1 = error duro (también cae a sesión; el poller lo loggea distinto).

Env: QUALIA_DSN, QUALIA_EMPRESA_ID, GLM_API_KEY (u OPENROUTER_API_KEY de
respaldo). Rutas con default del sidecar, sobreescribibles para el backtest:
QUALIA_MESA_DIR (/tmp/mesa), QUALIA_AGG_DIR (/preentrenamiento/agg),
QUALIA_NUCLEO_AGG (/nucleo-contable/agg/rnc-tipo-gasto.json),
QUALIA_MEMORIA_DIR (/memoria).
"""
import argparse
import json
import os
import re
import subprocess
import sys
import unicodedata
import urllib.error
import urllib.request

# Umbrales espejo de buscar-precedente.py: si allá cambian, acá también — son
# LA definición de "precedente citable" y no puede haber dos.
DOMINANTE_MIN = 70.0
MUESTRA_MIN = 3
CONFIANZA_MIN = 0.90
# La web valida sum(precio*cantidad)+sum(itbis) contra monto con este umbral;
# proponer algo que la web pintaría en rojo sería trabajo muerto.
UMBRAL_CUADRE = 0.05

VERSION = 1


def morir(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


def env(nombre):
    v = os.environ.get(nombre)
    if not v:
        morir("falta la variable de entorno %s" % nombre)
    return v


def ruta(nombre, default):
    return os.environ.get(nombre) or default


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s.lower()).strip()


def sql(consulta, **variables):
    cmd = ["psql", env("QUALIA_DSN"), "-X", "-t", "-A", "-F", "\t", "-q",
           "-v", "ON_ERROR_STOP=1"]
    for k, v in variables.items():
        cmd += ["-v", "%s=%s" % (k, v)]
    r = subprocess.run(cmd, input=consulta, capture_output=True, text=True)
    if r.returncode != 0:
        morir("consulta a la mesa fallo: %s" % r.stderr.strip()[:200])
    return [l.split("\t") for l in r.stdout.strip().splitlines() if l.strip()]


def cargar_json(ruta_archivo):
    try:
        return json.load(open(ruta_archivo, encoding="utf-8"))
    except (IOError, ValueError):
        return None


# ─────────────────────────── motivos de NO_PROPONE ───────────────────────────
# Se acumulan y se escriben TODOS: la sesión que herede el trabajo merece saber
# cada compuerta que no pasó, no sólo la primera.

class NoPropone(Exception):
    pass


def buscar_en_agg(agg, rnc):
    """Match EXACTO por RNC (o rncs_alt), como buscar-precedente.py. Por nombre
    no se busca a propósito: el proponedor corre sin humano que confirme una
    coincidencia parcial, y 'fc gestion' vs 'GESTIONES Operativas' ya mordió."""
    for p in agg.get("proveedores") or []:
        if p.get("rnc") == rnc or rnc in (p.get("rncs_alt") or []):
            return p
    return None


def cuentas_candidatas(prov):
    """Las cuentas del proveedor que son OPCIONES reales, no ruido histórico.

    El backtest del 2026-08-07 lo enseñó con TUPAQ: 127 de 131 usos a 620.10 y
    una cuenta 620.11 Combustible con UN uso en 128 facturas — el clasificador
    la vio en la lista y le mandó el renglón «FUEL SURCHARGE», que en un
    courier es parte del flete. Una cuenta con 1-2 usos es la anécdota de una
    excepción, no un destino elegible; el mismo piso de muestra que vale para
    citar un precedente (MUESTRA_MIN) vale para ofrecer una cuenta."""
    return [c for c in prov.get("cuentas") or []
            if c.get("usos", 0) >= MUESTRA_MIN or float(c.get("pct", 0)) >= 5.0]


def ratio_intra_documento(prov):
    """usos-de-cuenta / facturas: cuántas cuentas toca UNA factura típica.

    ~1.0 = cada factura va ENTERA a una cuenta y el proveedor mezcla ENTRE
    facturas (TUPAQ 1.02: flete corriente vs importación — el criterio vive en
    el contexto del negocio, no en el papel). ≥1.5 = varias cuentas POR factura
    (restaurantes 1.75-2.00: consumo + propina legal — el reparto es estructura
    del documento). Solo el segundo caso se puede repartir leyendo el papel."""
    facturas = prov.get("facturas") or 0
    if not facturas:
        return 0.0
    return sum(c.get("usos", 0) for c in prov.get("cuentas") or []) / facturas


RATIO_INTRA_MIN = 1.5


def bloque_memoria(memoria_dir, rnc, nombre):
    """La sección del proveedor en proveedores.md, si existe. Se inyecta al
    prompt como contexto (el tratamiento típico matiza al agg crudo) y su marca
    AMBIGUO es compuerta dura: 'NUNCA se clasifica en autónomo' (regla escrita
    en el propio archivo)."""
    ruta_md = os.path.join(memoria_dir, "proveedores.md")
    try:
        texto = open(ruta_md, encoding="utf-8").read()
    except IOError:
        return None
    for seccion in texto.split("\n## "):
        cuerpo = "## " + seccion if not seccion.startswith("#") else seccion
        if ("RNC: %s" % rnc) in cuerpo or (nombre and norm(nombre) in norm(cuerpo[:120])):
            return cuerpo.strip()[:2500]
    return None


def tipo_gasto_dominante(nucleo_agg, rnc):
    """El tipo de gasto del 606, determinista por RNC de la libreta general.
    Es 'el más firme de los dos ejes' (SKILL): dominante >=70% con usos >=3 se
    fija sin preguntarle al modelo. Sin dominante no se adivina: NO_PROPONE."""
    g = cargar_json(nucleo_agg)
    if not g:
        return None
    fila = next((s for s in g.get("suplidores") or [] if s.get("rnc") == rnc), None)
    tipos = (fila or {}).get("tipos") or []
    if not tipos:
        return None
    top = tipos[0]
    usos = sum(t.get("usos", 0) for t in tipos)
    if usos >= MUESTRA_MIN and float(top.get("pct", 0)) >= DOMINANTE_MIN:
        return {"codigo": str(top["codigo"]), "nombre": str(top["nombre"])}
    return None


def nombres_de_cuentas(agg_dir):
    """codigo -> nombre EXACTO del plan (la propuesta lleva cuenta_nombre y la
    web lo muestra tal cual; un nombre inventado se nota y desconfía)."""
    plan = cargar_json(os.path.join(agg_dir, "plan-cuentas.json")) or {}
    return {str(c.get("codigo")): str(c.get("nombre") or "")
            for c in plan.get("cuentas") or [] if c.get("codigo")}


# ─────────────────────────── la llamada de clasificación ───────────────────────────

def prompt_clasificacion(extr, prov, camino, memoria, propina):
    """Prompt fijo. El modelo NO elige cuentas libres: se le da la lista cerrada
    de candidatas (dominante + resto del histórico) y la instrucción de marcar
    contradiccion=true cuando un renglón no encaja en NINGUNA — capitalizable,
    mercancía para revender, o algo que simplemente no es de este proveedor.
    Esa marca es la implementación de la regla POR ITEM: acá no se fuerza."""
    cuentas = cuentas_candidatas(prov)
    candidatas = "\n".join(
        "  - %s %s (%d usos, %.1f%%)" % (c["codigo"], c["nombre"], c["usos"], c["pct"])
        for c in cuentas[:8])
    if camino == "precedente":
        regla = ("La cuenta dominante es el DEFAULT de cada renglón, y los "
                 "cargos accesorios del servicio principal (fuel surcharge, "
                 "manejo, seguro del envío) van CON el servicio, no a cuentas "
                 "propias. Movés un renglón a OTRA cuenta de la lista sólo si "
                 "su descripción claramente pertenece a ella. Si un renglón "
                 "no encaja en NINGUNA cuenta de la lista (un mueble, un "
                 "equipo, algo capitalizable, mercancía para revender), NO lo "
                 "fuerces: marcá contradiccion=true y explicá cuál.")
    else:
        regla = ("Este proveedor se registra con VARIAS cuentas según el "
                 "concepto de cada renglón (caso típico: consumo de "
                 "restaurante y propina legal van a cuentas distintas). "
                 "Asigná cada renglón a la cuenta de la lista que corresponda "
                 "a su naturaleza. Si alguno no encaja en NINGUNA, marcá "
                 "contradiccion=true y explicá cuál.")

    if extr.get("items"):
        renglones = json.dumps(extr["items"], ensure_ascii=False, indent=1)
        origen = "Renglones leídos del documento (verificados aritméticamente):"
    else:
        texto = ""
        if extr.get("texto_path"):
            try:
                texto = open(extr["texto_path"], encoding="utf-8",
                             errors="replace").read()[:4000]
            except IOError:
                pass
        renglones = texto
        origen = ("No hay renglones estructurados: este es el TEXTO extraído "
                  "del documento. Armá los renglones desde él, sin inventar "
                  "ninguno.")

    encabezado = {k: extr.get(k) for k in
                  ("proveedor", "rnc", "ncf", "fecha", "moneda", "monto", "itbis")
                  if extr.get(k) is not None}
    if propina:
        encabezado["propina_legal"] = propina

    partes = [
        "Sos el clasificador contable de facturas de proveedor de una empresa "
        "dominicana. Respondé SOLO un JSON (sin markdown, sin texto extra).",
        "",
        "FACTURA: " + json.dumps(encabezado, ensure_ascii=False),
        "",
        origen,
        renglones,
        "",
        "CUENTAS CANDIDATAS (histórico real de este proveedor, %d facturas):"
        % prov.get("facturas", 0),
        candidatas,
        "",
        regla,
    ]
    if memoria:
        partes += ["", "MEMORIA DE LA EMPRESA sobre este proveedor (matiza al "
                   "histórico crudo):", memoria]
    partes += [
        "",
        "Si el documento trae propina legal (10%%, Ley 16-92), va como renglón "
        "propio con itbis 0, en la cuenta de propinas de la lista si existe.",
        "Forma exacta de la respuesta: "
        '{"lineas": [{"descripcion": str, "cantidad": number, '
        '"precio": number (unitario SIN ITBIS), "itbis": number (del renglón, '
        '0 si exento), "cuenta": "codigo de la lista", "razon": str corta}], '
        '"contradiccion": true|false, '
        '"contradiccion_detalle": str|null, '
        '"confianza": number 0-1 (qué tan seguro estás del reparto COMPLETO)}. '
        "La suma de precio*cantidad + itbis de todos los renglones debe igualar "
        "el monto del documento. No inventes renglones ni valores.",
    ]
    return "\n".join(partes)


def llamar_modelo(prompt):
    """Una llamada, cadena z.AI -> OpenRouter, thinking apagado donde se puede.
    Mismo patrón (y mismas razones) que la visión de preparar-trabajo.sh: el
    JSON se busca también en reasoning_content porque el respaldo piensa."""
    cadena = []
    if os.environ.get("GLM_API_KEY"):
        cadena.append((
            ruta("GLM_CLASIF_BASE", "https://api.z.ai/api/coding/paas/v4"),
            ruta("GLM_CLASIF_MODEL", "glm-5.2"),
            os.environ["GLM_API_KEY"], True, 60))
    if os.environ.get("OPENROUTER_API_KEY"):
        cadena.append((
            ruta("GLM_CLASIF_BASE_RESPALDO", "https://openrouter.ai/api/v1"),
            ruta("GLM_CLASIF_MODEL_RESPALDO", "z-ai/glm-5.2"),
            os.environ["OPENROUTER_API_KEY"], False, 90))
    if not cadena:
        raise NoPropone("sin GLM_API_KEY ni OPENROUTER_API_KEY: no hay modelo "
                        "para clasificar")

    resp, modelo_usado, ultimo = None, None, "sin intento"
    for base, modelo, llave, thinking, tope in cadena:
        cuerpo = {
            "model": modelo,
            "temperature": 0,
            "max_tokens": 4000,
            "messages": [{"role": "user", "content": prompt}],
        }
        if thinking:
            cuerpo["thinking"] = {"type": "disabled"}
        try:
            req = urllib.request.Request(
                base.rstrip("/") + "/chat/completions",
                data=json.dumps(cuerpo).encode(),
                headers={"Authorization": "Bearer " + llave,
                         "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=tope) as r:
                resp = json.load(r)
            modelo_usado = modelo
            break
        except Exception as e:
            ultimo = type(e).__name__   # nunca el cuerpo: puede traer la llave
    if resp is None:
        raise NoPropone("la llamada de clasificacion fallo (%s)" % ultimo)

    mensaje = resp.get("choices", [{}])[0].get("message", {})
    for origen in ("content", "reasoning_content"):
        contenido = mensaje.get(origen) or ""
        m = re.search(r"\{.*\}", contenido, re.S)
        if not m:
            continue
        try:
            return json.loads(m.group(0)), modelo_usado
        except ValueError:
            continue
    raise NoPropone("la clasificacion no trajo JSON parseable")


def numero(v, tope=10**9):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f, 2) if 0 <= f < tope else None


def validar_lineas(datos, prov, extr, propina, nombres, camino):
    """Las validaciones que NO se le confían al modelo. Cada una es una
    compuerta: fallar cualquiera es NO_PROPONE, nunca un ajuste silencioso —
    despejar números para que la aritmética cierre es exactamente el modo de
    falla (FP00001120) que este camino no puede tener."""
    if datos.get("contradiccion"):
        raise NoPropone("el clasificador marco contradiccion: %s"
                        % str(datos.get("contradiccion_detalle") or "sin detalle")[:200])
    conf = numero(datos.get("confianza"), tope=1.01)
    if conf is None or conf < CONFIANZA_MIN:
        raise NoPropone("confianza %.2f del clasificador, piso %.2f"
                        % (conf if conf is not None else -1, CONFIANZA_MIN))

    # El MISMO filtro de sustancia que armó el menú del prompt: validar contra
    # el histórico crudo dejaría pasar la cuenta-anécdota que el menú excluyó.
    historico = {str(c["codigo"]) for c in cuentas_candidatas(prov)}
    lineas = []
    for it in (datos.get("lineas") or [])[:40]:
        if not isinstance(it, dict):
            raise NoPropone("renglon no es objeto")
        desc = str(it.get("descripcion") or "").strip()[:120]
        cant = numero(it.get("cantidad"))
        prec = numero(it.get("precio"))
        itb = numero(it.get("itbis"))
        cuenta = str(it.get("cuenta") or "").strip()
        if not desc or not cant or prec is None or itb is None:
            raise NoPropone("renglon incompleto (%s)" % (desc[:40] or "sin descripcion"))
        if cuenta not in historico:
            # El mueble en la gasolinera: la cuenta correcta NO está en el
            # histórico del proveedor. Ese caso es EXACTAMENTE el que merece
            # la sesión — acá sólo se registra lo cien veces visto.
            raise NoPropone("cuenta %s fuera del historico del proveedor" % cuenta[:12])
        if camino == "multi" and re.match(r"^2\d\d\.", cuenta):
            # Pasivos (préstamos, leasing): partir la cuota en capital e
            # interés pide la tabla de amortización, que no está en el sistema
            # (ROADMAP 2b.4). Sin ella cualquier reparto está mal.
            raise NoPropone("reparto hacia pasivo %s: pide la tabla de "
                            "amortizacion, va a sesion" % cuenta[:12])
        if cuenta not in nombres:
            raise NoPropone("cuenta %s sin nombre en el plan" % cuenta[:12])
        lineas.append({"descripcion": desc, "cantidad": cant, "precio": prec,
                       "grupo_impuesto": "ITBIS" if itb else "EXENTO",
                       "itbis": itb, "cuenta": cuenta,
                       "cuenta_nombre": nombres[cuenta]})
    if not lineas:
        raise NoPropone("el clasificador no devolvio renglones")

    monto = numero(extr.get("monto"))
    if monto is None:
        raise NoPropone("dossier sin monto")
    base = round(sum(l["precio"] * l["cantidad"] for l in lineas), 2)
    itbis_lineas = round(sum(l["itbis"] for l in lineas), 2)
    calc = round(base + itbis_lineas, 2)
    if abs(calc - monto) > UMBRAL_CUADRE:
        raise NoPropone("aritmetica no cuadra: lineas %.2f vs documento %.2f"
                        % (calc, monto))
    return lineas, conf


# ─────────────────────────── compuertas del dossier ───────────────────────────

def compuertas_dossier(d):
    """Todo lo que tiene que estar VERIFICADO antes de gastar la llamada.
    El orden va de lo barato a lo caro; el primer motivo corta."""
    extr = d.get("extraccion") or {}
    if extr.get("metodo") in (None, "ninguno"):
        raise NoPropone("dossier sin extraccion")
    rnc = str(extr.get("rnc") or "")
    if not re.fullmatch(r"\d{9}|\d{11}", rnc):
        raise NoPropone("sin RNC valido en el dossier")
    ncf = str(extr.get("ncf") or "")
    if not re.fullmatch(r"B\d{10}|E\d{12}", ncf):
        # Sin NCF no hubo dedup verificable ni DGII: existe el caso legitimo
        # (45 de 1.109 historicas) pero es minoria y lo razona la sesion.
        raise NoPropone("sin NCF valido: dedup y DGII no verificables")
    if not extr.get("fecha") or not re.fullmatch(r"\d{4}-\d{2}-\d{2}",
                                                 str(extr.get("fecha"))):
        raise NoPropone("sin fecha valida en el dossier")
    if numero(extr.get("monto")) is None:
        raise NoPropone("sin monto en el dossier")

    dup = d.get("duplicados") or {}
    if not dup.get("verificado"):
        raise NoPropone("duplicados no verificados: %s"
                        % str(dup.get("motivo") or "sin motivo")[:120])
    if dup.get("mesa") or dup.get("adm"):
        raise NoPropone("posible duplicado (mesa: %d, ADM: %d)"
                        % (len(dup.get("mesa") or []), len(dup.get("adm") or [])))

    dgii = d.get("dgii") or {}
    estado = str(dgii.get("estado") or "")
    # e-CF exige timbre Aceptado; impreso exige VIGENTE. 'Aceptado Condicional',
    # 'no verificable' o cualquier otra cosa la pondera la sesión, no esto.
    if ncf.startswith("E") and estado != "Aceptado":
        raise NoPropone("timbre e-CF no Aceptado (estado: %s)" % (estado or "?"))
    if ncf.startswith("B") and estado != "VIGENTE":
        raise NoPropone("NCF impreso no VIGENTE en DGII (estado: %s)" % (estado or "?"))

    arit = extr.get("aritmetica")
    if arit and not arit.get("cuadra"):
        raise NoPropone("la aritmetica del dossier no cuadra")
    if not extr.get("items") and not extr.get("texto_path"):
        raise NoPropone("sin renglones ni texto: no hay que clasificar")
    return extr, rnc, ncf


def armar_propuesta(extr, prov, lineas, conf, camino, tipo_gasto, modelo_usado, rnc):
    itbis_lineas = round(sum(l["itbis"] for l in lineas), 2)
    cuentas_usadas = sorted({l["cuenta"] for l in lineas})
    dominante = (prov.get("cuentas") or [{}])[0]
    if camino == "precedente":
        metodo = "precedente"
        usos = sum(c.get("usos", 0) for c in prov.get("cuentas") or [])
        detalle = ("Cuenta %s por precedente: %d de %d usos de cuenta sobre %d "
                   "facturas históricas de este proveedor. Renglones validados "
                   "uno a uno por el clasificador (sin contradicciones)."
                   % (dominante.get("codigo"), dominante.get("usos", 0), usos,
                      prov.get("facturas", 0)))
    else:
        metodo = "razonado"
        detalle = ("Proveedor conocido sin cuenta dominante (%d facturas "
                   "históricas): reparto por renglón entre sus cuentas de "
                   "siempre (%s), validado contra el histórico."
                   % (prov.get("facturas", 0), ", ".join(cuentas_usadas)))
    detalle += " Propuesto sin sesión LLM (proponedor v%d)." % VERSION

    p = {
        "proveedor": prov.get("nombre") or extr.get("proveedor"),
        "rnc": rnc,
        "ncf": extr.get("ncf"),
        "fecha": extr.get("fecha"),
        "moneda": extr.get("moneda") or "DOP",
        "monto": numero(extr.get("monto")),
        "itbis": numero(extr.get("itbis")) if extr.get("itbis") is not None else itbis_lineas,
        "tipo_gasto": tipo_gasto,
        "documento_adm": "VendorBills",
        "lineas": lineas,
        "metodo": metodo,
        "confianza": conf,
        "detalle": detalle,
        "proponedor": {"version": VERSION, "camino": camino, "modelo": modelo_usado},
    }
    if camino == "precedente":
        p["precedente_ref"] = "agg:proveedor-cuentas.json#%s" % rnc
    if extr.get("numero_factura_suplidor"):
        p["numero_factura_suplidor"] = extr["numero_factura_suplidor"]

    moneda = "US$" if p["moneda"] == "USD" else "RD$"
    resumen = "Factura %s — %s%s" % (
        str(p["proveedor"])[:60], moneda, format(p["monto"], ",.2f"))
    return p, resumen


# ─────────────────────────── escritura en la mesa ───────────────────────────

def claim(trabajo_id, empresa_id):
    filas = sql("""
update qualia_trabajos set estado='analizando'
 where id = :'id' and empresa_id = :'emp' and estado = 'pendiente'
returning id;""", id=trabajo_id, emp=empresa_id)
    return bool(filas)


def soltar(trabajo_id, empresa_id):
    """Devuelve la fila a pendiente si el claim era nuestro. Best effort: si
    esto falla, la red de reservas muertas del poller (20 min) la rescata."""
    try:
        sql("""
update qualia_trabajos set estado='pendiente'
 where id = :'id' and empresa_id = :'emp' and estado = 'analizando';""",
            id=trabajo_id, emp=empresa_id)
    except SystemExit:
        pass


def escribir_propuesta(trabajo_id, empresa_id, propuesta, resumen, evento):
    filas = sql("""
update qualia_trabajos
   set estado = 'propuesta',
       propuesta = :'prop'::jsonb,
       resumen = :'res'
 where id = :'id' and empresa_id = :'emp' and estado = 'analizando'
returning id;""", id=trabajo_id, emp=empresa_id,
                prop=json.dumps(propuesta, ensure_ascii=False), res=resumen)
    if not filas:
        morir("la fila cambio de estado a mitad del claim: no escribo")
    sql("""
insert into qualia_eventos (trabajo_id, autor, tipo, contenido)
values (:'id', 'contable', 'progreso', :'cont');""",
        id=trabajo_id, cont=evento)


def escribir_clasificacion(mesa_dir, trabajo_id, salida):
    """El rastro para la sesión que herede el trabajo: qué se intentó y por qué
    no se propuso. Nunca es fatal — es cortesía, no contrato."""
    try:
        carpeta = os.path.join(mesa_dir, trabajo_id)
        os.makedirs(carpeta, exist_ok=True)
        tmp = os.path.join(carpeta, "clasificacion.json.tmp")
        json.dump(salida, open(tmp, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
        os.replace(tmp, os.path.join(carpeta, "clasificacion.json"))
        # El poller corre como root; el contable como HERMES_UID. Si la carpeta
        # nace acá (caso sin archivo: el prep salió antes de crearla), quedaba
        # root:root y el contable no podía escribir su turno.json — el trabajo
        # moría en 'analizando' (Caso Formax, 2026-08-07). Igual que el
        # `entregar()` de preparar-trabajo.sh: todo lo de /tmp/mesa/<id> es del
        # contable. Best-effort: sin privilegios (backtest local) no hace nada.
        uid = int(os.environ.get("HERMES_UID", "1000"))
        gid = int(os.environ.get("HERMES_GID", "1000"))
        for raiz, dirs, archivos in os.walk(carpeta):
            for nombre in dirs + archivos:
                os.chown(os.path.join(raiz, nombre), uid, gid)
        os.chown(carpeta, uid, gid)
    except OSError:
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trabajo", required=True)
    ap.add_argument("--simular", action="store_true")
    ap.add_argument("--dossier", help="ruta alternativa al dossier (backtest)")
    ap.add_argument("--sin-base", action="store_true",
                    help="no consultar la base (solo con --simular): el "
                         "backtest corre donde no hay psql ni DSN")
    args = ap.parse_args()
    if args.sin_base and not args.simular:
        morir("--sin-base solo vale con --simular")

    if not re.fullmatch(r"[0-9a-f-]{36}", args.trabajo):
        morir("trabajo invalido: no es un UUID")
    empresa_id = env("QUALIA_EMPRESA_ID")
    mesa_dir = ruta("QUALIA_MESA_DIR", "/tmp/mesa")
    agg_dir = ruta("QUALIA_AGG_DIR", "/preentrenamiento/agg")
    nucleo_agg = ruta("QUALIA_NUCLEO_AGG", "/nucleo-contable/agg/rnc-tipo-gasto.json")
    memoria_dir = ruta("QUALIA_MEMORIA_DIR", "/memoria")

    motivos = []
    salida_debug = {"version": VERSION, "trabajo": args.trabajo}
    try:
        if not args.sin_base:
            filas = sql("""
select estado, tipo from qualia_trabajos
 where id = :'id' and empresa_id = :'emp';""", id=args.trabajo, emp=empresa_id)
            if not filas:
                raise NoPropone("sin fila para ese trabajo")
            estado, tipo = filas[0][0], filas[0][1]
            if tipo != "factura":
                raise NoPropone("tipo '%s': el proponedor solo sabe de facturas" % tipo)
            if not args.simular and estado != "pendiente":
                raise NoPropone("estado '%s': solo se propone sobre pendiente" % estado)

        ruta_dossier = args.dossier or os.path.join(mesa_dir, args.trabajo, "dossier.json")
        d = cargar_json(ruta_dossier)
        if not d:
            raise NoPropone("sin dossier legible en %s" % ruta_dossier)
        # El dossier guarda texto_path con la ruta DEL CONTENEDOR; corriendo
        # fuera (backtest) se busca junto al dossier, y si tampoco está ahí se
        # quita: la compuerta de "sin renglones ni texto" decide con la verdad.
        extr0 = d.get("extraccion") or {}
        tp = extr0.get("texto_path")
        if tp and not os.path.exists(tp):
            alterno = os.path.join(os.path.dirname(ruta_dossier), "texto.txt")
            if os.path.exists(alterno):
                extr0["texto_path"] = alterno
            else:
                extr0.pop("texto_path", None)
        extr, rnc, ncf = compuertas_dossier(d)

        agg = cargar_json(os.path.join(agg_dir, "proveedor-cuentas.json"))
        if not agg:
            raise NoPropone("agg proveedor-cuentas.json no montado o ilegible")
        prov = buscar_en_agg(agg, rnc)
        if not prov:
            raise NoPropone("proveedor nuevo: RNC %s sin historico" % rnc)
        if prov.get("facturas", 0) < MUESTRA_MIN:
            raise NoPropone("muestra insuficiente (%d factura(s) historicas)"
                            % prov.get("facturas", 0))
        cuentas = prov.get("cuentas") or []
        if not cuentas:
            raise NoPropone("proveedor sin cuentas en el agg")
        if float(cuentas[0].get("pct", 0)) >= DOMINANTE_MIN:
            camino = "precedente"
        elif ratio_intra_documento(prov) >= RATIO_INTRA_MIN:
            camino = "multi"
        else:
            # Sin dominante Y cada factura entera a una cuenta: el criterio de
            # reparto vive FUERA del documento (¿flete corriente o importación
            # en curso?) y ningún clasificador lo saca del papel. A sesión.
            raise NoPropone(
                "multi entre documentos (ratio %.2f): el reparto depende de "
                "contexto que no esta en el papel" % ratio_intra_documento(prov))
        salida_debug["camino"] = camino
        salida_debug["proveedor"] = prov.get("nombre")

        memoria = bloque_memoria(memoria_dir, rnc, prov.get("nombre"))
        if memoria and "AMBIGUO" in memoria:
            raise NoPropone("la memoria marca AMBIGUO a este proveedor: "
                            "nunca en autonomo")

        tipo_gasto = tipo_gasto_dominante(nucleo_agg, rnc)
        if not tipo_gasto:
            raise NoPropone("tipo de gasto 606 sin dominante para este RNC")

        nombres = nombres_de_cuentas(agg_dir)
        if not nombres:
            raise NoPropone("plan-cuentas.json no montado o ilegible")

        # El claim va ANTES de la llamada (15-30s): mientras clasificamos, la
        # web muestra 'analizando' y nadie más toma la fila. Si de acá en
        # adelante algo falla, se suelta y el poke sigue su camino de siempre.
        if not args.simular:
            if not claim(args.trabajo, empresa_id):
                # Otro proceso la tomó: no es un error nuestro, es la carrera
                # funcionando. Silencio y afuera.
                print("claim perdido: otro proceso tomo el trabajo")
                return 0
        try:
            propina = numero(extr.get("propina"))
            datos, modelo_usado = llamar_modelo(
                prompt_clasificacion(extr, prov, camino, memoria, propina))
            lineas, conf = validar_lineas(datos, prov, extr, propina, nombres,
                                          camino)
            propuesta, resumen = armar_propuesta(
                extr, prov, lineas, conf, camino, tipo_gasto, modelo_usado, rnc)
        except NoPropone:
            if not args.simular:
                soltar(args.trabajo, empresa_id)
            raise

        if args.simular:
            print(json.dumps({"propone": True, "resumen": resumen,
                              "propuesta": propuesta},
                             ensure_ascii=False, indent=2))
            return 0

        evento = ("⚡ Propuesta armada sin sesión LLM (%s): %s. Renglones "
                  "validados contra el histórico del proveedor; confianza %.2f. "
                  "Revisá el desglose y aprobá o corregí."
                  % ("precedente" if camino == "precedente"
                     else "reparto entre cuentas conocidas", resumen, conf))
        escribir_propuesta(args.trabajo, empresa_id, propuesta, resumen, evento)
        escribir_clasificacion(mesa_dir, args.trabajo,
                               dict(salida_debug, propone=True))
        print("PROPUESTO %s: %s" % (camino, resumen))
        return 0

    except NoPropone as e:
        motivos.append(str(e))
        salida_debug.update(propone=False, motivos=motivos)
        if args.simular:
            print(json.dumps(salida_debug, ensure_ascii=False, indent=2))
        else:
            escribir_clasificacion(mesa_dir, args.trabajo, salida_debug)
            print("NO_PROPONE: %s" % "; ".join(motivos))
        return 3


if __name__ == "__main__":
    sys.exit(main())
