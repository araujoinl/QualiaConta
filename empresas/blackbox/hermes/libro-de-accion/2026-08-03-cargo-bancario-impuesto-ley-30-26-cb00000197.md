---
fecha: 2026-08-03
tipo: registro_cargo_bancario
banco: santacruz
cuenta_banco: "101.06"
cuenta_numero: "11122010023874"
cuenta_contable: "640.02"
cuenta_nombre: Cargos sobre cheques 0.15
docid: CB00000197
uuid: bece5616-b2ee-4d7b-c9f5-08def10be22b
monto: 45.19
moneda: DOP
fecha_documento: 2026-07-15
documento_adm: BankCharges
metodo: script
aprobado_por: C.Araujo
---

# Cargo bancario Banco Santa Cruz - Imp. 2.0 Por 1000 S/Ley 30-26 - RD$45.19

Registrado en ADM como **CB00000197** (BankCharges).

## Propuesta

- Banco: santacruz, cuenta Operaciones 874 (101.06)
- Fecha transacción: 2026-07-15
- Moneda: DOP | Monto: RD$45.19 (cargo)
- Descripción del cargo: Imp. 2.0 Por 1000 S/Ley 30-26
- Cuenta de cargo: 640.02 Cargos sobre cheques 0.15

## Asiento

| Cuenta | Descripción | Débito | Crédito |
|---|---|---|---|
| 640.02 Cargos sobre cheques 0.15 | Imp. 2.0 Por 1000 S/Ley 30-26 | 45.19 | - |
| 101.06 Banco Operaciones 874 | santacruz · Operaciones | - | 45.19 |

Cuadra: D 45.19 = C 45.19.

## Método

Cargo bancario propuesto por script (conciliación banco → ADM, mapa de cargos histórico). Tipo de documento ADM: BankCharges. Sin factura de proveedor asociada: el impuesto a los cheques lo cobra el banco directamente y se registra como cargo bancario.

## Alcance

Aplica a todos los cargos bancarios futuros de Banco Santa Cruz por el Impuesto 2 por 1000 (Ley 30-26) sobre cheques: se registran como BankCharges con débito a 640.02 Cargos sobre cheques 0.15 y crédito a la cuenta de banco operativa correspondiente (101.06 para la cuenta Operaciones 874). El banco_tx_id de la transacción de Supabase debe quedar referenciado en el trabajo de la mesa.

**Aprobó:** C.Araujo, por la mesa web.
