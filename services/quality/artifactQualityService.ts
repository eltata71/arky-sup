/**
 * Orchestrator that builds a unified ArtifactQualityReport for any artifact.
 *
 * Composes the document scorer (`documentQualityService`), the diagram bridge
 * (`diagramQualityBridge`) and the per-type profile (`qualityProfiles`).
 *
 * The report is deterministic and side-effect free — safe to call on every
 * render. Callers that want to cache should memoise on `artifact.content`,
 * `artifact.ir` and `artifact.type`.
 */

import type { Artifact } from '../../types';
import type { DiagramIR } from '../../lib/diagram';
import { classifyArtifact } from '../../lib/artifacts/artifactClassification';
import { analyzeDocumentQuality } from './documentQualityService';
import { analyzeDiagramQualityBridge } from './diagramQualityBridge';
import { resolveQualityProfile, dataDictionaryProfile } from './qualityProfiles';
import {
  tierFromScore,
  tierLabel,
  tierSummary,
  type ArtifactQualityDimension,
  type ArtifactQualityIssue,
  type ArtifactQualityProfile,
  type ArtifactQualityRecommendation,
  type ArtifactQualityReport,
  type ArtifactQualityScore,
} from './artifactQualityModel';

const generateId = (artifactId: string): string => {
  const stamp = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? Math.round(performance.now())
    : Date.now();
  return `aq_${artifactId.slice(0, 8)}_${stamp.toString(36)}`;
};

const isDocumentScope = (dimensionId: string): boolean => dimensionId.startsWith('doc.')
  || dimensionId.startsWith('matrix.')
  || dimensionId.startsWith('dict.');

const isDiagramScope = (dimensionId: string): boolean => dimensionId.startsWith('diag.');

const collectDimensions = (
  profile: ArtifactQualityProfile,
  scoresByDimension: Record<string, number>,
): ArtifactQualityDimension[] => {
  return profile.dimensions.map((spec) => ({
    id: spec.id,
    label: spec.label,
    scope: spec.scope,
    weight: spec.weight,
    score: scoresByDimension[spec.id] ?? 70,
  }));
};

const weightedAverage = (dimensions: readonly ArtifactQualityDimension[]): number => {
  const totalWeight = dimensions.reduce((acc, d) => acc + d.weight, 0);
  if (totalWeight <= 0) return 0;
  const weighted = dimensions.reduce((acc, d) => acc + d.score * d.weight, 0);
  return Math.round(weighted / totalWeight);
};

const penaltyForIssues = (issues: readonly ArtifactQualityIssue[]): number => {
  return issues.reduce((acc, issue) => {
    if (issue.severity === 'critical') return acc + 12;
    if (issue.severity === 'high') return acc + 5;
    if (issue.severity === 'medium') return acc + 2;
    if (issue.severity === 'low') return acc + 0.75;
    return acc;
  }, 0);
};

