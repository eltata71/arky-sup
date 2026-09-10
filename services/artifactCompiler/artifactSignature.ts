/**
 * Compilation freshness — deterministic change detection for the Artifact
 * Compilation Engine.
 *
 * A persisted `artifact.compilation` is only trustworthy while it still
 * describes the artifact's *current* content. This module fingerprints the
 * compilation-relevant surface of an artifact and reports whether a stored
 * compilation is `current`, `stale` or `missing` — without re-running the
 * (heavier) compiler. Mutation flows use it to decide when a recompile is
 * mandatory before persistence; the publication preflight uses it so readiness
 * is never evaluated against an obsolete snapshot.
 *
 * This module is intentionally dependency-free (types only) so both the
 * compiler core and the recompilation layer can import it without cycles.
 */

import type { Artifact } from '../../types';
import type { CompilationFreshness } from './ArtifactCompilerTypes';

/**
 * Artifact fields whose change invalidates a prior compilation. Mirrors the
 * inputs the compiler actually reads, so a change to any of them must force a
 * recompile before the artifact is persisted.
 */
export const RECOMPILE_RELEVANT_FIELDS = [
  'content',
  'type',
  'representation',
  'objective',
  'keyConcepts',
  'ir',
  'artifactEnvelope',
] as const satisfies readonly (keyof Artifact)[];

/** FNV-1a (32-bit) — compact, deterministic, dependency-free. */
const hashString = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Length-prefixed so inputs of different size never collide trivially.
  return `${input.length.toString(16)}.${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

/**
 * Deterministic fingerprint of the compilation-relevant artifact surface. Two
 * artifacts with the same fingerprint compile to the same result.
 */
export const computeArtifactCompilationSignature = (artifact: Artifact): string => {
  // Fixed key order keeps the serialization stable across callers.
  const payload = {
    content: typeof artifact.content === 'string' ? artifact.content : '',
    type: artifact.type ?? '',
    representation: artifact.representation ?? '',
    objective: typeof artifact.objective === 'string' ? artifact.objective : '',
    keyConcepts: Array.isArray(artifact.keyConcepts) ? artifact.keyConcepts : [],
    ir: artifact.ir ?? null,
    artifactEnvelope: artifact.artifactEnvelope ?? null,
  };
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    // Defensive: a non-serializable surface still yields a stable-enough key.
    serialized = `${payload.content}|${payload.type}|${payload.representation}|${payload.objective}`;
  }
  return hashString(serialized);
};

/**
 * Live freshness of an artifact's compilation. `missing` when there is no
 * compilation; `stale` when the stored signature no longer matches the
 * artifact (or is absent — legacy snapshots); `current` otherwise.
 */
export const getCompilationFreshness = (artifact: Artifact): CompilationFreshness => {
  const compilation = artifact.compilation;
  if (!compilation) return 'missing';
  if (!compilation.sourceSignature) return 'stale';
  return compilation.sourceSignature === computeArtifactCompilationSignature(artifact)
    ? 'current'
    : 'stale';
};

/** True only when the artifact's compilation matches its current content. */
export const isCompilationFresh = (artifact: Artifact): boolean =>
  getCompilationFreshness(artifact) === 'current';
