---
fecha: 2026-08-03
tipo: cargo_bancario
docid: CB00000221
monto: 0.03
moneda: USD
fecha_documento: 2026-07-31
documento_adm: BankCharges
banco: santacruz
cuenta_banco: "102.01"
cuenta_banco_nombre: Banco Suplidores USD 404
cuenta_cargo: "150.06"
cuenta_cargo_nombre: Retencion DGII 1% Norma 07-19
metodo: script
aprobado_por: C.Araujo
---

# Cargo bancario — US$0.03 retención DGII 1% Banco Santa Cruz Suplidores USD (CB00000221)

Registrado en ADM como **CB00000221** (BankCharges, uuid 4da61bfb-7952-40d5-cf27-08def10be22b).

## Propuesta

- Banco: Banco Santa Cruz — cuenta Suplidores USD 404 (102.01)
- Fecha: 2026-07-31 | Moneda: USD | Monto: US$0.03
- Concepto: Desc. 1% (Norma DGII 13-2011)

## Asiento

| Cuenta | Descripción | Débito | Crédito |
|---|---|---|---|
| 150.06 Retencion DGII 1% Norma 07-19 | Desc. 1% (Norma Dgii 13-2011) | 0.03 | — |
| 102.01 Banco Suplidores USD 404 | santacruz · Suplidores | — | 0.03 |

Partida doble cuadra: 0.03 = 0.03.

## Método

Generado por script de conciliación bancaria (`metodo='script'`). La cuenta 150.06 (Retención DGII 1% Norma 07-19) sale del mapa de cargos bancarios del histórico de ADM; la cuenta de banco 102.01 corresponde a la cuenta Santa Cruz Suplidores USD 404.

## Alcance

Aplica a todos los cargos bancarios futuros del Banco Santa Cruz cuenta Suplidores USD 404 por retención DGII 1% (Norma 13-2011 / 07-19): débito a 150.06 Retención DGII 1% Norma 07-19, crédito a 102.01. Sin NCF ni ITBIS (no es factura de proveedor).

**Aprobó:** C.Araujo, por la mesa web.
