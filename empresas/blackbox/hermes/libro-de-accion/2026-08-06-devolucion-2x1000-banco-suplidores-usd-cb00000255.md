# Devolución impuesto 2x1000 (Ley 30-26) — Banco Suplidores USD

**Documento ADM:** CB00000255 (BankCharges)
**Fecha:** 2026-08-06
**Monto:** US$2.25 (crédito)
**Cuenta banco:** 102.01 — Banco Suplidores USD 404
**Contrapartida:** 640.02 — Cargos sobre cheques 0.15

**Aprobó:** Victor, por la mesa web.

## Qué se decidió

El banco Santa Cruz devolvió US$2.25 del impuesto 2 por 1000 (Ley 30-26) en la
cuenta Suplidores USD. Es un crédito que revierte un cargo previo: entra dinero
al banco (débito 102.01) y se revierte el gasto en 640.02 (crédito).

La propuesta del detector venía sin contrapartida asignada. Se completó con
640.02 por precedente: el impuesto 2x1000 de Santa Cruz se carga históricamente a
esa cuenta (136 usos, todos de Santa Cruz), incluyendo el cargo gemelo
CB00000149 (US$2.26, misma cuenta USD 404, mismo concepto).

**Método:** script (registrar-cargo-bancario.py), con contrapartida por
precedente (agg:proveedor-cuentas.json#Banco Multiple Santa Cruz → 640.02).
**Referencia del movimiento (banco_tx_id):** 8947e409-0fd9-4ce5-b849-99dbe526f105.

## Alcance

Las devoluciones del impuesto 2x1000 (Ley 30-26) de Santa Cruz se revierten en
la misma cuenta donde se cargaron: **640.02** (Cargos sobre cheques 0.15) en
DOP, o la cuenta donde se registró el cargo original del que nace la
devolución. Aplica a cualquier devolución o reverso de impuesto bancario cuyo
cargo original fue a 640.02.
