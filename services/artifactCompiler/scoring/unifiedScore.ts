/**
 * Unified compilation score (Task 6).
 *
 * Consolidates the existing quality signals into a single, transparent score:
 *  - document scoring  → `documentQualityService` (via `buildArtifactQualityReport`)
 *  - diagram scoring   → `diagramQualityService` / quality gate (same report)
 *  - contract compliance → this module, from the contract validation findings
 *
 * No quality logic is re-implemented; this module only re-projects existing
 * dimension scores onto the 10 canonical compilation axes and applies the
 * fixed world-class tier ladder.
 */

import type { Artifact } from '../../../types';
import { buildArtifactQualityReport } from '../../quality/artifactQualityService';
import type {
  ArtifactQualityIssue,
  ArtifactQualityReport,
} from '../../quality/artifactQualityModel';
import type {
  CompilationTier,
  CompilerDimensionScore,
  CompilerIssue,
  CompilerIssueSource,
} from '../ArtifactCompilerTypes';
import type { ContractValidationResult } from '../validators';

export interface UnifiedScoreResult {
  qualityReport: ArtifactQualityReport;
  /** Quality-report findings projected onto the compiler issue shape. */
  qualityIssues: CompilerIssue[];
  dimensions: CompilerDimensionScore[];
  /** Unified score in [0, 100]. */
  value: number;
  tier: CompilationTier;
  /** Contract-compliance sub-score in [0, 100]. */
  contractCompliance: number;
}

const clamp = (n: number, min = 0, max = 100): number => Math.max(min, Math.min(max, Math.round(n)));

interface DimensionSpec {
  id: string;
  label: string;
  weight: number;
  /** Candidate quality-report dimension ids contributing to this axis. */
  sources: string[];
}

const DIMENSION_SPECS: DimensionSpec[] = [
  { id: 'estructura', label: 'Estructura', weight: 12, sources: ['doc.headings', 'diag.grouping', 'diag.layout'] },
  {
    id: 'completitud',
    label: 'Completitud',
    weight: 16,
    sources: [
      'doc.objective', 'doc.scope', 'doc.context', 'doc.assumptions', 'doc.acceptance',
      'doc.tables', 'matrix.completeness', 'dict.fields', 'diag.nodes', 'diag.edges', 'diag.connectivity',
    ],
  },
  { id: 'claridad', label: 'Claridad', weight: 10, sources: ['doc.readability', 'diag.labels', 'diag.edgeLabels'] },
  { id: 'trazabilidad', label: 'Trazabilidad', weight: 8, sources: ['doc.traceability', 'matrix.coverage'] },
  { id: 'consistencia', label: 'Consistencia', weight: 8, sources: ['doc.terminology', 'diag.syntax'] },
  { id: 'calidad-ejecutiva', label: 'Calidad ejecutiva', weight: 9, sources: ['doc.executive', 'diag.executive'] },
  { id: 'calidad-tecnica', label: 'Calidad técnica', weight: 9, sources: ['doc.technical', 'diag.technical', 'diag.maintenance'] },
  { id: 'exportabilidad', label: 'Exportabilidad', weight: 10, sources: ['doc.exportability', 'diag.exportability'] },
  { id: 'errores-criticos', label: 'Ausencia de errores críticos', weight: 8, sources: [] },
  { id: 'cumplimiento-contrato', label: 'Cumplimiento del contrato', weight: 10, sources: [] },
];

const QUALITY_SCOPE_TO_SOURCE: Record<ArtifactQualityIssue['scope'], CompilerIssueSource> = {
  document: 'document',
  diagram: 'diagram',
  table: 'document',
  matrix: 'document',
  traceability: 'document',
  hybrid: 'document',
  export: 'export',
};

const mapQualityIssue = (issue: ArtifactQualityIssue): CompilerIssue => ({
  id: `quality.${issue.id}`,
  code: issue.code,
  severity: issue.severity,
  source: QUALITY_SCOPE_TO_SOURCE[issue.scope] ?? 'document',
  message: issue.message,
  recommendation: issue.recommendation,
  dimension: issue.dimensionId,
  autoFixable: issue.autoFixable,
});

