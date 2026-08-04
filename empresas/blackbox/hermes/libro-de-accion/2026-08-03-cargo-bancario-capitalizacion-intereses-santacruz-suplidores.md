# Cargo bancario — Capitalización de intereses Banco Santa Cruz (Suplidores USD)

**Fecha:** 2026-08-03  
**Documento ADM:** CB00000173 (BankCharges, uuid d3dc7cdc-a2d0-4abd-c8c8-08def10be22b)  
**Aprobó:** C.Araujo, por la mesa web (aprobación en lote)

## Hecho

Capitalización de intereses del 31/07/2026 en la cuenta Banco Suplidores USD
404 (102.01) del Banco Santa Cruz. Monto: US$3.08 (crédito — entra dinero al
banco).

## Asiento

| Cuenta | Débito | Crédito |
|--------|--------|---------|
| 102.01 Banco Suplidores USD 404 | 3.08 | — |
| 700.01 Intereses Bancarios | — | 3.08 |

Total: US$3.08. Partida doble cuadrada.

## Criterio

- **Método:** script (`registrar-cargo-bancario.py`).
- **Documento ADM:** BankCharges (cargo bancario crédito).
- **Cuenta de banco:** 102.01 (Banco Suplidores USD 404, Santa Cruz), por el mapa
  de cargos bancarios histórico de ADM.
- **Contrapartida:** 700.01 Intereses Bancarios, cuenta de ingreso por
  capitalización de intereses.
- **Moneda:** USD, tasa 58.3111.
- **Dirección:** crédito (TotalAmount negativo: entra dinero al banco).

## Alcance

Aplica a toda capitalización de intereses bancarios acreditada en cuentas de
Banco Santa Cruz de Blackbox. La cuenta de banco sale del mapa de cargos
histórico de ADM; la contrapartida es 700.01 Intereses Bancarios salvo que el
movimiento tenga una naturaleza distinta (comisión, retención, mantenimiento),
en cuyo caso se clasifica por su naturaleza.
