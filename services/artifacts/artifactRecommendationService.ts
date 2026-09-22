import { ARTIFACT_TEMPLATES } from '../../constants';
import type { ArchitecturalView, ArtifactTemplate, ArtifactType, ArtifactRecommendationScoreBreakdown } from '../../types';
import type { Project } from '../architectureProjects';
import type { ArtifactGenerationContract } from './artifactGenerationContract';
import { selectArtifactGenerationContext, type ArtifactContextSelectionResult } from './artifactContextSelectionService';
import { scoreArchitectureGraphAlignment } from './architectureGraphAlignment';

export type { ArtifactRecommendationScoreBreakdown } from '../../types';

export interface ArtifactRecommendationCandidate {
  id: string;
  template: ArtifactTemplate;
  matchedCatalogTemplateName: string;
  confidence: number;
  scoreBreakdown: ArtifactRecommendationScoreBreakdown;
  rationale: string;
  /** Explicit trade-offs the architect should weigh before generating. */
  tradeoffs: string[];
  constructionPlan: string[];
  risks: string[];
  expectedOutput: string;
}

const normalizeText = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const tokenize = (value: string): Set<string> => new Set(normalizeText(value).split(/[^a-z0-9]+/).filter(token => token.length >= 3));

const overlapScore = (left: string, right: string): number => {
  const tokens = tokenize(right);
  const text = tokenize(left);
  let matches = 0;
  for (const token of tokens) {
    if (text.has(token)) matches += 1;
  }
  return Math.min(30, matches * 4);
};

type PreferredRepresentation = 'document' | 'diagram' | 'hybrid' | 'auto';

const representationForFamily = (family: ArtifactGenerationContract['artifactFamily']): PreferredRepresentation => {
  if (family === 'document' || family === 'table' || family === 'matrix' || family === 'presentation') return 'document';
  if (family === 'diagram') return 'diagram';
  if (family === 'hybrid') return 'hybrid';
  return 'auto';
};

/**
 * Family fit rank: 0 = ideal representation, 1 = acceptable, 2 = mismatch.
 * Drives the hard guarantee that an explicit family request never surfaces a
 * mismatched representation as the first option.
 */
const familyRank = (family: ArtifactGenerationContract['artifactFamily'], template: ArtifactTemplate): 0 | 1 | 2 => {
  const representation = template.representation;
  if (family === 'auto') return 0;
  if (family === 'diagram') {
    if (representation === 'diagram') return 0;
    if (representation === 'hybrid') return 1;
    return 2;
  }
  if (family === 'hybrid') {
    if (representation === 'hybrid') return 0;
    return 1;
  }
  // document | table | matrix | presentation
  if (representation === 'document') return 0;
  if (representation === 'hybrid') return 1;
  return 2;
};

const mapAudienceToRequestContext = (audience: ArtifactGenerationContract['audience']): 'technical' | 'executive' | 'mixed' => {
  if (audience === 'executive' || audience === 'business') return 'executive';
  if (audience === 'technical' || audience === 'operations') return 'technical';
  return 'mixed';
};

const artifactTypeHints: Record<string, ArtifactType[]> = {
  data: ['mermaid-erd', 'sdd-domain-model', 'sdd-glossary'],
  sequence: ['mermaid-sequence'],
  deployment: ['mermaid-c4-deployment'],
  integration: ['mermaid-graph', 'mermaid-c4-container'],
  process: ['hybrid-text-diagram', 'mermaid-graph'],
  requirements: ['sdd-traceability', 'sdd-brd', 'sdd-nfr', 'sdd-user-story'],
};

const architecturalViewHints: Record<string, ArchitecturalView[]> = {
  data: ['Vista de Datos'],
  sequence: ['Vista de Proceso e Interacción'],
  deployment: ['Vista Física y de Despliegue'],
  integration: ['Vista Lógica y de Diseño'],
  process: ['Vista de Proceso e Interacción', 'Vista de Contexto y Negocio'],
  requirements: ['Vista SDD', 'Vista de Calidad y Validación'],
};

