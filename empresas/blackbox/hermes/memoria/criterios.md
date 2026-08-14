---
estado: ratificado
aprobo: C.Araujo — C-001 corregido por él en sesión real (julio 2026), C-002 dictado por chat el 2026-08-07 y corregido por él el mismo día (la forma `BankCharges` en crédito queda derogada: un cobro de cliente no es un crédito bancario)
evidencia: conciliación de entradas julio 2026 (configuracion_conciliacion_entradas.md) y caso Formax 2026-08-07
---

# Criterios transversales

Reglas numeradas (C-001, C-002…) que aplican a más de un proveedor o documento.
Cada criterio lleva: enunciado, evidencia verificable y alcance propuesto. El
C-001 de abajo es la semilla de formato que los lotes deben imitar.

Un criterio nuevo entra como borrador marcándolo en su propio título
(`## C-00X — … [BORRADOR]`) y no es precedente hasta que Carlos lo apruebe.

---

## C-001 — Pagos con tarjeta llegan al banco netos de comisión 5.395%

**Enunciado:** los cobros de clientes vía tarjeta de crédito aparecen en el
banco como `Por Transferencia Ach-Ach Recibida: Servicios Digita - …` y el
monto acreditado ya trae descontada la comisión del **5.395%**. Para conciliar
contra ADM hay que revertir al monto original:

```
monto_original = monto_banco / (1 - 0.05395)
```

No se puede cruzar por nombre (el banco dice "Servicios Digita"; ADM dice el
cliente real): solo monto original + fecha, en rondas separadas después de las
normales.

**Evidencia:** `configuracion_conciliacion_entradas.md` §3 y el script
`memoria/scripts/conciliar-entradas.py` (parámetro `comision_tarjeta: 0.05395`).
Caso verificado: banco 6,663.31 → original 7,043.30 vs ADM 7,043.29 (factura al
contado). Regla corregida por Carlos en sesión real de conciliación julio 2026.

**Alcance propuesto:** toda conciliación de entradas de Blackbox SRL; detección
por descripción que contenga `Servicios Digita` / `Servicios Dig`. Si cambia el
adquirente o la tasa, el criterio se revisa (no se parchea en silencio).

---

## C-002 — Renta cobrada por adelantado va al pasivo 220.06

**Enunciado:** dinero de un cliente por renta de nave/local recibido ANTES de
devengarse —anticipos de renta y depósitos en garantía de renta— se asienta
con débito al banco y crédito a **220.06 «Depósitos en Garantía por Renta»**
(pasivo). Mientras «Adelanto de Clientes» siga sin código contable, los
anticipos de renta también van a 220.06 (decisión del contador: un solo pasivo
de renta; la distinción anticipo/garantía vive en el `detalle` del asiento). El
destino después depende de cuál de los dos es (dictado del contador, chat
2026-08-07):

- **Anticipo** (renta pagada por adelantado que se consume): al devengarse cada
  mes se reclasifica — débito 220.06, crédito **411.16 Renta Inmuebles**,
  reconociendo el ITBIS que corresponda. El monto recibido trae los impuestos
  incluidos, no se le suma nada.
- **Garantía** (caso Formax, los RD$180,000): **cero devengo — «se quedan hasta
  que desaloje»**. Permanecen en 220.06 la vida entera del contrato; recién al
  desalojo se devuelven (débito 220.06, crédito banco) o se aplican a
  renta/daños (débito 220.06, crédito 411.16 con su ITBIS en ese momento).
  Reclasificarlos mensualmente sería reconocer ingreso de plata que sigue
  siendo ajena.

**Qué documento: NINGUNO de los que el agente puede escribir hoy — se
pregunta.** El asiento de arriba es correcto; el tipo de documento con que
llega a ADM no lo decide el contable solo. `Journals` está bloqueado por el
candado de caja, y **`BankCharges` en crédito NO es una salida válida**: un
depósito de un inquilino no es un crédito bancario, porque la contraparte es el
cliente y no el banco (H-06/H-07 del núcleo). Hasta que el rol de ADM habilite
un documento de entrada de tercero, estas operaciones las registra un humano y
el contable abre un evento `pregunta` con el movimiento y el tratamiento.

