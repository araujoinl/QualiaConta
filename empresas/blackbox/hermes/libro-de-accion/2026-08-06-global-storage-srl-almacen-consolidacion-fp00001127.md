# 2026-08-06 — Global Storage SRL: servicios de almacén (consolidación) — FP00001127

**Registrada en ADM Cloud como:** FP00001127 (VendorBills)
**Fecha del documento:** 2026-08-04
**Proveedor:** GLOBAL STORAGE SRL (RNC 130870081)
**NCF / e-CF:** E310000014904
**Monto:** RD$29,521.63 (base RD$25,018.33 + ITBIS RD$4,503.30)
**Moneda:** DOP
**Referencia suplidor:** 128742

## Criterio

Servicios de almacén por consolidación de mercancía (operación 2601, Consolidación
Mercure). Todos los renglones —calendarización, interconexión SIGA, movimiento de
carga, almacenaje, tarja, seguro de mercancías y documentación/verificación— van a
la cuenta **130.02 (Compras en Tránsito)**, porque son costos que forman parte del
costo de la mercancía importada hasta que llega al destino final.

- **Cuenta contable:** 130.02 (Compras en Tránsito) — los 7 renglones.
- **Tipo de gasto 606:** 09 (Compras y Gastos que Formarán parte del Costo de Venta).
- **Método:** precedente.
- **Precedente:** 4 de 4 facturas históricas de Global Storage usan la cuenta 130.02
  (`agg:proveedor-cuentas.json#130870081`).
- **Documento ADM:** VendorBills (factura de proveedor).
- **Término de pago:** Al contado (el documento dice TRANS. CTA.).

## Notas

- El timbre del e-CF no se pudo verificar en DGII: el código de seguridad se leyó
  de una imagen y probablemente tiene un carácter mal leído. El RNC sí verifica en
  el padrón: GLOBAL STORAGE SRL, contribuyente ACTIVO, facturador electrónico.
  Si se quiere confirmar el timbre, hace falta el XML del e-CF o el código exacto.

## Aprobó

**Victor**, por la mesa web, el 2026-08-06.

## Alcance

Todo servicio de almacén, consolidación, almacenaje, tarja, movimiento de carga,
seguro de mercancías y documentación/verificación cobrado por **Global Storage SRL**
(RNC 130870081) — o por un proveedor de servicios logísticos de importación con la
misma naturaleza — se registra en la cuenta **130.02 (Compras en Tránsito)** con
tipo de gasto 606 **09 (Costo de Venta)**, bajo VendorBills, mientras la mercancía
no haya llegado a su destino final. Cada renglón del documento va como ítem propio
con su cuenta; los cargos que no sean costo de importación (ej: un gasto local) se
clasifican por su naturaleza.
