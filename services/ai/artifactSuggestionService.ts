/**
 * Orchestration layer for the artifact "Sugerencias" feature.
 *
 * The UI talks to this module — never directly to the Gemini SDK. It
 * assembles a provider-agnostic {@link ArtifactSuggestionContext}, delegates
 * inference to the artifact suggestion vertical, and validates the response into a safe
 * {@link ArtifactSuggestionReport}.
 */
import type { Settings } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../architectureProjects';
import { suggestArtifactImprovements } from './generation/artifactSuggestions';
import {
  ArtifactSuggestionError,
  parseArtifactSuggestionReport,
  type ArtifactSuggestionContext,
  type ArtifactSuggestionReport,
} from './artifactSuggestionTypes';

export type {
  ArtifactSuggestion,
  ArtifactSuggestionContext,
  ArtifactSuggestionReport,
  ArtifactSuggestionGapType,
  ArtifactSuggestionImpact,
  ArtifactSuggestionEffort,
  ArtifactSuggestionAction,
  ArtifactSuggestionActionKind,
} from './artifactSuggestionTypes';
export {
  ArtifactSuggestionError,
  GAP_TYPE_LABEL_ES,
  IMPACT_LABEL_ES,
  EFFORT_LABEL_ES,
} from './artifactSuggestionTypes';

const MAX_CONTENT_CHARS = 6000;
const MAX_LIST_ITEMS = 12;

const trimList = (items: Array<string | undefined | null>, limit = MAX_LIST_ITEMS): string[] =>
  items
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item): item is string => item.length > 0)
    .slice(0, limit);

export interface BuildSuggestionContextInput {
  artifact: Artifact;
  project: Project;
  /** Latest known quality score (0–100), when available. */
  qualityScore: number | null;
  /** Human summary of the quality state, when available. */
  qualitySummary: string | null;
  /** Outstanding quality findings, when available. */
  qualityIssues: string[];
}

/**
 * Assembles the structured context for a suggestion request. Pure and
 * defensive: every field tolerates partial/legacy artifacts.
 */
export const buildArtifactSuggestionContext = (
  input: BuildSuggestionContextInput,
  settings: Settings,
): ArtifactSuggestionContext => {
  const { artifact, project, qualityScore, qualitySummary, qualityIssues } = input;
  const trace = artifact.generationTrace;

  const content = (artifact.content ?? '').trim();
  const cappedContent =
    content.length > MAX_CONTENT_CHARS
      ? `${content.slice(0, MAX_CONTENT_CHARS)}\n…[contenido truncado para el análisis]`
      : content;

  const refinementHistory = trimList([
    ...(trace?.quality?.history?.map(
      (pass) => `Pase ${pass.pass}: score ${pass.score} (${pass.changeCount} cambios)`,
    ) ?? []),
    ...(trace?.quality?.refinementImprovedDimensions?.map(
      (dimension) => `Dimensión mejorada: ${dimension}`,
    ) ?? []),
  ]);

  return {
    artifactName: artifact.name,
    artifactType: artifact.type,
    representation: artifact.representation,
    objective: artifact.objective ?? '',
    originalPrompt: trace?.request?.userRequest?.trim() || null,
    content: cappedContent,
    currentScore: typeof qualityScore === 'number' ? qualityScore : trace?.quality?.score ?? null,
    qualitySummary: qualitySummary?.trim() || null,
    qualityIssues: trimList(qualityIssues),
    validationWarnings: trimList(trace?.warnings ?? []),
    traceStatus: trace?.status ?? null,
    traceErrors: trimList((trace?.errors ?? []).map((step) => step.message)),
    traceDecisions: trimList((trace?.decisions ?? []).map((step) => step.message)),
    generationEvents: trimList(trace?.lifecycle ?? []),
    modelUsed: trace?.modelEffective?.id ?? trace?.model ?? null,
    generationSource: trace?.source ?? null,
    detectedBusinessInfo: trimList(project.projectContext ?? []),
    detectedTechnicalInfo: trimList(
      (artifact.keyConcepts ?? []).map((concept) =>
        concept?.term ? `${concept.term}: ${concept.definition ?? ''}`.trim() : '',
      ),
    ),
    refinementHistory,
    language: settings.language === 'en' ? 'en' : 'es',
  };
};

/**
 * Runs a suggestion analysis. Throws {@link ArtifactSuggestionError} on a
 * malformed AI response so the caller can present an actionable retry state.
 */
export const requestArtifactSuggestions = async (
  context: ArtifactSuggestionContext,
  settings: Settings,
): Promise<ArtifactSuggestionReport> => {
  let raw: unknown;
  try {
    raw = await suggestArtifactImprovements(context, settings);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'No se pudo contactar al servicio de IA para generar sugerencias.';
    throw new ArtifactSuggestionError(message);
  }

  return parseArtifactSuggestionReport(raw, {
    currentScore: context.currentScore,
    modelUsed: context.modelUsed,
  });
};
