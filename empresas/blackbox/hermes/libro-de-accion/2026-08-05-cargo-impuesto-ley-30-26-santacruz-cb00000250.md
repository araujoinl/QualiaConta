# Cargo bancario — IMP. 2.0 POR 1000 S/LEY 30-26 (CB00000250)

**Fecha:** 2026-08-05
**Documento ADM:** BankCharges CB00000250 (UUID 5f74f5bb-2510-40d3-4107-08def10be22c)
**Aprobó:** C.Araujo, por la mesa web
**Método:** script (conciliación bancaria)

## Hecho

Banco Santa Cruz cobró un impuesto de US$2.25 sobre la cuenta Suplidores USD
(21122020001404) el 2026-07-23, con NCF E310004380181 (fecha NCF 2026-07-24).
La tasa de conversión usada fue 57.9511 DOP/USD → RD$130.39.

## Asiento

| Cuenta | Descripción | Débito | Crédito |
|--------|-------------|--------|---------|
| 640.02 Cargos sobre cheques 0.15 | IMP. 2.0 POR 1000 S/LEY 30-26 | 130.39 | |
| 102.01 Banco Suplidores USD 404 | santacruz · Suplidores | | 130.39 |

Reference en ADM: E310004380181 (NCF del comprobante) — verificado que volvió
poblado en el readback (`referencia_en_adm: true`).

## Alcance

Cargos por impuesto de cheques (Ley 30-26) del Banco Santa Cruz sobre la cuenta
Suplidores USD se registran como BankCharges con débito a 640.02 y crédito a
102.01, usando la tasa de conversión del día del cargo. La referencia `Reference`
en ADM lleva el NCF del comprobante bancario.

## Adjunto

E310004380181.pdf adjuntado a la transacción por el script de registro.
