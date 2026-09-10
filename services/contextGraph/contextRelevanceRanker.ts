/**
 * ContextRelevanceRanker — assigns a [0..1] relevance score to each entity for
 * a given `ContextPackQuery`.
 *
 * Score blends:
 *  - the entity's base confidence,
 *  - lexical overlap with the query intent,
 *  - a boost when the entity type is preferred by the target artifact type,
 *  - a boost when the entity type matches the target audience,
 *  - small penalties for stale and inferred entities.
 *
 * Pure scoring — never mutates the input entities.
 */

import type {
  ContextEntity,
  ContextEntityType,
  ContextPackQuery,
  RankedContextEntity,
} from './contextGraphTypes';
import type { ArtifactType } from '../../types';
import { stripAccents } from './contextSignalExtractor';

const STOPWORDS = new Set<string>([
  'the', 'and', 'que', 'con', 'una', 'uno', 'los', 'las', 'del', 'para', 'por',
  'sin', 'sobre', 'como', 'esta', 'este', 'esto', 'sus', 'are', 'for', 'this',
  'that', 'with', 'into', 'from', 'over', 'debe', 'sistema', 'proyecto',
]);

export const tokenize = (value: string): string[] =>
  stripAccents(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));

/** Entity types each artifact type benefits from most. */
const ARTIFACT_TYPE_PREFERENCES: Partial<Record<ArtifactType, ContextEntityType[]>> = {
  'mermaid-erd': ['data-entity', 'data-store'],
  'sdd-domain-model': ['data-entity', 'business-capability', 'process'],
  'mermaid-sequence': ['actor', 'api', 'integration', 'process', 'application'],
  'mermaid-c4-context': ['system', 'external-platform', 'actor', 'integration'],
  'mermaid-c4-container': ['application', 'system', 'data-store', 'integration', 'api'],
  'mermaid-c4-component': ['application', 'api', 'integration', 'data-store'],
  'mermaid-c4-deployment': ['application', 'technology', 'vendor', 'data-store'],
  'mermaid-state': ['process', 'workflow'],
  'mermaid-gantt': ['process', 'workflow', 'requirement'],
  'mermaid-graph': ['system', 'application', 'integration', 'process'],
  'react-flow-graph': ['system', 'application', 'integration', 'process'],
  'sdd-nfr': ['non-functional-requirement', 'constraint', 'risk'],
  'sdd-brd': ['requirement', 'business-capability', 'actor', 'constraint'],
  'sdd-user-story': ['requirement', 'actor', 'user-role', 'business-capability'],
  'sdd-use-case': ['requirement', 'actor', 'user-role', 'process'],
  'sdd-traceability': ['requirement', 'non-functional-requirement', 'decision'],
  'sdd-glossary': ['business-capability', 'data-entity'],
  'sdd-event-storming': ['process', 'workflow', 'data-entity'],
  'sdd-bdd': ['requirement', 'process', 'actor'],
};

/** Entity types each audience cares about most. */
const AUDIENCE_PREFERENCES: Record<string, ContextEntityType[]> = {
  executive: ['business-capability', 'risk', 'decision', 'constraint', 'compliance-regulation'],
  technical: ['system', 'application', 'api', 'integration', 'data-store', 'technology'],
  operations: ['process', 'workflow', 'risk', 'integration', 'non-functional-requirement'],
  mixed: ['system', 'business-capability', 'integration', 'risk', 'decision'],
};

const overlapScore = (intentTokens: Set<string>, entity: ContextEntity): number => {
  if (intentTokens.size === 0) return 0;
  const haystack = [entity.label, ...entity.aliases, ...entity.tags].join(' ');
  const tokens = tokenize(haystack);
  if (tokens.length === 0) return 0;
  let hits = 0;
  for (const token of new Set(tokens)) {
    if (intentTokens.has(token)) hits += 1;
  }
  return hits / Math.max(tokens.length, intentTokens.size);
};

export class ContextRelevanceRanker {
  rank(entities: ContextEntity[], query: ContextPackQuery = {}): RankedContextEntity[] {
    const intentTokens = new Set(tokenize(query.intent ?? ''));
    const preferredByArtifact = new Set(
      query.artifactType ? ARTIFACT_TYPE_PREFERENCES[query.artifactType] ?? [] : [],
    );
    const preferredByAudience = new Set(
      query.audience ? AUDIENCE_PREFERENCES[query.audience] ?? [] : [],
    );

    const scored: RankedContextEntity[] = entities.map((entity) => {
      const base = entity.confidence;
      const overlap = overlapScore(intentTokens, entity);
      const artifactBoost = preferredByArtifact.has(entity.type) ? 0.18 : 0;
      const audienceBoost = preferredByAudience.has(entity.type) ? 0.1 : 0;
      const sourceBoost = Math.min(0.08, (entity.sources.length - 1) * 0.03);
      const stalePenalty = entity.freshness.stale ? 0.12 : 0;
      const inferredPenalty = entity.mode === 'inferred' ? 0.06 : 0;
      const relevance = Math.max(
        0,
        Math.min(
          1,
          base * 0.5 + overlap * 0.3 + artifactBoost + audienceBoost + sourceBoost - stalePenalty - inferredPenalty,
        ),
      );
      return { ...entity, relevance: Number(relevance.toFixed(4)) };
    });

    scored.sort((a, b) => {
      if (b.relevance !== a.relevance) return b.relevance - a.relevance;
      return a.label.localeCompare(b.label);
    });

    if (typeof query.topK === 'number' && query.topK > 0) {
      return scored.slice(0, query.topK);
    }
    return scored;
  }
}

export const contextRelevanceRanker = new ContextRelevanceRanker();
