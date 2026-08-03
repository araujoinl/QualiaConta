---
fecha: 2026-08-03
tipo: registro_factura
proveedor: TUPAQ CARGO & COURIER SRL
rnc: "132942248"
ncf: E310000001391
docid: FP00001074
monto: 617.24
itbis: 59.84
moneda: DOP
fecha_documento: 2026-07-27
documento_adm: VendorBills
cuenta: "620.10"
cuenta_nombre: Envios y Correspondencias
tipo_gasto_606: "02"
metodo: precedente
precedente_ref: "agg:proveedor-cuentas.json#132942248"
numero_suplidor: FTGAZ-025153
aprobado_por: C.Araujo
---

# TUPAQ Cargo & Courier - RD$617.24 flete aereo Priority (FTGAZ-025153)

Registrada en ADM como **FP00001074**.

## Propuesta

- Proveedor: TUPAQ CARGO & COURIER SRL (RNC 132942248)
- e-NCF E310000001391 verificado en DGII: Aceptado, montos cuadran
- Fecha: 2026-07-27 | Moneda: DOP | Monto: RD$617.24 | ITBIS: RD$59.84
- N suplidor: FTGAZ-025153

## Renglones (cuenta 620.10 - Envios y Correspondencias)

Cantidad 2.65 (peso) en todos los renglones.

| Descripcion | Cant. | Precio | ITBIS | Grupo |
|---|---|---|---|---|
| Flete Aereo Priority | 2.65 | 118.08 | 56.32 | ITBIS |
| Airport Fee | 2.65 | 10.46 | - | Exento |
| Combustible | 2.65 | 66.42 | - | Exento |
| Servicios DGA | 2.65 | 8.00 | - | Exento |
| Tasa DGA-Aerodom Res. No. 6859 | 2.65 | 7.38 | 3.52 | ITBIS |

Subtotal: 557.40 + ITBIS 59.84 = 617.24 OK

## Metodo y precedente

Precedente: 113 de 116 usos de cuenta 620.10 sobre 114 facturas historicas de TUPAQ (agg:proveedor-cuentas.json#132942248). Tipo de gasto 606: 02 (Gastos por Trabajos, Suministros y Servicios). Los 5 renglones (flete + airport fee + combustible + DGA + tasa Aerodom) son todos componentes del servicio de envio courier, todos a 620.10.

## Alcance

Aplica a todas las facturas futuras de TUPAQ Cargo & Courier por servicios de flete de courier internacional con estructura similar (flete aereo + cargos de transporte + tasas DGA + Aerodom). Los renglones van separados, no sumados, todos a 620.10. Tipo de gasto 606: 02.

**Aprobo:** C.Araujo, por la mesa web.
