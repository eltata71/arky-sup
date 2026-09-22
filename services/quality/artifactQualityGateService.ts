/**
 * Central artifact quality-gate service.
 *
 * Single source of truth for *export quality* decisions. It composes the
 * formal `ArtifactQualityReport` with per-family gates so the export
 * validation pipeline, the inspector and the export modal never re-derive
 * exportability on their own.
 *
 * The gates are report-pure: every decision is taken from the formal
 * `ArtifactQualityReport` (`buildArtifactQualityReport`), never from
 * `generationTrace` or ad-hoc IR inspection. Hard *technical* validation
 * (empty blob, MIME, OOXML/PDF headers) stays in `exportValidation.ts` and is
 * intentionally NOT duplicated here — quality and technical validation are
 * separate concerns that the pipeline composes.
 */

import type { Artifact } from '../../lib/artifacts';
import { buildArtifactQualityReport } from './artifactQualityService';
import type {
  ArtifactQualityGateResult,
  ArtifactQualityExportabilityState,
  ArtifactQualityIssue,
  ArtifactQualityReport,
  ArtifactQualityScope,
} from './artifactQualityModel';
import type {
  ArtifactValidationCheck,
  ArtifactView,
  ExportFormat,
  ValidationScope,
} from '../../lib/artifacts/exportContracts';

export type ExportFamily = 'document' | 'diagram' | 'table';

const DIAGRAM_FORMATS: readonly ExportFormat[] = ['png', 'svg', 'mermaid', 'diagram-json'];
const TABLE_FORMATS: readonly ExportFormat[] = ['csv', 'xlsx'];

/** Resolve the export family (document/diagram/table) for a format. */
export const exportFamilyForFormat = (format: ExportFormat): ExportFamily => {
  if ((DIAGRAM_FORMATS as readonly string[]).includes(format)) return 'diagram';
  if ((TABLE_FORMATS as readonly string[]).includes(format)) return 'table';
  return 'document';
};

const buildGate = (
  params: Partial<ArtifactQualityGateResult> & Pick<ArtifactQualityGateResult, 'gateId'>,
): ArtifactQualityGateResult => ({
  passed: true,
  risk: 'none',
  allowOverride: false,
  message: '',
  blockers: [],
  warnings: [],
  ...params,
});

const exportIssue = (
  partial: Omit<ArtifactQualityIssue, 'scope'> & { scope?: ArtifactQualityScope },
): ArtifactQualityIssue => ({ scope: 'export', ...partial });

/**
 * Collapse a gate's blockers + warnings into the final outcome. A gate only
 * fails on `critical` blockers (output would be empty/corrupt). Warnings keep
 * the gate open but raise the risk level the user takes on.
 */
const finalizeGate = (
  gateId: string,
  blockers: ArtifactQualityIssue[],
  warnings: ArtifactQualityIssue[],
  messages: { okClean: string; okWarn: string },
): ArtifactQualityGateResult => {
  const passed = blockers.length === 0;
  const risk: ArtifactQualityGateResult['risk'] = !passed
    ? 'critical'
    : warnings.some((w) => w.severity === 'high')
      ? 'high'
      : warnings.some((w) => w.severity === 'medium')
        ? 'medium'
        : warnings.length > 0
          ? 'low'
          : 'none';
  return buildGate({
    gateId,
    passed,
    risk,
    allowOverride: passed && warnings.length > 0,
    message: passed
      ? warnings.length > 0
        ? messages.okWarn
        : messages.okClean
      : (blockers[0]?.message ?? 'Exportación bloqueada por calidad.'),
    blockers,
    warnings,
  });
};

// ── Family gates (report-pure) ───────────────────────────────────────────────

/**
 * Document export gate (DOCX/PDF/HTML/Markdown/TXT/JSON). A document is never
 * blocked because a diagram is missing or broken — only because it has no
 * usable textual content.
 */
export const evaluateDocumentExportGate = (report: ArtifactQualityReport): ArtifactQualityGateResult => {
  const blockers: ArtifactQualityIssue[] = [];
  const warnings: ArtifactQualityIssue[] = [];

  if (!report.document) {
    blockers.push(exportIssue({
      id: 'gate.document.empty',
      code: 'EXPORT_DOCUMENT_EMPTY',
      severity: 'critical',
      scope: 'document',
      message: 'No existe contenido exportable: el documento está vacío.',
      recommendation: 'Genera contenido textual antes de exportar a DOCX/PDF/HTML/Markdown.',
    }));
  } else {
    const tooShort = report.issues.find((i) => i.code === 'DOC_TOO_SHORT');
    if (tooShort) warnings.push(tooShort);
    if (report.document.score < report.profile.thresholds.exportFloor) {
      warnings.push(exportIssue({
        id: 'gate.document.low-score',
        code: 'EXPORT_DOCUMENT_LOW_SCORE',
        severity: 'medium',
        scope: 'document',
        message: `Calidad documental ${report.document.score}/100 bajo el umbral mínimo (${report.profile.thresholds.exportFloor}).`,
        recommendation: 'Ejecuta auto-reparación o completa las secciones faltantes antes de exportar.',
      }));
    }
  }

  return finalizeGate('export:document', blockers, warnings, {
    okClean: 'Exportación documental lista.',
    okWarn: 'Exportación documental permitida con advertencias.',
  });
};

