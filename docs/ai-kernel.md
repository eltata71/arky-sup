# El AI Kernel canónico

`services/ai` es la única puerta a un modelo. Esta es la regla, y es la que
todas las demás sostienen:

```
Domain / Agent / Orchestration → Canonical AI Kernel → Provider Adapter → Provider API
```

Nunca `Agent → Gemini/OpenAI/Claude/OpenRouter`.

> Los agentes conocen capacidades, no proveedores.
> El orquestador conoce trabajo, no SDKs.
> El router conoce políticas, capacidades y salud.
> Los adaptadores conocen proveedores.
> El dominio permanece independiente de todos ellos.

Las decisiones y su porqué están en `specs/02-architecture/ADR/ADR-002` (el
contrato canónico) y `ADR-003` (el routing). Este documento es el operativo:
qué hay, cómo se añade algo y qué falta.

---

## Los módulos, y qué decide cada uno

| Módulo | Decide |
|---|---|
| `core/` | El contrato. `AIRequest`, `AIResponse`, `AIContentPart`, `AIToolDefinition`, `AIProviderCapabilities`, `AIPolicy`, `AIError`, `AITrace` — y el `AIRequestExecutor`, que recorre el plan |
| `capabilities/` | Qué le falta al backend para esta petición, y si eso se informa o se rechaza |
| `catalog/` | Qué modelo concreto significa un tier **en el espacio de ids de cada proveedor** |
| `routing/` | Qué backend sirve la petición, qué se intenta después, y por qué |
| `providers/` | La traducción a una API concreta. Nada más |
| `errors/` | Cómo se clasifica un fallo (`AIErrorClassifier`) y qué se hace con él (`retryDecisions`) |
| `retry/` | Backoff y timeout |
| `tracing/` | El registro de lo que pasó |
| `schema/` | El dialecto neutral de JSON Schema y sus adaptadores |
| `tools/` | Las herramientas declaradas y sus adaptadores por proveedor |
| `guardrails/` | Qué no puede salir y qué no puede volver, y con qué severidad |
| `generation/` | Las fachadas de dominio — la superficie que importa el resto de la app |

---

## Las cuatro reglas de honestidad del kernel

Son las mismas cuatro que sostienen el resto del producto, aplicadas aquí.

1. **Una capacidad declarada existe.** No hay `embeddings` porque ningún
   adaptador responde a ella. Publicar una capacidad que sólo puede lanzar una
   excepción es una mentira que el sistema de tipos ayuda a contar.
2. **Una garantía obligatoria no se degrada en silencio.** `required` reenruta
   antes de gastar un token, y falla cuando no hay ruta. `preferred` y
   `optional` se informan y la petición sigue.
3. **La decisión viene con su composición.** `AIRouteDecision` enumera lo
   exigido, lo considerado con su puntuación y lo rechazado con su motivo. Una
   ruta que no se puede reconstruir es una ruta de la que nadie responde.
4. **Lo que no se puede llevar se nombra, nunca se descarta.** Un adjunto que un
   backend no admite llega como `[imagen adjunta: … — no disponible]`, no como
   silencio: un modelo que perdió el adjunto responde con seguridad sobre nada.

---

## Cómo se hace cada cosa

### Añadir un proveedor

1. `services/ai/providers/<id>/<Id>Provider.ts` implementando `AIProvider`.
   Declara `capabilities` con **lo que el adaptador implementa**, no con lo que
   el fabricante anuncia: si el adaptador manda sólo texto, `images: false`,
   aunque el modelo vea imágenes. El router usa esa declaración para decidir si
   puede mandarte una imagen.
2. Un `ProviderModelCatalog` en `catalog/catalogs.ts`: tabla de tiers, cadena de
   fallback, modelo por defecto y la regla `owns()` que reconoce sus ids.
3. Regístralo en `AIProviderFactory`.
4. Un `ProviderHarness` en `__tests__/services/ai/conformance/harnesses.ts`. **Ni
   una aserción del suite cambia**; si tuvieras que cambiar alguna, la
   abstracción tiene una fuga y merece saberse antes de publicar el proveedor.

### Añadir un modelo

Sólo el catálogo del proveedor. Nada fuera de `catalog/` y de un adaptador
nombra un id concreto de modelo — resuelve un tier con
`resolveModelForSettings`.

