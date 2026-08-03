# Roadmap — QualiaConta

Cinco entregas en orden. Cada una tiene criterio de terminado verificable: si no
se puede comprobar, no está terminada.

La empresa piloto es **Blackbox**. Las demás entran cuando el patrón esté
probado con una.

El orden manda el ciclo contable: primero que sepa leer, después que registre y
concilie. La liquidación de mercancía va al final, cuando lo básico ya sea
rutina.

## Fuera de alcance

**Los reportes a la DGII los hace la empresa contable externa** — 606, 607, IT-1
y declaraciones en general. QualiaConta no los prepara ni los presenta. Su
trabajo termina en dejar el libro de ADM Cloud correcto y conciliado, que es de
donde la empresa contable saca lo que declara.

---

## Entrega 1 — Que lea y responda

**Sin una sola escritura en ADM Cloud.** El contable observa y contesta.

Alcance:

- Hermes corriendo en CodeBox para Blackbox, con GLM de z.AI.
- Chat de Telegram conectado.
- SQL de sólo lectura contra ADM Cloud, funcionando.
- Núcleo DGII cargado con lo básico: ITBIS, retenciones, comprobantes fiscales
  (NCF y e-CF), obligaciones 606 y 607.
- Memoria de empresa inicial de Blackbox: proveedores, plan de cuentas,
  criterios conocidos.

**Terminado cuando:** diez preguntas reales de Carlos, respondidas bien y
verificadas contra ADM Cloud.

Va primero porque el acceso de lectura es cimiento de todo lo demás — registrar
necesita el plan de cuentas, liquidar necesita buscar artículos existentes — y
porque valida las tres cosas que pueden hundir el proyecto sin arriesgar nada:
que el SQL llegue, que el contable entienda el modelo de datos de ADM Cloud, y
que hablar con él se sienta bien.

---

## Entrega 2 — Registro de facturas por precedente

El trabajo diario. Primera entrega que escribe en el libro oficial.

Alcance:

- Canal e-CF primero: comprobantes electrónicos, datos exactos, sin lectura de
  imagen.
- Busca precedente, registra si lo hay, propone en la mesa de trabajo si no.
- La mesa de trabajo web (Labs_Inv, módulo ADM Cloud) es la superficie del
  registro: subir, ver desglose, aprobar. Operativa en modo propuesta desde
  2026-08-02 (ver docs/mesa-de-trabajo.md); registra de verdad cuando esta
  entrega descubra la escritura en ADM.
- Cada aprobación escribe su entrada en el libro de acción.
- Después, correo. Después, foto por WhatsApp. Papel al final.

**Terminado cuando:** un mes de facturas de Blackbox entra sin intervención
salvo en casos genuinamente nuevos, y el libro de acción explica cada decisión.

Requiere: el rol de ADM Cloud recortado — sin permiso de anular, de emitir e-CF
de venta ni de declarar. Ver [SPEC §5](SPEC.md).

### Estado al 2026-08-02: escribe, pero el contable todavía no

**La escritura está encendida.** Gate 0 pasado con un asiento de RD$1.00
(`ED00000182`, revertido) y primera factura real registrada: TUPAQ e-NCF
E310000002221 → **`FP00001061`**, con su PDF adjunto y el asiento derivado
cuadrando. El flujo completo quedó escrito en la skill.

**Pero todo eso se ejecutó a mano.** El contable no corrió ni un paso del flujo
nuevo. Lo que falta para cerrar la entrega, en orden:

1. **Una factura de punta a punta sin tocar nada** — que el agente lea, busque
   precedente, verifique duplicado, registre, adjunte y escriba el libro solo.
   Es la única prueba que vale.
2. **Alta de proveedor nuevo, nunca ejecutada.** El rol lo permite (sondeado) y
   se sabe que son cinco campos, con el nombre saliendo de la razón social de
   DGII. Pero no existe un solo `POST /api/Vendors` real: no sabemos qué
   devuelve ni si el proveedor nace aprobado o pendiente.
3. **Monitoreo y kill-switch (plan §5).** Hoy el agente puede escribir y no hay
   nada que detecte un registro malo ni que lo frene. Más grave de lo que era en
   el papel, porque **revertir en ADM BORRA el documento** (medido): un registro
   equivocado revertido no deja rastro de que existió. Sin esto, la única
   defensa es la aprobación humana una por una.
