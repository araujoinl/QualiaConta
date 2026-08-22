# CLAUDE.md — QualiaConta

Convenciones de este repo. La fuente de verdad del diseño es [SPEC.md](SPEC.md);
el lenguaje del dominio, [CONTEXT.md](CONTEXT.md). Léelos antes de generar nada.

> ⛔ **Antes de dibujar cualquier cosa visible, leé
> [docs/brand/qualia_manual_marca_v2.html](docs/brand/qualia_manual_marca_v2.html).**
> Es obligatorio y no admite excepción. Ver "El manual de marca manda" abajo.

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
  `https://api.z.ai/api/coding/paas/v4` (el del Coding Plan; el general no
  atiende con este plan — ver [docs/modelo-zai.md](docs/modelo-zai.md)). El
  principal se elige desde el panel de AI Engines de Labs_Inv, no con
  `hermes model` ni editando scripts.
- **Superficie:** mesa de trabajo web en Labs_Inv (módulo ADM Cloud) para el
  trabajo diario; Telegram vía `hermes gateway` para consultas y avisos.
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
9. **El manual de marca manda sobre todo lo visible.** Ningún color, tipografía,
   radio, sombra, espaciado, ícono, forma ni animación se inventa: se toma del
   manual. Si el manual no lo tiene, el manual se cambia primero — y recién
   entonces se dibuja. Ver la sección siguiente.

## El manual de marca manda

**Fuente única:** [docs/brand/qualia_manual_marca_v2.html](docs/brand/qualia_manual_marca_v2.html).
Lo anterior (`docs/brand/archivo/`) es histórico: no se cita, no se copia, no se
consulta. Los 12 ejemplos vivos están en `docs/brand/pantallas/` y los assets
oficiales en `docs/brand/assets/`.

### Cómo se usa, en orden

1. **Leer el manual antes de escribir la primera línea de HTML/JSX/CSS.** No de
   memoria: abrir el archivo. Los tokens están en su bloque `:root`
   (sección 1, "TOKENS"); la referencia copiable, en §33 (`#s33`); lo prohibido,
   en §35 (`#s35`).
2. **Buscar la pieza en `docs/brand/pantallas/`.** Si la pantalla nueva se
   parece a una que ya existe (tabla → `movimientos.html`, formulario →
   `configuracion.html`, panel → `resumen.html`), se copian **esos** patrones.
   Recrear un componente que el manual ya define es un error.
3. **Todo valor sale de una variable CSS.** `var(--blue)`, nunca `#1958FF`
   escrito a mano. Un hex crudo en el diff es señal de que alguien inventó.
4. **El espaciado es múltiplo de 8** (`--m:8px`, o mitades). Nada de 7, 13, 22.
5. **Tipografía:** sólo `var(--sans)` (Inter) y `var(--mono)` (IBM Plex Mono).
   Números en tablas y montos siempre `.tnum`. Ninguna fuente nueva, jamás.
6. **Color:** el azul es el único color con significado (§7). Verde, ámbar y
   rojo son estados de sistema, no decoración. El navy nunca es fondo de
   pantalla. El fondo del producto es `--paper`.
7. **Movimiento:** sólo del catálogo de §32, con `--t-*` y `--ease`. Sin rebote,
   sin animación decorativa.
8. **Accesibilidad no es opcional** (§31): foco visible con `--blue-focus`,
   contraste verificado, nada que dependa sólo del color.

### Lo que está prohibido, sin discusión

- Un color, sombra, radio o espaciado que no esté en el bloque de tokens.
- Una librería de UI nueva, un set de íconos nuevo, una fuente nueva.
- Gradientes, glass o efectos fuera de los `--glass-*` definidos.
- Formas fuera de las cuatro permitidas (§2) o el logo deformado (§3, §4, §6).
- Modo oscuro improvisado: el manual v2 es modo claro. Si hace falta oscuro, se
  agrega al manual primero.
- Copiar estilos del manual v1 archivado.

### Si el manual no cubre el caso

Parás y me preguntás. La respuesta correcta nunca es improvisar: es agregar la
pieza al manual (§36 dice cómo se cambia el documento), que yo la apruebe, y
recién ahí dibujar. Un componente sin entrada en el manual no se commitea.

### Antes de decir "listo" en cualquier tarea de UI

1. `grep -nE '#[0-9a-fA-F]{3,8}\b' <archivos tocados>` → cero resultados fuera
   del bloque `:root`.
2. La pantalla nueva abierta al lado de su hermana de `docs/brand/pantallas/`:
   mismo padding, misma tipografía, mismos botones, mismos estados.
3. Estados de cargando, vacío y error presentes (§28). Sin eso no está hecha.
4. Consola del browser sin errores.

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
5. Si el diff toca algo visible: la lista de "Antes de decir listo en cualquier
   tarea de UI" corrida entera, sin saltarse el grep de hex.
