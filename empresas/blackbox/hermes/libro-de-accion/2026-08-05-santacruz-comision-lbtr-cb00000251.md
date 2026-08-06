# CB00000251 — Comisión LBTR Banco Santa Cruz (Suplidores USD 404)

**Fecha:** 2026-08-05  
**Documento ADM:** BankCharges CB00000251 (uuid 97de3a61-6a2a-4da0-4108-08def10be22c)  
**NCF:** E310004454090  
**Aprobó:** C.Araujo, por la mesa web  
**Motivo del gasto:** Comisión por transferencia LBTR del 2026-07-31  
**Trabajo mesa:** 2333bcb8-be57-4198-ac50-246630ea65ab

## Hecho

Banco Santa Cruz cobró USD 5.00 el 2026-07-31 como comisión por transferencia
LBTR sobre la cuenta Suplidores USD 404 (No. 21122020001404). A la tasa del día
(58.1120) equivale a RD$290.56.

## Asiento

| Cuenta | Nombre | Débito | Crédito |
|--------|--------|--------|---------|
| 640.01 | Cargos Bancarios | 290.56 |  |
| 102.01 | Banco Suplidores USD 404 |  | 290.56 |

Partida doble cuadrada: 290.56 = 290.56. Moneda de la transacción USD 5.00,
convertida a DOP a 58.1120.

## Registro en ADM

- Tipo: BankCharges
- DocID: CB00000251
- Reference: E310004454090 (confirmado persistido en ADM)
- Adjunto: E310004454090.pdf

## Alcance

Toda comisión LBTR de Banco Santa Cruz sobre la cuenta Suplidores USD 404 se
registra igual: débito a 640.01 Cargos Bancarios por el monto en DOP (a la
tasa del día del cargo), crédito a 102.01 Banco Suplidores USD 404. El NCF del
cargo (E31...) va como Reference en ADM para distinguir comisiones gemelas del
mismo día.

## Método

script (sugerencia de cargo bancario, conciliación banco→ADM).

## Precedente ref

script:cargos-bancarios (conciliación Banco Santa Cruz Suplidores USD 404).