/** Contract-compliance sub-score: 100 minus penalties for contract findings. */
const computeContractCompliance = (validation: ContractValidationResult): number => {
  let score = 100;
  for (const issue of validation.issues) {
    if (issue.source !== 'contract' && issue.source !== 'structure') continue;
    if (issue.severity === 'critical') return 0;
    if (issue.severity === 'high') score -= 16;
    else if (issue.severity === 'medium') score -= 7;
    else if (issue.severity === 'low') score -= 2;
  }
  return clamp(score);
};

const tierFromScore = (value: number, hasCritical: boolean): CompilationTier => {
  if (hasCritical || value < 50) return 'blocked';
  if (value >= 90) return 'world-class';
  if (value >= 80) return 'ready';
  if (value >= 70) return 'usable-with-warnings';
  return 'needs-improvement';
};

/**
 * Compute the unified score for an artifact. Pure and deterministic; the
 * caller passes the contract validation result so contract compliance can be
 * folded in without re-running validation.
 */
export const computeUnifiedScore = (
  artifact: Artifact,
  contractValidation: ContractValidationResult,
): UnifiedScoreResult => {
  const qualityReport = buildArtifactQualityReport(artifact);
  const qualityIssues = qualityReport.issues.map(mapQualityIssue);

  const dimensionScoreById = new Map<string, number>();
  for (const dimension of qualityReport.dimensions) {
    dimensionScoreById.set(dimension.id, dimension.score);
  }

  const allIssues = [...qualityIssues, ...contractValidation.issues];
  const criticalCount = allIssues.filter((i) => i.severity === 'critical').length;
  const highCount = allIssues.filter((i) => i.severity === 'high').length;
  const contractCompliance = computeContractCompliance(contractValidation);

  const criticalAxisScore = clamp(100 - criticalCount * 45 - highCount * 8);

  const dimensions: CompilerDimensionScore[] = DIMENSION_SPECS.map((spec) => {
    let score: number;
    if (spec.id === 'errores-criticos') {
      score = criticalAxisScore;
    } else if (spec.id === 'cumplimiento-contrato') {
      score = contractCompliance;
    } else {
      const present = spec.sources
        .map((id) => dimensionScoreById.get(id))
        .filter((value): value is number => typeof value === 'number');
      score = present.length > 0
        ? present.reduce((a, b) => a + b, 0) / present.length
        : qualityReport.score.value;
    }
    return { id: spec.id, label: spec.label, score: clamp(score), weight: spec.weight };
  });

  const totalWeight = dimensions.reduce((acc, d) => acc + d.weight, 0);
  const weighted = dimensions.reduce((acc, d) => acc + d.score * d.weight, 0);
  let value = totalWeight > 0 ? Math.round(weighted / totalWeight) : 0;

  const hasCritical = criticalCount > 0;
  if (hasCritical) value = Math.min(value, 40);
  const emptyArtifact = !(artifact.content ?? '').trim() && !(artifact.ir?.nodes?.length);
  if (emptyArtifact) value = 0;
  value = clamp(value);

  return {
    qualityReport,
    qualityIssues,
    dimensions,
    value,
    tier: tierFromScore(value, hasCritical),
    contractCompliance,
  };
};

/** User-facing one-liner describing a tier. */
export const tierSummary = (tier: CompilationTier): string => {
  switch (tier) {
    case 'world-class':
      return 'Clase mundial: listo para comité ejecutivo y exportación.';
    case 'ready':
      return 'Listo: sólido para compartir con stakeholders.';
    case 'usable-with-warnings':
      return 'Usable con advertencias: revisa los hallazgos antes de presentar.';
    case 'needs-improvement':
      return 'Requiere mejoras: completa las secciones débiles antes de exportar.';
    case 'blocked':
      return 'Bloqueado: corrige los errores críticos antes de persistir o exportar.';
  }
};
