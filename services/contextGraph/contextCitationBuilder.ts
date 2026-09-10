/**
 * ContextCitationBuilder — assigns stable, human-readable citation tags to
 * context entities (e.g. `[ctx:tech-1]`) so generated artifacts can cite the
 * exact context signal that justified each section.
 */

import type {
  ContextCitation,
  ContextEntity,
  ContextEntityType,
} from './contextGraphTypes';

const TYPE_PREFIX: Record<ContextEntityType, string> = {
  actor: 'actor',
  'user-role': 'role',
  'business-capability': 'cap',
  system: 'sys',
  application: 'app',
  'external-platform': 'ext',
  integration: 'int',
  api: 'api',
  'data-entity': 'data',
  'data-store': 'store',
  process: 'proc',
  workflow: 'flow',
  risk: 'risk',
  decision: 'dec',
  constraint: 'cons',
  assumption: 'assm',
  requirement: 'req',
  'non-functional-requirement': 'nfr',
  technology: 'tech',
  vendor: 'vendor',
  country: 'geo',
  'compliance-regulation': 'comp',
};

export interface CitationResult {
  /** entityId → citation tag. */
  tags: Map<string, string>;
  citations: ContextCitation[];
}

export class ContextCitationBuilder {
  build(entities: ContextEntity[]): CitationResult {
    const counters = new Map<string, number>();
    const tags = new Map<string, string>();
    const citations: ContextCitation[] = [];

    for (const entity of entities) {
      const prefix = TYPE_PREFIX[entity.type];
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      const tag = `[ctx:${prefix}-${next}]`;
      tags.set(entity.id, tag);
      citations.push({
        tag,
        entityId: entity.id,
        label: entity.label,
        entityType: entity.type,
        sources: entity.sources,
      });
    }

    return { tags, citations };
  }
}

export const contextCitationBuilder = new ContextCitationBuilder();
