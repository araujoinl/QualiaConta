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

## Para verificar la cuenta sin adivinar

Listar modelos comprueba que la llave sirve, pero **no** comprueba que haya
saldo. Para eso hay que pedir una conversación de verdad contra el endpoint que
se va a usar. Un `chat/completions` con `max_tokens: 16` alcanza y cuesta nada.
