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
- Busca precedente, registra si lo hay, propone por Telegram si no.
- Cada aprobación escribe su entrada en el libro de acción.
- Después, correo. Después, foto por WhatsApp. Papel al final.

**Terminado cuando:** un mes de facturas de Blackbox entra sin intervención
salvo en casos genuinamente nuevos, y el libro de acción explica cada decisión.

Requiere: el rol de ADM Cloud recortado — sin permiso de anular, de emitir e-CF
de venta ni de declarar. Ver [SPEC §5](SPEC.md).

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
