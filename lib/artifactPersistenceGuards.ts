import type { Artifact } from '../types';
import { sanitizeForFirestore } from './firestoreData';

/**
 * Firestore enforces a 1 MiB hard cap per document write. We keep a
 * conservative safety budget so per-field indexing, internal metadata and
 * the encoded protobuf overhead never push a borderline document over the
 * cliff (Firestore measures the encoded size, which is always > the raw
 * JSON length).
 */
export const FIRESTORE_DOC_HARD_LIMIT_BYTES = 1_048_576;
export const FIRESTORE_DOC_SAFE_BUDGET_BYTES = 900_000;

/**
 * Threshold at which an artifact is flagged `storageMode: 'external-required'`.
 * Below this an artifact persists comfortably inline; above this the marker
 * lets downstream tooling migrate the payload to an external blob store.
 */
export const MAX_INLINE_ARTIFACT_BYTES = 650_000;

/**
 * Ordered list of fields that can be safely dropped from the persisted
 * artifact when the document would exceed Firestore's per-document limit.
 *
 * Order matters — the highest-priority (most disposable) fields are pruned
 * first. Every field listed here is either pure provenance/troubleshooting
 * data or a snapshot that downstream code recomputes lazily:
 *
 *  - `rawResponse`: raw AI completion preserved purely for support.
 *  - `artifactEnvelope`: normalized snapshot — rebuilt from `content`/`ir`
 *    by `parseArtifactRawResponse`.
 *  - `compilation`: compiler summary — recomputed by `attachCompilerSummary`.
 *  - `generationTrace`: provenance trail — the artifact remains fully
 *    functional without it; the trace is observable in memory until the
 *    user closes the session.
 *
 * The IR, content, narrative, keyConcepts and every user-facing field are
 * never touched. If the document still does not fit after dropping all the
 * above, the write is rejected with an actionable validation error so the
 * user sees a concrete cause instead of an opaque Firestore failure.
 */
export const PRUNABLE_ARTIFACT_FIELDS = [
  'rawResponse',
  'artifactEnvelope',
  'compilation',
  'generationTrace',
] as const;

export type PrunableArtifactField = (typeof PRUNABLE_ARTIFACT_FIELDS)[number];

export interface PreparedArtifactDocument {
  /** Sanitized and (possibly) pruned artifact document, ready for Firestore. */
  document: Record<string, unknown>;
  /** Byte budget the document occupies once serialized to JSON. */
  sizeBytes: number;
  /** `'firestore'` when within the inline budget, `'external-required'` otherwise. */
  storageMode: 'firestore' | 'external-required';
  /** Fields dropped to stay under the safety budget (empty when none). */
  prunedFields: PrunableArtifactField[];
}

export interface PreparedArtifactUpdate {
  /**
   * `'partial'` when the patch can be applied with `transaction.update`.
   * `'overwrite'` when pruning required dropping fields from the existing
   * document — partial updates cannot remove fields, so the caller must use
   * `transaction.set` with the full document to keep Firestore in sync.
   */
  mode: 'partial' | 'overwrite';
  document: Record<string, unknown>;
  sizeBytes: number;
  storageMode: 'firestore' | 'external-required';
  prunedFields: PrunableArtifactField[];
}

/**
 * Raised when an artifact cannot be persisted because it exceeds Firestore's
 * hard document limit even after dropping every ephemeral field. The error
 * carries `code: 'invalid-argument'` so `classifyPersistenceError` maps it to
 * `'validation-error'`, and a Spanish `userMessage` that the persistence
 * pipeline surfaces verbatim to the user.
 */
export class PersistenceValidationError extends Error {
  public readonly code = 'invalid-argument' as const;
  public readonly sizeBytes: number;
  public readonly prunedFields: PrunableArtifactField[];
  public readonly userMessage: string;

  constructor(message: string, options: { sizeBytes: number; prunedFields: PrunableArtifactField[] }) {
    super(message);
    this.name = 'PersistenceValidationError';
    this.sizeBytes = options.sizeBytes;
    this.prunedFields = options.prunedFields;
    this.userMessage = message;
  }
}

export const estimateBytes = (value: unknown): number => {
  const json = JSON.stringify(value ?? null) ?? '';
  if (typeof Blob !== 'undefined') {
    try {
      return new Blob([json]).size;
    } catch {
      // Fall through to the byte-length estimate below.
    }
  }
  if (typeof TextEncoder !== 'undefined') {
    try {
      return new TextEncoder().encode(json).length;
    } catch {
      // Fall through to the string-length estimate below.
    }
  }
  return json.length;
};

interface PrepareOptions {
  /** When provided, overrides `updatedAt` instead of using `new Date().toISOString()`. */
  updatedAt?: string;
}

/**
 * Build the persisted form of a full artifact document. Used by code paths
 * that overwrite the doc (create, batch replace) and by `updateArtifact`
 * after merging the in-flight patch with the existing remote snapshot.
 */
export const prepareArtifactForFirestore = (
  artifact: Artifact,
  options: PrepareOptions = {},
): PreparedArtifactDocument => {
  const updatedAt = options.updatedAt ?? new Date().toISOString();
  const sanitized = sanitizeForFirestore({ ...artifact, updatedAt }) as Record<string, unknown>;
  return tightenForFirestoreLimit(sanitized);
};

/**
 * Build the persisted form of a partial update. Pure function: receives the
 * remote snapshot plus the already-sanitized patch and returns either a
 * partial patch (when the merged document fits comfortably) or a
 * full-document overwrite (when pruning was required).
 *
 * The caller is responsible for `transaction.update` (partial) or
 * `transaction.set` (overwrite) based on the returned `mode`.
 */
