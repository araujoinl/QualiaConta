# Cómo funciona la doctrina — el mapa de las reglas

- **Para:** Carlos, y cualquiera que necesite entender de dónde sale cada
  decisión del contable
- **Fecha:** 2026-08-15
- **Qué es esto:** el documento que explica la ESTRUCTURA — qué son los P, los
  H, los C, las normas, el libro de acción y los candados, dónde vive cada uno
  y cómo una decisión sube de un caso puntual a regla permanente

---

## 1. La idea en una frase

El contable no decide de memoria: decide leyendo capas de reglas escritas, y
cada capa responde una pregunta distinta. Cuando ninguna capa responde, no
adivina — abre una `pregunta` y esperá tu dictamen. Ese dictamen, si vale para
siempre, se escribe y pasa a ser parte de una capa. Así el sistema aprende: no
entrenando un modelo, sino **escribiendo reglas que cualquiera puede leer y
auditar**.

## 2. Las capas, de la ley a la práctica

```
  LA LEY            normas DGII          «qué exige el fisco»
    │
  EL MÉTODO         P-001 … P-005        «cómo se decide cualquier asiento»
    │
  LOS HECHOS        H-01 … H-12          «este hecho del banco → este asiento»
    │
  LA EMPRESA        C-001 … C-007        «cómo lo hace Blackbox en concreto»
    │
  EL DIARIO         libro de acción      «qué se decidió tal día y por qué»
    │
  EL CANDADO        triggers en la base  «lo que no se puede ni por error»
```

La jerarquía la fija P-003 y tiene una sorpresa: **la DGII nunca decide una
cuenta ni un asiento**. La norma fiscal dice qué reportar y qué documentar; el
asiento lo deciden las capas contables. Confundir los dos ejes es el error más
común (y es exactamente lo que pasó en el Caso #4: un requisito del 606 no
convierte una compra de inmueble en factura).

## 3. Capa por capa

### Las normas DGII — `nucleo-contable/dgii/normas/`

La ley dominicana destilada: NCF, retenciones, el 606/607/608, ITBIS. Cada
archivo lleva **rango** (norma / interpretación / criterio propio) y
**vigencia** — sin eso no entra, porque una regla fiscal sin fuente ni fecha no
se puede defender ante un auditor. Es compartida entre todas las empresas y el
contable la monta **solo-lectura**: ninguna empresa la puede tocar.

### Los Principios — P-001 … P-005 en `nucleo-contable/doctrina/principios-de-asiento.md`

El método. No dicen qué cuenta usar: dicen **cómo se razona** cualquier
asiento, en cualquier empresa. Los cinco:

| # | El principio, en llano |
|---|---|
| P-001 | El asiento nace de lo ASENTADO, no del deber-ser: antes de usar un saldo, verificá que existe |
| P-002 | Un reverso se asienta contra su movimiento original, no contra una cuenta parecida |
| P-003 | Jerarquía de fuentes: qué manda cuando dos reglas chocan (la DGII nunca decide cuentas) |
| P-004 | La cuenta se elige por la naturaleza del hecho, no por quién es el tercero |
| P-005 | Antes de crear algo (cuenta, proveedor, artículo), probar que no existe |

Nacieron de una auditoría real: 72 trabajos con tu feedback, 2026-08-07. Cada
uno existe porque su ausencia costó plata o retrabajos.

### Los Hechos — H-01 … H-12 en `nucleo-contable/doctrina/conciliacion-hechos.md`

El diccionario hecho→asiento. Cada H toma un hecho que aparece en el banco
—un cargo, un reverso, un anticipo, la nómina— y dice qué asiento le
corresponde, citando su principio. Dos propiedades importantes:

- **Son fijos de por vida.** Un H nombra el TIPO de cuenta («un pasivo de
  garantías»), nunca el código concreto — el código se resuelve contra el plan
  vivo de la empresa en el momento de asentar. Así el H no caduca cuando el
  plan cambia.
