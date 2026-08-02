# Diagnóstico: API vs UI de ADM Cloud

## Cuándo sospechar

La API REST de ADM Cloud devuelve datos diferentes a lo que el usuario ve en la
interfaz web. Señales:

1. Los DocIDs que ve el usuario no usan el formato de la API (la API usa
   prefijos: `FC` facturas crédito, `FCC` contado, `RI` recibos).
2. Los montos no aparecen en ningún recurso de la API para ese cliente.
3. El conteo de documentos no coincide.

## Protocolo de verificación

### Paso 1: Confirmar el conjunto de datos del usuario

Pedir al usuario que transcriba (o envíe captura de):
- DocID visible en pantalla
- Fecha del documento
- Cliente
- Monto (total y saldo)

### Paso 2: Buscar por monto en TODA la historia

No solo en el cliente o período que el usuario reporta. Buscar en todos los
recursos:

```python
montos_usuario = [40238, 39069.80, 16744.20, 32568]

for monto in montos_usuario:
    matches_ci = [f for f in credit_invoices if abs(f.get('TotalAmount',0) - monto) < 0.01]
    matches_cash = [f for f in cash_invoices if abs(f.get('TotalAmount',0) - monto) < 0.01]
    matches_cr = [r for r in cash_receipts if abs(r.get('TotalAmount',0) - monto) < 0.01]
```

Si un monto no aparece en NINGÚN recurso de la API, es una señal fuerte de que
la UI está mostrando datos que la API no refleja.

### Paso 3: Buscar por DocID

Los DocIDs de la API tienen prefijos fijos:
- `FC00000XXX` — Factura a Crédito
- `FCC0000XXX` — Factura de Contado
- `RI00000XXX` — Recibo de Ingreso (CashReceipt)

Si el usuario ve DocIDs numéricos sin prefijo (`00000216`), es probable que esté
viendo un correlativo interno de ADM Cloud que no se expone en la API REST.

### Paso 4: Verificar recibos duplicados

Buscar pares con misma fecha + mismo monto:

```python
from collections import Counter
pares = [(r['DocDate'][:10], r['TotalAmount']) for r in cash_receipts_cliente]
dups = {p: c for p, c in Counter(pares).items() if c > 1}
```

Un duplicado sin anular (ambos `Void=False`) puede estar aplicado a facturas
distintas y generar descuadros.

### Paso 5: Verificar Reference en CashReceipts

Si `Reference` es `None`/null en los CashReceipts, el pago no tiene referencia
cruzada a la factura. Un usuario que dice "desapareció la referencia" ve esto en
la UI: el pago existe pero no está imputado.

## Causas posibles

1. **Factura registrada por la UI, no por API** — si alguien creó facturas
   directamente en la interfaz web de ADM Cloud, pueden no aparecer en la API
   REST (o aparecer con retraso).
2. **Pago desvinculado** — el recibo existe pero `AppliedPayments` en
   CreditInvoices no lo refleja. La factura vuelve a mostrar saldo.
3. **Bug de sincronización** — la base de datos interna y la API REST pueden
   desincronizarse.
4. **Duplicación de recibos** — dos recibos por el mismo monto en la misma
   fecha, ambos activos, aplicados a facturas distintas.

## Lo que NO debes hacer

- **No atribuir el cambio a algo que hiciste.** El agente es sólo lectura.
- **No inventar una explicación.** Si no sabés por qué pasa, decí que no sabés.
- **No asumir que el usuario está equivocado.** La UI es la fuente que él ve;
  tu API puede ser la que está desactualizada.