**Corrección del 2026-08-07 (C.Araujo, por chat).** Este criterio estuvo unas
horas diciendo lo contrario: que la forma ejecutable era `BankCharges` en
crédito. Nació de una racionalización del propio contable —escribió en su
`detalle` que C-002 mandaba `Journals`, que el sistema lo bloqueaba, y que por
eso re-etiquetaba— y se dio por ratificada porque la propuesta se aprobó en la
mesa. **Aprobar una propuesta no ratifica el razonamiento que la armó.** El
resultado fue el **CB00000258**: un depósito en garantía de RD$180,000 asentado
en «Bancos → Cargos Bancarios». Su corrección en ADM la decide Carlos (anular y
re-registrar es humano — ver abajo por qué, que no es lo que decía acá).

**Corrección del 2026-08-14 sobre el motivo, no sobre la regla.** Esta línea
decía «el rol del agente niega Void». **Es falso**: sondeado hoy contra un GUID
inexistente, `VendorBills/Void`, `BankCharges/Void` y `Journals/Void` responden
«Este documento no existe», que es la señal de que el permiso pasó (el control
contra un endpoint inventado da 404 con otra forma). Sólo `BillPayments/Void` y
`AccountPayments/Void` contestan `Unauthorized`.

**La regla sigue en pie y es más fuerte dicha así: PODÉS anular y NO DEBÉS.**
Decisión de C.Araujo, 2026-08-14. Una prohibición que se apoya en «no tenés
permiso» se derrumba el día que el agente descubre que sí lo tiene, y ahí no
queda regla — queda un agente que se siente autorizado. Es el mismo mecanismo
del CB00000258: el candado frenó, y en vez de parar se buscó otra vía.

Anular toca el libro fiscal oficial y no es reversible: el documento queda con
lápida y su número no se reutiliza. Esa decisión es de un humano aunque la API
la deje pasar.

**Evidencia:** caso Formax 2026-08-07 (RD$180,000, anticipo de 2 meses de
renta de nave industrial, impuestos incluidos). Plan vivo verificado ese día:
216 cuentas, 220.06 existente; 220.01 es Nómina por Pagar (ocupada — sugerirla
fue el fallo que motivó la regla del vecindario en la doctrina). Principio
contable: H-06/H-07 del núcleo (`nucleo-contable/doctrina/conciliacion-hechos.md`).

**Alcance propuesto:** Blackbox SRL, todo ingreso por renta de nave/local
cobrado por adelantado. Si «Adelanto de Clientes» recibe código propio en ADM,
este criterio se revisa para separar anticipo de garantía (no se parchea en
silencio).

---

## C-003 — Activos fijos: qué cuenta y qué documento [BORRADOR]

**Enunciado:** un activo fijo de Blackbox vive en una cuenta `160.xx`, se
deprecia contra el par `650.xx → 170.xx`, y **el documento lo decide cómo
entró, no que sea un activo**. Las tres formas que el histórico prueba:

- **Compra con factura del vendedor** → `VendorBills` debitando la `160.xx`,
  y después su pago por el camino normal. Es como entró la nave industrial
  (160.03: aparece en `vendor-bills` y en `account-payments`). Sirve con NCF o
  sin él, y el vendedor puede ser una persona física.
- **Depreciación mensual** → `Journals` el último día del mes. **No toca caja,
  así que el candado no aplica** y no hay nada que preguntar.
- **Reclasificaciones y ajustes de valor** (separar terreno de edificación,
  capitalizar gastos de traspaso) → `Journals`. Tampoco tocan caja.

**El mapa de cuentas vivo** (216 cuentas, verificado 2026-08-14):

| Activo | Cuenta | Gasto de depreciación | Depreciación acumulada |
|---|---|---|---|
| Terrenos | 160.01 (sin movimientos; **los terrenos no se deprecian**) | — | — |
| Edificios — Apartamento San Gerónimo | 160.02 | 650.01 | 170.02 |
| Edificaciones / Naves industriales | 160.03 | 650.01 | 170.02 |
| Equipos de Transporte Liviano | 160.04 | 650.03 | 170.04 |
| Mobiliarios y Equipos de Oficina | 160.06 | 650.04 | 170.06 |
| Otros activos | — | 650.02 | 170.07 |

