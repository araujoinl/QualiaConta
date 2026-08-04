# Cargo bancario — Imp. 2.0 Por 1000 S/Ley 30-26 (CB00000208)

**Fecha:** 2026-07-03
**Documento ADM:** BankCharges CB00000208 (uuid cbe7eb36-1d0a-493d-ce34-08def10be22b)
**Banco:** Santa Cruz — cuenta Operaciones (101.06, 11122010023874)
**Monto:** RD$60.00 (DOP)
**Método:** script (registrar-cargo-bancario.py)

## Asiento

| Cuenta | Nombre | Débito | Crédito |
|--------|--------|-------:|--------:|
| 640.02 | Cargos sobre cheques 0.15 | 60.00 | |
| 101.06 | Banco Operaciones 874 | | 60.00 |

## Detalle

Cargo bancario del 03/07: "Imp. 2.0 Por 1000 S/Ley 30-26" por RD$60.00 en la
cuenta Operaciones de Banco Santa Cruz. Débito a 640.02 (Cargos sobre cheques
0.15) — cuenta del mapa de cargos del histórico ADM. Crédito a 101.06 (Banco
Operaciones 874). La cuenta de gasto sale del mapa de cargos bancarios
destilado de la contabilidad real.

**Aprobó:** C.Araujo, por la mesa web.

**Alcance:** Cargos bancarios identificados por conciliación contra
openbanking: van como BankCharges, con la cuenta de gasto del mapa de cargos
(destilado del histórico ADM) en el débito y la cuenta de banco en el crédito.
Aplica a todo cargo bancario de BlackBox cuyo concepto calce con una entrada
del mapa (impuesto sobre cheques, comisión, mantenimiento, ITBIS sobre comisión,
recargo de tarjeta).
