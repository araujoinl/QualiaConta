# Factura TUPAQ — flete aéreo importación + combustible

**Fecha:** 2026-08-04
**DocID ADM:** FP00001085
**Documento:** VendorBills (UUID d51a97d9-d4a3-4a60-9c3d-08def10be22b)
**Aprobó:** Victor, por la mesa web
**Trabajo mesa:** 520f7dfa-43b9-4711-b352-efa48b3bfd2b

## Hecho

Factura de crédito fiscal B0100066274 de TUPAQ CARGO y COURIER SRL (RNC 132942248),
fecha 2026-07-09, monto total RD$163.26 (ITBIS RD$11.96). NCF vigente al 31/12/2027
(DGII: FACTURA DE CRÉDITO FISCAL, estado VIGENTE). RNC padrón ACTIVO, facturador
electrónico SI, actividad "Servicio de mensajería (courier)".

## Criterio

Flete aéreo internacional de importación. Cuenta contable 620.10 "Envios y
Correspondencias" por precedente (agg:proveedor-cuentas.json#132942248: 117 de
118 facturas históricas, 97.5%). El renglón COMBUSTIBLE se separa a 620.11
"Combustible" por naturaleza — es combustible de la importación, no correspondence.

Tipo de gasto 606: 02 Gastos por Trabajos, Suministros y Servicios (toda la
factura, catálogo fijo DGII).

## Líneas registradas

| Renglón | Cuenta | Precio | ITBIS | Grupo |
|---|---|---|---|---|
| TUMIA000832619 - LBS 0.20 | 620.10 Envios y Correspondencias | 59.04 | 10.63 | ITBIS |
| ARTICULO PERSONAL | 620.10 | 10.46 | 0 | Exento |
| FLETE AEREO PRIORITY | 620.10 | 66.42 | 0 | Exento |
| AIRPORT FEE | 620.10 | 8.00 | 0 | Exento |
| COMBUSTIBLE | 620.11 Combustible | 7.38 | 1.33 | ITBIS |
| SERVICIOS DGA | 620.10 | 0.00 | 0 | Exento |
| TASA DGA-AERODOM RES. NO. | 620.10 | 0.00 | 0 | Exento |

Suma items: 151.30 + ITBIS 11.96 = 163.26 — cuadra con el documento.

## Alcance

Aplica a futuras facturas de TUPAQ CARGO y COURIER SRL (RNC 132942248): el flete
aéreo/courier y sus accesorios (airport fee, DGA, tasas aerodom) van a 620.10
"Envios y Correspondencias"; el renglón COMBUSTIBLE explícito va a 620.11
"Combustible" por su naturaleza, aunque el proveedor sea courier. Tipo de gasto
606 = 02 para este suplidor.