**Dos trampas de este plan, y las dos muerden:**

1. **Los pares no se corresponden por número.** 650.03 va contra 170.04, y
   650.02 contra 170.07. Emparejar por el sufijo manda la depreciación del
   transporte a la cuenta de los edificios.
2. **650.01 y 170.02 se llaman IGUAL** («Depreciación Acumulada Edificios») y
   son cosas opuestas: la 650.01 es el **gasto** del mes (va al débito) y la
   170.02 es la **acumulada** que resta del activo (va al crédito). Elegir por
   nombre invierte el asiento.

**El apartamento San Gerónimo, en concreto.** No se compró por la mesa: entró
por **carga inicial** el 2024-12-27 (documento `00000001`, débito 160.02 por
RD$6.000.000 contra 305 Carga Inicial), financiado con **230.01 Préstamo
Hipotecario (San Gerónimo)**, y el ED00000038 del 2024-12-31 lo ajustó. Su
cuota mensual **no sale del banco de la empresa**: se asienta débito 230.01
(capital) + débito 802.01 (intereses) contra crédito **801.02 Gastos personales
no deducibles** — o sea que la paga el dueño. Por eso ese asiento nunca tocó
101.xx y el candado jamás lo frenó. Si algún día la cuota empieza a salir de
una cuenta de la empresa, deja de ser este asiento y hay que preguntar.

**Evidencia:** espejo local del histórico al 2026-08-14. Depreciación: 14
asientos idénticos, uno por mes, último día del mes, siempre los mismos cuatro
débitos y cuatro créditos por los mismos montos (RD$18.928,08 transporte +
RD$8.750,00 edificios + RD$2.201,98 otros + RD$364,67 mobiliario = RD$30.244,73
mensuales) — ED00000115 (2025-12-31), ED00000146 (2026-01-31) y sus gemelos.
Hipoteca: ED00000034, ED00000035, ED00000036 y la FP00000199. Apartamento:
documento `00000001` y ED00000038. Ninguno de estos asientos toca una cuenta
101.xx / 102.xx / 203.10 / 203.11.

**Alcance propuesto:** Blackbox SRL, todo activo fijo de las cuentas 160.xx y
su depreciación. **No cubre** la compra de un activo nuevo pagado desde el banco
sin factura del vendedor: ese caso no tiene precedente en el histórico y va por
evento `pregunta`. Si aparece un activo que no encaja en las cinco filas del
mapa, se agrega la fila antes de asentar — no se recicla la más parecida.

---

## C-004 — La retención de ITBIS vive en el PAGO, no en la factura [BORRADOR]

**Enunciado:** la retención de ITBIS de un proveedor **no está en la factura**:
está en el pago, en `BillPayments.Documents[].TaxRetention1Name`,
`TaxRetentionID1` y `TaxRetentionAmount_BasedTax`. Buscarla en la cabecera de la
`VendorBills` devuelve vacío siempre, y de ahí salieron las dos afirmaciones
falsas que este criterio deroga.

Los dos identificadores vivos en esta instancia de ADM:

| `TaxRetentionID1` | Nombre en ADM | Norma | Casilla IT-1 |
|---|---|---|---|
| `b196ec3e-207e-46d3-a9fa-3b0a511d2c11` | Retención 30% ITBIS | Norma 02-05 — sociedad a sociedad por servicios profesionales liberales o alquiler de bienes muebles | 43 |
| `b8bc849c-c0d9-4f93-be54-0c586fa99fec` | Retención 100% ITBIS | Ley 11-92 y concordantes — ver la tabla de `nucleo-contable/dgii/normas/retenciones-itbis.md` | sección A |

**El mapa vivo: seis proveedores, 40 pagos con retención.**

