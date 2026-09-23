# F5-01, corte 5 — la vertical de documentos

**Fecha:** 2026-09-23 · **Rama:** `claude/repo-review-status-p6artd` · **Base:**
`origin/main` en `26b154f` (corte 4 fusionado, #59).

`documentGenerationService` sale entera del motor. Sus cinco métodos viven en
`services/ai/generation/documents/`:

| Fichero | Métodos |
|---|---|
| `sddDocuments.ts` | `generateSDDProcessPlan`, `generateSDDHealthReport` |
| `documentConversions.ts` | `convertDiagramToDocument`, `synthesizeSmartNote` |
| `memoryEntryExtraction.ts` | `extractMemoryEntriesFromDocument` |

Es un corte limpio: los cinco ya usaban el transporte compartido
(`generateContentWithFallback`), así que pasan a `aiGateway` —que delega en el
mismo transporte— sin cambio de comportamiento. Prompts, temperaturas,
`maxRetries: 1` de la extracción y su filtrado de la respuesta se movieron sin
cambios. No hubo que mover ningún helper compartido ni declarar aristas nuevas.

| Medida | Antes | Después |
|---|---:|---:|
| Importadores directos de `geminiService` dentro de `services/ai` | 4 | **3** |
| Líneas del motor según el gate | 3 904 | **3 661** |
| Bytes del motor | 193 370 | **183 350** |
| Tipos `any` | 15 | 15 |

## Pruebas nuevas

Ninguno de los cinco métodos tenía prueba propia dentro del motor.
`__tests__/services/ai/documentsVertical.test.ts` fija que el motor ya no los
declara, que la fachada no lo importa, la temperatura y el prompt de cada
generación, y para la extracción de memoria qué sobrevive de la respuesta del
modelo (sólo cadenas, recortadas, ≤ 400 caracteres, ≤ 50 entradas, y ninguna si
la respuesta no parsea).

## Lo que queda

Tres importadores del motor: diagramas, asistente y artefactos. Siguiente
corte propuesto: **diagramas** (seis métodos).
