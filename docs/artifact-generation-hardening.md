# Endurecimiento del flujo de generación de artefactos

> Acompañante de `docs/diagram-quality-gate.md` y de los `specs/`. Esta
> nota cubre los cambios de este PR aplicables a la persistencia de
> artefactos y a la garantía de "no pantalla en blanco".

---

## 1. Flujo actual (post-PR)

```
                     ┌────────────────────────────────────────────┐
[UI request]  ─────► │ AppContext.createArtifact / updateArtifact │
                     └─────────────────┬──────────────────────────┘
                                       │  optimistic state set + snapshot()
                                       ▼
                     ┌────────────────────────────────────────────┐
                     │ persistArtifacts(projectId, next, prev)    │
                     └─────────────────┬──────────────────────────┘
                                       │
                                       ▼
                     ┌────────────────────────────────────────────┐
                     │ firestoreService.updateProjectArtifacts    │
                     │   - validates expectedUpdatedAt (opt-in)   │
                     │   - re-throws on permission-denied         │
                     │   - tolerates unavailable (offline)        │
                     └────────┬───────────────────────────┬───────┘
                              │ ok                        │ error
                              ▼                           ▼
                     [cache invalidate]        [observability.reportError]
                                                          │
                                                          ▼
                                             [setProjects(prev) ← rollback]
```

---

## 2. Cambios introducidos por este PR

### 2.1 IDs UUID v4

Antes: `proj_${Date.now()}` y `art_${Date.now()}_${random}` con riesgo
de colisión cuando dos llamadas caen en el mismo tick (ocurre en bulk
operations como `applyConsistencySuggestion`).

Ahora: `lib/ids.ts` expone helpers tipados (`newProjectId`,
`newArtifactId`, `newVersionGroupId`) que delegan en
`crypto.randomUUID()` y caen a `uuid` v4 si el runtime no lo soporta.
Test de regresión genera 5,000 IDs en bucle y verifica unicidad.

### 2.2 Optimistic update con rollback obligatorio

`context/AppContext.tsx` ahora:

- Antes de mutar estado, captura snapshot (`previousArtifacts`).
- Llama `persistArtifacts(projectId, next, previous, opName)`.
- Si el write Firestore falla, revierte la UI a `previous` y emite
  `observabilityService.reportError` con `userVisible: true`.
- Si Firestore detecta un conflicto de versión, emite
  `recordWarning` con el `remoteUpdatedAt` para que el usuario sepa
  que recargue.

Aplicado a: `addProject`, `updateProject`, `deleteProject`,
`createArtifact`, `createArtifactVersion`, `updateArtifact`,
`deleteArtifact`, `applyConsistencySuggestion`,
`restoreArtifactVersion`, `removeCorruptArtifacts`.

### 2.3 Concurrency control opcional

`firestoreService.updateProjectArtifacts(projectId, artifacts, { expectedUpdatedAt })`
ahora puede:

- Leer el documento remoto antes de escribir.
- Comparar `updatedAt` contra el baseline conocido por el caller.
- Si el remoto avanzó, retornar `{ updatedAt, conflict: { remoteUpdatedAt } }`
  sin sobrescribir y emitir warning observable.

El parámetro es opcional: el camino legacy sigue siendo escritura
incondicional, lo que preserva compatibilidad backward.

### 2.4 Validación de payloads de Firestore

`lib/runtimeValidation.ts` se aplica en cada read:

- `validateProject` rechaza objetos sin `id`. Coerce campos faltantes a
  defaults seguros (`name: 'Proyecto sin nombre'`,
  `projectContext: []`, etc.).
- `validateArtifact` valida `id`, `versionGroupId`, `name`, `type` y
  `content`. Sin esos cuatro campos críticos, el artefacto es
  **descartado** (con observability) en lugar de propagarse al
  renderer.
- `validateProjects` aplica el batch.

Resultado: documentos corruptos en Firestore ya no producen
`Cannot read properties of undefined` en el render.

### 2.5 Errores de seguridad explícitos

Antes: cualquier fallo de write/read caía silencioso a localStorage,
incluyendo `permission-denied`. Eso dejaba al usuario "guardando" en
un caché local que nunca llegaría a Firestore.

Ahora `firestoreService.handleFirestoreError` distingue:

| Código Firestore | Trato |
| ---------------- | ----- |
| `permission-denied`, `unauthenticated`, `failed-precondition` | `severity: 'critical'`, **re-throw**. El optimistic update se revierte. El usuario ve el `RuntimeErrorOverlay`. |
| `unavailable`, `deadline-exceeded` | `severity: 'warning'`, fallback localStorage. El usuario ve un evento no-bloqueante en el `GlobalObservabilityCenter`. |
| Otro | `severity: 'error'`, fallback con warning. |

---

## 3. Validadores por tipo de artefacto (estado actual)

El pipeline de diagramas ya tiene una capa robusta de validación
(`services/diagram/qualityGate.ts`, `services/diagram/guardrails.ts`,
`services/diagramQualityService.ts`). El presente PR **no altera** esa
capa para evitar regresiones — sus 50+ tests siguen verdes — pero la
documenta como **autoritativa** para los siguientes tipos:

| Tipo de artefacto                    | Validador autoritativo |
| ------------------------------------ | ---------------------- |
| `mermaid-c4-context/container/component/deployment` | `services/diagram/qualityGate.ts` + `mermaidToIR.ts` |
| `mermaid-erd / sequence / state / gantt / graph`    | `mermaidToIR.ts` + `qualityGate.ts` |
| `react-flow-graph`                   | `services/diagram/irToReactFlow.ts` (placeholder visible cuando IR vacío) |
| `markdown / hybrid-text-diagram`     | `lib/runtimeValidation.validateArtifact` (shape) |
| `sdd-*`                              | `lib/runtimeValidation.validateArtifact` (shape) |

