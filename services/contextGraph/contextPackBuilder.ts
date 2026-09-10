/**
 * ContextPackBuilder — composes a compact, ranked, citable slice of the
 * Architecture Context Graph tailored to one AI generation.
 *
 * The pack is shaped by a `ContextPackQuery` (artifact type, audience, intent,
 * architectural view, phase, language, detail level, related artifacts). It is
 * the structured replacement for dumping raw accumulated project text into a
 * prompt.
 */

import {
  type ArchitectureContextGraph,
  type ContextConflict,
  type ContextDetailLevel,
  type ContextEntityType,
  type ContextPack,
  type ContextPackEntity,
  type ContextPackQuery,
  type ContextRelationship,
  type IgnoredContextSignal,
  type RankedContextEntity,
} from './contextGraphTypes';
import { contextRelevanceRanker } from './contextRelevanceRanker';
import { contextCitationBuilder } from './contextCitationBuilder';

interface DetailDefaults {
  topK: number;
  maxChars: number;
}

const DETAIL_DEFAULTS: Record<ContextDetailLevel, DetailDefaults> = {
  minimal: { topK: 10, maxChars: 1800 },
  standard: { topK: 22, maxChars: 4200 },
  rich: { topK: 40, maxChars: 7500 },
};

interface DisplayGroup {
  title: string;
  types: ContextEntityType[];
}

const DISPLAY_GROUPS: DisplayGroup[] = [
  { title: 'Sistemas y aplicaciones', types: ['system', 'application', 'external-platform'] },
  { title: 'Actores y roles', types: ['actor', 'user-role'] },
  { title: 'Capacidades de negocio', types: ['business-capability'] },
  { title: 'Integraciones y APIs', types: ['integration', 'api'] },
  { title: 'Datos', types: ['data-entity', 'data-store'] },
  { title: 'Procesos y flujos', types: ['process', 'workflow'] },
  { title: 'Tecnología y proveedores', types: ['technology', 'vendor'] },
  { title: 'Restricciones y cumplimiento', types: ['constraint', 'compliance-regulation', 'requirement', 'non-functional-requirement'] },
  { title: 'Decisiones y supuestos', types: ['decision', 'assumption'] },
  { title: 'Riesgos', types: ['risk'] },
  { title: 'Geografía', types: ['country'] },
];

const RELATIONSHIP_LABELS: Record<string, string> = {
  'depends-on': 'depende de',
  'integrates-with': 'se integra con',
  owns: 'es dueño de',
  consumes: 'consume',
  produces: 'produce',
  stores: 'almacena',
  exposes: 'expone',
  calls: 'invoca',
  mitigates: 'mitiga',
  constrains: 'restringe',
  satisfies: 'satisface',
  'conflicts-with': 'entra en conflicto con',
  'derived-from': 'se deriva de',
  'related-to': 'se relaciona con',
};

const newPackId = (projectId: string): string =>
  `ctxpack-${(projectId || 'project').slice(0, 8)}-${Date.now().toString(36)}`;

const estimateEntityLine = (entity: ContextPackEntity): number =>
  entity.label.length + (entity.description?.length ?? 0) + entity.citation.length + 16;

export class ContextPackBuilder {
  build(graph: ArchitectureContextGraph, query: ContextPackQuery = {}): ContextPack {
    const detail = query.detailLevel ?? 'standard';
    const defaults = DETAIL_DEFAULTS[detail];
    const limit = query.topK ?? defaults.topK;
    const budget = query.maxChars ?? defaults.maxChars;

    const rankQuery: ContextPackQuery = { ...query, topK: undefined };
    const ranked = contextRelevanceRanker.rank(graph.entities, rankQuery);

    // Pin entities authored from the artifacts the caller flagged as related.
    const relatedArtifacts = new Set(query.relatedArtifactIds ?? []);
    const isPinned = (entity: RankedContextEntity): boolean =>
      entity.sources.some((s) => s.artifactId && relatedArtifacts.has(s.artifactId));

    const ordered = [
      ...ranked.filter(isPinned),
      ...ranked.filter((e) => !isPinned(e)),
    ];

    const { tags } = contextCitationBuilder.build(ordered);
    const packEntities: ContextPackEntity[] = ordered.map((entity) => ({
      ...entity,
      citation: tags.get(entity.id) ?? '[ctx]',
    }));

    // Select within the topK + character budget.
    const selected: ContextPackEntity[] = [];
    const ignored: IgnoredContextSignal[] = [];
    let charCount = 0;
    for (const entity of packEntities) {
      const lineCost = estimateEntityLine(entity);
      const withinLimit = selected.length < limit;
      const withinBudget = charCount + lineCost <= budget;
      if (withinLimit && withinBudget) {
        selected.push(entity);
        charCount += lineCost;
      } else {
        ignored.push({
          entityId: entity.id,
          label: entity.label,
          entityType: entity.type,
          relevance: entity.relevance,
          reason: !withinLimit
            ? `Excede el top-${limit} de relevancia`
            : 'Excede el presupuesto de caracteres del pack',
        });
      }
    }

    const selectedIds = new Set(selected.map((e) => e.id));
    const relationships = graph.relationships.filter(
      (rel) => selectedIds.has(rel.fromId) && selectedIds.has(rel.toId),
    );

    const byType = (types: ContextEntityType[]): ContextPackEntity[] =>
      selected.filter((e) => types.includes(e.type));

    const conflicts = graph.conflicts.filter(
      (c) => c.severity === 'high' || c.entityIds.some((id) => selectedIds.has(id)),
    );

    const freshness = this.summarizeFreshness(selected);
    const markdown = this.renderMarkdown(graph, query, selected, relationships, conflicts);

    return {
      id: newPackId(graph.projectId),
      projectId: graph.projectId,
      generatedAt: new Date().toISOString(),
      query,
      entities: selected,
      relationships,
      constraints: byType(['constraint', 'compliance-regulation']),
      risks: byType(['risk']),
      decisions: byType(['decision', 'assumption']),
      dataEntities: byType(['data-entity', 'data-store']),
      integrations: byType(['integration', 'api', 'external-platform']),
      citations: contextCitationBuilder.build(selected).citations,
      conflicts,
      ignoredSignals: ignored.slice(0, 40),
      freshness,
      markdown,
      approximateChars: markdown.length,
    };
  }

