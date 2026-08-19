---
estado: ratificado
aprobo: C.Araujo, por chat, 2026-08-07 (los tratamientos «mecánica ratificada» describen el uso real; los ABIERTO ordenan preguntar, no adivinar). Re-ratificado mismo día: H-04/06/07 reescritos a forma fija de por vida — el estado del plan no vive en una entrada. Mismo día, H-12 dictado y H-06/H-07 reapuntados al vehículo: el dictamen del Caso #2 mandó al dueño a asentar a mano teniendo precedente (CB00000258)
evidencia: histórico ADM de Blackbox (211 registrados vía mesa + asientos ED) y auditoría de fallos, corte 2026-08-07
pendiente: H-13 (devolución parcial) es dictado técnico del 2026-08-18 y NO está ratificado todavía. Hasta que lo esté, se lee pero no automatiza: el hecho se detecta y se pregunta
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
  que el banco te cobra o te devuelve a vos.
- **El DOCUMENTO es otra decisión, y para este hecho HOY NO HAY.** Lo dictaba
  H-12 (`BankCharges` en crédito), y esa parte quedó **derogada el 2026-08-14**:
  la contraparte es el cliente, así que no es un hecho bancario tampoco para
  elegir el documento. Mientras el rol de ADM no habilite un documento de
  entrada de tercero, esto lo registra un humano y el contable abre un evento
  `pregunta` con el movimiento y el tratamiento. Ver H-12 corregida.

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
  es el inquilino. Vale acá entera la regla de contraparte de H-06, y también su
  consecuencia documental: hoy no hay documento y se abre un evento `pregunta`.