### Añadir una herramienta

Declárala una vez como `AIToolDefinition` en `services/ai/tools/`, con
`defineSchema` para los parámetros. Los adaptadores la traducen
(`toGeminiTools` / `toOpenAITools` / `toAnthropicTools`). No montes
`functionDeclarations` en el call site: esa era la forma antigua y hacía que la
única flecha posible apuntara del formato del fabricante hacia el canónico.

### Pedir una garantía

```ts
const request: AIRequest = {
  purpose: 'artifact-generation',
  prompt,
  responseSchema: schema,
  requiredCapabilities: [
    { capability: 'structured-output', level: 'required',
      reason: 'El compilador de artefactos consume el JSON por esquema.' },
  ],
};
```

Lo implícito ya se deriva: un `responseSchema` implica `structured-output`
(`preferred`, o `required` si la política lo dice), unas `tools` implican
`tools` en `required`, un adjunto implica `images`/`files`. `requiredCapabilities`
es para lo que sabe quien llama y la forma de la petición no muestra.

### Diagnosticar una ejecución

Todo cuelga de `AITrace`: `requestId`, `operationId`, `providerRequested` vs
`provider`, `fallbackModelUsed`, `fallbackProviderUsed`, `retryCount`,
`stopReason`, `usage` (incluido `cachedPromptTokens`), `providerRequestId` — el
id que citar en un ticket con ese fabricante — y `routeDecision`, que explica la
elección del backend.

---

## Los guardrails, y por qué están donde están

Tres severidades, y la diferencia entre ellas es **qué puede hacer el llamante
después**, no lo alarmante que suene el hallazgo:

| Severidad | La llamada | Cuándo |
|---|---|---|
| `warning` | ocurre | el hallazgo se registra en la traza y nada más |
| `recoverable-block` | no ocurre | repetir la misma petición fallaría igual; hay que cambiar algo |
| `hard-block` | no ocurre, y no se reintenta | lo irreversible: una credencial enviada a un tercero no se puede des-enviar |

Dos reglas hoy en la entrada y una en la salida. `secret-in-prompt` y
`secret-in-output` bloquean duro contra las formas publicadas de clave
(`lib/secretShapes.ts`). `prompt-injection-signal` **sólo avisa**, y esto es una
decisión propia de este producto: Arky escribe documentos de arquitectura, y
varios son de seguridad. Un ADR sobre inyección de prompts contiene literalmente
«ignora las instrucciones anteriores». Bloquear por la frase castiga escribir
sobre el ataque con más fiabilidad que al ataque, y un guardrail que impide el
trabajo normal es uno que alguien apaga —llevándose por delante la comprobación
de credenciales.

La mitigación de la inyección es **la valla**: `wrapUntrustedContent`
(`lib/untrustedContent.ts`) envuelve todo lo que la aplicación no escribió con
una instrucción que dice que es material a analizar, nunca órdenes a obedecer, y
neutraliza las marcas que el propio contenido traiga —sin eso, un documento
podría cerrar su bloque y seguir hablando como si fuera el sistema. No es una
garantía y no se vende como tal: es el control más barato que existe, cuesta
unos pocos tokens, sobrevive a cualquier proveedor y deja el límite explícito
tanto para el modelo como para quien lea el prompt en una traza.

**Dónde corren, que es la mitad del requisito.** «Antes de gastar tokens» es una
afirmación sobre posición: el guard de entrada está *encima* de la política de
reintentos, de la cadena de modelos y del fallback de proveedor, así que una
petición bloqueada deja el contador de llamadas en cero y no en una por
candidato. Y son **tres caminos**, porque la migración estranguladora no ha
terminado:

| Camino | Dónde se aplica |
|---|---|
| Ejecutor canónico | `core/requestGuards.guardRequest`, desde `execute` y `executeStream` |
| Proxy serverless | `aiProxyClient.buildRequestBody`, **fuera del `try`** |
| Fachada legacy | `generation/legacyGeminiBridge.routeLegacyRequest` |

