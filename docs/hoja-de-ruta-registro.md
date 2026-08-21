# Hoja de ruta de registro — BlackBox SRL (ADM Cloud)

- **Para:** auditoría contable externa
- **Empresa:** BlackBox SRL · libro oficial: ADM Cloud
- **Plan de cuentas:** 215 cuentas, extraído de ADM (`raw/accounts.jsonl`, corte 2026‑08‑02)
- **Fecha del documento:** 2026‑08‑11
- **Fuentes:** doctrina del núcleo (`nucleo-contable/doctrina/`), normas DGII del núcleo
  (`nucleo-contable/dgii/normas/`), memoria de la empresa
  (`empresas/blackbox/hermes/memoria/`), libro de acción (275 entradas) y el espejo del
  histórico real de ADM (1.109 facturas de proveedor, 159 cargos bancarios, 729 pagos).

---

## 0. Cómo se lee este documento

Cada caso se escribe en el formato accionable que pidió el dueño:

```
HECHO ─────► CUENTA
```

y cuando el hecho necesita más de un documento, se escriben los pasos en el orden en
que se aplican:

```
Paso 1 · HECHO ─────► CUENTA        (documento A)
Paso 2 · HECHO ─────► CUENTA        (documento B)
```

### Los tres ejes que NO son el mismo

Un registro se decide en tres planos distintos y confundirlos es el error más común:

| Eje | Qué responde | Granularidad |
|---|---|---|
| **Documento de ADM** | Con qué tipo de documento entra al libro | uno por hecho |
| **Cuenta contable** | Dónde impacta el asiento | **una por renglón** |
| **Tipo de gasto 606** | Clasificación DGII para la remisión | **una por documento** |

Una misma factura puede llevar cuentas distintas por renglón (comida a `611.17`,
propina a `690.06`) y un solo tipo de gasto 606 para todo el documento.

### Estado de cada caso

| Marca | Significado |
|---|---|
| ✔ | **Registrado.** Hay documentos reales en ADM; se cita el DocID |
| ◐ | **Dictado sin registro.** Hay criterio o doctrina ratificada, todavía no se ejecutó |
| ○ | **Sin precedente citable.** La cuenta no figura entre las 48 que el destilado del histórico de facturas identifica en uso. Es propuesta a ratificar, no práctica de la casa |

> **Dos numeraciones que se parecen.** Los casos de este documento van por familia
> (`A‑01`, `J‑03`, `M‑04`…). Cuando se cita **`doctrina H‑04`** o **`doctrina H‑12`** se
> está hablando de otra cosa: los hechos H‑01…H‑12 de
> `nucleo-contable/doctrina/conciliacion-hechos.md`, que es el cuerpo ratificado del que
> salen estos criterios. Los principios se citan como `P‑001`…`P‑005` y los criterios de
> la empresa como `C‑001`, `C‑002`.

> **Alcance de la verificación, dicho sin adornos.** Las marcas ✔ salen de documentos
> reales leídos uno por uno. Las marcas ○ tienen dos grados, y la sección 18 los separa:
> **verificado** = se barrieron TODOS los espejos de documentos (facturas, asientos,
> pagos, cargos, transferencias, notas de crédito) y la cuenta no aparece en ninguno;
> **probable** = la cuenta no está entre las 48 del destilado de facturas, pero ese
> destilado no cubre asientos ni pagos, así que falta el barrido. No se afirma como
> hecho lo que no se barrió.

### Los seis documentos de ADM y qué acredita cada uno

| Documento | Prefijo | Qué se acredita | Forma de líneas |
|---|---|---|---|
| `VendorBills` | FP | Cuentas por Pagar (**la pone ADM sola**) | ítems |
| `VendorCreditNotes` | NCP | los gastos y el ITBIS que corrige; CxP va al débito | ítems, precios **positivos** |
| `BillPayments` | PP | la cuenta de caja que pagó | partida doble |
| `AccountPayments` | PC | la cuenta de caja que pagó | partida doble |
| `BankCharges` | CB | en `cargo`: caja/tarjeta · en `credito`: el ingreso del banco o la cuenta del cargo revertido | partida doble + dirección |
| `BankBankTransfers` | TE | las dos cuentas de caja | partida doble |
| `Journals` | ED | lo que declaren las líneas | partida doble |

---

## 1. La regla de arranque: qué documento es, ANTES de qué cuenta

**El NCF no decide el tipo de documento. Ni su presencia ni su ausencia.** Medido sobre
el histórico: 45 de 1.109 facturas de proveedor NO tienen NCF (gobierno, exterior, DGA)
y 51 de 159 cargos bancarios SÍ lo tienen (e‑CF E31 que el banco emite por sus propias
comisiones). La heurística falla en las dos direcciones.

Se pregunta en este orden; la primera que dé SÍ, gana:

1. **¿Nació en el estado de cuenta, sin documento previo, Y la contraparte es el
   BANCO?** → `BankCharges` con dirección explícita.
   *Las dos condiciones son necesarias.* Si del otro lado hay un cliente, un inquilino o
   cualquier tercero, esta pregunta NO la gana: el banco ahí es el caño, no la
   contraparte.
2. **¿Salió de una cuenta propia y entró a otra cuenta propia?** (la tarjeta corporativa
   es cuenta propia: `203.10` / `203.11`) → `BankBankTransfers`.
3. **¿Cancela una obligación que ADM ya tiene registrada?** → `BillPayments`. No crea
   gasto: debita CxP y acredita caja.