- **El CB00000258 (Caso #1 Formax) es el CONTRAEJEMPLO, no el precedente.**
  Hasta el 2026-08-14 esta entrada lo citaba como precedente y era exactamente
  al revés: es un depósito de un inquilino asentado como cargo bancario. Sus
  CUENTAS están bien (Dr 101.04 / Cr 220.06); lo que está mal es el tipo de
  documento. Citarlo para justificar un `BankCharges` de entrada de tercero es
  el error que esta corrección viene a cerrar.

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
  Caso #2 Mtk Designs) · **Vigencia:** desde 2026-08-07 · **Corregida el
  2026-08-14** en su alcance y en su fundamento, por auditoría verificada contra
  ADM
- El tratamiento (H-06, H-07 o el que aplique) elige las CUENTAS; esta entrada
  elige el DOCUMENTO. Cuando el asiento correcto debita o acredita una cuenta de
  caja/banco y el documento natural sería `Journals`, el vehículo es
  `BankCharges` en la dirección del movimiento — crédito si la plata entró,
  cargo si salió.
- **ALCANCE, y es la corrección que más importa: sólo vale si la contraparte es
  el BANCO.** Para plata que entra de un tercero —un cliente, un inquilino— el
  documento correcto NO es `BankCharges`, porque el hecho no es bancario (H-06,
  H-07). Ahí hoy no hay documento: se abre un evento `pregunta` y lo registra un
  humano. Un candado que te frena está diciendo «el tipo está mal elegido» o
  «esto no lo registrás vos» — nunca «buscá otro tipo que pase». El CB00000258
  es el contraejemplo de esto, no su precedente.
- **FUNDAMENTO, corregido: «la conciliación» son DOS y esta entrada las
  confundía.** Decía que un `Journals` sobre caja «queda sin conciliar para
  siempre». Es falso para ADM y cierto para la mesa:
  - **ADM sí concilia asientos.** Verificado el 2026-08-14 sobre el espejo del
    histórico: de los 75 `Journals` que tocan una cuenta de caja, **74 figuran
    con `Accounts[].Conciliated`**. El módulo `BankReconciliations` los cruza
    apuntando con `TransAccountRowID` al renglón exacto que toca el banco.
  - **La conciliación de la mesa no.** La edge function
    `admcloud-conciliacion-entradas` (repo Labs_Inv) lee `CashInvoices`,
    `CashReceipts` y `BankBankTransfers` del lado entrada, y `BillPayments`,
    `Expenses`, `AccountPayments` y `BankCharges` del lado salida. Ahí un asiento
    no entra, y el movimiento aparece «Sin registro en ADM».
  - Por eso el vehículo `BankCharges` **sigue siendo la elección correcta** para
    lo que nace en el estado de cuenta con el banco de contraparte: no porque
    ADM no sepa conciliar un asiento, sino para que el movimiento cruce en la
    pantalla que se usa todos los días. Y por eso el candado
    `qualia_trabajos_journal_no_toca_caja` sigue puesto.
- El vehículo NO cambia el asiento: las cuentas siguen siendo las del
  tratamiento (banco contra el pasivo que corresponda, etc.). Las cuentas de
  cargos/ingresos bancarios (640.x, 700.01) quedan reservadas para los hechos
  que SÍ son del banco (H-01, H-02, H-09).
- Consecuencia operativa, ya acotada por el alcance: para los hechos con el
  banco de contraparte el rol SÍ tiene documento, y el dictamen se propone como
  pasos aprobables en vez de mandarle trabajo manual al humano. Para los hechos
  con un tercero de contraparte, «mi rol no tiene documento para esto» es la
  conclusión CORRECTA y termina en un evento `pregunta`.
- `Reference` = `banco_tx_id`, como en todo documento nacido de un movimiento
  del banco.

## H-13 — Devolución parcial: la salida vuelve por MENOS de lo que salió

- **Documento:** `BankCharges` (cargo) por la retención · **Rango:** dictado
  técnico (2026-08-18) · **Vigencia:** desde su ratificación
- **El hecho:** una salida del banco vuelve devuelta, y el crédito de vuelta es
  MENOR que el débito que salió. La diferencia se la quedó el banco —o su
  corresponsal— por procesar la devolución. **No existe una tercera línea en el
  estado de cuenta:** la retención viaja ya descontada adentro del retorno, y
  esperarla como movimiento propio es esperar algo que no va a llegar nunca.
- **Un par que vuelve corto NO se anula solo, y ésa es toda la entrada.** Un
  reverso que vuelve completo se neutraliza y no deja asiento; uno que vuelve
  corto deja un costo real. Darlo por anulado hace las dos cosas malas a la vez:
  pierde el gasto y deja la cuenta de banco descuadrada exactamente por la
  diferencia, para siempre. La materialidad no lo salva — el saldo del banco se
  movió por ese monto, así que se asienta aunque sean centavos.
- **La diferencia se CALCULA, no se lee.** Es `|salida| − |retorno|` del par, y
  el par lo da el cruce de reversos de la conciliación. Ninguna de las dos
  líneas del banco la contiene, y ningún texto del banco la nombra.
- **Tratamiento, en dos tramos que son independientes:**
  1. **El par bruto.** Primero P-001: ¿el envío quedó asentado en ADM? Si NO
     —el caso normal, porque un envío devuelto rara vez alcanzó a registrarse—
     el par se neutraliza y no se registra ninguna de las dos patas: la
     operación económica no ocurrió. Si SÍ, se reversa contra su original
     (P-002), nunca contra una cuenta parecida.
  2. **La retención, siempre, y en documento aparte.** Es lo que el banco te
     cobró: mismo tratamiento que H-01 — débito a la cuenta de cargos bancarios
     del plan vivo, crédito a la cuenta de banco. La naturaleza manda (P-004) y
     la contraparte ES el banco, así que `BankCharges` es el vehículo correcto
     por H-12, sin la excepción de tercero. Un trabajo, un documento: el reverso
     del tramo 1 y la retención jamás van mezclados en una misma propuesta.
- **`Reference` apunta al RETORNO, que es el movimiento que la contiene.** La
  retención no tiene `banco_tx_id` propio porque no tiene línea propia. El
  anti-duplicado se hace por ese par, **nunca por monto suelto**: una retención
  de US$5 se parece a cualquier otra comisión del mes y por monto se adopta un
  gemelo ajeno.
- **En cuenta de moneda extranjera, tramo 1 y tramo 2 se miden distinto, y ahí
  hay una segunda diferencia que no es comisión.** La retención se mide en la
  moneda de la CUENTA, donde las dos patas son comparables. Recién si el tramo 1
  hubo que reversarlo, el original entró a una tasa y el reverso sale a otra: eso
  es **diferencia cambiaria**, no retención, y va a la cuenta de diferencia de
  cambio del plan vivo. Sumarlas en un solo renglón infla el gasto bancario con
  plata que el banco nunca cobró. Si el plan no ofrece cuenta para la diferencia
  de cambio, se pregunta citando este hecho.
- **El caso simétrico es el mismo hecho:** una ENTRADA que se devuelve y sale por
  menos también deja retención. Cambia el signo de las dos patas del par, no el
  tratamiento de la retención — que sigue siendo un cargo del banco.
