# Deposito en garantia Formax — RD$180,000 (Caso #1)

- **Fecha:** 2026-08-07
- **Caso:** Deposito en garantia Formax — RD$180,000 (Caso #1)
- **Decisión:** BankCharges RD$180,000.00. Renglones: débito 180,000.00 → 101.04 Banco Ingresos 801; crédito 180,000.00 → 220.06 Depositos en Garantia por Renta (Anticipo) DocID CB00000258.
- **Por qué:** Deposito en garantia de renta de nave industrial cobrado por adelantado. El criterio C-002 dice Journals, pero el sistema lo bloquea porque la conciliacion no lee /api/Journals — el movimiento quedaria sin conciliar para siempre. Como la plata entro al banco via ACH (nacio en el estado de cuenta), va como BankCharges credito: mismo asiento (debito banco 101.04, credito pasivo 220.06) pero en el documento que la conciliacion si cruza. ITBIS incluido — no se suma nada. Ver Caso #1.
- **Sostén:** Método: razonado
- **Aprobó:** C.Araujo, por la mesa web
- **Alcance:** — (documenta este caso; sin alcance no automatiza)
- **Deroga:** —
