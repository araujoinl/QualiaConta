# TUPAQ Cargo y Courier - servicios de courier (6 renglones)

**Registrada en ADM como:** FP00001094 (VendorBills, uuid f5b68c9d-de69-40ec-a21e-08def10be22b)
**Aprobo:** Victor, por la mesa web (2026-08-03)
**Metodo:** precedente

## Documento

- **Proveedor:** Tupaq Cargo y Courier Srl (RNC 132942248)
- **NCF:** B0100066273 (NCF impreso B01, verificado en DGII: VIGENTE)
- **Fecha:** 2026-07-09
- **Moneda/Monto:** DOP 2,117.98 (ITBIS 108.40)

## Asiento

Todas las lineas a **620.10 Envios y Correspondencias** (tipo de gasto 606 = 02
Gastos por Trabajos, Suministros y Servicios). El usuario aclaro (evento
`respuesta`) que el primer renglon "ARTICULO PERSONAL DEPORTIVO" es en realidad
flete aereo del envio, y lo demas era una nota; los 6 renglones son componentes
de un mismo servicio de courier.

| Renglon | Cantidad | Precio | ITBIS |
|---|---|---|---|
| TUMIA000828160 - LBS 4.80 ARTICULO PERSONAL DEPORTIVO | 1 | 566.78 | 102.02 |
| FLETE AEREO PRIORITY | 1 | 50.16 | 0 |
| AIRPORT FEE | 1 | 318.82 | 0 |
| COMBUSTIBLE | 1 | 1000.00 | 0 |
| GESTION ADUANAL | 1 | 38.40 | 0 |
| SERVICIOS DGA | 1 | 35.42 | 6.38 |

Base 2,009.58 + ITBIS 108.40 = 2,117.98.

## Precedente

Cuenta 620.10 por precedente: 117 de 120 usos de cuenta sobre facturas
historicas de TUPAQ (97.5 por ciento). Ref:
agg:proveedor-cuentas.json#132942248. Consistente con las entradas previas de
TUPAQ en el libro (FP00001080, FP00001092, FP00001093).

## Alcance

Facturas de TUPAQ Cargo y Courier (RNC 132942248) por servicios de envio/courier
corriente (articulo enviado + flete aereo, airport fee, combustible, gestion
aduanal, cargos DGA) se registran como VendorBills a la cuenta 620.10 Envios y
Correspondencias, tipo de gasto 606 02 Gastos por Trabajos, Suministros y
Servicios, termino de pago Al contado. NO aplica cuando el envio acompana una
importacion en curso (va a 130.02 Compras en Transito).
