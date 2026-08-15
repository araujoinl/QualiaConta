---
estado: ratificado
aprobo: no aplica (conocimiento de herramienta, verificado empíricamente)
evidencia: exploración API 2026-07-31 → 2026-08-02 (skills analizar-cxc-adm, conciliar-banco-adm y preflight preentrenamiento)
---

# API ADM Cloud — quirks operativos

Conocimiento de herramienta: cómo se comporta de verdad `api.admcloud.net`.
No requiere ratificación contable, pero sí evidencia — todo lo de acá se
verificó pegándole a la API. **Regla madre: SOLO GET. Jamás POST/PUT/PATCH/DELETE,
incluido `POST /api/CustomReports/Execute` aunque "solo lea".**

## Autenticación

- Basic Auth + query params `company`, `role`, `appid` URL-encoded **en cada
  request**. Sin ellos no hay respuesta útil.
- Solo resuelve `api.admcloud.net`; `app.admcloud.net` (la UI web) no resuelve
  por DNS desde el servidor.

## Paginación (las trampas grandes)

- **`skip` es REQUERIDO en todo GET de listado.** Sin `skip`, los maestros dan
  405 y los transaccionales devuelven UN objeto en vez de lista.
- **`take` SE IGNORA**: la página es fija de 50, pidas lo que pidas.
  Excepción: `/api/AR` sí respeta `take`. Avanzar `skip` por el tamaño realmente
  devuelto y cortar en página vacía (o incompleta).
- **`GET /api/Sales/Detailed` ignora `skip` y `take`** y devuelve TODO
  (1507 docs) en una sola llamada. Hacer UNA sola y guardar el payload.
- **`/api/BankBankTransfers` responde una tupla**: `data = {Item1: [página],
  Item2: total}`. Parsearla especial.
- El wrapper `skills/consultar-admcloud/scripts/admcloud-get.sh` ya pagina solo
  y desenvuelve las formas comunes — usalo antes de armar requests a mano.

## Detalle por documento (getbyid)

- El wrapper no hace getbyid: `admcloud-get.sh Recurso/<ID>` ignora el ID y
  pagina la lista. Para el detalle, request directo
  `GET /api/{recurso}/{ID}?company&role&appid`; la respuesta viene envuelta en
  `{success, message, data}` y `data` trae `Items[]`, `Accounts[]`, `Files[]`.

## Filtros que mienten

- `RelationshipID` **NO funciona en `/api/AR`** (devuelve todo); **SÍ funciona
  en `/api/CreditInvoices`**. Ante la duda: bajar y filtrar localmente.

## Errores y ritmo

- **Los cuerpos de error reflejan el GUID de `company`.** NUNCA volcar un error
  crudo a logs ni archivos; loggear solo código HTTP y tipo de excepción.
- Throttle ~1 req/s. Backoff solo ante 5xx. **Jamás reintentar un 4xx en loop.**

## Autorización: qué documentos la exigen y cuáles no (medido 2026-08-15)

- **`BillPayments` y `AccountPayments` nacen PENDIENTES y sin efecto**: la
  factura sigue abierta / el asiento no existe hasta el `PUT /{recurso}/Authorize?id=`.
  Los scripts de registro ya autorizan y releen; si un pago queda pendiente,
  su plata NO se movió en los libros. El barrido es
  `GET ?OnlyPendingAuthorize=true` (así aparecieron 21 pagos de Víctor por
  RD$1,25M parados desde julio).
- **`BankBankTransfers` NO tiene endpoint Authorize** (swagger BR: solo
  get/put/post, UpdateCustomField, Void, delete) y su «pendiente de autorizar»
  es COSMÉTICO: 216 de ~224 transferencias históricas están pendientes desde
  siempre y el asiento postea igual (la TE00000167 pendiente tiene su plata
  documentada moviéndose). No perseguir esa cola por API: no se puede y no
  hace falta. El tilde solo existe en la pantalla.
- **Sondear `{recurso}/Authorize` con GUID falso NO distingue**: ruta real e
  inventada contestan igual («Object reference not set»). Para saber si existe,
  el swagger del módulo — no la sonda.
