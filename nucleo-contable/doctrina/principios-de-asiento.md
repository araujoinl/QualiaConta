---
estado: ratificado
aprobo: C.Araujo, por chat, 2026-08-07 («ponla que las lea» — los principios describen sus propias correcciones)
evidencia: auditoría de 72 trabajos con feedback del usuario, mesa de Blackbox, corte 2026-08-07
enmiendas: nivel 5 de P-003 (núcleo NIIF-PYMES) en BORRADOR desde 2026-08-15 — pendiente de ratificación, no se cita
---

# Principios de asiento — doctrina contable del núcleo

La contraparte contable del núcleo DGII. Las normas de `dgii/` responden el eje
FISCAL de un documento (NCF, ITBIS, retenciones, 606); estos principios
responden el eje CONTABLE: contra qué se asienta, con qué cuenta y con qué
documento de ADM. **La DGII nunca decide una cuenta ni un asiento.**

Mismo contrato que toda regla del núcleo (regla 4 del repo): cada principio
lleva rango y vigencia. Ratificados el 2026-08-07: **citables desde entonces**
— no son criterios nuevos, son las correcciones del dueño escritas con nombre.

---

## P-001 — El asiento nace de lo ASENTADO, no del deber-ser

- **Rango:** principio rector · **Vigencia:** desde 2026-08-07

Antes de proponer una partida que usa, cancela o corrige un saldo, se verifica
por SQL que ese saldo EXISTE en ADM tal como la partida lo asume. Si el libro
real contradice lo que la teoría contable dice que "debería" haber, **esa
contradicción es el hallazgo que se reporta al humano** — jamás se puentea
asumiendo el asiento que falta.

**Evidencia (Caso #1, 2026-08-05, rechazado 10 veces):** el excedente de
RD$4,322.75 de Jfd & Etc Ideas se propuso devolver debitando «Adelanto de
Clientes», pero el recibo RI00000718 se había registrado por RD$8,265.76 — el
pasivo que la propuesta cancelaba **nunca existió en ADM**. Palabras del
rechazo: *«ese pasivo nunca existió»*. Diez variantes cayeron por no verificar
primero qué había asentado.

**Cómo se aplica:** toda propuesta de conciliación declara en `detalle` qué
consultó de ADM y qué encontró («el recibo X está por Y; el saldo de la cuenta
Z es W»). Una propuesta de asiento sin esa verificación citada está incompleta.

---

## P-002 — Un reverso se asienta contra su movimiento original

- **Rango:** principio · **Vigencia:** desde 2026-08-07

Una devolución, reverso o corrección bancaria («DEVOLUCION CARGO…») usa la
MISMA cuenta del movimiento original, con el signo contrario. La cuenta no se
deduce de la descripción del reverso: se encuentra atando el original. **Sin
original identificado no hay propuesta — hay pregunta.**

**Evidencia:** la devolución del 2×1000 (crédito 06/08) salió «SIN CUENTA
ASIGNADA» y Victor tuvo que asignarla a mano; el comprobante E340000187146 se
rechazó porque los cargos no se pudieron atar a movimientos del banco.

---

## P-003 — Jerarquía de fuentes para decidir un asiento

- **Rango:** principio rector · **Vigencia:** desde 2026-08-07

En orden, y cada nivel manda sobre el siguiente:

1. **El estado real de ADM** (consultado por SQL en el momento — P-001).
2. **Esta doctrina y las políticas de la empresa** (`conciliacion-hechos.md`,
   `cuentas-en-uso.md`).
3. **El precedente ratificado** (libro de acción, agg del histórico).
4. **El núcleo DGII — SOLO para el eje fiscal del documento** (¿el NCF vale?,
   ¿el ITBIS es aprovechable?, ¿lleva retención?, ¿qué tipo de gasto 606?).
5. **[BORRADOR — propuesto 2026-08-15, pendiente de ratificación; no se cita]**
   **El núcleo NIIF-PYMES — SOLO para el eje contable, y sólo cuando los
   niveles 2 y 3 callan**: clasificación, reconocimiento y medición (¿se activa
   o se gasta?, ¿es ingreso o pasivo?, ¿qué entra al costo?). Nunca manda sobre
   lo asentado (P-001) ni convierte un ABIERTO en permiso: donde la doctrina
   ordena preguntar, se pregunta — la norma da el **sostén** de la propuesta,
   no la decisión. En choque con efecto fiscal manda la práctica fiscal dictada
   por el dueño (fiscal-first), y la diferencia se reporta como hallazgo.

**Evidencia:** el sesgo medido en la mesa — en las decisiones de conciliación
falladas, el agente citaba normas fiscales o precedentes de DocID sueltos
donde la pregunta era contable, porque el único cuerpo con rango y vigencia
que existía era `dgii/`. Este archivo existe para que el nivel 2 deje de estar
vacío.

---

## P-004 — La cuenta se elige por la naturaleza del hecho, no por el emisor

- **Rango:** principio · **Vigencia:** desde 2026-08-07

Un renglón capitalizable va a activo aunque el proveedor sea «de gasto»; una
membresía de fitness es representación aunque la facture un gimnasio; una
comisión de corretaje es un servicio profesional aunque el emisor sea
desconocido. El emisor da el precedente de ARRANQUE (agg); la naturaleza del
renglón manda al final — es la regla POR ITEM del dueño (2026-08-02), elevada
a principio.

**Evidencia:** el inversor de Suena Electronica (RD$12,350) se propuso como
gasto y Carlos tuvo que preguntar dos veces «¿no va en cuenta de activos?» y
«¿el tipo no sería adquisición de activo fijo?»; la membresía Pulse Harmony
(«esto es un centro fitness va como representación»).

**Pendiente de dictado:** el umbral de capitalización — desde qué monto un
bien durable se activa en vez de gastarse. El inversor de RD$12,350 se
activó; una grapadora de RD$800 no debería. Hasta el dictado, todo bien
durable ambiguo se pregunta.

---

## P-005 — Antes de crear, probar que no existe

- **Rango:** principio · **Vigencia:** desde 2026-08-07

Revertir en ADM **borra el documento sin dejar lápida** (medido, ROADMAP):
cada duplicado que se cuela cuesta una anulación invisible en el libro
oficial. Antes de crear un documento, se agota la búsqueda de que ya exista —
por NCF, por `Reference`, por período (las nóminas se buscan por `<AAAAMM>` Y
por monto: la TSS de julio se registró con período de junio y «buscar 202607»
no la encontraba).

**Evidencia:** FP00001131 y FP00001132 (Claro julio/agosto) anuladas por
«Corrección de la Información», NCP00000006 y CB00000226 anulados — cuatro
reversiones reales en una semana, cada una sin rastro en ADM.