  private summarizeFreshness(entities: ContextPackEntity[]): ContextPack['freshness'] {
    let newestAt: string | undefined;
    let oldestAt: string | undefined;
    let staleCount = 0;
    for (const entity of entities) {
      const { lastSeenAt, firstSeenAt, stale } = entity.freshness;
      if (lastSeenAt && (!newestAt || lastSeenAt > newestAt)) newestAt = lastSeenAt;
      if (firstSeenAt && (!oldestAt || firstSeenAt < oldestAt)) oldestAt = firstSeenAt;
      if (stale) staleCount += 1;
    }
    return { newestAt, oldestAt, staleCount };
  }

  private renderMarkdown(
    graph: ArchitectureContextGraph,
    query: ContextPackQuery,
    entities: ContextPackEntity[],
    relationships: ContextRelationship[],
    conflicts: ContextConflict[],
  ): string {
    const lines: string[] = [];
    lines.push('## Contexto estructurado del proyecto (Architecture Context Graph)');
    lines.push(
      `> ${entities.length} entidades · ${relationships.length} relaciones · ` +
        `${conflicts.length} conflicto(s) · audiencia ${query.audience ?? 'mixta'}.`,
    );
    lines.push(
      'Usa este contexto como fuente primaria. Cita cada sección con el tag `[ctx:*]` correspondiente. ' +
        'No inventes entidades que no aparezcan aquí.',
    );

    const labelById = new Map(entities.map((e) => [e.id, e]));

    lines.push('', '### Entidades relevantes');
    for (const group of DISPLAY_GROUPS) {
      const inGroup = entities.filter((e) => group.types.includes(e.type));
      if (inGroup.length === 0) continue;
      lines.push('', `#### ${group.title}`);
      for (const entity of inGroup) {
        const desc = entity.description ? ` — ${entity.description}` : '';
        const aliases = entity.aliases.length > 0 ? ` _(alias: ${entity.aliases.join(', ')})_` : '';
        const stale = entity.freshness.stale ? ' ⏳ posible contexto obsoleto' : '';
        const mode = entity.mode === 'inferred' ? ' _(inferido)_' : '';
        lines.push(`- ${entity.citation} **${entity.label}**${desc}${aliases}${mode}${stale}`);
      }
    }

    if (relationships.length > 0) {
      lines.push('', '### Relaciones clave');
      for (const rel of relationships.slice(0, 30)) {
        const from = labelById.get(rel.fromId);
        const to = labelById.get(rel.toId);
        if (!from || !to) continue;
        const verb = RELATIONSHIP_LABELS[rel.type] ?? rel.type;
        const mode = rel.mode === 'inferred' ? ' _(inferida)_' : '';
        lines.push(`- ${from.citation} ${from.label} → _${verb}_ → ${to.citation} ${to.label}${mode}`);
      }
    }

    if (conflicts.length > 0) {
      lines.push('', '### Conflictos de contexto (resuélvelos antes de generar)');
      for (const conflict of conflicts) {
        lines.push(`- ⚠ **${conflict.severity.toUpperCase()}** — ${conflict.description}`);
      }
    }

    const citations = contextCitationBuilder.build(entities).citations;
    if (citations.length > 0) {
      lines.push('', '### Fuentes citadas');
      for (const citation of citations) {
        const origin = Array.from(new Set(citation.sources.map((s) => s.label))).slice(0, 3).join('; ');
        lines.push(`- ${citation.tag} ${citation.label} — origen: ${origin || 'n/d'}`);
      }
    }

    return lines.join('\n');
  }
}

export const contextPackBuilder = new ContextPackBuilder();
