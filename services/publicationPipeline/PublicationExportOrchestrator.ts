/**
 * Publication export orchestrator (Task 11).
 *
 * The orchestrator NEVER re-implements an exporter. It reuses the existing
 * `services/export` adapters (DOCX, PDF, HTML, Markdown, JSON, XLSX, CSV, PNG,
 * SVG, Mermaid, diagram-json) through `exportArtifact`, and only adds the
 * publication-specific coordination:
 *  - exporting a real artifact with a publication preflight gate;
 *  - exporting synthetic publication documents (manifest, report, executive
 *    summary, quality / traceability evidence) by wrapping their Markdown in a
 *    throw-away artifact and routing it through the same adapters.
 *
 * It never blocks a document export because of a diagram problem, and never
 * blocks a diagram export because of a document problem — the per-family export
 * quality gate already enforces that. Every function degrades safely.
 */

import type { Artifact } from '../../types';
import { newPrefixedId } from '../../lib/ids';
import { exportArtifact } from '../export/exportService';
import { downloadFile } from '../export/downloadService';
import type { ExportFormat, ExportedFile } from '../export/exportTypes';
import { runArtifactPreflight } from './PublicationPreflightService';
import { trackPublicationEvent, reportPublicationFailure } from './PublicationObservability';
import {
  publicationTierLabel,
  type PublicationExportBatchResult,
  type PublicationExportJob,
  type PublicationExportKind,
  type PublicationExportOutcome,
  type PublicationManifest,
  type PublicationManifestFile,
  type PublicationPackage,
  type PublicationProfile,
  type PublicationReadinessReport,
  type PublicationReport,
} from './PublicationPipelineTypes';

/* ------------------------------------------------------------------------- */
/* Synthetic publication documents                                            */
/* ------------------------------------------------------------------------- */

/** Wrap a Markdown body in a throw-away document artifact for the adapters. */
const syntheticArtifact = (name: string, markdown: string): Artifact => {
  const id = newPrefixedId('pubdoc');
  return {
    id,
    versionGroupId: id,
    version: 1,
    createdAt: new Date().toISOString(),
    name,
    type: 'markdown',
    phase: 'Publicación',
    architecturalView: 'Vista de Gestión y Soporte',
    content: markdown,
    objective: 'Documento generado por el Pipeline de Publicación Profesional.',
    keyConcepts: [],
    representation: 'document',
  };
};

/** Render the manifest as a human-readable Markdown document. */
export const renderManifestMarkdown = (manifest: PublicationManifest): string => {
  const lines: string[] = [];
  lines.push(`# Manifiesto de publicación — ${manifest.projectName}`);
  lines.push('');
  lines.push(`**Paquete:** ${manifest.packageId} · versión ${manifest.packageVersion}`);
  lines.push(`**Perfil:** ${manifest.profileName} (${manifest.audience} · ${manifest.purpose})`);
  lines.push(`**Generado:** ${manifest.generatedAt}`);
  if (manifest.generatedBy) lines.push(`**Generado por:** ${manifest.generatedBy.name}`);
  lines.push('');
  lines.push('## Calidad y cobertura');
  lines.push('');
  lines.push(`- Puntaje de calidad: ${manifest.qualityScore}/100 (${publicationTierLabel(manifest.qualityTier)})`);
  lines.push(`- Puntaje de accesibilidad: ${manifest.accessibilityScore}/100`);
  lines.push(`- Cobertura de trazabilidad: ${Math.round(manifest.traceabilityCoverage * 100)}%`);
  lines.push(`- Cobertura del grafo de arquitectura: ${Math.round(manifest.architectureGraphCoverage * 100)}%`);
  lines.push('');
  lines.push('## Artefactos');
  lines.push('');
  lines.push('| Artefacto | Tipo | Versión | Calidad |');
  lines.push('|---|---|---|---|');
  for (const a of manifest.artifacts) {
    lines.push(`| ${a.name} | ${a.type} | v${a.version} | ${a.qualityScore ?? '—'} (${a.qualityTier ?? '—'}) |`);
  }
  if (manifest.artifacts.length === 0) lines.push('| _Sin artefactos_ | — | — | — |');
  lines.push('');
  lines.push('## Archivos exportados');
  lines.push('');
  if (manifest.exportedFiles.length === 0) {
    lines.push('- _Sin archivos registrados._');
  } else {
    for (const f of manifest.exportedFiles) {
      lines.push(`- ${f.label} (${f.format}) — ${f.filename}`);
    }
  }
  lines.push('');
  lines.push('## Aprobación y auditoría');
  lines.push('');
  lines.push(`- Aprobación requerida: ${manifest.approval.required ? 'Sí' : 'No'}`);
  lines.push(`- Estado: ${manifest.approval.status}`);
  if (manifest.approval.approvedBy) {
    lines.push(`- Aprobado por: ${manifest.approval.approvedBy.name} (${manifest.approval.approvedAt ?? '—'})`);
  }
  lines.push(`- Entradas de auditoría: ${manifest.audit.entryCount}`);
  lines.push(`- Overrides usados: ${manifest.audit.overridesUsed}`);
  lines.push('');
  lines.push('---');
  lines.push('_Manifiesto generado por el Pipeline de Publicación Profesional de Arky Pro._');
  return lines.join('\n');
};

