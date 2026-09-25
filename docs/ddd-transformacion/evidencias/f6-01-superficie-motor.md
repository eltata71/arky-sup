# F6-01, tercer corte — la superficie del motor que sólo leían las pruebas

**Fecha:** 2026-09-25 · **Base:** F6-01 corte 2 (#78). **Cierra F6-01.**

Después de F5-01 al motor de generación de artefactos
(`services/ai/generation/artifacts/artifactGenerationEngine.ts`) solo le quedaba
una capacidad, `generateArtifactContent`. Seguía publicando, sin embargo, cinco
miembros más:

| Miembro | Quién lo usaba |
|---|---|
| `getAIClient` | nadie fuera; se inyectaba a su propia instancia del transporte |
| `generateContentWithFallback` | sólo pruebas |
| `generateContentStreamWithFallback` | sólo pruebas |
| `isOpenRouterConfigured` | sólo pruebas |
| `runWithModelFallback` (privado) | nadie |

Ahora el motor usa el **transporte compartido** (`legacyTransport`) en vez de
construir el suyo, y su única superficie pública es `generateArtifactContent`.
Tres consecuencias:

- **Una sola costura para las pruebas**: `legacyTransport.getAIClient`. Antes
  había dos, la del motor y la del transporte, y una prueba podía doblar la
  equivocada sin enterarse.
- **El motor ya no importa `@google/genai`**, y sale de la excepción de ESLint.
  El SDK de Gemini se importa solo en `providers/gemini/` y en `api/ai.ts`.
- `geminiServiceFacade.test.ts` apunta ahora al transporte, que es donde
  siempre vivió el comportamiento que comprueba.

Motor: 1 786 → **1 723 líneas**, 94 962 → 92 638 bytes; los techos se bajan.

## De paso, otra «inestabilidad» con la misma causa

`publicApiSurface.test.ts` falló por tiempo en una tanda grande: importaba en
frío el barril entero de la IA dentro de una aserción, y eso son 9,5 s con el
equipo libre. Es la misma causa que `OfficeContext.test.tsx` en el corte 2, y
el mismo arreglo: un `beforeAll` con su propio límite. Ahora tarda 1 ms.

## F6-01, en conjunto

| Corte | Qué |
|---|---|
| 1 (#77) | seis ficheros sin consumidor, y `noOrphanModules.test.ts` |
| 2 (#78) | el proxy heredado `api/gemini.ts` y el fallo de la creación guiada en producción |
| 3 | la superficie pública del motor que sólo leían las pruebas |
