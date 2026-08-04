# Cargo bancario Banco Santa Cruz — comisión LBTR (RD$100)

**Registrada en ADM como:** CB00000175 (BankCharges, uuid ac592992-135e-481f-c959-08def10be22b)
**Aprobó:** C.Araujo, por la mesa web (2026-08-03)
**Método:** script

## Documento

- **Banco/cuenta:** Banco Santa Cruz · Operaciones (101.06, cuenta 11122010023874)
- **Transacción bancaria (Supabase):** 20d3cb01-73b2-41d0-b917-a4de6b2966e9
- **Fecha:** 2026-07-30
- **Moneda/Monto:** DOP 100.00
- **Concepto:** Comisión Por Transferencia LBTR

## Asiento

BankCharges, partida doble. CashAccountID = 101.06 Banco Operaciones 874.

| Cuenta | Descripción | Débito | Crédito |
|---|---|---|---|
| 640.01 Cargos Bancarios | Comision Por Transferencia Lbtr | 100.00 | — |
| 101.06 Banco Operaciones 874 | santacruz · Operaciones | — | 100.00 |

Total débito = total crédito = 100.00. Cuadra (dif 0.0000).

## Alcance

Cargos bancarios del Banco Santa Cruz (cuenta 101.06, Operaciones) por comisión
de transferencia LBTR u otros cargos por servicio bancario se registran como
BankCharges: débito a 640.01 Cargos Bancarios, crédito a la cuenta de banco
101.06. El monto y el concepto se toman de la transacción de Supabase
(`bank_tx_id` en la propuesta). Aplica a cargos similares en las demás cuentas
bancarias de Blackbox, cambiando únicamente la cuenta de banco de cabecera.
