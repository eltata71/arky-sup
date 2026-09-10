/**
 * Export request validation.
 *
 * Validation is split into composable layers:
 *
 *  1. Hard *technical* checks — empty content, format implemented, format
 *     applicable to the active view/mode, and (post-export) blob/MIME/header
 *     integrity. These never depend on quality scoring.
 *  2. *Quality* checks — for the original export these are driven by the
 *     `ArtifactQualityReport` quality gate; for a publication export they are
 *     driven by `presentationModel.quality` and `presentationModel.exportProfile`.
 *
 * The layers are kept separate but composed here so a document is never
 * blocked by a diagram failure (and vice versa).
 */

import { classifyArtifact } from '../../lib/artifacts/artifactClassification';
import type { ArtifactValidationCheck, ArtifactValidationResult, ExportContext, ExportFormat, ValidationScope } from './exportTypes';
import { EXPORT_DEFINITIONS, getCandidateFormats, isDiagramFormat, isTabularFormat, normalizeExportView } from './exportRegistry';
import {
  buildArtifactExportabilityState,
  evaluateExportQualityGate,
  mapQualityIssuesToExportChecks,
} from '../quality/artifactQualityGateService';
import { resolvePublicationExportMode } from './publicationExportRenderer';
import type { ArtifactPresentationModel } from '../../lib/artifacts/artifactPresentationModel';

const unique = <T,>(items: readonly T[]): T[] => Array.from(new Set(items));
const MIN_TEXT_LENGTH = 1;

/** Matches blockers that flag skeleton / fallback / placeholder content. */
const SKELETON_RE = /skeleton|esqueleto|fallback|respaldo|placeholder/i;

interface PresentationContentFlags {
  hasDocument: boolean;
  hasDiagram: boolean;
  hasTables: boolean;
}

const presentationContentFlags = (model: ArtifactPresentationModel): PresentationContentFlags => ({
  hasDocument: model.sections.length > 0 || Boolean(model.executiveSummary) || Boolean(model.purpose) || Boolean(model.scope),
  hasDiagram: model.diagrams.some((diagram) => diagram.nodeCount > 0 || Boolean(diagram.mermaid)),
  hasTables: model.tables.some((table) => table.headers.length > 0 && table.rows.length > 0),
});

/**
 * Quality checks for a publication export. Source of truth is the compiled
 * `presentationModel`: its quality blockers/warnings and its export profile.
 */
