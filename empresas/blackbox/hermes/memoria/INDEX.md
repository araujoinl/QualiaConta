---
estado: ratificado
aprobo: no aplica (convencion operativa del plan de preentrenamiento, sin juicio contable)
evidencia: docs/plan-preentrenamiento.md seccion 2, 2026-08-02
---

# Memoria curada — índice

Qué archivo consultar para qué. Esta carpeta es la memoria de largo plazo del
contable: lo que está acá en `estado: ratificado` es precedente; lo demás no.

| Archivo | Consultalo cuando… |
|---|---|
| `proveedores.md` | vas a clasificar una factura de gasto: cuenta típica, ITBIS, NCF y vía de pago por proveedor |
| `criterios.md` | necesitás una regla transversal (tarjetas, qué es entrada real, cuentas excluidas…) |
| `nomina.md` | aparece un asiento de sueldos, TSS o INFOTEP |
| `proceso-nomina.md` | vas a cerrar la nómina del mes: flujo del día 30, conciliación de pagos y desglose de impuestos |
| `api-admcloud.md` | vas a pegarle a la API de ADM Cloud (quirks operativos, paginación, errores) |
| `plan-de-cuentas.md` | *(pendiente de F4)* validar que una cuenta existe y está viva |
| `banco.md` | *(pendiente de F4)* mapa cuentas ADM↔openbanking y patrones de cargos |
| `ventas.md` | *(pendiente de F4)* contexto de facturación — solo lectura, jamás autónomo |
| `scripts/` | herramientas deterministas (conciliación, extracción) |

`liquidaciones.md` **no existe todavía**: no hay corpus de liquidaciones montado
(gap confirmado). Se destila en Entrega 5 si Carlos sube el histórico al bucket
`qualia-conta`.

## La regla que no se negocia

> **`estado: borrador` ⇒ NO es precedente.**

Un criterio o regla en borrador no se cita como sustento de ninguna respuesta ni
sugerencia. Si lo único que tenés es un borrador, la respuesta lo dice
explícitamente ("hay un borrador no ratificado que sugiere X"). El precedente
nace cuando Carlos aprueba en la mesa y el criterio queda en el libro de acción
con `Aprobo:` y fecha.

## Convención de front-matter

Todo archivo de esta carpeta abre con:

```yaml
---
estado: borrador | ratificado
aprobo:            # vacío hasta ratificación; luego nombre y fecha
evidencia:         # de dónde salió: extracción y fecha de corte
---
```

- `estado: borrador` — destilado o escrito a mano, sin ratificar. No es precedente.
- `estado: ratificado` — aprobado con nombre en la mesa, o conocimiento **de
  herramienta** (quirks técnicos verificados empíricamente) que no requiere
  juicio contable; en ese caso `aprobo: no aplica (conocimiento de herramienta)`.
- `evidencia` — extracción y corte que sustentan el contenido. Toda regla
  individual cita además sus DocIDs de ejemplo.

## Formato de las entradas

Las semillas de formato (la sección TUPAQ en `proveedores.md`, el C-001 en
`criterios.md`, el esqueleto de `nomina.md`) fijan la plantilla que los lotes
de destilación deben imitar: mismos encabezados, misma tabla, evidencia con
n docs + DocIDs. No inventar formatos nuevos por lote.