4. **Las guardas duras del plan §3.4**: monto máximo por documento, tope diario
   de escrituras, y prohibición de backdating pasado el día 5. Escritas, ninguna
   existe en código. Los 12 períodos de 2026 están abiertos en ADM, así que el
   candado contra backdating es 100% nuestro.

---

## Entrega 2b — Los otros documentos que la empresa registra

De los cuatro tipos que Blackbox usa, sólo las facturas de proveedor saben
registrarse. El orden sale de lo que cuesta construir contra lo que ya está
fallando, no del volumen.

### 1. Depreciación mensual — lo más fácil y **está atrasada**

Último asiento registrado: **28 de febrero de 2026**. Marzo a julio no están —
cinco meses, **~RD$151.000 de gasto sin registrar** y las acumuladas del balance
desfasadas.

Es el caso más automatizable del sistema: el mismo asiento, con **el mismo monto
exacto** (RD$30.244,73), todos los meses desde agosto de 2025. Cuatro débitos a
`650.01/02/03/04` y cuatro créditos espejo a `170.02/04/06/07`. Sin documento,
sin proveedor, sin NCF, sin juicio contable. No necesita un Excel: necesita un
calendario. Sólo cambia cuando se compra o se da de baja un activo, y eso es un
evento que el dueño conoce.

Los históricos van **sin `Reference`**, lo que los hace imposibles de buscar: los
nuevos llevan `DEPRECIACION <AAAAMM>` para que el chequeo de duplicado funcione.

**Terminado cuando:** los cinco meses atrasados están al día y el asiento del mes
siguiente se propone solo el último día del mes.

### 2. Cargos bancarios — 60 propuestas esperando

Hay **60 sugerencias paradas en `propuesta`** desde el 2026-08-02: comisiones,
impuesto 2×1000, descuento 1% DGII, notas de débito. El motor que las genera ya
existe y funciona; lo que falta es que puedan convertirse en registro.

Es el tipo más repetitivo y el que el plan dice que se gradúa primero.

### 3. Nómina desde Excel — tres asientos, aprobación humana para siempre

Patrón fijo en los 60 asientos históricos: `NOMINA <MES> <AÑO>`,
`REG. TSS EMPLEADOR <AAAAMM>` y `REG.INFOTEP EMPLEADOR <AAAAMM>`, uno por mes
sin excepción. Se arrastra el Excel a la mesa, el preparador extrae los totales
por concepto y el contable propone **los tres juntos en una sola tarjeta** — son
tres documentos pero una sola decisión.

Lo que aporta no es escribir los asientos, es lo que verifica antes: que cada uno
cuadre solo, que el neto de `220.01` sea bruto menos retenciones, que **no exista
ya la nómina de ese mes**, y que el período del texto coincida con el mes de la
fecha.

**Cuidado especial: ADM NO frena asientos duplicados.** Verificado — hay tres
referencias repetidas en el histórico, y una es de nómina: `REG. TSS EMPLEADOR
202606` aparece dos veces, porque el de julio se registró con el período de
junio. Buscar "202607" no encuentra nada y llevaría a registrarlo de nuevo.
Duplicar una nómina son ~RD$350.000 en los libros y no hay red del servidor.

Los tres asientos son tres POST y el agente no puede deshacer ninguno: si el
segundo falla, queda media nómina registrada. Protocolo: registrar los tres y,
ante un fallo, decir con nombre y número cuáles entraron. Nunca reintentar solo.

**No se gradúa nunca a automático.** Guarda permanente.

### 4. Préstamos y líneas de crédito — eventos, no patrón

No hay plantilla posible: cada movimiento es distinto. Los desembolsos son
eventos ad-hoc (RD$2.497.600 a `230.05` el 2026-03-23, RD$4.000.000 en febrero)
y las cuotas mensuales de 2025 (~RD$31.600) se detuvieron.

El enganche natural son las cuotas: **caen en el estado de cuenta** y el motor de
sugerencias bancarias ya las ve. Lo que le falta es partirlas en capital e
interés, y ese dato no sale del banco — sale de la **tabla de amortización**, que
hoy no está en ninguna parte del sistema.

**Primer paso, y es prerrequisito de todo lo demás:** cargar las tablas de
amortización de los préstamos vivos. Sin eso cualquier propuesta va a estar mal.

---

## Riesgos abiertos (medidos, no teóricos)