function buildPublicationChecks(context: ExportContext, format: ExportFormat): ArtifactValidationCheck[] {
  const model = context.presentationModel!;
  const mode = resolvePublicationExportMode(context.publicationMode);
  const { quality, exportProfile } = model;
  const { hasDocument, hasDiagram, hasTables } = presentationContentFlags(model);
  const checks: ArtifactValidationCheck[] = [];

  // Skeleton / fallback content can never be exported as a clean professional
  // publication. The original export remains available for diagnostics.
  const skeletonBlocker = quality.blockers.find((blocker) => SKELETON_RE.test(blocker));
  if (skeletonBlocker) {
    checks.push({
      id: 'publication-skeleton',
      scope: 'export',
      status: 'fail',
      label: 'Publicación bloqueada por contenido skeleton/fallback',
      detail: skeletonBlocker,
      suggestedAction: 'Regenera o edita el artefacto; mientras tanto exporta el contenido original para diagnóstico.',
    });
  }

  // Per-mode content availability.
  if (mode === 'diagram-only' && !hasDiagram) {
    checks.push({
      id: 'publication-mode-diagram',
      scope: 'diagram',
      status: 'fail',
      label: 'Sin diagramas para el modo "Sólo diagrama"',
      detail: 'El modelo de presentación no contiene diagramas renderizables.',
      suggestedAction: 'Selecciona otro modo de publicación o regenera el diagrama.',
    });
  }
  if (mode === 'table-only' && !hasTables) {
    checks.push({
      id: 'publication-mode-table',
      scope: 'table',
      status: 'fail',
      label: 'Sin tablas para el modo "Sólo tabla/matriz"',
      detail: 'El modelo de presentación no contiene tablas o matrices exportables.',
      suggestedAction: 'Selecciona otro modo de publicación o agrega una tabla al artefacto.',
    });
  }
  if (mode === 'document-diagram' && !hasDocument && !hasDiagram) {
    checks.push({
      id: 'publication-mode-doc-diagram',
      scope: 'document',
      status: 'fail',
      label: 'Sin documento ni diagrama útil',
      detail: 'El modo "Documento + diagrama" requiere secciones documentales o un diagrama exportable.',
      suggestedAction: 'Genera contenido documental o un diagrama antes de exportar.',
    });
  }
  if (mode === 'publication' && !hasDocument && !hasDiagram && !hasTables) {
    checks.push({
      id: 'publication-empty',
      scope: 'export',
      status: 'fail',
      label: 'Versión publicación sin contenido',
      detail: 'El modelo de presentación no tiene documento, diagrama ni tablas exportables.',
      suggestedAction: 'Regenera el artefacto antes de exportar la versión publicación.',
    });
  }

  // Tabular formats require a table regardless of the requested mode.
  if ((format === 'csv' || format === 'xlsx') && !hasTables) {
    checks.push({
      id: 'publication-tabular-no-table',
      scope: 'table',
      status: 'fail',
      label: `${format.toUpperCase()} requiere una tabla de publicación`,
      detail: 'La versión publicación no contiene tablas para exportación tabular.',
      suggestedAction: 'Usa un formato documental/diagramático o agrega una tabla al artefacto.',
    });
  }

  // Export-profile alignment — surface a non-blocking warning when the format
  // is outside the resolved profile (candidate filtering already hard-blocks).
  const blockedByProfile = exportProfile.blockedFormats.find((blocked) => blocked.format === format);
  if (blockedByProfile && !exportProfile.availableFormats.includes(format)) {
    checks.push({
      id: 'publication-profile-blocked',
      scope: 'export',
      status: 'warn',
      label: `Formato ${format.toUpperCase()} fuera del perfil de exportación`,
      detail: blockedByProfile.reason,
      suggestedAction: blockedByProfile.recommendation,
    });
  }

  // Non-skeleton blockers → exportable as a draft only with explicit override.
  const draftBlockers = quality.blockers.filter((blocker) => !SKELETON_RE.test(blocker));
  if (draftBlockers.length > 0) {
    if (context.qualityOverride) {
      checks.push({
        id: 'publication-blockers-override',
        scope: 'export',
        status: 'warn',
        label: 'Publicación con bloqueadores exportada como borrador',
        detail: `Se exporta un borrador por confirmación explícita del usuario: ${draftBlockers.slice(0, 2).join(' · ')}`,
      });
    } else {
      checks.push({
        id: 'publication-blockers',
        scope: 'export',
        status: 'fail',
        label: 'La versión publicación tiene bloqueadores',
        detail: draftBlockers.slice(0, 2).join(' · '),
        suggestedAction: 'Confirma la exportación como borrador o corrige los bloqueadores antes de publicar.',
      });
    }
  }

  // Quality warnings never block — they are surfaced so the user can consent.
  quality.warnings.slice(0, 4).forEach((warning, index) => {
    checks.push({
      id: `publication-warning-${index}`,
      scope: 'export',
      status: 'warn',
      label: 'Advertencia de presentación',
      detail: warning,
    });
  });

  // Sub-threshold score with no blockers is informational only.
  if (!quality.readyForPublication && draftBlockers.length === 0 && !skeletonBlocker) {
    checks.push({
      id: 'publication-not-ready',
      scope: 'export',
      status: 'warn',
      label: 'Versión publicación requiere revisión',
      detail: `Score de presentación ${quality.score}/100. El archivo es exportable pero conviene revisarlo antes de compartir.`,
    });
  }

  if (!checks.some((check) => check.status === 'fail') && draftBlockers.length === 0 && !skeletonBlocker) {
    checks.push({
      id: 'publication-ready',
      scope: 'export',
      status: 'pass',
      label: 'Versión publicación',
      detail: `Modo ${mode} · score ${quality.score}/100 · ${quality.readyForPublication ? 'lista' : 'borrador revisable'}.`,
    });
  }
  return checks;
}

