# Proxy de IA agnóstico de proveedor

Arky 10 es **frontend-only**: no hay backend propio y toda llamada de IA sale
del navegador. Eso implica que cualquier variable `VITE_*_API_KEY` global viaja
dentro del bundle y es legible por cualquier usuario que abra DevTools.

El proxy serverless de Vercel (`api/ai.ts`) resuelve ese punto sin romper la
restricción de arquitectura: no es un backend de dominio, es un único endpoint
sin estado que reenvía la petición al proveedor con la llave del servidor.

---

## Componentes

| Archivo | Rol |
|---|---|
| `api/ai.ts` | Función serverless agnóstica de proveedor (Gemini u OpenRouter). |
| `api/_shared/proxyRuntime.ts` | Runtime común: lectura de body, identidad del cliente, rate limit en memoria, sobre de error JSON. Vercel no enruta archivos con prefijo `_`. |
| `services/ai/aiProxyClient.ts` | Cliente del proxy. Resuelve el endpoint (`VITE_AI_PROXY_URL`, o `/api/ai` por defecto en un build de producción), clasifica el resultado y degrada a `null` ante cualquier fallo. |
| `services/ai/generation/legacyTransport.ts` | Sus tres caminos (contenido, texto, streaming) intentan el proxy primero (`tryAiProxy`) y aplican la política estricta antes de un camino directo. Toda funcionalidad llega a un modelo por aquí, vía `aiGateway` o una fachada: desde F6-01 ninguna tiene ruta propia. |

---

## Variables de entorno

### Cliente (bundle)

| Variable | Descripción |
|---|---|
| `VITE_AI_PROXY_URL` | URL del proxy agnóstico. Ej.: `/api/ai`. **Opcional en producción**: un build de producción que no la define usa `/api/ai`, la función que este repo despliega junto al bundle (`DEFAULT_AI_PROXY_PATH`). Se rellena sólo si el proxy vive en otro dominio o en otra ruta. En `npm run dev` vacía significa «sin proxy»: no hay función serverless que servir y la llamada va directa. |

### Servidor (Vercel → Settings → Environment Variables)

Estas **no** llevan prefijo `VITE_`, por lo que Vite nunca las inyecta en el
bundle.

| Variable | Descripción |
|---|---|
| `GEMINI_API_KEY` | Llave de Google Gemini usada por el proxy. |
| `OPENROUTER_API_KEY` | Llave de OpenRouter usada por el proxy. |
| `AI_PROXY_MAX_REQUESTS_PER_WINDOW` | Peticiones por ventana de 60 s en `api/ai.ts` (default: 60). |

> El proxy **no** acepta `VITE_GEMINI_API_KEY` / `VITE_OPENROUTER_API_KEY`.
> Vite inyecta toda variable `VITE_*` en el bundle, así que honrarlas aquí
> premiaba justo la configuración peligrosa: satisfacían al proxy *y* publicaban
> la llave en cada navegador. En producción se definen **sólo** las variantes
> sin prefijo, y las globales `VITE_*_API_KEY` se dejan vacías.

### Qué hace falta para que la IA funcione en producción

Con el build de producción el proxy es obligatorio (fail-closed: sin él no hay
llamada directa con la llave del operador). El mínimo es una sola variable de
servidor:

1. `GEMINI_API_KEY` (u `OPENROUTER_API_KEY` según el proveedor) en
   Vercel → Settings → Environment Variables, **sin** prefijo `VITE_`.
2. `FIREBASE_PROJECT_ID` — opcional si ya existe `VITE_FIREBASE_PROJECT_ID`,
   que el proxy usa como respaldo para validar la audiencia del ID token.
3. `VITE_AI_PROXY_URL` — sólo si el proxy no es el `/api/ai` de este despliegue.

Sin llave de proveedor el proxy responde `500 missing_provider_api_key`, y el
cliente lo clasifica como `not-configured` (no como fallo del proveedor): es
configuración, y reintentar no la arregla. Mientras tanto cada usuario puede
seguir trabajando con su propia clave desde **Ajustes → IA**, que es la única
llamada directa que el modo estricto permite.

