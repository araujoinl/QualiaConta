# Índice de la doctrina contable

La contraparte contable del núcleo DGII, nacida de la auditoría de fallos de
conciliación del 2026-08-07 (72 trabajos con feedback del usuario). Las normas
de `../dgii/` responden el eje fiscal; esto responde el eje contable — contra
qué se asienta, con qué cuenta, con qué documento de ADM. La jerarquía entre
ambos la fija P-003: **la DGII nunca decide una cuenta ni un asiento.**

Ratificados el 2026-08-07 por C.Araujo (por chat: «ponla que las lea» — los
principios y tratamientos describen sus propias correcciones y el uso real).
La enmienda de P-003 que suma el núcleo NIIF-PYMES como nivel 5 se ratificó el
2026-08-15 («firma las que ya están»). Solo la semántica de cuentas sigue en
borrador, y un borrador no se cita.

| Qué | Archivo | Cubre | Estado |
|---|---|---|---|
| Principios de asiento | [principios-de-asiento.md](principios-de-asiento.md) | P-001 lo asentado manda · P-002 reversos contra su original · P-003 jerarquía de fuentes · P-004 naturaleza sobre emisor · P-005 probar que no existe antes de crear | **ratificado** (incluye la enmienda NIIF de P-003, 2026-08-15) |
| Conciliación: hecho→asiento | [conciliacion-hechos.md](conciliacion-hechos.md) | H-01..H-13: cargos, reversos, pagos, transferencias, anticipos, garantías, cashback, nómina, tránsito, vehículo documental (BankCharges cuando el asiento toca banco y Journals está bloqueado), devolución parcial. Cada entrada es fija de por vida: principio + tipo de cuenta; la cuenta concreta SIEMPRE se resuelve contra el plan vivo, y si el plan no la ofrece se PREGUNTA citando el hecho | **ratificado** hasta H-12 · **H-13 sin ratificar** (2026-08-18) |
| Cuentas en uso | [cuentas-en-uso.md](cuentas-en-uso.md) | Las 48 cuentas del histórico real con evidencia; la semántica (qué es / qué NO va acá) se dicta en ratificación y el generador la preserva | borrador (evidencia = espejo del agg, citable como agg) |
| Pagos a cuenta del ISR | [pagos-a-cuenta.md](pagos-a-cuenta.md) | Ciclo completo del anticipo de ISR: provisión anual (Dr.150.02/Cr.210.11), pago mensual (Pago a Cuentas Dr.210.11/Cr.101.05), liquidación al cierre (Dr.900.01/Cr.210.10 + compensación 150.02) | ratificado (imputación Dr.210.11 confirmada por C.Araujo, 2026-08-10) |

## Pendientes (estado del mundo — esto NUNCA va dentro de una entrada)

El principio ya está dictado; lo que falta es del plan de cuentas o del
sistema, y caduca cuando alguien lo resuelva en ADM:

- Asignar código contable a «Adelanto de Clientes» en ADM (la usa H-06).
- La conciliación no expone la RETENCIÓN de una devolución parcial (la usa
  H-13). `admcloud-conciliacion-entradas` cruza el par y lo rotula «se anulan
  con su reverso», que es cierto para el par y falso para la plata: el neto que
  el banco se quedó no aparece en ninguna fila ni en el resumen. El dato para
  calcularlo SÍ viaja en el JSON de cada movimiento (`reverso_monto` junto a
  `monto`), así que el contable puede detectarlo hoy; lo que falta es que la
  pantalla lo muestre y que el detector abra la sugerencia sola.
- Confirmar que el plan vivo ofrece cuenta de DIFERENCIA DE CAMBIO (la usa
  H-13, sólo en el tramo de reverso sobre cuenta en moneda extranjera).
- Cargar las tablas de amortización de los préstamos vivos (ROADMAP 2b.4;
  sin ellas H-04 siempre pregunta).
- La semántica de las 48 cuentas de `cuentas-en-uso.md`.
