---
estado: ratificado
aprobo: C.Araujo, por chat, 2026-08-10 (confirmó la imputación Dr. 210.11 del pago mensual)
evidencia: serie de Pagos a Cuentas PC00000017 (dic-2024) → PC00000314 (feb-2026) de Blackbox, beneficiario "DGII ISR"; provisión anual ED00000165 "P/R Anticipos del periodo 2026-2027"; plan de cuentas de Blackbox. Corte 2026-08-10.
---

# Pagos a cuenta del ISR — modelo de asiento

La contraparte contable de la norma de anticipo de ISR
([../dgii/normas/anticipo-isr.md](../dgii/normas/anticipo-isr.md)). Fija cómo se
asienta en ADM Cloud el ciclo completo: provisión anual, pago mensual y
liquidación al cierre.

Las cuentas son las de Blackbox (`150.02`, `210.11`, `210.10`, `900.01`,
`101.05`). Otras empresas con el mismo plan replican el modelo; con plan
distinto, se mapean las cuentas y la estructura se mantiene.

## El modelo — tres momentos

### 1. Provisión anual (una entrada de diario al abrir el año fiscal)

Reconoce de golpe la obligación de pagar las cuotas del año y el activo fiscal
que se va a acumular.

- Dr. `150.02` Anticipos ISR (activo — crédito contra el ISR del año)
- Cr. `210.11` Anticipos ISR por Pagar (pasivo — las cuotas por pagar)

En Blackbox es la entrada de diario con reference "P/R Anticipos del periodo
AAAA-AAAA" (al 2026-08-10, `ED00000165` para el periodo 2026-2027).

### 2. Pago mensual (un Pago a Cuentas por cada cuota) ← el caso recurrente

Cada mes, al pagar la cuota con la transferencia del banco impuestos:

- Dr. `210.11` Anticipos ISR por Pagar (rebaja el pasivo abierto en el paso 1)
- Cr. `101.05` Banco Impuestos 964

En ADM Cloud es un **Pago a Cuentas** (`AccountPayment` / `PC`), **no** una
entrada de diario. Por eso los pagos mensuales no aparecen entre los journals:
son otro tipo de documento. Al final del año fiscal `210.11` queda en cero y
`150.02` acumula el total anticipado.

> **Confirmado por el dueño (2026-08-10):** el pago mensual debita `210.11`.
> Esa es la cuenta correcta: rebaja el pasivo que abrió la provisión anual.
> Imputar el pago a `150.02` duplicaría (la provisión ya lo debitó); imputarlo a
> `900.01` (gasto) anticiparía gasto que sólo se define al cierre.

### 3. Liquidación al cierre del año fiscal (declaración IR2)

Recién al determinar el ISR definitivo se toca gasto.

- Dr. `900.01` Gasto ISR (lo que corresponde al año)
- Cr. `210.10` ISR anual
- Compensación de anticipos: Dr. `210.10` / Cr. `150.02`
- Si anticipo > ISR → saldo a favor (queda en `150.02` / `150.07`); si ISR >
  anticipo → diferencia a pagar con otro Pago a Cuentas contra `210.10`.

## Cuota y deuda

La cuota mensual es **fija** para todo el año fiscal (la fija la DGII al abrir
el año). La **deuda actual** de anticipos por pagar es el saldo de `210.11`:
empieza en el total anual y baja una cuota por cada Pago a Cuentas. Hasta que el
SQL de ADM Cloud esté habilitado, el saldo se calcula por diferencia (total
anual − pagos `DGII ISR` del periodo); cuando se habilite, se valida contra el
mayor y se corrige si la provisión anual incluyó un ajuste.
