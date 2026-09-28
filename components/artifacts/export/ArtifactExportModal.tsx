import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../Modal';
import type { Artifact } from '../../../lib/artifacts';
import type { ArtifactPresentationModel, PublicationExportMode } from '../../../lib/artifacts/artifactPresentationModel';
import {
  assessExportability,
  assessExportGate,
  assessVisualGate,
  describeQualityTier,
  isPublicationExportEnabled,
  type ArtifactQualityGateResult,
  type ArtifactView,
  type DiagramPreflightReport,
  type ExportFormat,
  type ExportFormatOption,
  type VisualGateState,
} from '../../../services/artifacts/application/artifactAssessment';
import {
  ImageExportConfiguration,
  loadImageExportPrefs,
  saveImageExportPrefs,
  type ImageExportPrefs,
  type ImageExportScale,
  type ImageExportView,
} from './ImageExportConfiguration';

export type { ImageExportScale, ImageExportView } from './ImageExportConfiguration';


export interface ArtifactExportOptions {
  includeQualityReport?: boolean;
  /** True when the user explicitly accepted a quality-gate warning. */
  qualityOverride?: boolean;
  presentationModel?: ArtifactPresentationModel | null;
  exportAsPublication?: boolean;
  publicationMode?: PublicationExportMode;
  /**
   * Gap 2 — image-export view variant. Only honoured for PNG/SVG.
   *   - 'useful'    (default) crops to the real content bounding box.
   *   - 'current'   captures the user's current viewport.
   *   - 'executive' / 'technical' bias the bbox to the audience subgraph.
   *   - 'full'      includes extra padding around boundaries.
   */
  imageExportView?: ImageExportView;
  /** Pixel density for PNG (1×, 2×, 3×). */
  imageExportScale?: ImageExportScale;
  /**
   * Whether to wrap the captured image with the editorial frame (title,
   * legend, date, confidentiality, project name). Defaults to `true`
   * for formal exports and the modal exposes a checkbox to toggle it.
   */
  imageExportFrame?: boolean;
  /** Whether the legend should be rendered inside the frame footer. */
  imageExportLegend?: boolean;
}

export interface ArtifactExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  artifact: Artifact;
  activeView: ArtifactView;
  formatOptions: ExportFormatOption[];
  onExportFormat: (format: ExportFormat, options?: ArtifactExportOptions) => void;
  preflightReport: DiagramPreflightReport | null;
  presentationModel?: ArtifactPresentationModel | null;
  /**
   * Brecha 3: state of the Visual Quality Gate 2.0 for this artifact. When
   * `blocked`, the modal surfaces a banner and forces the user to confirm
   * before exporting; `warnings` is shown informationally; `ready` and
   * `undefined` are silent.
   */
  visualGateState?: VisualGateState;
  /**
   * Hard-block context (zero nodes, repeated render errors, emergency
   * fallback). When this triggers a hard block, the modal disables every
   * export button so the user can't produce a provably empty deliverable.
   */
  visualGateHardBlockContext?: { contentNodeCount?: number; recentRenderErrors?: number; isEmergencyFallback?: boolean };
  /**
   * Recomendación 7: invoked when the hard-block guard refuses an export
   * click. Consumers wire it to observability so we can audit how often
   * the gate is saving the user from a provably empty deliverable.
   */
  onVisualGateHardBlock?: (context: { code: string | undefined; message: string }, format: ExportFormat) => void;
}

const DOC_FORMATS_WITH_REPORT: readonly ExportFormat[] = ['md', 'docx', 'pdf', 'html', 'json'];

// Persistence keys for the per-session image export preferences. We use
// `localStorage` when available so a user's previous selection is honoured
// across reloads on the same browser. The values are read once at modal
// open time and saved every time the user changes them.

const isImageFormat = (format: ExportFormat | null | undefined): format is 'png' | 'svg' =>
  format === 'png' || format === 'svg';

