---
fecha: 2026-08-07
tipo: criterio
documento_adm: null
metodo: razonado
aprobado_por: C.Araujo
acota:
  - 2026-08-06-el-ncf-no-decide-el-tipo-de-documento.md
---

# El NCF no elige el ROL, pero sí elige el documento adentro del rol

**Esta entrada no registra un documento**: no tiene DocID porque no hay ninguno
que citar. Acota la entrada del 2026-08-06, cuyo Alcance —leído al pie de la
letra— prohíbe lo que el código hace desde hoy. Tampoco se espeja en
`qualia_libro`: la tabla lista decisiones sobre documentos, y ésta no lo es.

## Qué se acota

La entrada del 2026-08-06 cierra así:

> «El NCF —su presencia o su ausencia— no se usa NUNCA como argumento para
> elegir `documento_adm`.»

Sigue siendo verdad, y sus 96 contraejemplos siguen midiendo lo que medían: 45
facturas de proveedor sin NCF y 51 cargos bancarios con NCF. Todos son sobre la
**presencia o la ausencia**, y todos son sobre **cuál de las cinco preguntas
gana** — o sea, sobre el rol del hecho.

Lo que se agrega es el escalón siguiente. Una vez que el rol ya está elegido, el
**tipo** del comprobante sí decide una cosa: si el papel corrige a otro papel.

## El criterio

**Dentro de la pregunta 4 —«un tercero te entregó un documento»—, un e-NCF tipo
34 (NCF tipo 04) es una nota de crédito de proveedor: `VendorCreditNotes`,
prefijo `NCP`, precios POSITIVOS.** ADM invierte el asiento solo: acredita los
gastos y el ITBIS, y debita Cuentas por Pagar.

El alcance es angosto y el orden no se toca. El NCF **no** entra a elegir entre
las cinco preguntas; entra después, y sólo para subdividir la cuarta.

## El sostén, que es un contraejemplo vivo

Si la regla se enunciara como «`^E34` → `VendorCreditNotes`», se lleva puesto al
`E340000187146` (trabajo `f85d82b3`, 2026-08-06): es la nota de crédito con la
que el **banco** devuelve el impuesto 2x1000 de la Ley 30-26 que él mismo había
cobrado. Ese hecho nació en el estado de cuenta, gana en la pregunta 1, y es un
`BankCharges` con `direccion: credito` — aunque su NCF diga 34.

Por eso la regla vive **dentro** de `registrar-en-adm.py`, que sólo ve lo que ya
ganó la pregunta 4, y **no** en `poller.sh` ni como enunciado suelto en la skill.
Subirla de nivel la vuelve falsa.

## Qué se hace con `documento_adm`

El script decide con el NCF y **no** con ese campo, y cuando discrepan corrige la
fila. No es desconfianza gratuita: en la NC de Claro el modelo escribió ahí
`VendorBills` y mandó los montos en negativo, que es exactamente el camino
equivocado. El NCF es un hecho fiscal; el campo es una opinión.

Corregirlo tampoco es prolijidad. `documento_adm` es el router de toda la mesa:
lo lee `poller.sh` para elegir script, `verificar-registros.py` para saber a qué
endpoint preguntar, y la web para nombrar el documento. Con la fila mintiendo,
`GET /api/VendorBills/{uuid-de-la-NCP}` contesta `success:true` con `data:null`
—probado el 2026-08-07 contra la NCP00000006— y eso es indistinguible de un
documento borrado: el cron de las :35 le habría puesto lápida a una nota viva.

## Lo que este criterio NO resuelve

Registrar la nota **no la aplica** contra la factura. Es otro documento
(`VendorCreditApplications`, prefijo `ACP`) y en esta empresa **nunca se hizo
para una nota de crédito**: las 6 aplicaciones históricas
(`ACP00000001` … `ACP00000007`) aplican anticipos, asientos y pagos — sus
`Documents[]` son `VEND_PRE`, `JOURNAL` y `ACT_PAY`, ninguno `VEND_CN`. El
objeto del swagger se llama, de hecho, `VendorPrepaymentApplication`.

El script deja la deuda escrita en `propuesta.aplicacion_pendiente` en vez de
improvisar el POST. Importa porque en ADM el pago cierra al centavo o descuadra
el banco: sin aplicar la nota no se puede pagar el neto.

Estado medido al 2026-08-07 en `/api/AP`, todo de CODETEL:

| Documento | Fecha | Saldo |
|---|---|---|
| `NCP00000006` | 2026-07-04 | −27.95 (flotando) |
| `NCP00000004` | 2026-01-06 | −15.06 (flotando desde enero) |
| `FP00001066` | 2026-07-01 | 6,351.00 entera, es la que corrige la 00000006 |
| `FP00001027` | 2026-06-04 | 28.00 abiertos sobre 6,223.16 — el mismo patrón: se pagó el neto y la nota nunca se registró |

Las otras tres notas históricas (`NCP00000002`, `NCP00000003`, `NCP00000005`) no
aparecen en `/api/AP`: ya están saldadas.

El primer `ACP` se hace **a mano**, con el dueño mirando, y recién con ese
precedente propio se decide si el script lo encadena. Es la misma razón por la
que `Journals` sigue sin script: preferimos el camino caro al camino equivocado.

## Alcance

Vale para toda nota de crédito recibida de un proveedor en BlackBox SRL, y para
cualquier empresa que se agregue: no es una particularidad de este catálogo de
cuentas, es cómo funcionan los comprobantes fiscales.

**Aprobó:** C.Araujo, en sesión de trabajo del 2026-08-07. No por la mesa web:
esta entrada corrige el corpus, no decide un documento.

## Origen

La NC de Claro `E340009998496` (RD$27.95), trabajo
`0534fc90-cfb0-4c24-9879-feb6607e78b3`, registrada a mano como `NCP00000006`
tras 4 minutos de desvío. Su entrada propia es
`2026-08-07-nc-claro-e340009998496-ncp00000006.md`.
