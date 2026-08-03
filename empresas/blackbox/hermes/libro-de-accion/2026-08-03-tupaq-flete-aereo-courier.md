---
tipo: factura
proveedor: TUPAQ CARGO & COURIER SRL
rnc: "132942248"
ncf: E310000000579
monto: 205.05
itbis: 18.33
moneda: DOP
fecha: 2026-07-20
documento_adm: VendorBills
docid: FP00001070
cuenta: "620.10"
cuenta_nombre: Envios y Correspondencias
tipo_gasto_606: "02"
metodo: precedente
precedente_ref: "agg:proveedor-cuentas.json#132942248"
aprobado_por: C.Araujo
alcance: "Facturas de TUPAQ con renglones de flete aereo, airport fee, fuel surcharge, servicios DGA y tasa DGA-Aerodom — todos bajo cuenta 620.10 por naturaleza de courier internacional."
---

# TUPAQ Cargo & Courier — RD$205.05 flete aereo

Registrada en ADM como **FP00001070**.

## Propuesta

- Proveedor: TUPAQ CARGO & COURIER SRL (RNC 132942248)
- e-NCF E310000000579 verificado en DGII: Aceptado, montos cuadran
- Fecha: 2026-07-20 | Moneda: DOP | Monto: RD$205.05 | ITBIS: RD$18.33

## Renglones (cuenta 620.10 — Envios y Correspondencias)

| Descripcion | Cant. | Precio | ITBIS | Grupo |
|---|---|---|---|---|
| Flete Aereo Priority | 0.80 | 118.07 | 17.00 | ITBIS |
| Airport Fee | 1 | 10.46 | — | Exento |
| Combustible (fuel surcharge) | 1 | 66.42 | — | Exento |
| Servicios DGA | 1 | 8.00 | — | Exento |
| Tasa DGA-Aerodom Res. 6859 | 1 | 7.38 | 1.33 | ITBIS |

Subtotal: 195.33 + ITBIS 18.33 = 205.05 OK

## Metodo y precedente

Precedente: 113 de 116 usos de cuenta 620.10 sobre 114 facturas historicas de TUPAQ (agg:proveedor-cuentas.json#132942248). Tipo de gasto 606: 02 (Gastos por Trabajos, Suministros y Servicios).

## Notas

- Combustible es fuel surcharge del courier, no gasolina de flotilla propia.
- Termino de pago: 30 dias (no del documento, por precedente historico).
- Numero suplidor: FTGAZ-024885.

**Aprobo:** C.Araujo, por la mesa web.
