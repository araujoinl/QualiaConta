# Activos fijos — qué se capitaliza y cómo se deprecia

- **Rango:** norma
- **Fuente:** NIIF para las PYMES, Sección 17 — Propiedades, Planta y Equipo;
  deterioro por Sección 27 (edición 2015, IASB)
- **Vigente desde:** 2017-01-01 (el modelo de revaluación entró justo con las
  enmiendas 2015)
- **Revisado:** 2026-08-15

Eje contable. Lo fiscal de la depreciación **no vive acá** — ver el cruce
fiscal al final.

## Qué es un activo fijo (17.2)

Bien **tangible** que se mantiene para producir, suministrar, arrendar o
administrar, y que se espera usar **más de un período**. Los repuestos
importantes que se usarán más de un período también son activo fijo (17.5),
no inventario.

## Qué entra al costo (17.10)

- Precio de compra, **incluidos aranceles e impuestos no recuperables**, menos
  descuentos.
- Todo costo **directamente atribuible** a ponerlo en su lugar y condición de
  uso: transporte, instalación, montaje, honorarios.
- La estimación inicial de desmantelamiento, si hay obligación.

En la práctica: el 3% de transferencia inmobiliaria de los locales J-11/J-12
se capitaliza — el dictado de K-01 paso 3 tiene acá su sostén (impuesto no
recuperable de la adquisición).

Si el pago se aplaza más allá del crédito normal, el costo es el **precio de
contado** (valor presente); la diferencia es gasto por intereses (17.13).

## Qué NO se capitaliza (17.11)

Apertura de una nueva instalación, lanzamiento o publicidad, formación del
personal, administración y gastos generales — y **los intereses de financiarlo**:
en PYMES los costos por préstamos van a gasto **siempre** (Sección 25; las NIIF
plenas acá dicen otra cosa, no confundirse).

El mantenimiento diario va a resultados. Reemplazar un componente mayor se
capitaliza **dando de baja** el componente viejo.

## Componentes (17.6) y depreciación

Partes con patrones de consumo distintos se deprecian por separado. Terreno y
edificio se separan **siempre**: el terreno no se deprecia (17.8).

- Base = costo − **valor residual**; método que refleje el consumo real:
  lineal, decreciente o unidades de producción.
- La **vida útil la estima la empresa** — la norma no trae tabla de porcentajes.
- Empieza cuando el activo está **disponible para uso**, no cuando se estrena;
  y no se detiene por estar ocioso (17.20), salvo método de unidades en cero.
- Vida útil, residual y método se revisan si hay indicios de cambio; el ajuste
  es **prospectivo** (17.19), no se rehace lo depreciado.

## Deterioro (Sección 27, lo esencial)

Al cierre se mira si hay **indicios** — daño, obsolescencia, ocioso sin plan,
mercado caído. Sólo si los hay: importe recuperable = el mayor entre valor
razonable menos costos de venta y valor en uso; si libros > recuperable, la
diferencia es pérdida del período. Reversión permitida si el indicio cesa, con
tope en lo que el activo valdría sin el deterioro previo.

## Baja (17.27+)

Se da de baja al venderlo o cuando ya no se esperan beneficios. El resultado
(contraprestación neta − valor en libros) va a resultados y **no es ingreso
ordinario** — no pasa por la cuenta de ventas.

## Cruce fiscal — fiscal-first

> **⚠️ La DGII deprecia distinto:** categorías con porcentajes fijos (Código
> Tributario, art. 287: edificaciones 5%; vehículos, mobiliario y equipo de
> oficina, computadoras 25%; el resto 15%) y una mecánica propia de cuentas
> conjuntas. **Esa regla no está cargada en `../../dgii/normas/` todavía** —
> cargarla y verificar la mecánica antes de automatizar cualquier propuesta de
> depreciación. Mientras tanto: los libros siguen la práctica fiscal dictada
> por el dueño; esta sección sirve para qué entra al costo, componentes,
> cuándo empieza, y el desglose que pide un auditor.

## Lo que hay que verificar todavía

- Números de párrafo contra el PDF oficial.
- El umbral de capitalización es política de la empresa (materialidad, S.2) y
  **sigue sin dictar** — hasta el dictado, todo bien durable ambiguo se
  pregunta (P-004).
- La depreciación fiscal completa, para `dgii/normas/`.