4. **¿Un tercero entregó algo o liquidó una obligación, y hay documento recibido?** →
   `VendorBills`, tenga NCF o no, sea quien sea el tercero. La DGA es proveedor (10 de
   10); el banco también (203 facturas, proveedor #1).
   → Sub‑pregunta, la única que mira el NCF: **¿corrige una factura anterior**
   (e‑NCF `E34`, NCF `04`)**?** → `VendorCreditNotes`.
   → **Excepción, y es la única (C‑007, 2026‑08‑15): ¿lo que entró es un inmueble,
   o un bien que se transfiere por acto notarial y no por factura?** → `Journals`
   débito `160.xx` / crédito `201`, y sus pagos por `AccountPayments`. **Sin tipo
   de gasto 606**: la operación no se sustenta en comprobante fiscal, así que no
   hay fila del 606 donde ponerla. Ver K‑01.
5. **¿Devengo puro sin caja?** (nómina, TSS, INFOTEP, ISR de empleados) → `Journals`.
   Último recurso, no cajón de sastre.

**Candado activo:** el trigger `qualia_trabajos_journal_no_toca_caja` rechaza cualquier
`Journals` cuyas líneas toquen `101.xx`, `102.xx`, `203.10` o `203.11`. Si el asiento
correcto toca banco y `Journals` queda bloqueado, el vehículo es `BankCharges` en la
dirección del movimiento (**doctrina H‑12**) — el asiento no cambia, sólo el documento.

---

## 2. FAMILIA A — Compras y gastos corrientes (`VendorBills` · FP)

Documento único, salvo que se pague en el mismo acto (ver Familia D). ADM acredita
Cuentas por Pagar sola: **nunca se escribe la línea de CxP**.

| # | Hecho | ─────► | Cuenta | 606 | ITBIS | Estado |
|---|---|---|---|---|---|---|
| A‑01 | Combustible de flotilla en bomba | ─────► | `620.11` Combustible | 02 | sin ITBIS discriminado (va en el precio) | ✔ 370 usos |
| A‑02 | Flete / courier / envíos | ─────► | `620.10` Envios y Correspondencias | 02 | 18% | ✔ 132 usos |
| A‑02b | Fuel surcharge, manejo y tasas DENTRO del envío | ─────► | `620.10` (con el servicio, **no** a `620.11`) | 02 | 18% | ✔ ratificado 2026‑08‑07 |
| A‑03 | Restaurante — consumo de personal | ─────► | `611.17` Dieta y Viáticos | 05 | 18% | ✔ 81 usos |
| A‑03b | Restaurante — propina legal 10% (Ley 16‑92) | ─────► | `690.06` Propina Legal | 05 | **sin ITBIS** | ✔ 59 usos |
| A‑03c | Restaurante — cena de negocios con cliente | ─────► | `630.05` Gastos de Representación | 05 | 18% | ✔ 8 usos |
| A‑04 | Suministros de oficina, ferretería, supermercado | ─────► | `620.06` Suministros de oficina y otros | 02 | 18% (o 16% en alimentos, art. 343) | ✔ 88 usos |
| A‑05 | Telefonía / internet — cargo base | ─────► | `620.05` Comunicación | 02 | 18% | ✔ 22 usos |
| A‑05b | Telefonía — Impuesto Selectivo al Consumo 10% | ─────► | `620.09` Gasto de ISC | 02 | — | ✔ 23 usos |
| A‑05c | Telefonía — CDT 2% (Ley 153‑98) | ─────► | `690.05` Otros Impuestos | 02 | — | ✔ 20 usos |
| A‑06 | Seguro médico de empleados | ─────► | `611.18` Seguro Medico | 11 | exento | ✔ 19 usos |
| A‑06b | Seguro de vehículo (RC Auto, exceso) | ─────► | `660.01` Seguros de Vehículos | 11 | exento | ✔ ratificado 2026‑08‑03 |
| A‑06c | ISC 16% sobre la prima de seguro (Ley 146‑02) | ─────► | `620.09` Gasto de ISC | 11 | — | ✔ |
| A‑07 | Servicios contables / outsourcing fiscal | ─────► | `621.01` Servicios Contables | 02 | 18% | ✔ 23 usos |
| A‑08 | Servicios legales | ─────► | `621.02` Servcios Legales | 02 | 18% | ✔ 1 uso |
| A‑09 | Consultoría / regencia / otros profesionales | ─────► | `621.04` Otros servicios profesionales | 02 | 18% + **retención ITBIS 30%** | ✔ FP00001072 |
| A‑10 | Mantenimiento general de instalaciones, fumigación | ─────► | `620.03` Mantenimientos generales | 02 | 18% | ✔ 14 usos |
| A‑11 | Reparación de vehículo / lavado | ─────► | `650.08` Rep. y Mant. Equipos de Transporte | 02 | 18% | ✔ 9 usos |
| A‑12 | Reparación de mobiliario y equipo de oficina | ─────► | `650.09` Rep. y Mant. Mobiliario y Equipo Of. | 02 | 18% | ✔ 6 usos |
| A‑13 | Reparación mayor de edificio | ─────► | `650.06` Rep. y Mant. Activos Edificios | 02 | 18% | ✔ 1 uso |
| A‑14 | Uniformes del personal | ─────► | `611.12` Uniformes | 01 | 18% | ✔ 4 usos |
| A‑15 | Capacitación | ─────► | `611.13` Capacitación | 01 | 18% | ✔ 2 usos |
| A‑16 | Software / licencias | ─────► | `620.12` Gastos de Software | 02 | según emisor | ✔ 4 usos |
| A‑17 | Manejo de redes sociales | ─────► | `630.06` Manejo de Redes Sociales | 02 | 18% + retención | ✔ 6 usos |
| A‑18 | Publicidad en medios tradicionales | ─────► | `630.03` Publicidad Medios Tradicionales | 02 | 18% | ✔ 1 uso |
| A‑19 | Servicios de limpieza / tintorería | ─────► | `620.07` Servicios de Limpieza | 02 | 18% | ✔ 1 uso |
| A‑20 | Comisión de corretaje / intermediación | ─────► | `611.02` Comisiones | 02 | 18% | ✔ FREEWAY |
| A‑21 | Membresía de gimnasio / fitness | ─────► | `630.05` Gastos de Representación | 05 | 18% | ✔ ratificado (Pulse Harmony) |
| A‑22 | Electricidad | ─────► | `620.04` Electricidad | 02 | según factura | ○ sin precedente |
| A‑23 | Alquiler de local / nave que la empresa PAGA | ─────► | `620.01` Alquiler de Inmuebles | **03** | ver H‑05 (retenciones) | ○ sin precedente |
| A‑24 | Alquiler de equipos / maquinaria | ─────► | `620.02` Alquiler de equipos | **03** | 18% + retención ITBIS (30% PJ / 100% PF) | ○ sin precedente |
| A‑25 | Publicidad digital | ─────► | `630.02` Publicidad Digital | 02 | según emisor | ○ sin precedente |
| A‑26 | Gastos de viaje (pasajes, hotel) | ─────► | `630.04` Gastos de Viaje | 06 | según emisor | ○ sin precedente |

### A‑90 · Factura con NCF NO autorizado o vencido

```
Paso único · Gasto sin comprobante válido ─────► 801.01 Gastos sin comprobante de crédito fiscal
```

- El ITBIS **no es aprovechable**: no se separa, el total va a `801.01`.
- 606: 08 Gastos Extraordinarios (o el que corresponda a la naturaleza).
- Se deja constancia en el hilo con la nota **GASTO NO ADMITIDO**.
- ✔ 15 usos. Aplica también a la porción sin crédito fiscal *dentro* de una factura
  buena (ej. Tupaq: `620.10` + una línea a `801.01`).

### A‑91 · ITBIS pagado que no es aprovechable pero el gasto sí

```
ITBIS no acreditable ─────► 690.03 Itbis llevado al costo
```

✔ 4 usos (FP00000603, FP00000602, FP00000264). Es distinto de A‑90: acá el gasto es
deducible y sólo el ITBIS se pierde como crédito.

### A‑92 · Gasto personal del socio pagado por la empresa

```
Gasto personal ─────► 801.02 Gastos personales no deduccibles
```

✔ 1 uso. También es la contrapartida de la cuota hipotecaria del apartamento personal
(ver J‑02).

---

## 3. FAMILIA B — Facturas que llevan un ACTIVO adentro

**Principio P‑004: la cuenta se elige por la naturaleza del renglón, no por el emisor.**
Un renglón capitalizable va a activo aunque el proveedor sea "de gasto". La misma
factura puede quedar con cuentas mezcladas — eso es lo correcto, no una anomalía.

### B‑01 · Factura mixta: consumibles + un equipo capitalizable

```
Renglón consumible ─────► 620.06 Suministros de oficina y otros
Renglón equipo      ─────► 160.06 Mobiliarios y Equipos de Oficina
```

- Documento: `VendorBills` único, con **dos** tipos de renglón.
- 606: si el peso principal es el activo → **10 Adquisición de Activos**; si es
  accesorio, se mantiene el del gasto dominante y se explica en el detalle.
- ✔ Precedente: Sarton Dominicana (60% a `160.06` / 40% a `620.06`), Cecomsa (84/16).

### B‑02 · Equipo electrónico / inversor / equipo no clasificable

```
Equipo ─────► 160.07 Otros Activos Fijos
```

✔ 8 usos. Caso ratificado: el inversor de Suena Electronica (RD$12,350) se propuso como
gasto y el dueño lo corrigió dos veces — «¿el tipo no sería adquisición de activo fijo?».

### B‑03 · Vehículo liviano / pesado

```
Vehículo liviano ─────► 160.04 Equipos de Transporte Liviano
Vehículo pesado  ─────► 160.05 Equipos de Transporte Pesado
```

○ Sin uso en el histórico. 606: 10.

### B‑04 · Mejora en local arrendado

```
Mejora ─────► 160.08 Mejoras en Propiedad Arrendada
```

○ Sin uso. Se amortiza contra `170.08`. 606: 10.

### B‑05 · Obra en curso (todavía no en servicio)

```
Obra en curso ─────► 160.09 Activos en Proceso
Al entrar en servicio: 160.09 ─────► 160.0x del activo terminado
```

○ Sin uso.

### ⚠ B‑90 · Umbral de capitalización — HUECO ABIERTO

**No hay dictado.** El inversor de RD$12,350 se activó; una grapadora de RD$800 no
debería. Hasta que exista el umbral escrito, **todo bien durable ambiguo se pregunta**
(P‑004, «Pendiente de dictado»). Esto es un hallazgo para la auditoría, no un criterio.

---

## 4. FAMILIA C — Importación y aduanas (dos documentos, siempre)

### C‑01 · Liquidación de la DGA

```
Paso 1 · Impuestos arancelarios     ─────► 130.02 Compras en Tránsito
         Tasa por servicio aduanero ─────► 130.02 Compras en Tránsito
         DUA‑D / Declaración de valor ────► 130.02 Compras en Tránsito
         ITBIS de importación        ─────► 150.04 ITBIS Adelantado
                                            (VendorBills · proveedor "DGA ADUANAS")

Paso 2 · Débito del banco por la liquidación ─────► BillPayments
         Dr Cuentas por Pagar / Cr 101.05 Banco Impuestos 964
```

- ✔ 10 de 10 liquidaciones históricas van así (FP00000049 … FP00001133).
- **Sin NCF** — la DGA no emite comprobante fiscal. La referencia es el número de DUA, y
  es la única llave anti‑duplicado.
- **Todas las líneas exentas**: el impuesto ya está pagado en la liquidación, no se
  recalcula ITBIS de línea.
- El ITBIS de importación **no es crédito fiscal del período**: se reclama cuando la
  mercancía se nacionaliza.
- 606: **09** Compras y Gastos que Formarán parte del Costo de Venta.
- 9 de 10 liquidaciones están saldadas al centavo con su `BillPayments`; la décima
  (FP00001018) sigue abierta.

### C‑02 · Flete/naviera que acompaña una importación en curso

```
Flete de importación (monto grande, sin ITBIS) ─────► 130.02 Compras en Tránsito
Flete corriente / courier del día a día        ─────► 620.10 Envios y Correspondencias
Flete como costo de venta                       ─────► 511.04 Fletes
```

✔ 69 usos de `130.02`. El corte es si el flete acompaña o no una importación en curso.

### C‑03 · Nacionalización: de tránsito a inventario

```
Mercancía nacionalizada ─────► 130.01 Mercancía para la Venta
                        ◄───── 130.02 Compras en Tránsito
```

◐ La doctrina lo declara («se reclama cuando la mercancía se nacionaliza y se transfiere
de `130.02` al inventario»), pero **no se identificó el asiento de traspaso** en el
material revisado — `130.01` cae en el grupo 18.b, pendiente de barrido sobre
`journals-detalle`. Punto a verificar en la auditoría: si `130.02` se está limpiando.

### C‑04 · Almacenaje / consolidación de importación

```
Almacenaje ─────► 130.02 Compras en Tránsito
```

✔ Global Storage, Consilia, M C Logistics: 100% a `130.02`.

---

## 5. FAMILIA D — Pagos a proveedores (`BillPayments` · PP)

### D‑01 · Pago de una factura ya registrada

```
Dr Cuentas por Pagar (la pone ADM) / Cr caja que pagó
```

✔ 729 pagos históricos. **No crea gasto.** El saldo abierto lo dice sólo `/api/AP`.

| Medio de pago | ─────► | Cuenta acreditada |
|---|---|---|
| Transferencia desde operaciones | ─────► | `101.06` Banco Operaciones 874 |
| Transferencia desde ingresos | ─────► | `101.04` Banco Ingresos 801 |
| Transferencia de impuestos | ─────► | `101.05` Banco Impuestos 964 |
| Transferencia en USD | ─────► | `102.01` Banco Suplidores USD 404 |
| Tarjeta corporativa Visa 1877 | ─────► | `203.10` Tarjeta Corporativa 877 |
| Tarjeta corporativa Visa 2414 | ─────► | `203.11` Tarjeta Corporativa 414 |
| Caja chica | ─────► | `101.03` Caja Chica |

### D‑02 · Pago en USD con la tasa movida (diferencia cambiaria)

```
Paso único · Dr Cuentas por Pagar USD
             Cr 102.01 Banco Suplidores USD 404
             Cr 700.03 Ingreso por diferencia cambiaria   (si la tasa jugó a favor)
             Dr 802.04 Gasto por diferencia cambiaria     (si jugó en contra)
```

✔ `700.03` con 8 usos (PP00000353 registró RD$54,193.25 de ganancia cambiaria) y
`802.04` con 26 usos. El redondeo residual va a la cuenta **Diferencias por Redondeo**
(existe en el plan **sin código**).

### D‑03 · Un pago que salda VARIAS facturas

Un solo `BillPayments` aplicado a las facturas que cubre. El emparejamiento lo hace
`sugerir-asignacion.sh`: 593 aciertos, 20 empates declarados, **cero errores** sobre 729
pagos. Con más de un candidato la propuesta los lista y la web **bloquea el aprobar** —
esa regla de ambigüedad es lo que evita los 7 pagos mal aplicados que el algoritmo sin
ella producía.

### D‑04 · Anticipo a proveedor (pago antes de la factura)

```
Paso 1 · Anticipo entregado ─────► Adelantos Proveedores DOP / USD  (activo, SIN CÓDIGO)
                              o  ─────► 150.05 Avance a proveedores
Paso 2 · Al llegar la factura: se aplica el anticipo contra la CxP
```

○ Sin uso registrado de `150.05`. El plan tiene además `VendorPrepayments` y
`VendorCreditApplications` como documentos nativos. **Requiere dictado** de cuál de las
dos cuentas se usa.

---

## 6. FAMILIA E — Notas de crédito y devoluciones de proveedor

### E‑01 · Nota de crédito recibida (e‑NCF `E34` / NCF `04`)

```
Ajuste del servicio ─────► la MISMA cuenta de la factura original
Reversa del ITBIS   ─────► 210.01 Itbis Operativo
Ajuste del ISC      ─────► 620.09 Gasto de ISC
Otros impuestos     ─────► 690.05 Otros Impuestos
                            (VendorCreditNotes · precios POSITIVOS)
```

- ✔ NCP00000006 y NCP00000007 (Claro, E340009998496 corrige FP00001066).
- **Nunca** una `VendorBills` con montos negativos: es otra secuencia fiscal y ADM no la
  acepta.
- Se llenan `ncf_modificado` y `factura_original_docid` — es el rastro nota→factura.
- ADM invierte el asiento solo: acredita gastos e ITBIS, **debita** Cuentas por Pagar.

### E‑02 · Nota de crédito del BANCO que devuelve un cargo suyo

```
Devolución del cargo ─────► BankCharges dirección CRÉDITO (no VendorCreditNotes)
```

Aunque el NCF diga `E34`. Gana la pregunta 1 (nació en el banco, contraparte = banco).
Precedente del error: el comprobante `E340000187146` se rechazó por intentar la vía
equivocada.

---

## 7. FAMILIA F — Cargos y comisiones bancarias (`BankCharges` · CB, dirección CARGO)

Este es el bloque que el auditor pidió con detalle. **La clave: no todo cargo del banco
es gasto.** Hay tres naturalezas distintas conviviendo en el mismo estado de cuenta.

### F‑A · Comisiones y cargos que SÍ son gasto → `640.01`

| Concepto en el estado de cuenta | ─────► | Cuenta | Evidencia |
|---|---|---|---|
| Comisión LBTR / transferencia local | ─────► | `640.01` Cargos Bancarios | ✔ CB00000179, 180, 187, 195, 210, 216, 219 |
| Por manejo de la cuenta | ─────► | `640.01` | ✔ CB00000200, CB00000246 |
| Por retención / envío de estado de cuenta | ─────► | `640.01` | ✔ CB00000211, CB00000246 |
| Por transferencia internacional | ─────► | `640.01` | ✔ CB00000249, CB00000256 |
| Mantenimiento / renovación / servicio | ─────► | `640.01` | ✔ mapa de cargos |
| Sobregiro | ─────► | `640.01` | ◐ regla en el mapa, sin caso |
| Balance promedio | ─────► | `640.01` | ◐ regla en el mapa, sin caso |
| Comisión de la **manejadora de tarjetas** (adquirente) | ─────► | `640.03` Cargos manejadoras de tarjetas de credito | ✔ 9 usos: CB00000122, 124, 125 |

**Regla de cierre:** `640.01` es deducible, **sin crédito fiscal salvo que el banco
emita su NCF**.

### F‑B · Impuestos que el banco cobra o retiene

| Concepto | ─────► | Cuenta | Naturaleza | Evidencia |
|---|---|---|---|---|
| Impuesto 2×1000 Ley 30‑26 (transferencias y cheques) | ─────► | `640.02` Cargos sobre cheques 0.15 | **gasto** deducible, jamás crédito fiscal | ✔ 136 usos |
| Retención DGII 1% Norma 07‑19 (sobre intereses a PJ) | ─────► | `150.06` Retencion DGII 1% Norma 07‑19 | **ACTIVO** — se compensa contra el ISR | ✔ CB00000212, 213, 221 |
| Retención Ley 253‑12 sobre intereses / interés retenido | ─────► | `150.03` Otros Créditos de ISR | **ACTIVO** | ◐ regla en el mapa, sin caso registrado |

> **El nombre de `640.02` es herencia.** «Cargos sobre cheques 0.15» viene del 1.5‰
> viejo; el 2×1000 vigente se sigue asentando ahí **por consistencia con el histórico**.
> Es el tipo de detalle que un auditor debe conocer antes de leer el mayor.

> **Y estas dos no son gasto.** `150.06` y `150.03` son impuestos retenidos a la empresa,
> es decir un derecho a compensar. Mandarlas a `640.01` infla gasto y pierde el crédito.

### F‑C · Cargos bancarios CON ITBIS (el banco emite su e‑CF E31)

```
Comisión (base)  ─────► 640.01 Cargos Bancarios
ITBIS 18%        ─────► 210.01 Itbis Operativo    (línea propia)
Cr               ─────► la cuenta de banco por el total
```

- 51 de los 159 cargos bancarios históricos traen NCF del banco.
- El ITBIS aprovechable va **como línea propia** en la partida doble — precedente
  verificable en la cuota de leasing FP00001033, que separa `210.01` por RD$11,807.15.
- `Reference` = el NCF del cargo (es la llave que distingue cargos gemelos); si no hay
  NCF, `Reference` = `banco_tx_id`.
- **Todo CB con NCF lleva `FiscalID`** (el campo «RNC» de la pantalla) = RNC del banco
  emisor — Santa Cruz `102012921`. El 606 exige el emisor de cada comprobante; los CB
  de junio–agosto 2026 salieron sin él y la contable los corrigió a mano. Desde el
  2026-08-19 `registrar-cargo-bancario.py` lo manda siempre (mapa `BANCO_RNC`) y se
  niega a registrar un NCF sin emisor resoluble. Aplica a TODA la familia F y G cuando
  hay comprobante, no sólo a F‑C.

### F‑D · Varios cargos amparados por UN solo comprobante

```
Cargo 1 (manejo de cuenta)      ─────► 640.01     300.00
Cargo 2 (retención/envío est. cta.) ─► 640.01     150.00
Cr Banco                                            450.00
```

✔ CB00000246 (NCF E310004445600). Un documento, varias líneas de débito. **No se abre un
CB por cada línea** cuando el comprobante es uno solo.

### F‑E · Intereses que el banco COBRA

```
Interés de préstamo   ─────► 802.01 Intereses de Préstamos
Interés de tarjeta    ─────► 802.02 Intereses de Tarjetas de Crédito   (○ sin uso)
Interés no deducible  ─────► 802.05 Gastos de intereses no deduccibles (○ sin precedente)
```

### F‑F · Lo que NO se registra como cargo bancario

**Notas de débito** («Nota De Débito» a secas, sin beneficiario ni concepto): NO son
gasto del banco, son **pagos a terceros** (DGII, Aduanas, TSS) o abonos a préstamos.
Contablemente van contra la obligación que cancelan. Se resuelven en la conciliación,
contra el recibo del pago. El detector dejó de sembrarlas el 2026‑08‑03 después de que
9 notas de julio por RD$479,564.07 engordaran la cola sin que nadie pudiera decidirlas.

Regla de decisión del detector:

| Situación | Acción |
|---|---|
| Ya está en ADM + beneficiario fiscal | falta el **volante** del impuesto; sólo adjuntar |
| Ya está en ADM + otro | no se sugiere: se concilia solo |
| **No está en ADM** | nadie lo asentó → es el préstamo o la línea de crédito (Familia J) |

---

## 8. FAMILIA G — Créditos e ingresos del banco (`BankCharges` · dirección CRÉDITO)

| # | Hecho | ─────► | Cuenta | Estado |
|---|---|---|---|---|
| G‑01 | Capitalización de intereses / intereses ganados | ─────► | `700.01` Intereses Bancarios | ✔ CB00000163, 172, 174, 261, 265 |
| G‑02 | Cashback «AHORRO POR COMPRA» de tarjeta | ─────► | `701.01` Ingresos Menores (Dr `203.10`) | ✔ CB00000223, CB00000231 |
| G‑03 | Crédito por pago total de tarjeta | ─────► | `701.01` Ingresos Menores (Dr `203.10`) | ✔ CB00000230, 232, 253, 254 |
| G‑04 | Compensación del banco | ─────► | `701.01` Ingresos Menores | ◐ regla del mapa |
| G‑05 | Devolución de un cargo propio del banco | ─────► | **la misma cuenta del cargo original** | ✔ CB00000255 |

### ⚠ G‑90 · Conflicto documentado entre doctrina y registro (para el auditor)

El cashback tiene **dos tratamientos vivos en los libros**:

| Registro | Documento | Cuenta de ingreso |
|---|---|---|
| ED00000183 (2026‑08‑05) | `Journals` | `701.01` Ingresos Menores |
| CB00000223 / CB00000231 | `BankCharges` | `701.01` Ingresos Menores |
| Doctrina H‑09 escrita | `BankCharges` | **`700.01`** Intereses Bancarios |

Las cuentas del registro real (`701.01`) y de la doctrina escrita (`700.01`) **no
coinciden**. Además ED00000183 es un `Journals` que toca la tarjeta `203.10` — hoy eso lo
rechaza el candado, y quedó como diferencia eterna en la conciliación. **Pendiente de
dictado:** ratificar `701.01` en la doctrina H‑09 y derogar la mención a `700.01`, o corregir los
CB. Mientras tanto el precedente ejecutado manda: `701.01`.

---

## 9. FAMILIA H — Impuestos, retenciones y DGII

### H‑01 · Anticipo mensual del ISR — el ciclo completo (3 momentos)

```
Paso 1 (una vez al año) · Provisión anual         Journals
        Dr 150.02 Anticipos ISR
        Cr 210.11 Anticipos ISR por Pagar
        Reference: "P/R Anticipos del periodo AAAA-AAAA"   ✔ ED00000165

Paso 2 (cada mes) · Pago de la cuota              AccountPayments (PC)
        Dr 210.11 Anticipos ISR por Pagar
        Cr 101.05 Banco Impuestos 964
        Beneficiario "DGII ISR" · cuota fija del año fiscal (hoy RD$56,356.46)
        ✔ serie PC00000017 (dic‑2024) → PC00000314 (feb‑2026)

Paso 3 (al cierre) · Liquidación IR‑2             Journals
        Dr 900.01 Gasto de Impuesto sobre la renta
        Cr 210.10 Impuesto Sobre la Renta anual
        Compensación: Dr 210.10 / Cr 150.02
        Si anticipo > ISR → saldo a favor queda en 150.02 (o 150.07)
        Si ISR > anticipo → la diferencia se paga con otro PC contra 210.10
```

**Confirmado por el dueño (2026‑08‑10):** el pago mensual debita `210.11`. Imputarlo a
`150.02` duplicaría (la provisión ya lo debitó); imputarlo a `900.01` anticiparía un
gasto que sólo se define al cierre.

### H‑02 · Pago de ITBIS y de retenciones a la DGII

```
Dr 210.01 Itbis Operativo             (el ITBIS del período)
Dr 210.02 Retencion 100% Itbis        (lo retenido a Personas Físicas)
Dr 210.03 Retencion 30% Itbis         (lo retenido a PJ por servicios profesionales)
Cr 101.05 Banco Impuestos 964
                                       (AccountPayments · beneficiario DGII)
```

✔ PC00000118 (Dr `210.02` 6,750.00 + Dr `210.03` 1,325.32 / Cr `101.05` 8,075.32).
`210.03` tiene 68 usos históricos, `210.02` tiene 3.

### H‑03 · Pago del ISR retenido a empleados, con recargo

```
Dr 210.04 Retencion ISR Empleados     16,144.38
Dr 801.04 Recargo e Intereses          1,792.03    ← la mora NO es del impuesto
Cr 101.05 Banco Impuestos 964         17,936.41
```

✔ PC00000114. **Regla:** el recargo y los intereses por mora van SIEMPRE a `801.04`
(gasto no admitido), nunca sumados al impuesto.

### H‑04 · Retenciones que la empresa PRACTICA al pagar a terceros

Se reconocen **en la factura** (bajan el neto a pagar), y se cancelan al pagarlas a la
DGII.

| Caso | Retención | ─────► | Cuenta de pasivo | Formulario | Estado |
|---|---|---|---|---|---|
| Servicios profesionales u honorarios a **Persona Física** | ISR 10% | ─────► | `210.06` Retencion IRS 10% Proveedores | IR‑17 | ○ sin precedente |
| **Alquiler de inmueble o mueble pagado a Persona Física** | ISR 10% | ─────► | `210.06` | IR‑17 | ○ sin precedente |
| Servicios técnicos (albañilería, plomería, pintura, mecánica) a PF | ISR 2% | ─────► | `210.07` Retencion ISR 2% Proveedores | IR‑17 | ○ sin precedente |
| Otras retenciones Norma 07‑2007 | ISR 2% | ─────► | `210.07` | IR‑17 | ○ sin precedente |
| Remesas al exterior | ISR 27% | ─────► | `210.05` Retencion ISR 27% (Exterior) | IR‑17 | ○ sin precedente |
| Servicio gravado prestado por **Persona Física** | ITBIS 100% | ─────► | `210.02` Retencion 100% Itbis | IT‑1 secc. A | ✔ 3 usos |
| Servicios profesionales liberales / alquiler de muebles **PJ → PJ** | ITBIS 30% | ─────► | `210.03` Retencion 30% Itbis | IT‑1 casilla 43 | ✔ 68 usos |
| Seguridad o vigilancia (sociedad a sociedad) | ITBIS 100% | ─────► | `210.02` | IT‑1 casilla 42 | ○ sin precedente |
| Proveedor RST persona física, comprador PJ | ITBIS 100% + ISR 10% | ─────► | `210.02` + `210.06` | IT‑1 / IR‑17 | ○ sin precedente |

**El punto que importa para la auditoría:** no retener no es un ahorro, es una deuda
propia — el agente de retención responde por las sumas que no haya retenido debiendo
hacerlo (Ley 11‑92 art. 309).

### H‑05 · Retenciones por ARRENDAMIENTO — desglose completo (caso solicitado)

**Cuando BlackBox PAGA alquiler:**

```
Paso 1 · Factura del alquiler                     VendorBills · 606 = 03 Arrendamientos
        Dr 620.01 Alquiler de Inmuebles          (base del canon)
        Cr 210.06 Retencion IRS 10% Proveedores  (10% — SÓLO si el dueño es Persona Física)
        Cr Cuentas por Pagar                     (el neto)

Paso 2 · Pago del neto al arrendador              BillPayments
        Dr Cuentas por Pagar / Cr banco

Paso 3 · Entero de la retención a la DGII         AccountPayments
        Dr 210.06 / Cr 101.05 Banco Impuestos 964 · IR-17 al día 10
```

○ **Sin precedente:** `620.01` y `210.06` no tienen un solo uso en el histórico. Es un
caso a estrenar, y la propuesta de arriba es la que sale de la norma del núcleo.

**Advertencias sobre el ITBIS del arrendamiento:**
1. Si el arrendador es **Persona Física** y factura ITBIS → retención del **100%** del
   ITBIS a `210.02`.
2. Si es **Persona Jurídica**, el núcleo sólo tiene regla escrita para **alquiler de
   bienes muebles** (30% a `210.03`). Para inmuebles **el núcleo no dicta** — se pregunta
   al contador antes de registrar el primero. No se asume.

**Cuando BlackBox COBRA alquiler** (la nave industrial): ver M‑02 y L‑04.

### H‑06 · Otros impuestos

| Hecho | ─────► | Cuenta | Estado |
|---|---|---|---|
| Impuesto sobre activos | ─────► | `690.01` Gasto Impuesto sobre Activos | ○ sin precedente |
| Contribución de residuos sólidos — gasto | ─────► | `690.02` Gasto Residuos Solidos | ○ sin precedente |
| Contribución de residuos sólidos — pasivo | ─────► | `210.12` Contr de Residuos Sólidos | ○ sin precedente |
| Impuestos no adelantados | ─────► | `690.04` Impuestos No Adelantados | ○ sin precedente |
| Otros impuestos varios | ─────► | `690.05` Otros Impuestos | ✔ 20 usos |
| ITBIS con saldo a favor acumulado | ─────► | `150.07` Saldo a favor ITBIS | ○ sin precedente |

---

## 10. FAMILIA I — Nómina y personal (5 piezas, JAMÁS autónoma)

La nómina **no es un asiento**: son **3 asientos de devengo + 2 patas de pago**. El
módulo PR nativo de ADM está vacío por diseño.

### Pieza 1 · `NOMINA <MES> <AÑO>` — Journals, fin de mes

```
Dr 611.01 Sueldos                     ─────► col. Sueldo del Excel
Dr 611.02 Comisiones                  ─────► col. Comisiones
Dr 611.04 Incentivos                  ─────► col. Otras remuneraciones (si hay)
Cr 210.04 Retencion ISR Empleados     ─────► col. ISR
Cr 210.08 Retencion TSS Empleados     ─────► col. SFS 3.04%
Cr 210.08 Retencion TSS Empleados     ─────► col. AFP 2.87%  (2da línea, MISMA cuenta)
Cr 220.01 Nómina por Pagar            ─────► col. Total a pagar (neto)
```

⚠ **El débito NO es la columna "Total" del Excel** — esa columna resta 35.000. El débito
es `SUM(Sueldos) + SUM(Comisiones) + SUM(Otras remuneraciones)`.

### Pieza 2 · `REG. TSS EMPLEADOR <AAAAMM>` — Journals

```
Dr 611.08 Aportes SFS             ─────► SFS patronal 7.10%
Dr 611.09 Aportes AFP             ─────► AFP patronal 7.10%
Dr 611.1  Aporte Riesgo Laboral   ─────► SRL 1.00–1.50% según riesgo
Cr 210.09 Aporte TSS Empleador    ─────► suma de los tres
```

### Pieza 3 · `REG.INFOTEP EMPLEADOR <AAAAMM>` — Journals

```
Dr 611.11 Aporte Infotep  ─────► 1% de la base
Cr 210.1  Aporte INFOTEP  ─────► 1% de la base
```

⚠ `210.1` es **Aporte INFOTEP**, NO `210.10` (ISR anual). Un dígito de diferencia y dos
cuentas de naturaleza opuesta.

### Pieza 4 · Pago a empleados — `AccountPayments`, uno por empleado

```
Dr 220.01 Nómina por Pagar        ─────► neto del empleado
Cr 101.06 Banco Operaciones 874
Reference: N<DD><MM><AA> <Empleado>   (N150126 = 1era quincena, N300126 = 2da)
```

### Pieza 5 · Pago de obligaciones al Estado — `AccountPayments` ×2

```
Pago TSS:     Dr 210.08 + Dr 210.09 / Cr 101.05 Banco Impuestos 964   ✔ PC00000335
Pago INFOTEP: Dr 210.1              / Cr 101.05 Banco Impuestos 964   ✔ PC00000336
```

Ejemplar completo junio 2026: ED00000170 (322,508.09), ED00000179 (49,526.94),
ED00000178 (3,225.00). Cuadre verificado al centavo contra el Excel.

### Conceptos de nómina que existen en el plan y NO se han usado

| Concepto | ─────► | Gasto | ─────► | Pasivo |
|---|---|---|---|---|
| Vacaciones | ─────► | `611.03` | ─────► | `220.01` |
| Horas extras | ─────► | `611.05` | ─────► | `220.01` |
| Bonificación | ─────► | `611.06` | ─────► | `220.02` Bonificaciones por Pagar |
| Regalía pascual | ─────► | `611.07` Regalia | ─────► | `220.01` |
| Incentivos | ─────► | `611.04` | ─────► | `220.03` Incentivos por Pagar |
| Preaviso y cesantía | ─────► | `611.15` | ─────► | `220.05` Preavisos y Cesantias por Pagar |
| Seguros retenidos al empleado | ─────► | — | ─────► | `220.04` Seguros Retenidos |
| Otros gastos de personal | ─────► | `611.14` | ✔ 6 usos | |

### ⚠ Banderas rojas de nómina abiertas (para el auditor)

1. **`220.01` sin débitos.** Al corte 2026‑08‑02 no hay pagos a empleados de junio ni
   julio: la cuenta acumula ~RD$609,000 de nómina devengada y no liquidada.
2. **`801.03` Gastos Impuestos, +20.89 en julio.** Línea manual sin documentar que elevó
   el neto sobre el Excel. Origen desconocido.
3. **TSS con período mal etiquetado.** ED00000181 (julio) tiene `Reference "202606"`.
   Buscar "202607" no la encuentra → riesgo real de registrarla dos veces.
4. **ADM no frena asientos duplicados.** Duplicar una nómina son ~RD$350,000 en los
   libros, sin red.

---

## 11. FAMILIA J — Préstamos, leasing y líneas de crédito (caso solicitado)

**No hay plantilla: cada movimiento es distinto.** Y el histórico muestra **tres formas
distintas** conviviendo, lo que es en sí un hallazgo de auditoría.

### J‑01 · Desembolso de un préstamo (entra la plata)

```
Dr 101.04 Banco Ingresos 801   ─────► el monto desembolsado
Cr 230.05 Prestamo BSC 0851    ─────► el pasivo que nace
```

✔ ED00000169 (2026‑03‑23, RD$2,497,600) y ED00000148 (2026‑02‑11, RD$4,000,000 a
`230.02`). Se registraron como `Journals`.

⚠ **Bajo la regla vigente esto ya no pasa:** un `Journals` que toca `101.xx` lo rechaza
el candado. Hoy el vehículo correcto es `BankCharges` en dirección crédito (doctrina
H‑12), con
las mismas cuentas.

| Préstamo | ─────► | Cuenta |
|---|---|---|
| Hipotecario San Gerónimo | ─────► | `230.01` Préstamo Hipotecario (San Gerónimo) |
| Préstamo Y No. 00003 | ─────► | `230.02` Prestamo Y No. 00003 |
| Leasing 247355SDO071A | ─────► | `230.03` Leasing 247355SDO071A |
| Préstamo BSC 0851 | ─────► | `230.05` Prestamo BSC 0851 |
| Línea de crédito Santa Cruz | ─────► | `225.01` Línea de Crédito Santa Cruz (○ sin uso) |
| Aportes para futura capitalización | ─────► | `230.04` (○ sin precedente) |

### J‑02 · Cuota de préstamo hipotecario (capital + interés)

```
Dr 230.01 Préstamo Hipotecario (San Gerónimo)   29,445.41   ← capital
Dr 802.01 Intereses de Préstamos                 2,160.76   ← interés
Cr 801.02 Gastos personales no deduccibles      31,606.17
                                                  (Journals)
```

✔ ED00000034, ED00000035, ED00000036 (ene–mar 2025). **Particularidad:** la cuota del
apartamento personal se acredita contra `801.02`, no contra banco, porque es gasto del
socio y no de la empresa. Es un tratamiento deliberado y el auditor debe conocerlo.

### J‑03 · Cuota de LEASING — la más completa (4 renglones)

```
Dr 230.03 Leasing 247355SDO071A   38,819.77   ← capital
Dr 660.01 Seguros de Vehículos     8,454.06   ← el seguro que va dentro de la cuota
Dr 802.01 Intereses de Préstamos  26,775.51   ← interés financiero
Dr 210.01 Itbis Operativo         11,807.15   ← ITBIS de la cuota (crédito fiscal)
                                  ─────────
                                  85,856.49
        (VendorBills contra "Banco Multiple Santa Cruz S A", NCF E310004084750)
Paso 2 · el débito del banco ─────► BillPayments contra esa factura
```

✔ FP00001033 (2026‑06‑03). El banco es proveedor: 203 facturas históricas, `230.03` con
18 usos.

⚠ **Inconsistencia detectada:** FP00000977 (2026‑05‑01), la MISMA cuota por el MISMO
monto, se registró distinto — el ITBIS como `TaxAmount` de la línea de leasing en vez de
línea propia a `210.01`, y el seguro a `150.01` Seguros (activo) en vez de `660.01`
(gasto). Dos criterios para el mismo hecho recurrente. **Requiere unificación.**

### J‑04 · Cuota de préstamo ordinaria (capital + interés, pagada del banco)

```
Dr 230.0x  el préstamo que corresponda   ─────► porción de CAPITAL
Dr 802.01  Intereses de Préstamos        ─────► porción de INTERÉS
Cr 101.0x  la cuenta de banco que pagó
```

◐ **Bloqueado por un dato que no existe.** Partir la cuota en capital e interés **exige
la tabla de amortización del préstamo**, y hoy no está cargada en ningún lugar del
sistema. Sin ella, cualquier reparto está mal.

**Desbloqueado el 2026-08-21 para los préstamos cuyo banco emite e-NCF de
devengación de intereses** (Santa Cruz los emite el último día del mes, período
01–fin): esos comprobantes SON la partición, documentada por el propio banco —
interés = suma de los e-NCF del mes del crédito, capital = débito − intereses.
Nada que estimar, así que H-04 no aplica. Lo arma el detector
`qualia-sugerencias/prestamos.ts` (decisión de Carlos: script determinista, sin
turno del contable), en dos etapas: N facturas de intereses (una por e-NCF, 606
tipo 07) + 1 factura de abono a capital (sin NCF, referencia
`PRESTAMO-<credito>-<YYYYMM>`), y cuando el grupo entero vive en ADM, **UN
BillPayments que las liquida juntas** — un débito del banco → un solo documento
contra el banco, o la conciliación (monto contra monto, 1 a 1) no lo cruza
nunca. La aprobación humana en la mesa se mantiene por fila. Config: bloque
`prestamos` del mapa de cuentas (crédito → cuenta de deuda). El préstamo SIN
e-NCF sigue bloqueado por H-04, igual que siempre.

Regla dura vigente (doctrina H‑04): si la cuota cae en el estado de cuenta y no está
registrada, **se pregunta citando la doctrina H‑04 — nunca se estima la partición**. El proponedor determinista
tiene el corte codificado: cualquier reparto hacia una cuenta `2xx.xx` se manda a sesión
humana en vez de proponerse solo.

**Pendiente #1 del proyecto:** cargar las tablas de amortización de los préstamos vivos.

### J‑05 · Abono a capital de un préstamo (sin interés)

```
Paso 1 · Abono reconocido      ─────► 230.02 Prestamo Y No. 00003   400,000.00
         Cr Cuentas por Pagar                                       400,000.00
                                       (VendorBills contra el banco)
Paso 2 · Salida del banco      ─────► BillPayments · Dr CxP / Cr 101.0x
```

✔ FP00000435 (2025‑07‑02, RD$400,000). Cuando el abono es sólo capital no hay línea de
interés y el reparto no hace falta — por eso este caso SÍ se puede registrar hoy y la
cuota mixta no.

**Vía alternativa (un solo paso), si el abono nace en el banco sin papel previo:**
`BankCharges` dirección cargo — Dr `230.02` / Cr banco (doctrina H‑12). El detector de notas de
débito llega exactamente acá: «no está en ADM → es el préstamo o la línea de crédito».

### J‑06 · Interés de préstamo cobrado por el banco, suelto

```
Interés ─────► 802.01 Intereses de Préstamos    (BankCharges, dirección cargo)
```

✔ 10 usos.

---

## 12. FAMILIA K — Activos fijos y bienes raíces (caso solicitado)

### K‑01 · Compra de un inmueble

```
Paso 1 · Compra del inmueble ─────► 160.0x el inmueble
         Cr 201 Cuentas por Pagar DOP
                                     (Journals · ED · SIN tipo de gasto 606)

Paso 2 · Pago al vendedor
         Dr 201 Cuentas por Pagar DOP
         Cr 101.0x el banco que pagó
                                     (AccountPayments · beneficiario el vendedor)

Paso 3 · Impuesto de transferencia inmobiliaria pagado a la DGII
         Dr 160.0x el mismo inmueble                    ← SE CAPITALIZA
         Cr 101.06 Banco Operaciones 874
                                     (AccountPayments · beneficiario DGII)
```

**Dos criterios, y los dos son duros:**

1. **No es una `VendorBills`, y por lo tanto no va al 606** (C‑007, 2026‑08‑15).
   Comprar un inmueble no es una compra de bienes y servicios: es un cambio de forma
   del patrimonio, documentado con acto de venta notarial, que paga el **3% de
   transferencia inmobiliaria** y no genera NCF ni ITBIS adelantado. Toda factura de
   proveedor con RNC entra al 606 por construcción — meter la compra ahí genera una
   fila que la DGII no puede cuadrar contra ningún comprobante.
2. El impuesto de transferencia **no es gasto**: se capitaliza al costo del inmueble.

✔ PC00000302 (2026‑02‑25) para el paso 3. `160.03` acumula 10 usos.

> **Corrección del 2026‑08‑15 — qué decía esta sección y por qué era falso.** Decía
> `VendorBills · 606 = 10 Adquisición de Activos`, citando FP00000838 (RD$180.020,00,
> 2026‑01‑23) como precedente de «compra del inmueble». Al verificarla contra ADM,
> esa factura es del **`Banco Multiple Santa Cruz S A`, RNC 102012921** — un
> contribuyente con RNC, no la persona física a la que después se le extendió el
> criterio. Sobre esa extrapolación se registraron las FP00001152 y FP00001153 del
> Caso #4 (locales J‑11 y J‑12, RD$1.725.000,00 cada uno), con el vendedor sin RNC
> en ADM y las dos sin NCF: RD$3.450.000,00 encaminados al 606 sin comprobante. Los
> contables de la empresa lo dictaminaron, los cuatro documentos —las dos facturas y
> sus pagos PP00000813 y PP00000814— se anularon, y la operación se re‑registró por
> la forma de arriba.

### K‑02 · Otras compras de bienes raíces

| Hecho | ─────► | Cuenta | Estado |
|---|---|---|---|
| Terreno | ─────► | `160.01` Terrenos | ○ sin precedente |
| Apartamento / edificio | ─────► | `160.02` Edificios (Apartamento San Gerónimo) | ✔ 2 usos (carga inicial: Dr 6,000,000 / Cr 1,500,000) |
| Nave industrial | ─────► | `160.03` | ✔ 10 usos |
| Local comercial J‑11 / J‑12 (Plaza Paraíso del Mar) | ─────► | `160.10` / `160.11` | ✔ Caso #4, por asiento (K‑01) |
| Gastos legales, tasación y notariales de la compra | ─────► | **se capitalizan al mismo `160.0x`** | ○ criterio a ratificar |

> **Nota para el auditor:** un terreno **no se deprecia**; una edificación sí. Si un solo
> documento trae terreno + edificación, se separan en dos renglones — es el mismo
> principio P‑004 de la factura mixta (B‑01), aplicado a inmuebles.

### K‑03 · Depreciación mensual

```
Dr 650.01 Depreciación Acumulada Edificios          ─────► gasto del período
Cr 170.02 Depreciación Acumulada Edificios          ─────► contra‑activo
```

| Activo | Gasto ─────► | Acumulada ─────► |
|---|---|---|
| Edificios | `650.01` | `170.02` |
| Maquinarias | — | `170.03` |
| Equipo transporte liviano | `650.03` | `170.04` |
| Equipo transporte pesado | `650.03` | `170.05` |
| Mobiliario y equipo de oficina | `650.04` | `170.06` |
| Otros activos fijos | `650.02` | `170.07` |
| Mejoras en propiedad arrendada | — | `170.08` (amortización) |
| Primas de seguro (intangible) | `650.05` | — |

○ **No se identificó ninguna corrida de depreciación** en el material revisado. Las
cuentas existen y la mecánica es estándar, pero `650.01`–`650.04` y `170.02`–`170.08`
están en el grupo 18.b: hay que barrer `journals-detalle` antes de afirmar que no se
deprecia. Si el barrido confirma el cero, es un hallazgo mayor.

### K‑04 · Venta o baja de un activo fijo

```
Paso 1 · Dar de baja el activo
         Dr 170.0x Depreciación Acumulada    ─────► lo depreciado
         Dr 802.03 Pérdida en Venta de Activos   (si se vende por menos del neto)
         Cr 160.0x el activo                 ─────► el costo original
         Cr 700.02 Ganancia en Venta de Activos  (si se vende por más)

Paso 2 · Cobro de la venta
         Dr banco / Cr 701.02 Venta de activos fijos
```

○ Sin uso de `700.02`, `701.02` ni `802.03`.

---

## 13. FAMILIA L — Ingresos, clientes y cobros

> **Límite operativo, no contable:** el rol del contable automático en ADM **niega toda
> emisión AR** — `CashInvoices`, `CreditInvoices`, notas de crédito de cliente y
> `Deposits`. Estos casos los registra un humano. El sistema abre un evento `pregunta`
> con el movimiento, el tercero y el tratamiento; **no los disfraza de `BankCharges`**.

| # | Hecho | ─────► | Cuenta de ingreso | Documento |
|---|---|---|---|---|
| L‑01 | Venta de módulos eléctricos / cintas / power supply / trims | ─────► | `411.01` … `411.04` | CreditInvoices / CashInvoices |
| L‑02 | Venta de electrónica, frascos, aceites esenciales, gastables | ─────► | `411.06` … `411.09` | idem |
| L‑03 | Servicios generales | ─────► | `411.15` Servicios Generales | idem |
| L‑04 | **Renta de inmuebles (la nave)** | ─────► | `411.16` Renta Inmuebles | idem — ○ **sin uso** |
| L‑05 | Transporte facturado al cliente | ─────► | `411.90` Transporte | idem |
| L‑06 | Descuento concedido en la venta | ─────► | `411.97` Descuentos en ventas | idem |
| L‑07 | Devolución de mercancía del cliente | ─────► | `411.98` Devoluciones en ventas | nota de crédito de cliente |
| L‑08 | Descuento por pronto pago en el cobro | ─────► | `411.99` Descuentos en Cobros | CashReceipts |

### L‑09 · Cobro por tarjeta — el neto engaña

```
El banco acredita NETO de comisión 5.395%:
        monto_original = monto_banco / (1 - 0.05395)

Dr 101.0x banco                    ─────► lo que entró de verdad
Dr 640.03 Cargos manejadoras de tarjetas de credito ─────► la comisión retenida
Cr 110    Cuentas por Cobrar clientes DOP           ─────► el monto facturado
```

✔ C‑001, corregido por el dueño en sesión real (julio 2026). Caso verificado: banco
6,663.31 → original 7,043.30 vs ADM 7,043.29. El cruce va por **monto original + fecha**,
nunca por nombre: el banco dice «Servicios Digita», ADM dice el cliente real.
`640.03` tiene 9 usos como cargo del adquirente.

⚠ **Además:** las compañías de adquirencia retienen **2% de ITBIS** (Norma 06‑23) que es
**pago a cuenta** — casilla 27 del Anexo A. Si no se computa, se paga dos veces el mismo
impuesto. ○ Sin cuenta identificada en los libros para esa retención.

### L‑10 · Cuentas por cobrar del grupo

| Hecho | ─────► | Cuenta |
|---|---|---|
| CxC clientes DOP | ─────► | `110` / `110.01` Auxiliar |
| CxC clientes USD | ─────► | `111` |
| CxC accionistas | ─────► | `112.01` |
| CxC empleados | ─────► | `112.02` |
| CxC planchas | ─────► | `112.03` |
| Otras cuentas por cobrar | ─────► | `125` |

---

## 14. FAMILIA M — Casos especiales de conciliación

Acá vive lo que no encaja en ninguna plantilla. **Todos comparten dos reglas duras:**

- **P‑001 — El asiento nace de lo ASENTADO, no del deber‑ser.** Antes de proponer una
  partida que usa, cancela o corrige un saldo, se verifica por consulta que ese saldo
  EXISTE en ADM tal como la partida lo asume. *Evidencia del costo de saltárselo: el
  Caso #1 se rechazó **diez veces** por debitar un «Adelanto de Clientes» que nunca
  existió.*
- **P‑002 — Un reverso se asienta contra su movimiento original**, con la misma cuenta y
  signo contrario. La cuenta **no se deduce de la descripción del reverso**: se encuentra
  atando el original. Sin original identificado no hay propuesta, hay pregunta.

### M‑01 · Dinero de un cliente recibido por adelantado (anticipo / pago de más)

```
Paso 1 · Reconocer la ENTRADA COMPLETA          BankCharges dirección crédito
         Dr 101.04 Banco Ingresos 801
         Cr 220.06 Depositos en Garantia por Renta (Anticipo)

Paso 2 (al devengarse) · Dr 220.06 / Cr 411.16 Renta Inmuebles + su ITBIS
Paso 2' (al devolverse) · Dr 220.06 / Cr banco
```

✔ CB00000259. **El libro debe reflejar TODO lo que el banco recibió**: si el recibo se
asentó por menos, la conciliación nunca cuadra. **NO se corrige el recibo original** —
corregir en ADM implica anular, y anular BORRA sin dejar lápida (P‑005).

⚠ **La contraparte es el cliente, no el banco.** Un cobro de un tercero jamás toca
`640.x` ni `700.01`, aunque haya llegado por ACH y sin papel previo. El banco es el caño.
El `BankCharges` es sólo el **vehículo documental** (doctrina H‑12), porque la conciliación de ADM
no cruza `Journals`.

### M‑02 · Depósito recibido en garantía

```
Dr 101.04 Banco Ingresos 801
Cr 220.06 Depositos en Garantia por Renta        ← PASIVO mientras la garantía viva
```

✔ CB00000258 (Formax, RD$180,000). **Nunca ingreso:** es dinero ajeno condicionado.
**Cero devengo — «se quedan hasta que desaloje»** (dictado del contador). Recién al
desalojo se devuelven (Dr `220.06` / Cr banco) o se aplican a renta/daños (Dr `220.06` /
Cr `411.16` con su ITBIS en ese momento).

⚠ **Trampa del espejo:** `180.01` **Fianzas & Depósitos es ACTIVO** — son los depósitos
que la empresa ENTREGA. Usarla acá invertiría el balance.

⚠ **Garantía ≠ anticipo:** la garantía se devuelve al final del contrato; el anticipo se
consume como ingreso al devengarse. Si el texto no deja claro cuál es, se pregunta
citando ambos.

### M‑03 · Pago recibido por error y su devolución (dos pasos)

```
Paso 1 · Reconocimiento          BankCharges crédito · CB00000259
         Dr 101.04 Banco Ingresos 801   7,552.00
         Cr 220.06 pasivo con el tercero

Paso 2 · Devolución              BankCharges cargo · CB00000260
         Dr 220.06 pasivo con el tercero  7,552.00
         Cr 101.04 Banco Ingresos 801
```

✔ Caso #2 Mtk Designs. **Regla dura: cada paso es un TRABAJO, ninguno queda en prosa.**
Si hacen falta dos registros, se abren DOS documentos en el orden en que se aplican.
Dejar el segundo escrito como advertencia significa que no se aplica nunca.

### M‑04 · ⭐ Devolución que vuelve con MENOS dinero del que salió (caso solicitado)

Éste es el caso que más se registra mal, porque tiene **dos hechos adentro y uno solo es
el reverso**. La regla: **el reverso se asienta por lo que volvió; la diferencia es un
hecho propio y necesita su propia cuenta.**

```
Paso 1 · Reverso por el monto que EFECTIVAMENTE volvió
         Dr banco (lo recibido)
         Cr LA MISMA CUENTA del movimiento original   (P-002)

Paso 2 · La diferencia, según POR QUÉ se quedó corta:
```

| Por qué volvió menos | La diferencia ─────► | Cuenta |
|---|---|---|
| El banco cobró comisión por la devolución | ─────► | `640.01` Cargos Bancarios |
| El banco retuvo el 2×1000 de la operación | ─────► | `640.02` Cargos sobre cheques 0.15 |
| Fue en USD y la tasa cambió entre ida y vuelta | ─────► | `802.04` Gasto por diferencia cambiaria (o `700.03` si volvió más) |
| El proveedor retuvo una penalidad o gasto administrativo | ─────► | `801.01` Gastos sin comprobante · o la cuenta del servicio si hay factura |
| El tercero devolvió menos sin explicación documentada | ─────► | **no se cierra: se pregunta** — un descuadre sin causa no se "ajusta" |
| Diferencia de centavos por redondeo | ─────► | **Diferencias por Redondeo** (existe en el plan, sin código) |

○ **Sin precedente registrado** de una devolución parcial. Lo que sí hay es la evidencia
del hueco: la devolución del 2×1000 (crédito del 06/08) salió **«SIN CUENTA ASIGNADA»** y
un humano tuvo que asignarla a mano.

⚠ **Lo prohibido, explícito:** cerrar la diferencia mandándola a `640.01` "porque es del
banco" sin haber atado el movimiento original. Si el original no se identifica, no hay
propuesta — hay pregunta.

### M‑05 · Reverso o devolución de un cargo bancario (completo)

```
Devolución ─────► la MISMA cuenta del cargo original, signo contrario
```

✔ CB00000255: el banco devolvió US$2.25 del 2×1000 en la cuenta USD → Dr `102.01` /
Cr `640.02`. **Alcance ratificado:** toda devolución de impuesto bancario cuyo cargo
original fue a `640.02` se revierte ahí.

### M‑06 · Cobro de más a un cliente que hay que devolver

```
Paso 1 · Verificar en ADM cuánto se asentó de verdad     (P-001, NO OPCIONAL)
Paso 2 · Devolución de la diferencia    BankCharges dirección cargo
         Dr el pasivo con el cliente / Cr banco
```

✔ Caso #3 (Jfd & Etc Ideas): entraron RD$12,588.51 contra un recibo RI00000718 de
RD$8,265.76 → sobran RD$4,322.75. **Diez propuestas murieron** por debitar un
«Adelanto de Clientes» que nunca se registró.

### M‑07 · Partida en tránsito (diferencia de tiempo)

```
NO SE REGISTRA NADA.
```

Que un documento esté en ADM y todavía no en el banco (o al revés, con fechas cercanas)
**no es un faltante**: es una partida en tránsito. Se marca, se espera al siguiente corte
y **no se crea nada** — crear un asiento para "cuadrar" una diferencia de timing fabrica
el descuadre del mes siguiente. Sólo si envejece más de un ciclo de corte se investiga
como faltante real.

### M‑08 · Transferencia entre cuentas propias

```
Cr 101.0x / 102.0x   la cuenta que da
Dr 101.0x / 102.0x   la cuenta que recibe
                      (BankBankTransfers · TE)
```

✔ TE00000212 … TE00000221. **No es ingreso ni gasto.** Las dos patas comparten el
`nro_referencia` del banco — se emparejan por referencia, nunca por monto y fecha (dos
traslados iguales el mismo día son normales). Con cambio de moneda, ADM lo modela nativo
(`TotalAmount` origen, `ToAmount` destino, `ExchangeRate`); la tasa sale de dividir un
lado entre el otro y esa diferencia es **una partida más**.

⚠ La tarjeta corporativa cuenta como cuenta propia: un pago a la Visa desde el banco es
`BankBankTransfers`, no un gasto.

---

## 15. FAMILIA N — Moneda extranjera

| # | Hecho | ─────► | Cuenta | Estado |
|---|---|---|---|---|
| N‑01 | Ganancia por tasa al pagar/cobrar en USD | ─────► | `700.03` Ingreso por diferencia cambiaria | ✔ 8 usos |
| N‑02 | Pérdida por tasa al pagar/cobrar en USD | ─────► | `802.04` Gasto por diferencia cambiaria | ✔ 26 usos |
| N‑03 | Revaluación de saldos en USD al cierre | ─────► | `700.03` / `802.04` contra `102.0x` o CxP USD | ◐ hay journals con `802.04` a fin de mes; el procedimiento no está escrito |
| N‑04 | Diferencia de centavos | ─────► | **Diferencias por Redondeo** (sin código) | ✔ PP00000353 |

---

## 16. FAMILIA O — Capital, cierre y ajustes

| # | Hecho | ─────► | Cuenta | Estado |
|---|---|---|---|---|
| O‑01 | Carga inicial de la contabilidad | ─────► | `305` Carga Inicial | ✔ 5 usos (Acomsa, LBY) |
| O‑02 | Banco temporal de la carga inicial | ─────► | `101.99` Banco Temporal para Carga Inicial | ○ sin precedente |
| O‑03 | Capital suscrito y pagado | ─────► | `301` | ○ sin precedente |
| O‑04 | Reserva legal | ─────► | `302` | ○ sin precedente |
| O‑05 | Resultados acumulados / del período | ─────► | `303` / `304` | ○ sin precedente |
| O‑06 | Aportes para futura capitalización | ─────► | `230.04` | ○ sin precedente |
| O‑07 | Ajuste de períodos anteriores | ─────► | `802.07` Ajustes periodos anteriores | ○ sin precedente |
| O‑08 | Provisiones no admitidas | ─────► | `802.06` | ○ sin precedente |
| O‑09 | Inversiones (acciones, certificados, bonos) | ─────► | `140.01` / `140.02` / `140.03` | ○ sin precedente |
| O‑10 | Reembolso a accionistas | ─────► | `203.02` Reembolso accionistas | ○ sin precedente |
| O‑11 | Reposición de caja chica | ─────► | `203.01` Caja Chica (pasivo) contra `101.03` | ○ sin precedente |

---

## 17. Las sugerencias automáticas y a qué caso llega cada una

El sistema siembra trabajo solo. Esta tabla dice qué produce cada detector y en qué caso
de este documento cae:

| Detector | Qué siembra | ─────► | Caso |
|---|---|---|---|
| `sugerir-cargos.sh` | comisiones, 2×1000, manejo de cuenta, retención est. cta., sobregiro, intereses | ─────► | F‑A, F‑B |
| `sugerir-cargos.sh` | capitalización de intereses, créditos por pago total, reversos | ─────► | G‑01, G‑03, G‑05 |
| `sugerir-transferencias.sh` | pares de patas con la misma referencia bancaria | ─────► | M‑08 |
| `sugerir-asignacion.sh` | movimiento de salida ↔ facturas abiertas de ADM | ─────► | D‑01, D‑03 |
| `sugerir-notas-debito.sh` | notas de débito **no registradas** en ADM | ─────► | J‑05 (préstamo / línea de crédito) |
| `sugerir-notas-debito.sh` | notas de débito registradas con beneficiario fiscal | ─────► | falta el **volante**, sólo adjuntar |
| `sugerir-recurrentes.sh` | facturas mensuales que no llegaron (Humano, Claro, Account One) | ─────► | A‑05, A‑06, A‑07 |
| `sugerir-anticipo-isr.sh` | la cuota del mes con el asiento precargado | ─────► | H‑01 paso 2 |
| Caso (`tipo='caso'`) | hilo con varias entradas que se explican entre sí | ─────► | Familia M completa |

**Ninguna sugerencia se registra sola.** Aprobar en la mesa es lo que dispara el
registro; nómina y cualquier documento que toque `611.x`, `210.04`–`210.10` o `220.x`
tiene **guarda humana permanente**.

---

## 18. Casos que NO existen todavía en los libros (inventario para el auditor)

### 18.a · Verificado — cero movimientos en TODOS los tipos de documento

Barrido sobre los espejos completos (`vendor-bills`, `journals`, `account-payments`,
`bill-payments`, `bank-charges`, `bank-transfers`, `vendor-credit-notes`), corte
2026‑08‑02. Estas cuentas existen en el plan y **no aparecen en un solo renglón**:

| Cuenta | Nombre | Caso de este documento |
|---|---|---|
| `150.05` | Avance a proveedores | D‑04 |
| `160.01` | Terrenos | K‑02 |
| `160.08` | Mejoras en Propiedad Arrendada | B‑04 |
| `180.01` | Fianzas & Depósitos (garantías **entregadas**) | M‑02 (trampa del espejo) |
| `210.05` | Retencion ISR 27% (Exterior) | H‑04 |
| `210.06` | Retencion IRS 10% Proveedores | **H‑04, H‑05 (arrendamiento)** |
| `210.07` | Retencion ISR 2% Proveedores | H‑04 |
| `225.01` | Línea de Crédito Santa Cruz | J‑01 |
| `411.16` | **Renta Inmuebles** | L‑04, M‑02 |
| `511.05` | Tasa por Servicio Aduanero | ⚠ hallazgo 6 |
| `511.06` | Formularios (Dua) | ⚠ hallazgo 6 |
| `690.04` | Impuestos No Adelantados | H‑06 |
| `802.02` | Intereses de Tarjetas de Crédito | F‑E |

`220.06` también salió con cero en el barrido, pero por fecha: se creó después del corte
y su uso arranca con CB00000258 (2026‑08‑07).

### 18.b · Probable — fuera del destilado de facturas, falta barrer asientos y pagos

Estas cuentas no figuran entre las 48 que el destilado del histórico de **facturas**
identifica en uso. Ese destilado no cubre asientos ni pagos, así que **el barrido queda
pendiente** antes de afirmar que están vírgenes:

| Cuenta | Nombre | Caso | Cómo confirmarlo |
|---|---|---|---|
| `101.99` | Banco Temporal Carga Inicial | O‑02 | barrer `journals-detalle` |
| `110`, `110.01`, `111`, `112.0x`, `125` | Cuentas por cobrar | L‑10 | `credit-invoices`, `cash-receipts` |
| `130.01` | Mercancía para la Venta | C‑03 | `journals-detalle` |
| `140.01`–`140.03` | Inversiones | O‑09 | `journals-detalle` |
| `150.07` | Saldo a favor ITBIS | H‑06 | `journals`, `account-payments` |
| `160.04`, `160.05`, `160.09` | Transporte / activos en proceso | B‑03, B‑05 | `vendor-bills`, `journals` |
| `170.02`–`170.08` | Depreciación Acumulada | K‑03 | `journals-detalle` |
| `203.01`, `203.02` | Caja Chica pasivo / Reembolso accionistas | O‑10, O‑11 | `journals`, `account-payments` |
| `210.12` | Contr de Residuos Sólidos | H‑06 | `journals`, `account-payments` |
| `220.02`–`220.05` | Bonificaciones, Incentivos, Seguros Retenidos, Cesantías | Familia I | `journals-detalle` |
| `230.04` | Aportes para futura capitalización | O‑06 | `journals-detalle` |
| `301`–`304` | Capital, reserva legal, resultados | O‑03 … O‑05 | `journals-detalle` |
| `411.97`–`411.99` | Descuentos y devoluciones en ventas | L‑06 … L‑08 | `credit-invoices`, `cash-receipts` |
| `611.03`, `611.05`–`611.07`, `611.15` | Vacaciones, horas extras, bonificación, regalía, cesantías | Familia I | `journals-detalle` |
| `620.01`, `620.02` | Alquileres | A‑23, A‑24, H‑05 | `vendor-bills-detalle` |
| `620.04` | Electricidad | A‑22 | `vendor-bills-detalle` |
| `620.08` | Propinas (distinta de `690.06` Propina Legal) | A‑03b | `vendor-bills-detalle` |
| `630.01`, `630.02`, `630.04` | Promociones, publicidad digital, viajes | A‑25, A‑26 | `vendor-bills-detalle` |
| `650.01`–`650.04` | Gasto de depreciación | K‑03 | `journals-detalle` |
| `690.01`, `690.02` | Impuesto sobre activos, residuos sólidos | H‑06 | `journals`, `account-payments` |
| `700.02`, `701.02`, `802.03` | Ganancia / venta / pérdida de activos fijos | K‑04 | `journals-detalle` |
| `802.05`–`802.07` | Intereses no deducibles, provisiones, ajustes | F‑E, O‑07, O‑08 | `journals-detalle` |
| *(sin código)* | **Adelanto de Clientes** | ⚠ hallazgo 1 | — |
| *(sin código)* | Adelantos Proveedores DOP / USD | D‑04 | `vendor-prepayments` |
| *(sin código)* | Diferencias por Redondeo | N‑04 | ✔ visto en PP00000353 |

El barrido de 18.b es una corrida de minutos sobre los mismos espejos; queda como tarea
antes de entregar el documento al auditor externo si se quiere el inventario cerrado.

---

## 19. Hallazgos para la auditoría

Cosas que este relevamiento encontró y que **no son criterio, son problema**:

1. **«Adelanto de Clientes» existe en el plan sin código contable.** Por eso todos los
   anticipos y pagos en error de clientes se están acumulando en `220.06` «Depósitos en
   Garantía por Renta», que semánticamente es otra cosa. Decisión explícita del contador
   (un solo pasivo de renta, la distinción vive en el detalle del asiento), pero el mayor
   mezcla garantías con anticipos y con devoluciones pendientes.
2. **Las tablas de amortización de los préstamos vivos no están cargadas.** Mientras
   falten, ninguna cuota mixta capital/interés se puede registrar automáticamente y todas
   pasan por decisión manual (J‑04).
3. **Dos criterios para la misma cuota de leasing** (FP00000977 vs FP01033): ITBIS como
   `TaxAmount` vs línea a `210.01`; seguro a `150.01` (activo) vs `660.01` (gasto).
4. **El cashback tiene doctrina y registro en desacuerdo** (`700.01` escrito vs `701.01`
   registrado), y ED00000183 quedó como diferencia eterna en la conciliación (G‑90).
5. **`130.02` Compras en Tránsito: 69 usos entrando y ningún traspaso a inventario
   identificado** en el material revisado (C‑03). Pendiente de barrido sobre asientos
   antes de darlo por confirmado.
6. **`511.05` Tasa por Servicio Aduanero y `511.06` Formularios (DUA) existen y no se
   usan:** esos conceptos se están mandando a `130.02` (C‑01). Puede ser correcto (costo
   de importación capitalizable) pero contradice la existencia de las cuentas de costo.
7. **No se identificó corrida de depreciación** (K‑03), con la misma salvedad del punto
   5: falta el barrido de asientos.
8. **`220.01` Nómina por Pagar acumula ~RD$609,000 sin liquidar** al corte (junio y julio
   sin pagos a empleados).
9. **ADM no frena documentos duplicados** y **revertir borra sin dejar lápida.** Hubo
   cuatro reversiones reales en una semana (FP00001131, FP00001132, NCP00000006,
   CB00000226) sin rastro en el libro.
10. **La retención del 2% de ITBIS de las adquirencias (Norma 06‑23) no tiene cuenta
    identificada.** Es pago a cuenta: si no se computa, se paga dos veces (L‑09).
11. **CB00000258 quedó archivado bajo «Bancos → Cargos Bancarios»** aunque su asiento es
    correcto (Dr `101.04` / Cr `220.06`). El vehículo documental de la doctrina H‑12 resuelve la
    conciliación pero deja el depósito de un inquilino en el módulo de cargos del banco.

---

## Anexo — Plan de cuentas completo de BlackBox SRL (215 cuentas)

Corte 2026‑08‑02, extraído de ADM Cloud. `[C]` = cuenta de caja.

### Activo

```
101      [C] Efectivo en Caja & Banco Pesos      160      Propiedad, Planta y Equipos
101.01   [C] Fondo Operaciones                   160.01   Terrenos
101.02   [C] Caja General                        160.02   Edificios (Apartamento San Gerónimo)
101.03   [C] Caja Chica                          160.03   Edificaciones / Naves industriales
101.04   [C] Banco Ingresos 801                  160.04   Equipos de Transporte Liviano
101.05   [C] Banco Impuestos 964                 160.05   Equipos de Transporte Pesado
101.06   [C] Banco Operaciones 874               160.06   Mobiliarios y Equipos de Oficina
101.99   [C] Banco Temporal Carga Inicial        160.07   Otros Activos Fijos
102      [C] Efectivo en Caja & Banco USD        160.08   Mejoras en Propiedad Arrendada
102.01   [C] Banco Suplidores USD 404            160.09   Activos en Proceso
102.02   [C] Banco Ganancia USD 181              170      Depreciacion Acumulada
110          Cuentas por Cobrar clientes DOP     170.02   Depr. Acum. Edificios
110.01       Cuentas por Cobrar DOP Auxiliar     170.03   Depr. Acum. Maquinarias
111          Cuentas por Cobrar clientes USD     170.04   Depr. Acum. Eq. Transporte Liviano
112          Cuentas por Cobrar Relacionados     170.05   Depr. Acum. Eq. Transporte Pesado
112.01       Cuentas por Cobrar Accionistas      170.06   Depr. Acum. Mobiliario y Eq. Oficina
112.02       Cuentas por Cobrar Empleados        170.07   Depr. Acum. Otros Activos Fijos
112.03       Cuentas por Cobrar Planchas         170.08   Amort. Mejoras en Prop. Arrendada
125          Otras cuentas por cobrar            180      Otros Activos
130          Inventarios                         180.01   Fianzas & Depositos
130.01       Mercancía para la Venta             150      Gastos pagados por anticipado
130.02       Compras en Tránsito                 150.01   Seguros
140          Inversiones                         150.02   Anticipos ISR
140.01       Acciones en otras Compañía          150.03   Otros Créditos de ISR
140.02       Certificados Financieros            150.04   ITBIS Adelantado
140.03       Bonos                               150.05   Avance a proveedores
                                                 150.06   Retencion DGII 1% Norma 07-19
(sin código) Adelantos Proveedores DOP / USD     150.07   Saldo a favor ITBIS
```

### Pasivo

```
201      Cuentas por Pagar DOP              210.06   Retencion IRS 10% Proveedores
202      Cuentas por Pagar USD              210.07   Retencion ISR 2% Proveedores
203      Reposiciones Por Pagar             210.08   Retencion TSS Empleados
203.01   Caja Chica                         210.09   Aporte TSS Empleador
203.02   Reembolso accionistas              210.1    Aporte INFOTEP
203.10   Tarjeta Corporativa 877            210.10   Impuesto Sobre la Renta anual
203.11   Tarjeta Corporativa 414            210.11   Anticipos ISR por Pagar
210      Acumulaciones e Impuestos          210.12   Contr de Residuos Sólidos
210.01   Itbis Operativo                    220      Otros Pasivos
210.02   Retencion 100% Itbis               220.01   Nómina por Pagar
210.03   Retencion 30% Itbis                220.02   Bonificaciones por Pagar
210.04   Retencion ISR Empleados            220.03   Incentivos por Pagar
210.05   Retencion ISR 27% (Exterior)       220.04   Seguros Retenidos
                                            220.05   Preavisos y Cesantias por Pagar
225      Pasivos Corto Plazo                220.06   Depósitos en Garantía por Renta *
225.01   Línea de Crédito Santa Cruz        230      Pasivos a Largo Plazo
230.01   Préstamo Hipotecario (San Gerónimo) 230.02  Prestamo Y No. 00003
230.03   Leasing 247355SDO071A              230.04   Aportes para futura capitalización
230.05   Prestamo BSC 0851

(sin código) Adelanto de Clientes · Cuentas por Pagar Proveedores DOP / USD
```

\* `220.06` se creó después del corte del espejo; su uso empieza con CB00000258
(2026‑08‑07).

### Capital · Ingresos · Costos

```
300  Capital                          411     Ingresos Operativos        511     Costos Operativos
301  Capital Suscrito & Pagado        411.01  Módulos Eléctricos         511.01  Costos mercancía p/ venta
302  Reserva Legal                    411.02  Cintas Luminarias          511.02  Costos tipo 2
303  Resultados Acumulados            411.03  Power Supply               511.03  Costos tipo 3
304  Resultados del Periodo           411.04  Trims                      511.04  Fletes
305  Carga Inicial                    411.06  Electronica                511.05  Tasa por Servicio Aduanero
                                      411.07  Frascos                    511.06  Formularios (Dua)
                                      411.08  Aceites Esenciales         511.07  Comision Servicios Generales
                                      411.09  Gastable y Misceláneos
                                      411.15  Servicios Generales
                                      411.16  Renta Inmuebles
                                      411.90  Transporte
                                      411.97  Descuentos en ventas
                                      411.98  Devoluciones en ventas
                                      411.99  Descuentos en Cobros
```

### Gastos

```
611     Gastos de Personal              620     Gastos Generales & Admin.     650     Gastos Activos Fijos
611.01  Sueldos                         620.01  Alquiler de Inmuebles         650.01  Depr. Acum. Edificios
611.02  Comisiones                      620.02  Alquiler de equipos           650.02  Depr. Acum. Otros Activos
611.03  Vacaciones                      620.03  Mantenimientos generales      650.03  Depr. Acum. Eq. Transporte
611.04  Incentivos                      620.04  Electricidad                  650.04  Depr. Acum. Mobiliario y Eq.
611.05  Horas Extras                    620.05  Comunicación                  650.05  Amort. Bienes intangibles
611.06  Bonificacion                    620.06  Suministros de oficina        650.06  Rep. y Mant. Edificios
611.07  Regalia                         620.07  Servicios de Limpieza         650.07  Rep. y Mant. Maquinaria
611.08  Aportes SFS                     620.08  Propinas                      650.08  Rep. y Mant. Eq. Transporte
611.09  Aportes AFP                     620.09  Gasto de ISC                  650.09  Rep. y Mant. Mobiliario
611.1   Aporte Riesgo Laboral           620.10  Envios y Correspondencias     660     Gastos Seguros
611.11  Aporte Infotep                  620.11  Combustible                   660.01  Seguros de Vehículos
611.12  Uniformes                       620.12  Gastos de Software            690     Gastos de Impuestos
611.13  Capacitación                    621     Honorarios Profesionales      690.01  Gasto Impuesto sobre Activos
611.14  Otros gastos de personal        621.01  Servicios Contables           690.02  Gasto Residuos Solidos
611.15  Preavisos y Cesantias           621.02  Servcios Legales              690.03  Itbis llevado al costo
611.16  Transporte y otros              621.03  Servicios Tecnicos            690.04  Impuestos No Adelantados
611.17  Dieta y Viáticos                621.04  Otros servicios profesionales 690.05  Otros Impuestos
611.18  Seguro Medico                   630     Gastos De Mercadeo y Ventas   690.06  Propina Legal
611.19  Dieta y Viáticos (Bien)         630.01  Promociones                   640     Gastos Financieros
                                        630.02  Publicidad Digital            640.01  Cargos Bancarios
(sin código) Diferencias por Redondeo   630.03  Publicidad Medios Tradic.     640.02  Cargos sobre cheques 0.15
                                        630.04  Gastos de Viaje               640.03  Cargos manejadoras tarjetas
                                        630.05  Gastos de Representación
                                        630.06  Manejo de Redes Sociales
```

### No operacionales

```
700     Ingresos no operacionales        800     Gastos no operacionales
700.01  Intereses Bancarios              801     Gastos no admitidos
700.02  Ganancia en Venta de Activos     801.01  Gastos sin comprobante de crédito fiscal
700.03  Ingreso por diferencia cambiaria 801.02  Gastos personales no deduccibles
701     Ingresos Extraordinarios         801.03  Gastos Impuestos
701.01  Ingresos Menores                 801.04  Recargo e Intereses
701.02  Venta de activos fijos           802     Otros gastos no operacionales
                                         802.01  Intereses de Préstamos
900     Impuesto Sobre Renta-ISR         802.02  Intereses de Tarjetas de Crédito
900.01  Gasto de Impuesto sobre la renta 802.03  Pérdida en Venta de Activos
                                         802.04  Gasto por diferencia cambiaria
                                         802.05  Gastos de intereses no deduccibles
                                         802.06  Provisiones no admitidas
                                         802.07  Ajustes periodos anteriores
```

---

## Anexo B — Catálogo de tipo de gasto 606 (uno por documento)

| Código | Nombre |
|---|---|
| 01 | Gastos de Personal |
| 02 | Gastos por Trabajos, Suministros y Servicios |
| 03 | Arrendamientos |
| 04 | Gastos de Activo Fijo |
| 05 | Gastos de Representación |
| 06 | Otras Deducciones Admitidas |
| 07 | Gastos Financieros |
| 08 | Gastos Extraordinarios |
| 09 | Compras y Gastos que Formarán parte del Costo de Venta |
| 10 | Adquisición de Activos |
| 11 | Gastos de Seguros |

40 suplidores tienen tipo de gasto citable por precedente (≥3 facturas) y cubren el 85%
de las facturas del histórico.

---

## Anexo C — Cómo verificar cada afirmación de este documento

| Qué | Dónde |
|---|---|
| Principios de asiento (P‑001 … P‑005) | `nucleo-contable/doctrina/principios-de-asiento.md` |
| Hecho → asiento — **doctrina** H‑01 … H‑12 | `nucleo-contable/doctrina/conciliacion-hechos.md` |
| Cuentas en uso con evidencia | `nucleo-contable/doctrina/cuentas-en-uso.md` |
| Ciclo del anticipo de ISR | `nucleo-contable/doctrina/pagos-a-cuenta.md` |
| Retenciones ISR e ITBIS | `nucleo-contable/dgii/normas/retenciones-*.md` |
| Criterios de la empresa (C‑001, C‑002) | `empresas/blackbox/hermes/memoria/criterios.md` |
| Tratamiento por proveedor (165 proveedores) | `empresas/blackbox/hermes/memoria/proveedores.md` |
| Patrón de nómina | `empresas/blackbox/hermes/memoria/nomina.md` |
| Cada decisión registrada, una por archivo | `empresas/blackbox/hermes/libro-de-accion/` |
| Mapa banco → cuenta contable | `mapa-cuentas.yaml` |
| Espejo del histórico real de ADM | `preentrenamiento/raw/*.jsonl` (en CodeBox) |
