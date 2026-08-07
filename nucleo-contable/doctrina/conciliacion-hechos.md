---
estado: ratificado
aprobo: C.Araujo, por chat, 2026-08-07 (los tratamientos «mecánica ratificada» describen el uso real; los ABIERTO ordenan preguntar, no adivinar)
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
- Nota técnica: «0.15» en el nombre de 640.02 es herencia del 1.5‰ viejo; el
  2×1000 vigente se sigue asentando ahí por consistencia con el histórico —
  es impuesto sobre la transacción, gasto deducible, jamás crédito fiscal.

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

- **Rango:** dictado técnico (revisión de contador, 2026-08-07) — operativo
  cuando la cuenta tenga código
- **Tratamiento:** el dinero recibido de más es un PASIVO desde que entra al
  banco (obligación de devolver o aplicar), y el libro debe reflejar TODO lo
  que el banco recibió — si el recibo se asentó por menos, la conciliación
  bancaria nunca va a cuadrar. Al detectarlo: `Journals` con débito al banco
  por el excedente y crédito a **«Adelanto de Clientes» (pasivo, ya existe en
  ADM)**. La devolución lo cancela: débito al pasivo, crédito al banco. NO se
  corrige el recibo original (corregir en ADM implica anular, y anular BORRA
  — P-005).
- **Lo que faltaba y explica el Caso #1:** la cuenta «Adelanto de Clientes»
  existe en ADM **sin código contable asignado**, así que los scripts no
  pueden referenciarla y las propuestas oscilaban. **Acción de Carlos:
  asignarle código en ADM** (sugerido: serie 220.xx junto a los pasivos
  corrientes). Hasta entonces, este hecho se pregunta citando H-06.

## H-07 — Depósito recibido en garantía (alquiler, contratos)

- **Rango:** dictado técnico (revisión de contador, 2026-08-07) — operativo
  cuando la cuenta exista
- **Tratamiento:** pasivo mientras la garantía viva — NUNCA ingreso: es
  dinero ajeno condicionado (se devuelve al cumplirse el contrato, o se
  aplica a rentas/daños y RECIÉN entonces se reclasifica a ingreso). Débito
  al banco, crédito a «Depósitos recibidos en garantía» (pasivo). Ojo con el
  espejo: **180.01 Fianzas & Depósitos es ACTIVO** — son los depósitos que la
  empresa ENTREGA; usarla acá invertiría el balance.
- **Lo que falta:** la cuenta de pasivo NO existe en el plan (verificado
  sobre las 215). **Acción de Carlos: crearla en ADM** (sugerido: serie
  220.xx, «Depósitos Recibidos en Garantía»). Hasta entonces, el caso Formax
  y similares se preguntan citando H-07.

## H-08 — Ingreso por tarjeta (adquirente «Servicios Digita»)

- **Rango:** política de empresa (C-001 de la memoria de Blackbox)
- El banco acredita neto de comisión 5.395%: `original = banco / (1−0.05395)`.
  El cruce va por monto original + fecha, nunca por nombre. (C-001 es de la
  EMPRESA; vive en su memoria y acá solo se referencia.)

## H-09 — Cashback / «AHORRO POR COMPRA» de tarjeta

- **Documento:** `BankCharges` en crédito · **Rango:** mecánica ratificada
- Crédito a 700.01 Intereses Bancarios (ingreso), débito a la tarjeta (cuenta
  de caja 203.10/203.11). Precedente: libro 2026-08-05 (CB00000231).
- Nota técnica: en rigor un cashback no es interés (es «otros ingresos» /
  descuento sobre compras); se mantiene 700.01 por consistencia con el
  histórico y materialidad mínima. Si algún día se abre «Otros Ingresos», los
  nuevos van allá y esta nota se deroga con entrada de libro.

## H-11 — Diferencia de tiempo (partida en tránsito)

- **Rango:** principio de conciliación (revisión de contador, 2026-08-07)
- Que un documento esté en ADM y todavía no en el banco (o al revés, con
  fechas cercanas) NO es un faltante: es una partida en tránsito. Se marca,
  se espera al siguiente corte y **no se crea nada** — crear un asiento para
  «cuadrar» una diferencia de timing fabrica el descuadre del mes siguiente.
  Solo si la partida envejece más de un ciclo de corte se investiga como
  faltante real.

## H-10 — Nómina (tres asientos mensuales)

- **Documento:** `Journals` ×3 · **Rango:** política de empresa (ROADMAP 2b.3)
- `NOMINA <MES> <AÑO>`, `REG. TSS EMPLEADOR <AAAAMM>`, `REG.INFOTEP EMPLEADOR
  <AAAAMM>`. **Nunca autónomo** (guarda permanente); dedup por período Y por
  monto (P-005: la TSS duplicada del histórico).
