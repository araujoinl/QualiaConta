---
fecha: 2026-08-03
tipo: cargo_bancario
docid: CB00000187
monto: 100.00
moneda: DOP
fecha_documento: 2026-07-15
documento_adm: BankCharges
banco: santacruz
cuenta_banco: "101.06"
cuenta_banco_nombre: Banco Operaciones 874
cuenta_cargo: "640.01"
cuenta_cargo_nombre: Cargos Bancarios
metodo: script
aprobado_por: C.Araujo
---

# Cargo bancario — RD$100.00 comisión LBTR Banco Santa Cruz (CB00000187)

Registrado en ADM como **CB00000187** (BankCharges, uuid 1fe6180d-028b-4a41-c9cc-08def10be22b).

## Propuesta

- Banco: Banco Santa Cruz — cuenta Operaciones 874 (101.06)
- Fecha: 2026-07-15 | Moneda: DOP | Monto: RD$100.00
- Concepto: Comisión por Transferencia LBTR

## Asiento

| Cuenta | Descripción | Débito | Crédito |
|---|---|---|---|
| 640.01 Cargos Bancarios | Comisión Por Transferencia Lbtr | 100.00 | — |
| 101.06 Banco Operaciones 874 | santacruz · Operaciones | — | 100.00 |

Partida doble cuadra: 100.00 = 100.00.

## Método

Generado por script de conciliación bancaria (`metodo='script'`). La cuenta 640.01 sale del mapa de cargos bancarios del histórico de ADM; la cuenta de banco 101.06 corresponde a la cuenta Santa Cruz Operaciones 874.

## Alcance

Aplica a todos los cargos bancarios futuros del Banco Santa Cruz cuenta Operaciones 874 por comisiones LBTR y similares: débito a 640.01 Cargos Bancarios, crédito a 101.06. Sin NCF ni ITBIS (no es factura de proveedor).

**Aprobó:** C.Araujo, por la mesa web.
