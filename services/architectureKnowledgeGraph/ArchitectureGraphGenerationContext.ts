/**
 * Architecture Knowledge Graph → artifact generation bridge.
 *
 * Wraps `buildArchitectureGraphPromptContext` for the artifact generation
 * pipeline: it produces both the prompt block to inject *and* the
 * trace-friendly usage summary the generation trace records, from a single
 * deterministic pass.
 *
 * It is the choke point that keeps the prompt from bloating (the underlying
 * builder enforces entity/relation/character budgets and ranks by artifact
 * type, intent and audience) and that degrades safely: on any failure — or on
 * an empty/absent graph — it returns an empty block and an inert usage record
 * so generation continues exactly as before.
 */

import type { ArtifactType } from '../../types';
import type { ArtifactGenerationGraphUsage } from '../../lib/artifacts';
import type { ArchitectureGraph } from './ArchitectureKnowledgeGraphTypes';
import type { ArchitectureGraphFreshness } from './ArchitectureGraphFreshness';
import { buildArchitectureGraphPromptContext } from './ArchitectureGraphPromptContextBuilder';
import { reportGraphFailure } from './ArchitectureGraphObservability';

export interface ArchitectureGraphGenerationContextOptions {
  artifactType?: ArtifactType;
  audience?: 'technical' | 'executive' | 'operations' | 'mixed';
  /** Free-text intent that focuses entity selection. */
  intent?: string;
  language?: 'es' | 'en';
}

export interface ArchitectureGraphGenerationContext {
  /** Markdown block ready to append to the generation prompt ('' when unusable). */
  promptBlock: string;
  /** Trace-friendly summary recorded on the artifact's generation trace. */
  usage: ArtifactGenerationGraphUsage;
}

const inertUsage = (
  freshness: ArchitectureGraphFreshness,
  buildId?: string,
): ArtifactGenerationGraphUsage => ({
  used: false,
  freshness,
  ...(buildId ? { buildId } : {}),
  entitiesIncluded: 0,
  relationsIncluded: 0,
  consistencyIssueCount: 0,
  traceabilityGapCount: 0,
});

/**
 * Builds the architecture-graph context for a single artifact generation.
 * Never throws.
 */
export const buildArtifactGenerationGraphContext = (
  graph: ArchitectureGraph | null | undefined,
  freshness: ArchitectureGraphFreshness,
  options: ArchitectureGraphGenerationContextOptions = {},
): ArchitectureGraphGenerationContext => {
  if (!graph || graph.entities.length === 0) {
    return { promptBlock: '', usage: inertUsage(freshness, graph?.buildId) };
  }
  try {
    const context = buildArchitectureGraphPromptContext(graph, {
      artifactType: options.artifactType,
      audience: options.audience,
      intent: options.intent,
      language: options.language ?? 'es',
    });
    if (context.empty || context.markdown.trim().length === 0) {
      return { promptBlock: '', usage: inertUsage(freshness, graph.buildId) };
    }
    // A stale graph is still useful context, but the model is told not to
    // treat it as absolute truth so it does not entrench outdated knowledge.
    const staleNote = freshness === 'stale'
      ? '\n\n> Nota: el grafo de conocimiento puede estar desactualizado respecto de los últimos cambios; úsalo como referencia, no como verdad absoluta.'
      : '';
    return {
      promptBlock: `${context.markdown}${staleNote}`,
      usage: {
        used: true,
        buildId: graph.buildId,
        freshness,
        entitiesIncluded: context.includedEntityIds.length,
        relationsIncluded: context.includedRelationIds.length,
        consistencyIssueCount: graph.quality.consistencyIssueCount,
        traceabilityGapCount: graph.quality.traceabilityGapCount,
      },
    };
  } catch (error) {
    reportGraphFailure('graph.build.failed', error, { projectId: graph.projectId });
    return { promptBlock: '', usage: inertUsage(freshness, graph.buildId) };
  }
};
