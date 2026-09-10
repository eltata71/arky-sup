# Architecture Knowledge Graph (AKG)

> Segunda recomendación para llevar Arky Pro a nivel clase mundial: una
> **fuente canónica de conocimiento arquitectónico** desde la cual todos los
> artefactos se construyen, validan y evolucionan.
>
> Acompaña al Motor de Compilación de Artefactos (`docs/artifact-compiler.md`)
> y al grafo de contexto de prompts (`services/contextGraph`). **No los
> reemplaza: los complementa.**

---

## 1. Por qué

Antes de esta fase Arky Pro generaba artefactos **aislados**: cada diagrama,
documento o matriz vivía por su cuenta. No había forma de saber si la "API de
Pagos" del diagrama de contenedores era la misma que el documento de
integración llamaba "Gateway de Pagos", ni de detectar un riesgo sin
mitigación, ni de saber qué artefactos se verían afectados si una entidad
cambiaba.

El AKG introduce un **modelo arquitectónico común, tipado y persistente**:
entidades (sistemas, APIs, datos, requerimientos, riesgos, decisiones…) y
relaciones entre ellas, cada una con su **evidencia** (`sourceRefs`). Sobre ese
modelo se construyen consistencia, trazabilidad e impacto.

---

## 2. Modelo conceptual

```
Project + Artifacts
        │
        ▼
 ArchitectureEntityExtractor   ──┐
 ArchitectureRelationExtractor ──┤  señales crudas + evidencia
        │                        │
        ▼                        │
 ArchitectureGraphDeduplication  │  consolida, fusiona con cuidado,
        │                        │  marca duplicados / baja confianza
        ▼                        ▼
        ArchitectureKnowledgeGraph  (entidades + relaciones + calidad + stats)
        │           │            │
        ▼           ▼            ▼
 Consistencia   Trazabilidad   Impacto
        │           │            │
        └───────────┴────────────┴──► Prompt Context · Quality Bridge · UI
```

Todo es **JSON-safe** (sin `Date`, `Map` ni clases): el grafo se serializa
trivialmente a Firestore / `localStorage`.

### 2.1 Entidades — `ArchitectureEntity`

| Campo | Descripción |
|---|---|
| `id` | Determinístico y estable: `ake-<tipo>-<slug>` |
| `projectId` | Proyecto dueño |
| `name` / `normalizedName` | Nombre canónico / forma normalizada (sin tildes, minúsculas) |
| `type` / `subtype` | Taxonomía canónica (40+ tipos) |
| `description` | Detalle opcional |
| `aliases` | Variantes de nombre fusionadas |
| `sourceRefs` | **Evidencia**: cada origen que mencionó la entidad |
| `confidence` | Confianza consolidada `[0..1]` |
| `criticality` | `low \| medium \| high \| critical` |
| `status` | `proposed \| active \| deprecated \| candidate-duplicate \| unverified` |
| `tags` / `metadata` | Extensión libre, JSON-safe |
| `createdAt` / `updatedAt` | Timestamps ISO |

Tipos de entidad: `actor`, `stakeholder`, `businessCapability`,
`businessProcess`, `system`, `externalSystem`, `application`, `container`,
`component`, `module`, `api`, `event`, `queue`, `topic`, `dataEntity`,
`dataStore`, `database`, `integration`, `requirement`,
`functionalRequirement`, `nonFunctionalRequirement`, `qualityAttribute`,
`risk`, `mitigation`, `decision`, `constraint`, `assumption`, `testCase`,
`userStory`, `useCase`, `glossaryTerm`, `domainEvent`, `command`, `aggregate`,
`boundedContext`, `environment`, `deploymentNode`, `securityControl`,
`observabilityControl`, `unknown`.

### 2.2 Relaciones — `ArchitectureRelation`

`id`, `projectId`, `sourceEntityId`, `targetEntityId`, `type`, `label`,
`description`, `protocol`, `direction`, `sourceRefs`, `confidence`,
`metadata`, `createdAt`, `updatedAt`.

Tipos de relación: `uses`, `dependsOn`, `contains`, `exposes`, `calls`,
`publishes`, `consumes`, `persists`, `reads`, `writes`, `owns`, `implements`,
`satisfies`, `tracesTo`, `mitigates`, `impacts`, `constrains`, `belongsTo`,
`deployedOn`, `monitors`, `secures`, `validates`, `duplicates`,
`conflictsWith`, `derivedFrom`, `relatedTo`.

### 2.3 Evidencia — `ArchitectureSourceRef`

Cada entidad y relación conserva la lista de orígenes que la produjeron
(`sourceType`, `sourceId`, `artifactId?`, `artifactType?`, `sectionId?`,
`excerpt?`, `confidence`, `createdAt`). **Nada en el grafo es no atribuible.**

### 2.4 El grafo — `ArchitectureGraph`

`projectId`, `version` (esquema), `buildId`, `lastBuiltAt`, `entities`,
`relations`, `quality` (score, confianza media, cobertura, recuentos),
`statistics` (por tipo, huérfanas, duplicados, baja confianza).

---

## 3. Extracción

`ArchitectureEntityExtractor` y `ArchitectureRelationExtractor` son
**determinísticos** (sin llamada a IA). Leen:

