/**
 * Contextual quality gates for exports.
 *
 * Different formats demand different things from the artifact:
 *  - Document exports (DOCX/PDF/HTML/MD/TXT/JSON) need real text content.
 *  - Diagram exports (PNG/SVG/Mermaid/diagram-json) need a valid IR.
 *  - Tabular exports (CSV/XLSX) need at least one Markdown table.
 *
 * A document export should not be blocked because the diagram is missing,
 * and vice versa.
 *
 * The per-family decision logic now lives in `artifactQualityGateService.ts`
 * (report-pure, the single source of truth). This module keeps the original
 * `evaluateArtifactQualityGates` / `gateForFormat` surface so existing callers
 * stay stable — it simply composes the canonical gate service.
 */

import type { Artifact } from '../../types';
import {
  evaluateDocumentExportGate,
  evaluateDiagramExportGate,
  evaluateTableExportGate,
} from './artifactQualityGateService';
import type {
  ArtifactQualityGateResult,
  ArtifactQualityReport,
  ArtifactQualityExportabilityState,
  DocumentExportFormat,
  DiagramExportFormat,
  TableExportFormat,
} from './artifactQualityModel';

const DOCUMENT_FORMATS: readonly DocumentExportFormat[] = ['pdf', 'docx', 'html', 'md', 'txt', 'json'];
const DIAGRAM_FORMATS: readonly DiagramExportFormat[] = ['png', 'svg', 'mermaid', 'diagram-json'];
const TABLE_FORMATS: readonly TableExportFormat[] = ['csv', 'xlsx'];

/**
 * Build the per-family export gate snapshot. The result allows the UI to
 * enable/disable each format group independently without conflating signals.
 *
 * `artifact` is kept in the signature for backward compatibility; the decision
 * is fully driven by the formal `ArtifactQualityReport`.
 */
export const evaluateArtifactQualityGates = (
  _artifact: Artifact,
  report: ArtifactQualityReport,
): ArtifactQualityExportabilityState => ({
  document: evaluateDocumentExportGate(report),
  diagram: evaluateDiagramExportGate(report),
  table: evaluateTableExportGate(report),
});

export const gateForFormat = (
  format: string,
  state: ArtifactQualityExportabilityState,
): ArtifactQualityGateResult => {
  if ((DOCUMENT_FORMATS as readonly string[]).includes(format)) return state.document;
  if ((DIAGRAM_FORMATS as readonly string[]).includes(format)) return state.diagram;
  if ((TABLE_FORMATS as readonly string[]).includes(format)) return state.table;
  // Unknown format — be permissive but flag.
  return {
    gateId: `export:${format}`,
    passed: true,
    risk: 'low',
    allowOverride: true,
    message: 'Formato sin gate dedicado; se exporta con validación genérica.',
    blockers: [],
    warnings: [],
  };
};