export const prepareArtifactUpdateForFirestore = (
  currentData: Record<string, unknown>,
  sanitizedPatch: Record<string, unknown>,
): PreparedArtifactUpdate => {
  const merged = { ...currentData, ...sanitizedPatch };
  const tightened = tightenForFirestoreLimit(merged);

  if (tightened.prunedFields.length === 0) {
    return {
      mode: 'partial',
      // Always echo the recomputed `storageMode` in the patch so the marker
      // tracks the real document size after the write.
      document: { ...sanitizedPatch, storageMode: tightened.storageMode },
      sizeBytes: tightened.sizeBytes,
      storageMode: tightened.storageMode,
      prunedFields: [],
    };
  }

  return {
    mode: 'overwrite',
    document: tightened.document,
    sizeBytes: tightened.sizeBytes,
    storageMode: tightened.storageMode,
    prunedFields: tightened.prunedFields,
  };
};

const isPresent = (value: unknown): boolean =>
  value !== undefined && value !== null && !(typeof value === 'string' && value.length === 0);

const tightenForFirestoreLimit = (
  document: Record<string, unknown>,
): PreparedArtifactDocument => {
  const prunedFields: PrunableArtifactField[] = [];
  const working: Record<string, unknown> = { ...document };
  let size = estimateBytes(working);

  for (const field of PRUNABLE_ARTIFACT_FIELDS) {
    if (size <= FIRESTORE_DOC_SAFE_BUDGET_BYTES) break;
    if (!isPresent(working[field])) continue;
    delete working[field];
    prunedFields.push(field);
    size = estimateBytes(working);
  }

  const storageMode: 'firestore' | 'external-required' =
    size > MAX_INLINE_ARTIFACT_BYTES ? 'external-required' : 'firestore';
  working.storageMode = storageMode;

  if (size > FIRESTORE_DOC_HARD_LIMIT_BYTES) {
    const pruneDescription = prunedFields.length > 0 ? prunedFields.join(', ') : 'ninguno';
    throw new PersistenceValidationError(
      `El artefacto supera el límite de Firestore (${size.toLocaleString('es')} B > ${FIRESTORE_DOC_HARD_LIMIT_BYTES.toLocaleString('es')} B) incluso tras descartar campos efímeros (${pruneDescription}). Divide el contenido o reduce el IR del diagrama para poder guardarlo.`,
      { sizeBytes: size, prunedFields },
    );
  }

  return { document: working, sizeBytes: size, storageMode, prunedFields };
};

/**
 * Fields on the project document whose size is not bounded by anything.
 *
 * They are named rather than measured generically so the error can tell the
 * user *which* one is the problem. "El proyecto es demasiado grande" is not a
 * message anyone can act on; "el grafo de arquitectura ocupa 780 KB" is.
 */
export const UNBOUNDED_PROJECT_FIELDS = [
  { field: 'architectureKnowledgeGraph', label: 'el grafo de arquitectura' },
  { field: 'publicationPackages', label: 'los paquetes de publicación' },
  { field: 'projectContextEntries', label: 'las notas de contexto del proyecto' },
  { field: 'agentMemoryEntries', label: 'la memoria del agente' },
  { field: 'initialCaptureEntries', label: 'la captura inicial' },
] as const;

export interface ProjectDocumentSizeReport {
  sizeBytes: number;
  withinBudget: boolean;
  /** The unbounded fields present, largest first. Empty when none are set. */
  largestFields: Array<{ field: string; label: string; sizeBytes: number }>;
}

/**
 * Measure a project document and name what is filling it.
 *
 * The artifact path has had a size guard since the persistence hardening work;
 * the project document never did. It was the smaller of the two right up until
 * the architecture graph and the publication packages started riding along on
 * it — the graph rebuilds on every artifact change and the packages array only
 * ever grows. A document over the limit fails as an opaque Firestore error
 * with no indication of which field caused it.
 */
export const measureProjectDocument = (document: Record<string, unknown>): ProjectDocumentSizeReport => {
  const sizeBytes = estimateBytes(document);
  const largestFields = UNBOUNDED_PROJECT_FIELDS
    .filter(({ field }) => document[field] !== undefined && document[field] !== null)
    .map(({ field, label }) => ({ field, label, sizeBytes: estimateBytes(document[field]) }))
    .sort((a, b) => b.sizeBytes - a.sizeBytes);

  return { sizeBytes, withinBudget: sizeBytes <= FIRESTORE_DOC_SAFE_BUDGET_BYTES, largestFields };
};

const formatKb = (bytes: number): string => `${Math.round(bytes / 1024)} KB`;

/**
 * Throw an actionable `PersistenceValidationError` when a project document
 * would not fit. Returns the report otherwise, so callers can record the
 * measurement without measuring twice.
 */
export const assertProjectDocumentFits = (
  document: Record<string, unknown>,
  projectId: string,
): ProjectDocumentSizeReport => {
  const report = measureProjectDocument(document);
  if (report.withinBudget) return report;

  const culprit = report.largestFields[0];
  const detail = culprit
    ? ` La mayor parte corresponde a ${culprit.label} (${formatKb(culprit.sizeBytes)}).`
    : '';

  throw new PersistenceValidationError(
    `El proyecto ${projectId} ocupa ${formatKb(report.sizeBytes)} y supera el límite seguro de `
    + `${formatKb(FIRESTORE_DOC_SAFE_BUDGET_BYTES)} por documento de Firestore.${detail}`,
    { sizeBytes: report.sizeBytes, prunedFields: [] },
  );
};
