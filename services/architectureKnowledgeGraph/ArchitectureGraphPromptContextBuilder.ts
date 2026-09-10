/**
 * Architecture Knowledge Graph → prompt context builder (Task 10).
 *
 * Turns the graph into a compact, citable Markdown block that *complements*
 * (never replaces) `projectContext` and `keyConcepts` in a generation prompt.
 * Entities are ranked by confidence, criticality, intent overlap and
 * relevance to the target artifact type, then trimmed to a character budget
 * so the prompt never bloats.
 */

import type {
  ArchitectureEntity,
  ArchitectureGraph,
  ArchitectureGraphPromptContext,
  ArchitectureGraphPromptContextOptions,
  ArchitectureEntityType,
} from './ArchitectureKnowledgeGraphTypes';
import type { ArtifactType } from '../../types';
import { tokenSimilarity } from './ArchitectureGraphNormalization';
import { analyzeArchitectureConsistency } from './ArchitectureConsistencyService';
import { analyzeArchitectureTraceability } from './ArchitectureTraceabilityService';
import { trackGraphEvent } from './ArchitectureGraphObservability';

const DEFAULTS: Required<Omit<ArchitectureGraphPromptContextOptions, 'artifactType' | 'audience' | 'intent'>> = {
  maxEntities: 18,
  maxRelations: 14,
  maxChars: 2400,
  includeRisks: true,
  includeDecisions: true,
  includeNFRs: true,
  includeDataEntities: true,
  includeIntegrationEntities: true,
  includeTraceabilityGaps: true,
  language: 'es',
};

const CRITICALITY_BONUS = { critical: 0.32, high: 0.22, medium: 0.1, low: 0 } as const;

/** Boosts entity types that matter most for a given artifact type. */
const typeRelevance = (artifactType: ArtifactType | undefined, entityType: ArchitectureEntityType): number => {
  if (!artifactType) return 0;
  const t = artifactType;
  const dataTypes: ArchitectureEntityType[] = ['dataEntity', 'dataStore', 'database'];
  const c4Types: ArchitectureEntityType[] = ['system', 'externalSystem', 'container', 'component', 'actor'];
  const nfrTypes: ArchitectureEntityType[] = ['nonFunctionalRequirement', 'qualityAttribute', 'securityControl'];
  const reqTypes: ArchitectureEntityType[] = ['requirement', 'functionalRequirement', 'userStory', 'useCase'];
  if (t === 'mermaid-erd' && dataTypes.includes(entityType)) return 0.4;
  if (t.startsWith('mermaid-c4') && c4Types.includes(entityType)) return 0.4;
  if (t === 'sdd-nfr' && nfrTypes.includes(entityType)) return 0.4;
  if ((t === 'sdd-brd' || t === 'sdd-user-story') && reqTypes.includes(entityType)) return 0.4;
  if (t === 'sdd-glossary' && entityType === 'glossaryTerm') return 0.4;
  if ((t === 'mermaid-sequence' || t === 'sdd-event-storming') && ['event', 'domainEvent', 'api', 'component'].includes(entityType)) return 0.35;
  return 0;
};

const scoreEntity = (
  entity: ArchitectureEntity,
  options: ArchitectureGraphPromptContextOptions,
): number => {
  let score = entity.confidence * 0.5;
  score += CRITICALITY_BONUS[entity.criticality];
  score += typeRelevance(options.artifactType, entity.type);
  if (options.intent) {
    score += tokenSimilarity(entity.name, options.intent) * 0.5;
  }
  if (entity.status === 'candidate-duplicate' || entity.status === 'unverified') score -= 0.15;
  if (entity.type === 'unknown') score -= 0.25;
  return score;
};

const renderEntityLine = (entity: ArchitectureEntity): string => {
  const alias = entity.aliases.length > 0 ? ` (alias: ${entity.aliases.slice(0, 2).join(', ')})` : '';
  const desc = entity.description ? ` — ${entity.description}` : '';
  return `- [${entity.type}] ${entity.name}${alias}${desc}`;
};

/**
 * Builds the prompt context block. Always returns a result; `empty` is `true`
 * when the graph carried no usable knowledge.
 */
