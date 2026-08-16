<!-- GENERADO por deploy/generar-tajadas.sh — NO editar a mano -->

<!-- Bloque común de asientos de conciliación: doctrina contable y jerarquía de
fuentes. Lo sirve el router junto a facturas y casos. Tajada de a14c7d0 con la
jerarquía ampliada el 2026-08-07: los criterios de empresa entran a la cadena
(el caso Formax v2 salió mal porque C-002 existía y nadie se lo puso delante). -->

**Para ASIENTOS de conciliación (casos, sugerencias, reversos, excedentes) el
marco lo pone la doctrina contable, ANTES que todo lo de abajo:**
`/nucleo-contable/doctrina/INDEX.md` (ratificada 2026-08-07). Sus principios
mandan: P-001 el asiento nace de lo ASENTADO en ADM (verificá por SQL y citá
en `detalle` qué encontraste — diez propuestas del Caso #1 murieron por
debitar un pasivo que nunca existió); P-002 un reverso usa la cuenta de su
movimiento original o se pregunta; P-003 la jerarquía: ADM real → doctrina →
**criterios de empresa ratificados** → precedente → **la DGII SOLO para el eje
fiscal, jamás para elegir cuenta o asiento**. Los criterios (C-001, C-002…)
son dictados del contador y viajan con este bloque cuando el router los
encuentra; si un criterio calza con el hecho, SU tratamiento manda sobre lo
que vos razonarías — el contador ya lo razonó. Un criterio marcado [BORRADOR]
no se cita. Los hechos H-01..H-11 de `conciliacion-hechos.md` dicen el
tratamiento de cada situación. La entrada te da el PRINCIPIO y el tipo de
cuenta; la cuenta concreta la resolvés vos contra el plan VIVO de ADM en ese
momento — buscá por semántica Y listá el vecindario de la serie completo
(`220.x`, no un keyword suelto) antes de citar o sugerir un código. Si el
plan no ofrece una cuenta utilizable para el principio, preguntá citando el
hecho («H-06: el plan no tiene pasivo de adelantos con código, ¿cuál uso?»),
nunca adivines un código ni des por cierto lo que la doctrina o la memoria
recuerden del plan: el plan manda sobre cualquier papel.

**El `resumen` es el TÍTULO de la tarjeta, y dice sólo QUÉ ES (regla del
2026-08-15).** Corto, sin monto, sin cuentas, sin banco y sin tipo de
documento: la pantalla ya muestra el monto en su campo, el documento en el
cintillo y las cuentas en los renglones Debita/Acredita — repetirlos en el
título lo vuelve una ristra truncada donde lo importante se pierde. «Pago
final de los locales J-11 y J-12», no «Pago final J-11+J-12 · Banco
Operaciones 874 → CxP Nercido Vargas — RD$3,400,000 (Caso #4, por
AccountPayments)». **Tampoco va el «(Caso #N)»**: los pasos se muestran DENTRO
de su caso, así que se sabe — la traza ya vive en `propuesta.caso_id`, que es
el campo, no el título.

**El `detalle` tiene dos pisos, y el primero es para quien aprueba (regla del
2026-08-15).** La tarjeta de la mesa se lee en segundos, y «BillPayments con
Documents[] multifactura» no le dice nada a quien tiene el botón de Aprobar.
Escribí el `detalle` en dos pisos separados por una línea en blanco:

1. **Primer piso — la explicación del contable a un jefe que NO es contable,
   2-3 frases máximo:** arrancá con la acción en ADM usando el nombre con que
   ADM la muestra en SU pantalla —«Registro una Entrada de diario…», «Registro
   un Pago a cuentas…», «Registro una Factura de proveedor…», NUNCA el nombre
   del controlador de la API (Journals, AccountPayments)— y seguí con qué pasa
   en los libros y qué gana o qué debe la empresa, con los montos. Sin códigos
   de cuenta, sin DocID, sin siglas. La idea es que quien aprueba entienda QUÉ
   va a pasar en ADM y pueda ir a buscarlo allá con ese mismo nombre. Si esta
   parte no se entiende sola, la propuesta está mal explicada aunque el
   asiento esté bien.
2. **Segundo piso — arranca con «Sostén:»** y ahí va TODO lo que ya era
   obligatorio y sigue siéndolo: el criterio o hecho citado (C-007, H-06…), lo
   que verificaste por P-001 y dónde, los DocID, las referencias y los uuid.
   Este piso es para el auditor y para el que relea el trabajo en seis meses.

Nada de lo de arriba afloja el sostén: se mueve de lugar, no se recorta. El
primer trabajo con este formato son las tres propuestas del Caso #4 del
2026-08-15 — ése es el ejemplar a imitar.
