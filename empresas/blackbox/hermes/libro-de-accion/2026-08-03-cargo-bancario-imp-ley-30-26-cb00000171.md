# Cargo bancario: Imp. 2.0 Por 1000 S/Ley 30-26 — CB00000171

**Fecha:** 2026-08-03  
**Documento ADM:** BankCharges CB00000171 (uuid 9e33cf7c-8c08-41d5-c797-08def10be22b)  
**Banco:** Banco Santa Cruz — cuenta Operaciones 11122010023874 (101.06)  
**Monto:** RD$5.60 DOP  
**Transacción bancaria:** 35df3232-6ddc-4015-8592-026ce9eacc7a  

## Asiento

| Cuenta | Nombre | Débito | Crédito |
|--------|--------|--------|---------|
| 640.02 | Cargos sobre cheques 0.15 | 5.60 | — |
| 101.06 | Banco Operaciones 874 | — | 5.60 |

## Origen

Cargo bancario detectado en Supabase (openbanking) para la cuenta de operaciones
de Banco Santa Cruz. Impuesto del 2‰ por cada mil sobre cheques (Ley 30-26).

## Método

`script` — la detección y clasificación la hizo el script de conciliación
bancaria; la cuenta 640.02 sale del mapa de cargos del histórico de ADM.

## Aprobó

C.Araujo, por la mesa web (aprobación en lote, 2026-08-03).

## Alcance

Todo cargo bancario de Banco Santa Cruz cuyo concepto sea «Imp. 2.0 Por 1000
S/Ley 30-26» (impuesto del 2‰ sobre cheques, Ley 30-26) se registra como
BankCharges: débito a 640.02 (Cargos sobre cheques 0.15), crédito a la cuenta
de banco correspondiente. Aplica a las cuentas DOP de BlackBox en Banco Santa
Cruz.
