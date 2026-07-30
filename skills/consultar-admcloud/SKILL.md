---
name: consultar-admcloud
description: "Consulta el libro contable de la empresa en ADM Cloud: cuentas, asientos, conciliación bancaria, compras, proveedores, cuentas por pagar y cobrar, ventas, artículos y existencias. Sólo lectura."
version: 2.0.0
author: QualiaConta
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [Contabilidad, ADM Cloud, ERP, Consultas]
prerequisites:
  env: [ADMCLOUD_COMPANY, ADMCLOUD_USER, ADMCLOUD_PASSWORD, ADMCLOUD_ROLE, ADMCLOUD_APPID]
---

# Consultar ADM Cloud

ADM Cloud es el libro contable oficial de la empresa. Esta skill lee de ahí.

**Sólo lectura.** No hay operación de escritura acá y no debes improvisar una.
Si te piden registrar algo, di que todavía no está habilitado.

## Cómo consultar

```bash
scripts/admcloud-get.sh Accounts
scripts/admcloud-get.sh VendorBills
scripts/admcloud-get.sh Journals "skip=0"
scripts/admcloud-get.sh Items/12dfc431-0cee-43dc-662d-08dd65591e94
```

Devuelve JSON por salida estándar. Las credenciales salen del entorno; no las
escribas ni las muestres nunca.

## El catálogo completo de la API

**No memorices endpoints ni te quedes con la lista de abajo.** ADM Cloud publica
un índice pensado para que lo lea un agente:

```
https://apidocs.admcloud.net/llms.txt
```

Ahí está **cada** endpoint con su página de referencia propia, por ejemplo
`https://apidocs.admcloud.net/reference/bankreconciliations_get.md`.

Cuando te pidan algo que no sabés de dónde sale, el orden es: leer el índice,
encontrar el recurso, leer su referencia, y recién entonces llamarlo. Es mucho
más confiable que adivinar nombres — probando a mano se perdió `BankReconciliations`
tres veces por buscarlo en singular.

Sólo usa `_get` y los de consulta. Los `_post`, `_put`, `_delete` y `_void`
existen pero **no son para vos**: el rol de esta empresa está recortado y esas
llamadas van a fallar. Que fallen está bien, es el diseño.

## Verificado que responde en esta empresa

Contabilidad:

| Recurso | Qué trae |
|---|---|
| `Accounts` | Catálogo de cuentas contables, con tipo, clase y prefijo |
| `Journals` | Asientos (entradas de diario) |
| `AccountingPeriods` | Períodos contables |
| `BankReconciliations` | Conciliaciones bancarias |
| `BankCharges` | Cargos bancarios |

Compras y proveedores:

| Recurso | Qué trae |
|---|---|
| `Vendors` | Proveedores |
| `VendorBills` | Facturas de proveedor |
| `BillPayments` | Pagos a proveedores |
| `AccountPayments` | Pagos de cuentas |
| `AP` | Cuentas por pagar (detalle) |
| `PurchaseOrders` | Órdenes de compra (hoy vacío) |

Ventas y cobros:

| Recurso | Qué trae |
|---|---|
| `Customers` | Clientes |
| `Sales/Detailed` | Ventas con detalle |
| `CreditInvoices` · `CashInvoices` | Facturas a crédito y al contado |
| `CashReceipts` · `Collections` · `Deposits` | Recibos, cobros y depósitos |
| `AR` | Cuentas por cobrar (detalle) |

Inventario:

| Recurso | Qué trae |
|---|---|
| `Items` · `Items/{id}` | Artículos y su detalle |
| `Stock` | Existencias |

Existen pero hoy están vacíos: `Expenses`, `ExpensesCategories`, `Budgets`,
`FixedAssets`. Vacío no es error — significa que la empresa no usa ese módulo.

## La paginación ya está resuelta

La API devuelve **50 filas por página**. El script recorre todas las páginas
solo y entrega el conjunto completo, así que un conteo sale correcto sin que
tengas que acordarte de nada.

Lee siempre la última línea que imprime:

- `(190 fila(s) desde Customers, 4 página(s), completo)` — podés dar el total.
- `(⚠ … SE CORTÓ en el tope; hay más)` — decí "más de X", nunca el número como
  total.

Si necesitás una página puntual, pasá el `skip` y el script respeta esa sola:

```bash
scripts/admcloud-get.sh Customers "skip=50"
```

## La respuesta no tiene forma fija

Según el recurso, ADM Cloud devuelve un arreglo pelado o un objeto que lo
envuelve bajo `Data`, `data`, `Items` o `items`. El script ya desenvuelve.

Importa saberlo por si algún día llamás la API directo: asumir una forma fija te
va a devolver una lista vacía que parece "no hay datos" cuando sí los hay.

## Al responder con estos datos

Di siempre **qué consultaste**: el recurso y los filtros. Quien pregunta tiene
que poder verificarte.

Si la consulta vuelve vacía, dilo como vacía. No lo interpretes como cero pesos
ni como que la operación no existe — puede ser un filtro mal puesto o un módulo
que la empresa no usa.

## Errores

- **401 "Usuario o clave inválida"** — credenciales.
- **401 "no está vinculado a este grupo"** — el `role` no corresponde a un grupo
  del usuario.
- **403** — el rol no tiene permiso para ese recurso. Es esperable y correcto:
  corre recortado a propósito. Dilo, no busques la vuelta.
- **404** — el recurso no se llama así. Buscá el nombre exacto en el índice
  `llms.txt` antes de probar variantes a mano.
