---
estado: ratificado
aprobo: C.Araujo, por chat, 2026-08-10 (patrón verificado contra asientos reales del histórico)
evidencia: verificado 2026-08-10 contra journals-detalle.jsonl + account-payments-detalle.jsonl (corte 2026-08-02). NOMINA: ED00000170 (jun), ED00000177 (jul). TSS empleador: ED00000179 (jun), ED00000181 (jul, ref mal 202606). INFOTEP: ED00000178 (jun), ED00000180 (jul). Pagos: PC00000266 (empleado ene), PC00000335 (TSS jul), PC00000336 (INFOTEP jul).
---

# Nómina — patrón mensual de 5 piezas

La nómina de Blackbox **no es un solo asiento**: son **3 asientos de devengo + 2
patas de pago**, repartidos en el mes. El módulo PR (nómina nativa) de ADM está
**vacío por diseño**; todo vive como `Journals` (devengo) + `AccountPayments`
(pago). Nómina **jamás es autónoma** (SPEC §5 y plan-encendido-escritura §3.4):
QualiaConta arma la propuesta y el humano aprueba.

## Mapa de cuentas

| Cuenta | Nombre | Rol en nómina |
|---|---|---|
| 611.01 | Sueldos | Gasto — col. Sueldo |
| 611.02 | Comisiones | Gasto — col. Comisiones |
| 611.04 | Incentivos | Gasto — col. Otras remuneraciones (solo si hay) |
| 611.08 | Aportes SFS | Gasto — aporte patronal SFS |
| 611.09 | Aportes AFP | Gasto — aporte patronal AFP |
| 611.1 | Aporte Riesgo Laboral | Gasto — aporte patronal SRL |
| 611.11 | Aporte Infotep | Gasto — aporte INFOTEP |
| 210.04 | Retención ISR Empleados | Pasivo — ISR retenido a empleados |
| 210.08 | Retención TSS Empleados | Pasivo — SFS + AFP del empleado (dos líneas) |
| 210.09 | Aporte TSS Empleador | Pasivo — aporte patronal TSS (SFS+AFP+SRL) |
| 210.1 | Aporte INFOTEP | Pasivo — aporte INFOTEP (¡ojo: no es 210.10 ISR anual!) |
| 220.01 | Nómina por Pagar | Pasivo — neto a depositar a empleados |
| 101.06 | Banco Operaciones 874 | Banco — sale el pago a empleados |
| 101.05 | Banco Impuestos 964 | Banco — sale el pago de TSS + INFOTEP al Estado |

## Pieza 1 — `NOMINA <MES> <AÑO>` (Journal, fin de mes)

Devengo. Débito = bruto; Haber = retenciones + neto.

| Cuenta | Concepto | Debe | Haber |
|---|---|---|---|
| 611.01 | Sueldos | col. Sueldo | |
| 611.02 | Comisiones | col. Comisiones | |
| 611.04 | Incentivos | col. Otras remuneraciones | |
| 210.04 | Retención ISR Empleados | | col. ISR |
| 210.08 | Retención TSS (SFS) | | col. SFS 3.04% |
| 210.08 | Retención TSS (AFP) | | col. AFP 2.87% — **2da línea, MISMA cuenta** |
| 220.01 | Nómina por Pagar | | col. Total a pagar (neto) |

**El débito NO es la columna "Total" del Excel.** Esa columna resta 35.000 (se
salta la fila de Karla). El débito = `SUM(Sueldos) + SUM(Comisiones) +
SUM(Otras remuneraciones)`. El neto (220.01) sí es la col. "Total a pagar".

## Pieza 2 — `REG. TSS EMPLEADOR <YYYYMM>` (Journal, fin de mes)

Aporte patronal. No sale del Excel (es la carga patronal, ~15.3%).

| Cuenta | Concepto | Debe | Haber |
|---|---|---|---|
| 611.08 | Aportes SFS | SFS patronal 7.10% | |
| 611.09 | Aportes AFP | AFP patronal 7.10% | |
| 611.1 | Aporte Riesgo Laboral | SRL 1.00–1.50% (por riesgo) | |
| 210.09 | Aporte TSS Empleador | | suma de los tres |