Ver `.env.example` para la plantilla completa (sin valores reales).

---

## Contrato HTTP

`POST /api/ai`

```jsonc
{
  "provider": "gemini" | "openrouter",   // default: "gemini"
  "model": "gemini-2.5-flash",
  "contents": "…",                        // string | Content[] de Gemini
  "systemInstruction": "…",               // opcional
  "temperature": 0.2,                      // opcional
  "maxOutputTokens": 2048,                 // opcional
  "responseMimeType": "application/json",  // opcional
  "responseSchema": { }                    // opcional (schema de Gemini)
}
```

### Modo no-streaming (respuesta JSON)

Respuesta correcta:

```json
{ "requestId": "aiproxy-…", "text": "…", "provider": "gemini", "model": "…" }
```

Respuesta de error (mismo sobre para todos los códigos):

```json
{ "requestId": "aiproxy-…", "error": "provider_rate_limited", "source": "gemini", "retryAfterMs": 30000 }
```

Códigos: `method_not_allowed`, `invalid_request_body`, `payload_too_large`,
`proxy_rate_limited`, `missing_provider_api_key`, `provider_rate_limited`,
`provider_unavailable`, `provider_error`.

### Modo streaming (SSE)

Añade `"stream": true` al body. El endpoint responde
`Content-Type: text/event-stream` y emite un evento por cada delta de texto,
terminando con el marcador `[DONE]`:

```text
data: {"text":"hola "}\n\n
data: {"text":"mundo"}\n\n
data: [DONE]\n\n
```

El cliente consume este flujo con `streamAiProxy` (`services/ai/aiProxyClient.ts`),
que devuelve `null` —y el llamador cae al streaming directo del proveedor— si el
proxy no está configurado o si el *open* falla. Un error en el *open* (auth, 4xx,
model 404) se reporta con el sobre JSON normal antes de comprometer las cabeceras
SSE; un fallo a mitad de flujo emite un evento terminal `{ "error": "stream_interrupted" }`
y cierra, porque es posible que parte de la salida ya esté en pantalla.

---

## Salida estructurada por proveedor

- **Gemini** — `responseMimeType` y `responseSchema` se reenvían tal cual. Los
  valores de `Type.*` del SDK son constantes string, así que el schema
  sobrevive el round-trip JSON y la salida estructurada se conserva íntegra.
- **OpenRouter** — no existe equivalente de `responseSchema`. Una petición con
  `responseMimeType: 'application/json'` degrada a `response_format:
  { type: 'json_object' }` (mejor esfuerzo). Los llamadores ya sanitizan y
  validan el JSON recibido, y todos tienen fallback determinístico.

---

## Degradación

`callAiProxy()` devuelve `null` ante **cualquier** fallo (red, rate limit,
error del proveedor, payload mal formado) y `generateContentWithFallback`
continúa por el camino directo, que conserva su propio pipeline de retry y
model fallback. El proxy es una optimización de seguridad, nunca un nuevo punto
único de falla.

Se excluyen del proxy las peticiones con `tools` / `toolConfig` (function
calling): el contrato de texto del proxy no puede transportar `functionCalls`,
así que esas llamadas siguen yendo directo al SDK.

---

## Streaming

El streaming (`generateContentStreamWithFallback`) **también** pasa por el proxy
cuando `VITE_AI_PROXY_URL` está configurado (modo `stream: true`, SSE). El cliente
`streamAiProxy` y el despacho del lado servidor preservan el contrato `{ text }`
por chunk, por lo que la UI token-a-token funciona igual que antes — pero la llave
global ya no viaja en el bundle tampoco en las rutas de streaming. Se aplican las
mismas exclusiones que a `generateContentWithFallback` (peticiones con `tools` /
`toolConfig` siguen yendo directo al SDK).
