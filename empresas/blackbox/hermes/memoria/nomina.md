---
estado: borrador
aprobo:
evidencia: patrón detectado por regex nomina|tss|infotep sobre Journals (60/186 asientos); estructura NO verificada línea a línea, corte 2026-08-02
---

# Nómina — patrón mensual de 3 asientos

⚠️ **No verificado línea a línea.** Este esqueleto sale del patrón de
`Reference` en los Journals (60 de 186 matchean nomina|tss|infotep); las
cuentas exactas y sus montos los confirma la destilación F4 contra asientos
reales. Hasta entonces: estructura orientativa, jamás base de un asiento.

El módulo PR nativo de ADM está **vacío por diseño**: la nómina vive como
asientos manuales (Journals) y el pago sale probablemente por PC (AccountPayments).

## Asiento 1 — `NOMINA` (mensual)

| Cuenta | Concepto | Debe | Haber |
|---|---|---|---|
| 611.x | Gasto de sueldos y salarios | ✓ | |
| 210.x | Retenciones por pagar (TSS empleado, ISR) | | ✓ |
| 2xx.xx | Nómina por pagar (neto a empleados) | | ✓ |

## Asiento 2 — `REG. TSS EMPLEADOR` (mensual)

| Cuenta | Concepto | Debe | Haber |
|---|---|---|---|
| 611.x | Aporte patronal TSS (gasto) | ✓ | |
| 210.x | TSS por pagar | | ✓ |

## Asiento 3 — `REG.INFOTEP` (mensual)

| Cuenta | Concepto | Debe | Haber |
|---|---|---|---|
| 611.x | INFOTEP (gasto) | ✓ | |
| 220.01 | INFOTEP por pagar | | ✓ |

## Qué falta confirmar en F4

1. Los códigos exactos dentro de 611.x / 210.x y la cuenta del neto por pagar.
2. Que los 3 asientos aparezcan todos los meses (y qué meses faltan o duplican).
3. El vínculo asiento → pago (PC/AccountPayments, cuenta de banco usada).
4. Montos: acá NUNCA van montos por empleado — solo el asiento tipo (dato
   sensible; la regla viene del plan de preentrenamiento §7).
