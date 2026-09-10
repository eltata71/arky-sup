/**
 * Architecture consistency engine (Task 7).
 *
 * Reads the Architecture Knowledge Graph and surfaces cross-artifact
 * inconsistencies: entities named differently across artifacts, external
 * systems drawn but not documented, APIs documented but not diagrammed,
 * requirements without traceability, risks without mitigation, dangling
 * diagram references, and more.
 *
 * The engine only *detects* — it never mutates the graph. Each issue is
 * actionable, attributed and confidence-scored so the UI and the artifact
 * compiler can decide whether to warn or block.
 */

import type {
  ArchitectureConsistencyIssue,
  ArchitectureConsistencyIssueType,
  ArchitectureConsistencyReport,
  ArchitectureEntity,
  ArchitectureGraph,
  ArchitectureGraphArtifactInput,
  ArchitectureIssueSeverity,
  ArchitectureRelation,
} from './ArchitectureKnowledgeGraphTypes';
import { trackGraphEvent } from './ArchitectureGraphObservability';

const REQUIREMENT_TYPES = new Set<ArchitectureEntity['type']>([
  'requirement',
  'functionalRequirement',
  'nonFunctionalRequirement',
  'userStory',
  'useCase',
]);

const DIAGRAM_SOURCE_TYPES = new Set(['artifact-ir']);

interface ConsistencyContext {
  graph: ArchitectureGraph;
  artifacts: ArchitectureGraphArtifactInput[];
  byId: Map<string, ArchitectureEntity>;
  outgoing: Map<string, ArchitectureRelation[]>;
  incoming: Map<string, ArchitectureRelation[]>;
}

const buildContext = (
  graph: ArchitectureGraph,
  artifacts: ArchitectureGraphArtifactInput[],
): ConsistencyContext => {
  const byId = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const outgoing = new Map<string, ArchitectureRelation[]>();
  const incoming = new Map<string, ArchitectureRelation[]>();
  for (const relation of graph.relations) {
    const out = outgoing.get(relation.sourceEntityId) ?? [];
    out.push(relation);
    outgoing.set(relation.sourceEntityId, out);
    const inc = incoming.get(relation.targetEntityId) ?? [];
    inc.push(relation);
    incoming.set(relation.targetEntityId, inc);
  }
  return { graph, artifacts, byId, outgoing, incoming };
};

/** Whether an entity participates in at least one relation of the given types. */
const touchesRelationType = (
  ctx: ConsistencyContext,
  entityId: string,
  types: ReadonlySet<ArchitectureRelation['type']>,
): boolean => {
  const out = ctx.outgoing.get(entityId) ?? [];
  const inc = ctx.incoming.get(entityId) ?? [];
  return out.some((r) => types.has(r.type)) || inc.some((r) => types.has(r.type));
};

const distinctArtifacts = (entity: ArchitectureEntity): string[] =>
  Array.from(new Set(entity.sourceRefs.map((ref) => ref.artifactId).filter((id): id is string => Boolean(id))));

let issueCounter = 0;
const makeIssue = (
  type: ArchitectureConsistencyIssueType,
  severity: ArchitectureIssueSeverity,
  message: string,
  recommendation: string,
  options: {
    affectedArtifactIds?: string[];
    affectedEntityIds?: string[];
    affectedRelationIds?: string[];
    autoFixable?: boolean;
    confidence?: number;
  } = {},
): ArchitectureConsistencyIssue => {
  issueCounter += 1;
  return {
    id: `cons-${type}-${issueCounter}`,
    severity,
    type,
    message,
    recommendation,
    affectedArtifactIds: options.affectedArtifactIds ?? [],
    affectedEntityIds: options.affectedEntityIds ?? [],
    affectedRelationIds: options.affectedRelationIds ?? [],
    autoFixable: options.autoFixable ?? false,
    confidence: Math.max(0, Math.min(1, options.confidence ?? 0.7)),
  };
};

const NFR_METRIC = /\d+\s*(%|ms|seg|s\b|min|rps|tps|req|usuarios|d[ií]as|gb|mb)/i;

/**
 * Runs the full consistency analysis over a graph. Pure — never throws.
 */
