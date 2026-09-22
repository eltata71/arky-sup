/**
 * Central, dependency-light detection for deterministic fallback / skeleton
 * artifact content.
 *
 * Before this module the same question — "was this artifact produced by a
 * deterministic fallback?" — was answered by ad-hoc regexes and metadata
 * checks scattered across the refinement orchestrator, the canvas, the
 * quality service and the publication preflight. Those copies drifted: the
 * refinement orchestrator looked for `ARKY_SKELETON_FALLBACK` while the real
 * marker is `%% arky:skeleton-fallback`, so a genuine skeleton whose IR
 * metadata had been lost was silently treated as clean content.
 *
 * This module is the single source of truth. It is pure (only imports types)
 * so it can be consumed by services, components and tests without pulling in
 * the heavy generation pipeline.
 */
import type { ArtifactGenerationTraceStatus } from '../../lib/artifacts';
import type { DiagramErrorRecord } from '../../lib/diagram';

/**
 * Marker prepended (as a Mermaid `%%` comment) to every deterministic diagram
 * skeleton. Canonical value — `geminiService` re-exports this constant so the
 * whole codebase shares a single literal.
 */
export const SKELETON_FALLBACK_MARKER = '%% arky:skeleton-fallback';

/**
 * Marker prepended (as an invisible HTML comment) to deterministic *document*
 * fallbacks. HTML comments are not rendered by the Markdown pipeline, so the
 * marker stays machine-detectable without changing what the user sees.
 */
export const DETERMINISTIC_DOCUMENT_FALLBACK_MARKER = '<!-- arky:deterministic-fallback -->';

export interface ArtifactFallbackDetectionResult {
  /** True when any deterministic-fallback signal fired. */
  isFallback: boolean;
  /** True when the content is specifically a renderable diagram skeleton. */
  isSkeleton: boolean;
  /** Highest signal weight that fired (0 = none, 1 = explicit marker). */
  confidence: number;
  /** Human-readable explanation of every signal that fired. */
  reasons: string[];
  /** The explicit marker string detected, when the content carried one. */
  marker?: string;
}

export interface ArtifactFallbackDetectionInput {
  /** Final/persisted artifact content. */
  content: string;
  /** Raw AI response, when still available. */
  rawResponse?: string;
  /** Last recorded diagram failure for the artifact. */
  lastDiagramError?: DiagramErrorRecord;
  /** Status of the artifact generation trace. */
  generationTraceStatus?: ArtifactGenerationTraceStatus;
  /** `DiagramIR.metadata` of the parsed artifact, when available. */
  irMetadata?: Record<string, unknown>;
}

/** Specific sentence emitted by the deterministic document fallback builder. */
const DOCUMENT_FALLBACK_PROSE = /contenido local de respaldo generado porque el servicio de IA/i;
/** `status: "fallback-local"` line emitted by the deterministic YAML fallback. */
const YAML_FALLBACK_STATUS = /(^|\n)\s*status:\s*["']?fallback-local["']?/i;

/**
 * Cheap predicate kept for call sites that only need a yes/no on the diagram
 * skeleton marker.
 */
export const containsSkeletonFallbackMarker = (content: string | undefined | null): boolean =>
  typeof content === 'string' && content.includes(SKELETON_FALLBACK_MARKER);

/**
 * Single source of truth for "is this artifact deterministic-fallback
 * content?". Combines explicit markers, IR metadata, persisted diagram errors
 * and the generation trace status into one auditable result.
 *
 * The prose signal is intentionally a full, specific sentence so a mere
 * textual mention of the word "fallback" never produces a false positive.
 */
export function detectArtifactFallbackContent(
  input: ArtifactFallbackDetectionInput,
): ArtifactFallbackDetectionResult {
  const content = input.content ?? '';
  const raw = input.rawResponse ?? '';
  const reasons: string[] = [];
  let isFallback = false;
  let isSkeleton = false;
  let confidence = 0;
  let marker: string | undefined;

  const fire = (weight: number, reason: string): void => {
    confidence = Math.max(confidence, weight);
    reasons.push(reason);
  };

  // 1. Explicit diagram-skeleton marker (content or raw response).
  if (content.includes(SKELETON_FALLBACK_MARKER) || raw.includes(SKELETON_FALLBACK_MARKER)) {
    isSkeleton = true;
    isFallback = true;
    marker = SKELETON_FALLBACK_MARKER;
    fire(1, 'Marcador de esqueleto determinístico presente en el contenido.');
  }

  // 2. Explicit document-fallback marker.
  if (
    content.includes(DETERMINISTIC_DOCUMENT_FALLBACK_MARKER)
    || raw.includes(DETERMINISTIC_DOCUMENT_FALLBACK_MARKER)
  ) {
    isFallback = true;
    marker = marker ?? DETERMINISTIC_DOCUMENT_FALLBACK_MARKER;
    fire(1, 'Marcador de documento de respaldo determinístico presente en el contenido.');
  }

  // 3. IR metadata flag.
  if (input.irMetadata && input.irMetadata['fallback'] === 'skeleton') {
    isSkeleton = true;
    isFallback = true;
    fire(1, 'El IR está marcado como esqueleto de respaldo (metadata.fallback).');
  }

  // 4. Persisted diagram failure.
  if (input.lastDiagramError?.reason === 'skeleton-fallback') {
    isSkeleton = true;
    isFallback = true;
    fire(0.95, 'lastDiagramError.reason === "skeleton-fallback".');
  } else if (input.lastDiagramError?.reason === 'empty-ir') {
    isFallback = true;
    fire(0.8, 'lastDiagramError.reason === "empty-ir": la generación no produjo IR utilizable.');
  }

  // 5. Generation trace status.
  if (input.generationTraceStatus === 'fallback') {
    isFallback = true;
    fire(0.75, 'generationTrace.status === "fallback".');
  }

  // 6. YAML deterministic fallback status line.
  if (YAML_FALLBACK_STATUS.test(content)) {
    isFallback = true;
    fire(0.9, 'El YAML declara status: "fallback-local".');
  }

  // 7. Document fallback prose.
  if (DOCUMENT_FALLBACK_PROSE.test(content)) {
    isFallback = true;
    fire(0.85, 'El documento contiene la nota de respaldo local determinístico.');
  }

  return { isFallback, isSkeleton, confidence, reasons, marker };
}

/**
 * Prepend the invisible document-fallback marker when it is missing. Used by
 * the refinement orchestrator to guarantee a refined document fallback is
 * never silently presented as clean content.
 */
export function markDocumentAsDeterministicFallback(content: string): string {
  if (content.includes(DETERMINISTIC_DOCUMENT_FALLBACK_MARKER)) return content;
  return `${DETERMINISTIC_DOCUMENT_FALLBACK_MARKER}\n${content.trimStart()}`;
}

/**
 * Insert the skeleton marker inside the first Mermaid fence of a hybrid
 * (Markdown + diagram) artifact. Falls back to the document marker when the
 * content carries no fence.
 */
export function markHybridAsDeterministicFallback(content: string): string {
  if (containsSkeletonFallbackMarker(content)) return content;
  if (/```mermaid\s*\n/i.test(content)) {
    return content.replace(/(```mermaid\s*\n)/i, (match) => `${match}${SKELETON_FALLBACK_MARKER}\n`);
  }
  return markDocumentAsDeterministicFallback(content);
}