## Pieza 3 — `REG.INFOTEP EMPLEADOR <YYYYMM>` (Journal, fin de mes)

| Cuenta | Concepto | Debe | Haber |
|---|---|---|---|
| 611.11 | Aporte Infotep | 1% base | |
| 210.1 | Aporte INFOTEP | | 1% base |

## Pieza 4 — Pago a empleados (AccountPayment por empleado)

La plata que reciben. **Un PC por empleado**, dos tandas al mes (~15 y ~30), que
es exactamente las columnas "1era Q (50%)" y "2da Q (50%)" del Excel.

| Cuenta | Concepto | Debe | Haber |
|---|---|---|---|
| 220.01 | Nómina por Pagar | neto del empleado | |
| 101.06 | Banco Operaciones 874 | | neto del empleado |

**Reference:** `N<DD><MM><AA> <Empleado>` — ej. `N150126 Carlos Araujo` = nómina
del 15/01/26 (1era quincena), `N300126` = 2da. Ejemplar: PC00000266.

## Pieza 5 — Pago de obligaciones al Estado (AccountPayment)

Dos PC a fin de mes, saliendo de **101.05 Banco Impuestos 964**:

**Pago TSS** (liquida empleado + patrón juntos):

| Cuenta | Debe | Haber |
|---|---|---|
| 210.08 Retención TSS Empleados | SFS+AFP retenido | |
| 210.09 Aporte TSS Empleador | aporte patronal | |
| 101.05 Banco Impuestos 964 | | suma |

**Pago INFOTEP:**

| Cuenta | Debe | Haber |
|---|---|---|
| 210.1 Aporte INFOTEP | aporte | |
| 101.05 Banco Impuestos 964 | | aporte |

Ejemplares: PC00000335 (TSS jul 69.974,14), PC00000336 (INFOTEP jul 3.289,00).

## Ejemplo trabajado — junio 2026

- **Pieza 1** ED00000170 (2026-06-30), total 322.508,09:
  Dr 611.01 215.653,09 · Dr 611.02 106.855,00 · Cr 210.04 13.432,47 ·
  Cr 210.08 9.804,25 · Cr 210.08 9.255,98 · Cr 220.01 290.015,39.
- **Pieza 2** ED00000179, total 49.526,94:
  Dr 611.08 22.890,87 · Dr 611.09 22.923,17 · Dr 611.1 3.712,90 · Cr 210.09 49.526,94.
- **Pieza 3** ED00000178, total 3.225,00: Dr 611.11 / Cr 210.1.

Cuadre pieza 1: Debe 322.508,09 = Haber (13.432,47 + 9.804,25 + 9.255,98 +
290.015,39). Coincide al centavo con el Excel de junio.

## Items abiertos / chequeos que QualiaConta debe hacer

1. **`220.01` sin débitos = nómina devengada y no pagada.** En el corte
   2026-08-02 no hay PC a empleados para jun ni jul (solo TSS+INFOTEP de jul),
   así que 220.01 acumula ~609k sin liquidar. Bandera roja de conciliación:
   verificar en vivo antes de registrar un nuevo mes.
2. **801.03 Gastos Impuestos (+20,89 en jul).** El asiento de julio lleva una
   línea extra a 801.03 (gasto no deducible) que elevó el neto en 20,89 vs el
   Excel. Origen manual no documentado. QualiaConta **no lo inventa**: si el
   Excel no lo trae y el cuadre no lo pide, no va.
3. **TSS con período mal etiquetado (precedente P-005).** ED00000181 (jul) tiene
   `Reference "202606"`. El dedupe por Reference puede colisionar: ante un PC o
   Journal de TSS, cotejar también fecha+monto, no solo Reference.
4. **Columna "Total" del Excel inválida (−35.000).** Usar `SUM(Sueldos +
   Comisiones + Otras remuneraciones)` como débito; nunca la col. "Total".
5. **Dedupe de quincenas.** Un mismo empleado no debe tener dos PC con
   `N<DD><MM><AA>` igual; antes de registrar, buscar por esa Reference exacta.
