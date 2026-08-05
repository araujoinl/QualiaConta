# Cargo bancario CB00000246 — Manejo de cuenta + retención/envío estado de cuenta

**Fecha:** 2026-08-05
**Aprobó:** C. Araujo, por la mesa web
**Documento ADM:** BankCharges CB00000246 (UUID 8d513256-ae24-40af-4103-08def10be22c)
**NCF:** E310004445600
**Banco:** Santa Cruz — cuenta Ingresos 11121000000801

## Hecho

Dos cargos del 31/07/2026 sobre la cuenta Ingresos de BlackBox en Banco Santa Cruz, amparados por el comprobante E310004445600:

1. POR MANEJO DE LA CUENTA — RD$300.00
2. POR RETENCION/ENVIO EST. CTA. — RD$150.00

Total: RD$450.00.

## Asiento

| Cuenta | Descripción | Débito | Crédito |
|---|---|---|---|
| 640.01 Cargos Bancarios | POR MANEJO DE LA CUENTA | 300.00 | |
| 640.01 Cargos Bancarios | POR RETENCION/ENVIO EST. CTA. | 150.00 | |
| 101.04 Banco Ingresos 801 | santacruz · Ingresos | | 450.00 |

## Registro

Registrado en ADM Cloud como BankCharges CB00000246, con `Reference = E310004445600` (NCF del cargo). El readback confirmó que el campo `Reference` vuelve poblado desde ADM — es la llave que distingue cargos gemelos.

## Alcance

Los cargos por manejo de cuenta y por retención/envío de estado de cuenta que Banco Santa Cruz cobra sobre la cuenta Ingresos (11121000000801) de BlackBox se registran como cargo bancario: débito a 640.01 (Cargos Bancarios), crédito a 101.04 (Banco Ingresos 801), con el NCF del cargo en `Reference`. Aplica a todo cargo de esta naturaleza sobre esta cuenta mientras la clasificación contable no cambie.
