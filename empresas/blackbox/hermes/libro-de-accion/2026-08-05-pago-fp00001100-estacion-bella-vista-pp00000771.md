# Pago de factura FP00001100 — Estación Bella Vista (PP00000771)

**Fecha:** 2026-07-02  
**Empresa:** Blackbox SRL  
**Aprobó:** Victor, por la mesa web  
**Documento ADM:** PP00000771 (BillPayments)  
**UUID ADM:** 6a8a9831-57ba-436e-f89c-08def2c88fdf  

## Hecho

Pago de RD$750 a ESTACION BELLA VISTA SRL (RNC 101744342) por la factura
FP00001100 (UUID ea9712ad-e7e2-4012-a607-08def10be22b), pagada con tarjeta
Visa 2414 DOP del Banco Santa Cruz.

El movimiento bancario (banco_tx_id 6b1d7837-fcb8-44e8-a385-2d2456920fb8) fue
asignado por cruce de nombre + monto + fecha.

## Registro

- **Documento ADM:** BillPayments PP00000771
- **Reference:** 6b1d7837-fcb8-44e8-a385-2d2456920fb8 (banco_tx_id)
- **Factura aplicada:** FP00001100
- **Monto:** RD$750.00
- **Fecha:** 2026-07-02

## Alcance

Los pagos de tarjeta asignados por cruce (nombre + monto + fecha) con
metodo='nombre' y suma exacta se registran como BillPayments con el banco_tx_id
en Reference, sin requerir revisión adicional del contable. Aplica a pagos de
factura únicos donde el monto del movimiento bancario coincide exactamente con
el total de una factura del mismo proveedor.

## Método

script (sugerencia de pago de factura, conciliación banco→ADM).