type DetectedIntent = keyof typeof artifactTypeHints | 'executive' | 'structure' | 'table';

const detectIntent = (contract: ArtifactGenerationContract): DetectedIntent => {
  const text = normalizeText(`${contract.normalizedIntent} ${contract.originalRequest} ${contract.acceptanceCriteria.join(' ')}`);
  if (/\b(tabla|matriz|listado|inventario|traceability|trazabilidad)\b/.test(text)) return 'table';
  if (/\b(secuencia|llamada|mensaje|cronologico|paso a paso)\b/.test(text)) return 'sequence';
  if (/\b(dato|datos|erd|entidad|dominio|dfd|data flow)\b/.test(text)) return 'data';
  if (/\b(despliegue|infraestructura|cloud|kubernetes|ambiente|nube)\b/.test(text)) return 'deployment';
  if (/\b(api|integracion|evento|mensajeria|interoperabilidad|externo)\b/.test(text)) return 'integration';
  if (/\b(proceso|bpmn|workflow|flujo de valor|actividad|operativa)\b/.test(text)) return 'process';
  if (/\b(requerimiento|requisito|nfr|rnf|gap|brecha|validacion|cobertura)\b/.test(text)) return 'requirements';
  if (contract.audience === 'executive') return 'executive';
  return 'structure';
};

const daysBetween = (fromIso: string, nowMs: number): number => {
  const fromMs = new Date(fromIso).getTime();
  if (!Number.isFinite(fromMs)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (nowMs - fromMs) / (1000 * 60 * 60 * 24));
};

const scoreSourceFreshness = (selection: ArtifactContextSelectionResult, nowMs: number): number => {
  const sources = [...selection.requiredSources, ...selection.optionalSources];
  if (sources.length === 0) return 0;
  const freshestDays = Math.min(...sources.map(source => daysBetween(source.createdAt, nowMs)));
  if (freshestDays <= 14) return 8;
  if (freshestDays <= 45) return 6;
  if (freshestDays <= 120) return 4;
  if (freshestDays <= 365) return 2;
  return 1;
};

const scoreSourceQuality = (selection: ArtifactContextSelectionResult): number => {
  const scores = [...selection.requiredSources, ...selection.optionalSources]
    .map(source => source.qualityScore)
    .filter((value): value is number => typeof value === 'number');
  if (scores.length === 0) return 0;
  const avg = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return Math.max(0, Math.min(10, Math.round((avg / 100) * 10)));
};

const scorePhaseViewAlignment = (contract: ArtifactGenerationContract, template: ArtifactTemplate, intent: DetectedIntent): number => {
  let score = 0;
  const hintedViews = intent in architecturalViewHints ? architecturalViewHints[intent] : [];
  if (hintedViews.includes(template.architecturalView)) score += 6;
  const view = normalizeText(template.architecturalView);
  if (contract.detailLevel === 'physical' && view.includes('fisica')) score += 4;
  else if (contract.detailLevel === 'logical' && view.includes('logica')) score += 4;
  else if (contract.detailLevel === 'executive' && (view.includes('contexto') || view.includes('negocio'))) score += 3;
  else if ((contract.detailLevel === 'technical' || contract.detailLevel === 'deep-technical') && (view.includes('logica') || view.includes('fisica'))) score += 3;
  return Math.min(10, score);
};

const scoreAcceptanceCriteriaCoverage = (contract: ArtifactGenerationContract, templateText: string): number => {
  if (contract.acceptanceCriteria.length === 0) return 0;
  const templateTokens = tokenize(templateText);
  const covered = contract.acceptanceCriteria.filter(criterion => {
    const criterionTokens = tokenize(criterion);
    for (const token of criterionTokens) {
      if (templateTokens.has(token)) return true;
    }
    return false;
  }).length;
  return Math.round((covered / contract.acceptanceCriteria.length) * 14);
};