Los validadores específicos por tipo SDD (BRD, BDD, NFR, etc.) son
deuda remanente — ver `docs/technical-debt-audit.md` M-7.

---

## 4. Estrategia de fallback (sin pantalla en blanco)

| Capa | Mecanismo |
| ---- | --------- |
| Render React | `ErrorBoundary` con `fallbackTitle` por ruta + `RuntimeErrorOverlay` para errores globales no recoverables. |
| Diagramas | Fallback skeleton (`services/diagram/qualityRepair.ts`) marcado en `metadata.fallback = 'skeleton'` y badge "Esqueleto base — edítame". |
| AI generation | Retry 503/429 con backoff. Timeout 180s. Errores categorizados en `geminiService` (`getApiKey`, `quota`, `safety`, etc.). |
| Persistencia | Optimistic + rollback. Permission-denied dispara overlay. Offline cae a localStorage con warning. |
| Read corrupto | `validateProject`/`validateArtifact` descarta + warning. |

---

## 5. Quality gate de exportación (recomendación)

Hoy `services/diagramQualityService.ts` calcula score y dimensiones, y
`services/diagram/qualityGate.ts` reporta issues. La regla pendiente es
**bloquear exportación formal** cuando se cumpla cualquiera de:

- `metadata.fallback === 'skeleton'` (artefacto vino del fallback).
- `qualityReview.issues.some(i => i.severity === 'critical')`.
- IR con cero nodos o cero edges relevantes (`emptyIR`).
- Edge references inválidas (source/target apunta a nodo inexistente).
- `quality.score < UMBRAL` (sugerencia: 0.55 sobre 1.0).

Puntos de inserción:

```
components/ArtifactCanvas.tsx → handleExport(format)
   if (isExportBlocked(artifact)) { showQualityModal(); return; }
```

Helper sugerido (no incluido en este PR):

```ts
// services/diagram/exportGate.ts
export function isExportBlocked(artifact: Artifact): {
  blocked: boolean;
  reasons: string[];
} { /* ... */ }
```

---

## 6. Trazabilidad de generación

`Artifact.generationTrace` (definido en `types.ts`) ya captura:

- `id`, `source`, `status`, `startedAt`, `completedAt`, `durationMs`,
  `model`, `request`, `quality`, `decisions`, `errors`.

**Recomendación de UX:** el botón "Abrir traza" en el copilot debe
abrir un modal que renderice `generationTrace.decisions` + `errors`
con timeline. Hoy parte de esto está cubierto por
`components/GlobalObservabilityCenter`. La trace per-artifact es
deuda remanente (ver tech-debt M-4 — extraer
`useGenerationTrace` desde Workspace).

---

## 7. Tests añadidos

- `__tests__/lib/ids.test.ts` — colisiones, prefijos, formato UUID.
- `__tests__/lib/runtimeValidation.test.ts` — shape integrity de
  Artifact/Project, drop de artefactos corruptos, defaults seguros.
- `__tests__/services/firestoreServiceGuards.test.ts` — clasificación
  de errores, guard de `getAllProjects`.

Los 50+ tests pre-existentes del pipeline de diagramas
(`__tests__/diagram/*`) siguen verdes y son la red de seguridad para
las decisiones de pipeline determinístico.

---

## 8. Architecture Knowledge Graph — integración aditiva

La segunda recomendación (Architecture Knowledge Graph, ver
`docs/architecture-knowledge-graph.md`) se integra **sin tocar** este flujo:

- el grafo se persiste en `Project.architectureKnowledgeGraph` de forma
  aditiva; `toProjectDocument` / `fromProjectSnapshot` lo (de)serializan y
  `validateProject` lo conserva — los proyectos legacy siguen cargando igual;
- `AppContext.rebuildArchitectureGraph` persiste el grafo por la ruta estándar
  `updateProject`, así que el rollback optimista y el control de concurrencia
  de la sección 2 quedan intactos;
- el build del grafo es determinístico y total: nunca lanza, y ante fallo
  devuelve un grafo vacío + evento de observabilidad — se mantiene la garantía
  de "no pantalla en blanco";
- la generación puede consumir contexto del grafo mediante
  `ArchitectureGraphPromptContextBuilder`, que **complementa** (no reemplaza)
  `projectContext` y `keyConcepts`.

---

## Pipeline de Publicación Profesional

La tercera recomendación (Pipeline de Publicación, ver
`docs/publication-pipeline.md`) se integra **sin tocar** este flujo de
generación, compilación, trazabilidad, renderizado ni exportación:

- los paquetes de publicación se persisten en `Project.publicationPackages` de
  forma aditiva; `toProjectDocument` / `fromProjectSnapshot` los (de)serializan
  y `validateProject` los conserva (paquetes corruptos descartados, válidos
  preservados) — los proyectos legacy siguen cargando igual;
- `AppContext.savePublicationPackages` persiste por la ruta estándar
  `updateProject`, así que el rollback optimista y el control de concurrencia
  quedan intactos;
- el pipeline **lee** el snapshot `artifact.compilation` y el grafo
  `Project.architectureKnowledgeGraph` — no recompila ni reconstruye nada;
- la exportación de publicación **reutiliza** los adaptadores de
  `services/export/`; no los duplica ni cambia sus validaciones;
- todo punto de entrada del pipeline es total: nunca lanza y degrada a un
  resultado bloqueado — se mantiene la garantía de "no pantalla en blanco".
