# Pago final J-11+J-12 · Banco Operaciones 874 → CxP Nercido Vargas — RD$3,400,000 (Caso #4)

- **Fecha:** 2026-08-15
- **Caso:** Pago final J-11+J-12 · Banco Operaciones 874 → CxP Nercido Vargas — RD$3,400,000 (Caso #4)
- **Decisión:** BillPayments RD$3,400,000.00 con Documents[] de las DOS facturas: FP00001152 (J-11) por 1,675,000 y FP00001153 (J-12) por 1,725,000. Cuenta de salida: 101.06 Banco Operaciones 874. DocID PP00000814. Ambas facturas quedaron saldadas (verificado en /api/AP: ya no figuran).
- **Por qué:** Transferencia final del 10/08/2026 (ref. banco 15591411, tx 1b680d72-7cf7-4639-a371-8289d3db6a36) que completa la compra de ambos locales: 1,675,000 (saldo J-11 tras el abono PP00000813) + 1,725,000 (J-12 completo) = 3,400,000 exacto. Primer BillPayments multifactura registrado por la mesa: el payload lo soporta nativamente (Documents[] es lista) y cierra ambas facturas al centavo en un solo documento. Reference = banco_tx_id 1b680d72-7cf7-4639-a371-8289d3db6a36 (verificado en readback).
- **Sostén:** Método: razonado
- **Aprobó:** C.Araujo, por la mesa web
- **Alcance:** un pago bancario que cancela varias facturas del mismo proveedor: un solo BillPayments con un renglón por factura en Documents[], cada uno por su saldo exacto; requiere que la suma cierre al centavo con el movimiento del banco.
- **Deroga:** —
