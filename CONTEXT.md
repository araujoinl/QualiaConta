# Contexto — Glosario de QualiaConta

Lenguaje canónico del dominio. Sólo definiciones; nada de implementación
accidental. Cuando una palabra de este archivo aparezca en código, en una skill
o en una conversación con el contable, significa exactamente esto.

## QualiaConta

Un contable experto por empresa. Recibe documentos, decide cómo se registran,
carga en ADM Cloud, liquida mercancía, concilia contra el banco y responde
cualquier pregunta financiera. Su rasgo distintivo no es que sepa contabilidad:
es que **anota cada decisión que toma y no vuelve a preguntar lo mismo**.

No es un ERP. No lleva libros propios. Es quien opera el libro que ya existe.

## Contable

Una instancia del agente, dedicada a una sola empresa. Tiene su propia memoria,
sus propias skills, su propio usuario de ADM Cloud y su propio chat de Telegram.
Dos contables nunca comparten estado: el aislamiento es físico, no una promesa
del modelo.

Hablar de "el contable" sin más significa el contable de la empresa en cuestión.

## Empresa

La unidad de aislamiento. Todo en QualiaConta cuelga de una empresa salvo el
núcleo DGII. Una empresa tiene un contable, un chat, un usuario de ADM Cloud,
un conjunto de cuentas bancarias y su propia historia de decisiones.

## Libro oficial

ADM Cloud. Es la contabilidad de verdad — la que ve el contador humano y la que
sostiene lo que se declara a la DGII. QualiaConta escribe ahí; no guarda una
contabilidad paralela. Si un número de QualiaConta discrepa del libro oficial,
el que está mal es QualiaConta.

## Núcleo DGII

La memoria fiscal compartida por todas las empresas. Contiene lo que rige en
República Dominicana: normas, avisos, tratamiento de ITBIS, retenciones,
comprobantes fiscales, obligaciones de reporte.

Es de sólo lectura para los contables y se actualiza en un solo lugar. Ninguna
empresa escribe en el núcleo.

## Rango

De dónde viene una pieza del núcleo y cuánto pesa. Tres valores:

- **Norma** — texto oficial de la DGII (norma general, aviso, ley). Es la
  autoridad.
- **Interpretación** — explicación de un tercero calificado (boletín de EY,
  Deloitte, PwC). Ayuda a entender, no manda.
- **Criterio propio** — cómo decidimos aplicarlo nosotros. Vive en la memoria
  de empresa, no en el núcleo.

Cuando dos se contradicen, gana la norma. Siempre.

## Vigencia

El período en que una regla estuvo vigente. Toda regla del núcleo lleva desde
cuándo aplica y, si fue derogada, hasta cuándo.

Existe porque una factura de 2025 se juzga con las reglas de 2025. Un núcleo que
sólo sepa "lo que rige hoy" registra mal cualquier documento atrasado y no avisa.

## Memoria de empresa

Lo que el contable sabe de *su* empresa: quiénes son los proveedores y cómo se
tratan, el plan de cuentas y qué va en cada una, los criterios propios, quién es
quién, las particularidades. Es memoria curada — el agente la resume y la
reescribe a medida que aprende.

Por eso no sirve como evidencia. Para eso está el libro de acción.

## Libro de acción

El registro de decisiones. Una entrada por cada decisión contable tomada, con
fecha, el caso, qué se decidió, por qué, quién aprobó y la norma que la sostiene.

Tres propiedades que lo definen y no se negocian:

- **Sólo se agrega.** Nunca se edita ni se borra una entrada. Si un criterio
  cambia, se escribe una entrada nueva que deroga la anterior.
- **Va en git.** Cada decisión queda en un commit con su fecha real.
- **Es evidencia, no recuerdo.** Cuando alguien pregunte en marzo por qué una
  factura se registró así, la respuesta es una entrada, no lo que el agente
  crea recordar.

## Precedente

Una entrada del libro de acción que aplica a un caso presente. Si el contable
encuentra precedente, actúa solo. Si no, pregunta.

Es el mecanismo central del producto: cada aprobación tuya se convierte en
regla escrita, y el trabajo repetido deja de pasar por el modelo. La meta
declarada de QualiaConta es que la proporción de casos resueltos por precedente
suba con el tiempo.

## Caso nuevo

Una situación sin precedente aplicable, o con precedente que contradice lo que
el contable observa. Es lo único que interrumpe al humano.

Un caso nuevo bien resuelto produce siempre dos cosas: la acción y la entrada
en el libro. Una acción sin entrada es trabajo perdido — la próxima vez vuelve
a preguntar.

## Registro

Cargar un documento en el libro oficial con su tratamiento contable: cuenta,
ITBIS, retención, comprobante fiscal. Es el trabajo diario del contable y la
única acción de escritura que ejerce solo, y sólo con precedente.

## Liquidación de mercancía

Repartir todos los costos de una importación — flete, seguro, arancel, ITBIS
aduanal, agente aduanal, transporte — entre los artículos que llegaron, para
saber cuánto costó de verdad cada unidad.

Su entregable es doble: la plantilla de Excel llena, que es lo que se revisa, y
el registro en ADM Cloud, que es lo que queda oficial.

Es el flujo donde está la plata: un costo mal repartido se convierte en un
precio mal puesto, y eso sangra todos los días sin que nadie lo note.

## Criterio de reparto

Cómo se distribuye un costo entre los artículos de una importación: por valor,
por peso, por volumen, por unidad. No es libre — cada costo y cada proveedor
tiene el suyo, y sale destilado de las liquidaciones que ya se hicieron.

## Artículo

Un producto en el catálogo de ADM Cloud. Crearlos nunca es autónomo.

La razón es concreta: un artículo duplicado parte el inventario en dos. El stock
queda repartido entre dos códigos, el costo promedio se ensucia, y no se arregla
borrando — hay que fusionar y recalcular. Antes de proponer un artículo nuevo el
contable está obligado a buscar si ya existe.

## Conciliación

Cruzar los movimientos del banco contra lo registrado en el libro oficial y
sacar las diferencias. Los movimientos vienen del colector OpenBanking, que ya
corre y ya deduplica; el libro viene de ADM Cloud.

## Diferencia

Un movimiento que aparece de un lado y no del otro, o que aparece en ambos con
montos distintos. Es el producto de la conciliación: el contable no "concilia y
listo", entrega la lista de lo que no cuadra y propone qué hacer con cada cosa.

## Destilación

Convertir un montón de material en reglas escritas, una sola vez. Se destilan
las liquidaciones históricas a criterios de reparto, y las normas nuevas de la
DGII a reglas del núcleo.

Lo que importa es el "una sola vez": releer cuarenta carpetas en cada
importación es exactamente el gasto que QualiaConta existe para eliminar.

## Salirse del proceso

La meta evolutiva. Cuando un tipo de caso se repite con el mismo desenlace, el
contable escribe el script que lo resuelve sin pensar y se saca a sí mismo del
medio.

Se mide con un solo número: **qué porcentaje del trabajo se resuelve sin llamar
al modelo grande**. Si ese número no sube, el sistema no está aprendiendo,
aunque parezca que sí.
