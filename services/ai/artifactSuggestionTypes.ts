/**
 * Reading a model's suggestion report.
 *
 * The vocabulary these functions produce lives in
 * `lib/artifacts/artifactSuggestions.ts` — a leaf, because `services/diagram`
 * executes suggestions and must not import the AI layer to do it. What is left
 * here is the part that is genuinely about a model: parsing its JSON, and the
 * error raised when it does not hold.
 */

export * from '../../lib/artifacts/artifactSuggestions';
import {
  SUGGESTION_EFFORTS,
  SUGGESTION_GAP_TYPES,
  SUGGESTION_IMPACTS,
  type ArtifactSuggestion,
  type ArtifactSuggestionEffort,
  type ArtifactSuggestionAction,
  type ArtifactSuggestionActionKind,
  type ArtifactSuggestionGapType,
  type ArtifactSuggestionImpact,
  type ArtifactSuggestionReport,
} from '../../lib/artifacts/artifactSuggestions';

export class ArtifactSuggestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactSuggestionError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asTrimmedString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(asTrimmedString).filter((entry) => entry.length > 0)
    : [];

const coerceEnum = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T => {
  const normalized = asTrimmedString(value).toLowerCase();
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T) : fallback;
};

const coerceGain = (value: unknown): number | null => {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(40, Math.round(num)));
};

let suggestionCounter = 0;
const nextSuggestionId = (): string => {
  suggestionCounter += 1;
  return `suggestion-${Date.now().toString(36)}-${suggestionCounter}`;
};

const IMPACT_RANK: Record<ArtifactSuggestionImpact, number> = { high: 0, medium: 1, low: 2 };
const EFFORT_RANK: Record<ArtifactSuggestionEffort, number> = { low: 0, medium: 1, high: 2 };

/** Stable priority order: highest impact first, lowest effort breaks ties. */
export const sortSuggestionsByPriority = (
  suggestions: ArtifactSuggestion[],
): ArtifactSuggestion[] =>
  [...suggestions].sort((a, b) => {
    const impactDelta = IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact];
    if (impactDelta !== 0) return impactDelta;
    return EFFORT_RANK[a.effort] - EFFORT_RANK[b.effort];
  });

const KNOWN_ACTION_KINDS: readonly ArtifactSuggestionActionKind[] = [
  'apply-elk-layout',
  'set-layout-direction',
  'set-layout-density',
  'convert-to-bpmn',
  'assign-group-kind',
  'add-missing-protocols',
  'add-security-controls',
  'tag-phi-pii',
  'switch-audience',
  'split-c4-levels',
  'regenerate-with-ir-direct',
  'repair-exportability',
  'mark-edges-as-message-flow',
  'mark-edges-as-sequence-flow',
  'add-bpmn-start-end-events',
  'create-swimlanes-from-owners',
  'repair-bpmn-layout',
];

const parseAction = (raw: unknown): ArtifactSuggestionAction | null => {
  if (!isRecord(raw)) return null;
  const kindRaw = asTrimmedString(raw.kind).toLowerCase();
  if (!(KNOWN_ACTION_KINDS as readonly string[]).includes(kindRaw)) return null;
  const label = asTrimmedString(raw.label) || kindRaw;
  const description = asTrimmedString(raw.description) || undefined;
  let params: Record<string, string> | undefined;
  if (isRecord(raw.params)) {
    params = {};
    for (const [key, value] of Object.entries(raw.params)) {
      const v = asTrimmedString(value);
      if (v) params[key] = v;
    }
    if (Object.keys(params).length === 0) params = undefined;
  }
  return {
    kind: kindRaw as ArtifactSuggestionActionKind,
    label,
    description,
    params,
    autoApply: raw.autoApply === true,
  };
};

const parseSuggestion = (raw: unknown): ArtifactSuggestion | null => {
  if (!isRecord(raw)) return null;
  const title = asTrimmedString(raw.title);
  const description = asTrimmedString(raw.description);
  if (!title || !description) return null;
  const rawActions = Array.isArray(raw.actions) ? raw.actions : [];
  const actions = rawActions
    .map(parseAction)
    .filter((a): a is ArtifactSuggestionAction => a !== null);
  return {
    id: asTrimmedString(raw.id) || nextSuggestionId(),
    title,
    description,
    gapType: coerceEnum<ArtifactSuggestionGapType>(raw.gapType, SUGGESTION_GAP_TYPES, 'architecture'),
    impact: coerceEnum<ArtifactSuggestionImpact>(raw.impact, SUGGESTION_IMPACTS, 'medium'),
    effort: coerceEnum<ArtifactSuggestionEffort>(raw.effort, SUGGESTION_EFFORTS, 'medium'),
    recommendedAction:
      asTrimmedString(raw.recommendedAction) || 'Revisa y completa la sección señalada antes de regenerar.',
    evidence: asTrimmedString(raw.evidence) || 'Derivado del análisis del artefacto actual.',
    expectedQualityGain: coerceGain(raw.expectedQualityGain),
    actions: actions.length > 0 ? actions : undefined,
  };
};

/**
 * Coerces a raw AI response into a safe {@link ArtifactSuggestionReport}.
 * Lenient on individual fields (invalid suggestions are dropped, enums are
 * clamped); throws {@link ArtifactSuggestionError} only when the top-level
 * shape is unusable.
 */
export const parseArtifactSuggestionReport = (
  raw: unknown,
  options: { currentScore: number | null; modelUsed: string | null },
): ArtifactSuggestionReport => {
  if (!isRecord(raw)) {
    throw new ArtifactSuggestionError('La respuesta de IA no tiene el formato esperado.');
  }

  const rawSuggestions = Array.isArray(raw.suggestions) ? raw.suggestions : [];
  const suggestions = sortSuggestionsByPriority(
    rawSuggestions
      .map(parseSuggestion)
      .filter((entry): entry is ArtifactSuggestion => entry !== null),
  );

  const insufficientContext = raw.insufficientContext === true || suggestions.length === 0;

  return {
    generatedAt: new Date().toISOString(),
    qualitySummary:
      asTrimmedString(raw.qualitySummary) ||
      'No se pudo resumir el estado de calidad del artefacto.',
    currentScore: options.currentScore,
    suggestions,
    insufficientContext,
    missingContextHints: asStringArray(raw.missingContextHints),
    modelUsed: options.modelUsed,
  };
};
