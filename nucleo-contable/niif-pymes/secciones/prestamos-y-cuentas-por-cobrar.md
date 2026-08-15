# Préstamos y cuentas por cobrar — costo amortizado e incobrables

- **Rango:** norma
- **Fuente:** NIIF para las PYMES, Sección 11 — Instrumentos Financieros
  Básicos (edición 2015, IASB)
- **Vigente desde:** 2017-01-01
- **Revisado:** 2026-08-15

Cubre lo básico que Blackbox toca: efectivo, cuentas por cobrar y pagar,
préstamos bancarios, depósitos.

## Medición inicial (11.13)

Al **precio de la transacción**, incluidos los costos de transacción. Si la
operación es en realidad una **financiación** — pago aplazado más allá de los
términos normales, o tasa fuera de mercado — se mide al **valor presente**.

## Después: costo amortizado (11.14)

Los instrumentos de deuda (préstamos, CxC con financiación) se llevan a
**costo amortizado con el método del interés efectivo**. Las CxC y CxP
corrientes sin interés se quedan al importe sin descontar — el caso normal de
una factura a 30 días.

En llano, para un préstamo: cada cuota parte en dos — **interés** (gasto del
período: tasa efectiva sobre el saldo vivo) y **capital** (baja el pasivo). La
partición sale de la tasa y el saldo, es decir, **de la tabla de
amortización**: partir una cuota "a ojo" no es una estimación admisible.

> **⚠️ Las tablas de amortización de los préstamos vivos no están cargadas**
> (ROADMAP 2b.4). Por eso **H-04 ordena preguntar** ante toda salida de banco
> hacia un préstamo — esta norma es el sostén de ese ABIERTO, no un permiso
> para estimarlo.

Las comisiones y costos de originación del préstamo entran al costo amortizado
(ajustan la tasa efectiva); no son gasto completo del día uno.

## Deterioro de cuentas por cobrar (11.21–11.25)

Al cierre se busca **evidencia objetiva** de deterioro — hechos que ya
ocurrieron: dificultades financieras notorias del deudor, incumplimientos de
pago, renegociación por dificultades, probable quiebra.

- Con evidencia: pérdida = valor en libros − flujos que de verdad se esperan
  cobrar (descontados si el efecto es material). Va a resultados.
- **Sin evidencia no hay asiento**: una reserva genérica («x% de la cartera por
  si acaso») no cumple la norma — el modelo de PYMES es de **pérdida
  incurrida**, no de pérdida esperada.
- Si después mejora, la pérdida se revierte hasta donde habría estado el saldo.

## Baja de un pasivo financiero (11.36+)

Un pasivo se da de baja **sólo cuando se extingue**: pagado, condonado o
expirado. La versión en norma de P-001: cancelar un pasivo que el libro no
tiene registrado no es un asiento — es el hallazgo que se reporta (Caso #1: «ese
pasivo nunca existió»).

## Cruce fiscal

> **⚠️ La deducibilidad fiscal de incobrables tiene régimen propio** (castigo
> efectivo o autorización de la DGII) y **no está cargada en
> `../../dgii/normas/`**. Una pérdida contable por deterioro no implica
> deducción en el ISR — verificar antes de proponer efecto fiscal.

## Lo que hay que verificar todavía

- Números de párrafo contra el PDF oficial.
- Las tablas de amortización de los préstamos vivos (desbloquean H-04).
- El régimen fiscal de incobrables, para `dgii/normas/`.
