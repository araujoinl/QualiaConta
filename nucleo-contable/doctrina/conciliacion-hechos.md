---
estado: ratificado
aprobo: C.Araujo, por chat, 2026-08-07 (los tratamientos «mecánica ratificada» describen el uso real; los ABIERTO ordenan preguntar, no adivinar). Re-ratificado mismo día: H-04/06/07 reescritos a forma fija de por vida — el estado del plan no vive en una entrada. Mismo día, H-12 dictado y H-06/H-07 reapuntados al vehículo: el dictamen del Caso #2 mandó al dueño a asentar a mano teniendo precedente (CB00000258)
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

**Una entrada es fija de por vida.** Dicta el principio contable y contra qué
tipo de cuenta se asienta; la cuenta CONCRETA se resuelve consultando el plan
vivo de ADM en el momento de proponer (por semántica y listando el vecindario
de la serie, no por un solo keyword). Si el plan no ofrece una cuenta
utilizable para el principio, se pregunta citando el hecho — esa condición
también es eterna. Lo que una entrada JAMÁS lleva: el estado del plan («la
cuenta existe/no existe/le falta código»), conteos, acciones pendientes de una
persona, o un caso concreto como condición operativa. Ese estado caduca en
cuanto alguien toca ADM y convierte la doctrina en una mentira con fecha de
hoy — pasó el 2026-08-07: H-07 decía «la cuenta no existe», Carlos la creó, y
el contable le creyó a la doctrina en vez de mirar el plan. Los huecos del
mundo van al INDEX como pendientes, nunca acá.

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

- **Rango:** dictado técnico (revisión de contador, 2026-08-07)
- Primero P-001: ¿ya lo registró el humano? (espejos `bill-payments` /
  `account-payments` refrescados a diario). Si no está registrado y es cuota
  de préstamo: partir capital/interés EXIGE la tabla de amortización del
  préstamo; sin tabla disponible al momento de proponer, se pregunta citando
  H-04 — nunca se estima la partición.

## H-05 — Transferencia entre cuentas propias

- **Documento:** `BankBankTransfers` · **Rango:** mecánica ratificada
- El colector ya descarta las internas al insertar; las que llegan se cruzan
  contra el espejo para no duplicar. El registro directo quedó fuera del
  poller a propósito (dos traslados iguales el mismo día son normales y el
  script viejo adoptaba gemelos).

## H-06 — Dinero de cliente recibido por adelantado (excedente, anticipo)

- **Rango:** dictado técnico (revisión de contador, 2026-08-07)
- **Tratamiento:** dinero de un cliente que aún no se devengó — un pago de
  más, un anticipo de renta o de servicio — es un PASIVO desde que entra al
  banco (obligación de devolver o de prestar lo pagado), y el libro debe
  reflejar TODO lo que el banco recibió: si el recibo se asentó por menos, la
  conciliación nunca cuadra. Débito al banco, crédito a la cuenta de pasivo de
  adelantos/anticipos de clientes del plan vivo. Se cancela al devengarse
  (crédito al ingreso que corresponda, con su ITBIS si aplica) o al devolverse
  (crédito al banco). NO se corrige el recibo original (corregir en ADM
  implica anular, y anular BORRA — P-005).
- **La contraparte es el cliente, no el banco.** El banco es el caño por donde
  entró la plata; eso no lo vuelve un hecho bancario: un cobro de un tercero
  jamás toca las cuentas de cargos o ingresos bancarios (640.x, 700.01), aunque
  haya llegado por transferencia y sin papel previo — esas cuentas son para lo
  que el banco te cobra o te devuelve a vos. El DOCUMENTO con que se asienta
  desde el banco es otra decisión, y la dicta H-12: `BankCharges` como
  vehículo, con las cuentas de ESTE tratamiento.

## H-07 — Depósito recibido en garantía (alquiler, contratos)

- **Rango:** dictado técnico (revisión de contador, 2026-08-07)
- **Tratamiento:** pasivo mientras la garantía viva — NUNCA ingreso: es
  dinero ajeno condicionado (se devuelve al cumplirse el contrato, o se
  aplica a rentas/daños y RECIÉN entonces se reclasifica a ingreso). Débito
  al banco, crédito a la cuenta de pasivo de depósitos en garantía del plan
  vivo. Ojo con el espejo: **180.01 Fianzas & Depósitos es ACTIVO** — son los
  depósitos que la empresa ENTREGA; usarla acá invertiría el balance.
- **Garantía ≠ anticipo:** la garantía se devuelve al final del contrato; el
  anticipo se consume como ingreso al devengarse (H-06). Si el texto del
  cliente no deja claro cuál es, se pregunta citando ambos.
- **Tampoco es un hecho bancario**, por la misma razón que H-06: quien depositó
  es el inquilino. Vale acá entera la regla de contraparte de H-06, y el
  vehículo documental de H-12 para asentarlo desde el banco (precedente:
  CB00000258, Caso #1 Formax).

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

## H-12 — Vehículo documental cuando el asiento toca la cuenta de banco

- **Rango:** política de empresa (dictada por C.Araujo, 2026-08-07, a raíz del
  Caso #2 Mtk Designs; precedente CB00000258, Caso #1 Formax) · **Vigencia:**
  desde 2026-08-07
- El tratamiento (H-06, H-07 o el que aplique) elige las CUENTAS; esta entrada
  elige el DOCUMENTO. Cuando el asiento correcto debita o acredita una cuenta
  de caja/banco y el documento natural sería `Journals`, el vehículo es
  `BankCharges` en la dirección del movimiento — crédito si la plata entró,
  cargo si salió — porque la conciliación de ADM sólo cruza documentos de
  banco: un `Journals` sobre caja queda sin conciliar para siempre, y por eso
  el sistema lo bloquea.
- El vehículo NO cambia el asiento: las cuentas siguen siendo las del
  tratamiento (banco contra el pasivo que corresponda, etc.). Las cuentas de
  cargos/ingresos bancarios (640.x, 700.01) quedan reservadas para los hechos
  que SÍ son del banco (H-01, H-02, H-09).
- Consecuencia operativa: el rol del contable SÍ tiene documento para asentar
  entradas y salidas de terceros nacidas en el banco. «Mi rol no tiene
  documento para esto» dejó de ser una conclusión válida para estos hechos: el
  dictamen se propone como pasos aprobables, jamás se le manda al humano a
  asentarlo a mano.
- `Reference` = `banco_tx_id`, como en todo documento nacido de un movimiento
  del banco.
