# Índice de la doctrina contable

La contraparte contable del núcleo DGII, nacida de la auditoría de fallos de
conciliación del 2026-08-07 (72 trabajos con feedback del usuario). Las normas
de `../dgii/` responden el eje fiscal; esto responde el eje contable — contra
qué se asienta, con qué cuenta, con qué documento de ADM. La jerarquía entre
ambos la fija P-003: **la DGII nunca decide una cuenta ni un asiento.**

Ratificados el 2026-08-07 por C.Araujo (por chat: «ponla que las lea» — los
principios y tratamientos describen sus propias correcciones y el uso real).
Solo la semántica de cuentas sigue en borrador, y un borrador no se cita.

| Qué | Archivo | Cubre | Estado |
|---|---|---|---|
| Principios de asiento | [principios-de-asiento.md](principios-de-asiento.md) | P-001 lo asentado manda · P-002 reversos contra su original · P-003 jerarquía de fuentes · P-004 naturaleza sobre emisor · P-005 probar que no existe antes de crear | **ratificado** |
| Conciliación: hecho→asiento | [conciliacion-hechos.md](conciliacion-hechos.md) | H-01..H-12: cargos, reversos, pagos, transferencias, anticipos, garantías, cashback, nómina, tránsito, vehículo documental (BankCharges cuando el asiento toca banco y Journals está bloqueado). Cada entrada es fija de por vida: principio + tipo de cuenta; la cuenta concreta SIEMPRE se resuelve contra el plan vivo, y si el plan no la ofrece se PREGUNTA citando el hecho | **ratificado** |
| Cuentas en uso | [cuentas-en-uso.md](cuentas-en-uso.md) | Las 48 cuentas del histórico real con evidencia; la semántica (qué es / qué NO va acá) se dicta en ratificación y el generador la preserva | borrador (evidencia = espejo del agg, citable como agg) |

## Pendientes (estado del mundo — esto NUNCA va dentro de una entrada)

El principio ya está dictado; lo que falta es del plan de cuentas o del
sistema, y caduca cuando alguien lo resuelva en ADM:

- Asignar código contable a «Adelanto de Clientes» en ADM (la usa H-06).
- Cargar las tablas de amortización de los préstamos vivos (ROADMAP 2b.4;
  sin ellas H-04 siempre pregunta).
- La semántica de las 48 cuentas de `cuentas-en-uso.md`.
