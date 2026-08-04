---
estado: borrador
aprobo:
evidencia: extracción 2026-08-02 vía API ADM Cloud (165 proveedores, 1050 facturas con detalle, corte 2026-08-02)
---

# Proveedores — tratamiento contable típico

Una sección por proveedor con actividad (≥ 2 docs). Los de 1 doc van a la tabla
residual del final (la agrega la destilación). Cada sección sigue la plantilla.

Un proveedor cuyo gasto se reparte ~50/50 entre dos cuentas se marca
`AMBIGUO — preguntar` en "Tratamiento típico" y NUNCA se clasifica en autónomo.

---

## Banco Multiple Santa Cruz S A

- RNC: 102012921
- Cuenta(s) de gasto típica(s): 230.02 Prestamo Y No. 00003 (57.8%), 230.03 Leasing 247355SDO071A (26.7%), 660.01 Seguros de Vehículos (3.1%), 802.01 Intereses de Préstamos (2.3%), 640.01 Cargos Bancarios (1.0%), 640.02 Cargos sobre cheques 0.15 (0.5%)
- ITBIS / retenciones observados: 17 docs con ITBIS 18% (seguros), 186 sin ITBIS (préstamos/cargos bancarios). Sin retenciones.
- NCF típico: E31 (198 docs)
- Vía de pago: Transferencia (122 pagos), Tarjeta de Crédito (1). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 4 días
- Tratamiento típico: Proveedor bancario multi-propósito. Cuotas de préstamo a 230.02, cuotas de leasing a 230.03, intereses a 802.01, cargos bancarios a 640.01/640.02, seguros de vehículos a 660.01. No es un gasto de operación único — la imputación depende del concepto de cada cargo. Evidencia: 203 docs, DocIDs FP00001033, FP00000977.

---

## Tupaq Cargo & Courier Srl