- **«ABIERTO» es una instrucción, no un hueco.** Un H marcado ABIERTO ordena
  preguntar. No es que falte terminarlo: es que nadie dictó todavía, y hasta
  que alguien dicte, la regla ES preguntar.

### Los Criterios — C-001 … C-007 en `empresas/blackbox/hermes/memoria/criterios.md`

Lo que ni la ley ni la doctrina general deciden: **las reglas de TU empresa**.
Que la renta adelantada va al 220.06, que la comisión de tarjeta es 5.395%,
que el IT-1 se paga con `AccountPayments`, que un inmueble va por asiento.
Viven en la memoria del contable (capa empresa, no núcleo) porque otra empresa
puede decidirlo distinto.

**El ciclo de vida es lo que importa:**

1. Nace `[BORRADOR]` — el contable lo propone desde la evidencia.
2. **No es precedente hasta que vos lo apruebes.** La línea `Aprobó:` con fecha
   es la firma.
3. Si un día resulta falso, **no se borra: se corrige dejando dicho qué decía
   y por qué era falso** — el error documentado vale más que el error borrado,
   porque impide repetirlo.

Cada criterio lleva tres partes obligatorias: **enunciado** (la regla),
**evidencia** (documentos reales, verificables, con DocID), y **alcance** (a
qué aplica y qué lo haría revisarse). Un criterio sin evidencia citable es una
opinión, y las opiniones no registran asientos.

### El Libro de Acción — `empresas/blackbox/hermes/libro-de-accion/`

El diario de decisiones. Cada decisión es **un archivo nuevo, jamás la edición
de uno existente** — regla dura del repo. Formato fijo: Fecha, Caso, Decisión,
Por qué, Sostén (el método con que se verificó), Aprobó, **Alcance** y Deroga.

La diferencia con un criterio: el libro registra **qué pasó tal día** (con su
contexto completo); el criterio destila **la regla que quedó**. El libro es la
fuente; el criterio, el precipitado. Por eso una entrada sin Alcance
«documenta pero no automatiza»: el contable la lee como historia, no como
permiso.

### Los Candados — triggers en la base de Labs_Inv

La última capa no es un texto: es código que **no se puede desobedecer**. El
ejemplo vivo: `qualia_trabajos_journal_no_toca_caja` rechaza cualquier asiento
que toque una cuenta de caja (101.xx, 102.xx, 203.10/203.11), porque de 8
asientos que pasaron por la mesa, los 8 tocaban caja y 0 estaban bien.

La filosofía viene de SPEC §5: **los límites viven en los permisos, no en el
prompt**. Una regla escrita se puede racionalizar («el sistema me bloquea, lo
mando por otro lado» — así nació el CB00000258); un trigger no escucha
argumentos. Por eso cuando un candado te frena, la doctrina dice: el tipo de
documento está mal elegido, o esto no lo registrás vos. **Nunca** «buscá otro
tipo que pase».

Del mismo palo: el rol de ADM del contable está recortado (no emite facturas
de venta, no anula), y desde el 2026-08-14 la regla de anular es «PODÉS y NO
DEBÉS» — porque una prohibición apoyada en «no tenés permiso» se derrumba el
día que el agente descubre que sí lo tiene.

## 4. Cómo se usa todo esto para registrar (el flujo de un caso)

```
 llega algo a la mesa (factura, caso, nota de débito)
   │
   ▼
 ① ¿QUÉ DOCUMENTO ES?  ── las 5 preguntas de la regla de arranque
   │                       (BankCharges → Transferencia → BillPayments/
   │                        AccountPayments → VendorBills → Journals)
   ▼
 ② ¿QUÉ CUENTA?        ── H aplicable + criterios C + plan de cuentas vivo
   │
   ▼
 ③ ¿QUÉ EXIGE LA DGII? ── normas: NCF, retención, tipo de gasto 606
   │
   ▼
 ④ propuesta en la mesa ── vos aprobás o rechazás
   │
   ▼
 ⑤ registro en ADM     ── script por tipo de documento, con candados
   │
   ▼
 ⑥ si hubo dictamen nuevo → entrada en el libro + criterio si es regla
```

