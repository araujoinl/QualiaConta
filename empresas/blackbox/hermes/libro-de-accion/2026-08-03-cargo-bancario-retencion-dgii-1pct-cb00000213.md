# Cargo bancario — Retención DGII 1% (Norma 07-19)

**Fecha:** 2026-07-31
**Documento ADM:** CB00000213 (BankCharges)
**Monto:** RD$0.55 DOP
**Banco:** Santa Cruz — cuenta Operaciones 874 (11122010023874)

## Asiento

| Cuenta | Nombre | Débito | Crédito |
|--------|--------|--------|---------|
| 150.06 | Retención DGII 1% Norma 07-19 | 0.55 | — |
| 101.06 | Banco Operaciones 874 | — | 0.55 |

## Fundamento

Descuento del 1% aplicado por el banco por la Norma DGII 07-19 (retención del
1% sobre pagos a proveedores). Cuenta de cargo mapeada del histórico de ADM
(mapa de cargos bancarios). Cargo bancario detectado por conciliación con
Supabase (banco_tx_id `7ca86100-3cf7-4702-b103-d58cbfa9060d`).

**Método:** script (`registrar-cargo-bancario.py`)
**Confianza:** 0.80

## Aprobó

C.Araujo, por la mesa web (aprobación en lote, 2026-08-03).

## Alcance

Aplica a todo cargo bancario detectado por conciliación cuyo concepto calce
con retención DGII 1% (Norma 07-19) en la cuenta Operaciones 874 de Banco
Santa Cruz: débito a 150.06, crédito al banco. El mismo mapeo rige para las
demás cuentas de Banco Santa Cruz donde aparezca el mismo concepto.