/** Build the short executive-summary Markdown for a package. */
export const buildExecutiveSummaryMarkdown = (
  pkg: PublicationPackage,
  profile: PublicationProfile,
  readiness: PublicationReadinessReport,
): string => {
  const lines: string[] = [];
  lines.push(`# Resumen ejecutivo — ${pkg.name}`);
  lines.push('');
  lines.push(`**Perfil:** ${profile.name} · **Audiencia:** ${profile.audience}`);
  lines.push('');
  lines.push(`Este paquete agrupa ${pkg.artifactRefs.length} artefacto(s) con un puntaje de readiness `
    + `de ${readiness.score}/100 (${publicationTierLabel(readiness.tier)}).`);
  lines.push('');
  lines.push('## Estado');
  lines.push(`- Veredicto: ${readiness.status}`);
  lines.push(`- Bloqueadores: ${readiness.blockers.length}`);
  lines.push(`- Advertencias: ${readiness.warnings.length}`);
  lines.push(`- ¿Publicable?: ${readiness.canPublish ? 'Sí' : 'No'}`);
  lines.push('');
  lines.push('## Próximos pasos');
  const actions = readiness.recommendations.slice(0, 6);
  if (actions.length === 0) lines.push('- Sin acciones pendientes.');
  else actions.forEach((a) => lines.push(`- ${a.title}`));
  return lines.join('\n');
};

/** Build the quality-evidence Markdown for a package. */
export const buildQualityEvidenceMarkdown = (
  pkg: PublicationPackage,
  readiness: PublicationReadinessReport,
): string => {
  const lines: string[] = [];
  lines.push(`# Evidencia de calidad — ${pkg.name}`);
  lines.push('');
  lines.push(`Puntaje de calidad del paquete: ${readiness.qualityResults.score}/100 `
    + `(${publicationTierLabel(readiness.qualityResults.tier)}).`);
  lines.push('');
  lines.push('| Artefacto | Tipo | Preflight | Puntaje |');
  lines.push('|---|---|---|---|');
  for (const r of readiness.artifactResults) {
    lines.push(`| ${r.artifactName} | ${r.artifactType} | ${r.verdict} | ${r.score} |`);
  }
  if (readiness.artifactResults.length === 0) lines.push('| _Sin artefactos_ | — | — | — |');
  return lines.join('\n');
};