const scoreTemplate = (
  project: Project,
  contract: ArtifactGenerationContract,
  template: ArtifactTemplate,
  selection: ArtifactContextSelectionResult,
  nowMs: number,
): ArtifactRecommendationScoreBreakdown => {
  const intent = detectIntent(contract);
  const templateText = `${template.name} ${template.objective} ${template.type} ${template.architecturalView} ${template.phase} ${template.keyConcepts.map(item => `${item.term} ${item.definition}`).join(' ')}`;
  let intentMatch = overlapScore(templateText, `${contract.normalizedIntent} ${contract.originalRequest}`);
  const hintedTypes = intent in artifactTypeHints ? artifactTypeHints[intent] : [];
  if (hintedTypes.includes(template.type)) intentMatch += 28;
  const hintedViews = intent in architecturalViewHints ? architecturalViewHints[intent] : [];
  if (hintedViews.includes(template.architecturalView)) intentMatch += 12;
  if (intent === 'executive' && /resumen ejecutivo|presentacion|one pager/i.test(normalizeText(template.name))) intentMatch += 25;
  if (intent === 'table' && template.representation === 'document') intentMatch += 26;

  const audienceMatch = contract.audience === 'executive'
    ? (template.type === 'presentation-executive' || normalizeText(template.name).includes('ejecutivo') ? 20 : template.representation === 'document' ? 12 : 4)
    : contract.audience === 'technical' || contract.audience === 'operations'
      ? (template.architecturalView === 'Vista Lógica y de Diseño' || template.architecturalView === 'Vista Física y de Despliegue' || template.architecturalView === 'Vista de Datos' ? 16 : 10)
      : 12;

  const preferredRepresentation = representationForFamily(contract.artifactFamily);
  let representationMatch = preferredRepresentation === 'auto'
    ? 10
    : template.representation === preferredRepresentation
      ? 26
      : template.representation === 'hybrid' && (preferredRepresentation === 'diagram' || preferredRepresentation === 'document')
        ? 12
        : -24;
  if ((contract.artifactFamily === 'table' || contract.artifactFamily === 'matrix') && template.representation === 'diagram') representationMatch -= 28;
  if (contract.artifactFamily === 'diagram' && template.representation === 'document') representationMatch -= 24;
  if (contract.artifactFamily === 'document' && template.representation === 'diagram') representationMatch -= 24;
  if (contract.artifactFamily === 'hybrid' && template.type === 'hybrid-text-diagram') representationMatch += 10;
  if (contract.artifactFamily === 'presentation' && (template.type === 'presentation-executive' || normalizeText(template.name).includes('ejecutivo'))) representationMatch += 12;

  const contextAvailability = Math.min(16, selection.usedContextItems.length * 3 + selection.requiredSources.length * 5 + selection.optionalSources.length * 3);
  const sourceArtifactRelevance = Math.min(16, selection.requiredSources.length * 8 + selection.optionalSources.reduce((sum, source) => sum + Math.min(4, source.relevanceScore), 0));

  const graphAlignment = scoreArchitectureGraphAlignment({ project, contract, template });
  const sourceQualityScore = scoreSourceQuality(selection);
  const freshnessScore = scoreSourceFreshness(selection, nowMs);
  const phaseViewAlignment = scorePhaseViewAlignment(contract, template, intent);
  const acceptanceCriteriaCoverage = scoreAcceptanceCriteriaCoverage(contract, templateText);

  const riskPenalty = Math.max(0,
    (contract.excludedSourceArtifactIds.length > 0 ? 2 : 0)
    + (representationMatch < 0 ? Math.abs(representationMatch) : 0)
    + (contract.acceptanceCriteria.length === 0 ? 10 : 0)
    + (contract.acceptanceCriteria.length > 0 && acceptanceCriteriaCoverage < 3 ? 4 : 0),
  );

  return {
    intentMatch,
    audienceMatch,
    representationMatch,
    contextAvailability,
    sourceArtifactRelevance,
    riskPenalty,
    architectureGraphAlignment: graphAlignment.score,
    sourceQualityScore,
    freshnessScore,
    phaseViewAlignment,
    acceptanceCriteriaCoverage,
  };
};

