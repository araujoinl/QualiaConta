# TUPAQ Cargo & Courier — flete/courier corriente a 620.10 con ITBIS

**Aprobó:** C. Araujo, por la mesa web (trabajo 4cdef27f).
**Fecha:** 2026-08-02
**Proveedor:** TUPAQ CARGO & COURIER SRL — RNC 132942248
**Documento de respaldo:** e-NCF E310000002221, RD$163.26, verificada en DGII (Aceptado, montos cuadran).

## Criterio

Las facturas de TUPAQ Cargo & Courier por **courier y flete aereo corriente**
(envios locales o priority, no vinculados a una importacion en curso) se
registran como **VendorBill** integramente a **620.10 Envios y Correspondencias**.

Los componentes del envio van como items separados — flete, airport fee,
combustible (surcharge), servicios DGA, tasa Aerodom — cada uno con su linea,
precio sin ITBIS y grupo de impuesto correcto. No se suman en una sola linea.

**ITBIS aprovechable** como credito fiscal cuando el e-NCF es valido y esta
verificado en DGII (Norma 02-05 art. 7). Los componentes exentos (airport fee,
combustible, DGA) no generan credito pero son gasto deducible.

## Asiento tipo

| Cuenta | Descripcion | Debito | Credito |
|---|---|---:|---:|
| 620.10 Envios y Correspondencias | flete + cargos courier | 163.26 | |
| 1180-02 ITBIS adelantado | credito fiscal 18% | 11.96 | |
| CxP TUPAQ Cargo & Courier | total a credito | | 175.22 |

(El ejemplo de RD$163.26 incluye RD$151.30 de base + RD$11.96 ITBIS.)

## Alcance

Aplica a **toda factura de TUPAQ Cargo & Courier** cuyo concepto sea envio/courier
corriente (monto pequeno, naturaleza operativa recurrente), con e-NCF E31/E43/E44
valido y verificado en DGII. NO aplica cuando el envio acompana una
**importacion en curso** — en ese caso va a **130.02 Compras en Transito** (la
factura suele ser de monto grande y venir sin ITBIS), criterio a documentar aparte.

## No precedente usado

La memoria `proveedores.md` (TUPAQ, 112 docs) coincide con este tratamiento pero
esta en `estado: borrador` al momento de esta aprobacion — por eso esta entrada
se resolvio como `metodo='razonado'`. Esta entrada del libro, ya ratificada, si
es precedente para casos futuros iguales.