Los dos detalles que parecen menores y no lo son. En el proxy el cuerpo se
construye **fuera** del `try`: ese cliente convierte cualquier excepción en un
*outcome*, y todos sus outcomes mandan al llamante a intentar la llamada directa
al proveedor —la única ruta que un prompt bloqueado no debe encontrar. Y en la
fachada legacy el guard vive en `routeLegacyRequest` porque el monolito no tiene
un único punto de entrada: tres de sus métodos llegan al modelo por su propia
cadena, pero los tres enrutan por ahí primero, y hacerlo así no le añade un solo
byte a un fichero cuyo techo no tiene holgura por diseño.

El hallazgo viaja en `AITrace.guardrails`, incluido el que bloquea y **antes**
del throw: una traza que dice `invalid-request` y nada más es un rechazo que
nadie puede explicar.

---

## Lo que este kernel **no** hace todavía

Se dice aquí porque una capa que promete más de lo que cumple es exactamente el
problema que este trabajo vino a arreglar.

- **`services/geminiService.ts` sigue llamando al SDK de Google directamente**
  cuando el proveedor resuelto es Gemini. El puente
  (`generation/legacyGeminiBridge.ts`) traduce la llamada legacy a `AIRequest`
  para el camino canónico, pero la traducción **no es sin pérdida**:
  `contentsToPrompt` aplana un `Content[]` multi-turno a una cadena, así que
  usarla para Gemini haría que todo chat perdiera sus turnos. Migrar eso es
  trabajo call-site a call-site, no un interruptor.
- **No hay Tool Registry con permisos, aprobación ni idempotencia.** Hay una
  herramienta en todo el producto (`modifyArtifact`). Un registro con
  `riskLevel`, `allowedAgents` y `requiresApproval` para una herramienta sería
  abstracción especulativa; el modelo de aprobación e impacto que ya existe vive
  en `services/agent` y es donde crecería.
- **Los guardrails no moderan contenido ni redactan datos personales.** Detectan
  credenciales y señalan frases dirigidas a un modelo; no clasifican toxicidad,
  no buscan PII/PHI y no reescriben nada. Un detector de datos personales sin
  un catálogo del dominio produce falsos positivos sobre nombres de sistemas y
  de personas —que es de lo que trata una arquitectura— y el que se apaga es el
  que también comprobaba las claves.
- **Los guardrails de salida no inspeccionan un stream.** Un fragmento sólo se
  puede leer cuando ya está en pantalla: el bloqueo llegaría después de la
  divulgación y además destruiría la respuesta. La generación *buffered* —la
  que produce artefactos y se persiste— es donde el control paga su coste.
- **No hay harness de evaluación.** Las pruebas son deterministas y no consumen
  APIs reales; medir calidad de modelo/agente/orquestación contra un baseline es
  un sistema aparte.
- **La salud del backend vive en memoria, por pestaña.** No hay servidor propio
  donde compartirla, y persistirla haría que un registro rancio sobreviviera a
  la caída que describía.
- **`estimateUsage` no calcula coste.** `AIUsage` ya lleva
  `cachedPromptTokens` y `timeToFirstTokenMs`, que es lo que un modelo de coste
  necesitaría; el modelo en sí no existe.

---

## Las reglas están en pruebas, no en este documento

`__tests__/services/ai/kernelArchitectureRules.test.ts` escanea el código —no
los comentarios— y falla si vuelve cualquiera de estas:

| Regla | Lo que rechaza |
|---|---|
| Sin SDK ni endpoint de fabricante fuera de `providers/` | `@google/genai` o `api.anthropic.com` en el core |
| `core` no importa `providers/` | La capa de contratos dependiendo de los adaptadores que oculta |
| El executor no tiene clasificador por defecto de un fabricante | El defecto que originó todo esto |
| `AIRequest` sin `rawContents`, con `tools` tipadas y `providerConfig` por proveedor | El payload de fabricante dentro del contrato neutral |
| Ninguna capacidad sin implementación; ningún `supportsX` suelto | `embeddings`, y el cast opcional de `supportsTools` |
| El contrato de herramientas apunta en un sentido | `fromGeminiTools`, y `functionDeclarations` en el monolito |

Y `__tests__/services/ai/conformance/` corre 93 aserciones idénticas contra los
tres adaptadores, **sobre lo que llega al cable**, no sobre lo que el proveedor
declara.