El orden del paso ① no es decorativo: **primero el documento, después la
cuenta**. El documento lo decide el ROL del hecho (¿nació en el banco? ¿cancela
una obligación registrada? ¿un tercero entregó algo?), nunca el NCF — hay 96
contraejemplos medidos en el propio histórico de la empresa.

## 5. El Caso #4 como ejemplo completo del ciclo

Vale como demostración de todas las capas juntas, incluyendo cómo se corrige
un error:

1. **El caso**: compra de dos locales a una persona física, RD$3,45 M.
2. **El error**: C-003 (entonces borrador) decía que la compra de un activo
   «sirve con NCF o sin él», citando la nave industrial como precedente. Se
   registró como factura → derecho al 606, sin RNC ni NCF.
3. **El dictamen**: los contables externos lo objetaron — «debe ser un asiento».
4. **La verificación**: se fue a leer el precedente citado. FP00000838 era del
   Banco Santa Cruz, con RNC. La regla generalizaba un caso que no decía eso.
5. **La corrección en capas**: C-007 nuevo (la regla), C-003 corregido (dejando
   dicho qué decía y por qué era falso), K-01 de la hoja de ruta reescrito para
   el auditor, entrada en el libro de acción, y la excepción 4-bis en la regla
   de arranque de la mesa.
6. **La operación**: se anulan los 4 documentos y se re-registra por asiento.

La moraleja quedó también como memoria de trabajo: **antes de aplicar una regla
que cita un precedente, ir a leer el precedente**.

## 6. Dónde vive cada cosa (chuleta)

| Capa | Archivo | Quién la cambia |
|---|---|---|
| Normas DGII | `nucleo-contable/dgii/normas/` | núcleo, compartido, con rango y vigencia |
| Principios P | `nucleo-contable/doctrina/principios-de-asiento.md` | ratificados 2026-08-07; cambiarlos es un evento |
| Hechos H | `nucleo-contable/doctrina/conciliacion-hechos.md` | fijos de por vida; un H nuevo se agrega, no se edita uno viejo |
| Criterios C | `empresas/blackbox/hermes/memoria/criterios.md` | nacen BORRADOR, los ratifica Carlos |
| Libro de acción | `empresas/blackbox/hermes/libro-de-accion/` | solo se AGREGA, un archivo por decisión |
| Regla de arranque | `skills/mesa-de-trabajo/references/rama-facturas-1.md` (y §1 de `docs/hoja-de-ruta-registro.md`) | espejo de la doctrina para la mesa |
| Hoja de ruta | `docs/hoja-de-ruta-registro.md` | catálogo por familias para el auditor, con marcas ✔ ◐ ○ |
| Candados | triggers en la Supabase de Labs_Inv | migración primero, y con OK explícito |

Tres numeraciones que se parecen y no son lo mismo: los **P/H/C** de arriba,
los **casos por familia** de la hoja de ruta (`A-01`, `K-01`, `M-04`…) que son
el catálogo para el auditor, y los **«Caso #N»** de la mesa, que son hilos de
conciliación concretos que tu gente arma en la web.

## 7. Qué está ratificado y qué sigue abierto (al 2026-08-15)

- **Ratificado**: P-001…P-005, H-01…H-12, C-001…C-007 (los últimos tres el
  2026-08-15, «quiero 0 en borrador»), pagos a cuenta del ISR.
- **Abierto en la doctrina**: la semántica de las 48 cuentas de
  `cuentas-en-uso.md` (borrador del núcleo — cada cuenta necesita su «qué es /
  qué NO va acá» dictado); «Adelanto de Clientes» sin código en ADM; las tablas
  de amortización de los préstamos vivos (sin ellas H-04 siempre pregunta).
- **Abierto en la operación**: el 3% de transferencia de los locales J-11/J-12
  (se capitaliza, K-01 paso 3); su alta en depreciación; las 13 notas de débito
  de Santa Cruz; el 2% de ITBIS que retienen las procesadoras de tarjeta sin
  cuenta identificada; el barrido 18.b de la hoja de ruta.
