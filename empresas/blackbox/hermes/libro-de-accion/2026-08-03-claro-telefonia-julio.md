# Factura Claro — Telefonía julio 2026 (FP00001066)

**Fecha:** 2026-08-03
**Aprobó:** C.Araujo, por la mesa web
**Documento ADM:** VendorBills FP00001066 (uuid d05a5dee-4582-4f37-8e3d-08def10be22b)

## Hecho

Factura e-CF de Claro (Compañía Dominicana de Teléfonos, S.A., RNC 101001577),
NCF E310016002709, fecha 2026-07-01, por servicios de telefonía del mes.

Monto del documento: **RD$6,351.00** (Total del Mes).
Aritmética verificada: 4,885.37 + 879.36 + 97.71 + 488.56 = 6,351.00.

## Asiento registrado

| Línea | Cuenta | Descripción | Monto | ITBIS |
|---|---|---|---|---|
| 1 | 620.05 Comunicación | Servicios telecomunicaciones (renta + datos + llamadas) | 4,885.37 | 879.36 |
| 2 | 620.09 Gasto de Impuesto Selectivo al Consumo | ISC 10% | 488.56 | 0 |
| 3 | 690.05 Otros Impuestos | CDT 2% | 97.71 | 0 |

Total: **RD$6,351.00**, ITBIS aprovechable: **879.36**.
Tipo de gasto 606: **02 Gastos por Trabajos, Suministros y Servicios**.

## Criterio aplicado

**Método: precedente.** RNC 101001577, 20 facturas históricas en agg:proveedor-cuentas.json.
Tipo de gasto 02 en 18/18 facturas. Las tres cuentas (620.05, 620.09, 690.05)
son las que Claro usa históricamente para sus cargos: base de servicio con ITBIS
aprovechable, ISC y CDT como renglones exentos propios (no son ITBIS).

**Importe registrado:** solo el Total del Mes (6,351.00). El dossier capturó
12,546.19 pero esa cifra es el Total por Pagar que arrastra un saldo anterior de
6,195.19 ya facturado el mes previo — ese saldo NO se registra acá.

## DGII

e-CF E310016002709 marcado **no verificable** en ConsultaTimbre: DGII no devolvió
la factura con los datos leídos del PDF (RNC emisor, comprador, NCF, código de
seguridad, fecha firma). Posible retardo de indexación en DGII o diferencia en el
monto reportado. Los datos salieron del propio PDF. Claro es proveedor recurrente.

## Alcance

Este criterio aplica a **todas las facturas de Claro (RNC 101001577)** que
presenten la misma estructura: renglón de servicios de telecomunicaciones con
ITBIS al 18% (cuenta 620.05), más ISC 10% (620.09) y CDT 2% (690.05) como
cargos exentos separados. El monto a registrar es siempre el Total del Mes del
e-CF, no el Total por Pagar que arrastra saldos de meses anteriores.