/**
 * Diagram export gate (PNG/SVG/Mermaid/diagram-json). Blocks when the diagram
 * has no exportable structure (no IR, no nodes, invalid references or a
 * skeleton fallback) so PNG/SVG never produce an empty image.
 */
export const evaluateDiagramExportGate = (report: ArtifactQualityReport): ArtifactQualityGateResult => {
  const blockers: ArtifactQualityIssue[] = [];
  const warnings: ArtifactQualityIssue[] = [];
  const hasEmptyIr = report.issues.some((i) => i.code === 'EMPTY_IR');

  if (!report.diagram || hasEmptyIr) {
    blockers.push(exportIssue({
      id: 'gate.diagram.missing',
      code: 'EXPORT_DIAGRAM_MISSING',
      severity: 'critical',
      scope: 'diagram',
      message: 'No hay un diagrama exportable (sin nodos).',
      recommendation: 'Genera el diagrama o elige un formato documental.',
    }));
    return finalizeGate('export:diagram', blockers, warnings, {
      okClean: 'Exportación diagramática lista.',
      okWarn: 'Exportación diagramática permitida con advertencias.',
    });
  }

  const diagramIssues = report.issues.filter((i) => i.scope === 'diagram' || i.id.startsWith('diag.'));
  for (const di of diagramIssues) {
    const blocking = di.severity === 'critical'
      || di.code === 'EDGE_INVALID_REFERENCE'
      || di.code === 'SKELETON_FALLBACK';
    if (blocking) {
      if (!blockers.some((b) => b.code === di.code)) blockers.push(di);
    } else if (di.severity === 'high') {
      warnings.push(di);
    }
  }

  if (report.diagram.score < report.profile.thresholds.exportFloor) {
    warnings.push(exportIssue({
      id: 'gate.diagram.low-score',
      code: 'EXPORT_DIAGRAM_LOW_SCORE',
      severity: 'medium',
      scope: 'diagram',
      message: `Calidad diagramática ${report.diagram.score}/100 bajo el umbral mínimo (${report.profile.thresholds.exportFloor}).`,
      recommendation: 'Pulsa "Auto-mejorar" o regenera el diagrama con más contexto.',
    }));
  }

  return finalizeGate('export:diagram', blockers, warnings, {
    okClean: 'Exportación diagramática lista.',
    okWarn: 'Exportación diagramática permitida con advertencias.',
  });
};

/**
 * Table export gate (CSV/XLSX). Blocks when there is no tabular structure or
 * when the detected tables are so empty the export would be meaningless.
 */
export const evaluateTableExportGate = (report: ArtifactQualityReport): ArtifactQualityGateResult => {
  const blockers: ArtifactQualityIssue[] = [];
  const warnings: ArtifactQualityIssue[] = [];

  if (!report.tables || report.tables.count === 0) {
    blockers.push(exportIssue({
      id: 'gate.table.missing',
      code: 'EXPORT_TABLE_MISSING',
      severity: 'critical',
      scope: 'table',
      message: 'El formato tabular requiere una tabla Markdown exportable; no se detectó ninguna.',
      recommendation: 'Inserta una tabla con encabezados y filas, o exporta DOCX/PDF/HTML.',
    }));
    return finalizeGate('export:table', blockers, warnings, {
      okClean: 'Exportación tabular lista.',
      okWarn: 'Exportación tabular permitida con advertencias.',
    });
  }

  const completeness = report.tables.completeness;
  if (completeness < 0.4) {
    blockers.push(exportIssue({
      id: 'gate.table.too-empty',
      code: 'EXPORT_TABLE_TOO_EMPTY',
      severity: 'critical',
      scope: 'table',
      message: 'Las tablas detectadas están casi vacías.',
      recommendation: 'Completa al menos el 40% de las celdas antes de exportar a CSV/XLSX.',
    }));
  } else if (completeness < 0.7) {
    warnings.push(exportIssue({
      id: 'gate.table.partial',
      code: 'EXPORT_TABLE_PARTIAL',
      severity: 'medium',
      scope: 'table',
      message: 'Las tablas tienen celdas vacías.',
      recommendation: 'Completa o marca como N/A las celdas vacías para evitar exportaciones ambiguas.',
    }));
  }

  return finalizeGate('export:table', blockers, warnings, {
    okClean: 'Exportación tabular lista.',
    okWarn: 'Exportación tabular permitida con advertencias.',
  });
};

