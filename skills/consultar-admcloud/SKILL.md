---
name: consultar-admcloud
description: "Consulta el libro contable de la empresa en ADM Cloud: artículos, existencias, clientes, ventas, facturas y cuentas por cobrar. Sólo lectura."
version: 1.0.0
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

**Sólo lectura.** No hay operación de escritura en esta skill y no debes
improvisar una. Si te piden registrar algo, di que todavía no está habilitado.

## Cómo consultar

Usa el script incluido. Recibe el recurso y, opcionalmente, filtros extra:

```bash
scripts/admcloud-get.sh Items "skip=0&OnlyActive=true"
scripts/admcloud-get.sh Customers
scripts/admcloud-get.sh Items/ABC123
```

Devuelve JSON por salida estándar. Las credenciales las toma del entorno; no
las escribas en ningún lado ni las muestres en tus respuestas.

## Recursos que responden

| Recurso | Qué trae |
|---|---|
| `Items` | Catálogo de artículos. Acepta `skip` y `OnlyActive` |
| `Items/{id}` | Detalle de un artículo |
| `Stock` | Existencias |
| `Customers` | Clientes |
| `Sales/Detailed` | Ventas con detalle |
| `CreditInvoices` | Facturas a crédito |
| `CashInvoices` | Facturas al contado |
| `CashReceipts` | Recibos de caja |
| `AR` | Cuentas por cobrar |

Si necesitas algo que no está en esta lista —compras, asientos, catálogo de
cuentas, proveedores— **no lo inventes**. Prueba el recurso y, si responde,
avisa que encontraste uno nuevo para agregarlo acá.

## La paginación ya está resuelta

La API devuelve **50 filas por página**. El script recorre todas las páginas
solo y te entrega el conjunto completo, así que un conteo sale correcto sin que
tengas que acordarte de nada.

No lo hagas a mano. Si por algo llamas la API directo y traes una sola página,
un total de 50 no es un total: es donde se cortó.

Lee siempre la línea final que imprime el script:

- `(1834 fila(s) desde Customers, 37 página(s), completo)` — podés dar el total.
- `(⚠ … SE CORTÓ en el tope; hay más)` — hay más de 10.000 filas. Decí "más de
  X", nunca el número como total.

Si necesitás una página puntual, pasá el `skip` vos y el script respeta esa
página sola:

```bash
scripts/admcloud-get.sh Customers "skip=50"
```

## La respuesta no tiene forma fija

Según el recurso, ADM Cloud devuelve un arreglo pelado o un objeto que envuelve
el arreglo bajo `Data`, `data`, `Items` o `items`. El script ya desenvuelve por
ti y siempre entrega un arreglo.

Importa saberlo porque, si algún día llamas la API directo sin el script,
asumir una forma fija te va a devolver una lista vacía que parece "no hay
datos" cuando en realidad sí los hay.

## Al responder con estos datos

Di siempre **qué consultaste** para llegar al número: el recurso y los filtros.
Quien pregunta tiene que poder verificarte.

Si la consulta devuelve vacío, dilo como vacío. No lo interpretes como cero
pesos ni como que la operación no existe — puede ser un filtro mal puesto.

## Errores

- **401** — el `role` o el `appid` están mal, casi nunca la contraseña.
- **403** — el rol no tiene permiso para ese recurso. Es esperable: el contable
  corre con un rol recortado a propósito. Dilo, no busques la vuelta.
- **Vacío con HTTP 200** — filtro demasiado estrecho, o el recurso usa otro
  nombre de parámetro.
