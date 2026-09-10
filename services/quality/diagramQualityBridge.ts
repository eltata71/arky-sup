/**
 * Bridge between the existing 10-dimension diagram quality service and the
 * unified ArtifactQuality model.
 *
 * We don't re-implement the diagram scoring — we map its breakdown onto the
 * canonical dimension ids used by `qualityProfiles.ts` so the UI panel can
 * show diagram + document dimensions side by side.
 */

import type { DiagramIR } from '../../lib/diagram';
import {
  analyzeDiagramQuality,
  type DiagramQualityReport,
  type DiagramScoreBreakdown,
} from '../diagram/quality/diagramQualityService';
import type { ArtifactQualityIssue, ArtifactQualityScope } from './artifactQualityModel';

export interface DiagramQualitySnapshot {
  scores: Record<string, number>;
  issues: ArtifactQualityIssue[];
  report: DiagramQualityReport;
}

const clamp = (n: number, min = 0, max = 100): number => Math.max(min, Math.min(max, n));

const scopeFor = (id: string): ArtifactQualityScope => {
  if (id.startsWith('diag.exportability')) return 'export';
  return 'diagram';
};

const mapBreakdownToDimensions = (
  ir: DiagramIR,
  breakdown: DiagramScoreBreakdown,
): Record<string, number> => {
  const nodes = ir.nodes.length;
  const edges = ir.edges.length;
  const connected = new Set<string>();
  ir.edges.forEach((edge) => { connected.add(edge.source); connected.add(edge.target); });
  const connectedRatio = nodes === 0 ? 0 : ir.nodes.filter((n) => connected.has(n.id)).length / nodes;

  const orphanRatio = nodes <= 1 ? 1 : connectedRatio;
  const orphanScore = clamp(Math.round(orphanRatio * 100));

  const labelledNodeRatio = nodes === 0 ? 0
    : ir.nodes.filter((n) => (n.label ?? '').trim().length > 0).length / nodes;
  const labelledEdgeRatio = edges === 0 ? 1
    : ir.edges.filter((e) => (e.label ?? '').trim().length > 0).length / edges;

  const validReferences = ir.edges.every((e) => ir.nodes.some((n) => n.id === e.source) && ir.nodes.some((n) => n.id === e.target));

  return {
    'diag.nodes': clamp(nodes === 0 ? 0 : nodes < 2 ? 30 : Math.min(95, 55 + nodes * 4)),
    'diag.edges': clamp(edges === 0 ? (nodes <= 1 ? 70 : 25) : Math.min(95, 55 + edges * 5)),
    'diag.orphans': orphanScore,
    'diag.connectivity': clamp(Math.round(connectedRatio * 100)),
    'diag.labels': clamp(Math.round(labelledNodeRatio * 100)),
    'diag.edgeLabels': clamp(Math.round(labelledEdgeRatio * 100)),
    'diag.grouping': breakdown.jerarquiaVisual,
    'diag.layout': breakdown.atractivoVisual,
    'diag.density': clamp(Math.round((breakdown.jerarquiaVisual + breakdown.exportabilidad) / 2)),
    'diag.syntax': validReferences ? 95 : 40,
    'diag.reactflowCompat': validReferences && nodes > 0 ? 92 : 50,
    'diag.exportability': breakdown.exportabilidad,
    'diag.executive': breakdown.preparacionEjecutiva,
    'diag.technical': breakdown.preparacionTecnica,
    'diag.maintenance': breakdown.mantenibilidadPipeline,
  };
};

const mapDiagramIssues = (report: DiagramQualityReport): ArtifactQualityIssue[] => {
  return report.issues.map((issue) => ({
    id: `diag.${issue.id}`,
    code: issue.code,
    severity: issue.severity,
    scope: scopeFor(issue.code) === 'export' ? 'export' : 'diagram',
    message: issue.message,
    recommendation: issue.recommendation,
    dimensionId: dimensionForIssueCode(issue.code),
    autoFixable: isCodeAutoFixable(issue.code),
  }));
};

const dimensionForIssueCode = (code: string): string | undefined => {
  switch (code) {
    case 'EMPTY_IR': return 'diag.nodes';
    case 'EDGE_INVALID_REFERENCE': return 'diag.syntax';
    case 'EDGE_MISSING_LABEL': return 'diag.edgeLabels';
    case 'EDGE_LABEL_TOO_LONG': return 'diag.edgeLabels';
    case 'NODE_MISSING_LABEL': return 'diag.labels';
    case 'NODE_MISSING_DESCRIPTION': return 'diag.labels';
    case 'NODE_LABEL_EQ_ID': return 'diag.labels';
    case 'NODE_LABEL_TOO_LONG': return 'diag.labels';
    case 'ORPHAN_NODE': return 'diag.orphans';
    case 'SKELETON_FALLBACK': return 'diag.maintenance';
    default: return undefined;
  }
};

const isCodeAutoFixable = (code: string): boolean => {
  switch (code) {
    case 'EDGE_MISSING_LABEL':
    case 'NODE_MISSING_LABEL':
    case 'NODE_LABEL_EQ_ID':
    case 'ORPHAN_NODE':
      return true;
    default:
      return false;
  }
};

export const analyzeDiagramQualityBridge = (ir: DiagramIR): DiagramQualitySnapshot => {
  const report = analyzeDiagramQuality(ir);
  const scores = mapBreakdownToDimensions(ir, report.breakdown);
  const issues = mapDiagramIssues(report);
  return { scores, issues, report };
};
