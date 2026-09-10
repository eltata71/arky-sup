import type { ArtifactTemplate, Project } from '../../types';
import type { ArtifactGenerationContract } from './artifactGenerationContract';

export interface ArchitectureGraphAlignmentInput {
  project: Project;
  contract: ArtifactGenerationContract;
  template: ArtifactTemplate;
}

export interface ArchitectureGraphAlignmentResult {
  /** Bonus score in [0..14]. Always 0 when no graph is available. */
  score: number;
  signals: string[];
  warnings: string[];
}

const normalizeText = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const tokenize = (value: string): Set<string> =>
  new Set(normalizeText(value).split(/[^a-z0-9]+/).filter(token => token.length >= 4));

/**
 * Lightweight, total scorer that turns the (optional) Architecture Knowledge
 * Graph into a small recommendation signal. It never throws, never inflates
 * the prompt, and degrades to a zero score when no graph is present so it can
 * never block or distort recommendations.
 */
export const scoreArchitectureGraphAlignment = (
  input: ArchitectureGraphAlignmentInput,
): ArchitectureGraphAlignmentResult => {
  const { project, contract, template } = input;
  const graph = project.architectureKnowledgeGraph;

  if (!graph || !Array.isArray(graph.entities) || graph.entities.length === 0) {
    return { score: 0, signals: [], warnings: ['Sin grafo arquitectónico disponible; el scoring de grafo se omite.'] };
  }

  const signals: string[] = [];
  const warnings: string[] = [];

  const intentTokens = tokenize(`${contract.normalizedIntent} ${contract.originalRequest} ${contract.acceptanceCriteria.join(' ')}`);
  const templateTokens = tokenize(`${template.name} ${template.objective} ${template.keyConcepts.map(concept => `${concept.term} ${concept.definition}`).join(' ')}`);
  const queryTokens = new Set<string>([...intentTokens, ...templateTokens]);

  const relevantEntities = graph.entities.filter(entity => {
    const entityTokens = tokenize(`${entity.name} ${entity.normalizedName} ${entity.aliases.join(' ')}`);
    for (const token of entityTokens) {
      if (queryTokens.has(token)) return true;
    }
    return false;
  });

  let score = 0;
  if (relevantEntities.length > 0) {
    score += Math.min(8, relevantEntities.length * 2);
    signals.push(`${relevantEntities.length} entidad(es) del grafo coinciden con la intención/plantilla.`);

    const relevantIds = new Set(relevantEntities.map(entity => entity.id));
    const linkedRelations = graph.relations.filter(
      relation => relevantIds.has(relation.sourceEntityId) || relevantIds.has(relation.targetEntityId),
    );
    if (linkedRelations.length > 0) {
      score += Math.min(3, Math.ceil(linkedRelations.length / 3));
      signals.push(`${linkedRelations.length} relación(es) arquitectónicas conectan las entidades relevantes.`);
    }

    const criticalEntities = relevantEntities.filter(
      entity => entity.criticality === 'high' || entity.criticality === 'critical',
    );
    if (criticalEntities.length > 0) {
      score += Math.min(3, criticalEntities.length);
      signals.push(`${criticalEntities.length} entidad(es) crítica(s) refuerzan la trazabilidad del artefacto.`);
    }
  } else {
    warnings.push('El grafo arquitectónico existe pero no muestra entidades alineadas con la solicitud.');
  }

  if (typeof graph.quality?.score === 'number' && graph.quality.score < 50) {
    warnings.push(`La calidad del grafo es baja (${Math.round(graph.quality.score)}/100); úsalo como señal débil.`);
  }
  if (typeof graph.quality?.traceabilityGapCount === 'number' && graph.quality.traceabilityGapCount > 0) {
    warnings.push(`El grafo reporta ${graph.quality.traceabilityGapCount} brecha(s) de trazabilidad.`);
  }

  return { score: Math.max(0, Math.min(14, score)), signals, warnings };
};