- **La firma electrónica de e-CF está abierta en ADM.** `ElectronicSign` y
  `RemoveSign` responden "Este documento no existe" con el rol de registro, o sea
  que lo permitirían. No se puede recortar del lado de ADM (decisión del dueño,
  2026-08-02). La barrera es un `approvals.deny` en el `config.yaml` de la
  empresa — **que está gitignoreado**: si el contenedor se recrea, el candado no
  vuelve solo. Al montar una instancia nueva hay que ponerlo a mano.
- **Revertir borra.** No hay lápida auditable. Antes de revertir, guardar el
  documento completo en el libro de acción: es la única copia que va a quedar.
- **Los documentos del bucket se perdieron una vez.** La política permitía a
  cualquier autenticado borrar cualquier objeto; ya está apretada, y el respaldo
  pasó de diario a cada hora. Pero la copia de CodeBox es lo único que hay.
- **Julio sin registrar.** El libro de facturas de proveedor se detiene el
  2026-06-30 y la factura de agosto ya saltó por encima.
- **RLS tautológica del bus.** La política nueva del bucket se apoya en que
  `qualia_trabajos` sea legible por todo autenticado; si ese RLS se aprieta, la
  protección de los documentos se debilita en silencio.

---

## Entrega 3 — Conciliación bancaria

**Bloqueada por un pendiente fuera de este repo:** Blackbox banca en Banco Santa
Cruz y el colector todavía no recoge esa cuenta. El driver ya existe y está
registrado como `santacruz-empresarial`; falta configurar el login en
`config/banks.json` del colector, en el server. Hasta entonces no hay
movimientos de Blackbox que conciliar.

El acceso de lectura ya está hecho y probado: el contable lee la base del
colector y no puede tocar las credenciales de los bancos.

Alcance:

- Mapa de cuentas bancarias de Blackbox a sus cuentas contables.
- Cruce de `openbanking_transactions` contra los movimientos de ADM Cloud.
- Lista de diferencias con una propuesta por cada una.
- Refresco a pedido vía `openbanking_sync_requests`.

**Terminado cuando:** una conciliación mensual de Blackbox se entrega con las
diferencias correctas, comparada contra la conciliación hecha a mano.

---

## Entrega 4 — Vigilante DGII y evolución

Alcance:

- Cron semanal que raspa normas y avisos de la DGII, detecta lo nuevo, destila
  la regla con rango y vigencia, y avisa por Telegram a qué empresas afecta.
- Alerta si el raspado se rompe. Un vigilante que falla callado es peor que
  ninguno.
- Medición de la métrica de evolución: qué porcentaje del trabajo se resuelve
  sin llamar al modelo grande.

**Terminado cuando:** una norma nueva publicada por la DGII aparece en el núcleo
sin que nadie la cargue, y existe el número de la métrica con su serie histórica.

---

## Entrega 5 — Liquidación de mercancía

Al final, cuando el ciclo básico ya sea rutina. Es el flujo más complejo y el
que más depende de lo anterior: necesita el catálogo de artículos entendido, el
plan de cuentas asentado y el registro de compras funcionando.

Alcance:

- Destila las liquidaciones históricas a criterios de reparto por costo y por
  proveedor. **Una sola vez** — no se relee el histórico en cada importación.
- Recibe la carpeta de una importación y clasifica sus documentos.
- Reparte los costos con los criterios destilados.
- Llena la plantilla de Excel con el formato de siempre.
- Propone los artículos nuevos en lista, con la búsqueda de duplicados hecha.
  **Crear artículo siempre pide OK.**
- Con OK, registra en ADM Cloud y escribe la entrada en el libro de acción.

**Terminado cuando:** una liquidación real sale igual a la que se hizo a mano,
línea por línea, y una segunda sale bien sin corrección de criterio.

Requiere: la plantilla de Excel y dos o tres carpetas de liquidaciones ya hechas.

---

## Después

Segunda empresa. Es la prueba real del aislamiento: copiar la carpeta, cambiar
el `.env`, y que nada de Blackbox se filtre.

## Pendientes de averiguar

- Si ADM Cloud ya calcula costo de importación en Compras Avanzadas o Inventario
  Avanzado. Si lo hace, el contable usa eso y no reimplementa el reparto.
- Cómo llegan los e-CF recibidos: si ADM Cloud ya los ingesta o hay que ir a
  buscarlos a la DGII.
- Cómo le llegan las carpetas de importación: carpeta compartida en CodeBox,
  subida por Telegram o disco sincronizado.
- Techo de RAM en CodeBox. Con tres o cuatro empresas alcanza; más arriba hay
  que medir antes de agregar.
