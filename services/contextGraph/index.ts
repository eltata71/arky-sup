/**
 * Architecture Context Graph — public barrel.
 *
 * The context graph is the structured, semantic replacement for raw
 * accumulated project text. It turns `Project` + `Settings` + artifacts into a
 * typed model of entities, relationships, signals, sources, conflicts,
 * freshness and relevance that feeds AI generation, scoring and traceability.
 */

export * from './contextGraphTypes';

export {
  ContextSignalExtractor,
  contextSignalExtractor,
  normalizeLabel,
  slugify,
  stripAccents,
  truncate,
} from './contextSignalExtractor';
export { ContextDeduplicator, contextDeduplicator } from './contextDeduplicator';
export {
  ContextFreshnessEvaluator,
  contextFreshnessEvaluator,
  DEFAULT_STALE_AFTER_DAYS,
} from './contextFreshnessEvaluator';
export type { FreshnessOptions } from './contextFreshnessEvaluator';
export { ContextConflictDetector, contextConflictDetector } from './contextConflictDetector';
export { ContextGraphBuilder, contextGraphBuilder } from './contextGraphBuilder';
export { ContextRelevanceRanker, contextRelevanceRanker, tokenize } from './contextRelevanceRanker';
export { ContextCitationBuilder, contextCitationBuilder } from './contextCitationBuilder';
export type { CitationResult } from './contextCitationBuilder';
export { ContextPackBuilder, contextPackBuilder } from './contextPackBuilder';
export {
  ContextGraphSerializer,
  contextGraphSerializer,
} from './contextGraphSerializer';
export type { SerializedContextGraph } from './contextGraphSerializer';

export {
  buildGraphInputFromProject,
  buildArchitectureContextGraph,
  buildContextPackForProject,
  renderContextReinforcement,
  renderContextGraphReinforcement,
  buildContextUsageReport,
  buildContextReportText,
} from './contextGraphIntegration';
export type { ContextGraphBuildOptions } from './contextGraphIntegration';
