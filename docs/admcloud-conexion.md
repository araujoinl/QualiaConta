# Conexión a ADM Cloud

Cómo se habla con la API. **Esto no sale de la documentación de ADM Cloud: sale
del cliente que Labs_Inv tiene corriendo en producción** (sus Edge Functions
`admcloud-*`). Está verificado contra la API real.

QualiaConta construye su propio cliente —así se decidió— pero sobre este patrón,
no sobre suposiciones.

## Autenticación

Basic auth, y tres parámetros que van en **toda** petición:

```
GET https://api.admcloud.net/api/<recurso>?company=<CODIGO>&role=<ROL>&appid=<APPID>
Authorization: Basic base64(<USUARIO>:<CONTRASEÑA>)
Accept: application/json
```

Los tres parámetros se codifican para URL. Los cinco valores son exactamente los
campos de la pantalla "Editar Empresa" de ADM Cloud:

| Pantalla de ADM Cloud | Parámetro | Variable en el `.env` |
|---|---|---|
| Código (company UUID) | `company` | `ADMCLOUD_COMPANY` |
| Rol | `role` | `ADMCLOUD_ROLE` |
| App ID | `appid` | `ADMCLOUD_APPID` |
| Usuario API | usuario del Basic | `ADMCLOUD_USER` |
| Contraseña API | contraseña del Basic | `ADMCLOUD_PASSWORD` |

**El `role` es el control de seguridad de todo el proyecto.** No es una etiqueta:
viaja en cada llamada y el servidor de ADM Cloud decide qué se puede hacer con
él. Por eso el contable va con rol `Contabilidad` recortado y nunca con
`Administradores` — ver [SPEC §5](../SPEC.md).

## Endpoints en uso comprobado

Los que Labs_Inv ya llama y sabemos que responden:

| Endpoint | Qué trae |
|---|---|
| `/api/Items` | Catálogo de artículos. Acepta `skip` y `OnlyActive` |
| `/api/Items/{id}` | Detalle de un artículo |
| `/api/Stock` | Existencias |
| `/api/Customers` | Clientes |
| `/api/Sales/Detailed` | Ventas con detalle |
| `/api/CreditInvoices` | Facturas a crédito |
| `/api/CashInvoices` | Facturas al contado |
| `/api/CashReceipts` | Recibos de caja |
| `/api/AR` | Cuentas por cobrar |

Falta descubrir lo que el contable necesita y no está acá: compras, asientos,
catálogo de cuentas, proveedores. Es lo primero a explorar con el
[explorador de API](https://apiexplorer.admcloud.net) cuando arranque la
entrega 2.

## La respuesta no tiene forma fija

El detalle que sólo se aprende usándola: **según el endpoint, la respuesta llega
como arreglo pelado o envuelta en un objeto**, y la llave del envoltorio cambia
—`Data`, `data`, `Items`, `items`.

Labs_Inv lo resuelve con una cascada: si no es arreglo, prueba las llaves
conocidas, y si ninguna sirve, recorre los valores del objeto y se queda con el
primer arreglo no vacío.

Cualquier cliente que se escriba acá tiene que hacer lo mismo. Asumir una forma
fija funciona hasta que se cambia de endpoint y ahí falla en silencio, con una
lista vacía que parece "no hay datos".

## Errores

Si la respuesta no es `ok`, leer el cuerpo como texto —no como JSON, porque el
error puede no serlo— y propagar el código de estado. Un 401 casi siempre es el
`role` o el `appid` mal puestos, no la contraseña.

## Paginación

`skip=0` como punto de partida. Los endpoints de listado la aceptan; falta
confirmar si hay un tope de página y cómo se pide la siguiente.

## Lo que falta verificar

- Si existe el acceso SQL de sólo lectura que ofrece la documentación. Labs_Inv
  **no lo usa** —va todo por API—, así que está sin comprobar.
- El tamaño de página y cómo se pide la siguiente.
- Los endpoints de compras y contabilidad, que son los que el contable necesita
  para registrar.
