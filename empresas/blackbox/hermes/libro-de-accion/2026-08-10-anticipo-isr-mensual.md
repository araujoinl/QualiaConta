# Anticipo mensual del ISR — Pago a Cuentas a DGII

- **Fecha:** 2026-08-10
- **Aprobó:** Carlos Araujo, por chat (2026-08-10, «procede» tras ver el plan)
- **Documentos ADM de evidencia:** serie de Pagos a Cuentas `PC00000017`
  (dic-2024) → `PC00000314` (feb-2026), beneficiario «DGII ISR», referencia
  «Anticipo impuesto sobre La Renta- `<mes>`»; provisión anual `ED00000165`
  «P/R Anticipos del periodo 2026-2027»
- **Cuenta debitada:** `210.11` Anticipos ISR por Pagar
- **Cuenta acreditada:** `101.05` Banco Impuestos 964
- **Cuota del año fiscal en curso:** RD$56,356.46 (fija, fijada por la DGII)

## Qué se decidió

El pago mensual del anticipo de ISR se registra como un **Pago a Cuentas**
(`AccountPayment` / `PC`) en ADM Cloud, debitando `210.11` (rebaja el pasivo
abierto por la provisión anual) y acreditando `101.05` (banco impuestos). Es un
pago a cuenta, no un gasto: el gasto ISR (`900.01`) se reconoce recién al cierre
del año fiscal (IR2), cuando se compensa `150.02` contra el ISR definitivo.

## Por qué

El anticipo de ISR es un pago a cuenta del ISR del año (Ley 11-92, régimen de
anticipos). Acumula como activo fiscal mientras corre el año; provisionar el
total anual en `210.11` y rebajarlo con cada pago mensual mantiene el saldo del
pasivo igual al monto que resta por pagar. Imputar el pago a gasto inflaría
gasto; imputarlo al activo `150.02` duplicaría la provisión anual.

## Sostén

- Norma del núcleo: [anticipo de ISR](../../../../nucleo-contable/dgii/normas/anticipo-isr.md)
  (Ley 11-92 + Reg. 139-98; rango: norma; vigente desde 1992).
- Doctrina del núcleo: [pagos a cuenta — modelo de asiento](../../../../nucleo-contable/doctrina/pagos-a-cuenta.md).

## Alcance

TODO pago mensual de anticipo de ISR de Blackbox:

- **Documento:** Pago a Cuentas (`AccountPayment`), beneficiario «DGII ISR».
- **Asiento:** Dr. `210.11` / Cr. `101.05`, por la cuota fija del año fiscal.
- **Cuota:** sale del último pago `DGII ISR`; es fija hasta el siguiente año
  fiscal.
- **Deuda actual:** saldo de `210.11` (provisión anual − pagos del periodo).
- **Inputs del mes:** el volante de la DGII (PDF, se adjunta) + la transferencia
  del banco impuestos (se cruza contra OpenBanking). Nada más: ni monto, ni
  cuenta — esos ya están fijos.

## Deroga

—

> Nació de la destilación del histórico (preentrenamiento), no de un caso nuevo
> en la mesa. Pendiente de ratificación formal como trabajo `criterio` si se
> quiere el mismo trámite que los demás bloques; mientras tanto es citable como
> precedente con el respaldo del dueño (campo **Aprobó**).
