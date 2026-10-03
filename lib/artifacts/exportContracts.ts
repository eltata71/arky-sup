import type { ArtifactClassification } from './artifactClassification';
import type { PublicationExportMode } from './artifactPresentationModel';
/**
 * The vocabulary that export, quality, artifacts and the publication pipeline
 * all speak — and none of them owns.
 *
 * These seven declarations used to live in `services/export/exportTypes.ts`,
 * which made every context that needed the word "PDF" or "the document view"
 * depend on the export engine. `services/quality` imported `ExportFormat` and
 * `ArtifactValidationCheck` from there while `services/export` imported the
 * quality report back: two modules that cannot be compiled, tested or read
 * apart, joined by four string unions.
 *
 * So the vocabulary moves down to a leaf. Nothing here imports anything: it is
 * a shared kernel in the strict sense — deliberately small, deliberately
 * inert, and deliberately not the place to put the next domain type that only
 * one context needs. `services/export/exportTypes.ts` re-exports these, so the
 * export engine's own code did not have to change.
 */

/** Which rendering of an artifact is on screen, and therefore what can be exported. */
export type ArtifactView =
  | 'diagram'
  | 'document'
  | 'markdown'
  | 'split'
  | 'table'
  | 'source'
  | 'excalidraw'
  | 'lucidchart';

/** Every format the product can produce. The registry maps each to an adapter. */
export type ExportFormat =
  | 'png'
  | 'svg'
  | 'mermaid'
  | 'diagram-json'
  | 'pdf'
  | 'docx'
  | 'html'
  | 'md'
  | 'txt'
  | 'json'
  | 'csv'
  | 'xlsx'
  | 'pptx';

/** How a format is grouped in the export UI. */
export type ExportCategory =
  | 'Documento'
  | 'Hoja de cálculo'
  | 'Diagrama'
  | 'Intercambio/Auditoría'
  | 'Presentación';

export type ExportCapabilityStatus = 'enabled' | 'disabled';

export type ValidationSeverity = 'pass' | 'warn' | 'fail' | 'not-applicable';

export type ValidationScope = 'diagram' | 'document' | 'markdown' | 'table' | 'export';

/** One check performed before an artifact is allowed out of the product. */
export interface ArtifactValidationCheck {
  id: string;
  scope: ValidationScope;
  status: ValidationSeverity;
  label: string;
  detail: string;
  suggestedAction?: string;
}


/* ── Bajadas desde `services/export/exportTypes.ts` ─────────────────────── */
/**
 * Las cinco que faltaban.
 *
 * `lib/artifacts/contracts.ts` necesitaba `ExportCapability`,
 * `ArtifactValidationResult`, `ExportedFile` y `ExportTrace` para republicar
 * la superficie de tipos que lee la UI, y las pedía hacia arriba a
 * `services/export` — el último import ascendente que quedaba en `lib/`.
 * `ExportQualityTrace` viene con ellas porque `ExportTrace` la contiene.
 *
 * `services/export/exportTypes.ts` las reexporta, igual que ya hacía con las
 * siete que bajaron antes, así que ningún llamador cambia de puerta.
 */
export interface ExportCapability {
  format: ExportFormat;
  extension: string;
  mimeType: string;
  label: string;
  description: string;
  group: ExportCategory;
  category: ExportCategory;
  implemented: boolean;
  enabled: boolean;
  reason?: string;
}
export interface ArtifactValidationResult {
  classification: ArtifactClassification;
  activeView: ArtifactView;
  format?: ExportFormat;
  canExport: boolean;
  status: 'ready' | 'warning' | 'blocked' | 'partial';
  message: string;
  suggestedAction?: string;
  checks: ArtifactValidationCheck[];
  blockingScopes: ValidationScope[];
}
/**
 * La primera página o diapositiva, tal como la escribió el exportador (plan de
 * clase mundial 9.4): lo que la persona ve antes de descargar.
 */
export interface ExportPreview {
  readonly kind: 'page' | 'slide';
  readonly title: string;
  readonly subtitle?: string;
  /** Las primeras líneas de contenido, en el orden en que aparecen. */
  readonly lines: readonly string[];
}

/**
 * Lo que el exportador **hizo**, contado por él mismo mientras escribía el
 * fichero (9.4). No se recalcula después: un recibo que volviera a leer el
 * artefacto diría lo que debería haber salido, no lo que salió.
 */
export interface ExportReceipt {
  readonly pages?: number;
  readonly slides?: number;
  readonly slidesWithNotes?: number;
  readonly tables: number;
  readonly diagrams: number;
  /** Cada pérdida o degradación, en una frase. Vacío = nada se perdió. */
  readonly losses: readonly string[];
  readonly preview?: ExportPreview;
}

export interface ExportedFile {
  blob: Blob;
  filename: string;
  mimeType: string;
  extension: string;
  format: ExportFormat;
  technicalDetails?: string;
  /** El recibo de los formatos que lo escriben (DOCX, PPTX y PDF). */
  receipt?: ExportReceipt;
  publication?: {
    exportedAsPublication: boolean;
    mode?: PublicationExportMode;
    score?: number;
    blockers: number;
    warnings: number;
  };
}
/** Quality traceability captured on every export attempt. */
export interface ExportQualityTrace {
  /** Formal global score (0-100) from `buildArtifactQualityReport`. */
  score: number;
  /** Discrete quality tier. */
  tier: string;
  /** Gate that governed the export (e.g. `export:document`). */
  gateId: string;
  /** Risk level the user took on. */
  risk: 'none' | 'low' | 'medium' | 'high' | 'critical';
  /** Whether the gate passed. */
  gatePassed: boolean;
  /** Whether the user explicitly overrode a quality warning. */
  override: boolean;
  /** Top blocker messages (empty when the gate passed). */
  blockers: string[];
  /** Top warning messages surfaced to the user. */
  warnings: string[];
}
export interface ExportTrace {
  id: string;
  artifactId: string;
  artifactName: string;
  artifactType: string;
  activeView: ArtifactView;
  requestedFormat: ExportFormat;
  exporterUsed: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  blobSize?: number;
  mimeType?: string;
  filename?: string;
  validationResult?: ArtifactValidationResult;
  /** Formal quality snapshot recorded for this export attempt. */
  quality?: ExportQualityTrace;
  browser?: string;
  success: boolean;
  errorMessage?: string;
  technicalDetails?: string;
  /** 7.5b: `[ctx:*]` tags turned into numbered notes, and those removed because they resolved to nothing. */
  citations?: { notes: number; removed: string[] };
  publication?: {
    exportedAsPublication: boolean;
    mode?: PublicationExportMode;
    score?: number;
    blockers: number;
    warnings: number;
  };
}
