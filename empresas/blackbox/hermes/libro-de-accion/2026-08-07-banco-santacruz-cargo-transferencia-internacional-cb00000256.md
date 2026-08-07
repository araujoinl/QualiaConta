# Cargo bancario — Transferencia internacional US$60.00 (CB00000256)

**Fecha:** 2026-08-07
**Documento ADM:** CB00000256 (BankCharges)
**NCF:** E310004499038
**Proveedor/emisor:** Banco Santa Cruz
**Cuenta bancaria:** 102.01 — Banco Suplidores USD 404 (21122020001404)
**Moneda:** USD · Tasa: 58.1882 · Monto DOP: RD$3,491.29
**Aprobó:** C.Araujo, por la mesa web

## Asiento

| Cuenta | Descripción | Débito | Crédito |
|---|---|---|---|
| 640.01 — Cargos Bancarios | Por transferencia internacional | 60.00 | |
| 102.01 — Banco Suplidores USD 404 | santacruz · Suplidores | | 60.00 |

## Detalle

Cargo bancario detectado por el detector de cargos: comisión por transferencia
internacional del 06/08/2026. El banco emitió e-CF E310004499038 (tipo 31, crédito
fiscal) por sus propias comisiones. Registrado como BankCharges con dirección
`cargo`: débito a 640.01 (Cargos Bancarios), crédito a 102.01 (cuenta que pagó).

El monto en USD es US$60.00; equivalente a RD$3,491.29 a la tasa del día (58.1882).
`Reference` en ADM: E310004499038 (referencia persistida y confirmada en el readback).

Movimiento bancario reclamado: `f5621d07-76ee-4d0b-ad39-a69d3f0a5a32`.

**Método:** script (detector de cargos).

## Alcance

Cargos bancarios del Banco Santa Cruz — cuenta Suplidores USD 404 — con e-CF E31
emitido por el banco: se registran como BankCharges, débito a 640.01, crédito a la
cuenta bancaria origen. Aplica a todas las comisiones y cargos de este banco.
