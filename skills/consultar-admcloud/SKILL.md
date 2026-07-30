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

## La página es de 50 — cuidado con contar

La mayoría de los recursos devuelve **50 filas por página**. Eso no es la
cantidad total: es donde se cortó.

Verificado: `Items`, `Stock`, `Customers`, `CreditInvoices`, `CashInvoices` y
`CashReceipts` devuelven 50 de entrada. `Sales/Detailed` devolvió 1500 y `AR`
132, así que el tope no es igual en todos.

**Nunca respondas "tenés 50 clientes" a partir de una sola llamada.** Si te
preguntan una cantidad o un total, tenés que recorrer las páginas subiendo
`skip` hasta que una vuelva vacía o con menos filas que la anterior:

```bash
scripts/admcloud-get.sh Customers "skip=0"
scripts/admcloud-get.sh Customers "skip=50"
scripts/admcloud-get.sh Customers "skip=100"
```

Si no recorriste todas las páginas, dilo: *"al menos 50, hay más páginas"*. Un
total incompleto presentado como total es de los errores que nadie detecta.

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
