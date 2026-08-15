# Núcleo NIIF-PYMES

La memoria contable compartida — la contraparte del núcleo DGII en el otro eje.
`dgii/` responde qué exige el fisco; esto responde qué dice la norma contable:
qué se activa, qué es ingreso, qué es pasivo, cómo se mide. Se monta de **sólo
lectura** en todas las instancias: ninguna empresa escribe acá.

```
secciones/<tema>.md   la norma destilada por tema (el PDF oficial va al lado, fuera de git)
INDEX.md              qué hay, con vigencias y lo marcado para verificar
```

Se organiza por **tema**, no por número de sección, porque así se consulta: el
contable pregunta "¿esto se activa o se gasta?", no "¿qué dice la Sección 17?".
Cada archivo declara qué secciones destila.

## Qué norma es

**NIIF para las PYMES** (IASB): el estándar contable internacional para
entidades sin obligación pública de rendir cuentas, adoptado en República
Dominicana por el ICPARD. La edición vigente es la de **2015** (enmiendas con
vigencia desde 2017-01-01). La **tercera edición** (emitida en febrero 2025)
rige para períodos que comiencen el **2027-01-01** o después — está anotada en
el INDEX como evento de vigencia, no cargada.

## Contrato de una regla

El mismo del núcleo DGII (regla 4 del repo): toda regla lleva **rango** y
**vigencia**. Sin las dos, no entra.

- **Norma** — el texto del estándar del IASB adoptado por el ICPARD. Es la
  autoridad; se cita por sección («Sección 17») y edición.
- **Interpretación** — material de formación del IASB o boletines de terceros.
  Ayuda a entender, no manda.
- El **criterio propio** no vive acá: vive en la memoria de cada empresa.

## La regla de los dos ejes

Este núcleo **no decide por encima de la doctrina ni de lo asentado**. Entra al
final de la jerarquía de P-003 (`../doctrina/principios-de-asiento.md`): sirve
cuando la doctrina, los criterios y el precedente callan, y da el **sostén** de
una propuesta — nunca el permiso de saltarse un ABIERTO. En choque con efecto
fiscal, manda la práctica fiscal dictada por el dueño (fiscal-first).

## Cómo se alimenta

A mano, y con razón: el IASB no publica cambios semanales como la DGII. El
único evento agendado es la tercera edición (2027) — destilarla antes de juzgar
documentos de ese año. Fuente: el PDF oficial en español del estándar, descarga
gratuita del IASB con registro; se guarda junto al núcleo, fuera de git.
