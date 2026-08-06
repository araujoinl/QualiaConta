# 2026-08-05 — FP00001122 — Account One DCM2RP SRL — outsourcing fiscal + contable, agosto 2026

**Aprobó:** Victor, por la mesa web
**Documento ADM:** FP00001122 (VendorBills, uuid bf2c2b2c-a8ce-4dc1-e389-08def2c88fdf)
**Fecha factura:** 2026-08-04 · **NCF:** E310000000665 · **RNC emisor:** 133169045
**Proveedor:** Account One DCM2RP SRL
**Monto:** USD 637.20 (base 540.00 tras descuento 10% + ITBIS 18% 97.20)
**Cuenta:** 621.01 Servicios Contables (1 renglón)
**Tipo de gasto 606:** 02 Gastos por Trabajos, Suministros y Servicios
**Método:** precedente · **Ref:** agg:proveedor-cuentas.json#133169045 (21 de 21 facturas históricas) + FP00001065 (julio 2026, mismo bundle)
**Confianza:** 0.90

## Hecho

Bundle One (Tax One Plus + Account One Plus) — outsourcing fiscal + contable de agosto 2026, servicio mensual recurrente de Account One. Aritmética: precio 600.00 con descuento 10% = base neta 540.00; ITBIS 18% sobre 540.00 = 97.20; total 637.20 USD.

## Criterio

Cuenta 621.01 Servicios Contables por precedente (21/21 facturas históricas de este proveedor). Tipo de gasto 02 (igual que las 21 anteriores).

## DGII

Timbre e-CF no verificable: ConsultaTimbre devolvió «No fue encontrada la factura (e-CF)» probando FechaEmision 04 y 05-08-2026, FechaFirma 05-08-2026, MontoTotal 637.20 y código CIVrtS. Padrón confirma emisor ACTIVO, facturador electrónico SI, RNC y razón social concordantes. Idéntico al caso de la factura de julio (E310000000612, FP00001065), donde el timbre tampoco verificó. Se registra con confianza 0.90.

## Retención al pagar

Norma 02-05 (casilla 43 del IT-1): al pagar, retener 30% del ITBIS = 0.30 × 97.20 = USD 29.16. Afecta el pago, no el registro de la factura.

## Alcance

Aplica a futuras facturas de Account One DCM2RP SRL (RNC 133169045) por el bundle Tax One Plus + Account One Plus (outsourcing fiscal + contable mensual): cuenta 621.01 Servicios Contables, tipo de gasto 02, ITBIS 18% con retención del 30% del ITBIS al pagar. Antecedentes: FP00001065 (julio) y FP00001122 (agosto).