- `project.description`, `projectContext`, `agentMemory`, `initialCapture`,
  `globalContext`;
- por artefacto: `name`, `objective`, `keyConcepts`, `content` (Markdown),
  `ir` (`DiagramIR`), `artifactMemory`.

Estrategia **precisión sobre exhaustividad**: una frase se convierte en
entidad solo si coincide con (a) una tecnología conocida, (b) un id
estructurado (`RF-001`, `US-12`, `RNF-003`…) o (c) una palabra clave
clasificadora ("Servicio de Pagos", "API Gateway"). Cubre diagramas C4/ERD/
secuencia/flujo, BRD, casos de uso, historias de usuario, NFR, BDD, matriz de
trazabilidad, glosario, modelo de dominio, event storming y Markdown general.

---

## 4. Normalización y deduplicación (`ArchitectureGraphDeduplication`)

- normaliza nombres (minúsculas, sin tildes, espacios colapsados);
- agrupa por nombre normalizado **y** compatibilidad de tipo;
- fusiona **solo** ante coincidencia exacta + tipo compatible;
- nombres similares-pero-distintos ("API Gateway" vs "BFF Gateway") **no se
  fusionan**: se marcan `candidate-duplicate`;
- nunca borra evidencia: todos los `sourceRefs` se conservan;
- marca `unverified` cuando la evidencia es débil (`confidence < 0.4`);
- los extremos de relación no resueltos generan una entidad sintética
  `unknown` con tag `unresolved-reference` (el motor de consistencia la
  reporta como `dangling-relation`).

---

## 5. Persistencia (`ArchitectureGraphPersistenceAdapter`)

Estrategia de esta fase: **aditiva**. El grafo se guarda en
`Project.architectureKnowledgeGraph`.

- `firestoreService.toProjectDocument` lo escribe; `sanitizeForFirestore`
  elimina `undefined` (legacy → campo ausente, sin migración destructiva);
- `firestoreService.fromProjectSnapshot` lo lee vía
  `deserializeArchitectureGraph` (migración + validación runtime);
- `lib/runtimeValidation.validateProject` conserva el campo al re-formar el
  proyecto;
- `AppContext.updateProject` lo persiste por la ruta estándar → **rollback
  optimista y control de concurrencia intactos**.

`getKnowledgeGraphSubcollectionPath()` documenta la ruta futura a
subcolección (`projects/{id}/knowledgeGraph/*`) sin comprometerla aún.

---

## 6. Integración con generación y compilación

- **Generación**: `ArchitectureGraphPromptContextBuilder` produce un bloque
  Markdown compacto y presupuestado (`maxChars`, `maxEntities`, …) que
  *complementa* `projectContext` y `keyConcepts`. No reemplaza los prompts
  actuales.
- **Compilación**: `ArchitectureGraphQualityBridge.buildArtifactGraphInsight`
  entrega al compilador las entidades/relaciones detectadas, un score de
  cobertura y las inconsistencias/vacíos que referencian al artefacto. El
  compilador sigue siendo dueño de contrato, reparación y exportabilidad; el
  grafo solo aporta la señal de consistencia y trazabilidad.

`AppContext.rebuildArchitectureGraph(projectId)` reconstruye y persiste el
grafo de forma segura (build determinístico y total — nunca lanza).

---

## 7. UI

`components/ArchitectureKnowledgeGraphPanel.tsx` se integra como pestaña
**"Grafo"** en `ArtifactInspectorPanel`. Muestra entidades (tipo, confianza,
nº de fuentes), relaciones, inconsistencias, cobertura y vacíos de
trazabilidad, e impacto del artefacto activo. Acciones: recalcular y persistir
el grafo, copiar reporte. Accesible y compatible con modo oscuro.

---

## 8. Observabilidad

`ArchitectureGraphObservability` emite eventos `graph.*`: `build.started`,
`build.completed`, `build.failed`, `entity.extracted`, `entity.duplicated`,
`relation.extracted`, `consistency.issue.detected`,
`traceability.gap.detected`, `impact.analysis.completed`,
`persistence.failed`, `promptContext.generated`. Los fallos se reportan como
recuperables — **nunca producen pantalla en blanco**.

---

## 9. Validación runtime

`ArchitectureGraphRuntimeValidation` valida `ArchitectureEntity`,
`ArchitectureRelation`, `ArchitectureSourceRef` y `ArchitectureGraph`:
descarta elementos corruptos, descarta relaciones colgantes, aplica defaults
seguros, conserva todo lo válido y **nunca lanza**.

---

## 10. Limitaciones y deuda remanente

- Extracción determinística por reglas: alta precisión, recall moderado. Una
  fase futura puede sumar un extractor asistido por IA.
- El grafo se persiste en el documento de proyecto (límite 1 MB de
  Firestore). Para proyectos muy grandes conviene migrar a subcolección — el
  adapter ya prevé la ruta.
- La generación de artefactos puede *consumir* el contexto del grafo, pero la
  inyección automática dentro de `geminiService` queda como integración
  opt-in para evitar un refactor masivo del servicio.
- Los nombres de entidad de frases libres pueden ser largos; un paso de
  *naming canónico* mejoraría la legibilidad.

---

*Módulo: `services/architectureKnowledgeGraph/`. Rama:
`claude/architecture-knowledge-graph-AQQm9`.*
