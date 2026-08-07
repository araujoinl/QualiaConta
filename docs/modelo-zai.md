# El modelo: GLM de z.AI

Configuración verificada contra la cuenta real, no contra la documentación.

## Configuración que funciona

En `/opt/data/config.yaml` del contenedor, vía `hermes config set`:

```yaml
model:
  default: glm-5.2
  provider: custom
  base_url: https://api.z.ai/api/coding/paas/v4
  api_key: ${OPENAI_API_KEY}
```

La llave se referencia como `${OPENAI_API_KEY}` en vez de escribirse: así el
secreto vive sólo en el `.env` de la empresa y no queda copiado dentro del
volumen del agente.

## La trampa del endpoint

z.AI tiene **dos familias de endpoints** y la cuenta puede tener acceso a una
sin tener la otra:

| Endpoint | Qué es | Con el Coding Plan |
|---|---|---|
| `https://api.z.ai/api/paas/v4/` | API general, pago por uso | **falla** |
| `https://api.z.ai/api/coding/paas/v4` | Coding Plan, compatible con OpenAI | funciona |
| `https://api.z.ai/api/anthropic` | Coding Plan, compatible con Anthropic | funciona |

Con el Coding Plan y el endpoint general, z.AI responde:

```
HTTP 429 · code 1113 · "Insufficient balance or no resource package. Please recharge."
```

**Ese 429 no es un límite de velocidad.** Hermes lo traduce a "el proveedor está
limitando peticiones, esperá un momento", que manda a esperar cuando lo que hay
que hacer es cambiar de dirección. Si aparece ese mensaje en Telegram, mirar el
error crudo en `/opt/data/logs/errors.log` antes de creerle.

Cómo distinguirlo de una llave mala: una llave inválida da **401 "token expired
or incorrect"**. Si `GET /api/paas/v4/models` devuelve 200 pero una conversación
falla, la llave está bien y el problema es el plan o el endpoint.

## Modelos disponibles en la cuenta

`glm-4.5`, `glm-4.5-air`, `glm-4.6`, `glm-4.7`, `glm-5`, `glm-5-turbo`,
`glm-5.1`, `glm-5.2`.

Se usa **`glm-5.2`**, el más capaz. Cuando el contable empiece a resolver casos
por precedente, las tareas mecánicas pueden bajar a `glm-5-turbo` — eso es parte
de la meta de bajar el gasto, no una optimización prematura.

## Visión (leer fotos de facturas)

Verificado empíricamente el 2026-08-02, no contra la documentación:

- **`glm-5v-turbo` NO está en el Coding Plan**: el endpoint coding responde
  `429 · code 1311 · "Your current subscription plan does not yet include
  access to GLM-5V-Turbo"`. `glm-5v` no existe (`400 · 1211 Unknown Model`).
- **`glm-4.6v` sí funciona** contra el endpoint coding y transcribe bien.
- Los modelos de visión **no aparecen** en `GET /models` de ningún endpoint;
  listar modelos no sirve para descubrirlos, hay que probar un
  `chat/completions` con imagen.
- El auxiliar de visión debe apuntar **explícito** al endpoint coding
  (`auxiliary.vision`: `provider: custom`, `base_url:
  https://api.z.ai/api/coding/paas/v4`, `api_key: ${GLM_API_KEY}`). Con el
  provider builtin `zai` el `vision_analyze` cae al endpoint general, falla, y
  el fallback termina mandándole la imagen a glm-5.2, que la rechaza (1210).

## Para verificar la cuenta sin adivinar

Listar modelos comprueba que la llave sirve, pero **no** comprueba que haya
saldo. Para eso hay que pedir una conversación de verdad contra el endpoint que
se va a usar. Un `chat/completions` con `max_tokens: 16` alcanza y cuesta nada.

## Verificado 2026-08-02 (preflight preentrenamiento)

Corrida de verificación previa al preentrenamiento (Fase 0, puntos 1, 4 y 5 del
plan). Todo medido contra la cuenta real desde el gateway `qualiaconta-blackbox`
(Hermes v0.19.0).

### Endpoint: el builtin `zai` ya apunta al coding

`POST /chat/completions` con `max_tokens: 16` contra
`https://api.z.ai/api/coding/paas/v4` → **HTTP 200**, `model: glm-5.2`, sin
rastro del 429 code 1113. No hizo falta reconfigurar a `provider: custom`: el
config corriendo hoy es `provider: zai` (builtin) y `auth.json` tiene
`detected_endpoint` = `coding-global` (`https://api.z.ai/api/coding/paas/v4`),
o sea que Hermes ya resuelve solo al endpoint del Coding Plan. La receta
`provider: custom + base_url` de arriba queda como plan B documentado.

Detalle del ping: el `content` volvió **vacío** con `reasoning_tokens: 16` —
glm-5.2 razona por defecto y 16 tokens se van enteros al razonamiento. Para
pings de verificación, mirar el HTTP code y el `usage`, no el texto (o subir
`max_tokens` a ~50).

### Fallbacks: cadena corta y sin duplicados

- Antes: `glm-5-turbo` (una sola entrada; la glm-5.2 duplicada que se había
  visto en sesiones anteriores ya no estaba).
- Después: `glm-5-turbo` → `glm-4.7` (ambos provider `zai`).

Trampa del CLI: `hermes config set fallback_providers '[...]'` guarda el valor
como **string JSON**, no como lista YAML. Para claves de lista hay que editar
`config.yaml` del volumen a mano y verificar con `hermes config get`.

### `prompt-size` no mide lotes

