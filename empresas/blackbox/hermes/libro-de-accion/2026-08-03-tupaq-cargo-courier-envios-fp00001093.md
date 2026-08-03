--- 
tipo: factura
proveedor: TUPAQ CARGO & COURIER SRL
rnc: "132942248"
ncf: B0100066251
monto: 714.53
itbis: 66.92
moneda: DOP
fecha: 2026-07-08
documento_adm: VendorBills
docid: FP00001093
cuenta: "620.10"
cuenta_nombre: Envios y Correspondencias
tipo_gasto_606: "02"
metodo: precedente
precedente_ref: "agg:proveedor-cuentas.json#132942248"
aprobado_por: Victor
alcance: "Toda factura de TUPAQ Cargo y Courier SRL (RNC 132942248) se registra como VendorBills con cuenta 620.10 Envios y Correspondencias en cada linea y tipo de gasto 02, desglosando cada componente del courier (tracking, flete, airport fee, fuel surcharge, DGA) como item propio. Aplica mientras el padron DGII del proveedor este ACTIVO."
---

# TUPAQ Cargo y Courier — RD$714.53 envio/courier aereo

Registrada en ADM como **FP00001093**.

## Propuesta

- Proveedor: TUPAQ CARGO & COURIER SRL (RNC 132942248)
- NCF B0100066251 VIGENTE en DGII (vigencia 31/12/2027)
- Fecha: 2026-07-08 | Moneda: DOP | Monto: RD$714.53 | ITBIS: RD$66.92

## Renglones (cuenta 620.10 — Envios y Correspondencias)

| Descripcion | Cant. | Precio | ITBIS | Grupo |
|---|---|---|---|---|
| TUMIA000832101 - LBS 3.25 BULTO | 1 | 347.78 | 62.60 | ITBIS |
| FLETE AEREO PRIORITY | 1 | 34.00 | — | Exento |
| AIRPORT FEE | 1 | 215.87 | — | Exento |
| COMBUSTIBLE (fuel surcharge) | 1 | 25.97 | — | Exento |
| SERVICIOS DGA | 1 | 23.99 | 4.32 | ITBIS |

Subtotal: 647.61 + ITBIS 66.92 = 714.53 OK

## Metodo y precedente

Precedente: 117 de 120 usos de cuenta 620.10 sobre 118 facturas historicas de TUPAQ (agg:proveedor-cuentas.json#132942248). Tipo de gasto 606: 02 (Gastos por Trabajos, Suministros y Servicios).

**Aprobo:** Victor, por la mesa web.