/** Build the traceability-evidence Markdown for a package. */
export const buildTraceabilityEvidenceMarkdown = (
  pkg: PublicationPackage,
  readiness: PublicationReadinessReport,
): string => {
  const t = readiness.traceabilityResults;
  const lines: string[] = [];
  lines.push(`# Evidencia de trazabilidad — ${pkg.name}`);
  lines.push('');
  lines.push(`- Cobertura de requerimientos: ${Math.round(t.requirementCoverage * 100)}%`);
  lines.push(`- Cobertura de riesgos: ${Math.round(t.riskCoverage * 100)}%`);
  lines.push(`- Cobertura del grafo de arquitectura: ${Math.round(t.graphCoverage * 100)}%`);
  lines.push(`- Inconsistencias del grafo: ${t.consistencyIssueCount}`);
  lines.push('');
  lines.push('## Requerimientos sin cobertura');
  if (t.uncoveredRequirementNames.length === 0) lines.push('- Ninguno.');
  else t.uncoveredRequirementNames.forEach((n) => lines.push(`- ${n}`));
  lines.push('');
  lines.push('## Riesgos sin mitigación');
  if (t.risksWithoutMitigationNames.length === 0) lines.push('- Ninguno.');
  else t.risksWithoutMitigationNames.forEach((n) => lines.push(`- ${n}`));
  return lines.join('\n');
};

/* ------------------------------------------------------------------------- */
/* Export primitives                                                          */
/* ------------------------------------------------------------------------- */

/**
 * Export a real package artifact through the existing adapters, gated by a
 * publication preflight. A blocked artifact is not exported (no corrupt file).
 */
export const exportPublicationArtifact = async (
  artifact: Artifact,
  format: ExportFormat,
  qualityThreshold = 70,
): Promise<{ outcome: PublicationExportOutcome; file?: ExportedFile }> => {
  const job: PublicationExportJob = { kind: 'artifact', format, artifactId: artifact.id };
  const preflight = runArtifactPreflight(artifact, { qualityThreshold });
  if (preflight.verdict === 'blocked') {
    return {
      outcome: {
        job,
        success: false,
        error: 'El artefacto no superó el preflight de publicación y no se exportó.',
      },
    };
  }
  try {
    const view = artifact.representation === 'diagram' ? 'diagram' : 'document';
    const { file } = await exportArtifact({ artifact, activeView: view }, format);
    return { outcome: { job, success: true, filename: file.filename, size: file.blob.size }, file };
  } catch (error) {
    return {
      outcome: {
        job,
        success: false,
        error: error instanceof Error ? error.message : 'Error desconocido exportando el artefacto.',
      },
    };
  }
};

/** Export a synthetic publication document (manifest, report, evidence…). */
export const exportPublicationDocument = async (
  kind: PublicationExportKind,
  name: string,
  markdown: string,
  format: ExportFormat,
): Promise<{ outcome: PublicationExportOutcome; file?: ExportedFile }> => {
  const job: PublicationExportJob = { kind, format };
  try {
    const { file } = await exportArtifact(
      { artifact: syntheticArtifact(name, markdown), activeView: 'document' },
      format,
    );
    return { outcome: { job, success: true, filename: file.filename, size: file.blob.size }, file };
  } catch (error) {
    return {
      outcome: {
        job,
        success: false,
        error: error instanceof Error ? error.message : `No se pudo exportar ${name}.`,
      },
    };
  }
};

/* ------------------------------------------------------------------------- */
/* Batch orchestration                                                        */
/* ------------------------------------------------------------------------- */

export interface PublicationExportBatchInput {
  pkg: PublicationPackage;
  profile: PublicationProfile;
  readiness: PublicationReadinessReport;
  report: PublicationReport;
  manifest: PublicationManifest;
  /** Resolved artifacts referenced by the package. */
  artifacts: Artifact[];
  jobs: PublicationExportJob[];
  /** When true, each produced file is also downloaded in the browser. */
  triggerDownload?: boolean;
}

/**
 * Run a batch of publication export jobs. Reuses the existing adapters and
 * collects per-job outcomes plus manifest file entries. Never throws — a failed
 * job is reported in its outcome and the batch continues.
 */