const RISK_META: Record<ArtifactQualityGateResult['risk'], { label: string; tone: string }> = {
  none: { label: 'Sin riesgo', tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  low: { label: 'Riesgo bajo', tone: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  medium: { label: 'Riesgo medio', tone: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  high: { label: 'Riesgo alto', tone: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  critical: { label: 'Riesgo crítico', tone: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
};

const viewLabelFor = (view: ArtifactView): string =>
  view === 'diagram' ? 'Diagrama'
    : view === 'markdown' ? 'Markdown'
      : view === 'split' ? 'Dividido'
        : 'Documento';

const scoreTone = (score: number): string =>
  score >= 90 ? 'text-emerald-600 dark:text-emerald-400'
    : score >= 75 ? 'text-blue-600 dark:text-blue-400'
      : score >= 60 ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400';


/**
 * Export modal driven by the formal quality model. The `ArtifactQualityReport`
 * and its per-family export gates (`ArtifactQualityGateResult`) are the single
 * source of truth for the visible score, the per-category exportability and
 * the per-format risk / blockers / warnings.
 */
export const ArtifactExportModal: React.FC<ArtifactExportModalProps> = ({
  isOpen,
  onClose,
  artifact,
  activeView,
  formatOptions,
  onExportFormat,
  preflightReport,
  presentationModel,
  visualGateState,
  visualGateHardBlockContext,
  onVisualGateHardBlock,
}) => {
  const [confirmFormat, setConfirmFormat] = useState<ExportFormat | null>(null);
  const [includeQualityReport, setIncludeQualityReport] = useState(false);
  const [exportAsPublication, setExportAsPublication] = useState(false);
  const [publicationMode, setPublicationMode] = useState<PublicationExportMode>('publication');
  const [imagePrefs, setImagePrefs] = useState<ImageExportPrefs>(() => loadImageExportPrefs());
  useEffect(() => {
    if (!isOpen) {
      setConfirmFormat(null);
      setIncludeQualityReport(false);
      setExportAsPublication(false);
      setPublicationMode('publication');
      // Image prefs are deliberately NOT reset on close — they persist
      // across sessions via localStorage so the architect's last choice
      // (recommended view + 2× scale, frame on) is honoured next time.
    } else {
      // Refresh from localStorage every time the modal opens so external
      // edits (e.g. via DevTools, or another tab) are picked up.
      setImagePrefs(loadImageExportPrefs());
    }
  }, [isOpen]);

  const updateImagePrefs = (patch: Partial<ImageExportPrefs>) => {
    setImagePrefs((prev) => {
      const next = { ...prev, ...patch };
      saveImageExportPrefs(next);
      return next;
    });
  };

  const { report, state } = useMemo(
    () => assessExportability(artifact, activeView),
    [artifact, activeView],
  );

  const gateByFormat = useMemo(() => {
    const map = new Map<ExportFormat, ArtifactQualityGateResult>();
    formatOptions.forEach((option) => {
      map.set(option.format, assessExportGate(report, option.format, activeView));
    });
    return map;
  }, [formatOptions, report, activeView]);

  if (!isOpen) return null;

  const viewLabel = viewLabelFor(activeView);
  const preflightWarnings = preflightReport?.checks.filter((c) => c.status !== 'pass') ?? [];

  // A format is offerable when it is technically enabled AND its quality gate
  // is not a hard block. Warnings keep the format offerable (with consent).
  const isOfferable = (option: ExportFormatOption): boolean => {
    const gate = gateByFormat.get(option.format);
    return option.enabled && Boolean(gate?.passed);
  };

  const publicationExportEnabled = isPublicationExportEnabled();
  const publicationAvailable = Boolean(presentationModel && publicationExportEnabled);
  const publicationBlockers = presentationModel?.quality.blockers ?? [];
  const publicationWarnings = presentationModel?.quality.warnings ?? [];

  const publicationContent = {
    hasDocument: presentationModel
      ? presentationModel.sections.length > 0 || Boolean(presentationModel.executiveSummary) || Boolean(presentationModel.purpose) || Boolean(presentationModel.scope)
      : false,
    hasDiagram: presentationModel
      ? presentationModel.diagrams.some((diagram) => diagram.nodeCount > 0 || Boolean(diagram.mermaid))
      : false,
    hasTables: presentationModel
      ? presentationModel.tables.some((table) => table.headers.length > 0 && table.rows.length > 0)
      : false,
  };
  const publicationModes: Array<{ mode: PublicationExportMode; label: string; description: string; disabled: boolean; reason: string }> = [
    { mode: 'publication', label: 'Publicación completa', description: 'Portada, calidad, secciones, diagramas, tablas y trazabilidad.', disabled: !(publicationContent.hasDocument || publicationContent.hasDiagram || publicationContent.hasTables), reason: 'El modelo de presentación no tiene contenido exportable.' },
    { mode: 'document-diagram', label: 'Documento + diagrama', description: 'Secciones documentales y diagramas, sin tablas independientes.', disabled: !(publicationContent.hasDocument || publicationContent.hasDiagram), reason: 'No hay documento ni diagrama útil para este modo.' },
    { mode: 'diagram-only', label: 'Sólo diagrama', description: 'Diagramas, leyendas, métricas y notas de lectura.', disabled: !publicationContent.hasDiagram, reason: 'El artefacto no contiene diagramas exportables.' },
    { mode: 'table-only', label: 'Sólo tabla/matriz', description: 'Tablas y matrices normalizadas con metadatos mínimos.', disabled: !publicationContent.hasTables, reason: 'El artefacto no contiene tablas o matrices.' },
  ];
  const activePublicationMode: PublicationExportMode = publicationModes.some((entry) => entry.mode === publicationMode && !entry.disabled)
    ? publicationMode
    : (publicationModes.find((entry) => !entry.disabled)?.mode ?? 'publication');

  const offerable = formatOptions.filter(isOfferable);
  const unavailable = formatOptions.filter((option) => !isOfferable(option));

  const groupedOfferable: Array<[string, ExportFormatOption[]]> = [];
  offerable.forEach((option) => {
    const existing = groupedOfferable.find(([group]) => group === option.group);
    if (existing) existing[1].push(option);
    else groupedOfferable.push([option.group, [option]]);
  });

  const buildOptions = (format: ExportFormat, override: boolean): ArtifactExportOptions | undefined => {
    const supportsReport = DOC_FORMATS_WITH_REPORT.includes(format);
    const publicationSelected = exportAsPublication && publicationAvailable;
    const isImage = isImageFormat(format);
    if (!supportsReport && !override && !publicationSelected && !isImage) return undefined;
    return {
      includeQualityReport: supportsReport ? includeQualityReport : undefined,
      qualityOverride: override || undefined,
      presentationModel: publicationSelected ? presentationModel : undefined,
      exportAsPublication: publicationSelected || undefined,
      publicationMode: publicationSelected ? activePublicationMode : undefined,
      // Image-only options: only attached when the chosen format is PNG/SVG.
      imageExportView: isImage ? imagePrefs.view : undefined,
      // Scale only applies to PNG; SVG is vectorial so the scale is irrelevant.
      imageExportScale: format === 'png' ? imagePrefs.scale : undefined,
      imageExportFrame: isImage ? imagePrefs.frame : undefined,
      imageExportLegend: isImage ? imagePrefs.legend : undefined,
    };
  };

  const requestExport = (format: ExportFormat) => {
    const gate = gateByFormat.get(format);
    if (exportAsPublication && publicationAvailable && presentationModel) {
      const quality = presentationModel.quality;
      if (!quality.readyForPublication || quality.warnings.length > 0 || quality.blockers.length > 0) {
        setConfirmFormat(format);
        return;
      }
    }
    // The `current` snapshot is operativo and bypasses the formal
    // preflight gate — by design — so we never surface a warning dialog
    // for it. Other views still respect the gate.
    const isOperationalSnapshot = isImageFormat(format) && imagePrefs.view === 'current';
    // Brecha 3: when the Visual Quality Gate is blocked, every formal export
    // requires a confirmation step so the user is never surprised by a
    // visually pour deliverable. Operational snapshots keep their bypass.
    const { guard: visualGuard } = assessVisualGate(visualGateState, 'export', visualGateHardBlockContext);
    if (visualGuard.hardBlock) {
      // Hard-blocks short-circuit the entire flow; the banner already shows
      // the message so we just refuse the click silently — but we still
      // notify the host so observability can record the attempt.
      onVisualGateHardBlock?.({ code: visualGuard.hardBlockCode, message: visualGuard.message }, format);
      return;
    }
    if (visualGuard.requireConfirmation && !isOperationalSnapshot) {
      setConfirmFormat(format);
      return;
    }
    if (gate && gate.passed && gate.allowOverride && !isOperationalSnapshot) {
      setConfirmFormat(format);
      return;
    }
    onExportFormat(format, buildOptions(format, false));
    onClose();
  };

  const confirmExport = () => {
    if (!confirmFormat) return;
    const fmt = confirmFormat;
    setConfirmFormat(null);
    onExportFormat(fmt, buildOptions(fmt, true));
    onClose();
  };

  const confirmGate = confirmFormat ? gateByFormat.get(confirmFormat) : undefined;
  const confirmIsPublication = Boolean(confirmFormat && exportAsPublication && publicationAvailable && presentationModel);
  const confirmIssues = confirmIsPublication && presentationModel
    ? [...presentationModel.quality.blockers, ...presentationModel.quality.warnings]
    : (confirmGate?.warnings.map((warning) => warning.message) ?? []);

  // Brecha 3 + hard-block: visual quality gate banner. Surfaced when the
  // gate is not `ready` or when the hard-block context triggers. Hard
  // blocks render in red and disable every export CTA.
  const {
    guard: visualGuard,
    tone: visualGateTone,
    showBanner: showVisualGateBanner,
  } = assessVisualGate(visualGateState, 'export', visualGateHardBlockContext);
  const visualGateBannerClass = visualGateTone === 'block'
    ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950/40 dark:text-red-100'
    : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Exportar" description={`Vista activa: ${viewLabel}`}>
      {showVisualGateBanner && (
        <section
          className={`mb-4 rounded-xl border p-3 text-xs ${visualGateBannerClass}`}
          role="alert"
          aria-label="Estado del Visual Quality Gate"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <strong>
                Visual Quality Gate: {visualGuard.hardBlock
                  ? 'bloqueo duro'
                  : visualGateState === 'blocked'
                    ? 'bloqueado'
                    : 'con advertencias'}
              </strong>
              <p className="mt-1 leading-snug">{visualGuard.message}</p>
              {visualGuard.hardBlockCode && (
                <p className="mt-1 text-[10px] font-mono opacity-80">{visualGuard.hardBlockCode}</p>
              )}
            </div>
            <span className="rounded-full bg-white/60 px-2 py-1 text-[10px] font-bold uppercase tracking-wider dark:bg-white/10">
              {visualGuard.hardBlock ? 'HARD-BLOCK' : (visualGateState ?? '')}
            </span>
          </div>
        </section>
      )}
      {presentationModel && (
        <section className="mb-4 rounded-xl border border-primary-200 bg-primary-50 p-3 text-xs text-primary-900 dark:border-primary-900/60 dark:bg-primary-950/30 dark:text-primary-100" aria-label="Perfil de exportación de publicación">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <strong>Versión publicación:</strong> {presentationModel.quality.readyForPublication ? 'lista' : 'requiere revisión'} · score {presentationModel.quality.score}/100
              <p className="mt-1 text-primary-800/80 dark:text-primary-100/80">
                Recomendado: {presentationModel.exportProfile.recommendedFormats.join(', ') || 'sin recomendación'} · default {presentationModel.exportProfile.defaultFormat.toUpperCase()}
              </p>
            </div>
            <span className="rounded-full bg-white/70 px-2 py-1 font-bold dark:bg-white/10">
              {publicationExportEnabled ? 'Export publicación habilitado' : 'Export publicación deshabilitado'}
            </span>
          </div>
          {!presentationModel.exportProfile.canExportAsPublication && (
            <p className="mt-2 text-[11px]">Se conserva la exportación original. La versión publicación queda preparada por quality gate para evitar archivos vacíos o engañosos.</p>
          )}
        </section>
      )}

      {presentationModel && (
        <section className="mb-4 rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-white/10 dark:bg-gray-900" aria-label="Seleccionar origen de exportación">
          <p className="font-bold text-slate-900 dark:text-white">Origen del entregable</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 dark:border-white/10">
              <input type="radio" name="export-source" checked={!exportAsPublication} onChange={() => setExportAsPublication(false)} />
              <span><strong>Contenido original</strong><br /><span className="text-slate-500 dark:text-slate-400">Exporta el artefacto tal como fue generado/editado.</span></span>
            </label>
            {publicationExportEnabled ? (
              <label className="flex items-start gap-2 rounded-lg border border-primary-200 p-2 dark:border-primary-900/60">
                <input type="radio" name="export-source" checked={exportAsPublication} onChange={() => setExportAsPublication(true)} />
                <span><strong>Versión publicación</strong><br /><span className="text-slate-500 dark:text-slate-400">Usa el modelo compilado con portada, calidad, diagramas y trazabilidad.</span></span>
              </label>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">La exportación publicación está deshabilitada por feature flag.</div>
            )}
          </div>
          {exportAsPublication && publicationAvailable && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Modo de publicación">
              {publicationModes.map(({ mode, label, description, disabled, reason }) => (
                <label
                  key={mode}
                  title={disabled ? reason : description}
                  className={`flex items-start gap-2 rounded-lg p-2 ${disabled ? 'cursor-not-allowed bg-slate-100 opacity-60 dark:bg-white/5' : 'bg-slate-50 dark:bg-white/5'}`}
                >
                  <input
                    type="radio"
                    name="publication-mode"
                    className="mt-0.5"
                    checked={activePublicationMode === mode}
                    disabled={disabled}
                    aria-describedby={`publication-mode-${mode}-desc`}
                    onChange={() => setPublicationMode(mode)}
                  />
                  <span>
                    <strong>{label}</strong>
                    <br />
                    <span id={`publication-mode-${mode}-desc`} className="text-slate-500 dark:text-slate-400">
                      {disabled ? `No disponible: ${reason}` : description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {exportAsPublication && publicationAvailable && publicationBlockers.length > 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 p-2 text-amber-800 dark:bg-amber-950/30 dark:text-amber-100">Esta versión tiene bloqueadores y se exportará como borrador sólo con confirmación: {publicationBlockers.slice(0, 2).join(' · ')}</p>
          )}
          {exportAsPublication && publicationAvailable && publicationBlockers.length === 0 && publicationWarnings.length > 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 p-2 text-amber-800 dark:bg-amber-950/30 dark:text-amber-100">Esta versión tiene advertencias y solicitará confirmación antes de exportar: {publicationWarnings.slice(0, 2).join(' · ')}</p>
          )}
        </section>
      )}

      <ImageExportConfiguration
        formatOptions={formatOptions}
        prefs={imagePrefs}
        onChange={updateImagePrefs}
      />

      {/* Formal quality summary */}
      <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <span className="block text-gray-500 dark:text-gray-400">Calidad global</span>
          <strong className={`text-base ${scoreTone(report.score.value)}`}>{report.score.value}/100</strong>
          <span className="block text-[10px] text-gray-500 dark:text-gray-400">{describeQualityTier(report.score.tier)}</span>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <span className="block text-gray-500 dark:text-gray-400">Documento</span>
          <strong className={report.document ? scoreTone(report.document.score) : 'text-gray-400'}>
            {report.document ? `${report.document.score}/100` : 'N/A'}
          </strong>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <span className="block text-gray-500 dark:text-gray-400">Diagrama</span>
          <strong className={report.diagram ? scoreTone(report.diagram.score) : 'text-gray-400'}>
            {report.diagram ? `${report.diagram.score}/100` : 'N/A'}
          </strong>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <span className="block text-gray-500 dark:text-gray-400">Tablas</span>
          <strong className={report.tables ? 'text-gray-900 dark:text-white' : 'text-gray-400'}>
            {report.tables ? `${report.tables.count} · ${(report.tables.completeness * 100).toFixed(0)}%` : 'N/A'}
          </strong>
        </div>
      </div>

      {/* Per-category exportability */}
      <section aria-label="Exportabilidad por categoría" className="mb-4 space-y-1.5">
        {(['document', 'diagram', 'table'] as const).map((family) => {
          const gate = state[family];
          const meta = RISK_META[gate.risk];
          const familyLabel = family === 'document' ? 'Documento' : family === 'diagram' ? 'Diagrama' : 'Tablas';
          return (
            <div key={family} className={`text-[11px] rounded-md px-2.5 py-1.5 flex items-center justify-between gap-2 ${meta.tone}`}>
              <span><strong>{familyLabel}:</strong> {gate.message}</span>
              <span className="font-semibold whitespace-nowrap">{gate.passed ? meta.label : 'Bloqueado'}</span>
            </div>
          );
        })}
      </section>

      <label className="mb-4 flex items-start gap-2 text-xs text-gray-700 dark:text-gray-200">
        <input
          type="checkbox"
          checked={includeQualityReport}
          onChange={(event) => setIncludeQualityReport(event.target.checked)}
          className="mt-0.5"
        />
        <span>
          <strong>Incluir reporte de calidad</strong> en la exportación documental (DOCX / PDF / HTML / Markdown / JSON).
          {' '}Anexa el score formal, dimensiones, hallazgos y próximos pasos. No aplica a CSV/XLSX para no romper la estructura tabular.
        </span>
      </label>

      {preflightWarnings.length > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
          <strong>Preflight visual del diagrama:</strong>
          <ul className="mt-1 list-disc pl-4 space-y-0.5">
            {preflightWarnings.slice(0, 3).map((c) => <li key={c.id}>{c.label}: {c.detail}</li>)}
          </ul>
        </div>
      )}

      {confirmFormat && confirmGate ? (
        <div
          role="alertdialog"
          aria-modal="true"
          className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-4"
        >
          <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            {confirmIsPublication
              ? `¿Exportar ${confirmFormat.toUpperCase()} como borrador de la versión publicación?`
              : `¿Exportar ${confirmFormat.toUpperCase()} con advertencias de calidad?`}
          </h4>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
            {confirmIsPublication
              ? 'La versión publicación tiene hallazgos abiertos. El archivo no quedará vacío ni corrupto, pero conviene revisarlo antes de compartirlo.'
              : `${RISK_META[confirmGate.risk].label}. El archivo no quedará vacío ni corrupto, pero la calidad está por debajo de lo recomendado.`}
          </p>
          <ul className="mt-2 list-disc pl-4 text-xs text-amber-800 dark:text-amber-200 space-y-0.5">
            {(confirmIsPublication ? confirmIssues : confirmGate.warnings.map((warning) => warning.message)).slice(0, 4).map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmFormat(null)}
              className="px-3 py-1.5 rounded-md text-xs font-medium border border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmExport}
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 transition-colors"
            >
              Exportar de todos modos
            </button>
          </div>
        </div>
      ) : (
        <>
          {groupedOfferable.length === 0 && (
            <div role="status" className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-200">
              No hay formatos exportables para esta vista. Revisa los bloqueos de exportabilidad arriba.
            </div>
          )}
          <div className="space-y-4">
            {groupedOfferable.map(([group, options]) => (
              <section key={group} aria-labelledby={`export-group-${group}`}>
                <h4
                  id={`export-group-${group}`}
                  className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                >
                  {group}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {options.map((option) => {
                    const gate = gateByFormat.get(option.format);
                    const risk = gate?.risk ?? 'none';
                    const hasWarnings = Boolean(gate && gate.warnings.length > 0);
                    return (
                      <button
                        key={option.format}
                        type="button"
                        onClick={() => requestExport(option.format)}
                        className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-left transition-colors min-h-[96px] focus:outline-none focus:ring-2 focus:ring-primary-500"
                        aria-label={`Exportar como ${option.label}`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-gray-900 dark:text-white">{option.label}</span>
                          {hasWarnings && (
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${RISK_META[risk].tone}`}>
                              {RISK_META[risk].label}
                            </span>
                          )}
                        </span>
                        <span className="mt-1 block text-[11px] text-gray-600 dark:text-gray-300 leading-snug">
                          {option.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          {unavailable.length > 0 && (
            <details className="mt-4 text-xs text-gray-600 dark:text-gray-300">
              <summary className="cursor-pointer font-medium">
                Formatos bloqueados ({unavailable.length})
              </summary>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {unavailable.map((option) => {
                  const gate = gateByFormat.get(option.format);
                  const reason = !option.enabled
                    ? option.reason ?? 'No aplica para el contenido disponible.'
                    : gate?.blockers[0]?.message ?? 'Bloqueado por el quality gate.';
                  return (
                    <div key={option.format} className="rounded-md border border-gray-200 dark:border-gray-700 p-2 opacity-80">
                      <strong>{option.label}</strong>
                      <p className="mt-0.5">{reason}</p>
                      {gate?.blockers[0]?.recommendation && (
                        <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">{gate.blockers[0].recommendation}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </>
      )}
    </Modal>
  );
};

export default ArtifactExportModal;
