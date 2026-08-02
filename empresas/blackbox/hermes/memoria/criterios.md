---
estado: borrador
aprobo:
evidencia: conciliación de entradas julio 2026 (configuracion_conciliacion_entradas.md), corte 2026-08-02
---

# Criterios transversales

Reglas numeradas (C-001, C-002…) que aplican a más de un proveedor o documento.
Cada criterio lleva: enunciado, evidencia verificable y alcance propuesto. El
C-001 de abajo es la semilla de formato que los lotes deben imitar.

Recordatorio del índice: `estado: borrador` ⇒ ningún criterio de este archivo
es precedente hasta que Carlos lo apruebe en la mesa.

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