export const runPublicationExportBatch = async (
  input: PublicationExportBatchInput,
): Promise<PublicationExportBatchResult> => {
  trackPublicationEvent('publication.export.started',
    `Exportación de publicación iniciada (${input.jobs.length} trabajo(s)).`,
    { packageId: input.pkg.id, jobCount: input.jobs.length });

  const outcomes: PublicationExportOutcome[] = [];
  const manifestFiles: PublicationManifestFile[] = [];
  const artifactById = new Map(input.artifacts.map((a) => [a.id, a]));

  for (const job of input.jobs) {
    let result: { outcome: PublicationExportOutcome; file?: ExportedFile };
    try {
      if (job.kind === 'artifact') {
        const artifact = job.artifactId ? artifactById.get(job.artifactId) : undefined;
        result = artifact
          ? await exportPublicationArtifact(artifact, job.format, input.profile.qualityThreshold)
          : { outcome: { job, success: false, error: 'Artefacto no encontrado en el paquete.' } };
      } else if (job.kind === 'manifest') {
        result = await exportPublicationDocument(
          'manifest', `Manifiesto — ${input.pkg.name}`,
          renderManifestMarkdown(input.manifest), job.format,
        );
      } else if (job.kind === 'report') {
        result = await exportPublicationDocument(
          'report', `Reporte de publicación — ${input.pkg.name}`,
          input.report.markdown, job.format,
        );
      } else if (job.kind === 'executive-summary') {
        result = await exportPublicationDocument(
          'executive-summary', `Resumen ejecutivo — ${input.pkg.name}`,
          buildExecutiveSummaryMarkdown(input.pkg, input.profile, input.readiness), job.format,
        );
      } else if (job.kind === 'quality-evidence') {
        result = await exportPublicationDocument(
          'quality-evidence', `Evidencia de calidad — ${input.pkg.name}`,
          buildQualityEvidenceMarkdown(input.pkg, input.readiness), job.format,
        );
      } else {
        result = await exportPublicationDocument(
          'traceability-evidence', `Evidencia de trazabilidad — ${input.pkg.name}`,
          buildTraceabilityEvidenceMarkdown(input.pkg, input.readiness), job.format,
        );
      }
    } catch (error) {
      result = {
        outcome: {
          job,
          success: false,
          error: error instanceof Error ? error.message : 'Error desconocido en el trabajo de exportación.',
        },
      };
    }

    outcomes.push(result.outcome);
    if (result.file && result.outcome.success) {
      manifestFiles.push({
        ...(job.kind === 'artifact' && job.artifactId ? { artifactId: job.artifactId } : {}),
        label: result.file.filename,
        format: job.format,
        filename: result.file.filename,
        size: result.file.blob.size,
        exportedAt: new Date().toISOString(),
      });
      if (input.triggerDownload) {
        try {
          await downloadFile(result.file);
        } catch (error) {
          reportPublicationFailure('publication.export.failed', error, { packageId: input.pkg.id });
        }
      }
    }
  }

  const allSucceeded = outcomes.every((o) => o.success);
  if (allSucceeded) {
    trackPublicationEvent('publication.export.completed',
      `Exportación de publicación completada (${outcomes.length} archivo(s)).`,
      { packageId: input.pkg.id });
  } else {
    trackPublicationEvent('publication.export.failed',
      `Exportación de publicación con ${outcomes.filter((o) => !o.success).length} fallo(s).`,
      { packageId: input.pkg.id });
  }

  return {
    packageId: input.pkg.id,
    generatedAt: new Date().toISOString(),
    outcomes,
    manifestFiles,
    allSucceeded,
  };
};

/**
 * Build the default export job set for a package: every artifact in the
 * profile's primary document format, plus the report and the manifest.
 */
export const buildDefaultExportJobs = (
  pkg: PublicationPackage,
  profile: PublicationProfile,
): PublicationExportJob[] => {
  const docFormat: ExportFormat = profile.exportFormats.includes('pdf')
    ? 'pdf'
    : profile.exportFormats[0] ?? 'md';
  const jobs: PublicationExportJob[] = [
    { kind: 'report', format: docFormat },
    { kind: 'manifest', format: 'json' },
    { kind: 'executive-summary', format: docFormat },
  ];
  for (const ref of pkg.artifactRefs) {
    jobs.push({ kind: 'artifact', format: docFormat, artifactId: ref.artifactId });
  }
  return jobs;
};
