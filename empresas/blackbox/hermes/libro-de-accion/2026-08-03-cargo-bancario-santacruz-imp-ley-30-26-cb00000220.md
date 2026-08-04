# Cargo bancario — Imp. 2.0 Por 1000 S/Ley 30-26 — CB00000220

**Fecha:** 2026-07-31
**Documento ADM:** CB00000220 (BankCharges, uuid 09d57e87-4db7-4396-cf18-08def10be22b)
**Banco:** Banco Santa Cruz — cuenta Suplidores USD 404 (102.01)
**Moneda:** USD
**Monto:** US$4.61
**Metodo:** script

## Asiento

| Cuenta | Nombre | Débito | Crédito |
|--------|--------|--------|---------|
| 640.02 | Cargos sobre cheques 0.15 | 4.61 | — |
| 102.01 | Banco Suplidores USD 404 | — | 4.61 |

## Detalle

Cargo bancario del 31/07/2026: «Imp. 2.0 Por 1000 S/Ley 30-26» en cuenta Suplidores
USD 404 del Banco Santa Cruz. Débito a 640.02 (Cargos sobre cheques 0.15) por el
mapa de cargos del histórico ADM; crédito al banco 102.01. Generado por script
de conciliación (`registrar-cargo-bancario.py`) a partir de la transacción
bancaria `dcf71752-4084-4ab7-af3c-e3eac021ab43`.

## Aprobó

C.Araujo, por la mesa web.

## Alcance

Cargos bancarios del Banco Santa Cruz identificados por la conciliación
automática contra Supabase: se registran como BankCharges con débito a la
cuenta de cargo que mapea el histórico (640.02 para impuestos sobre cheques)
y crédito a la cuenta bancaria correspondiente. El mapa de cuentas de cargo
se mantiene en `memoria/criterios.md` y se ajusta cuando aparezca un cargo
cuya cuenta no figure en el mapa.
