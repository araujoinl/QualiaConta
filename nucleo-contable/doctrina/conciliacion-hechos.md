---
estado: borrador
aprobo:
evidencia: histórico ADM de Blackbox (211 registrados vía mesa + asientos ED) y auditoría de fallos, corte 2026-08-07
---

# Conciliación: del hecho al asiento

El mapa que faltaba entre la skill de conciliación (que ENCUENTRA las
diferencias) y el registro (que las ASIENTA). Para cada hecho que aparece en
un estado de cuenta o en un cruce banco↔ADM: qué documento de ADM le
corresponde, con qué cuentas, y bajo qué principio. Lo que diga «ABIERTO» no
se propone en autónomo: se pregunta, citando esta entrada.

Cada tratamiento lleva rango — «mecánica ratificada» = respaldado por el uso
real del histórico; «política de empresa» = lo dictó Carlos; «ABIERTO» = nadie
lo ha dictado todavía.

---

## H-01 — Cargo bancario (comisión, LBTR, impuesto 2×1000 Ley 30-26)

- **Documento:** `BankCharges` · **Rango:** mecánica ratificada (60+ registrados)
- Débito a 640.01 Cargos Bancarios (comisiones/transferencias) o 640.02 Cargos
  sobre cheques 0.15 (impuesto 2×1000), crédito a la cuenta de banco. Con NCF
  del banco si el comprobante lo trae; `Reference` = `banco_tx_id`.

## H-02 — Devolución o reverso de un cargo

- **Documento:** `BankCharges` (crédito) · **Rango:** principio P-002
- La MISMA cuenta del cargo original, signo contrario. El original se ata por
  monto+fecha+concepto ANTES de proponer; sin original identificado, pregunta.
  (Evidencia del hueco: la devolución del 2×1000 salió sin cuenta y la asignó
  Victor a mano.)

## H-03 — Pago de una factura de proveedor ya registrada

- **Documento:** `BillPayments` (PP, módulo BANCO) · **Rango:** mecánica
  ratificada (34+ pagos)
- Nace del enlace humano movimiento↔factura en la mesa; el registro corre por
  script.

## H-04 — Salida del banco sin factura (préstamo, línea de crédito, abono)

- **Rango:** parcialmente ABIERTO
- Primero P-001: ¿ya lo registró el humano? (espejos `bill-payments` /
  `account-payments` refrescados a diario). Si no está registrado y es cuota de
  préstamo: partir capital/interés EXIGE la tabla de amortización, que **no
  está cargada en el sistema** (ROADMAP 2b.4) → siempre pregunta. **ABIERTO:
  cargar las tablas de los préstamos vivos.**

## H-05 — Transferencia entre cuentas propias

- **Documento:** `BankBankTransfers` · **Rango:** mecánica ratificada
- El colector ya descarta las internas al insertar; las que llegan se cruzan
  contra el espejo para no duplicar. El registro directo quedó fuera del
  poller a propósito (dos traslados iguales el mismo día son normales y el
  script viejo adoptaba gemelos).

## H-06 — Excedente de pago de un cliente

- **Rango:** ABIERTO — el Caso #1 (10 rechazos) es la prueba de que falta el
  dictado. Lo único cierto es P-001: el tratamiento depende de CÓMO quedó
  asentado el cobro (¿el recibo entró por el total o por el monto de las
  facturas?). **Pregunta a ratificar por Carlos, opciones sobre la mesa:**
  - (a) corregir el recibo para reconocer el cobro completo, con el excedente
    a un pasivo (anticipos de clientes), y devolver cancelando ese pasivo; o
  - (b) tratar el excedente como pasivo transitorio reconocido en un asiento
    propio al detectarlo, y la devolución lo cancela contra el banco; o
  - (c) devolver sin pasar por pasivo cuando la devolución es inmediata.

## H-07 — Depósito recibido en garantía (alquiler, contratos)

- **Rango:** ABIERTO — el caso Formax (RD$180,000) quedó sin tratamiento
  dictado. Es un pasivo mientras la garantía viva, no un ingreso; **falta que
  Carlos dicte la cuenta** (no existe una «Depósitos en garantía recibidos»
  entre las 46 cuentas en uso — probablemente haya que estrenarla del plan).

## H-08 — Ingreso por tarjeta (adquirente «Servicios Digita»)

- **Rango:** política de empresa (C-001 de la memoria de Blackbox)
- El banco acredita neto de comisión 5.395%: `original = banco / (1−0.05395)`.
  El cruce va por monto original + fecha, nunca por nombre. (C-001 es de la
  EMPRESA; vive en su memoria y acá solo se referencia.)

## H-09 — Cashback / «AHORRO POR COMPRA» de tarjeta

- **Documento:** `BankCharges` en crédito · **Rango:** mecánica ratificada
- Crédito a 700.01 Intereses Bancarios (ingreso), débito a la tarjeta (cuenta
  de caja 203.10/203.11). Precedente: libro 2026-08-05 (CB00000231).

## H-10 — Nómina (tres asientos mensuales)

- **Documento:** `Journals` ×3 · **Rango:** política de empresa (ROADMAP 2b.3)
- `NOMINA <MES> <AÑO>`, `REG. TSS EMPLEADOR <AAAAMM>`, `REG.INFOTEP EMPLEADOR
  <AAAAMM>`. **Nunca autónomo** (guarda permanente); dedup por período Y por
  monto (P-005: la TSS duplicada del histórico).
