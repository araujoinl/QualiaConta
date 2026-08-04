# Cargo bancario — Retención DGII 1% (Norma 07-19) · CB00000212

**Fecha:** 2026-08-03
**Aprobó:** C.Araujo, por la mesa web
**Documento ADM:** BankCharges CB00000212 (uuid 22d88671-3c7a-4248-ce64-08def10be22b)
**Origen:** Cargo bancario 31/07 Banco Santa Cruz (cuenta Impuestos 11122010014964) —
transacción banco `33e75421-e32a-4284-8fc2-356a40f74bff`

## Hecho

Descuento del 1% aplicado por el banco sobre la cuenta de impuestos, correspondiente
a la retención DGII Norma 07-19 (antes 13-2011). Monto: RD$1.27.

## Criterio

Cargo bancario de retención impositiva: débito a **150.06 Retención DGII 1% Norma 07-19**
(activo / impuesto retenido a compensar), crédito a **101.05 Banco Impuestos 964**
(salida de efectivo de la cuenta bancaria).

- `metodo`: script (`registrar-cargo-bancario.py`, conciliación banco→ADM)
- `direccion`: cargo (sale dinero del banco)
- `confianza`: 0.8

## Asiento

| Cuenta | Nombre | Débito | Crédito |
|---|---|---:|---:|
| 150.06 | Retención DGII 1% Norma 07-19 | 1.27 | |
| 101.05 | Banco Impuestos 964 | | 1.27 |

Partida doble: cuadra (dif 0.0000). Moneda DOP, tasa 1.0.

## Alcance

Cargos bancarios por retención DGII 1% (Norma 07-19) debitados de la cuenta
de impuestos de Banco Santa Cruz (101.05): se registran como BankCharges con
débito a 150.06 y crédito al banco. Aplica a toda retención del 1% sobre la
misma cuenta bancaria mientras la norma esté vigente y la cuenta 150.06 siga
mapeada a ese concepto.
