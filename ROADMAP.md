# Roadmap — QualiaConta

Cinco entregas en orden. Cada una tiene criterio de terminado verificable: si no
se puede comprobar, no está terminada.

La empresa piloto es **Blackbox**. Las demás entran cuando el patrón esté
probado con una.

---

## Entrega 1 — Que lea, responda y aprenda

**Sin una sola escritura en ADM Cloud.** El contable observa, contesta y destila
lo que ya existe.

Alcance:

- Hermes corriendo en CodeBox para Blackbox, con GLM de z.AI.
- Chat de Telegram conectado.
- SQL de sólo lectura contra ADM Cloud, funcionando.
- Núcleo DGII cargado con lo básico: ITBIS, retenciones, comprobantes fiscales
  (NCF y e-CF), obligaciones 606 y 607.
- Memoria de empresa inicial de Blackbox: proveedores, plan de cuentas,
  criterios conocidos.
- Histórico de liquidaciones destilado a criterios de reparto escritos.

**Terminado cuando:** diez preguntas reales de Carlos, respondidas bien y
verificadas contra ADM Cloud, y los criterios de reparto destilados revisados y
aceptados por él.

Va primero porque el acceso de lectura es cimiento de todo lo demás — liquidar
necesita buscar artículos existentes, registrar necesita el plan de cuentas — y
porque valida las tres cosas que pueden hundir el proyecto sin arriesgar nada:
que el SQL llegue, que el contable entienda el modelo de datos de ADM Cloud, y
que hablar con él se sienta bien.

---

## Entrega 2 — Liquidación de mercancía

Segunda porque es donde está la plata: un costo mal repartido se convierte en un
precio mal puesto y sangra todos los días.

Alcance:

- Recibe la carpeta de una importación y clasifica sus documentos.
- Reparte los costos con los criterios destilados en la entrega 1.
- Llena la plantilla de Excel con el formato de siempre.
- Propone los artículos nuevos en lista, con la búsqueda de duplicados hecha.
- Con OK, registra en ADM Cloud y escribe la entrada en el libro de acción.

**Terminado cuando:** una liquidación real sale igual a la que se hizo a mano,
línea por línea, y una segunda sale bien sin corrección de criterio.

Requiere: el rol de ADM Cloud recortado y la plantilla de Excel.

---

## Entrega 3 — Registro de facturas por precedente

Alcance:

- Canal e-CF primero: comprobantes electrónicos, datos exactos, sin lectura de
  imagen.
- Busca precedente, registra si lo hay, propone por Telegram si no.
- Cada aprobación escribe su entrada en el libro.
- Después, correo. Después, foto por WhatsApp. Papel al final.

**Terminado cuando:** un mes de facturas de Blackbox entra sin intervención
salvo en casos genuinamente nuevos, y el libro de acción explica cada decisión.

---

## Entrega 4 — Conciliación bancaria

Alcance:

- Mapa de cuentas bancarias de Blackbox a sus cuentas contables.
- Cruce de `openbanking_transactions` contra los movimientos de ADM Cloud.
- Lista de diferencias con una propuesta por cada una.
- Refresco a pedido vía `openbanking_sync_requests`.

**Terminado cuando:** una conciliación mensual de Blackbox se entrega con las
diferencias correctas, comparada contra la conciliación hecha a mano.

---

## Entrega 5 — Vigilante DGII y evolución

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
