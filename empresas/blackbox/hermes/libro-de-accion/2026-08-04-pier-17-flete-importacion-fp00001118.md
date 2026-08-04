# Factura PIER 17 GROUP DOMINICANA — flete de importación marítimo

**Fecha:** 2026-08-04
**DocID ADM:** FP00001118
**Documento:** VendorBills (UUID 0b65f210-675e-4ec5-ec98-08def10be22b)
**Aprobó:** C.Araujo, por la mesa web
**Trabajo mesa:** e677ff83-25f1-46ce-ac61-30364f789634

## Hecho

Factura electrónica E310000003177 de PIER 17 GROUP DOMINICANA SRL (RNC
130547386), fecha 2026-07-28, monto total USD 2,306.15 (ITBIS USD 152.03). B/L
LGZSDM26530923PH, vessel CMA CGM UNITY, arrival 28/07/2026.

Padrón DGII: razon_social "PIER 17 GROUP DOMINICANA SRL", nombre_comercial
"PIER 17 GROUP DOMINICANA", estado_contribuyente ACTIVO, regimen_pagos NORMAL,
actividad_economica "TRANSPORTE EN GENERAL". RNC concuerda con el emisor del
documento.

⚠ **NCF E310000003177 NO encontrado en el timbre DGII** (ConsultaTimbre
probado en USD 2,306.15 y DOP 135,163.45, con fecha firma 28-07-2026 10:28:37 y
código seguridad AWasZw extraídos del PDF). Estado del comprobante:
`dgii.estado = "no verificable"`. El padrón confirma emisor ACTIVO y
facturador electrónico; el "no encontrada" puede ser retardo de reporte del
emisor. La propuesta se aprobó con confianza 0.6 y se registró tomando el
ITBIS como crédito fiscal (líneas ITBIS 18% en VendorBills).

## Criterio

Flete de importación marítimo. Cuenta contable 130.02 "Compras en Tránsito"
para los 15 renglones por precedente
(agg:proveedor-cuentas.json#130547386: 4 de 5 facturas históricas) y memoria
ratificada (importación en curso → 130.02; flete suelto no capitalizable →
611.16). Todos los cargos del B/L (agency fee, BL Printing, CAF, CFS Surcharge,
CISF, COLLECT FEE, FHC, H/C, Handling, OTHER CHARGE, PEAK SEASON SURCHARGE,
PORT CONGESTION SURCHARGE, Port Services Charge, THC, CERTIFICACION DE FLETE)
son parte del costo de la mercancía en tránsito y se capitalizan en 130.02.

Tipo de gasto 606: 09 Compras y Gastos que Formarán parte del Costo de Venta
(toda la factura, catálogo fijo DGII).

## Líneas registradas

15 renglones, todos a 130.02 Compras en Tránsito:

7 gravados (ITBIS 18%, base 844.62) — ITBIS 152.03:
BL Printing 35.00 / CERTIFICACION DE FLETE 25.00 / CFS Surcharge 100.00 /
COLLECT FEE 65.48 / FHC 306.46 / Handling 50.00 / THC 262.68.

8 exentos (base 1,309.50):
agency fee 218.90 / CAF 95.00 / CISF 481.58 / H/C 30.00 / OTHER CHARGE 65.00 /
PEAK SEASON SURCHARGE 131.34 / PORT CONGESTION SURCHARGE 262.68 /
Port Services Charge 25.00.

Aritmética cuadra exacta: base 2,154.12 + ITBIS 152.03 = 2,306.15 USD.

## Alcance

Aplica a futuras facturas de PIER 17 GROUP DOMINICANA SRL (RNC 130547386):
los renglones de flete marítimo de importación (cargos del B/L y accesorios)
van a 130.02 "Compras en Tránsito" mientras la mercancía esté en curso; tipo
de gasto 606 = 09 para este suplidor. El criterio de capitalización de cargos
accesorios en 130.02 sigue el mismo principio que para otros fletes de
importación ya registrados (TUPAQ aéreo → 620.10 por ser gasto operacional, no
inventario en tránsito; PIER 17 marítimo → 130.02 por ser costo de mercancía).

## Nota fiscal

El NCF E310000003177 no verificó en timbre DGII al momento del registro. Si la
futura verificación (retardo de reporte del emisor) lo confirma VIGENTE, el
crédito fiscal de USD 152.03 queda firme. Si resulta NO válido, el ITBIS debe
reversarse: capitalizarlo en 130.02 (no va a ITBIS Operativo) y reclasificar el
gasto como no admitido. La aprobación de C.Araujo asumió el riesgo de tomar el
crédito con el comprobante aún no verificable.
