# El pago del IT-1 migra de asiento a `AccountPayments`

- **Fecha:** 2026-08-14
- **Caso:** La nota de débito de RD$166.418,03 del 2026-07-20 (Banco Santa Cruz, cuenta 4964) y el conflicto entre la costumbre y el candado
- **Decisión:** el pago mensual del ITBIS se registra con un **`AccountPayments`** que debita `210.01 Itbis Operativo` y `210.03 Retención 30% Itbis` contra la cuenta de banco que pagó. Deja de registrarse como `Journals`, que fue la forma usada hasta el 2025-12-20. Criterio escrito: C-006 de `criterios.md`.
- **Por qué:** la forma vieja es un asiento que acredita una cuenta de caja, y eso es exactamente lo que rechaza el trigger `qualia_trabajos_journal_no_toca_caja` desde el 2026-08-07. El contable no podía proponer el pago del ITBIS de la forma en que la empresa siempre lo hizo: el candado y la costumbre se contradecían, y la nota de débito de julio quedó parada por eso.

  Se eligió migrar el documento en vez de abrirle una excepción al candado, por tres razones. La TSS y el INFOTEP **ya hicieron ese camino** en julio de 2026 (PC00000335 y PC00000336) y funcionó. Un `AccountPayments` sí entra al cruce de la conciliación de la mesa y un `Journals` no. Y una excepción con nombre adentro del candado lo vuelve discutible caso por caso, que es como se erosiona un límite que costó ocho intentos fallidos poner.

  **Los asientos históricos no se tocan.** ED00000037, ED00000049, ED00000066, ED00000078, ED00000094 y ED00000120 son la contabilidad de 2025, están correctos en su momento, y anular para re-registrar no es lo que este cambio viene a hacer. La forma nueva rige de acá en adelante.

  Esto además corrige una creencia registrada: se había concluido que el IT-1 «no se paga en ADM» porque ningún `AccountPayments` debita la `210.01` en veinte meses. Era cierto el dato y falsa la conclusión — se paga, por asiento, que es donde el barrido anterior no miró.
- **Sostén:** Método: verificado sobre el espejo `journals-detalle.jsonl` (seis asientos de la misma forma, abril a diciembre de 2025, todos alrededor del día 20, que es el vencimiento del IT-1) y `account-payments-detalle.jsonl` (la `210.03` ya se paga con `PC` cinco veces; la `210.01` ninguna).
- **Aprobó:** C.Araujo, por chat
- **Alcance:** Blackbox SRL, el pago del IT-1 de cada período, de 2026-08-14 en adelante. Si aparece una retención distinta de la `210.03` dentro del mismo pago, se agrega al asiento del mismo `AccountPayments`; no se abre un documento aparte. Se revisa si la DGII cambia la forma de liquidar el IT-1 o si ADM habilita un documento fiscal propio para declaraciones.
- **Deroga:** la forma `Journals` para el pago del IT-1, vigente hasta 2025-12-20. No deroga ningún asiento ya registrado.
