---
estado: borrador
aprobo:
evidencia: extracción manual 2026-08-02 vía API ADM Cloud (muestra 8/114 VendorBills), corte 2026-08-02
---

# Proveedores — tratamiento contable típico

Una sección por proveedor con actividad (≥ 2 docs). Los de 1 doc van a la tabla
residual del final (la agrega la destilación). Cada sección sigue EXACTAMENTE la
plantilla de la entrada TUPAQ de abajo — es la semilla de formato que los lotes
deben imitar.

Un proveedor cuyo gasto se reparte ~50/50 entre dos cuentas se marca
`AMBIGUO — preguntar` en "Tratamiento típico" y NUNCA se clasifica en autónomo.

---

## Tupaq Cargo & Courier Srl

- **RNC:** 132942248 · **Moneda:** DOP · **Alta en ADM:** 2025-01-14
- **Actividad:** 114 VendorBills, 2025-01-03 → 2026-06-30, total DOP 153,172.20
- **Rubro:** courier / flete aéreo y desaduanización (DGA). Referencias con guía `FTGAZ-…`.

**Cuentas de gasto observadas** (muestra 8/114 detalles):

| Cuenta | Nombre | Cuándo | Evidencia |
|---|---|---|---|
| 620.10 | Envíos y Correspondencias | flete/courier corriente (el caso típico, 7/8 de la muestra) | FP00001057, FP00001045, FP00000969 |
| 130.02 | Compras en Tránsito | facturas grandes ligadas a mercancía importada aún no recibida (sin ITBIS) | FP00001036 (DOP 45,186.75) |
| 801.01 | Gastos sin comprobante de crédito fiscal y/o al exterior | porción del gasto sin crédito fiscal dentro de una misma factura | FP00001060 |

- **ITBIS:** adelantado a `210.01 Itbis Operativo` en las facturas de flete
  corriente (ej. FP00001057: ITBIS 106.13 sobre 988.56). La factura grande a
  130.02 vino con ITBIS 0.
- **Retenciones:** ninguna observada en la muestra.
- **NCF típico:** `B01…` (crédito fiscal, comprobante tradicional — no e-CF).
- **Contrapartida:** siempre `Cuentas por Pagar Proveedores DOP` (docs nativos `FP*`).
- **Vía de pago y plazo:** pendiente de destilación (cruce con BillPayments en F4).

**Tratamiento típico:** factura de courier/flete → débito a **620.10** con su
ITBIS a 210.01; si la factura acompaña una importación en curso (monto grande,
sin ITBIS), va a **130.02 Compras en Tránsito**. Evidencia: FP00001057 vs
FP00001036. La distribución fina (% histórico sobre los 114 docs) la completa
la destilación F4 — esta entrada fija el formato, no el porcentaje.