const buildRecommendations = (
  issues: readonly ArtifactQualityIssue[],
  dimensions: readonly ArtifactQualityDimension[],
): ArtifactQualityRecommendation[] => {
  const recs: ArtifactQualityRecommendation[] = [];
  const seen = new Set<string>();

  for (const issue of issues) {
    if (issue.severity === 'info' || issue.severity === 'low') continue;
    const key = `${issue.code}:${issue.dimensionId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recs.push({
      id: `rec.${issue.id}`,
      title: issue.message,
      detail: issue.recommendation,
      priority: issue.severity === 'critical' ? 'high' : issue.severity === 'high' ? 'high' : 'medium',
      actionId: issue.autoFixable ? `auto.${issue.code.toLowerCase()}` : undefined,
    });
    if (recs.length >= 6) break;
  }

  if (recs.length === 0) {
    const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
    if (weakest && weakest.score < 90) {
      recs.push({
        id: `rec.boost.${weakest.id}`,
        title: `Refuerza la dimensión "${weakest.label}"`,
        detail: `Es la dimensión con menor puntaje (${weakest.score}/100). Pequeñas mejoras aquí impactarán el score global.`,
        priority: 'medium',
      });
    }
  }

  return recs;
};

const findDiagram = (artifact: Artifact): DiagramIR | undefined => artifact.ir;

const isExpectingTraceability = (artifact: Artifact): boolean => artifact.type === 'sdd-traceability';
const isExpectingExecutiveTone = (artifact: Artifact): boolean => artifact.type === 'presentation-executive';
const isExpectingTables = (artifact: Artifact): boolean => {
  const classification = classifyArtifact(artifact);
  return classification.hasTables || classification.isDataDictionary || classification.primaryKind === 'matrix';
};

export const buildArtifactQualityReport = (artifact: Artifact): ArtifactQualityReport => {
  const classificationForProfile = classifyArtifact(artifact);
  const profile = classificationForProfile.isDataDictionary
    ? dataDictionaryProfile()
    : resolveQualityProfile(artifact.type);
  const diagram = findDiagram(artifact);

  const doc = analyzeDocumentQuality(artifact.content ?? '', {
    expectsTraceability: isExpectingTraceability(artifact),
    expectsExecutiveTone: isExpectingExecutiveTone(artifact),
    expectsTables: isExpectingTables(artifact),
  });

  const diag = diagram ? analyzeDiagramQualityBridge(diagram) : null;

  const dimensionScores: Record<string, number> = {};
  for (const id of Object.keys(doc.scores)) dimensionScores[id] = doc.scores[id];
  if (diag) for (const id of Object.keys(diag.scores)) dimensionScores[id] = diag.scores[id];

  // Aliases — some profiles share ids between scopes (e.g. matrix.* not provided by doc scorer):
  dimensionScores['matrix.headers'] = dimensionScores['matrix.headers']
    ?? (doc.tables.length > 0 ? 85 : 50);
  dimensionScores['matrix.completeness'] = dimensionScores['matrix.completeness']
    ?? Math.round(doc.tableCompleteness * 100);
  dimensionScores['matrix.coverage'] = dimensionScores['matrix.coverage']
    ?? dimensionScores['doc.traceability'] ?? 60;
  dimensionScores['dict.fields'] = dimensionScores['dict.fields']
    ?? (doc.tables.length > 0 ? Math.round(70 + doc.tableCompleteness * 25) : 40);
  dimensionScores['dict.types'] = dimensionScores['dict.types']
    ?? (doc.tables.length > 0 ? 75 : 40);
  dimensionScores['dict.sensitivity'] = dimensionScores['dict.sensitivity']
    ?? (artifact.content.toLowerCase().includes('pii') || artifact.content.toLowerCase().includes('phi') ? 85 : 55);

  const dimensions = collectDimensions(profile, dimensionScores);
  const allIssues: ArtifactQualityIssue[] = [...doc.issues, ...(diag?.issues ?? [])];
  const baseScore = weightedAverage(dimensions);
  const penalty = penaltyForIssues(allIssues);
  let rawScore = Math.max(0, Math.min(100, baseScore - penalty));

  // Hard caps for catastrophic failures.
  const hasCritical = allIssues.some((i) => i.severity === 'critical');
  if (hasCritical) rawScore = Math.min(rawScore, 40);
  if (!artifact.content.trim() && !diagram) rawScore = 0;

  const tier = tierFromScore(rawScore, profile.thresholds);
  const overallScope = diagram && artifact.content.trim() ? 'hybrid'
    : diagram ? 'diagram'
    : 'document';
  const score: ArtifactQualityScore = {
    value: rawScore,
    tier,
    summary: `${tierLabel(tier)} · ${tierSummary(tier, overallScope)}`,
  };

  const sortedIssues = [...allIssues].sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  const recommendations = buildRecommendations(sortedIssues, dimensions);

  return {
    id: generateId(artifact.id),
    artifactId: artifact.id,
    artifactType: artifact.type,
    profile,
    score,
    dimensions: [...dimensions].sort((a, b) => b.weight - a.weight),
    issues: sortedIssues,
    recommendations,
    diagram: diag ? {
      score: diag.report.score,
      summary: diag.report.summary,
      issueCount: diag.report.issues.length,
    } : undefined,
    document: artifact.content.trim() ? {
      score: weightedAverage(dimensions.filter((d) => isDocumentScope(d.id))),
      wordCount: doc.wordCount,
      hasStructure: doc.hasStructure,
    } : undefined,
    tables: doc.tables.length > 0 ? {
      count: doc.tables.length,
      completeness: doc.tableCompleteness,
    } : undefined,
    evaluatedAt: new Date().toISOString(),
  };
};

export const documentDimensions = (report: ArtifactQualityReport): ArtifactQualityDimension[] =>
  report.dimensions.filter((d) => isDocumentScope(d.id));

export const diagramDimensions = (report: ArtifactQualityReport): ArtifactQualityDimension[] =>
  report.dimensions.filter((d) => isDiagramScope(d.id));

export const exportDimensions = (report: ArtifactQualityReport): ArtifactQualityDimension[] =>
  report.dimensions.filter((d) => d.scope === 'export');
