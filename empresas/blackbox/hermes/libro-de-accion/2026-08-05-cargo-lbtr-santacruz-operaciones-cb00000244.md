# Cargo bancario CB00000244 — Comisión LBTR Santa Cruz Operaciones

**Fecha:** 2026-08-05
**Aprobó:** C. Araujo, por la mesa web
**Documento ADM:** BankCharges CB00000244 (UUID a7a75ae6-4f95-4388-4101-08def10be22c)
**NCF:** E310004417116
**Banco:** Santa Cruz — cuenta Operaciones 11122010023874

## Hecho

Comisión por transferencia LBTR del 30/07/2026, RD$100.00, cobrada por Banco Santa Cruz a la cuenta de Operaciones de BlackBox.

## Asiento

| Cuenta | Descripción | Débito | Crédito |
|---|---|---|---|
| 640.01 Cargos Bancarios | COMISION POR TRANSFERENCIA LBTR | 100.00 | |
| 101.06 Banco Operaciones 874 | santacruz · Operaciones | | 100.00 |

## Registro

Registrado en ADM Cloud como BankCharges CB00000244, con `Reference = E310004417116` (NCF del cargo). El readback confirmó que el campo `Reference` vuelve poblado desde ADM — es la llave que distingue cargos gemelos.

## Alcance

Las comisiones LBTR de Banco Santa Cruz sobre la cuenta de Operaciones (11122010023874) se registran como cargo bancario: débito a 640.01 (Cargos Bancarios), crédito a 101.06 (Banco Operaciones 874), con el NCF del cargo en `Reference`. Aplica a todo cargo LBTR de esta cuenta mientras la clasificación contable no cambie.
