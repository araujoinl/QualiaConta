# CLAUDE.md — QualiaConta

Convenciones de este repo. La fuente de verdad del diseño es [SPEC.md](SPEC.md);
el lenguaje del dominio, [CONTEXT.md](CONTEXT.md). Léelos antes de generar nada.

## Qué es este repo

QualiaConta no es una aplicación: es la **configuración, las skills y la memoria**
de un contable por empresa que corre sobre Hermes Agent. Acá vive lo que le
enseña a ser contable dominicano, no el agente.

Si algo se puede resolver configurando Hermes en vez de escribiéndolo, se
configura.

## Stack

- **Agente:** Hermes Agent (Nous Research, MIT). Python 3.11 + Node, config y
  skills en `~/.hermes/`.
- **Modelo:** GLM de z.AI, endpoint compatible con OpenAI en
  `https://api.z.ai/api/paas/v4/`. Se cambia con `hermes model`, sin tocar código.
- **Superficie:** Telegram vía `hermes gateway`, un chat por empresa.
- **Libro oficial:** ADM Cloud. Lectura por SQL de sólo lectura, escritura por
  API REST con Basic Auth sobre `https://api.admcloud.net/api/`.
- **Banco:** tablas `openbanking_*` en la Supabase de Labs_Inv. Sólo se leen; el
  colector no se modifica desde acá.
- **Despliegue:** Docker Compose en CodeBox, una carpeta por empresa.
- **Skills:** estándar abierto de agentskills.io.

## Reglas que no se rompen

1. **ADM Cloud es el libro oficial.** Nada de contabilidad paralela, ni siquiera
   "para cachear". Un espejo de lectura no es un libro.
2. **El libro de acción sólo se agrega.** Una decisión es un archivo nuevo, jamás
   la edición de uno existente. Un commit que modifica un archivo del libro es
   un error, no un cambio.
3. **Toda entrada del libro lleva Alcance.** Sin alcance documenta pero no
   automatiza, y el contable vuelve a preguntar lo mismo.
4. **Toda regla del núcleo DGII lleva rango y vigencia.** Norma, interpretación o
   criterio propio; desde cuándo aplica. Sin eso no entra.
5. **Los límites viven en los permisos de ADM Cloud, no en el prompt.** Ver
   SPEC §5. El agente lee documentos de terceros y escribe sus propios scripts:
   ningún control basado en instrucciones sobrevive a eso.
6. **Nunca crear artículos sin OK.** Y antes de proponer uno, buscar duplicados
   por código de proveedor, nombre parecido y código de barras.
7. **Secretos sólo en el `.env` de la empresa**, fuera de git. Nunca en la
   memoria, nunca en el libro, nunca en un log.
8. **Ninguna empresa se conecta sin su rol de ADM Cloud recortado.**

## Al escribir skills

- Una skill resuelve un caso y explica en qué se apoya. Si necesita una regla
  fiscal, la cita del núcleo con su norma; no la lleva escrita adentro.
- Las skills que el agente genere solo también viven en git. Se revisan como
  cualquier código: si el contable escribió un script que registra mal, se ve
  en el diff.
- Nada de credenciales dentro de una skill.

## Al tocar el histórico

Destilar es una operación de una sola vez: el material entra, salen reglas
escritas, y el material no se vuelve a leer en cada corrida. Si una skill
relee las carpetas viejas en cada ejecución, está mal diseñada — ése es
exactamente el gasto que el proyecto existe para eliminar.

## Verificación antes de cerrar tarea

No hay typecheck ni tests todavía. Mientras tanto:

1. Los documentos siguen coherentes entre sí (SPEC, CONTEXT, ROADMAP).
2. Ninguna decisión nueva contradice las 18 de SPEC §1 sin decirlo explícito.
3. `git status` para confirmar qué cambió.
4. Ningún `.env` ni credencial en el diff.
