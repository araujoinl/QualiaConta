---
fecha: 2026-08-06
tipo: criterio
documento_adm: null
metodo: razonado
aprobado_por: C.Araujo
acota:
  - 2026-08-03-cargo-bancario-comision-lbtr-cb00000179.md
  - 2026-08-03-cargo-bancario-comision-lbtr-cb00000187.md
  - 2026-08-03-cargo-bancario-comision-lbtr-cb00000195.md
  - 2026-08-03-cargo-bancario-comision-lbtr-cb00000210.md
  - 2026-08-03-cargo-bancario-comision-lbtr-cb00000216.md
  - 2026-08-03-cargo-bancario-comision-lbtr-cb00000219.md
  - 2026-08-03-cargo-bancario-retencion-dgii-1pct-cb00000221.md
  - 2026-08-03-cargo-bancario-santacruz-lbtr-cb00000182.md
---

# El NCF no decide el tipo de documento de ADM

**Esta entrada no registra un documento**: no tiene DocID porque no hay ninguno
que citar. Acota una frase que quedó escrita en ocho entradas anteriores y que,
leída fuera de su contexto, enseña un criterio falso. Por eso tampoco está
espejada en `qualia_libro`: la tabla lista decisiones sobre documentos, y ésta no
lo es.

## Qué se acota

Ocho entradas del 2026-08-03 cierran su Alcance (o su Criterio) con una variante
de esta frase:

> «Sin NCF ni ITBIS (no es factura de proveedor).»

En su contexto original la frase es **descriptiva** — describe cómo se ve una
comisión bancaria — y el criterio que esas entradas de verdad aplican es otro,
correcto y sin tocar: la cuenta sale del mapa de cargos del histórico de ADM.

El problema es el paso 6 del protocolo, que manda greppear el libro buscando
precedente. Quien busque «sin NCF» encuentra ocho entradas que parecen ratificar
una regla general, y la regla general es falsa.

## Lo que NO cambia

**Los 92 cargos bancarios registrados están bien**, y las ocho entradas siguen
siendo precedente válido para lo que de verdad decidieron: qué cuenta lleva una
comisión LBTR, un impuesto de la Ley 30-26 o la retención del 1%, y contra qué
cuenta de banco se acredita. Nada de eso se revisa.

Lo único que se acota es **el motivo**: esos cargos no van a `BankCharges` por no
tener NCF. Van ahí porque el hecho nació en el estado de cuenta y el único actor
es el banco.

## El sostén

La frase, leída como regla general, falla en las dos direcciones. Medido sobre el
histórico real de esta empresa (espejo local `preentrenamiento/raw/`, 2026-08-06):

- **45 de 1.109 facturas de proveedor NO tienen NCF.** Gobierno, exterior y
  entidades estatales — las 10 liquidaciones de la DGA entre ellas
  (`FP00000049` … `FP00001018`).
- **51 de 159 cargos bancarios SÍ tienen NCF**, todos e-CF `E31` que el propio
  banco emite por sus comisiones.

Son 96 contraejemplos en el corpus de esta misma contabilidad.

El costo ya se pagó: el 2026-08-05 la liquidación de la DGA se propuso como cargo
bancario razonando textualmente «no es una factura con NCF sino un recibo de pago
bancario». El dueño corrigió («pero siempre se registra como proveedor») y la
propuesta volvió atrás quince segundos después.

## Dónde vive ahora el criterio

En `skills/mesa-de-trabajo/SKILL.md`, sección **«Qué documento de ADM es esto: lo
decide el ROL del hecho, no el papel»**: cinco preguntas ordenadas, la primera que
dé SÍ gana. Esa sección es la fuente; esta entrada sólo impide que las ocho
viejas la contradigan cuando alguien las encuentre por grep.

Dos corolarios que ahí quedaron escritos y conviene repetir acá, porque son el
borde de esta misma regla:

- **Que el beneficiario final sea la DGII no saca un cargo de `BankCharges`.**
  51 de los 92 cargos que la mesa ya registró son impuestos que el banco descuenta
  como agente de retención (48 del 0,15% de cheques, 3 de la retención del 1%), y
  están bien donde están.
- **Que el tercero sea el Estado no lo hace dejar de ser proveedor.** La aduana va
  como factura (10 de 10); la TSS y el INFOTEP van como asiento (39 `Journals`,
  `ED00000007` … `ED00000181`). Decide el rol del hecho, no quién es el tercero.

## Alcance

El NCF —su presencia o su ausencia— no se usa NUNCA como argumento para elegir
`documento_adm`, ni en una propuesta, ni en una sugerencia, ni en una respuesta
del hilo. Si aparece en un razonamiento, el razonamiento está mal aunque la
conclusión acierte.

Vale para toda la mesa de BlackBox y para cualquier empresa que se agregue: no es
una particularidad de este catálogo de cuentas, es cómo funcionan los
comprobantes fiscales.

**Aprobó:** C.Araujo, en sesión de trabajo del 2026-08-06. No por la mesa web:
esta entrada corrige el corpus, no decide un documento.
