# F5-01, corte 4 — la vertical de recomendaciones

**Fecha:** 2026-09-23 · **Rama:** `claude/repo-review-status-p6artd` · **Base:**
`origin/main` en `4c497d3` (corte 3 fusionado, #58).

`recommendationService` es la primera fachada que sale **entera** del motor:
sus dos métodos —`recommendCustomArtifactTemplate` («Artefacto a solicitud») y
`getSuggestedActions`— y todo lo que sólo ellos usaban viven ahora en
`services/ai/generation/recommendation/`:

| Fichero | Qué contiene |
|---|---|
| `customArtifactIntent.ts` | tokenización, análisis de intención y puntuación del catálogo (puro) |
| `customArtifactHeuristics.ts` | resumen de contexto, recomendación local, nombre y confianza (puro) |
| `customArtifactNormalization.ts` | lectura desconfiada de la respuesta del modelo |
| `customArtifactRecommendation.ts` | la llamada, las fases y la degradación a la ruta local |
| `suggestedActions.ts` | las dos acciones siguientes sugeridas |

Los prompts, esquemas, umbrales (bypass local con `topScore ≥ 40` y hueco
`≥ 12`), presupuestos (35 s, dos reintentos, 700 tokens) y mensajes de fase se
movieron sin cambios.

| Medida | Antes | Después |
|---|---:|---:|
| Importadores directos de `geminiService` dentro de `services/ai` | 5 | **4** |
| Líneas del motor según el gate | 4 950 | **3 904** |
| Bytes del motor | 247 533 | **193 370** |
| `services (raíz) -> services/ai`, imports profundos | 10 | **9** |
| Tipos `any` | 17 | **15** |
| Aristas declaradas | — | `+ services/ai -> constants.ts`, `− services (raíz) -> constants.ts` |

## Lo que no fue sólo mover

- **La recomendación se saltaba el proxy.** Construía su propio cliente Gemini
  con `getAIClient`, así que no pasaba por el proxy serverless, ni por el
  guardarraíl de entrada, ni por el enrutado de proveedor. En producción —con
  las claves sólo en el servidor— nunca llegaba a un modelo y siempre respondía
  la ruta local determinista. Ahora entra por `aiGateway` con su propio
  presupuesto y **un solo modelo** (`maxCandidates: 1`), como antes: el
  respaldo es el ranker local, no un segundo modelo. El reintento sin esquema
  ante un `invalid-request` se conserva.
- **`emitGenerationPhase` bajó a `lib/artifacts/generationPhase.ts`**, junto al
  evento que emite. El motor (generación de artefactos) y la vertical la
  comparten; dejarla en el motor mantenía la arista, y ponerla dentro de
  `services/ai` hacía que el motor entrara por una puerta profunda.
- **Código muerto del motor.** `retryWithBackoff` y `withAbortableTimeout`
  sólo los usaba la recomendación; `withTimeout` ya no tenía llamantes. Se
  borraron los tres, con dos `any`. Las pruebas de `retryWithBackoff` en
  `geminiErrorHandling.test.ts` se **trasladaron** al bucle de reintentos del
  transporte (`LegacyGenerationTransport.runWithModelFallback`), que es donde
  vive hoy la regla «un 429 no se reintenta»; la de backoff exponencial ya la
  cubre `AIRetryPolicy.test.ts`.
- **El motor ya no importa `constants.ts`**: el catálogo sólo lo leían estas dos
  funciones.

## Verificación ejecutada

Ver el resumen de la PR: typecheck, `typecheck:strict` (la vertical entera
entra en el cierre estricto), ESLint, los cuatro presupuestos, la suite
completa, build y chequeos de bundle.

## Lo que queda

Cuatro importadores del motor: documentos, diagramas, asistente y artefactos.
El siguiente corte propuesto es **documentos** (cinco métodos).
