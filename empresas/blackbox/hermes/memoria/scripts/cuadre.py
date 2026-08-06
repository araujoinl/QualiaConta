"""Cuadrar los renglones de una factura con la aritmetica de ADM.

ADM no acepta el ITBIS que uno le manda: lo recalcula. Su regla, verificada el
2026-08-05 leyendo los Items de FP00001113, FP00001102 y FP00001095:

    Net_i   = redondear(Quantity_i x Price_i)
    Tax_i   = redondear(Net_i x TaxPercent_i)      solo si el renglon tiene tasa
    Total   = suma de (Net_i + Tax_i)

y redondea MEDIO HACIA ARRIBA, no como Python. 334,75 x 18% = 60,255: ADM lo
sube a 60,26 y `round()` de Python lo baja a 60,25. Esa sola diferencia explica
la mitad de los descuadres.

La otra mitad no tiene nada que ver con el ITBIS: es la multiplicacion. La
FP00001095 es gasolina exenta, 2,48 galones x 302,41 = 749,9768, que ADM guarda
como 749,98 cuando el papel dice 750,00.

Por eso el arreglo no es «calcular el ITBIS como ADM» —eso ya lo hace ADM solo—
sino ELEGIR EL PRECIO para que su cuenta caiga en el total del papel. Se mueve
el precio, nunca el total: el total es el dato del documento fiscal.
"""
from decimal import Decimal, ROUND_HALF_UP

CENTAVO = Decimal("0.01")


def r2(x):
    """Redondeo a dos decimales MEDIO HACIA ARRIBA, como ADM.

    Con `round()` de Python esto daria distinto: usa medio-al-par y ademas
    arrastra el error del float (round(60.255, 2) -> 60.25). Se pasa por str
    para que Decimal tome el valor escrito y no su aproximacion binaria.
    """
    return Decimal(str(x)).quantize(CENTAVO, rounding=ROUND_HALF_UP)


def total_segun_adm(items):
    """Lo que ADM va a guardar como total, dados los renglones que se le mandan."""
    total = Decimal("0")
    for it in items:
        net = r2(Decimal(str(it["Quantity"])) * Decimal(str(it["Price"])))
        pct = Decimal(str(it.get("TaxPercent") or 0))
        tax = r2(net * pct / Decimal("100")) if it.get("TaxScheduleID") else Decimal("0")
        total += net + tax
    return total


def redondear(x, decimales):
    """Redondeo medio hacia arriba a la cantidad de decimales que se pida."""
    paso = Decimal(1).scaleb(-decimales)
    return Decimal(str(x)).quantize(paso, rounding=ROUND_HALF_UP)


# Con cuantos decimales se prueba el precio, en orden.
#
# Dos primero, porque un precio con dos decimales es lo que dice el papel y lo
# que cualquiera espera ver en la pantalla de ADM.
#
# Tres cuando dos no alcanzan, y no es un invento: ADM YA guarda precios de tres
# decimales (la FP00001032 tiene 508,476) y cantidades de cinco (la FP00001108
# tiene 2,21828 galones). Hacen falta para el combustible: con 2,45 galones un
# centavo de precio mueve dos centavos y medio el neto, asi que el total que se
# busca cae ENTRE dos saltos y con dos decimales es inalcanzable. Con tres, el
# paso baja a un cuarto de centavo y se alcanza.
DECIMALES_PRECIO = (2, 3)


def cuadrar_items(items, total_papel, margen_centavos=25):
    """Ajusta el precio de UN renglon para que ADM llegue al total del papel.

    Devuelve (items, ajuste). `ajuste` es None cuando ya cerraba —el caso de 49
    de las 63— y si no, un dict con `renglon`, `antes`, `despues` y `movido`.

    Es un dict y no el monto movido a secas por una razon concreta: con tres
    decimales el movimiento puede ser de milesimas y redondeado a pesos da cero,
    o sea FALSO. Quien lo llama loguearia «no toque nada» habiendo cambiado un
    precio. Un precio que se mueve en silencio es exactamente lo que no puede
    pasar en un documento fiscal.

    Elige el renglon a mover con este orden:
      1. uno EXENTO, si lo hay: mover su precio cambia el total uno a uno, sin
         que el ITBIS se mueva atras y descuadre de nuevo;
      2. si no, el de mayor importe, donde un centavo pesa relativamente menos.

    Busca por centavos en vez de despejar la formula, y es a proposito: el
    redondeo del ITBIS hace que el total NO sea una funcion continua del precio
    —hay saltos— asi que despejar da un valor que al redondear no cae donde uno
    calculo. Probar es exacto y son 25 intentos como maximo.

    Si no encuentra nada dentro del margen NO rompe: devuelve los items como
    estaban. Un centavo de diferencia es preferible a no registrar la factura.
    """
    objetivo = r2(total_papel)
    if not items or objetivo <= 0:
        return items, None
    if total_segun_adm(items) == objetivo:
        return items, None

    # Se prueban TODOS los renglones, no solo uno, y eso no es exceso: por el
    # redondeo del ITBIS un renglon puede no poder llegar al total mientras otro
    # si. En la FP00001113 el renglon grande salta de 753,99 a 754,01 sin pisar
    # nunca 754,00 —su ITBIS cruza el medio centavo justo ahi— y el chico lo
    # alcanza moviendo un centavo. Probando uno solo, esa factura quedaba
    # marcada como irreparable siendo que tenia arreglo.
    #
    # Los EXENTOS primero: mover su precio cambia el total uno a uno, sin que el
    # ITBIS se mueva atras. Despues los demas, del mas grande al mas chico,
    # donde un centavo pesa relativamente menos.
    orden = sorted(
        range(len(items)),
        key=lambda i: (bool(items[i].get("TaxScheduleID")),
                       -abs(float(items[i]["Quantity"]) * float(items[i]["Price"]))),
    )
    # El barrido va por PRECISION, despues por PASO y despues por renglon. Ese
    # orden es el que decide cual de todos los arreglos posibles gana, y esta
    # elegido para que gane siempre el menos invasivo: primero el precio limpio
    # de dos decimales, dentro de eso el ajuste mas chico, y sin importar en que
    # renglon caiga.
    for decimales in DECIMALES_PRECIO:
        unidad = Decimal(1).scaleb(-decimales)
        for paso in range(1, margen_centavos + 1):
            for idx in orden:
                original = Decimal(str(items[idx]["Price"]))
                cantidad = Decimal(str(items[idx]["Quantity"])) or Decimal("1")
                for signo in (1, -1):
                    candidato = redondear(
                        original + Decimal(signo * paso) * unidad, decimales)
                    if candidato <= 0 or candidato == original:
                        continue
                    prueba = [dict(x) for x in items]
                    prueba[idx]["Price"] = float(candidato)
                    if total_segun_adm(prueba) == objetivo:
                        return prueba, {
                            "renglon": idx,
                            "antes": original,
                            "despues": candidato,
                            "movido": r2((candidato - original) * cantidad),
                        }
    return items, None
