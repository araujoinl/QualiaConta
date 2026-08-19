---
name: conciliar-banco-adm
description: "Cruza banco contra ADM Cloud para hallar lo no conciliado."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [Contabilidad, Conciliación, Banco, ADM Cloud, OpenBanking]
prerequisites:
  env: [OPENBANKING_DSN, ADMCLOUD_COMPANY, ADMCLOUD_USER, ADMCLOUD_PASSWORD, ADMCLOUD_ROLE, ADMCLOUD_APPID]
  commands: [psql]
---

# Conciliar Banco vs ADM Cloud

Compara dos fuentes de verdad — los movimientos reales del banco (Supabase) y
los registros contables de ADM Cloud — para identificar qué hay en cada lado
que no aparece en el otro.

## De qué fuentes comparar

**Banco (Supabase):** `openbanking_transactions` — movimientos reales con signo.
Ver skill `consultar-banco` para detalles.

**ADM Cloud — INGRESOS:** cuando el usuario pida conciliar **entradas de dinero**,
hay TRES tipos de documentos que representan entradas reales de plata:

| Tipo | Recurso ADM | Qué es |
|---|---|---|
| Venta de Contado | `CashInvoices` | Factura cobrada al momento — entró dinero ya |
| Recibo de Cuentas por Cobrar | `CashReceipts` | Cobro de una factura a crédito que se había emitido antes |
| Transferencia entre Cuentas | `BankBankTransfers` (lado entrada) | Mover plata entre cuentas propias — SÍ es entrada válida |

**⚠️ NO confundir ingresos con facturas a crédito.** Las `CreditInvoices`
(facturas a crédito) NO son entradas de dinero — son documentos de venta que se
cobran meses después. Mezclarlas con entradas bancarias produce un cruce sin
sentido y el usuario lo va a rechazar. Esto se corrigió en sesión real: el
agente incluyó 69 facturas a crédito como "ingresos" y el usuario dijo "estás
confundiendo ingresos con facturas".

**⚠️ Los 3 tipos son obligatorios.** Usar solo uno (ej: solo CashReceipts)
produce falsos "no conciliados". El usuario lo corrigió explícitamente: "son 3
— ventas de contado, recibos de CxC y transferencias entre cuentas".

**ADM Cloud — EGRESOS:** el grueso de los egresos del banco corresponde a:

| Tipo ADM | Recurso | Signo | Equivalente banco |
|---|---|---|---|
| Facturas de gasto | `VendorBills` | positivo (gasto) | débito (negativo) |
| Pagos a factura | `BillPayments` | negativo (egreso) | débito (negativo) |
| Pagos a cuenta | `AccountPayments` | negativo (egreso) | débito (negativo) |
| Cargos bancarios | `BankCharges` | negativo (egreso) | débito (negativo) |
| Transferencias | `BankBankTransfers` | negativo salida / positivo entrada | débito/crédito |

**Lección clave (egresos):** incluir **VendorBills (gastos)** como fuente
principal, no solo los pagos y documentos bancarios formales. El primer intento
usó solo BillPayments/BankCharges/Transfers y casi todo el banco quedó "sin
conciliar".

**Lección clave (ingresos):** los 3 tipos (Contado + CxC + Transferencias)
son obligatorios. No usar solo CashReceipts.

## Tarjetas de crédito — Caso especial

Algunos pagos de clientes llegan vía tarjeta de crédito. En el banco aparecen:

```
Por Transferencia Ach-Ach Recibida: Servicios Digita - 39656020001
```

**El monto del banco ya tiene descontada la comisión del 5.395%.** Para
conciliar, hay que revertir al monto original:

```
monto_original = monto_banco / (1 - 0.05395)
```

Ejemplo: banco=6,663.31 → original=7,043.30 → ADM=7,043.29.

**No se puede conciliar por nombre** porque el banco dice "Servicios Digita"
y ADM dice el nombre real del cliente. Por eso las tarjetas se cruzan solo por
monto original + fecha, en rondas separadas (6-8) después de las normales.

Esto se corrigió en sesión real: el usuario dijo "ahora debes discriminar las
que son tarjeta de crédito — vienen como Servicios Digita y ese monto tiene
restado el 5.395%".

## Mapeo de cuentas

Para Blackbox SRL, las cuentas de ADM Cloud mapean a los números de cuenta del
banco así (verificar antes de cada conciliación; puede cambiar):

