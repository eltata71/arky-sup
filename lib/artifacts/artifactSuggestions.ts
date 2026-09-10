/**
 * The vocabulary of an artifact suggestion: what kind of gap it names, how
 * much it matters, and what action closes it.
 *
 * It lived in `services/ai/` because the model is what produces suggestions —
 * but `services/diagram` is what *executes* them, so the diagram module had to
 * import the AI layer to know what an action is, while the AI layer imported
 * the diagram module's signal extractor to write its prompt. Two modules,
 * joined by four type declarations.
 *
 * A suggestion is a domain concept, not a model output format. The words move
 * to a leaf with no dependencies; the parsing of a model response that fills
 * them in stays in `services/ai/artifactSuggestionTypes.ts`.
 */

export const SUGGESTION_GAP_TYPES = [
  'business',
  'technical',
  'data',
  'integration',
  'security',
  'architecture',
  'ux-ui',
  'documentation',
  'diagram',
  'traceability',
] as const;

export type ArtifactSuggestionGapType = (typeof SUGGESTION_GAP_TYPES)[number];

export const SUGGESTION_IMPACTS = ['high', 'medium', 'low'] as const;
export type ArtifactSuggestionImpact = (typeof SUGGESTION_IMPACTS)[number];

export const SUGGESTION_EFFORTS = ['low', 'medium', 'high'] as const;
export type ArtifactSuggestionEffort = (typeof SUGGESTION_EFFORTS)[number];

/** Spanish labels surfaced in the UI — keeps identifiers stable in code. */
export const GAP_TYPE_LABEL_ES: Record<ArtifactSuggestionGapType, string> = {
  business: 'Negocio',
  technical: 'Técnica',
  data: 'Datos',
  integration: 'Integración',
  security: 'Seguridad',
  architecture: 'Arquitectura',
  'ux-ui': 'UX/UI',
  documentation: 'Calidad documental',
  diagram: 'Calidad diagramática',
  traceability: 'Trazabilidad',
};

export const IMPACT_LABEL_ES: Record<ArtifactSuggestionImpact, string> = {
  high: 'Alto',
  medium: 'Medio',
  low: 'Bajo',
};

export const EFFORT_LABEL_ES: Record<ArtifactSuggestionEffort, string> = {
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
};

/**
 * Gap 13 — typed executable actions surfaced in the suggestions panel.
 *
 * Each kind maps to a deterministic operation the panel can run without
 * an AI roundtrip (apply ELK, change orientation, set density,
 * regenerate with IR-direct, …). The `params` payload is action-specific
 * and stays optional so legacy suggestions without an action keep
 * rendering as advisory.
 */
export type ArtifactSuggestionActionKind =
  | 'apply-elk-layout'
  | 'set-layout-direction'
  | 'set-layout-density'
  | 'convert-to-bpmn'
  | 'assign-group-kind'
  | 'add-missing-protocols'
  | 'add-security-controls'
  | 'tag-phi-pii'
  | 'switch-audience'
  | 'split-c4-levels'
  | 'regenerate-with-ir-direct'
  | 'repair-exportability'
  // BPMN visual maturity actions
  | 'mark-edges-as-message-flow'
  | 'mark-edges-as-sequence-flow'
  | 'add-bpmn-start-end-events'
  | 'create-swimlanes-from-owners'
  | 'repair-bpmn-layout';

export interface ArtifactSuggestionAction {
  kind: ArtifactSuggestionActionKind;
  label: string;
  /** Brief description the panel shows next to the button. */
  description?: string;
  /** Optional action parameters (e.g. direction TB/LR, density compact). */
  params?: Record<string, string>;
  /**
   * When `true` the panel runs the action without confirmation; when
   * `false` the panel asks for confirmation first. Defaults to false.
   */
  autoApply?: boolean;
}

/**
 * A recommendation to create an artifact from a catalogue template.
 *
 * Deliberately *not* `ArtifactSuggestion`, which is the rich thing below. Both
 * names existed — this one inside `services/geminiService.ts`, published by the
 * `services/ai` barrel, and the one below in this file — so `services/ai` and
 * `services/ai/artifactSuggestionTypes` each exported a different type under
 * the same name. Nothing broke, because the two call sites happened to import
 * the right one; that is luck, not design.
 */
export interface ArtifactTemplateSuggestion {
  templateName: string;
  reason: string;
}

/** A single prioritized, actionable recommendation. */
export interface ArtifactSuggestion {
  id: string;
  title: string;
  description: string;
  gapType: ArtifactSuggestionGapType;
  impact: ArtifactSuggestionImpact;
  effort: ArtifactSuggestionEffort;
  /** Concrete action the user should take. */
  recommendedAction: string;
  /** Evidence from the artifact/trace that justifies the suggestion. */
  evidence: string;
  /** Estimated quality points gained if applied (0–40), or null when unknown. */
  expectedQualityGain: number | null;
  /**
   * Gap 13 — optional executable actions. When present, the panel renders
   * each as a button that runs the corresponding handler.
   */
  actions?: ArtifactSuggestionAction[];
}

/** The full result of an artifact suggestion analysis. */
export interface ArtifactSuggestionReport {
  generatedAt: string;
  qualitySummary: string;
  currentScore: number | null;
  suggestions: ArtifactSuggestion[];
  /** True when there is not enough context for high-confidence suggestions. */
  insufficientContext: boolean;
  /** When context is thin, the minimal extra input the user should provide. */
  missingContextHints: string[];
  modelUsed: string | null;
}

/** Structured context handed to the AI layer. Provider-agnostic. */
export interface ArtifactSuggestionContext {
  artifactName: string;
  artifactType: string;
  representation: 'diagram' | 'document' | 'hybrid';
  objective: string;
  originalPrompt: string | null;
  /** Trimmed artifact content (the service caps the length). */
  content: string;
  currentScore: number | null;
  qualitySummary: string | null;
  qualityIssues: string[];
  validationWarnings: string[];
  traceStatus: string | null;
  traceErrors: string[];
  traceDecisions: string[];
  generationEvents: string[];
  modelUsed: string | null;
  generationSource: string | null;
  detectedBusinessInfo: string[];
  detectedTechnicalInfo: string[];
  refinementHistory: string[];
  language: 'es' | 'en';
}

/** Raised when the AI response cannot be coerced into a usable report. */
