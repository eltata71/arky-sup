# F5-01, corte 14 — el motor entra en `services/ai`, y F5-01 se cierra

**Fecha:** 2026-09-24 · **Base:** cortes 12 y 13 (PR #69, `4a26731`).

F5-01 tenía tres objetivos con fecha en `scripts/budgetTargets.mjs`, y los tres
dependían de lo mismo: sacar `services/geminiService.ts` de la raíz de
`services/`.

| Objetivo | Antes | Ahora |
|---|---|---|
| Ciclos directos registrados | 4 | **3** — los tres de React, que no son objetivo de nadie |
| Ficheros sueltos en la raíz de `services/` | 1 | **0** |
| Tipos `any` | 11 | **7** — la parte de F5-01 del objetivo 11 → 7 |

## Lo que impedía moverlo

La Ola 5 lo intentó y lo revirtió: el motor alcanzaba hacia arriba a contextos
que importan `services/ai`, así que moverlo cambiaba un ciclo contra la raíz por
varios entre contextos reales. Los cortes 7, 8 y 13 quitaron `chat`, `agent` y
`architectureOffice`. Quedaba **uno**: `services/artifacts`, del que el motor
tomaba tres cosas.

| Qué | Dónde vivía | Para qué |
|---|---|---|
| `selectArtifactGenerationContext` + `validateControlledContextForPrompt` | `artifactContextSelectionService` | el bloque de fuentes controladas de una solicitud estructurada, y su guarda contra fugas de fuentes excluidas |
| `buildDeterministicArtifactFallback`, `buildDeterministicDiagramSkeleton`, `markMermaidAsSkeletonFallback` | `deterministicArtifactFallbacks` | lo que se entrega cuando el proveedor falla: nunca un lienzo vacío |
| `SKELETON_FALLBACK_MARKER` | `artifactFallbackDetection` | sólo lo reexportaba; nadie lo importaba del motor |

`services/artifacts` importa `services/ai` para *ejecutar* una generación
(`artifactGenerationRun`, `artifactRefinementOrchestrator`,
`artifactImprovement`), así que con el motor dentro de `services/ai` esas
importaciones habrían cerrado `services/ai <-> services/artifacts`.

## El puerto

Mismo patrón que el corte 13 para la persona: **el que no puede buscar declara
lo que necesita, y se lo entregan.**

| Pieza | Dónde | Qué hace |
|---|---|---|
| `ArtifactGenerationSupport`, `ArtifactContentGenerationOptions` | `services/ai/generation/artifacts/artifactGenerationSupport.ts` | el puerto: contexto controlado ya validado, artefacto determinista, esqueleto de diagrama, marca de esqueleto |
| `artifactGenerationSupport` | `services/artifacts/artifactGenerationSupport.ts` | la única implementación, sobre las mismas funciones que el motor llamaba |
| `agentGenerationOptions` | `services/agent/agentPersonaComposer.ts` | persona + soporte para las dos llamadas del ejecutor del agente |
| `useArtifactGenerationPorts` | `hooks/useArtifactPersona.ts` | persona + soporte para las pantallas (`SDDProcessView`, `ProjectCreationStatus`) |

**Obligatorio, no opcional.** A diferencia del compositor de persona —sin él la
instrucción base sigue siendo un prompt correcto—, una generación sin soporte
devolvería un lienzo vacío donde antes devolvía un esqueleto, y nadie lo notaría
hasta la próxima caída del proveedor. El tipo lo exige, y el typecheck lo
comprobó: los cuatro llamantes y las pruebas que llaman al motor lo entregan.

## El movimiento

- `services/geminiService.ts` → `services/ai/generation/artifacts/artifactGenerationEngine.ts`
  (`git mv`, historia conservada). La clase pasa a `ArtifactGenerationEngine` y
  el singleton a `artifactGenerationEngine`; la fachada
  `artifactGenerationService` es su único importador.
- Los ayudantes de prompt puros —la envoltura híbrida y las dos barras de
  calidad de documento— salen a `artifactPromptReinforcements.ts`, y
  `__test__` desaparece: las pruebas importan cada función de su casa.
- El motor entra en `quality`, `presentation`, `diagram`, `contextGraph` y
  `architectureKnowledgeGraph` **por sus barriles**. Es código perezoso, así que
  la regla del barril contra el bundle lo permite, y `check:bundle-budget` lo
  comprueba.
- Motor: **1 921 → 1 786 líneas**, 101 835 → 94 962 bytes. El techo se muda
  con el fichero.

## Fronteras

`npm run check:module-boundaries --report`:

- Ciclos directos **4 → 3**: sale `services (raíz) <-> services/ai`.
- Componente fuertemente conexo de dominio **14 → 13**: sale la raíz.
- Pares con import profundo **53 → 48**: los cinco pares `services (raíz) -> …`
  desaparecen, y no aparece ninguno nuevo.
- `SERVICES_ROOT_BUDGET` **1 → 0**. El pseudo-módulo `services (raíz)` sigue
  declarado en `modules.json`, vacío y sin dependencias permitidas, para que el
  próximo fichero suelto se mida y se rechace en vez de desaparecer del grafo.
- Dependencias declaradas nuevas: `services/ai -> services/contextGraph`,
  `services/ai -> services/architectureKnowledgeGraph` (las que el motor ya
  tenía, ahora atribuidas a su módulo) y `services/agent -> services/artifacts`
  (el agente entrega el soporte). Ninguna cierra un ciclo directo.

## Una predicción que no se cumplió

El registro de avance decía que, al salir el motor, «desaparecen la arista
`services/ai -> services (raíz)` y el SCC de catorce». La arista sí; el SCC no.
Baja a trece porque la raíz sale, pero `services/ai -> services/architectureProjects
-> services/chat -> services/ai` lo cierra por su cuenta —la IA lee el proyecto,
el proyecto guarda el historial de chat y el chat compacta con un modelo— y hay
más caminos así. `budgetTargets.mjs` ya le daba ese objetivo a **F5-03**, no a
F5-01; lo que estaba mal era la frase. `moduleBoundaries.test.ts` afirma ahora
que la raíz ya no está en el componente, en lugar de que sí.

## Los cuatro `any` de la vertical de diagramas

Salieron del motor con la vertical en el corte 6, sin tocar. Eran la parte de
F5-01 del objetivo 11 → 7:

- `buildDiagramGenerationConfig` devolvía `Record<string, any>`: ahora
  `DiagramGenerationConfig`, con índice `unknown` para las claves de proveedor.
- `parseMermaidToReactFlow` devolvía `{ nodes: any[], edges: any[] }` sin
  comprobar nada: ahora un `ModelFlowGraph` que se **comprueba** antes de
  devolverse. Una respuesta con otra forma devuelve `null` —que la pantalla ya
  trata como «el diagrama llegó vacío»— en vez de reventar en `data.nodes.length`.

`MAX_ANY_TOKENS` baja a **7**: el borde sin tipos de Excalidraw (6) y el
`ComponentType<any>` de React (1).

## Verificación

- `npx vitest run __tests__/services/ai/artifactGenerationSupport.test.ts` —
  el motor no importa `artifacts`, `architectureOffice`, `agent` ni `chat`; la
  raíz de `services/` no tiene ficheros; el soporte produce exactamente la
  selección y la validación que el motor ejecutaba; y con el proveedor caído un
  documento y un diagrama salen del soporte que se entrega, nunca vacíos.
- `npm run quality` — ver el resultado registrado en `08-avance.md`.

## Lo que queda, y ya no es F5-01

- **F5-02**: las seis pantallas sobre el fan-out.
- **F5-03**: el componente de trece módulos.
- `_generateArtifactContentInternal` (~900 líneas) sigue siendo un método
  enorme. Partirlo es descomposición ordinaria dentro de su módulo, no una
  migración entre módulos.
