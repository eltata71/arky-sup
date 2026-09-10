import type { ExportContext, ExportFormat, ExportTrace, ArtifactValidationResult } from './exportTypes';

const traces: ExportTrace[] = [];

export function startExportTrace(context: ExportContext, format: ExportFormat, validationResult?: ArtifactValidationResult): ExportTrace {
  return {
    id: `export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    artifactId: context.artifact.id,
    artifactName: context.artifact.name,
    artifactType: context.artifact.type,
    activeView: context.activeView,
    requestedFormat: format,
    exporterUsed: `${format}Exporter`,
    startedAt: new Date().toISOString(),
    validationResult,
    browser: context.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : undefined),
    success: false,
    publication: {
      exportedAsPublication: Boolean(context.exportAsPublication && context.presentationModel),
      mode: context.publicationMode,
      score: context.presentationModel?.quality.score,
      blockers: context.presentationModel?.quality.blockers.length ?? 0,
      warnings: context.presentationModel?.quality.warnings.length ?? 0,
    },
  };
}

export function completeExportTrace(trace: ExportTrace, patch: Partial<ExportTrace>): ExportTrace {
  const completedAt = new Date().toISOString();
  const completed: ExportTrace = { ...trace, ...patch, completedAt, durationMs: Date.parse(completedAt) - Date.parse(trace.startedAt) };
  traces.unshift(completed);
  traces.splice(25);
  if (completed.success) console.info('[export]', completed);
  else console.error('[export]', completed);
  return completed;
}

export function getRecentExportTraces(): ExportTrace[] {
  return [...traces];
}
