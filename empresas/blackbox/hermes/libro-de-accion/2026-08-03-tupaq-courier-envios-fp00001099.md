# TUPAQ Cargo y Courier - servicio de courier (5 renglones)

**Registrada en ADM como:** FP00001099 (VendorBills, uuid 962f1af1-58cc-4dfd-a591-08def10be22b)
**Aprobo:** Victor, por la mesa web (2026-08-03)
**Metodo:** precedente

## Documento

- **Proveedor:** Tupaq Cargo y Courier Srl (RNC 132942248)
- **NCF:** E310000000238 (e-NCF; timbre no verificable por escaneo sin codigo de seguridad/fecha firma legibles)
- **Verificacion DGII:** comprobante no verificable por el timbre; padron confirma emisor ACTIVO, facturador electronico, actividad SERVICIO DE MENSAJERIA (COURRIER), razon social casa con el documento
- **Fecha:** 2026-07-16
- **Moneda/Monto:** DOP 177.19 (ITBIS 14.08)

## Asiento

Todas las lineas a **620.10 Envios y Correspondencias** (tipo de gasto 606 = 02
Gastos por Trabajos, Suministros y Servicios). Los 5 renglones (articulo personal,
flete aereo priority, airport fee, combustible, servicios DGA) son componentes de
un mismo servicio de envio/courier.

| Renglon | Cantidad | Precio | ITBIS |
|---|---|---|---|
| TUMIA000849133 - LBS 0.60 ART PERSONAL | 1 | 70.85 | 12.75 |
| FLETE AEREO PRIORITY | 1 | 10.46 | 0 |
| AIRPORT FEE | 1 | 66.42 | 0 |
| COMBUSTIBLE | 1 | 8.00 | 0 |
| SERVICIOS DGA | 1 | 7.38 | 1.33 |

Base 163.11 + ITBIS 14.08 = 177.19.

## Precedente

Cuenta 620.10 por precedente: 117 de 118 usos de cuenta sobre facturas
historicas de TUPAQ. Ref: agg:proveedor-cuentas.json#132942248. Consistente con
las entradas previas de TUPAQ en el libro (FP00001080, FP00001092, FP00001093,
FP00001094).

## Alcance

Facturas de TUPAQ Cargo y Courier (RNC 132942248) por servicios de envio/courier
corriente (articulo enviado + flete aereo, airport fee, combustible, gestion
aduanal, cargos DGA) se registran como VendorBills a la cuenta 620.10 Envios y
Correspondencias, tipo de gasto 606 02 Gastos por Trabajos, Suministros y
Servicios, termino de pago Al contado. NO aplica cuando el envio acompana una
importacion en curso (va a 130.02 Compras en Transito).
