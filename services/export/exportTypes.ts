import type { Settings } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import type { DiagramPreflightReport } from '../diagram';
import type { ArtifactPresentationModel, PublicationExportMode } from '../../lib/artifacts/artifactPresentationModel';

// The shared vocabulary now lives in `lib/artifacts/exportContracts.ts`, a leaf
// with no dependencies, because four other contexts needed these words and had
// to import the export engine to get them. Re-exported here so this module's
// own code and its existing callers are unchanged.
export type {
  ArtifactView,
  ExportCapabilityStatus,
  ExportCategory,
  ExportFormat,
  ValidationScope,
  ValidationSeverity,
  ArtifactValidationCheck,
  ArtifactValidationResult,
  ExportCapability,
  ExportQualityTrace,
  ExportTrace,
  ExportedFile,
} from '../../lib/artifacts/exportContracts';
import type {
  ArtifactView,
  ExportCategory,
  ExportFormat,
  ExportTrace,
  ExportedFile,
} from '../../lib/artifacts/exportContracts';

export interface ExportFormatDefinition {
  format: ExportFormat;
  extension: string;
  mimeType: string;
  label: string;
  description: string;
  category: ExportCategory;
  implemented: boolean;
  requiresDiagram?: boolean;
  requiresTable?: boolean;
  requiresPresentation?: boolean;
  producesBinary?: boolean;
}



export interface ExportContext {
  artifact: Artifact;
  activeView: ArtifactView;
  appName?: string;
  modelId?: string;
  settings?: Settings;
  generatedAt?: Date;
  diagramPreflight?: DiagramPreflightReport | null;
  userAgent?: string;
  /**
   * When true, document-oriented exporters (DOCX/PDF/HTML/Markdown) will
   * append a "Reporte de calidad" section built from
   * `buildArtifactQualityReport`. Defaults to false to preserve current
   * export contracts.
   */
  includeQualityReport?: boolean;
  /**
   * Set by the export modal when the user explicitly chose to proceed despite
   * a quality-gate warning. Recorded in the export trace for traceability; it
   * never bypasses a critical (blocking) gate.
   */
  qualityOverride?: boolean;
  /** Optional publication compiler output used when exporting a professional deliverable. */
  presentationModel?: ArtifactPresentationModel | null;
  /** True only when the user explicitly selected the publication version. */
  exportAsPublication?: boolean;
  /** Publication slice requested by the user; omitted preserves legacy export behavior. */
  publicationMode?: PublicationExportMode;
}



export interface ExportAdapter {
  format: ExportFormat;
  export(context: ExportContext): Promise<ExportedFile>;
}


export interface ExportServiceResult {
  file: ExportedFile;
  trace: ExportTrace;
}

export class ExportError extends Error {
  readonly userMessage: string;
  readonly technicalDetails?: string;
  // `Error` declares `cause` in ES2022, so this shadows it deliberately rather
  // than by accident — `noImplicitOverride` wants that said out loud.
  override readonly cause?: unknown;

  constructor(userMessage: string, technicalDetails?: string, cause?: unknown) {
    super(userMessage);
    this.name = 'ExportError';
    this.userMessage = userMessage;
    this.technicalDetails = technicalDetails;
    this.cause = cause;
  }
}