// ── Public surface ───────────────────────────────────────────────────────────

export interface ArtifactQualityGateContext {
  /** Pre-built report — passing it avoids recomputation on hot paths. */
  report?: ArtifactQualityReport;
  /** Active workspace view (kept for messaging / future refinements). */
  activeView?: ArtifactView;
}

export interface ArtifactExportabilitySnapshot {
  /** The formal quality report — the source of truth for every gate. */
  report: ArtifactQualityReport;
  /** Per-family export gate outcomes. */
  state: ArtifactQualityExportabilityState;
}

/**
 * Build the unified exportability snapshot for an artifact: the formal quality
 * report plus the per-family (document/diagram/table) export gates.
 */
export const buildArtifactExportabilityState = (
  artifact: Artifact,
  context: ArtifactQualityGateContext = {},
): ArtifactExportabilitySnapshot => {
  const report = context.report ?? buildArtifactQualityReport(artifact);
  const state: ArtifactQualityExportabilityState = {
    document: evaluateDocumentExportGate(report),
    diagram: evaluateDiagramExportGate(report),
    table: evaluateTableExportGate(report),
  };
  return { report, state };
};

/**
 * Evaluate the quality gate for a single export format. Report-pure: the
 * `ArtifactQualityReport` is the only input that drives the decision.
 */
export const evaluateExportQualityGate = (
  report: ArtifactQualityReport,
  format: ExportFormat,
  _activeView?: ArtifactView,
): ArtifactQualityGateResult => {
  const family = exportFamilyForFormat(format);
  const gate = family === 'diagram'
    ? evaluateDiagramExportGate(report)
    : family === 'table'
      ? evaluateTableExportGate(report)
      : evaluateDocumentExportGate(report);
  return { ...gate, gateId: `export:${format}` };
};

export interface QualityGateDecision {
  gate: ArtifactQualityGateResult;
  /** Whether the export may proceed (clean or warning path). */
  allowed: boolean;
  /** Whether proceeding needs explicit user consent (warnings present). */
  requiresOverride: boolean;
  /** The snapshot used to take the decision (report + per-family state). */
  snapshot: ArtifactExportabilitySnapshot;
}

/**
 * High-level decision helper: builds the snapshot, evaluates the format gate
 * and reports whether the export can proceed and whether it needs an override.
 */
export const canExportWithQualityGate = (
  artifact: Artifact,
  format: ExportFormat,
  activeView?: ArtifactView,
  context: ArtifactQualityGateContext = {},
): QualityGateDecision => {
  const snapshot = buildArtifactExportabilityState(artifact, { ...context, activeView });
  const gate = evaluateExportQualityGate(snapshot.report, format, activeView);
  return {
    gate,
    allowed: gate.passed,
    requiresOverride: gate.passed && gate.warnings.length > 0,
    snapshot,
  };
};

/** Build a single user-facing message that summarises a gate outcome. */
export const buildQualityGateMessage = (gate: ArtifactQualityGateResult): string => {
  if (!gate.passed) {
    const blocker = gate.blockers[0];
    return blocker
      ? `${gate.message} ${blocker.recommendation}`.trim()
      : gate.message;
  }
  if (gate.warnings.length > 0) {
    const top = gate.warnings[0];
    return `${gate.message} ${top.message}`.trim();
  }
  return gate.message;
};

const toValidationScope = (scope: ArtifactQualityScope): ValidationScope => {
  switch (scope) {
    case 'document': return 'document';
    case 'diagram': return 'diagram';
    case 'table':
    case 'matrix':
    case 'traceability':
      return 'table';
    case 'hybrid':
    case 'export':
    default:
      return 'export';
  }
};

/**
 * Project a quality report + gate outcome onto the export modal's
 * `ArtifactValidationCheck[]` shape so the technical and quality validations
 * render in one consistent list.
 */
export const mapQualityIssuesToExportChecks = (
  report: ArtifactQualityReport,
  gate: ArtifactQualityGateResult,
): ArtifactValidationCheck[] => {
  const checks: ArtifactValidationCheck[] = [];

  for (const blocker of gate.blockers) {
    checks.push({
      id: `quality-${blocker.id}`,
      scope: toValidationScope(blocker.scope),
      status: 'fail',
      label: 'Calidad',
      detail: blocker.message,
      suggestedAction: blocker.recommendation,
    });
  }
  for (const warning of gate.warnings) {
    checks.push({
      id: `quality-${warning.id}`,
      scope: toValidationScope(warning.scope),
      status: 'warn',
      label: 'Calidad',
      detail: warning.message,
      suggestedAction: warning.recommendation,
    });
  }
  if (checks.length === 0) {
    checks.push({
      id: 'quality-gate-clean',
      scope: 'export',
      status: 'pass',
      label: 'Calidad',
      detail: `Score formal ${report.score.value}/100 — ${gate.message}`,
    });
  }
  return checks;
};