| ADM Cloud | Banco Santa Cruz | Moneda |
|---|---|---|
| Banco Ingresos 801 | 11121000000801 | DOP |
| Banco Impuestos 964 | 11122010014964 | DOP |
| Banco Operaciones 874 | 11122010023874 | DOP |
| Banco Suplidores USD 404 | 21122020001404 | USD |
| Banco Ganancia USD 181 | 21122020002181 | USD |

**⚠️ La cuenta Ahorro General (11122010025676) NO es de Blackbox** — pertenece
a Impact Logistics. Excluirla de cualquier análisis de Blackbox. Esto se
corrigió en sesión real: se incluyó por error y el usuario lo detectó.

**Transferencias entre cuentas propias:** SÍ deben incluirse como entradas
válidas en el análisis. El usuario confirmó explícitamente que las
transferencias entre cuentas Blackbox son entradas legítimas.

## Algoritmo de cruce

### Preparación

1. **Filtrar por período** en ambas fuentes (ej: `DocDate >= '2026-07-01'`).
2. **Filtrar por empresa/cuentas** — solo cuentas de la empresa pedida. Usar
   `credential_ref` en `openbanking_accounts` para identificar la empresa. Ver
   `references/mapa-empresas-cuentas.md` para el mapa completo de cuentas por
   empresa (Blackbox, Impact Logistics, Perfume Labs, Erick).
3. **Separar ingresos de egresos**:
   - Banco: `monto > 0` = crédito, `monto < 0` = débito.
   - ADM: cobros (CashReceipts + CashInvoices + Transferencias lado entrada)
     vs gastos (VendorBills, BillPayments, etc.).
4. **Normalizar nombres** de clientes para usar como pista de matching (ver
   abajo).

### ⚠️ El cruce DEBE ser por rondas (no single-pass)

Un solo pase greedy **produce matches equivocados**. Esto pasó en sesión real:
un recibo de 194,051 (Letrax) se matchéó con una transferencia de 195,000 del
mismo banco porque el algoritmo single-pass lo encontró primero (fecha más
cercana). El recibo correcto de 194,051 del banco nunca tuvo oportunidad.

**Algoritmo correcto — 8 rondas por prioridad (5 normales + 3 tarjetas):**

```
Ronda 1: monto EXACTO (diff < 0.50 DOP) + mismo cliente + fecha ±10 días
Ronda 2: monto EXACTO (diff < 0.50 DOP) + sin nombre + fecha ±7 días
Ronda 3: monto cercano (< 0.5%) + mismo cliente + fecha ±7 días
Ronda 4: monto cercano (< 0.5%) + sin nombre + fecha ±5 días
Ronda 5: monto fuzzy (< 1%) + mismo cliente + fecha ±5 días
--- tarjetas (monto original revertido, sin nombre) ---
Ronda 6: monto original exacto (< 1.00 DOP diff) + fecha ±10 días
Ronda 7: monto original cercano (< 0.5%) + fecha ±7 días
Ronda 8: monto original fuzzy (< 1%) + fecha ±5 días
```

Cada ronda marca como usados los pares que matchéa. Las rondas siguientes solo
ven lo que quedó libre. Así los matches exactos con nombre correcto se
resuelven primero, y los fuzzy solo se usan cuando no quedó opción mejor.

Las rondas 6-8 solo aplican a transacciones de tarjeta (detectadas por
"Servicios Digita" en la descripción). Usan el monto original con la comisión
revertida.

### Normalización de nombres

Los nombres del banco y de ADM NO son exactos. Hay que normalizar antes de
comparar:

```python
def normalize_name(name):
    # 1. Quitar tildes (NFD + ascii ignore)
    # 2. Lowercase
    # 3. Quitar sufijos legales: s.a., srl, sas, sa, corp, inc, ltda
    # 4. Quitar palabras del banco: transferencia, recibida, de, env, dev, fen, ach, comision
    # 5. Quitar números
    # 6. Limpiar espacios
```

Después, comparar si uno contiene al otro o si comparten palabras distintivas
(largo > 2 chars). Ver `scripts/match-algorithm.py` para la implementación
completa y reutilizable.

5. **Reportar tres categorías**: conciliados, en banco sin ADM, en ADM sin banco.

## Generar el Excel

Usar openpyxl. Si no está instalado, crear venv: `uv venv /tmp/venv && uv pip
install openpyxl`. Ejecutar con `/tmp/venv/bin/python3`.

**Script standalone**: `scripts/conciliar-entradas.py` hace todo el proceso
(descarga Supabase + ADM, cruza con 8 rondas incluyendo tarjetas, genera Excel
+ JSON) en un solo comando. Se puede correr directamente desde la CLI del
usuario sin consumir tokens del agente:

