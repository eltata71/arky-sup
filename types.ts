/**
 * The shared kernel.
 *
 * This file was 1.268 lines and held the model of seven contexts at once: the
 * diagram IR, the presentation deck, the review threads, the chat history, the
 * project aggregate and the Training Center, alongside the things that are
 * genuinely shared. 244 files import from it, so a change to an edge label
 * slot recompiled the LMS.
 *
 * Each of those moved to the context that owns it:
 *
 *   - `DiagramIR` and its vocabulary → `lib/diagram/`
 *   - the presentation deck          → `services/presentation/`
 *   - review comments and decisions  → `services/review/`
 *   - the chat message               → `services/chat/`
 *   - the `Project` aggregate        → `services/architectureProjects/`
 *   - the `Artifact`                 → `lib/artifacts/` (shared kernel, F3-07)
 *   - the Training Center            → `types/lms.ts` (a dead duplicate, deleted)
 *
 * **Y las reexportaciones que quedaban detrás se retiraron en F3-07.** Estaban
 * pensadas como andamio temporal —«para que los imports existentes sigan
 * funcionando»—, y al medirlas resultó que el andamio ya no sostenía nada: las
 * 19 declaraciones de diagrama no tenían **un solo consumidor**, y de las de
 * presentación, revisión y chat los únicos consumidores eran los propios
 * módulos dueños, importando sus tipos por la raíz del repositorio en vez de
 * por su fichero de al lado. Mientras existieron, este fichero importaba de
 * cuatro módulos que a su vez lo importaban: cuatro ciclos y tres imports
 * ascendentes que ningún gate veía, porque el verificador no abría la raíz
 * (F3-02, ADR-105).
 *
 * **Y las dos últimas, `Artifact` y `Project`, se retiraron también (F3-07),
 * cuando D-4 decidió la frontera (ADR-106).** No eran andamio: eran la
 * frontera del agregado Proyecto–Artefacto dicha con un import. La medición
 * decidió a dónde iba cada una:
 *
 *   - **`Artifact` bajó a `lib/artifacts`.** Lo leen la fundación y quince
 *     contextos, varios de los cuales importa `services/artifacts`: repuntarlos
 *     al contexto dueño cambiaba un ciclo contra este fichero por ciclos
 *     directos entre contextos reales. Es núcleo compartido en sentido estricto
 *     —forma sin comportamiento— y su comportamiento sigue en su contexto.
 *   - **`Project` se importa de `services/architectureProjects`**, y las
 *     pantallas lo reciben de `context/AppContext`, que es quien les entrega los
 *     proyectos. Los tres contextos que lo nombraban y a los que el proyecto
 *     importa (grafo, publicación, Oficina) declaran ahora el puerto que leen.
 *
 * **Este fichero no importa nada**, y así se queda: `lib` depende de él, y un
 * import desde aquí hacia `lib` o hacia un contexto cierra un ciclo en la
 * fundación. Por eso las declaraciones del brief de generación
 * (`ArtifactGenerationContract` y su vocabulario) están aquí: `ArtifactTemplate`
 * las transporta, y antes se importaban de `services/artifacts`.
 *
 * What is left is what really does cross every context: the words used to
 * classify an artifact, the user's settings, a memory entry, the templates.
 * Keep this file that shape: a type that only one context needs belongs in
 * that context, y no se reexporta desde aquí «por compatibilidad»: eso es lo
 * que creó los cuatro ciclos, y después los otros dos.
 */


/**
 * El brief estructurado de una generación a demanda.
 *
 * Declaraciones sin comportamiento que `ArtifactTemplate.requestContext`
 * transporta; por eso están aquí y no en `services/artifacts`, que conserva la
 * normalización, la validación y la fusión. Estaban allí, y `types.ts` las
 * importaba: una de las cuatro importaciones ascendentes que F3-07 retiró.
 */
export type ArtifactAudience = 'executive' | 'technical' | 'operations' | 'business' | 'mixed';

export type ArtifactFamilyPreference = 'auto' | 'document' | 'diagram' | 'hybrid' | 'table' | 'matrix' | 'presentation';

export type ArtifactPurpose =
  | 'decision'
  | 'explanation'
  | 'design'
  | 'implementation'
  | 'analysis'
  | 'governance'
  | 'comparison'
  | 'validation'
  | 'communication';

export type ArtifactDetailLevel = 'executive' | 'conceptual' | 'logical' | 'physical' | 'technical' | 'deep-technical';

export interface ArtifactVisualPreferences {
  orientation?: 'auto' | 'LR' | 'TD';
  density?: 'simple' | 'balanced' | 'detailed';
  includeLegend?: boolean;
  includeBoundaries?: boolean;
  includeMetrics?: boolean;
  preferredDiagramStyle?: 'auto' | 'c4' | 'flowchart' | 'sequence' | 'bpmn' | 'dfd' | 'erd' | 'state';
}

