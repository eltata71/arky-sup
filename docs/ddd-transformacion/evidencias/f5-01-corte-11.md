# F5-01, corte 11 — revisión, mejoras y casos de prueba

**Fecha:** 2026-09-23 · **Base:** `main` en `78b92ae` (#67 fusionada).

`reviewArtifact`, `applyArtifactImprovements` y `generateTestCases` salen de
`services/geminiService.ts` a `services/ai/generation/artifactReview.ts`. La
fachada `artifactGenerationService` conserva las tres firmas. Prompts,
temperaturas (0,3 y 0,7), presupuesto de reintentos (`maxRetries: 1`,
`maxCandidates: 4` al aplicar mejoras) y esquema JSON de la revisión se
mantienen; la llamada pasa por `aiGateway`.

Los tres comparten lo que los hacía un corte limpio: leen un artefacto ya
guardado y el prompt base de su proyecto, y ninguno necesita la canalización
de generación, las personas de la Oficina ni el grafo de conocimiento.

**Un puerto en vez de una arista.** La forma de la sugerencia se declara en
la vertical (`ArtifactImprovementProposal`) en lugar de importarse de
`services/review`: es estructuralmente idéntica a `ArtifactReviewSuggestion`,
los llamantes la pasan sin cambios y la prueba lo comprueba. Es el patrón del
corte 7. Importarla habría abierto `services/ai -> services/review` por una
interfaz.

**La revisión deja de devolver lo que no ha comprobado.** El motor devolvía
`JSON.parse` tal cual; `toImprovementProposals` conserva sólo las entradas con
los cuatro campos y una categoría del vocabulario, así que una sugerencia sin
categoría no llega al panel de revisión.

**Tres métodos se borran en vez de moverse.** `generateImageForArtifact`,
`generateSpeechForArtifact` y `generateSvgForArtifact` no tenían **ningún
llamante** en el repositorio, ni en pruebas. Con ellos se van
`assertModalitySupported`, `Modality` e `IMAGE_MODEL`/`TTS_MODEL` del motor
(las constantes siguen en `lib/ai/modelCatalog.ts`, con su prueba). Mover
código muerto a la capa nueva sólo le habría dado otra dirección.

## Cifras

| | antes | después |
|---|---|---|
| Motor (líneas según el gate) | 2 330 | **2 145** |
| Motor (bytes) | 121 681 | **113 588** |
| `services (raíz) -> services/ai` (imports profundos) | 8 | **7** |
| `services (raíz) -> services/review` | declarada | **ya no existe** — retirada de `modules.json` |
| Importadores del motor en `services/ai` | 1 | 1 (`artifactGenerationService`, por contenido, presentación y brief) |

Los techos de `checkModuleSize.mjs` y el presupuesto de
`checkModuleBoundaries.mjs` se bajaron a lo medido en el mismo cambio.

## Pruebas que cambiaron de puerta

`agentExecutor.test.ts` y `agentExecutorDocQuality.test.ts` doblaban
`applyArtifactImprovements` en el motor; ahora lo doblan en
`services/ai/generation/artifactReview`, que es por donde pasa la llamada. En
`memoryExecutor.test.ts` y `agentExecutorCreate.test.ts` se quitó la clave,
que ya no doblaba nada. Ninguna aserción cambió.

## Verificación

- `npx vitest run services/agent/__tests__ __tests__/services/ai __tests__/services/artifacts` — 73 ficheros y 993 pruebas en verde.
- `npm run quality` — en verde: **476 ficheros y 4 645 pruebas**; cobertura
  66,98 % sentencias / 57,79 % ramas / 60,01 % funciones / 68,88 % líneas;
  carga inicial 309,6 KB gz de 340. Tipos, strict, lint, `any` 11, tamaños,
  fronteras y escáner de secretos en verde.

## Lo que queda en el motor

La generación principal (`generateArtifactContent` y su interior de ~970
líneas), las presentaciones (`generatePresentationDeck`) y el contrato del
brief (`proposeArtifactBriefContract`). El siguiente corte razonable es el
brief y las presentaciones; la generación principal exige antes cortar su
dependencia con la Oficina (`buildOfficePersonaInstruction`,
`resolveOfficeAgentMention`) con un puerto, como en el corte 8.
