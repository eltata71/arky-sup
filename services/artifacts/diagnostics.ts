/**
 * Diagnostic report builder for ArtifactCanvas observability surfaces.
 *
 * Extracted from `components/ArtifactCanvas.tsx` so:
 *  - the `Copy technical report` button can be implemented without React;
 *  - tests can verify report content shape;
 *  - Phase 3 (AI/context) can extend the report with model+context metadata
 *    without touching UI code.
 */
import type { Artifact } from '../../lib/artifacts';
import type { RenderableDiagramResolution } from '../diagram/resolveRenderableDiagram';
import { extractMermaid } from '../../utils/diagram/extractMermaid';

export interface BuildDiagnosticReportInput {
  projectId: string;
  projectName: string;
  artifact: Artifact;
  audience: string;
  renderable: RenderableDiagramResolution;
}

export const buildArtifactDiagnosticReport = ({
  projectId,
  projectName,
  artifact,
  audience,
  renderable,
}: BuildDiagnosticReportInput): string | null => {
  const trace = artifact.generationTrace;
  if (!trace && renderable.diagnostics.length === 0 && renderable.warnings.length === 0 && !artifact.lastDiagramError) {
    return null;
  }
  const extraction = extractMermaid(artifact.content, artifact.representation);
  const mermaidDiagnostic = 'code' in extraction
    ? `mermaid.length=${extraction.code.length}`
    : `mermaid.reason=${extraction.reason}`;
  const fallbackLocal = trace?.status === 'fallback'
    || artifact.lastDiagramError?.reason === 'skeleton-fallback'
    || renderable.ir?.metadata?.fallback === 'skeleton';
  const lines: string[] = [
    `reportGeneratedAt=${new Date().toISOString()}`,
    `projectId=${projectId}`,
    `projectName=${projectName}`,
    `artifactId=${artifact.id}`,
    `artifactName=${artifact.name}`,
    `artifactType=${artifact.type}`,
    `representation=${artifact.representation}`,
    `artifact.audienceField=${artifact.audience ?? 'none'}`,
    `currentAudience=${audience}`,
    `source=${renderable.source}`,
    `status=${renderable.status}`,
    `baseNodes=${renderable.counters.baseNodes}`,
    `projectedNodes=${renderable.counters.projectedNodes}`,
    `renderNodes=${renderable.counters.renderNodes}`,
    `validEdges=${renderable.counters.validEdges}`,
    `contentLength=${artifact.content.length}`,
    `mermaid.extracted=${extraction.ok}`,
    mermaidDiagnostic,
    `qualityGate.reachedTarget=${renderable.qualityGateReachedTarget}`,
    `qualityGate.changes=${renderable.qualityGateChanges.length}`,
    `qualityGate.score=${renderable.quality?.score ?? 'n/a'}`,
    `fallbackLocal=${fallbackLocal}`,
  ];

  if (artifact.lastDiagramError) {
    lines.push(`lastDiagramError.reason=${artifact.lastDiagramError.reason}`);
    lines.push(`lastDiagramError.attempt=${artifact.lastDiagramError.attempt}`);
    lines.push(`lastDiagramError.at=${artifact.lastDiagramError.at}`);
    if (artifact.lastDiagramError.message) lines.push(`lastDiagramError.message=${artifact.lastDiagramError.message}`);
    if (artifact.lastDiagramError.sample) lines.push(`lastDiagramError.sample=${artifact.lastDiagramError.sample.slice(0, 500)}`);
  }

  if (trace) {
    lines.push(`operationId=${trace.operationId ?? trace.id}`);
    lines.push(`trace.id=${trace.id}`);
    lines.push(`trace.source=${trace.source}`);
    lines.push(`trace.status=${trace.status}`);
    lines.push(`trace.startedAt=${trace.startedAt}`);
    if (trace.completedAt) lines.push(`trace.completedAt=${trace.completedAt}`);
    if (typeof trace.durationMs === 'number') lines.push(`trace.durationMs=${trace.durationMs}`);
    if (trace.model) lines.push(`trace.model=${trace.model}`);
    if (trace.modelEffective) {
      lines.push(`trace.modelEffective.id=${trace.modelEffective.id}`);
      lines.push(`trace.modelEffective.source=${trace.modelEffective.source}`);
      lines.push(`trace.modelEffective.tier=${trace.modelEffective.tier}`);
      if (trace.modelEffective.requested) lines.push(`trace.modelEffective.requested=${trace.modelEffective.requested}`);
    }
    if (trace.lifecycle) lines.push(`trace.lifecycle=${trace.lifecycle.join('>')}`);
    if (trace.persistence) lines.push(`trace.persistence=${JSON.stringify(trace.persistence)}`);
    if (trace.matchedCatalogTemplateName) lines.push(`trace.matchedCatalogTemplateName=${trace.matchedCatalogTemplateName}`);
    if (trace.request?.userRequest) lines.push(`trace.request=${trace.request.userRequest}`);
    if (trace.request?.audience) lines.push(`trace.request.audience=${trace.request.audience}`);
    if (trace.request?.matchedCatalogTemplateName) lines.push(`trace.request.matchedCatalogTemplateName=${trace.request.matchedCatalogTemplateName}`);
    if (trace.quality?.score !== undefined) lines.push(`trace.quality.score=${trace.quality.score}`);
    if (trace.quality?.reachedTarget !== undefined) lines.push(`trace.quality.reachedTarget=${trace.quality.reachedTarget}`);
    if (trace.contentLength !== undefined) lines.push(`trace.contentLength=${trace.contentLength}`);
    if (trace.irCounters) lines.push(`trace.irCounters=${JSON.stringify(trace.irCounters)}`);
    if (trace.renderCounters) lines.push(`trace.renderCounters=${JSON.stringify(trace.renderCounters)}`);
    trace.warnings?.forEach((warning, index) => lines.push(`trace.warning[${index}]=${warning}`));
    trace.decisions.forEach((step, index) => {
      lines.push(`trace.decision[${index}].stage=${step.stage}`);
      lines.push(`trace.decision[${index}].status=${step.status}`);
      lines.push(`trace.decision[${index}].message=${step.message}`);
      if (step.detail) lines.push(`trace.decision[${index}].detail=${step.detail}`);
    });
    trace.errors.forEach((step, index) => {
      lines.push(`trace.error[${index}].stage=${step.stage}`);
      lines.push(`trace.error[${index}].status=${step.status}`);
      lines.push(`trace.error[${index}].message=${step.message}`);
      if (step.detail) lines.push(`trace.error[${index}].detail=${step.detail}`);
    });
  }

  renderable.diagnostics.forEach((diag, index) => {
    lines.push(`diag[${index}].stage=${diag.stage}`);
    lines.push(`diag[${index}].message=${diag.message}`);
    if (diag.detail) lines.push(`diag[${index}].detail=${diag.detail}`);
  });
  renderable.warnings.forEach((warning, index) => {
    lines.push(`warning[${index}]=${warning}`);
  });
  renderable.repairActions.forEach((action, index) => {
    lines.push(`repairAction[${index}]=${action}`);
  });

  // Gap 5 — surface the last-known layout plan + visual metrics so the
  // copy-diagnostic button is enough for an architect to understand why a
  // diagram fell short of "world class" without opening the inspector.
  const layoutPlan = artifact.ir?.metadata?.layoutPlan ?? renderable.ir?.metadata?.layoutPlan;
  if (layoutPlan) {
    lines.push(`layoutPlan.backend=${layoutPlan.backend}`);
    if (layoutPlan.algorithm) lines.push(`layoutPlan.algorithm=${layoutPlan.algorithm}`);
    if (layoutPlan.direction) lines.push(`layoutPlan.direction=${layoutPlan.direction}`);
    if (layoutPlan.density) lines.push(`layoutPlan.density=${layoutPlan.density}`);
    lines.push(`layoutPlan.orthogonal=${layoutPlan.orthogonal ?? false}`);
    lines.push(`layoutPlan.userOverride=${layoutPlan.userOverride ?? false}`);
    if (layoutPlan.computedAt) lines.push(`layoutPlan.computedAt=${layoutPlan.computedAt}`);
    if (layoutPlan.rationale) lines.push(`layoutPlan.rationale=${layoutPlan.rationale}`);
  }
  const metrics = renderable.quality?.layoutMetrics;
  if (metrics?.hasLayout) {
    lines.push(`layoutMetrics.nodeCount=${metrics.nodeCount}`);
    lines.push(`layoutMetrics.aspectRatio=${metrics.aspectRatio.toFixed(2)}`);
    lines.push(`layoutMetrics.density=${(metrics.density * 100).toFixed(0)}%`);
    lines.push(`layoutMetrics.overlap=${metrics.overlappingNodePairs.length}`);
    lines.push(`layoutMetrics.groupOverlap=${metrics.overlappingGroupPairs.length}`);
    lines.push(`layoutMetrics.boundaryBreaches=${metrics.boundaryContainmentBreaches.length}`);
    lines.push(`layoutMetrics.edgeCrossings=${metrics.edgeCrossings}`);
    lines.push(`layoutMetrics.labelCollisions=${metrics.edgeLabelCollisions.length}`);
    lines.push(`layoutMetrics.offscreenNodes=${metrics.nodesOutsideViewport.length}`);
    lines.push(`layoutMetrics.obscuredByPanels=${metrics.nodesObscuredByObstacles.length}`);
    lines.push(`layoutMetrics.exportCropRisk=${metrics.exportCropRisk}`);
    lines.push(`layoutMetrics.exportClipRisk=${metrics.exportClipRisk}`);
    lines.push(`layoutMetrics.excessiveEmptySpace=${metrics.excessiveEmptySpace}`);
  }
  return lines.join('\n');
};

export interface RenderDiagnosticsSummaryInput {
  renderable: RenderableDiagramResolution;
}

export const buildRenderDiagnosticsSummary = ({ renderable }: RenderDiagnosticsSummaryInput): string | null => {
  const topDiag = renderable.diagnostics[0];
  if (!topDiag) return null;
  return `Etapa ${topDiag.stage}: ${topDiag.message}${topDiag.detail ? ` (${topDiag.detail})` : ''}`;
};