export function validateExportRequest(context: ExportContext, format?: ExportFormat): ArtifactValidationResult {
  const classification = classifyArtifact(context.artifact);
  const activeView = normalizeExportView(context.activeView);
  const isPublication = Boolean(context.exportAsPublication && context.presentationModel);
  const content = isPublication && context.presentationModel
    ? context.presentationModel.title.trim()
    : context.artifact.content.trim();
  const candidates = getCandidateFormats({
    artifact: context.artifact,
    activeView,
    exportAsPublication: context.exportAsPublication,
    presentationModel: context.presentationModel,
    publicationMode: context.publicationMode,
  });
  const checks: ArtifactValidationCheck[] = [];

  // ── Layer 1: hard technical checks ─────────────────────────────────────────
  if (format && !EXPORT_DEFINITIONS[format]?.implemented) {
    checks.push({ id: 'format-not-implemented', scope: 'export', status: 'fail', label: 'Formato no implementado', detail: `El formato ${format} no tiene exportador real.`, suggestedAction: 'Selecciona un formato disponible.' });
  }
  if (format && !candidates.includes(format) && !isTabularFormat(format)) {
    checks.push({ id: 'format-view-mismatch', scope: 'export', status: 'fail', label: 'Formato no aplicable', detail: `El formato ${format.toUpperCase()} no aplica para esta vista/modo de exportación.`, suggestedAction: 'Selecciona un formato habilitado en el modal.' });
  }

  // ── Layer 2: quality gate ──────────────────────────────────────────────────
  if (format) {
    if (isPublication) {
      // Publication exports are governed by the compiled presentation model.
      checks.push(...buildPublicationChecks(context, format));
    } else {
      const { report } = buildArtifactExportabilityState(context.artifact, { activeView });
      const gate = evaluateExportQualityGate(report, format, activeView);
      // Blockers → fail, warnings → warn. A passed-with-warnings gate keeps the
      // export open: the file would not be empty or corrupt, only sub-optimal.
      checks.push(...mapQualityIssuesToExportChecks(report, gate));

      // Diagram visual preflight is an extra technical signal for raster/vector
      // formats — surfaced as warnings so it never blocks a document export.
      if (isDiagramFormat(format) && classification.hasDiagram && context.diagramPreflight) {
        checks.push(...context.diagramPreflight.checks.map((check) => ({
          id: `diagram-${check.id}`,
          scope: 'diagram' as ValidationScope,
          status: check.status === 'pass' ? 'pass' as const : 'warn' as const,
          label: check.label,
          detail: check.detail,
        })));
      }
    }
  } else {
    // Overview mode (no format selected yet): summarise per-family gates.
    const { state } = buildArtifactExportabilityState(context.artifact, { activeView });
    checks.push(content.length >= MIN_TEXT_LENGTH
      ? { id: 'document-content', scope: 'document', status: 'pass', label: 'Contenido documental', detail: `Contenido exportable (${content.length} caracteres).` }
      : { id: 'document-content-empty', scope: 'document', status: 'warn', label: 'Contenido documental', detail: 'No hay contenido documental; sólo se podrán exportar formatos diagramáticos.', suggestedAction: 'Genera o edita el artefacto para habilitar exportación documental.' });
    (['document', 'diagram', 'table'] as const).forEach((family) => {
      const gate = state[family];
      checks.push({
        id: `gate-${family}`,
        scope: family === 'table' ? 'table' : family,
        status: gate.passed ? (gate.warnings.length > 0 ? 'warn' : 'pass') : 'not-applicable',
        label: family === 'document' ? 'Exportación documental' : family === 'diagram' ? 'Exportación diagramática' : 'Exportación tabular',
        detail: gate.message,
      });
    });
  }

  const failures = checks.filter((check) => check.status === 'fail');
  const warnings = checks.filter((check) => check.status === 'warn');
  const canExport = failures.length === 0;
  return {
    classification,
    activeView,
    format,
    canExport,
    status: canExport ? (warnings.length > 0 ? 'warning' : 'ready') : 'blocked',
    message: canExport
      ? warnings.length > 0
        ? isPublication
          ? 'Exportación de publicación permitida con advertencias. Revisa los hallazgos antes de compartir el entregable.'
          : 'Exportación permitida con advertencias de calidad. Revisa los hallazgos antes de compartir.'
        : isPublication
          ? 'Versión publicación lista. Validación técnica y de presentación en verde.'
          : 'Exportación lista. La validación técnica y la de calidad están en verde.'
      : failures[0]?.detail ?? 'Exportación bloqueada.',
    suggestedAction: failures[0]?.suggestedAction,
    checks,
    blockingScopes: unique(failures.map((check) => check.scope)),
  };
}

const blobBytes = async (blob: Blob, length = 8): Promise<Uint8Array> => new Uint8Array(await blob.slice(0, length).arrayBuffer());

export async function validateExportedBlob(format: ExportFormat, blob: Blob): Promise<void> {
  if (blob.size <= 0) throw new Error('El archivo generado está vacío.');
  const expectedMime = EXPORT_DEFINITIONS[format].mimeType.split(';')[0];
  if (blob.type && expectedMime && blob.type.split(';')[0] !== expectedMime) throw new Error(`MIME inesperado: ${blob.type}`);
  const bytes = await blobBytes(blob, 8);
  if ((format === 'docx' || format === 'xlsx') && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error('El archivo Office no inicia como ZIP/OOXML válido.');
  if (format === 'pdf' && String.fromCharCode(...bytes.slice(0, 4)) !== '%PDF') throw new Error('El PDF no contiene cabecera %PDF.');
  if (format === 'html') {
    const text = await blob.text();
    if (!/<html[\s>]/i.test(text) || !/^\s*<!doctype html>/i.test(text)) throw new Error('HTML incompleto o inválido.');
  }
  if ((format === 'csv' || format === 'txt' || format === 'md') && blob.size < 1) throw new Error('El archivo de texto generado no tiene contenido.');
}
