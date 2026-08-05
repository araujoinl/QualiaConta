# Cargo bancario CB00000252 — Impuesto sobre cheques (Ley 30-26)

**Fecha:** 2026-08-05  
**Documento ADM:** BankCharges CB00000252 (UUID c94447fd-d4e8-4a20-4109-08def10be22c)  
**Aprobó:** C.Araujo, por la mesa web  
**Método:** script (conciliación banco → ADM)

## Hecho

Cargo del Banco Santa Cruz (cuenta 21122020001404 — Suplidores USD 404) del 2026-07-31, concepto "IMP. 2.0 POR 1000 S/LEY 30-26": RD$2 por cada mil sobre cheques, ley 30-26. Importe US$4.61 equivalente a RD$267.90 (tasa 58.1128). NCF E310004459174.

## Asiento

| Cuenta | Descripción | Débito | Crédito |
|--------|-------------|--------|---------|
| 640.02 — Cargos sobre cheques 0.15 | IMP. 2.0 POR 1000 S/LEY 30-26 | 4.61 | — |
| 102.01 — Banco Suplidores USD 404 | santacruz · Suplidores | — | 4.61 |

Moneda: USD. La base imponible declarada en el NCF (RD$267.90) y el monto contable (US$4.61) son consistentes vía la tasa 58.1128.

## Reference en ADM

Se mandó `Reference = E310004459174` (NCF del emisor) y volvió poblado en el readback. Desde esta fecha, `Reference` persiste para BankCharges y es la llave que distingue dos cargos gemelos del mismo banco/día/monto.

## Alcance

Todo cargo bancario del Banco Santa Cruz etiquetado "IMP. 2.0 POR 1000 S/LEY 30-26" — impuesto del 2‰ sobre cheques de la Ley 30-26 — se registra como BankCharges con débito a 640.02 (Cargos sobre cheques 0.15) y crédito a la cuenta bancaria de origen, en la moneda del cargo. El NCF del banco va en `Reference`. Aplica a las cuentas de BlackBox en Santa Cruz.