export const analyzeArchitectureConsistency = (
  graph: ArchitectureGraph,
  artifacts: ArchitectureGraphArtifactInput[] = [],
): ArchitectureConsistencyReport => {
  issueCounter = 0;
  const ctx = buildContext(graph, artifacts);
  const issues: ArchitectureConsistencyIssue[] = [];

  // 1 + 17 — duplicate / divergently-named entities.
  for (const entity of graph.entities) {
    if (entity.status !== 'candidate-duplicate') continue;
    const dupTag = entity.tags.find((tag) => tag.startsWith('candidate-duplicate-of:'));
    const otherId = dupTag?.split(':')[1];
    issues.push(
      makeIssue(
        'duplicate-entities',
        'medium',
        `"${entity.name}" se parece a otra entidad del grafo y podría estar duplicada.`,
        'Revisa ambas entidades: fusiónalas si son la misma o diferéncialas con nombres y alias claros.',
        { affectedEntityIds: otherId ? [entity.id, otherId] : [entity.id], affectedArtifactIds: distinctArtifacts(entity), confidence: 0.6 },
      ),
    );
  }

  // 16 — same name, incompatible types across artifacts (contradiction).
  const byNormalizedName = new Map<string, ArchitectureEntity[]>();
  for (const entity of graph.entities) {
    const list = byNormalizedName.get(entity.normalizedName) ?? [];
    list.push(entity);
    byNormalizedName.set(entity.normalizedName, list);
  }
  byNormalizedName.forEach((list) => {
    if (list.length < 2) return;
    issues.push(
      makeIssue(
        'contradicting-artifacts',
        'high',
        `"${list[0].name}" aparece con tipos arquitectónicos distintos (${list.map((e) => e.type).join(', ')}).`,
        'Unifica el tipo de la entidad entre artefactos o renómbrala para reflejar conceptos distintos.',
        { affectedEntityIds: list.map((e) => e.id), affectedArtifactIds: list.flatMap(distinctArtifacts), confidence: 0.65 },
      ),
    );
  });

  for (const entity of graph.entities) {
    const fromDiagram = entity.sourceRefs.some((ref) => DIAGRAM_SOURCE_TYPES.has(ref.sourceType));
    const fromDocument = entity.sourceRefs.some(
      (ref) => ref.sourceType === 'artifact-content' || ref.sourceType === 'artifact-objective' || ref.sourceType === 'artifact-key-concept',
    );
    const fromProject = entity.sourceRefs.some((ref) => ref.sourceType.startsWith('project') || ref.sourceType === 'agent-memory' || ref.sourceType === 'initial-capture');

    // 2 — external systems drawn but never documented.
    if (entity.type === 'externalSystem' && fromDiagram && !fromDocument && !fromProject) {
      issues.push(
        makeIssue(
          'undocumented-external-system',
          'medium',
          `El sistema externo "${entity.name}" aparece en diagramas pero no está documentado.`,
          'Documenta el sistema externo en el BRD o en una ficha de integración con su propósito y contrato.',
          { affectedEntityIds: [entity.id], affectedArtifactIds: distinctArtifacts(entity), confidence: 0.7 },
        ),
      );
    }

    // 3 — APIs mentioned in documents but not present in any diagram.
    if (entity.type === 'api' && fromDocument && !fromDiagram) {
      issues.push(
        makeIssue(
          'api-not-in-diagram',
          'medium',
          `La API "${entity.name}" se menciona en documentos pero no aparece en ningún diagrama.`,
          'Añade la API a un diagrama de contenedores o de secuencia para mantener vistas alineadas.',
          { affectedEntityIds: [entity.id], affectedArtifactIds: distinctArtifacts(entity), confidence: 0.6 },
        ),
      );
    }

    // 4 — data entities without an ERD / domain model source.
    if (entity.type === 'dataEntity') {
      const inErd = entity.sourceRefs.some(
        (ref) => ref.artifactType === 'mermaid-erd' || ref.artifactType === 'sdd-domain-model',
      );
      if (!inErd) {
        issues.push(
          makeIssue(
            'data-entity-without-erd',
            'low',
            `La entidad de datos "${entity.name}" no está vinculada a un ERD ni a un modelo de dominio.`,
            'Incluye la entidad en un diagrama ERD o en el modelo de dominio para asegurar su consistencia.',
            { affectedEntityIds: [entity.id], affectedArtifactIds: distinctArtifacts(entity), confidence: 0.55 },
          ),
        );
      }
    }

    // 5 — requirements without traceability.
    if (REQUIREMENT_TYPES.has(entity.type)) {
      const traced = touchesRelationType(ctx, entity.id, new Set(['tracesTo', 'satisfies', 'implements', 'validates', 'derivedFrom']));
      if (!traced) {
        issues.push(
          makeIssue(
            'requirement-without-traceability',
            'high',
            `El requerimiento "${entity.name}" no tiene trazabilidad hacia diseño, pruebas u otros artefactos.`,
            'Vincula el requerimiento a su diseño y a casos de prueba mediante una matriz de trazabilidad.',
            { affectedEntityIds: [entity.id], affectedArtifactIds: distinctArtifacts(entity), confidence: 0.75 },
          ),
        );
      }
    }

    // 6 — NFR without a metric.
    if (entity.type === 'nonFunctionalRequirement' || entity.type === 'qualityAttribute') {
      const hasMetric = NFR_METRIC.test(`${entity.name} ${entity.description ?? ''}`);
      const linkedToQuality = touchesRelationType(ctx, entity.id, new Set(['satisfies', 'validates', 'constrains']));
      if (!hasMetric && !linkedToQuality) {
        issues.push(
          makeIssue(
            'nfr-without-metric',
            'medium',
            `El requerimiento no funcional "${entity.name}" no declara una métrica medible.`,
            'Define un objetivo cuantificable (p. ej. latencia < 200 ms, disponibilidad 99.9%) y vincúlalo a la arquitectura.',
            { affectedEntityIds: [entity.id], affectedArtifactIds: distinctArtifacts(entity), confidence: 0.6 },
          ),
        );
      }
    }

    // 7 — risks without mitigation.
    if (entity.type === 'risk') {
      const mitigated = touchesRelationType(ctx, entity.id, new Set(['mitigates']));
      if (!mitigated) {
        issues.push(
          makeIssue(
            'risk-without-mitigation',
            'high',
            `El riesgo "${entity.name}" no tiene una mitigación asociada.`,
            'Define una mitigación concreta y enlázala al riesgo en el registro de riesgos.',
            { affectedEntityIds: [entity.id], affectedArtifactIds: distinctArtifacts(entity), confidence: 0.7 },
          ),
        );
      }
    }

    // 8 — decisions without declared impact.
    if (entity.type === 'decision') {
      const hasImpact = touchesRelationType(ctx, entity.id, new Set(['impacts', 'constrains', 'derivedFrom']));
      if (!hasImpact) {
        issues.push(
          makeIssue(
            'decision-without-impact',
            'medium',
            `La decisión "${entity.name}" no declara qué componentes o artefactos afecta.`,
            'Registra el impacto de la decisión enlazándola a los componentes y artefactos afectados.',
            { affectedEntityIds: [entity.id], affectedArtifactIds: distinctArtifacts(entity), confidence: 0.6 },
          ),
        );
      }
    }

    // 9 — components without a parent container.
    if (entity.type === 'component') {
      const inc = ctx.incoming.get(entity.id) ?? [];
      const hasParent = inc.some((r) => r.type === 'contains') || touchesRelationType(ctx, entity.id, new Set(['belongsTo']));
      if (!hasParent) {
        issues.push(
          makeIssue(
            'component-without-container',
            'low',
            `El componente "${entity.name}" no está contenido en ningún contenedor.`,
            'Asocia el componente a su contenedor en el diagrama C4 de componentes.',
            { affectedEntityIds: [entity.id], affectedArtifactIds: distinctArtifacts(entity), confidence: 0.5 },
          ),
        );
      }
    }

    // 12 — events without producer or consumer.
    if (entity.type === 'event' || entity.type === 'domainEvent') {
      const linked = touchesRelationType(ctx, entity.id, new Set(['publishes', 'consumes']));
      if (!linked) {
        issues.push(
          makeIssue(
            'event-without-producer-or-consumer',
            'medium',
            `El evento "${entity.name}" no tiene un productor ni un consumidor identificado.`,
            'Modela quién publica y quién consume el evento para cerrar el flujo asíncrono.',
            { affectedEntityIds: [entity.id], affectedArtifactIds: distinctArtifacts(entity), confidence: 0.6 },
          ),
        );
      }
    }

    // 13 — test cases without a linked requirement.
    if (entity.type === 'testCase') {
      const linked = touchesRelationType(ctx, entity.id, new Set(['tracesTo', 'validates']));
      if (!linked) {
        issues.push(
          makeIssue(
            'test-without-requirement',
            'medium',
            `El caso de prueba "${entity.name}" no está asociado a ningún requerimiento.`,
            'Vincula el caso de prueba al requerimiento que verifica en la matriz de trazabilidad.',
            { affectedEntityIds: [entity.id], affectedArtifactIds: distinctArtifacts(entity), confidence: 0.6 },
          ),
        );
      }
    }

    // 14 — user stories without acceptance criteria.
    if (entity.type === 'userStory') {
      const hasAcceptance = /criterio|aceptaci[óo]n|acceptance|gherkin|dado que|given /i.test(
        `${entity.name} ${entity.description ?? ''}`,
      );
      const linkedToTest = touchesRelationType(ctx, entity.id, new Set(['validates', 'tracesTo']));
      if (!hasAcceptance && !linkedToTest) {
        issues.push(
          makeIssue(
            'user-story-without-acceptance',
            'low',
            `La historia de usuario "${entity.name}" no declara criterios de aceptación.`,
            'Añade criterios de aceptación verificables o enlázala a escenarios BDD.',
            { affectedEntityIds: [entity.id], affectedArtifactIds: distinctArtifacts(entity), confidence: 0.5 },
          ),
        );
      }
    }

    // 15 — ambiguous glossary terms.
    if (entity.type === 'glossaryTerm') {
      const definition = (entity.description ?? '').trim();
      if (definition.length < 12) {
        issues.push(
          makeIssue(
            'ambiguous-glossary-term',
            'low',
            `El término de glosario "${entity.name}" tiene una definición ausente o demasiado breve.`,
            'Amplía la definición para que el lenguaje ubicuo sea inequívoco.',
            { affectedEntityIds: [entity.id], affectedArtifactIds: distinctArtifacts(entity), confidence: 0.55 },
          ),
        );
      }
    }

    // 1 — naming divergence: a merged entity carrying conflicting aliases from
    // multiple artifacts.
    if (entity.aliases.length > 1 && distinctArtifacts(entity).length > 1 && entity.status !== 'candidate-duplicate') {
      issues.push(
        makeIssue(
          'naming-divergence',
          'low',
          `"${entity.name}" se nombra de formas distintas entre artefactos (${[entity.name, ...entity.aliases].slice(0, 3).join(', ')}).`,
          'Adopta un nombre canónico único y mantén las variantes solo como alias.',
          { affectedEntityIds: [entity.id], affectedArtifactIds: distinctArtifacts(entity), autoFixable: true, confidence: 0.5 },
        ),
      );
    }
  }

  // 10 — dangling relations (endpoint never resolved to a real entity).
  for (const relation of graph.relations) {
    const source = ctx.byId.get(relation.sourceEntityId);
    const target = ctx.byId.get(relation.targetEntityId);
    const dangling =
      !source ||
      !target ||
      source.tags.includes('unresolved-reference') ||
      target.tags.includes('unresolved-reference');
    if (dangling) {
      issues.push(
        makeIssue(
          'dangling-relation',
          'medium',
          `Una relación del diagrama apunta a un elemento no reconocido en el grafo.`,
          'Verifica los extremos de la relación; renombra o crea la entidad faltante.',
          {
            affectedRelationIds: [relation.id],
            affectedEntityIds: [relation.sourceEntityId, relation.targetEntityId],
            confidence: 0.65,
          },
        ),
      );
    }

    // 11 — integrations without a declared protocol.
    const involvesIntegration = [source, target].some(
      (e) => e && (e.type === 'integration' || e.type === 'externalSystem' || e.type === 'api'),
    );
    const integrationRelation = relation.type === 'calls' || relation.type === 'uses' || relation.type === 'consumes';
    if (involvesIntegration && integrationRelation && !relation.protocol) {
      issues.push(
        makeIssue(
          'integration-without-protocol',
          'low',
          `Una integración hacia "${target?.name ?? 'destino'}" no declara protocolo.`,
          'Especifica el protocolo de la integración (REST, gRPC, AMQP, …) en el diagrama.',
          { affectedRelationIds: [relation.id], affectedEntityIds: [relation.sourceEntityId, relation.targetEntityId], confidence: 0.5 },
        ),
      );
    }
  }

  // 18 — low graph coverage: artifacts that contributed nothing.
  const contributingArtifacts = new Set<string>();
  for (const entity of graph.entities) {
    for (const ref of entity.sourceRefs) {
      if (ref.artifactId) contributingArtifacts.add(ref.artifactId);
    }
  }
  for (const artifact of artifacts) {
    if (!contributingArtifacts.has(artifact.id)) {
      issues.push(
        makeIssue(
          'low-graph-coverage',
          'low',
          `El artefacto "${artifact.name}" no aportó ninguna entidad al grafo de conocimiento.`,
          'Enriquece el artefacto con conceptos clave o regenéralo para que contribuya al grafo.',
          { affectedArtifactIds: [artifact.id], confidence: 0.5 },
        ),
      );
    }
  }

  const countsBySeverity: Record<ArchitectureIssueSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const issue of issues) countsBySeverity[issue.severity] += 1;
  const verdict: ArchitectureConsistencyReport['verdict'] =
    countsBySeverity.critical > 0 ? 'blocked' : issues.length > 0 ? 'warning' : 'clean';

  if (issues.length > 0) {
    trackGraphEvent('graph.consistency.issue.detected', `${issues.length} inconsistencias`, {
      projectId: graph.projectId,
      count: issues.length,
      verdict,
    });
  }

  return {
    projectId: graph.projectId,
    generatedAt: graph.lastBuiltAt,
    issues,
    countsBySeverity,
    verdict,
  };
};
