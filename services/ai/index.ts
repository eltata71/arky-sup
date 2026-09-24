/**
 * `services/ai` — the provider-agnostic AI architecture for Arky 10.
 *
 * Layering (top → bottom):
 *   - `generation/`   domain façades (artifact/document/diagram/recommendation)
 *   - `core/`         provider-neutral contracts + `AIRequestExecutor`
 *   - `providers/`    concrete `AIProvider` implementations + factory
 *   - `modelRouting/` `AIModelRouter`
 *   - `retry/`        `AIRetryPolicy` + `AITimeoutPolicy`
 *   - `errors/`       `AIErrorClassifier`
 *   - `tracing/`      `AITraceBuilder`
 *
 * The UI and domain depend only on `core` contracts and `generation` façades —
 * never on `@google/genai` directly. Swapping/adding a provider is a matter of
 * registering a builder with `AIProviderFactory`.
 */

export * from './core';
/**
 * The factory, not the adapters.
 *
 * `GeminiProvider` and `OpenRouterProvider` are correctly named — an adapter
 * may carry the name of what it adapts — but exporting them from the
 * provider-agnostic barrel invites exactly the coupling this layer exists to
 * prevent. Nothing outside `services/ai` used them. A caller that needs a
 * provider asks `aiProviderFactory` for one; a caller that needs a *specific*
 * provider is a caller that has stopped being provider-agnostic.
 */
export { AIProviderFactory, aiProviderFactory } from './providers';
export type {
  AIProviderBuilder,
  AIProviderCapability,
  AIProviderFactoryOptions,
} from './providers';
export { AIModelRouter, aiModelRouter } from './modelRouting';
export type { RouteInput } from './modelRouting';
export { AIRetryPolicy, AITimeoutPolicy, combineAbortSignals } from './retry';
export type { AIRetryHooks, AIRetryPolicyOptions, AITimeoutRunOptions } from './retry';
export { AIErrorClassifier, geminiErrorClassifier, readErrorShape } from './errors';
/**
 * The error surface of AI generation.
 *
 * It resolves to `./errors` now, not to the engine. The names still carry the
 * original vendor in one case (`isTransientGeminiError`) — renaming a widely
 * caught symbol is a change to error handling, not to coupling, and belongs in
 * its own step.
 */
export {
  AIServiceError,
  C4SelfHealingError,
  classifyAIError,
  isTransientGeminiError,
} from './errors';
export type { AIErrorCategory, AIErrorSource } from './core';
export { AITraceBuilder, newRequestId } from './tracing';
export type { AITraceInit } from './tracing';
export {
  aiGateway,
  artifactGenerationService,
  asCourseCategory,
  asCourseLevel,
  assistantService,
  captureAssistantService,
  compactChatMessages,
  documentGenerationService,
  diagramEditService,
  initiativeAssistantService,
  diagramGenerationService,
  isQuizQuestion,
  isRelatedConcept,
  learningService,
  listModelsForProvider,
  platformGuideService,
  recommendationService,
} from './generation';
export type {
  AgentFunctionCall,
  ArtifactContentGenerationOptions,
  ArtifactGenerationSupport,
  ControlledGenerationContext,
  AgentTurnResult,
  AIModelOption,
  CaptureAssistantService,
  ProjectChatTurn,
  DiagramEditRequest,
  DiagramEditResult,
  DiagramEditService,
  PlatformGuideService,
  ChallengeEvaluation,
  InitiativeDraft,
  GeneratedCourse,
  GeneratedLesson,
  GeneratedModule,
  GeneratedTopic,
  ListModelsOptions,
  QuizQuestion,
  RelatedConcept,
  TopicFilters,
} from './generation';


/**
 * The deterministic fallbacks are `services/artifacts`, not this layer: they
 * are pure functions from a project and a template to Mermaid or Markdown, and
 * publishing them here made `services/ai` the door to something that never
 * calls a model.
 */
// What `recommendationService.getSuggestedActions` returns. Sourced from the
// shared leaf: this layer publishes the contract, not the engine that fills it.
export type { ArtifactTemplateSuggestion } from '../../lib/artifacts/artifactSuggestions';
/**
 * El control de llamadas, el catálogo de modelos y la creación guiada.
 *
 * Los tres vivían sueltos en la raíz de `services/`. Se publican aquí porque
 * la UI ya los usaba y ya entraba por este barril para otras cosas: colapsar
 * `services/aiCallControlService` y `services/guidedProjectCreationService` en
 * este import es lo que baja el fan-out de `ChatInterface` y `ProjectsPage`
 * en vez de subirlo.
 *
 * El catálogo de modelos se reexporta desde `lib/ai/modelCatalog`, que es
 * donde vive: cinco contextos necesitan resolver qué modelo implica un
 * `Settings`, y tenerlo dentro de esta capa la convertía en dependencia de
 * todos ellos. Aquí se publica por comodidad de la pantalla de Ajustes, que
 * ya entra por este barril; el arranque de la aplicación lo importa directo
 * de `lib/`.
 */
export {
  clearAiCooldown,
  estimatePayloadSize,
  executeAiCall,
  getAiBlockingCooldownRemainingMs,
  getAiCooldownRemainingMs,
  setAiCooldown,
  type AiCallMetadata,
  type AiCallPurpose,
  type AiCallResult,
} from './callControl/aiCallControlService';
export { budgetChatHistory, type BudgetOptions, type BudgetedChatContext } from './callControl/contextBudget';

// La composición de prompts sobre un proyecto, que vivía en `utils.ts` (F3-08).
// Se publica porque `services/agent` la usa para su propio contexto; el resto
// de consumidores están dentro de esta capa y entran por el fichero.
export {
  buildGlobalPrompt,
  buildLMSTutorPersona,
  buildBasePrompt,
  buildArtifactsContext,
  buildArtifactExcerpt,
  selectExcerptCandidates,
  buildSiblingDiagramsPromptBlock,
  type BasePromptMode,
  type BasePromptOptions,
  type ArtifactsContextOptions,
} from './prompts/projectPrompts';
export {
  DEFAULT_TEXT_MODEL,
  listCurrentGeminiModels,
  resolveEffectiveModel,
  resolveTextModel,
  type GeminiModelOption,
  type ModelSource,
} from '../../lib/ai/modelCatalog';
export {
  parseGuidedProjectCommand,
  sendGuidedProjectCreationMessage,
  type GuidedCreationResult,
  type GuidedProjectCommand,
  type GuidedProjectData,
} from './generation/guidedProjectCreationService';

export {
  parseStructured,
  parseAiJson,
  defineSchema,
} from './structuredOutput';
export type { AIJsonSchema, ParseStructuredResult } from './structuredOutput';