- RNC: 132942248
- Cuenta(s) de gasto típica(s): 620.10 Envios y Correspondencias (68.1%), 130.02 Compras en Tránsito (31.7%), 801.01 Gastos sin comprobante de crédito fiscal y/o al exterior (0.1%)
- ITBIS / retenciones observados: 112 docs con ITBIS 18%, 2 sin ITBIS (las facturas grandes a 130.02 vienen sin ITBIS). Sin retenciones.
- NCF típico: B01 (114 docs)
- Vía de pago: Tarjeta de Crédito (10 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 40 días
- Tratamiento típico: Courier/flete aéreo y desaduanización. Flete corriente a 620.10 con ITBIS; si acompaña una importación en curso (monto grande, sin ITBIS), va a 130.02 Compras en Tránsito. La porción sin crédito fiscal dentro de una misma factura va a 801.01. Evidencia: 114 docs, DocIDs FP00001060, FP00001057.

---

## Isla Dominicana De Petroleo Corporation

- RNC: 101008172
- Cuenta(s) de gasto típica(s): 620.11 Combustible (98.4%), 801.01 Gastos sin comprobante de crédito fiscal y/o al exterior (1.6%)
- ITBIS / retenciones observados: 0 docs con ITBIS (todos sin — estaciones de servicio no cobran ITBIS en combustible). Sin retenciones.
- NCF típico: E31 (86), B01 (7)
- Vía de pago: Tarjeta de Crédito (78 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días (pago inmediato en bomba)
- Tratamiento típico: Combustible de vehículos, 100% a 620.11 sin ITBIS (el ITBIS del combustible va implícito en el precio, no se discrimina). Evidencia: 96 docs, DocIDs FP00001052, FP00001042.

---

## Mecari Srl

- RNC: 101767766
- Cuenta(s) de gasto típica(s): 620.11 Combustible (98.0%), 801.01 Gastos sin comprobante de crédito fiscal y/o al exterior (2.0%)
- ITBIS / retenciones observados: 0 docs con ITBIS. Sin retenciones.
- NCF típico: B01 (86 docs)
- Vía de pago: Tarjeta de Crédito (64), Transferencia (2). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Estación de combustible, idéntico a Isla/Totalenergies: 620.11 sin ITBIS discriminado. Evidencia: 88 docs, DocIDs FP00001048, FP00001047.

---

## Estacion De Servicios H E Nuevo Milenio S R L

- RNC: 101830719
- Cuenta(s) de gasto típica(s): 620.11 Combustible (97.1%), 650.08 Reparaciones y Mantenimientos Equipos de Transporte (2.9%)
- ITBIS / retenciones observados: 2 docs con ITBIS 18% (los de reparación), 51 sin ITBIS (combustible). Sin retenciones.
- NCF típico: B01 (51), E31 (2)
- Vía de pago: Tarjeta de Crédito (40), Transferencia (3), Paypal (2). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 1 día
- Tratamiento típico: Estación de servicio mixta — combustible a 620.11 sin ITBIS; cuando incluye reparaciones de vehículos, esa porción va a 650.08 con ITBIS 18%. Evidencia: 53 docs, DocIDs FP00001055, FP00001039.

---

## Totalenergies Marketing Dominicana, Sa

- RNC: 101068744
- Cuenta(s) de gasto típica(s): 620.11 Combustible (98.7%), 801.01 Gastos sin comprobante de crédito fiscal y/o al exterior (1.3%)
- ITBIS / retenciones observados: 0 docs con ITBIS. Sin retenciones.
- NCF típico: E31 (32), B01 (4)
- Vía de pago: Tarjeta de Crédito (28 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Combustible, idéntico a Isla/Mecari: 620.11 sin ITBIS discriminado. Evidencia: 37 docs, DocIDs FP00001054, FP00001022.

---

## Logistichause International R&M Srl

- RNC: 133124981
- Cuenta(s) de gasto típica(s): 130.02 Compras en Tránsito (83.3%), 511.04 Fletes (16.7%)
- ITBIS / retenciones observados: 14 docs con ITBIS 18%, 11 sin ITBIS. 1 doc con retención (monto DOP 21,780.00).
- NCF típico: B01 (24 docs)
- Vía de pago: Transferencia (16 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 2 días
- Tratamiento típico: Logística/flete de importación. La mercancía en tránsito va a 130.02, el flete como costo va a 511.04. Único proveedor del lote con retención observada — probablemente retención de ITBIS 30% por ser servicio de transporte de carga. Evidencia: 25 docs, DocIDs FP00000996, FP00000981.

---

## Account One Dcm2rp, Srl

- RNC: 133169045
- Cuenta(s) de gasto típica(s): 621.01 Servicios Contables (100%)
- ITBIS / retenciones observados: 20 docs con ITBIS 18%. Retención registrada (monto USD 567.27) pero 0 docs marcados con retención — posible inconsistencia o retención ISR 2% Proveedores aplicada al pago.
- NCF típico: E31 (15), B01 (5)
- Vía de pago: Transferencia (20 pagos, todos en USD). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 10 días
- Tratamiento típico: Servicios contables facturados en USD, 100% a 621.01 con ITBIS 18%. Verificar la retención de USD 567.27 no documentada en los agregados. Evidencia: 20 docs, DocIDs FP00001030, FP00001006.

---

## Compania Dominicana De Telefonos S A

- RNC: 101001577
- Cuenta(s) de gasto típica(s): 620.05 Comunicación (85.3%), 620.09 Gasto de Impuesto Selectivo al consumo (7.4%), 801.01 Gastos sin comprobante de crédito fiscal y/o al exterior (5.8%), 690.05 Otros Impuestos (1.5%)
- ITBIS / retenciones observados: 18 docs con ITBIS 18%, 2 con ITBIS 30%. Sin retenciones.
- NCF típico: E31 (18 docs)
- Vía de pago: Transferencia (15), Tarjeta de Crédito (2). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 6 días
- Tratamiento típico: Servicio telefónico/internet (Claro). El cargo base va a 620.05, el impuesto selectivo al consumo (ISC) va a 620.09, otros impuestos menores a 690.05, y la porción sin crédito fiscal a 801.01. ITBIS 30% aparece en 2 docs — revisar si corresponde a servicio de roaming internacional. Evidencia: 20 docs, DocIDs FP00001027, FP00000978.

---

## Humano Seguros S A

- RNC: 102017174
- Cuenta(s) de gasto típica(s): 611.18 Seguro Medico (99.3%), 650.05 Amortización de Bienes intangibles (Primas de seguro) (0.6%), 620.09 Gasto de Impuesto Selectivo al consumo (0.1%)
- ITBIS / retenciones observados: 0 docs con ITBIS (seguros están exentos). Sin retenciones.
- NCF típico: E31 (19 docs)
- Vía de pago: Transferencia (9), Tarjeta de Crédito (3). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 14 días
- Tratamiento típico: Seguro médico de empleados (ARS Humano) — 611.18 Seguro Médico, sin ITBIS, prima amortizada mensualmente. **PERO la cuenta sigue a la naturaleza del bien asegurado, no al proveedor (ratificado C.Araujo 2026-08-03, libro 2026-08-03-humano-seguros-rc-auto-exceso):** seguros de VEHÍCULO (RC Auto Exceso, etc.) → **660.01 Seguros de Vehículos**, no 611.18. El ISC 16% sobre la prima (Ley 146-02) va como ítem propio a **620.09**. Tipo de gasto 606: **11 Gastos de Seguros**. Evidencia: 19 docs + FP00001067 (RC Auto a 660.01), DocIDs FP00001026, FP00000980.

---

## Supermercado El Dragon De Oro S A

- RNC: 101035129
- Cuenta(s) de gasto típica(s): 620.06 Suministros de oficina y otros (100%)
- ITBIS / retenciones observados: 14 docs con ITBIS (18% en 30 líneas, 16% en 5 líneas — mix de productos gravados a distintas tasas). Sin retenciones.
- NCF típico: E31 (8), B01 (6)
- Vía de pago: Tarjeta de Crédito (10 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 5 días
- Tratamiento típico: Compras de suministros de oficina en supermercado, 100% a 620.06. El ITBIS varía entre 16% y 18% según el tipo de producto (alimentos vs. útiles). Evidencia: 14 docs, DocIDs FP00001031, FP00000992.

---

## Inversiones Max Grill Srl

- RNC: 131728251
- Cuenta(s) de gasto típica(s): 611.17 Dieta y Viáticos (92.8%), 690.06 Propina Legal (7.2%)
- ITBIS / retenciones observados: 13 docs con ITBIS 18%, 0 sin. Sin retenciones.
- NCF típico: B01 (13 docs)
- Vía de pago: Tarjeta de Crédito (13). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días (pago inmediato)
- Tratamiento típico: Restaurante/alimentación de personal. ~93% a 611.17 (comidas de equipo) y la propina legal del 10% a 690.06. Pago con tarjeta al momento. Evidencia: 13 docs, DocIDs FP00000476, FP00000402.

---

## Megasuply Srl

- RNC: 130012271
- Cuenta(s) de gasto típica(s): 620.06 Suministros de oficina y otros (98.8%), 210.01 Itbis Operativo (1.2%)
- ITBIS / retenciones observados: 11 docs con ITBIS 18%, 1 sin. Sin retenciones.
- NCF típico: B01 (12 docs)
- Vía de pago: Tarjeta de Crédito (9 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Suministros de oficina, 100% a 620.06 con ITBIS 18%. La línea a 210.01 es rebote del ITBIS operativo. Pago con tarjeta. Evidencia: 12 docs, DocIDs FP00001001, FP00000922.

---

## JSP EMPRESAS DR SRL

- RNC: 133375338
- Cuenta(s) de gasto típica(s): 620.11 Combustible (100%)
- ITBIS / retenciones observados: 0 docs con ITBIS (11 sin — combustible no discrimina ITBIS). Sin retenciones.
- NCF típico: B01 (11 docs)
- Vía de pago: Tarjeta de Crédito (8 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Estación de servicio / combustible de vehículos, 100% a 620.11 sin ITBIS (implícito en el precio). Pago con tarjeta en bomba. Evidencia: 11 docs, DocIDs FP00000955, FP00000931.

---

## Sigma Petroleum Corp Sas

- RNC: 130689164
- Cuenta(s) de gasto típica(s): 620.11 Combustible (100%)
- ITBIS / retenciones observados: 0 docs con ITBIS (11 sin — combustible no discrimina ITBIS). Sin retenciones.
- NCF típico: E31 (10), B01 (1)
- Vía de pago: Tarjeta de Crédito (12 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 1 día
- Tratamiento típico: Petrolera / combustible de vehículos, 100% a 620.11 sin ITBIS. Predomina NCF E31 (consumidor final). Pago con tarjeta. Evidencia: 11 docs, DocIDs FP00000726, FP00000731.

---

## Amable Aristy Castro S R L

- RNC: 101099161
- Cuenta(s) de gasto típica(s): 620.11 Combustible (100%)
- ITBIS / retenciones observados: 0 docs con ITBIS (10 sin — combustible no discrimina ITBIS). Sin retenciones.
- NCF típico: E31 (8), B01 (2)
- Vía de pago: Tarjeta de Crédito (8 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Estación de servicio (Grupo Aristy) / combustible de vehículos, 100% a 620.11 sin ITBIS. Pago con tarjeta. Evidencia: 10 docs, DocIDs FP00000972, FP00000910.

---

## DGA ADUANAS (Dirección General de Aduanas)

- RNC: sin RNC (entidad estatal)
- Cuenta(s) de gasto típica(s): 150.04 ITBIS Adelantado (74.0%), 130.02 Compras en Tránsito (14.9%), 210.01 Itbis Operativo (11.1%)
- ITBIS / retenciones observados: 0 docs con ITBIS discriminado (10 sin). Sin retenciones.
- NCF típico: sin NCF (entidad gubernamental no emite NCF)
- Vía de pago: Transferencia (9 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Liquidaciones de aduana por importaciones: ITBIS adelantado a 150.04 (mayoría del monto), valor CIF de la mercancía en tránsito a 130.02, y el ITBIS operativo de la operación a 210.01. Pagos por transferencia sin NCF (gobierno). Es el proveedor de mayor monto del bloque por naturaleza aduanera. Evidencia: 10 docs, DocIDs FP00001018, FP00000829.

---

## Good Market Express Eg Srl

- RNC: 131459562
- Cuenta(s) de gasto típica(s): 620.06 Suministros de oficina y otros (81.1%), 611.17 Dieta y Viáticos (14.7%), 611.14 Otros gastos de personal (4.2%)
- ITBIS / retenciones observados: 10 docs con ITBIS (18% en 25 líneas, 16% en 4 — mix de productos). Sin retenciones.
- NCF típico: B01 (10 docs)
- Vía de pago: Tarjeta de Crédito (10 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Mini-market / supermercado exprés. La mayoría a 620.06 (suministros), pero ~19% del monto es alimentación de personal (611.17 dieta + 611.14 otros). Pago con tarjeta. Evidencia: 10 docs, DocIDs FP00000786, FP00000618.

---

## Almacenes Unidos Sas

- RNC: 101013834
- Cuenta(s) de gasto típica(s): 620.06 Suministros de oficina y otros (69.9%), 620.03 Mantenimientos generales (30.1%)
- ITBIS / retenciones observados: 9 docs con ITBIS 18%, 0 sin. Sin retenciones.
- NCF típico: E31 (9 docs)
- Vía de pago: Tarjeta de Crédito (6), Transferencia (1). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 7 días
- Tratamiento típico: Suministros de oficina y mantenimiento de instalaciones. ~70% a 620.06 y ~30% a 620.03 según el concepto de cada compra. Evidencia: 9 docs, DocIDs FP00001013, FP00001007.

---

## M C Logistics Srl

- RNC: 130161453
- Cuenta(s) de gasto típica(s): 130.02 Compras en Tránsito (100%)
- ITBIS / retenciones observados: 6 docs con ITBIS 18%, 2 sin. Sin retenciones.
- NCF típico: B01 (5), E31 (1)
- Vía de pago: Transferencia (6 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 1 día
- Tratamiento típico: Flete/logística de importación en USD. 100% a 130.02 Compras en Tránsito (cuenta USD). Pago por transferencia. Evidencia: 8 docs, DocIDs FP00000695, FP00000477.

---

## Sarton Dominicana Sas

- RNC: 130403899
- Cuenta(s) de gasto típica(s): 160.06 Mobiliarios y Equipos de Oficina (60.6%), 620.06 Suministros de oficina y otros (39.4%)
- ITBIS / retenciones observados: 8 docs con ITBIS 18%, 0 sin. Sin retenciones.
- NCF típico: E31 (7 docs)
- Vía de pago: Tarjeta de Crédito (6 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Mobiliario y equipamiento de oficina. ~60% se capitaliza como activo fijo en 160.06 y ~40% son suministros corrientes a 620.06 — la imputación depende del tipo de artículo (activo vs. consumible). Pago con tarjeta. Evidencia: 8 docs, DocIDs FP00000998, FP00000937.

---

## Cecomsa Srl

- RNC: 102316163
- Cuenta(s) de gasto típica(s): 160.06 Mobiliarios y Equipos de Oficina (84.3%), 620.06 Suministros de oficina y otros (15.7%)
- ITBIS / retenciones observados: 7 docs con ITBIS 18%, 0 sin. Sin retenciones.
- NCF típico: E31 (7 docs)
- Vía de pago: Tarjeta de Crédito (4 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Mobiliario y equipos de oficina (activo fijo). ~84% se capitaliza en 160.06; suministros residuales a 620.06. Predomina la compra de activo fijo. Pago con tarjeta. Evidencia: 7 docs, DocIDs FP00001010, FP00000900.

---

## Consilia Logistics Srl

- RNC: 131643132
- Cuenta(s) de gasto típica(s): 130.02 Compras en Tránsito (100%)
- ITBIS / retenciones observados: 7 docs con ITBIS 18% (42 líneas), 0 sin. Sin retenciones.
- NCF típico: B01 (5), E31 (2)
- Vía de pago: Transferencia (7 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Flete/desaduanización de importaciones. 100% a 130.02 Compras en Tránsito, con ITBIS 18% discriminado en todas las líneas. Pago por transferencia. Evidencia: 7 docs, DocIDs FP00000840, FP00000721.

---

## Apr Creators Srl

- RNC: 132998391
- Cuenta(s) de gasto típica(s): 630.06 Manejo de Redes Sociales (100%)
- ITBIS / retenciones observados: 6 docs con ITBIS 18%, 0 sin. 4 docs con retención (monto DOP 24,750.00).
- NCF típico: B01 (6 docs)
- Vía de pago: Transferencia (6 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 1.5 días
- Tratamiento típico: Agencia de manejo de redes sociales. 100% a 630.06 con ITBIS 18%. Lleva retención ISR 2% Proveedores (4 de 6 docs) — servicio profesional de marketing. Pago por transferencia. Evidencia: 6 docs, DocIDs FP00000571, FP00000501.

---

## Centro Cuesta Nacional Sas

- RNC: 101019921
- Cuenta(s) de gasto típica(s): 620.06 Suministros de oficina y otros (69.8%), 611.17 Dieta y Viáticos (30.2%)
- ITBIS / retenciones observados: 4 docs con ITBIS 18% (6 líneas), 1 sin. Sin retenciones.
- NCF típico: E31 (4), B01 (1)
- Vía de pago: Tarjeta de Crédito (3 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Compras en Cuesta Nacional (CCN). ~70% suministros de oficina a 620.06 y ~30% alimentación de personal a 611.17 — la imputación depende del contenido de cada compra. Pago con tarjeta. Evidencia: 5 docs, DocIDs FP00000956, FP00000948.

---

## Ferreteria Juanly Srl

- RNC: 132675134
- Cuenta(s) de gasto típica(s): 620.06 Suministros de oficina y otros (100%)
- ITBIS / retenciones observados: 5 docs con ITBIS 18% (13 líneas), 0 sin. Sin retenciones.
- NCF típico: B01 (5 docs)
- Vía de pago: Tarjeta de Crédito (4 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 1 día
- Tratamiento típico: Ferretería — materiales y suministros menores. 100% a 620.06 con ITBIS 18%. Montos bajos (DOP 5,110 en 5 facturas). Pago con tarjeta. Evidencia: 5 docs, DocIDs FP00001014, FP00000552.

---

## Fortech Srl

- RNC: 124005132
- Cuenta(s) de gasto típica(s): 620.12 Gastos de Software (99.7%), 621.01 Servicios Contables (0.3%)
- ITBIS / retenciones observados: 0 docs con ITBIS (5 sin). Sin retenciones.
- NCF típico: E31 (5 docs)
- Vía de pago: Tarjeta de Crédito (4 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Licencias/servicios de software facturados en USD. 100% a 620.12 sin ITBIS (servicio al exterior, E31 consumidor final). La línea mínima a 621.01 es residual. Pago con tarjeta. Evidencia: 5 docs, DocIDs FP00000993, FP00000717.

---

## Glo Valia Construction Group Gvcg Srl

- RNC: 132050802
- Cuenta(s) de gasto típica(s): 620.06 Suministros de oficina y otros (79.0%), 620.03 Mantenimientos generales (21.0%)
- ITBIS / retenciones observados: 5 docs con ITBIS 18% (14 líneas), 0 sin. Sin retenciones.
- NCF típico: B01 (5 docs)
- Vía de pago: Transferencia (6 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 1 día
- Tratamiento típico: Contratista de obras/mantenimiento de instalaciones. ~79% a 620.06 (materiales/suministros) y ~21% a 620.03 (servicios de mantenimiento) — la imputación depende del concepto de cada factura. Montos altos (DOP 120,285 en 5 facturas). Pago por transferencia. Evidencia: 5 docs, DocIDs FP00000352, FP00000348.

---

## Grupo Suriel S A

- RNC: 125000117
- Cuenta(s) de gasto típica(s): 620.11 Combustible (100%)
- ITBIS / retenciones observados: 0 docs con ITBIS (5 sin — combustible no discrimina ITBIS). Sin retenciones.
- NCF típico: B01 (5 docs)
- Vía de pago: Tarjeta de Crédito (5 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 1 día
- Tratamiento típico: Estación de servicio / combustible de vehículos, 100% a 620.11 sin ITBIS (implícito en el precio). Pago con tarjeta. Evidencia: 5 docs, DocIDs FP00000268, FP00000170.

---

## Moon & Sea Logistics Srl

- RNC: 131833799
- Cuenta(s) de gasto típica(s): 620.10 Envios y Correspondencias (100%)
- ITBIS / retenciones observados: 5 docs con ITBIS 18% (8 líneas), 0 sin. Sin retenciones.
- NCF típico: B01 (5 docs)
- Vía de pago: Transferencia (1 pago registrado de 5 facturas). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 163.6 días (anómalo — revisar; solo 1 pago registrado de 5 facturas)
- Tratamiento típico: Logística/courier de envíos. 100% a 620.10 con ITBIS 18%. El plazo medio de 163 días es atípico y probablemente reflece que solo 1 de 5 facturas tiene pago registrado en el agregado. Evidencia: 5 docs, DocIDs FP00000647, FP00000630.

---

## Pier 17 Group Dominicana Srl

- RNC: 130547386
- Cuenta(s) de gasto típica(s): 130.02 Compras en Tránsito (70.2%), 611.16 Transporte y otros (29.8%)
- ITBIS / retenciones observados: 5 docs con ITBIS 18% (10 líneas), 0 sin. Sin retenciones.
- NCF típico: B01 (3), E31 (2)
- Vía de pago: Transferencia (3), Tarjeta de Crédito (1). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 3 días
- Tratamiento típico: Logística/flete de importación en USD. ~70% a 130.02 Compras en Tránsito (mercancía en curso) y ~30% a 611.16 Transporte y otros (flete como gasto operativo). La imputación depende del concepto: si acompaña importación va a 130.02, si es flete suelto a 611.16. Evidencia: 5 docs, DocIDs FP00001017, FP00000997.

---

## E Y M Importadores Srl

- RNC: 101733934
- Cuenta(s) de gasto típica(s): 620.06 Suministros de oficina y otros (100%)
- ITBIS / retenciones observados: 4 docs con ITBIS 18% (18 líneas), 0 sin. Sin retenciones.
- NCF típico: E31 (3), B01 (1)
- Vía de pago: Tarjeta de Crédito (4 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Compras de suministros diversos. 100% a 620.06 con ITBIS 18%. Predomina NCF E31 (consumidor final). Pago con tarjeta. Evidencia: 4 docs, DocIDs FP00000617, FP00000518.

---

## Estacion De Servicio Dona Catalina Cabral Srl

- RNC: 124004152
- Cuenta(s) de gasto típica(s): 620.11 Combustible (100%)
- ITBIS / retenciones observados: 0 docs con ITBIS (4 sin — combustible no discrimina ITBIS). Sin retenciones.
- NCF típico: E31 (4 docs)
- Vía de pago: Tarjeta de Crédito (3 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Estación de servicio / combustible de vehículos, 100% a 620.11 sin ITBIS (implícito en el precio). Predomina NCF E31 (consumidor final). Pago con tarjeta. Evidencia: 4 docs, DocIDs FP00001011, FP00000868.

---

## Global Storage Srl

- RNC: 130870081
- Cuenta(s) de gasto típica(s): 130.02 Compras en Tránsito (100%)
- ITBIS / retenciones observados: 4 docs con ITBIS 18% (16 líneas), 0 sin. Sin retenciones.
- NCF típico: E31 (4 docs)
- Vía de pago: Transferencia (2 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Almacenamiento/logística de importaciones. 100% a 130.02 Compras en Tránsito con ITBIS 18% discriminado. Predomina NCF E31 (consumidor final). Montos altos (DOP 73,303 en 4 facturas). Pago por transferencia. Evidencia: 4 docs, DocIDs FP00001000, FP00001016.

---

## Lucami Srl

- RNC: 122009452
- Cuenta(s) de gasto típica(s): 620.11 Combustible (100%)
- ITBIS / retenciones observados: 0 docs con ITBIS (4 sin — combustible no discrimina ITBIS). Sin retenciones.
- NCF típico: B01 (4 docs)
- Vía de pago: Tarjeta de Crédito (3 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Estación de servicio / combustible de vehículos, 100% a 620.11 sin ITBIS (implícito en el precio). Pago con tarjeta. Evidencia: 4 docs, DocIDs FP00001008, FP00000861.

---

## M.C. Logistics Worldwide Corp.

- RNC: sin RNC en el agregado (proveedor del exterior)
- Cuenta(s) de gasto típica(s): 130.02 Compras en Tránsito (100%)
- ITBIS / retenciones observados: 0 docs con ITBIS (4 sin — flete de importación al exterior, sin crédito fiscal). Sin retenciones.
- NCF típico: sin NCF registrado (proveedor extranjero)
- Vía de pago: Transferencia (4 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 3 días
- Tratamiento típico: Logística/flete internacional en USD. 100% a 130.02 Compras en Tránsito sin ITBIS ni NCF (servicio al exterior). Pago por transferencia. Evidencia: 4 docs, DocIDs FP00000702, FP00000444.

---

## Oliver Exterminating Dominicana Corp

- RNC: 122024697
- Cuenta(s) de gasto típica(s): 620.03 Mantenimientos generales (100%)
- ITBIS / retenciones observados: 4 docs con ITBIS 18%, 0 sin. Sin retenciones.
- NCF típico: E31 (4 docs)
- Vía de pago: Tarjeta de Crédito (3 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Control de plagas / fumigación de instalaciones. 100% a 620.03 Mantenimientos generales con ITBIS 18%. Pago con tarjeta, prácticamente al momento. Evidencia: 4 docs, DocIDs FP00000929, FP00000756.

---

## Premier Wash Technology Pwt Srl

- RNC: 131717535
- Cuenta(s) de gasto típica(s): 650.08 Reparaciones y Mantenimientos Equipos de Transporte (100%)
- ITBIS / retenciones observados: 4 docs con ITBIS 18%, 0 sin. Sin retenciones.
- NCF típico: B01 (4 docs)
- Vía de pago: Tarjeta de Crédito (4 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 1 día
- Tratamiento típico: Lavado/mantenimiento de vehículos de la flota. 100% a 650.08 Reparaciones y Mantenimientos Equipos de Transporte con ITBIS 18%. Pago con tarjeta. Montos bajos (DOP 3,768 en 4 facturas). Evidencia: 4 docs, DocIDs FP00000678, FP00000230.

---

## Suena Electronica Srl

- RNC: 101805404
- Cuenta(s) de gasto típica(s): 160.07 Otros Activos Fijos (88%), 650.09 Reparaciones y Mantenimientos de Mobiliario y Equipo de Oficina (12%)
- ITBIS / retenciones observados: 4 docs con ITBIS 18%, 0 sin. Sin retenciones.
- NCF típico: E31 (4 docs)
- Vía de pago: Transferencia (4), Tarjeta de Crédito (1). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 2 días
- Tratamiento típico: Equipos electrónicos / sonido. ~88% se capitaliza como activo fijo en 160.07 Otros Activos Fijos; ~12% son reparaciones/mantenimiento de equipos de oficina a 650.09. La imputación depende del concepto: compra de equipo nuevo va a 160.07, reparación a 650.09. Montos altos (DOP 76,600 en 4 facturas). Evidencia: 4 docs, DocIDs FP00000706, FP00000689.

---

## Valeco Print Solutions Srl

- RNC: 132085086
- Cuenta(s) de gasto típica(s): 611.12 Uniformes (100%)
- ITBIS / retenciones observados: 4 docs con ITBIS 18% (13 líneas), 0 sin. Sin retenciones.
- NCF típico: B01 (4 docs)
- Vía de pago: Transferencia (5 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Confección/impresión de uniformes del personal. 100% a 611.12 Uniformes (gasto de personal) con ITBIS 18%. Pago por transferencia. Evidencia: 4 docs, DocIDs FP00000876, FP00000877.

---

## Acomsa

- RNC: 130533393
- Cuenta(s) de gasto típica(s): 305 Carga Inicial (100%)
- ITBIS / retenciones observados: 0 docs con ITBIS discriminado (3 sin). Retención registrada (monto DOP 5,664.60) en 0 docs marcados — posible inconsistencia entre monto y bandera.
- NCF típico: B01 (1 de 3 docs; los otros 2 sin NCF registrado)
- Vía de pago: Transferencia (3 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 80 días (atípico — registrado en la carga inicial de la empresa, no es un proveedor recurrente de operación)
- Tratamiento típico: Compra cargada al setup inicial de la empresa (cuenta 305 Carga Inicial, no es gasto de operación). Las 3 entradas son del mismo día (2024-12-16), sin ITBIS discriminado y con NCF incompleto. No es un proveedor de operación corriente — la sección documenta el histórico pero no propone cuenta de gasto futura. Evidencia: 3 docs, DocIDs B0100001277, B0100001276.

---

## Anarca Investments Srl

- RNC: 132258312
- Cuenta(s) de gasto típica(s): 650.09 Reparaciones y Mantenimientos de Mobiliario y Equipo de Oficina (67%), 620.03 Mantenimientos generales (33%)
- ITBIS / retenciones observados: 3 docs con ITBIS 18%, 0 sin. Sin retenciones.
- NCF típico: E31 (3 docs)
- Vía de pago: Transferencia (3 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Mantenimiento/reparación de instalaciones y equipos de oficina. ~67% a 650.09 (equipos de oficina) y ~33% a 620.03 (mantenimiento general) según el concepto de cada factura. Ambas cuentas son de mantenimiento — la diferencia es mobiliario de oficina vs. general. Evidencia: 3 docs, DocIDs FP00000867, FP00000340.

---

## Bona S A

- RNC: 101069392
- Cuenta(s) de gasto típica(s): 611.17 Dieta y Viáticos (63%), 630.05 Gastos de Representación (28%), 690.06 Propina Legal (9%)
- ITBIS / retenciones observados: 3 docs con ITBIS 18% (8 líneas), 0 sin. Sin retenciones.
- NCF típico: E31 (3 docs)
- Vía de pago: Tarjeta de Crédito (3 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Restaurante — alimentación y representación. ~63% a 611.17 Dieta y Viáticos, ~28% a 630.05 Gastos de Representación (cuando es cena de negocios/clientes), y la propina legal del 10% a 690.06. La distinción entre dieta y representación depende del motivo de la comida. Pago con tarjeta. Evidencia: 3 docs, DocIDs FP00000526, FP00000335.

---

## Estacion Bella Vista Srl

- RNC: 101744342
- Cuenta(s) de gasto típica(s): 620.11 Combustible (100%)
- ITBIS / retenciones observados: 0 docs con ITBIS (3 sin — combustible no discrimina ITBIS). Sin retenciones.
- NCF típico: B01 (2), E31 (1)
- Vía de pago: Tarjeta de Crédito (3 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Estación de servicio / combustible de vehículos, 100% a 620.11 sin ITBIS (implícito en el precio). Pago con tarjeta en bomba. Evidencia: 3 docs, DocIDs FP00000661, FP00000171.

---

## Grupo Arqlux Srl

- RNC: 131236456
- Cuenta(s) de gasto típica(s): 620.03 Mantenimientos generales (95%), 650.06 Reparaciones y Mantenimientos Activos Edificios (5%)
- ITBIS / retenciones observados: 3 docs con ITBIS 18% (6 líneas), 0 sin. Sin retenciones.
- NCF típico: B01 (3 docs)
- Vía de pago: Transferencia (3 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Mantenimiento/reparación de instalaciones (obras de edificación). ~95% a 620.03 Mantenimientos generales; cuando se capitaliza una reparación mayor del edificio va a 650.06 Reparaciones y Mantenimientos Activos Edificios. Montos altos (DOP 89,128 en 3 facturas). Pago por transferencia. Evidencia: 3 docs, DocIDs FP00000719, FP00000658.

---

## Grupo Rolling Srl

- RNC: 131508006
- Cuenta(s) de gasto típica(s): 611.17 Dieta y Viáticos (91%), 690.06 Propina Legal (9%)
- ITBIS / retenciones observados: 3 docs con ITBIS 18% (4 líneas), 0 sin. Sin retenciones.
- NCF típico: B01 (3 docs)
- Vía de pago: Tarjeta de Crédito (3 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Restaurante — alimentación de personal. ~91% a 611.17 Dieta y Viáticos y la propina legal del 10% a 690.06. Pago con tarjeta al momento. Evidencia: 3 docs, DocIDs FP00000521, FP00000154.

---

## Jade Teriyaki Srl

- RNC: 130389586
- Cuenta(s) de gasto típica(s): 611.17 Dieta y Viáticos (91%), 690.06 Propina Legal (9%)
- ITBIS / retenciones observados: 3 docs con ITBIS 18% (11 líneas), 0 sin. Sin retenciones.
- NCF típico: E31 (3 docs)
- Vía de pago: Tarjeta de Crédito (3 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Restaurante (comida asiática) — alimentación de personal. ~91% a 611.17 Dieta y Viáticos y la propina legal del 10% a 690.06. Idéntico patrón a Grupo Rolling / Max Grill. Pago con tarjeta. Evidencia: 3 docs, DocIDs FP00000805, FP00000306.

---

## Kylg & Asociados Srl

- RNC: 132315103
- Cuenta(s) de gasto típica(s): 611.17 Dieta y Viáticos (90.9%), 690.06 Propina Legal (9.1%)
- ITBIS / retenciones observados: 3 docs con ITBIS 18% (10 líneas), 0 sin. Sin retenciones.
- NCF típico: B01 (3 docs)
- Vía de pago: Tarjeta de Crédito (3). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días (pago inmediato)
- Tratamiento típico: Restaurante — alimentación de personal. ~91% a 611.17 Dieta y Viáticos y la propina legal del 10% a 690.06. Patrón idéntico a Max Grill / Grupo Rolling / Jade Teriyaki. Pago con tarjeta al momento. Evidencia: 3 docs, DocIDs FP00000585, FP00000550.

---

## LBY

- RNC: sin RNC en el agregado (proveedor del exterior)
- Cuenta(s) de gasto típica(s): 305 Carga Inicial (70.4%), 130.02 Compras en Tránsito (29.6%)
- ITBIS / retenciones observados: 0 docs con ITBIS (3 sin — proveedor extranjero). Sin retenciones.
- NCF típico: sin NCF registrado (proveedor extranjero)
- Vía de pago: Transferencia (6 pagos, en USD). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 41 días
- Tratamiento típico: Proveedor del exterior (USD 105,120 en 3 docs). ~70% cargado al setup inicial de la empresa en 305 Carga Inicial y ~30% a 130.02 Compras en Tránsito (mercancía en curso). La cuenta 305 NO es gasto de operación — documenta capitalización inicial. No propone cuenta de gasto futura; revisar si el proveedor sigue activo para operación corriente. Evidencia: 3 docs, DocIDs FP00000510, PI20241127.

---

## La Innovacion Srl

- RNC: 101005831
- Cuenta(s) de gasto típica(s): 620.06 Suministros de oficina y otros (53.0%), 620.03 Mantenimientos generales (47.0%)
- ITBIS / retenciones observados: 3 docs con ITBIS 18% (3 líneas), 0 sin. Sin retenciones.
- NCF típico: E31 (3 docs)
- Vía de pago: Tarjeta de Crédito (3). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: AMBIGUO — preguntar. El gasto se reparte ~53/47 entre 620.06 Suministros de oficina y 620.03 Mantenimientos generales, demasiado parejo para clasificar en autónomo. La imputación depende del concepto de cada factura (suministro vs. mantenimiento). Pago con tarjeta. Evidencia: 3 docs, DocIDs FP00000740, FP00000452.

---

## Sabores Del Desierto Srl

- RNC: 131925375
- Cuenta(s) de gasto típica(s): 611.17 Dieta y Viáticos (100%)
- ITBIS / retenciones observados: 3 docs con ITBIS 18% (5 líneas), 0 sin. Sin retenciones.
- NCF típico: B01 (2), E31 (1)
- Vía de pago: Tarjeta de Crédito (2). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 1 día (pago inmediato)
- Tratamiento típico: Restaurante — alimentación de personal. 100% a 611.17 Dieta y Viáticos con ITBIS 18%. Pago con tarjeta al momento. Evidencia: 3 docs, DocIDs FP00001032, FP00000293.

---

## Bellems Srl

- RNC: 131937241
- Cuenta(s) de gasto típica(s): 611.17 Dieta y Viáticos (100%)
- ITBIS / retenciones observados: 2 docs con ITBIS 18% (2 líneas), 0 sin. Sin retenciones.
- NCF típico: B01 (2 docs)
- Vía de pago: Tarjeta de Crédito (2). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días (pago inmediato)
- Tratamiento típico: Restaurante — alimentación de personal. 100% a 611.17 Dieta y Viáticos con ITBIS 18%. Pago con tarjeta al momento. Evidencia: 2 docs, DocIDs FP00000597, FP00000528.

---

## Bravo S A

- RNC: 101602465
- Cuenta(s) de gasto típica(s): 611.14 Otros gastos de personal (72.6%), 620.06 Suministros de oficina y otros (27.4%)
- ITBIS / retenciones observados: 2 docs con ITBIS 18% (5 líneas), 0 sin. Sin retenciones.
- NCF típico: E31 (2 docs)
- Vía de pago: Tarjeta de Crédito (2). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: ~73% a 611.14 Otros gastos de personal (premio/incentivo de personal) y ~27% a 620.06 Suministros de oficina — la imputación depende del contenido de cada compra. Pago con tarjeta. Evidencia: 2 docs, DocIDs FP00000645, FP00000036.

---

## Dipsa Coral Srl

- RNC: 130866171
- Cuenta(s) de gasto típica(s): 620.11 Combustible (100%)
- ITBIS / retenciones observados: 0 docs con ITBIS (2 sin — combustible no discrimina ITBIS). Sin retenciones.
- NCF típico: E31 (2 docs)
- Vía de pago: sin pagos registrados en el agregado. Cuenta banco no identificada.
- Plazo medio de pago: sin dato (0 pagos registrados)
- Tratamiento típico: Estación de servicio / combustible de vehículos, 100% a 620.11 sin ITBIS (implícito en el precio). Sin pagos registrados en el agregado — revisar cómo se canceló. Evidencia: 2 docs, DocIDs FP00000909, FP00000907.

---

## Emprendia Consulting Srl

- RNC: 131165389
- Cuenta(s) de gasto típica(s): 621.04 Otros servicios profesionales (100%)
- ITBIS / retenciones observados: 2 docs con ITBIS 18% (2 líneas), 0 sin. Retención de ITBIS 30% (Norma 02-05, PJ→PJ servicios profesionales liberales) — confirmado 2026-08-03 (FP00001072). El monto DOP 4,085.91 del destilado era ITBIS 30%, no ISR 2%.
- NCF típico: B01 (2 docs)
- Vía de pago: Transferencia (1 pago registrado). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 4 días
- Tratamiento típico: Consultoría/servicios profesionales (regencia de establecimiento farmacéutico). 100% a 621.04 Otros servicios profesionales con ITBIS 18%. Montos altos (DOP 95,775 en 2 facturas). Retención ITBIS 30% (Norma 02-05, PJ→PJ servicios profesionales liberales) sobre el ITBIS facturado. Pago por transferencia. Evidencia: 3 docs, DocIDs FP00001072, FP00001049, FP00000869.

---

## Estacion De Servicios Ozama Srl

- RNC: 101632501
- Cuenta(s) de gasto típica(s): 620.11 Combustible (100%)
- ITBIS / retenciones observados: 0 docs con ITBIS (2 sin — combustible no discrimina ITBIS). Sin retenciones.
- NCF típico: E31 (1), B01 (1)
- Vía de pago: Tarjeta de Crédito (1 pago registrado de 2 facturas). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Estación de servicio / combustible de vehículos, 100% a 620.11 sin ITBIS (implícito en el precio). Pago con tarjeta en bomba. Evidencia: 2 docs, DocIDs FP00001050, FP00000355.

---

## Foodhall Holding Srl

- RNC: 131010148
- Cuenta(s) de gasto típica(s): 611.17 Dieta y Viáticos (90.9%), 690.06 Propina Legal (9.1%)
- ITBIS / retenciones observados: 2 docs con ITBIS 18% (4 líneas), 0 sin. Sin retenciones.
- NCF típico: E31 (2 docs)
- Vía de pago: Tarjeta de Crédito (2). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días (pago inmediato)
- Tratamiento típico: Restaurante — alimentación de personal. ~91% a 611.17 Dieta y Viáticos y la propina legal del 10% a 690.06. Patrón idéntico a Max Grill / Kylg / Grupo Rolling. Pago con tarjeta al momento. Evidencia: 2 docs, DocIDs FP00000842, FP00000405.

---

## Ghanem Srl

- RNC: 130997081
- Cuenta(s) de gasto típica(s): 620.06 Suministros de oficina y otros (100%)
- ITBIS / retenciones observados: 2 docs con ITBIS 18% (5 líneas), 0 sin. Sin retenciones.
- NCF típico: E31 (1), B01 (1)
- Vía de pago: Tarjeta de Crédito (2). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Suministros de oficina, 100% a 620.06 con ITBIS 18%. Pago con tarjeta. Evidencia: 2 docs, DocIDs FP00000865, FP00000155.

---

## Inversiones Aika Srl

- RNC: 132450477
- Cuenta(s) de gasto típica(s): 611.19 Dieta y Viáticos (Bien) (52.0%), 611.17 Dieta y Viáticos (48.0%)
- ITBIS / retenciones observados: 2 docs con ITBIS 18% (2 líneas), 0 sin. Sin retenciones.
- NCF típico: B01 (2 docs)
- Vía de pago: Tarjeta de Crédito (1 pago registrado de 2 facturas). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: AMBIGUO — preguntar. Restaurante/alimentación de personal, pero el gasto se reparte ~52/48 entre 611.19 Dieta y Viáticos (Bien) y 611.17 Dieta y Viáticos, demasiado parejo para clasificar en autónomo. La distinción entre ambas cuentas de dieta depende del criterio de imputación (probar si "Bien" sigue una regla consistente). Pago con tarjeta. Evidencia: 2 docs, DocIDs FP00000979, FP00000190.

---

## Inversiones Camarelli Srl

- RNC: 131471463
- Cuenta(s) de gasto típica(s): 611.17 Dieta y Viáticos (90.9%), 690.06 Propina Legal (9.1%)
- ITBIS / retenciones observados: 2 docs con ITBIS 18% (6 líneas), 0 sin. Sin retenciones.
- NCF típico: B01 (2 docs)
- Vía de pago: Tarjeta de Crédito (1 pago registrado de 2 facturas). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días (pago inmediato)
- Tratamiento típico: Restaurante — alimentación de personal. ~91% a 611.17 Dieta y Viáticos y la propina legal del 10% a 690.06. Patrón idéntico a Max Grill / Kylg / Grupo Rolling. Pago con tarjeta al momento. Evidencia: 2 docs, DocIDs FP00001051, FP00000810.

---

## Inversiones Familia Pucchi Srl

- RNC: 132079795
- Cuenta(s) de gasto típica(s): 611.17 Dieta y Viáticos (90.9%), 690.06 Propina Legal (9.1%)
- ITBIS / retenciones observados: 2 docs con ITBIS 18% (6 líneas), 0 sin. Sin retenciones.
- NCF típico: B01 (2 docs)
- Vía de pago: Tarjeta de Crédito (2 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días (pago inmediato)
- Tratamiento típico: Restaurante — alimentación de personal. ~91% a 611.17 Dieta y Viáticos y la propina legal del 10% a 690.06. Patrón idéntico al grupo de restaurantes. Total histórico elevado (DOP 78,796.80 en 2 facturas — ver si son facturas grandes o múltiples consumos acumulados). Pago con tarjeta al momento. Evidencia: 2 docs, DocIDs FP00000703, FP00000532.

---

## Inversiones Migs Srl

- RNC: 101628431
- Cuenta(s) de gasto típica(s): 620.11 Combustible (100%)
- ITBIS / retenciones observados: 0 docs con ITBIS (2 sin — estaciones de servicio no cobran ITBIS en combustible). Sin retenciones.
- NCF típico: B01 (2 docs)
- Vía de pago: Tarjeta de Crédito (2 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días (pago inmediato en bomba)
- Tratamiento típico: Combustible de vehículos, 100% a 620.11 sin ITBIS. Patrón idéntico a Isla Dominicana de Petróleo. Pago con tarjeta. Evidencia: 2 docs, DocIDs FP00000714, FP00000473.

---

## Inversiones Santa Catalina Srl

- RNC: 131202586
- Cuenta(s) de gasto típica(s): 611.17 Dieta y Viáticos (90.9%), 690.06 Propina Legal (9.1%)
- ITBIS / retenciones observados: 2 docs con ITBIS 18% (3 líneas), 0 sin. Sin retenciones.
- NCF típico: E31 (1), B01 (1)
- Vía de pago: Tarjeta de Crédito (1 pago registrado de 2 facturas). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días (pago inmediato)
- Tratamiento típico: Restaurante — alimentación de personal. ~91% a 611.17 Dieta y Viáticos y la propina legal del 10% a 690.06. Mezcla de NCF E31 y B01 entre las 2 facturas. Pago con tarjeta al momento. Evidencia: 2 docs, DocIDs FP00000959, FP00000248.

---

## Invigo Srl

- RNC: 131364616
- Cuenta(s) de gasto típica(s): 620.11 Combustible (100%)
- ITBIS / retenciones observados: 0 docs con ITBIS (2 sin). Sin retenciones.
- NCF típico: E31 (2 docs)
- Vía de pago: Tarjeta de Crédito (2 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días (pago inmediato en bomba)
- Tratamiento típico: Combustible de vehículos, 100% a 620.11 sin ITBIS. Patrón idéntico a Isla Dominicana de Petróleo / Inversiones Migs. Pago con tarjeta. Evidencia: 2 docs, DocIDs FP00000739, FP00000722.

---

## Luvali Global Srl

- RNC: 132309634
- Cuenta(s) de gasto típica(s): 611.17 Dieta y Viáticos (90.9%), 690.06 Propina Legal (9.1%)
- ITBIS / retenciones observados: 2 docs con ITBIS 18% (2 líneas), 0 sin. Sin retenciones.
- NCF típico: B01 (2 docs)
- Vía de pago: Tarjeta de Crédito (2 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días (pago inmediato)
- Tratamiento típico: Restaurante — alimentación de personal. ~91% a 611.17 Dieta y Viáticos y la propina legal del 10% a 690.06. Pago con tarjeta al momento. Evidencia: 2 docs, DocIDs FP00000559, FP00000536.

---

## Mean Well

- RNC: sin RNC (proveedor del exterior)
- Cuenta(s) de gasto típica(s): 130.02 Compras en Tránsito (100%)
- ITBIS / retenciones observados: 0 docs con ITBIS (2 sin — proveedor del exterior, no aplica ITBIS local). Sin retenciones registradas.
- NCF típico: sin NCF (proveedor del exterior, no emite NCF dominicano)
- Vía de pago: Transferencia (1 pago registrado de 2 facturas). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 2 días
- Tratamiento típico: Proveedor del exterior (USD) — fabricante de componentes (Power Supply / electrónica). Compras van a 130.02 Compras en Tránsito al 100% y se liquidan a inventario/costo cuando llegan. Sin ITBIS ni NCF local. Pago por transferencia. Evidencia: 2 docs, DocIDs FP00000446, FP00000059.

---

## Ms Enterprises Srl

- RNC: 101822635
- Cuenta(s) de gasto típica(s): 620.11 Combustible (100%)
- ITBIS / retenciones observados: 0 docs con ITBIS (2 sin). Sin retenciones.
- NCF típico: B01 (2 docs)
- Vía de pago: Tarjeta de Crédito (1 pago registrado de 2 facturas). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días (pago inmediato en bomba)
- Tratamiento típico: Combustible de vehículos, 100% a 620.11 sin ITBIS. Pago con tarjeta. Evidencia: 2 docs, DocIDs FP00000950, FP00000651.

---

## Pizzorno

- RNC: 133415208
- Cuenta(s) de gasto típica(s): 611.17 Dieta y Viáticos (86.1%), 690.06 Propina Legal (8.6%), 801.01 Gastos sin comprobante de crédito fiscal y/o al exterior (5.3%)
- ITBIS / retenciones observados: 1 doc con ITBIS 18% (2 líneas), 1 sin. Sin retenciones.
- NCF típico: B01 (1 doc de 2 — el otro sin NCF identificado)
- Vía de pago: Tarjeta de Crédito (1 pago registrado de 2 facturas). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días (pago inmediato)
- Tratamiento típico: Restaurante — alimentación de personal. ~86% a 611.17 Dieta y Viáticos, ~9% propina legal a 690.06, y ~5% a 801.01 (porción sin crédito fiscal). Una de las 2 facturas vino sin ITBIS. Pago con tarjeta al momento. Evidencia: 2 docs, DocIDs FP00000797, FP00000677.

---

## Raya Food Dominicana Srl

- RNC: 130246491
- Cuenta(s) de gasto típica(s): 611.17 Dieta y Viáticos (100%)
- ITBIS / retenciones observados: 2 docs con ITBIS 18% (4 líneas), 0 sin. Sin retenciones.
- NCF típico: E31 (2 docs)
- Vía de pago: Tarjeta de Crédito (2 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días (pago inmediato)
- Tratamiento típico: Restaurante/comida — alimentación de personal. 100% a 611.17 Dieta y Viáticos con ITBIS 18%. Sin propina legal separada (probablemente incluida en el monto o no cobrada). Pago con tarjeta al momento. Evidencia: 2 docs, DocIDs FP00000679, FP00000512.

---

## Refricentro Rubiera Srl

- RNC: 101824735
- Cuenta(s) de gasto típica(s): 160.07 Otros Activos Fijos (100%)
- ITBIS / retenciones observados: 2 docs con ITBIS 18% (5 líneas), 0 sin. Sin retenciones.
- NCF típico: E31 (2 docs)
- Vía de pago: Tarjeta de Crédito (2 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días
- Tratamiento típico: Compra de activos fijos (equipos/electrodomésticos), 100% a 160.07 Otros Activos Fijos con ITBIS 18%. Montos elevados (DOP 55,800 en 2 facturas). Pago con tarjeta. Evidencia: 2 docs, DocIDs FP00000770, FP00000257.

---

## Sincoro Restaurant And Auto Detailing Srl

- RNC: 132090081
- Cuenta(s) de gasto típica(s): 611.17 Dieta y Viáticos (98.8%), 690.06 Propina Legal (1.2%)
- ITBIS / retenciones observados: 2 docs con ITBIS 18% (4 líneas), 0 sin. Sin retenciones.
- NCF típico: B01 (2 docs)
- Vía de pago: Tarjeta de Crédito (2 pagos). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días (pago inmediato)
- Tratamiento típico: Restaurante — alimentación de personal. ~99% a 611.17 Dieta y Viáticos, propina legal mínima a 690.06. Pago con tarjeta al momento. Evidencia: 2 docs, DocIDs FP00000480, FP00000362.

---

## The Corporate Lunch Srl

- RNC: 131422675
- Cuenta(s) de gasto típica(s): 611.17 Dieta y Viáticos (90.9%), 690.06 Propina Legal (9.1%)
- ITBIS / retenciones observados: 2 docs con ITBIS 18% (4 líneas), 0 sin. Sin retenciones.
- NCF típico: E31 (1), B01 (1)
- Vía de pago: Tarjeta de Crédito (2). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días (pago inmediato)
- Tratamiento típico: Restaurante — alimentación de personal. ~91% a 611.17 Dieta y Viáticos y la propina legal del 10% a 690.06. Mezcla de NCF E31 y B01 entre las 2 facturas. Pago con tarjeta al momento. Evidencia: 2 docs, DocIDs FP00000095, FP00000017.

---

## Yuanwang Trading Srl

- RNC: 133214946
- Cuenta(s) de gasto típica(s): 620.06 Suministros de oficina y otros (100%)
- ITBIS / retenciones observados: 2 docs con ITBIS 18% (3 líneas), 0 sin. Sin retenciones.
- NCF típico: B01 (2 docs)
- Vía de pago: Tarjeta de Crédito (2). Cuenta banco no identificada en agregado.
- Plazo medio de pago: 0 días (pago inmediato)
- Tratamiento típico: Suministros de oficina, 100% a 620.06 con ITBIS 18%. Pago con tarjeta al momento. Evidencia: 2 docs, DocIDs FP00000253, FP00000252.

---

## Residual — proveedores de 1 solo documento

| Proveedor | RNC | Cuenta(s) | ITBIS | NCF | Pago | DocID | Monto DOP |
|---|---|---|---|---|---|---|---|
| Angel Veloz Millares Srl | 101108665 | 620.11 Combustible | sin | E31 | sin registro | FP00001029 | 750.00 |
| Antonio Chahin M S A | 101088222 | 630.05 Gastos de Representación | 18% | E31 | Tarjeta | FP00000733 | 2,995.01 |
| Argent Investments Srl | 130402061 | 611.17 Dieta y Viáticos, 690.06 Propina Legal | 18% | B01 | Tarjeta | FP00000484 | 505.60 |
| Asogadom Srl | 130218935 | 620.11 Combustible | sin | B01 | Tarjeta | FP00000650 | 600.00 |
| Avansi Srl | 130222509 | 620.06 Suministros de oficina y otros | 18% | E31 | Tarjeta | FP00000580 | 2,360.00 |
| Bakerstreet Holdings Srl | 130749531 | 630.05 Gastos de Representación, 690.06 Propina Legal | 18% | E31 | sin registro | FP00001040 | 7,993.60 |
| Big Apple Cleaner | sin RNC | 801.01 Gastos sin comprobante de crédito fiscal | sin | sin NCF | Tarjeta | FP00000699 | 194.70 |
| Body Shop Athletic Club Srl | 101637587 | 630.05 Gastos de Representación | sin | E31 | Tarjeta | FP00000794 | 38,697.00 |
| Caruso Pizza Su Misura Srl | 131981267 | 611.17 Dieta y Viáticos, 690.06 Propina Legal | 18% | E31 | Tarjeta | FP00000549 | 6,969.60 |
| Centro Automotriz Jaquez Srl | 101065801 | 650.08 Reparaciones y Mantenimientos Equipos de Transporte | sin | B01 | sin registro | FP00000940 | 762.71 |
| Centro De Capacitacion Enfoque Digital Eirl | 132024516 | 611.13 Capacitación | sin | B01 | Transferencia | FP00000165 | 5,500.00 |
| Centro De Frenos David Srl | 122001085 | 650.08 Reparaciones y Mantenimientos Equipos de Transporte | 18% | E31 | sin registro | FP00000961 | 800.00 |
| Chanlatte Formas & Nutricion Srl | 101670363 | 611.17 Dieta y Viáticos | 18% | B01 | Tarjeta | FP00000394 | 6,170.49 |
| Conformatic Srl | 101865431 | 160.06 Mobiliarios y Equipos de Oficina | 18% | E31 | sin registro | FP00001043 | 31,000.01 |
| Credigas S A. | 101122439 | 620.11 Combustible | sin | B01 | Tarjeta | FP00000296 | 600.00 |
| Distribuidora Corripio S A S | 101003693 | 160.06 Mobiliarios y Equipos de Oficina | 18% | E31 | Tarjeta | FP00000668 | 6,995.46 |
| Distribuidores Internacionales De Petroleo S A | 101831936 | 620.11 Combustible | sin | E31 | Tarjeta | FP00000481 | 2,000.00 |
| Eco Doa Catalina | sin RNC | 801.01 Gastos sin comprobante de crédito fiscal y/o al exterior | sin | sin NCF | Tarjeta | FP00000836 | 750.00 |
| Edufinsa Escuela De Negocios & Tecnologia Srl | 132184416 | 611.13 Capacitación | sin | B01 | Transferencia | FP00000572 | 25,485.00 |
| Effe Pizza Srl | 132624696 | 611.14 Otros gastos de personal, 690.06 Propina Legal | 18% | B01 | Tarjeta | FP00000007 | 3,948.46 |
| FreeWay Enterprise SRL | 131372228 | 611.02 Comisiones | 18% | B01 | sin registro | FP00001068 | 90,000.00 |
| El Ferreton Srl | 131667351 | 620.06 Suministros de oficina y otros | 18% | B01 | sin registro | FP00000989 | 620.00 |
| Electromuebles Kewrys Srl | 131127835 | 160.07 Otros Activos Fijos | 18% | E31 | Transferencia | FP00000488 | 9,500.00 |
| Gamma Elite Srl | 130518149 | 160.06 Mobiliarios y Equipos de Oficina | 18% | B01 | Transferencia | FP00000684 | 84,866.25 |
| Gravisa Foods Srl | 132769104 | 611.17 Dieta y Viáticos, 690.06 Propina Legal | 18% | B01 | Tarjeta | FP00000461 | 2,835.20 |
| Grupo Astro Srl | 130570592 | 620.06 Suministros de oficina y otros | 18% | E31 | Tarjeta | FP00000736 | 260.00 |
| Grupo Diseño Awort Arquitectura & Arte Srl | 131187609 | 160.07 Otros Activos Fijos | 18% | B01 | Transferencia+Tarjeta | FP00000089 | 112,100.00 |
| Grupo Fuddom Srl | 132263529 | 611.17 Dieta y Viáticos | 18% | B01 | Tarjeta | FP00000255 | 1,240.42 |
| Grupo Rodriguez Anton Srl | 133347482 | 160.06 Mobiliarios y Equipos de Oficina | 18% | B01 | sin registro | FP00000796 | 21,004.00 |
| Gulfstream Petroleum Gestiones Operativas Srl | 131738885 | 620.11 Combustible | sin | B01 | Tarjeta | FP00000333 | 600.00 |
| Hummus Naco | sin RNC | 801.01 Gastos sin comprobante de crédito fiscal y/o al exterior | sin | sin NCF | Transferencia | FP00000436 | 2,997.00 |
| Importers T & E S A | 102616541 | 630.05 Gastos de Representación | 18% | B01 | Tarjeta | FP00000475 | 9,300.00 |
| Ingenieria Del Valor Srl | 131518567 | 621.02 Servcios Legales | 18% | B01 | Transferencia | FP00000718 | 14,160.00 |
| Innovex Group Srl | 132917472 | 611.17 Dieta y Viáticos | 18% | B01 | Tarjeta | FP00000727 | 2,730.00 |
| Inversiones A & C Five Wings Srl | 131319297 | 620.11 Combustible | sin | E31 | sin registro | FP00001025 | 750.00 |
| Pulse Harmony J & G Srl | 133525844 | 630.05 Gastos de Representación | sin | E31 | Tarjeta | FP00001077 | 15,000.00 |
| Carrefour (CDH SAS) | 101802456 | 620.06 Suministros de oficina y otros | 18% | E31 | Tarjeta | FP00001120 | 374.95 |
