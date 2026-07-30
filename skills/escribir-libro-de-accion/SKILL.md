---
name: escribir-libro-de-accion
description: "Registra una decisión contable aprobada en el libro de acción, y busca precedentes antes de volver a preguntar lo mismo."
version: 1.0.0
author: QualiaConta
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [Contabilidad, Memoria, Decisiones, Auditoría]
---

# El libro de acción

El registro de decisiones contables de la empresa, en `/opt/data/libro-de-accion`.

No es memoria: es **evidencia**. Cuando alguien pregunte en marzo por qué una
factura se registró así, la respuesta es una entrada con su fecha, no lo que tú
recuerdes.

## Primero: buscar precedente

**Antes de preguntar cualquier cosa**, busca si ya se decidió:

```bash
grep -ril "combustible\|Sunix" /opt/data/libro-de-accion/
```

Si encuentras una entrada cuyo **Alcance** cubre el caso presente, aplícala y
avisa cuál usaste. No vuelvas a preguntar.

Preguntar dos veces lo mismo es exactamente el fracaso que este sistema existe
para evitar.

## Escribir una entrada

**Una decisión es un archivo nuevo.** Nunca edites ni borres uno existente.

Nombre: `AAAA-MM-DD-descripcion-corta.md`

```markdown
# Facturas de combustible de Sunix Petroleum

- **Fecha:** 2026-07-30
- **Caso:** factura de compra de gasoil para la flotilla
- **Decisión:** gasto de combustible, cuenta 6120-01, ITBIS no aprovechable
- **Por qué:** el consumo es de vehículos de reparto, no reventa
- **Sostén:** Norma General 07-2007 art. 3 (rango: norma, vigente desde 2007-05-15)
- **Aprobó:** Carlos Araujo, por Telegram
- **Alcance:** toda factura de Sunix Petroleum por combustible
- **Deroga:** —
```

## Los tres campos que la gente arruina

**Alcance** es lo que convierte una decisión en precedente: dice a qué casos
futuros aplica. Sin él, la entrada documenta pero no automatiza nada — y la
próxima factura igual vuelve a preguntar.

Escríbelo concreto: *"toda factura de Sunix Petroleum por combustible"*, no
*"gastos operativos"*. Demasiado amplio y lo vas a aplicar donde no toca;
demasiado estrecho y no sirve para la próxima.

**Aprobó** lleva la persona con nombre, nunca "el usuario" ni "por Telegram" a
secas. Varias personas de la empresa aprueban con la misma autoridad, así que
este campo es lo único que permite reconstruir de dónde salió un criterio.

**Sostén** es la norma que respalda la decisión, con su vigencia, sacada del
núcleo DGII. Si la decisión se apoya en un criterio propio de la empresa y no en
una norma, dilo así: *"criterio propio, no hay norma que lo obligue"*. Eso es
honesto y sirve. Inventar una norma no.

## Cuando un criterio cambia

No corrijas la entrada vieja. Escribes una **nueva** que la deroga y la nombra:

```markdown
- **Deroga:** 2026-07-30-sunix-combustible.md
```

Así queda el rastro de qué se pensaba antes y desde cuándo cambió. Una decisión
borrada es una pregunta sin respuesta dentro de seis meses.

## Qué NO va en el libro

Contraseñas, llaves, tokens ni datos de tarjeta. El libro va en git y lo lee
gente. Si una decisión menciona una credencial, describe cuál sin escribirla.
