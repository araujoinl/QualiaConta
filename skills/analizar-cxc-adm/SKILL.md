---
name: analizar-cxc-adm
description: "Analiza CxC en ADM Cloud: quién debe y por qué."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [Contabilidad, ADM Cloud, CxC, Cuentas por Cobrar, Análisis]
prerequisites:
  env: [ADMCLOUD_COMPANY, ADMCLOUD_USER, ADMCLOUD_PASSWORD, ADMCLOUD_ROLE, ADMCLOUD_APPID]
---

# Analizar Cuentas por Cobrar en ADM Cloud

Cuando alguien pregunta "¿por qué este cliente aparece debiendo?" o "¿quiénes
deben del 2025?", este es el flujo. No es conciliación bancaria — es análisis
puro de ADM Cloud.

## Los tres recursos que hay que cruzar

| Recurso | Qué te dice | Campo clave |
|---|---|---|
| `AR` | Quién debe HOY y desde cuándo (aging) | `Balance`, `DueDays`, `Aging_Tier` |
| `CreditInvoices` | Todas las facturas a crédito emitidas | `AppliedPayments` vs `TotalAmount` |
| `CashReceipts` | Los pagos recibidos y aplicados | `TotalAmount`, `DocDate` |

**`AR` es la fuente autoritativa para "quién debe".** Si una factura no aparece
en AR con `Balance > 0`, no se debe — sin importar lo que diga CreditInvoices.

**`CreditInvoices` te dice el detalle de cada factura:** si `AppliedPayments =
TotalAmount`, está pagada. Si `AppliedPayments < TotalAmount`, hay saldo.

**`CashReceipts` te dice si el pago existe:** a veces una factura aparece con
saldo porque el pago se registró pero no se aplicó a la factura correcta.

## Flujo de investigación

### Caso 1: "¿Por qué el cliente X aparece debiendo?"

1. **Descargar AR** y filtrar por el cliente. Si no hay registros con
   `Balance > 0`, el cliente NO debe — el problema es la pantalla que el usuario
   está viendo, no los datos.
2. **Si hay saldo en AR**, descargar `CreditInvoices` del cliente y buscar las
   facturas con `AppliedPayments < TotalAmount`.
3. **Para cada factura con saldo**, descargar `CashReceipts` del cliente y ver
   si hay un pago por el monto correcto que no se aplicó.

### Caso 2: "¿Quiénes deben del año Y?"

1. **Descargar AR** y filtrar por `DocDate` del año pedido.
2. **Filtrar `Balance > 0`** — eso son las facturas realmente pendientes.
3. **Agrupar por cliente** para ver el resumen.

**⚠️ No confundir facturas emitidas con facturas pendientes.** Un cliente puede
tener 90 facturas en CreditInvoices del 2025, pero si todas tienen
`AppliedPayments = TotalAmount`, no debe nada. El saldo vivo está en AR, no en
el historial de facturación.

### Caso 3: "El cliente pagó pero sigue apareciendo como deuda"

1. **Verificar en CashReceipts** si el pago existe (mismo cliente, monto, fecha).
2. **Verificar en CreditInvoices** si `AppliedPayments` refleja el pago.
3. Si el pago existe en CashReceipts pero `AppliedPayments` no lo refleja, el
   pago no se aplicó a la factura — es un problema de imputación en ADM Cloud
   (que no podemos arreglar desde acá, somos sólo lectura).

**Diagnósticos adicionales para pagos desvinculados:**

- **Campo `Reference` en CashReceipts:** si es `None`/null, el recibo no tiene
  referencia cruzada a la factura. Un usuario que dice "desapareció la
  referencia" probablemente ve esto en la UI: el pago existe pero no está
  imputado a una factura específica.
- **Recibos duplicados:** buscar pares con misma fecha + mismo monto
  (`Counter` sobre `(DocDate[:10], TotalAmount)`). Un duplicado sin anular
  (ambos `Void=False`) puede estar aplicado a facturas distintas y descuadrar.

### Caso 4: "La pantalla de ADM Cloud muestra datos que la API no devuelve"

**Esto pasa.** La API REST y la interfaz web de ADM Cloud pueden mostrar datos
diferentes para el mismo cliente y período. Señales:

- El usuario ve DocIDs cortos y numéricos (`00000216`, `00000223`) que **no
  existen** en la respuesta de la API (los DocIDs de la API usan prefijos:
  `FC00000728`, `RI00000429`, `FCC00000302`).
- Los montos que ve el usuario **no aparecen** en ningún registro de
  `CreditInvoices`, `CashInvoices`, ni `CashReceipts` para ese cliente.
- La cantidad de facturas que ve el usuario no coincide con el conteo de la API.

**Qué hacer cuando pasa:**

1. No asumas que el usuario está equivocado. Tampoco asumas que tu data está mal.
2. Confirma con datos duros: "tu pantalla muestra X con NCF Y; la API devuelve Z
   — son cosas diferentes".
3. Pide al usuario datos adicionales de la pantalla (NCF, DocID completo) para
   poder buscar el registro exacto en la API.
4. **Nunca atribuyas el cambio a algo que hiciste.** El agente es sólo lectura y
   no puede haber alterado ADM Cloud. Si algo cambió en el libro, lo cambió
   alguien con acceso de escritura a ADM Cloud, no el agente.

## Campos importantes

### AR (Cuentas por Cobrar)

- `Balance` — saldo pendiente (si es 0, no se debe)
- `DueDays` — días de vencido
- `Aging_Tier` — tramo de antigüedad
- `DocDate` — fecha del documento
- `ExpirationDate` — fecha de vencimiento
- `RelationshipName` — nombre del cliente
- `NCF` — comprobante fiscal