export const totalRecommendationScore = (breakdown: ArtifactRecommendationScoreBreakdown): number => (
  breakdown.intentMatch
  + breakdown.audienceMatch
  + breakdown.representationMatch
  + breakdown.contextAvailability
  + breakdown.sourceArtifactRelevance
  + (breakdown.architectureGraphAlignment ?? 0)
  + (breakdown.sourceQualityScore ?? 0)
  + (breakdown.freshnessScore ?? 0)
  + (breakdown.phaseViewAlignment ?? 0)
  + (breakdown.acceptanceCriteriaCoverage ?? 0)
  - breakdown.riskPenalty
);

const buildOnDemandName = (baseName: string, contract: ArtifactGenerationContract): string => {
  const compactIntent = contract.normalizedIntent.replace(/\s+/g, ' ').slice(0, 54).trim();
  return `${baseName} — ${compactIntent}${contract.normalizedIntent.length > 54 ? '…' : ''}`;
};

interface ScoredTemplate {
  template: ArtifactTemplate;
  scoreBreakdown: ArtifactRecommendationScoreBreakdown;
  total: number;
}

/**
 * Hard family guarantee: when the architect requested an explicit family, the
 * first option must never present a mismatched representation (e.g. a diagram
 * for a document request). The single escape hatch is a "strong justification"
 * — a mismatched template whose total beats the best family-fit template by a
 * wide margin keeps its lead.
 */
const STRONG_JUSTIFICATION_MARGIN = 40;

const enforceFamilyPreference = (
  scored: ScoredTemplate[],
  family: ArtifactGenerationContract['artifactFamily'],
): ScoredTemplate[] => {
  if (family === 'auto' || scored.length === 0) return scored;
  const top = scored[0];
  if (familyRank(family, top.template) <= 1) return scored;
  const bestFitIndex = scored.findIndex(entry => familyRank(family, entry.template) <= 1);
  if (bestFitIndex <= 0) return scored;
  const bestFit = scored[bestFitIndex];
  if (top.total - bestFit.total > STRONG_JUSTIFICATION_MARGIN) return scored;
  return [bestFit, ...scored.slice(0, bestFitIndex), ...scored.slice(bestFitIndex + 1)];
};

export interface BuildRecommendationOptions {
  /** Reference timestamp for freshness scoring; defaults to now. */
  now?: string;
}

