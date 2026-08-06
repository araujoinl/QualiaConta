---
estado: borrador
aprobo:
evidencia: patrón detectado por regex nomina|tss|infotep sobre Journals (60/186 asientos), corte 2026-08-02. Cuentas verificadas contra raw/journals-detalle.jsonl el 2026-08-06 (y una corregida: el aporte INFOTEP era 220.01, es 210.1). Los MONTOS siguen sin verificar — por eso no se ratifica.
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
| 611.11 | Aporte Infotep (gasto) | ✓ | |
| 210.1 | Aporte INFOTEP | | ✓ |

**Corregido el 2026-08-06 — el único número duro de este archivo estaba mal.**
Acá decía al HABER `220.01 INFOTEP por pagar`. Esa cuenta existe, pero se llama
**«Nómina por Pagar»**: es el neto a empleados, la misma que el asiento 1 usa
para lo que se les deposita. El código real del aporte es **`210.1 Aporte
INFOTEP`**, acreditado en 19 de los 20 asientos de INFOTEP del histórico.
Ojo al tipearlo: en el plan convive con **`210.10 Impuesto Sobre la Renta
anual`**, a un carácter de distancia y otra naturaleza.

## Confirmado el 2026-08-06 (era el punto 1 de «qué falta»)

Verificado contra los 186 asientos de `raw/journals-detalle.jsonl`:

- `611.11` Aporte Infotep es el gasto; `210.1` Aporte INFOTEP es el pasivo.
- `220.01` **Nómina por Pagar** es la cuenta del neto a empleados — no es de
  INFOTEP y no debe aparecer en el asiento 3.

## Qué falta confirmar

1. Que los 3 asientos aparezcan todos los meses (y qué meses faltan o duplican).
2. El vínculo asiento → pago (PC/AccountPayments, cuenta de banco usada).
3. **Los montos y el orden de los renglones.** Por esto el archivo sigue en
   `borrador` y no se ratifica: la estructura a nivel de cuenta está verificada,
   pero lo que decide un asiento real —cuánto va en cada renglón— no.
4. Montos: acá NUNCA van montos por empleado — solo el asiento tipo (dato
   sensible; la regla viene del plan de preentrenamiento §7).
