# F5-01, corte 12 — el brief y las presentaciones

**Fecha:** 2026-09-23 · **Base:** corte 11 (PR #68).

Tres piezas salen de `services/geminiService.ts`, cada una hacia donde apunta
su dependencia:

| Pieza | Destino | Por qué ahí |
|---|---|---|
| `proposeArtifactBriefContract` | `services/ai/generation/artifactBriefProposal.ts` | llama a un modelo; el contrato lo lee de `types.ts` (F3-07), así que no importa `services/artifacts`, que importa esta capa |
| `generatePresentationDeck` | `services/ai/generation/presentationDeck.ts` | llama a un modelo por el camino de texto del transporte (proxy primero), con el reintento correctivo |
| `buildMinimalPresentationDeck` | `services/presentation/presentationFallback.ts` | **no llama a ningún modelo**: una función pura no vive detrás de una puerta que sí lo hace; está junto al esquema que produce |

Prompts, temperaturas, tiempos (30 s el brief, 90 s el deck), reintentos
(uno el brief; dos y uno correctivo el deck) y la regla de aceptar el
reintento sólo si pasa la compuerta o puntúa más se mantienen tal cual. La
fachada `artifactGenerationService` conserva la firma del brief; la
generación principal, que sigue en el motor, llama a las dos piezas del deck.

**El brief deja de aceptar una respuesta que no es un objeto.** El motor
convertía un array JSON en un `Record` vacío por casualidad; ahora se
comprueba y devuelve la propuesta vacía de forma explícita.

## Dos aristas nuevas, declaradas

`services/ai -> services/presentation` y `services/ai -> services/quality`.
Ninguna cierra un ciclo (`presentation` sólo depende de `types.ts`, y
`quality` de `lib`, `diagram` y `types.ts`), el gate lo confirma: el
componente sigue siendo de 3 + 14. Las dos entran por la puerta pública de su
módulo. Cuando la generación principal salga del motor necesitará las mismas.

## Un presupuesto que sube, a sabiendas

`services (raíz) -> services/ai` pasa de 7 a 8: el motor importa ahora la
vertical del deck. A cambio deja un import profundo a `services/artifacts`
(4 → 3) y otro a `services/presentation` (2 → 1), así que el total baja, y
este import desaparece con el motor. Sacar la rama de presentación entera
exigía mover también la resolución del grafo de conocimiento y la compuerta
de renderizado, que son el corte grande.

## Cifras

| | corte 11 | corte 12 |
|---|---|---|
| Motor (líneas / bytes) | 2 145 / 113 588 | **1 923 / 101 971** |
| Pruebas | 4 645 | **4 656** |

## Verificación

- `npx vitest run __tests__/services/ai` — 50 ficheros y 780 pruebas en verde.
  `geminiService.proposeArtifactBriefContract.test.ts` pasa a
  `__tests__/services/ai/artifactBriefProposal.test.ts` y dobla `aiGateway`;
  `presentationDeck.test.ts` cubre el deck útil, el reintento correctivo, el
  reintento que falla y el deck mínimo.
- `npm run quality` — en verde: **477 ficheros y 4 656 pruebas**; cobertura
  67,09 % / 57,90 % / 60,10 % / 69,00 %; carga inicial 309,6 KB gz de 340.

## Lo que queda en el motor

Sólo la generación principal: `generateArtifactContent` con su compuerta de
renderizado, el camino C4, la resolución del grafo de conocimiento, el camino
de documentos e híbridos y el de diagramas Mermaid. Su dependencia con la
Oficina (`buildOfficePersonaInstruction`, `resolveOfficeAgentMention`) se
corta primero con un puerto, como en el corte 8.