```bash
/tmp/venv/bin/python3 /opt/data/skills/conciliar-banco-adm/scripts/conciliar-entradas.py 2026-07
```

Acepta mes (`2026-07`) o rango (`2026-06 2026-07`). Sin argumentos usa el mes
actual.

El Excel debe tener 4 hojas:
1. **Resumen** — totales por categoría, por cuenta, notas con código de color.
2. **En Banco NO en ADM** (amarillo) — transacciones del banco sin match.
3. **En ADM NO en Banco** (naranja) — registros de ADM sin match en banco.
4. **Conciliados** (verde) — pares banco↔ADM que coincidieron.

## Problemas conocidos de ADM Cloud API

- **BankBankTransfers devuelve anidado** en `{success, message, data: {Item1:
  [...], Item2: ...}}`. El script `admcloud-get.sh` no desenvuelve `Item1`
  dentro de `data`. Solución: llamar la API directo y extraer
  `raw['data']['Item1']`.
- **GET por ID no funciona con el script** — devuelve la lista completa. Para
  obtener detalle (líneas, asiento), llamar directo:
  `GET /api/{Recurso}/{ID}?company=...&role=...&appid=...`.
- Ver skill `consultar-admcloud` para más detalles de la API.

## El script es SÓLO LECTURA — aclararlo si hay duda

El script de conciliación **descarga datos de ADM Cloud y del banco, los compara
en memoria, y produce un Excel**. No escribe, no registra, no anula, no crea ni
modifica nada en ADM Cloud. Es imposible que el script altere el libro contable.

El usuario puede sospechar lo contrario si después de correr la conciliación
nota algo raro en ADM Cloud (ej: "muchos clientes 2025 están sin conciliar",
"aparecieron facturas nuevas"). En esos casos:

1. **Aclarar de una vez:** el script no toca ADM Cloud, es sólo lectura.
2. **Investigar el problema real** — probablemente es algo que ya estaba así y
   la conciliación simplemente lo hizo visible. Ver skill `analizar-cxc-adm`.

## Al responder

- Decir siempre qué fuentes se compararon y qué período.
- Si la mayoría del banco queda "sin conciliado", revisar si faltan fuentes de
  ADM (probablemente VendorBills o CashReceipts).
- Entregar el Excel como archivo adjunto (`MEDIA:/ruta/al/archivo.xlsx`).

## Qué hacer con lo NO conciliado — la doctrina manda

Esta skill ENCUENTRA las diferencias; ASENTARLAS es otra decisión, y la
gobierna la doctrina contable ratificada:
`/nucleo-contable/doctrina/INDEX.md` (2026-08-07).

- **P-001**: el asiento nace de lo ASENTADO en ADM — antes de proponer una
  partida que usa o cancela un saldo, verificá por SQL que ese saldo existe y
  citá lo que encontraste. Diez propuestas del Caso #1 murieron por debitar un
  pasivo que nunca se registró.
- **P-002**: un reverso o devolución usa la MISMA cuenta de su movimiento
  original; sin original atado, se pregunta.
- **Un par «Devuelta» NO se da por cerrado sin restarlo primero (H-13).** El
  cruce de reversos empareja por referencia citada aunque los montos difieran,
  porque al devolver una transferencia el banco se queda la comisión. Así que
  para CADA movimiento con `reverso_monto`, la resta es obligatoria:
  `|monto| − |reverso_monto|`. Si da cero, el par se anula y no hay nada que
  asentar. **Si da distinto de cero, esa diferencia es plata que el banco se
  quedó y que no tiene línea propia en el estado de cuenta**: se asienta sola,
  como cargo bancario, con `Reference` = el `banco_tx_id` del RETORNO. El
  resumen del reporte los cuenta como «se anulan con su reverso» y ahí ese neto
  no aparece — no alcanza con leer el resumen. Mientras H-13 no esté ratificada,
  se detecta, se dejan los números y se PREGUNTA.
- **P-003**: jerarquía — ADM real → doctrina → precedente → la DGII SOLO para
  el eje fiscal. La DGII jamás elige la cuenta ni el documento.
- El tratamiento por situación (cargos, excedentes de clientes, garantías,
  cuotas de préstamo…) está en `doctrina/conciliacion-hechos.md` (H-01..H-13).
  Un hecho marcado **ABIERTO** se pregunta citándolo, nunca se adivina.
