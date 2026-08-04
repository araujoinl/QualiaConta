# Consumo tarjeta Visa 1877 - MEATS MORE - FP00001051

**Fecha:** 2026-08-04
**Trabajo mesa:** c0a0c9fd-a515-4457-a1e5-16378b7b305b
**Documento ADM:** VendorBills FP00001051 (UUID 5f919e95-e0d7-4436-9a65-08ded71d577b)
**Metodo:** script (conciliacion banco-ADM)
**Confianza:** 0.90

## Hecho

Consumo de tarjeta Visa ****1877 DOP por RD$3,088.79 del 2026-06-29 en el
comercio MEATSMOREMEATS and MORE. La conciliacion detecto que este consumo ya
tiene su factura de proveedor registrada en ADM (FP00001051, del mismo proveedor,
mismo monto y misma fecha), de modo que no hay un nuevo documento que subir -
el cargo bancario se corresponde con una factura existente.

**Banco:** Santa Cruz - cuenta Visa 1877 DOP
**Movimiento banco_tx_id:** 4a8788f8-b0a8-4a3a-ae45-3c49af9de6d1

## Aprobo

Sugerencia automatica de conciliacion (sin aprobacion nominal: aprobado_por_nombre vacio en la fila). Documento ya registrado en ADM por la via de factura de proveedor.

## Alcance

Consumos de tarjeta que casan por monto, fecha y comercio con una VendorBills
ya registrada en ADM: no se registra un segundo documento. La sugerencia se
cierra senalando el DocID de la factura existente. Aplica a la cuenta Visa
****1877 DOP de Banco Santa Cruz y, por extension, a cualquier consumo de
tarjeta conciliable con una factura de proveedor preexistente.

## Origen de los datos

Fila qualia_trabajos id c0a0c9fd-a515-4457-a1e5-16378b7b305b, empresa
QUALIA_EMPRESA_ID. propuesta.registro_adm.docid = FP00001051,
propuesta.registro_adm.uuid = 5f919e95-e0d7-4436-9a65-08ded71d577b,
propuesta.registro_adm.documento = VendorBills. Sin eventos en el hilo.