export const buildArtifactRecommendationCandidates = (
  project: Project,
  contract: ArtifactGenerationContract,
  maxCandidates = 3,
  options: BuildRecommendationOptions = {},
): ArtifactRecommendationCandidate[] => {
  const nowMs = options.now ? new Date(options.now).getTime() : Date.now();
  const contextSelection = selectArtifactGenerationContext(project, contract, { maxOptionalSources: 3, sourceSummaryChars: 180 });

  const scored: ScoredTemplate[] = ARTIFACT_TEMPLATES.map(template => {
    const scoreBreakdown = scoreTemplate(project, contract, template, contextSelection, nowMs);
    return { template, scoreBreakdown, total: totalRecommendationScore(scoreBreakdown) };
  }).sort((a, b) => b.total - a.total || a.template.name.localeCompare(b.template.name));

  const ordered = enforceFamilyPreference(scored, contract.artifactFamily);
  const topScore = Math.max(1, ordered[0]?.total ?? 1);
  const intent = detectIntent(contract);

  return ordered.slice(0, Math.max(1, maxCandidates)).map((entry, index) => {
    const confidence = Math.max(0.45, Math.min(0.96, entry.total / Math.max(topScore, 80)));
    const selectedSourceArtifactIds = [
      ...contextSelection.requiredSources.map(source => source.id),
      ...contextSelection.optionalSources.map(source => source.id),
    ];
    const constructionPlan = [
      'Validar la intención normalizada, audiencia, propósito y nivel de detalle del contrato aprobado.',
      'Usar únicamente las fuentes obligatorias/opcionales seleccionadas y respetar exclusiones explícitas.',
      `Construir el artefacto con el estándar “${entry.template.name}” y cubrir los criterios de aceptación definidos.`,
      'Cerrar con trazabilidad de decisiones, supuestos y puntos pendientes de validación arquitectónica.',
    ];

    const coverage = entry.scoreBreakdown.acceptanceCriteriaCoverage ?? 0;
    const rationale = `Candidato #${index + 1}: combina intención “${intent}”, preferencia ${contract.artifactFamily}, audiencia ${contract.audience} y ${selectedSourceArtifactIds.length} fuente(s) seleccionada(s). Representación ${entry.template.representation} alineada con la familia solicitada; cobertura estimada de criterios ${coverage}/14.`;

    const tradeoffs = [
      entry.scoreBreakdown.representationMatch < 26
        ? `La representación ${entry.template.representation} no es la coincidencia perfecta con la familia ${contract.artifactFamily}.`
        : 'La representación coincide plenamente con la familia solicitada.',
      contextSelection.requiredSources.length === 0
        ? 'Sin fuentes obligatorias: la precisión depende del contexto textual y del ranking heurístico.'
        : `Se anclará a ${contextSelection.requiredSources.length} fuente(s) obligatoria(s) seleccionada(s).`,
      coverage < 7
        ? 'Algunos criterios de aceptación podrían requerir refuerzo manual tras la generación.'
        : 'La plantilla cubre la mayoría de los criterios de aceptación declarados.',
    ];

    const risks = [
      entry.scoreBreakdown.representationMatch < 0 ? 'La representación no coincide con la preferencia; revisar antes de generar.' : '',
      contextSelection.requiredSources.length === 0 ? 'No hay fuentes obligatorias; la precisión depende del contexto textual y ranking heurístico.' : '',
      contract.excludedSourceArtifactIds.length > 0 ? 'Existen fuentes excluidas; el prompt final debe mantenerlas fuera del contenido generado.' : '',
      contextSelection.resolvedSourceMappings.some(mapping => mapping.resolution === 'missing') ? 'Una o más fuentes solicitadas no existen; revisa la trazabilidad de mappings.' : '',
      contextSelection.resolvedSourceMappings.some(mapping => mapping.resolution === 'latest-version') ? 'Se usaron versiones más recientes de fuentes seleccionadas; verifica que la versión sea la deseada.' : '',
    ].filter(Boolean);

    const template: ArtifactTemplate = {
      ...entry.template,
      name: buildOnDemandName(entry.template.name, contract),
      objective: `${entry.template.objective} Solicitud estructurada: ${contract.normalizedIntent}`,
      requestContext: {
        userRequest: contract.originalRequest,
        matchedCatalogTemplateName: entry.template.name,
        audience: mapAudienceToRequestContext(contract.audience),
        rationale,
        constructionPlan,
        generationContract: contract,
        selectedSourceArtifactIds,
        excludedSourceArtifactIds: contract.excludedSourceArtifactIds,
        acceptanceCriteria: contract.acceptanceCriteria,
      },
    };

    return {
      id: `candidate-${index + 1}-${entry.template.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      template,
      matchedCatalogTemplateName: entry.template.name,
      confidence,
      scoreBreakdown: entry.scoreBreakdown,
      rationale,
      tradeoffs,
      constructionPlan,
      risks: risks.length > 0 ? risks : ['Sin riesgos críticos detectados para la recomendación.'],
      expectedOutput: `${entry.template.representation} ${entry.template.type} listo para revisión arquitectónica, con calidad objetivo ${contract.qualityTarget}/100.`,
    };
  });
};

export const candidateToLegacyRecommendation = (candidate: ArtifactRecommendationCandidate) => ({
  template: candidate.template,
  matchedCatalogTemplateName: candidate.matchedCatalogTemplateName,
  rationale: candidate.rationale,
  constructionPlan: candidate.constructionPlan,
  audience: candidate.template.requestContext?.audience ?? 'mixed',
  confidence: candidate.confidence,
});
