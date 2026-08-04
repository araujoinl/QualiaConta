---
tipo: transferencia_bancaria
documento_adm: BankBankTransfers
docid: TE00000213
fecha: 2026-08-03
moneda: DOP
monto: 747339.00
cuenta_origen: "101.04"
cuenta_origen_nombre: Banco Ingresos 801
cuenta_destino: "101.06"
cuenta_destino_nombre: Banco Operaciones 874
nro_referencia: "15542556"
metodo: script
banco: santacruz
aprobado_por: C.Araujo
alcance: "Transferencias internas entre cuentas del Banco Santa Cruz detectadas por conciliacion openbanking (Supabase) cuando ambas patas del banco comparten la misma referencia. El script las aparea y propone el asiento BankBankTransfers con debito a la cuenta destino y credito a la cuenta origen. Aplica a transferencias DOP sin cambio de moneda entre cuentas de Blackbox SRL en Santa Cruz."
---

# Transferencia bancaria Ingresos -> Operaciones - RD$747,339.00

Registrada en ADM como **TE00000213**.

## Detalle

- **Origen**: 101.04 Banco Ingresos 801 (cuenta 11121000000801)
- **Destino**: 101.06 Banco Operaciones 874 (cuenta 11122010023874)
- **Monto**: RD$747,339.00 DOP
- **Fecha**: 2026-08-03
- **Referencia bancaria**: 15542556 (compartida por ambas patas en Supabase)
- **Banco**: Santa Cruz

## Origen del dato

Detectada por el script de conciliacion de entradas (`conciliar-entradas.py`), que apareja transacciones de debito y credito en Supabase con la misma referencia bancaria. Las dos patas del banco comparten la referencia 15542556, confirmando que es un par real y no una coincidencia de monto.

## Aprobacion

Aprobo: **C.Araujo** por la mesa web (2026-08-03).
