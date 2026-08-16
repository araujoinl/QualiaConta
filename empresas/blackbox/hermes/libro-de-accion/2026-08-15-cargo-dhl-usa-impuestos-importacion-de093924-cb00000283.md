# Cargo DHL USA: impuestos de la importación DE093924 — CB00000283

- **Fecha:** 2026-08-15
- **Decisión:** BankCharges CB00000283 (RD$7,702.18 = US$131.54 × 58.5539). Renglones: débito 7,702.18 → 801.01 Gastos sin comprobante de crédito fiscal y/o al exterior; crédito 7,702.18 → 203.10 Tarjeta Corporativa 877. DocID CB00000283.
- **Por qué:** Impuestos de USA que cobró DHL Express USA por la importación DE093924 de Technicoflor, pagados con la Visa 1877 en dólares el 2026-08-12 (movimiento banco 7e605860-6c47-4e45-8255-667950a3d511). Gasto no admitido: impuesto pagado fuera de República Dominicana, sin comprobante fiscal dominicano — no reduce ISR ni genera crédito de ITBIS (dictamen de C.Araujo, Caso #5). ADM no admite USD sobre la caja 203.10 («solo puede afectar la moneda funcional 'DOP' con tasa 1»), así que el cargo va en DOP con la tasa configurada de ADM, como preveía la propuesta aprobada. En el asiento queda la descripción a nombre de la importación DE093924, para reconstruir la historia de costo.
- **Sostén:** Método: razonado. Precedentes: FP00001060 (Tupaq, 2026-06-30, impuesto USA del courier → 801.01) y CB00000043/CB00000056 (cargos de tarjeta sin comprobante → 801.01).
- **Aprobó:** C.Araujo, por la mesa web
- **Alcance:** Blackbox SRL. Consumos en USD de la Visa 1877 (caja 203.10, que en ADM es DOP): se registran en DOP con la tasa configurada de ADM al momento del registro, dejando el monto y la tasa originales en `propuesta.conversion`. La caja 203.10 no admite USD tasa ≠ 1 — rechazo verificado de ADM el 2026-08-15. Si el banco publica la tasa real del consumo y difiere, se registra una partida de diferencia cambiaria aparte, no se corrige esta.
- **Deroga:** —