export interface ArtifactGenerationContract {
  id: string;
  originalRequest: string;
  normalizedIntent: string;
  audience: ArtifactAudience;
  artifactFamily: ArtifactFamilyPreference;
  purpose: ArtifactPurpose;
  detailLevel: ArtifactDetailLevel;
  requiredSourceArtifactIds: string[];
  optionalSourceArtifactIds: string[];
  excludedSourceArtifactIds: string[];
  requiredContextItems: string[];
  excludedContextItems: string[];
  acceptanceCriteria: string[];
  exportTargets: string[];
  visualPreferences?: ArtifactVisualPreferences;
  language: 'es' | 'en';
  qualityTarget: number;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactRecommendationScoreBreakdown {
  intentMatch: number;
  audienceMatch: number;
  representationMatch: number;
  contextAvailability: number;
  sourceArtifactRelevance: number;
  riskPenalty: number;
  /** Bonus from the optional Architecture Knowledge Graph; absent when no graph. */
  architectureGraphAlignment?: number;
  /** Bonus from the measured quality of the selected source artifacts. */
  sourceQualityScore?: number;
  /** Bonus from how recent the selected source artifacts are. */
  freshnessScore?: number;
  /** Bonus from how well the template phase/view fit the request. */
  phaseViewAlignment?: number;
  /** Estimated coverage of the explicit acceptance criteria. */
  acceptanceCriteriaCoverage?: number;
}

export interface AIConfig {
  model: string;
  /**
   * Active AI provider. Optional for lazy migration: a record written before
   * this field existed resolves to `gemini`, which is what it was implicitly
   * using. Resolve it with `resolveProviderId` rather than reading it raw.
   */
  provider?: 'gemini' | 'openrouter' | 'anthropic';
  temperature: number;
  tone: string;
  languageStyle: string;
  apiKeySource: 'global' | 'user';
  includeChatHistoryByDefault?: boolean;
}

/**
 * Prioridad de una nota/comentario de memoria. Por omisión toda nota nace en
 * `medium`; el usuario puede elevarla a `high` o rebajarla a `low` desde el
 * Centro de Memoria. La IA pondera la prioridad junto con la fecha de
 * creación (más reciente = más relevante) al seleccionar contexto.
 */
export type MemoryPriority = 'high' | 'medium' | 'low';

/**
 * Nota/comentario estructurado de cualquier ámbito de memoria (global,
 * proyecto, artefacto, agente, captura inicial). Las listas legacy de
 * `string[]` siguen siendo la espejo canónico de textos para
 * retro-compatibilidad; los campos `*Entries` paralelos conservan los
 * metadatos (fecha/hora, autor, prioridad) de cada nota.
 */
export interface MemoryEntry {
  /** Id estable de la nota (no cambia al editar el texto). */
  id: string;
  /** Texto de la nota — coincide 1:1 con el elemento del `string[]` espejo. */
  text: string;
  /** Prioridad asignada por el usuario. Default: 'medium'. */
  priority: MemoryPriority;
  /** Fecha/hora ISO de creación. `null` para notas legacy sin metadatos. */
  createdAt: string | null;
  /** Fecha/hora ISO de la última edición. */
  updatedAt?: string | null;
  /** Uid del autor (usuario o agente) que creó la nota. */
  authorId?: string | null;
  /** Nombre visible del autor que creó la nota. */
  authorName?: string | null;
}

export interface Settings {
  globalContext: string[];
  /** Metadatos estructurados (fecha, autor, prioridad) de `globalContext`. */
  globalContextEntries?: MemoryEntry[];
  language: 'en' | 'es';
  theme: 'light' | 'dark';
  aiConfig: AIConfig;
  /**
   * "Memoria del Agente" — base behavioural memory that defines the
   * Arquitecto Agente's role, restrictions and operating context. Loaded
   * BEFORE any AI action and surfaced at the top of every system
   * instruction composed by `buildAgentSystemInstruction`. When absent
   * (legacy installs) the composer falls back to `DEFAULT_AGENT_MEMORY`.
   *
   * This is global per user and intentionally additive on top of
   * `globalContext` (which captures user/company standards, not the
   * agent's identity).
   */
  agentMemory?: string[];
  /** Metadatos estructurados (fecha, autor, prioridad) de `agentMemory`. */
  agentMemoryEntries?: MemoryEntry[];
}

export type ArtifactType =
  | 'markdown'
  | 'yaml'
  | 'hybrid-text-diagram' // For artifacts that benefit from both text and a diagram view
  | 'mermaid-c4-context'
  | 'mermaid-c4-container'
  | 'mermaid-c4-component'
  | 'mermaid-c4-deployment'
  | 'mermaid-erd'
  | 'mermaid-sequence'
  | 'mermaid-graph'
  | 'mermaid-state'
  | 'mermaid-gantt'
  | 'react-flow-graph'
  | 'presentation-executive'
  | 'presentation-technical'
  | 'presentation-overview'    // Resumen de Arquitectura — deck sintético para audiencia mixta
  | 'presentation-summary'     // Resumen Ejecutivo — executive briefing deck
  // SDD — Specification-Driven Development artifact types
  | 'sdd-brd'           // Business Requirements Document (IEEE 830)
  | 'sdd-use-case'      // Use Case Specification (UML 2.5)
  | 'sdd-user-story'    // User Story Map + Backlog (SAFe/Scrum)
  | 'sdd-domain-model'  // DDD Domain Model (Bounded Contexts + Ubiquitous Language)
  | 'sdd-event-storming' // Event Storming diagram (Brandolini)
  | 'sdd-glossary'      // Ubiquitous Language Glossary (DDD)
  | 'sdd-nfr'           // Non-Functional Requirements Spec (ISO 25010)
  | 'sdd-bdd'           // BDD Scenarios in Gherkin syntax (BDD/Cucumber)
  | 'sdd-traceability'; // Requirements Traceability Matrix (IEEE 29148)

export type ArchitecturalView =
  | 'Vista de Contexto y Negocio'
  | 'Vista Lógica y de Diseño'
  | 'Vista de Datos'
  | 'Vista de Proceso e Interacción'
  | 'Vista Física y de Despliegue'
  | 'Vista de Gestión y Soporte'
  | 'Vista de Calidad y Validación'
  | 'Vista SDD'; // Specification-Driven Development artifacts




export type MemoryScope =
  | 'global'           // Settings.globalContext
  | 'agent-base'       // Settings.agentMemory  — base behavioural identity (USER-LEVEL)
  | 'project'          // Project.projectContext
  | 'agent'            // Project.agentMemory   — project-scoped agent learnings
  | 'initial-capture'  // Project.initialCapture
  | 'artifact'         // Artifact.artifactMemory (per artifact)
  | 'chat-history';    // Project chat history with the Arquitecto Agente

export interface Template {
  name: string;
  description: string;
}

export interface ArtifactRequestContext {
  /** Original free-form request that led to this on-demand artifact. */
  userRequest: string;
  /** Recommendation rationale shown to the architect before generation. */
  rationale?: string;
  /** Execution plan approved by the architect in the recommendation step. */
  constructionPlan?: string[];
  /** Catalog standard used as the closest compatible generation template. */
  matchedCatalogTemplateName?: string;
  /** Intended audience captured during recommendation. */
  audience?: 'technical' | 'executive' | 'mixed';
  /** Structured, auditable brief approved before on-demand generation. */
  generationContract?: ArtifactGenerationContract;
  /** Source artifacts selected as mandatory or relevant context for this generation. */
  selectedSourceArtifactIds?: string[];
  /** Source artifacts explicitly excluded from this generation. */
  excludedSourceArtifactIds?: string[];
  /** Minimum acceptance criteria approved in the structured brief. */
  acceptanceCriteria?: string[];
}

export interface ArtifactTemplate {
  name: string;
  type: ArtifactType;
  phase: string;
  architecturalView: ArchitecturalView;
  objective: string;
  keyConcepts: { term: string; definition: string; }[];
  representation: 'diagram' | 'document' | 'hybrid';
  /**
   * High-level semantic shape of the artifact. Optional and additive so legacy
   * templates keep working: when absent, the value is derived from `type` via
   * `getArtifactKind`. Use this field to mark presentations / hybrids
   * explicitly when the `type` cannot be made unambiguous.
   */
  artifactKind?: 'document' | 'diagram' | 'presentation' | 'hybrid';
  /** Coarse output container (doc | diagram | deck | markdown | mixed). */
  outputFormat?: 'doc' | 'diagram' | 'deck' | 'markdown' | 'mixed';
  /** Preferred export formats for this template (e.g. ['pptx','pdf']). */
  preferredExports?: string[];
  /** Optional metadata for artifacts generated from the "Artefacto a solicitud" flow. */
  requestContext?: ArtifactRequestContext;
}

export interface CustomArtifactRecommendation {
  template: ArtifactTemplate;
  matchedCatalogTemplateName?: string;
  rationale: string;
  constructionPlan: string[];
  audience: 'technical' | 'executive' | 'mixed';
  confidence: number;
  candidateId?: string;
  scoreBreakdown?: ArtifactRecommendationScoreBreakdown;
  risks?: string[];
  expectedOutput?: string;
}

// The chat model lives with the module that owns it, in
// `services/chat/ChatTypes.ts`. Re-exported for existing callers.

export type ConsistencySuggestion = {
  id: string;
  inconsistency: string;
  suggestion: string;
  isApplied: boolean;
  changes: {
    artifactId: string;
    oldContentSnippet: string; // For context
    newContent: string; // The full new content for the artifact
  }[];
};



export type ChatModalPurpose = 'guided-creation' | 'analyze-document' | 'review-architecture' | 'project-chat';

export interface UploadedFile {
  name: string;
  type: string;
  base64Data: string;
}

// The Training Center has its own model in `types/lms.ts`, and that one is
// the only one. A second copy of Course/Lesson/Module/SmartNote used to live
// here: nobody imported it, and it had drifted from the live one —
// `ArchitectRole` said 'Empresarial' where the LMS says 'Arquitecto
// Empresarial'. Two definitions of the same concept compile equally well, so
// the wrong one is only discovered at runtime. Do not reintroduce it: the
// LMS model grows in `types/lms.ts`.