export const buildArchitectureGraphPromptContext = (
  graph: ArchitectureGraph,
  options: ArchitectureGraphPromptContextOptions = {},
): ArchitectureGraphPromptContext => {
  const opts = { ...DEFAULTS, ...options };
  const generatedAt = new Date().toISOString();

  if (graph.entities.length === 0) {
    return {
      projectId: graph.projectId,
      generatedAt,
      markdown: '',
      includedEntityIds: [],
      includedRelationIds: [],
      approximateChars: 0,
      empty: true,
    };
  }

  const ranked = [...graph.entities]
    .map((entity) => ({ entity, score: scoreEntity(entity, opts) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.maxEntities)
    .map((item) => item.entity);

  const includedIds = new Set(ranked.map((e) => e.id));
  const relations = graph.relations
    .filter((r) => includedIds.has(r.sourceEntityId) && includedIds.has(r.targetEntityId))
    .slice(0, opts.maxRelations);

  const byId = new Map(graph.entities.map((e) => [e.id, e]));
  const lines: string[] = [];
  const heading = opts.language === 'en' ? 'ARCHITECTURE KNOWLEDGE GRAPH' : 'GRAFO DE CONOCIMIENTO ARQUITECTÓNICO';
  lines.push(`### ${heading}`);
  lines.push(
    opts.language === 'en'
      ? 'Canonical, project-wide architectural knowledge. Stay consistent with it; do not contradict it.'
      : 'Conocimiento arquitectónico canónico del proyecto. Mantén consistencia con él; no lo contradigas.',
  );

  const section = (title: string, items: string[]): void => {
    if (items.length === 0) return;
    lines.push('', `**${title}**`);
    lines.push(...items);
  };

  const pickByType = (predicate: (e: ArchitectureEntity) => boolean): ArchitectureEntity[] =>
    ranked.filter(predicate);

  section(opts.language === 'en' ? 'Key entities' : 'Entidades clave',
    pickByType((e) => !['risk', 'decision', 'constraint', 'glossaryTerm'].includes(e.type)).slice(0, 12).map(renderEntityLine));

  if (relations.length > 0) {
    section(opts.language === 'en' ? 'Critical relations' : 'Relaciones críticas',
      relations.map((r) => {
        const from = byId.get(r.sourceEntityId)?.name ?? r.sourceEntityId;
        const to = byId.get(r.targetEntityId)?.name ?? r.targetEntityId;
        const protocol = r.protocol ? ` [${r.protocol}]` : '';
        return `- ${from} —${r.type}→ ${to}${protocol}`;
      }));
  }

  if (opts.includeDecisions) {
    section('Decisiones aplicables', pickByType((e) => e.type === 'decision').map(renderEntityLine));
  }
  section('Restricciones y supuestos', pickByType((e) => e.type === 'constraint' || e.type === 'assumption').map(renderEntityLine));
  if (opts.includeRisks) {
    section('Riesgos a considerar', pickByType((e) => e.type === 'risk').map(renderEntityLine));
  }
  if (opts.includeNFRs) {
    section('Requisitos no funcionales', pickByType((e) => e.type === 'nonFunctionalRequirement' || e.type === 'qualityAttribute').map(renderEntityLine));
  }
  if (opts.includeDataEntities) {
    section('Datos', pickByType((e) => e.type === 'dataEntity' || e.type === 'dataStore' || e.type === 'database').map(renderEntityLine));
  }
  if (opts.includeIntegrationEntities) {
    section('Sistemas externos e integraciones', pickByType((e) => e.type === 'externalSystem' || e.type === 'integration' || e.type === 'api').map(renderEntityLine));
  }
  section('Eventos', pickByType((e) => e.type === 'event' || e.type === 'domainEvent').map(renderEntityLine));
  section('Términos del glosario', pickByType((e) => e.type === 'glossaryTerm').slice(0, 8).map(renderEntityLine));

  const consistency = analyzeArchitectureConsistency(graph);
  const blockingIssues = consistency.issues.filter((i) => i.severity === 'critical' || i.severity === 'high');
  if (blockingIssues.length > 0) {
    section('Inconsistencias pendientes (no las repitas)', blockingIssues.slice(0, 5).map((i) => `- ${i.message}`));
  }

  if (opts.includeTraceabilityGaps) {
    const traceability = analyzeArchitectureTraceability(graph);
    const importantGaps = traceability.gaps.filter((g) => g.severity === 'high' || g.severity === 'medium');
    if (importantGaps.length > 0) {
      section('Vacíos de trazabilidad a cubrir', importantGaps.slice(0, 5).map((g) => `- ${g.message}`));
    }
  }

  lines.push(
    '',
    opts.language === 'en'
      ? 'Reuse the entity names above verbatim; introduce new entities only when the artifact genuinely requires them.'
      : 'Reutiliza los nombres de entidad anteriores tal cual; introduce entidades nuevas solo si el artefacto realmente lo exige.',
  );

  let markdown = lines.join('\n');
  if (markdown.length > opts.maxChars) {
    markdown = `${markdown.slice(0, opts.maxChars - 1)}…`;
  }

  trackGraphEvent('graph.promptContext.generated', `${ranked.length} entidades en contexto`, {
    projectId: graph.projectId,
    entityCount: ranked.length,
    chars: markdown.length,
  });

  return {
    projectId: graph.projectId,
    generatedAt,
    markdown,
    includedEntityIds: ranked.map((e) => e.id),
    includedRelationIds: relations.map((r) => r.id),
    approximateChars: markdown.length,
    empty: false,
  };
};