| Proveedor | Retención | Pagos | Encaja en la norma |
|---|---|---|---|
| Account One Dcm2rp, Srl | 30% ITBIS | 20 de 20 | sí — servicios contables, liberal por enumeración de la DGII |
| Logistichause International R&M Srl | 100% ITBIS | 13 | **no se deduce del dato** |
| Acomsa | 30% ITBIS | 3 | probable — verificar el servicio |
| Apr Creators Srl | 100% ITBIS | 2 | **no se deduce del dato** |
| Emprendia Consulting Srl | 30% ITBIS | 1 | sí — consultoría |
| The Money Coach | 100% ITBIS | 1 | probable — persona física |

**El hueco honesto:** el 100% de la tabla de la norma es para **persona física**
que presta servicio gravado a persona jurídica. `Logistichause International R&M
Srl` y `Apr Creators Srl` son SRL, así que ese motivo no las explica. Puede ser
un Comprobante de Compras tipo 41 (Norma 05-19, proveedor no registrado) o una
decisión del contador externo. **No se inventa el motivo**: se registra la tasa
observada y, antes de aplicarla a un pago nuevo de esos dos, se pregunta.

**Consecuencia operativa:** hoy no hay riesgo de pagar de más — a estos seis se
les paga por transferencia y `BillPayments` sólo entra a la mesa por la caja de
pagos con tarjeta. Pero el día que la mesa registre un pago a cualquiera de
ellos, **la retención tiene que viajar en el documento del pago**: sin ella el
pago sale por el bruto, la retención no se declara en el IT-1 y el proveedor
queda cobrado de más.

**Evidencia:** `bill-payments-detalle.jsonl` del espejo, recorrido completo el
2026-08-14. Los campos de retención presentes en el shape son ocho
(`TaxRetentionID1/2`, `TaxRetention1/2Name`, `TaxRetentionAmount_BasedTax`,
`TaxRetentionAmount_BasedTotal`, `TaxRetentionBaseAmountBasedTax`,
`TaxRetentionBaseAmountBasedTotal`); el que trae el monto efectivo en los 40
casos es `TaxRetentionAmount_BasedTax`. Norma citada:
`nucleo-contable/dgii/normas/retenciones-itbis.md`.

**Alcance propuesto:** Blackbox SRL. Habilita a leer la retención de un
proveedor conocido desde el pago; **no** habilita a inventarla para un proveedor
que no esté en la tabla, ni a aplicar el 100% a los dos casos sin explicación.
El mapa se regenera cuando el destilado aprenda a leerlo del pago — hoy se
mantiene a mano.

**Deroga:** en `proveedores.md`, «Account One — posible inconsistencia o
retención ISR 2% Proveedores» (son 20 de 20 con 30% de ITBIS) y «Logistichause —
1 doc con retención, probablemente 30% por transporte de carga» (son 13 pagos
con 100%).

---

## C-005 — «Nota De Debito» de Santa Cruz no describe nada [BORRADOR]

**Enunciado:** Banco Santa Cruz escribe literalmente `Nota De Debito` y **nada
más** en toda salida que no sabe describir: sin beneficiario, sin referencia,
sin concepto. Las 13 del histórico tienen el texto IDÉNTICO, así que
**clasificarlas leyendo la descripción es imposible por construcción** — no es
que sea difícil, es que no hay información ahí.

**Se clasifican cruzando monto + fecha contra ADM, nunca por el texto.** Y el
monto solo no alcanza: cruzando así, los RD$1.000.000 del 30/06 pegaron con una
transferencia de cinco semanas después, y los RD$3.225 con un asiento de
DEVENGO, que no es un pago. **Un match en `Journals` casi nunca es el pago: es
la provisión.** La fecha tiene que coincidir, y el tipo de documento tiene que
ser de caja.

**Los tres patrones que sí identifican** (medidos el 2026-08-14 sobre las 13):

| Patrón | Qué es | Documento |
|---|---|---|
| Día ~1 y día ~30, cuenta 4964, **de a pares** | TSS e INFOTEP del mes | `AccountPayments` — los de julio son PC00000335 y PC00000336 |
| Día ~20, cuenta 4964 | el IT-1 (ITBIS) | `AccountPayments` — ver C-006 |
| **Monto fijo que se repite mes a mes** | cuota de préstamo o línea de crédito | sin precedente: `pregunta` |