`hermes prompt-size` **no acepta texto arbitrario**: reporta offline el
presupuesto fijo de una sesión nueva (system prompt, índice de skills, memoria,
perfil, schemas de tools). Medido hoy: system prompt 26.5 KB + tool schemas
47.8 KB (27 tools) + índice de skills 7.3 KB ≈ **~75 KB fijos por sesión**.
Implicación para el inyector de lotes: los tokens del lote los estima el script
por su cuenta (≈ chars/4); `prompt-size` solo aporta el overhead fijo a sumar.

### Overhead fijo real y shape del `--usage-file`

Un `hermes -z "resumí en 5 palabras: …" --usage-file /tmp/uso.json` devolvió un
JSON plano con estos campos:

```json
{
  "estimated_cost_usd": 0.0,
  "cost_status": "unknown",
  "cost_source": "none",
  "input_tokens": 50,
  "output_tokens": 16,
  "cache_read_tokens": 17728,
  "cache_write_tokens": 0,
  "reasoning_tokens": 0,
  "total_tokens": 17794,
  "api_calls": 1,
  "model": "glm-5.2",
  "provider": "zai",
  "session_id": "20260802_140248_6b3235",
  "completed": true,
  "failed": false,
  "service_tier": null
}
```

Dos lecturas útiles: el prompt fijo de sesión ronda **~17.7k tokens** y entró
entero por `cache_read_tokens` (el caché de z.AI está funcionando), y el Coding
Plan no reporta costo (`cost_status: unknown`) — la contabilidad del
preentrenamiento se hace por tokens del usage file, no por dólares.

### Techo de contexto (de metadata, no medido)

Según `models_dev_cache.json` (el caché de models.dev que usa Hermes):

| Modelo | Contexto | Output máx |
|---|---|---|
| glm-5.2 | 1.000.000 | 131.072 |
| glm-4.7 | 204.800 | 131.072 |
| glm-5-turbo | sin datos en el caché | sin datos |

Es la ficha del modelo, **no** una medición contra el endpoint coding: la
corrida empírica con un prompt de ~40k del plan de preentrenamiento sigue
pendiente. Hasta hacerla, sigue rigiendo el presupuesto conservador de ≤35k
input por turno.

## Verificado 2026-08-07 (latencia, cuota y razonamiento)

### Lo que de verdad cuesta: entrada contra salida

La sospecha de que un prompt grande hace lento al contable es **falsa**, y vale
escribirlo porque ya costó un día de trabajo. Medido sobre las 5.448 llamadas
que su propio `agent.log` tenía guardadas:

    corr(tokens de salida, latencia) = 0,76      <- lo que te hace lento
    corr(tokens de entrada, latencia) = 0,04     <- lo que NO te hace lento

El caché de prefijo de z.AI pega al **92%** en producción, así que re-mandar el
mismo SKILL.md en cada turno no cuesta segundos. Comprobado también en banco,
contra el endpoint de producción y fijando la salida en 700 tokens: un prompt de
1.141 tokens tarda 12,0 s y uno de 27.822 tarda 11,9 s.

**Pero la CUOTA sí se mide en entrada, y los cacheados cuentan a precio
completo.** Los dos cortes de 5 h que quedaron en el log:

| corte | llamadas | entrada |
|---|---|---|
| reset 2026-08-03 15:40 | 666 | **15,20 M** |
| reset 2026-08-04 03:45 | 690 | **15,10 M** |

Las llamadas difieren 3,5%; los tokens de entrada, 0,7%. Ésa es la respuesta a
la pregunta que `plan-preentrenamiento.md` deja abierta: el tope del Coding Plan
no es por prompts, es por tokens de entrada, y ronda los **15,1 M por ventana de
5 horas**.

Corolario para cualquier optimización futura: recortar el prompt compra CUOTA
(más trabajo por ventana, menos cortes de horas), no segundos. Los segundos se
compran en la salida.

Se reproduce con `mesa/medir-turnos.py`, que lee el `agent.log` del contenedor y
reporta entrada, salida, latencia, caché, las dos correlaciones y con cuánto se
topó cada corte.

### Cuánto piensa: `reasoning_effort`

El 90-95% de lo que el contable escribe es razonamiento, no respuesta: una
sesión real cerró con `out=67.714` de los cuales `reasoning=61.086`. Como la
latencia la manda la salida, ésa es la única perilla que la mueve de verdad.
Medido contra el endpoint de producción con el prompt real:

| nivel | latencia | tokens de razonamiento |
|---|---|---|
| `medium` (era el default) | 14,8 s | 847 |
| `low` (el que corre hoy) | **8,8 s** | 348 |
| `minimal` | 3,7 s | 0 |

**Va en `agent.reasoning_effort`, no en `model:`.** Es el único lugar donde
Hermes lo lee (`resolve_reasoning_config`); escrito dentro de `model:` no rompe
nada — se ignora en silencio y el contable sigue en el default, que es la peor
clase de error. Y ojo con YAML: `no`, `off` y `false` son BOOLEANOS, y para
Hermes eso significa razonamiento APAGADO, que no es lo mismo que un nivel bajo.

Por qué `low` y no `minimal`: en `minimal` el razonamiento se apaga, y el modo
de falla de este agente no es tardar — es inventar. La FP00001120 se registró
con una tasa de ITBIS que el papel nunca dijo porque se despejó la base para que
la aritmética cerrara. Seis segundos no valen reabrir esa puerta.

Lo escribe `deploy/configurar-modelo.sh` y lo verifica en su bloque `esperado`,
contra el string exacto y no contra «hay algo». No se toca a mano en el server:
`config.yaml` vive en el volumen, fuera de git, y un valor puesto a mano se
evapora con el próximo volumen sin que nadie se entere.

Para probar otro nivel o volver atrás, sin editar el script:

```bash
MESA_REASONING_EFFORT=medium ./configurar-modelo.sh
```
