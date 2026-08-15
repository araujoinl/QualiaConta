# Índice del núcleo NIIF-PYMES

Qué hay cargado, con su vigencia y su estado de verificación. Este archivo es
lo primero que consulta el contable para saber si tiene base para responder o
si tiene que decir que no sabe.

Edición cargada: **NIIF para las PYMES 2015** (vigente desde 2017-01-01). La
tercera edición rige desde **2027-01-01** y no está destilada — ver abajo.

## Secciones

Elegidas porque le hablan a lo que la mesa procesa hoy; el resto del estándar
(35 secciones) se agrega cuando un caso lo pida.

| Tema | Archivo | Destila | Revisado |
|---|---|---|---|
| Conceptos y materialidad | [secciones/conceptos-y-materialidad.md](secciones/conceptos-y-materialidad.md) | Sección 2: definiciones de activo/pasivo/ingreso, reconocimiento, devengo, materialidad, esencia sobre forma, no compensar | 2026-08-15 |
| Activos fijos | [secciones/activos-fijos.md](secciones/activos-fijos.md) | Sección 17 (y deterioro de la 27): qué entra al costo, qué no se capitaliza, componentes, depreciación, baja | 2026-08-15 |
| Inventarios | [secciones/inventarios.md](secciones/inventarios.md) | Sección 13: costo, fórmulas permitidas (UEPS prohibido), rebaja a valor de venta | 2026-08-15 |
| Ingresos y anticipos | [secciones/ingresos-y-anticipos.md](secciones/ingresos-y-anticipos.md) | Sección 23: cuándo hay ingreso, anticipos como pasivo, pago diferido | 2026-08-15 |
| Préstamos y cuentas por cobrar | [secciones/prestamos-y-cuentas-por-cobrar.md](secciones/prestamos-y-cuentas-por-cobrar.md) | Sección 11: costo amortizado, interés efectivo, deterioro de CxC, baja de pasivos | 2026-08-15 |
| Provisiones y garantías | [secciones/provisiones-y-garantias.md](secciones/provisiones-y-garantias.md) | Sección 21: obligación presente, qué no se provisiona, medición, contingencias | 2026-08-15 |

Fuera a propósito, hasta que la mesa lo pida: impuesto diferido (S.29),
arrendamientos (S.20), beneficios a empleados (S.28), presentación de estados
financieros completos (S.3–8) — los estados los preparan los contables
externos.

## Marcado para verificar

Lo que está cargado pero **no se puede usar sin confirmar primero**. Señalado
dentro de cada archivo con ⚠️; acá está la lista para no perderlo de vista.

| Qué | Por qué | Dónde |
|---|---|---|
| Números de párrafo citados | El destilado cita de memoria (17.10, 13.18, 23.10…). El tema es fiel; el número exacto se contrasta contra el PDF oficial antes de citarlo ante un auditor | todas las secciones |
| Resolución del ICPARD y fechas de adopción en RD | La adopción es un hecho; el número de resolución y el calendario exacto no están verificados | README |
| Tercera edición (2027) | Reescribe **Sección 23** (ingresos por modelo de control, base NIIF 15) y alinea la Sección 2 al Marco Conceptual 2018. Documentos de períodos 2027+ se juzgan con ella: destilarla antes | ingresos-y-anticipos.md |
| Cruces fiscales sin cargar en `dgii/normas/` | Depreciación fiscal por categorías, deducibilidad de incobrables, valuación fiscal de inventario, ITBIS/NCF de anticipos. El eje fiscal de estos temas NO está en el núcleo DGII todavía — cargarlo antes de automatizar propuestas con efecto fiscal | activos-fijos, inventarios, ingresos, préstamos |
| Fórmula de costo configurada en ADM | Debe ser PEPS o promedio ponderado (13.18); verificar cuál usa ADM Cloud para los artículos | inventarios.md |

## Cómo se mantiene

A mano. Sin cron: el IASB no publica semanalmente. El único evento agendado es
la **tercera edición** — antes del cierre 2026 hay que decidir si se adopta
anticipado o se espera a 2027, y destilar lo que cambie.

Toda regla lleva **rango** (norma, interpretación) y **vigencia**. Sin las dos,
no entra — un documento de 2026 se juzga con la edición 2015.

## Nota sobre la autoridad

La autoridad es el texto del estándar emitido por el IASB y adoptado por el
ICPARD; el material de formación por sección del IASB es **interpretación**:
ayuda a entender, no manda. Cuando el contable sostenga una decisión, cita la
sección del estándar, no el material de formación.

Y la frontera con el otro eje, siempre: esta norma dice cómo se contabiliza;
**qué exige el fisco vive en `../dgii/`**, y en choque con efecto fiscal manda
la práctica fiscal dictada por el dueño (P-003, enmienda en borrador).
