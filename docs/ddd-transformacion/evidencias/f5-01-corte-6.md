# F5-01, corte 6 — la vertical de diagramas

**Fecha:** 2026-09-23 · **Rama:** `claude/repo-review-status-p6artd` · **Base:**
`origin/main` en `a43fad5` (corte 5 fusionado, #60).

`diagramGenerationService` sale entera del motor. Sus seis métodos públicos y
tres privados viven en `services/ai/generation/diagram/`:

| Fichero | Contenido |
|---|---|
| `diagramGenerationConfig.ts` | `THINKING_BUDGET`, `buildDiagramGenerationConfig`, `diagramTemperature` — compartidos con la generación de artefactos del motor |
| `diagramIRGeneration.ts` | `generateDiagramIR`, `generateDiagramIRWithSelfHealing`, el reintento correctivo |
| `diagramIRRefinement.ts` | `generateAndRefineDiagramIR`, crítica y refinado, metadatos de calidad |
| `mermaidToReactFlow.ts` | `parseMermaidToReactFlow` |
| `excalidrawConversion.ts` | `convertToExcalidrawJSON` |
| `diagramRepair.ts` | `fixDiagramError` |

Prompts, esquemas, presupuestos y **el transporte de cada llamada** se
conservaron: la IR sigue por `generateTextWithFallback` y las conversiones por
`generateContentWithFallback` (vía `aiGateway`, que es la misma función).

| Medida | Antes | Después |
|---|---:|---:|
| Importadores directos de `geminiService` dentro de `services/ai` | 3 | **2** |
| Líneas del motor según el gate | 3 661 | **2 809** |
| `services (raíz) -> services/diagram`, imports profundos | 6 | **3** |
| `services (raíz) -> services/ai`, imports profundos | 9 | 9 |
| Tipos `any` | 15 | 15 (dos se mudaron con el código) |

Las fronteras: la vertical toma `detectArchitecturalViolations`,
`analyzeDiagramQuality` y `runDiagramQualityGate` por el barril de
`services/diagram` (dos exportaciones nuevas), y el motor entra a todo lo de
diagramas por un solo import de `generation/diagram`, que reexporta las tres
piezas de `prompts/diagramPrompts` que el motor aún lee. Así ningún
presupuesto de imports profundos sube.

## Hallazgo: el camino de texto no pasa por el proxy

`legacyTransport.generateTextWithFallback` —el que usa la generación de IR, su
crítica y refinado, y la generación de artefactos del motor— **no intenta el
proxy**, a diferencia de `generateContentWithFallback`. Con Gemini como
proveedor va directo a `getAIClient`, y `effectiveGeminiApiKey` lanza «No se
encontró una API Key personal» salvo que el usuario tenga clave propia. En
producción, donde la clave de operador vive sólo en el servidor, eso significa:

- la IR de diagramas nunca llega a un modelo y acaba en el esqueleto
  determinista (la autorreparación lo disimula: el lienzo nunca queda vacío);
- la generación de artefactos del motor choca con lo mismo.

No se arregló en este corte, que era de movimiento. **Arreglado en el cambio
siguiente:** `generateTextWithFallback` llama ahora a `tryAiProxy` antes del
SDK, igual que los otros dos caminos; la prueba nueva de
`geminiServiceFacade.test.ts` falla sin el arreglo con el mismo mensaje que veía
el usuario.

## Pruebas

`__tests__/services/ai/diagramVertical.test.ts`: el motor ya no declara los
métodos, la fachada no lo importa, la IR descarta aristas y miembros de grupo
colgantes, devuelve `null` si el modelo declina o no da nodos, y la
autorreparación recorre sus tres peldaños (directo, correctivo, esqueleto) o se
detiene en el primero cuando rinde nodos. `diagramGenerationConfig.test.ts` y
`geminiServiceFacade.test.ts` se repuntaron a la vertical.

## Lo que queda

Dos importadores del motor: asistente y artefactos.
