# Cargo bancario — transferencia internacional · CB00000249

**Fecha:** 2026-08-05
**Aprobó:** C.Araujo, por la mesa web
**Documento ADM:** BankCharges · DocID CB00000249 (UUID bfc38091-446b-4c24-4106-08def10be22c)
**NCF:** E310004377241 · fecha 2026-07-24
**Banco:** Santa Cruz — Suplidores USD 404 (cuenta 102.01)
**Moneda:** USD 60.00 · tasa 57.9528 → DOP 3,477.17

## Asiento

| Cuenta | Descripción | Débito | Crédito |
|---|---|---:|---:|
| 640.01 Cargos Bancarios | POR TRANSFERENCIA INTERNACIONAL | 60.00 | |
| 102.01 Banco Suplidores USD 404 | santacruz · Suplidores | | 60.00 |

(Partida en USD; equivalente DOP 3,477.17 a la tasa 57.9528.)

## Origen

- Movimiento de banco: `9bec9b1f-1043-4a19-8599-2f5aedab92c3` (cargo en Supabase).
- `Reference` en ADM = E310004377241 (verificado en readback).
- Comprobante E310004377241 adjunto al documento ADM.

## Alcance

Cargo bancario por transferencia internacional del Banco Santa Cruz, cuenta Suplidores USD 404. Se registra como BankCharges con débito a 640.01 Cargos Bancarios y crédito a la cuenta de banco 102.01. Aplica a todo cargo de transferencia internacional de este banco con la misma naturaleza.

## Método

`script` — asiento derivado por el script de conciliación/cargos a partir del movimiento bancario y el NCF del comprobante.