### CreditInvoices (Facturas a Crédito)

- `AppliedPayments` — monto pagado acumulado
- `TotalAmount` — total de la factura
- `Void` — si es True, la factura está anulada (no cuenta)
- `DocDate` — fecha de emisión
- `RelationshipName` — nombre del cliente

### CashReceipts (Recibos de Caja)

- `TotalAmount` — monto recibido
- `DocDate` — fecha del recibo
- `RelationshipName` — nombre del cliente
- `Void` — si es True, el recibo está anulado

## Cómo filtrar por cliente

Los nombres en ADM Cloud no son exactos. Para filtrar Likecorp, buscar
`'likecorp' in json.dumps(factura).lower()` en vez de un match exacto —
el nombre puede ser "Likecorp Srl", "LIKECORP S.R.L.", etc.

## Lección de sesión real

El usuario dijo: "por alguna razón a muchos clientes como Likecorp les aparecen
facturas ahora del 2025". La investigación mostró:

- Likecorp tiene 150 facturas en CreditInvoices (90 del 2025, 60 del 2026).
- **Las 90 del 2025 están todas pagadas** (AppliedPayments = TotalAmount, saldo
  0, no anuladas).
- Likecorp NO aparece en AR con facturas del 2025 — sólo del 2026.
- Las facturas 2025 con saldo real en AR eran de OTROS clientes (Toro Studio,
  Luces Industriales, Monumental, etc.), total ~DOP 165,455.

**Conclusión:** las facturas del 2025 siempre estuvieron ahí — son el historial
normal de ventas. No "aparecieron" por nada que el agente hizo. El agente es
sólo lectura y no puede alterar ADM Cloud.

### Discrepancia API vs UI (sesión 31-jul-2026)

El usuario envió una captura de ADM Cloud mostrando 9 facturas de Likecorp en
diciembre 2025 con saldo pendiente (total ~DOP 190,334). Al cruzar con la API:

- **Los DocIDs que veía el usuario** (`00000216`, `00000223`, `00000227`...) **no
  existen** en la API. Los DocIDs reales usan prefijos: `FC00000728`, `RI00000429`.
- **Los montos que veía** (40,238 / 39,069.80 / 16,744.20 / 32,568) **no existen
  en ningún registro** de CreditInvoices, CashInvoices, ni CashReceipts para
  Likecorp en toda la historia.
- La API muestra 5 facturas de Likecorp en dic-2025, todas pagadas.
- `Reference: None` en todos los CashReceipts de Likecorp — sin referencia
  cruzada a facturas.
- **Recibo duplicado detectado:** RI00000460 y RI00000461, ambos del 15-dic-2025
  por DOP 85,827.56, ambos activos (`Void=False`).

**Conclusión:** la UI de ADM Cloud estaba mostrando datos que la API no reflejaba.
Posibles causas: facturas registradas directamente por la interfaz (no por API),
pagos desvinculados, o un bug de sincronización entre la base de datos de ADM
Cloud y su API REST. Esto requiere que el usuario abra la factura en la UI y
proporcione el NCF para poder rastrearla en la API.

## Referencias

- `references/diagnostico-api-vs-ui.md` — protocolo detallado para cuando la UI
  de ADM Cloud muestra datos que la API no devuelve (DocIDs sin prefijo, montos
  inexistentes, pagos desvinculados).

## Técnicas y trampas de la API

### El filtro `RelationshipID` no funciona en AR

`admcloud-get.sh AR "RelationshipID=<id>"` **ignora el filtro** y devuelve los
135 registros de todos los clientes. Filtra en Python después de descargar:

```python
likecorp = [r for r in ar if 'likecorp' in json.dumps(r).lower()]
```

En `CreditInvoices` el filtro `RelationshipID` **sí funciona** correctamente.

### getbyid: el script no lo hace, llamar la API directo

`admcloud-get.sh CreditInvoices/<ID>` ignora el ID y pagina la lista completa.
Para obtener el detalle de una factura (con Items, Accounts, Files,
PaymentMethods), llamar la API directo:

```python
import base64, json, os, urllib.request, urllib.parse

BASE = "https://api.admcloud.net/api"
cred = base64.b64encode(
    f'{os.environ["ADMCLOUD_USER"]}:{os.environ["ADMCLOUD_PASSWORD"]}'.encode()
).decode()
fijos = urllib.parse.urlencode({
    "company": os.environ["ADMCLOUD_COMPANY"],
    "role":    os.environ["ADMCLOUD_ROLE"],
    "appid":   os.environ["ADMCLOUD_APPID"],
})
url = f"{BASE}/CreditInvoices/{factura_id}?{fijos}"
req = urllib.request.Request(url, headers={
    "Authorization": f"Basic {cred}",
    "Accept": "application/json",
})
with urllib.request.urlopen(req, timeout=30) as r:
    data = json.loads(r.read().decode("utf-8"))

inv = data['data']  # envuelto en {success, message, data}
# inv tiene: AppliedPayments, Items[], Accounts[], Files[], PaymentMethods[]
```

### `app.admcloud.net` no resuelve desde el servidor

Solo `api.admcloud.net` (IP 13.65.89.91) es accesible. La interfaz web
(`app.admcloud.net`) no resuelve por DNS — no se puede abrir el navegador contra
ADM Cloud. Toda interacción es por API REST.

## Ver también

- `consultar-admcloud` — cómo ejecutar consultas a la API (user-owned, no
  editable por el agente).
- `conciliar-banco-adm` — conciliación bancaria (banco vs ADM).