El de la cuota es el más fácil de reconocer y el que más se pasa por alto:
RD$96.892,24 exactos el 06/07 y el 07/08. Dos meses seguidos con el mismo monto
al centavo en la misma cuenta no es casualidad, es una amortización.

**Antes de proponer NADA sobre una nota de débito, se busca en el espejo por
monto y fecha.** Dos de las diez que estaban en la mesa al 2026-08-14 ya estaban
registradas y nadie lo había notado: el trabajo era cerrarlas, no registrarlas.

**Evidencia:** las 13 notas de débito de jun–ago 2026 (RD$1,6 M), cruzadas una
por una contra `account-payments`, `bill-payments`, `bank-charges`,
`bank-transfers` y `journals` del espejo. **Cero de 13 tenían documento** al
momento de medir — no hay precedente en el libro que copiar, y por eso esta
regla se escribe desde el dato y no desde la costumbre.

**Alcance propuesto:** Blackbox SRL, cuentas de Banco Santa Cruz. Los otros
bancos del colector sí describen sus movimientos y no necesitan esto. Si Santa
Cruz empieza a mandar descripción, el criterio se revisa en vez de arrastrarse.

---

## C-006 — El pago del IT-1 va como `AccountPayments`, no como asiento

**Enunciado:** el pago mensual del ITBIS —el IT-1, que vence el día 20— se
registra con un **`AccountPayments`** que debita `210.01 Itbis Operativo` y
`210.03 Retención 30% Itbis` contra la cuenta de banco que pagó. **No como
`Journals`**, que es como se hizo hasta diciembre de 2025.

**Por qué cambia:** la forma vieja era un asiento que acredita una cuenta de
caja, y eso es exactamente lo que rechaza el trigger
`qualia_trabajos_journal_no_toca_caja` desde el 2026-08-07. O sea que el
contable no podía proponer el pago del ITBIS de la forma en que la empresa
siempre lo hizo — el candado y la costumbre se contradecían, y la nota de débito
de RD$166.418,03 del 2026-07-20 quedó parada por eso.

Entre las dos salidas —abrirle una excepción al candado o migrar el documento—
se eligió migrar, por tres razones: la TSS y el INFOTEP **ya hicieron ese
camino** en julio de 2026 (PC00000335, PC00000336) y funcionó; un
`AccountPayments` sí lo cruza la conciliación de la mesa y un asiento no; y una
excepción con nombre dentro del candado lo vuelve discutible caso por caso,
que es como se erosiona un límite.

**Evidencia de la forma vieja**, para que quede el rastro de qué se está
cambiando: ED00000037 (16/04/25), ED00000049, ED00000066, ED00000078,
ED00000094 y ED00000120 (20/12/25) — todos alrededor del día 20, todos con la
misma forma. El ED00000120 es el ejemplar limpio:

```
D 210.01 Itbis Operativo        293.951,63
D 210.03 Retencion 30% Itbis      5.778,93
C 101.05 Banco Impuestos 964    299.730,56
```

**Evidencia de que la cuenta admite el documento nuevo:** `210.03` ya se paga
con `AccountPayments` (5 veces, p.ej. PC00000312 del 17/03/26). La `210.01`
nunca se pagó así — este criterio es el primero.

**Los asientos históricos NO se tocan.** Son la contabilidad de 2025, están
correctos en su momento y anular para re-registrar no es lo que este cambio
viene a hacer. La forma nueva rige de acá en adelante.

**Alcance:** Blackbox SRL, el pago del IT-1 de cada período. Si aparece una
retención que no sea la 210.03 dentro del mismo pago, se agrega al asiento del
`AccountPayments` — no se abre un documento aparte.

**Aprobó:** C.Araujo, por chat el 2026-08-14.

**Deroga:** la forma `Journals` para el pago del IT-1, vigente hasta
2025-12-20.
