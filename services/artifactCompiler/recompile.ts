/**
 * `recompileArtifactBeforePersist` — the single, centralised recompilation
 * entry point every artifact mutation flow must call before persistence.
 *
 * Why this exists: `createArtifact`/`createArtifactVersion` already compiled on
 * the persist path, but `updateArtifact`, `restoreArtifactVersion` and
 * `applyConsistencySuggestion` (plus manual edits and assisted improvements)
 * could leave `artifact.compilation` describing *stale* content. Concentrating
 * recompilation here guarantees a persisted artifact's compilation always
 * matches its real content, and keeps the logic out of components/callbacks.
 *
 * Two modes, by design:
 *  - `safe` (default) — evaluate only. `content` is byte-identical to the
 *    input, so the persist path performs no silent content rewrites.
 *  - `assisted-improvement` — may apply the deterministic, non-destructive
 *    repairs. Reserved for explicit, user-initiated improvement actions; the
 *    caller is told via `contentChanged` so the change stays traceable.
 */

import type { Artifact } from '../../types';
import { observabilityService } from '../observability';
import { buildCompilerSummary, compileArtifact } from './ArtifactCompiler';
import type { CompilationStatus, CompileArtifactOptions } from './ArtifactCompilerTypes';
import { getCompilationFreshness } from './artifactSignature';
import type { CompilationFreshness } from './ArtifactCompilerTypes';

/**
 * Compilation mode.
 *  - `safe`                — observe-only; never mutates `content`.
 *  - `assisted-improvement`— applies deterministic non-destructive repairs.
 */
export type CompilationMode = 'safe' | 'assisted-improvement';

export interface RecompileOptions {
  /** `safe` (default) only evaluates; `assisted-improvement` may apply repairs. */
  mode?: CompilationMode;
  /** Logical origin recorded in the compilation trace. */
  source?: CompileArtifactOptions['source'];
  /** Recompile even when the existing compilation is already `current`. */
  force?: boolean;
}

export interface RecompileOutcome {
  /**
   * Artifact carrying a fresh `compilation` summary. In `safe` mode `content`
   * is byte-identical to the input — there is no silent persist-path mutation.
   */
  artifact: Artifact;
  /** Whether the compiler actually ran (false on the already-current fast path). */
  recompiled: boolean;
  /** True only in `assisted-improvement` mode when repairs changed `content`. */
  contentChanged: boolean;
  /** Freshness of the input artifact BEFORE this pass. */
  previousFreshness: CompilationFreshness;
  /** Final compilation status, or `null` when the compiler errored hard. */
  status: CompilationStatus | null;
  /** False when an unexpected error was observed (never thrown to the caller). */
  ok: boolean;
}

/**
 * Recompile an artifact so its `compilation` summary matches its current
 * content, then return it ready to persist. Never throws — persistence must
 * never be broken by the compiler.
 */
export const recompileArtifactBeforePersist = (
  artifact: Artifact,
  options: RecompileOptions = {},
): RecompileOutcome => {
  const mode = options.mode ?? 'safe';
  const previousFreshness = getCompilationFreshness(artifact);

  // Fast path: a `safe` pass on an already-current compilation is a no-op.
  if (!options.force && mode === 'safe' && previousFreshness === 'current') {
    return {
      artifact,
      recompiled: false,
      contentChanged: false,
      previousFreshness,
      status: artifact.compilation?.compilerStatus ?? null,
      ok: true,
    };
  }

  try {
    const result = compileArtifact(artifact, {
      source: options.source ?? 'persistence',
      applyRepairs: mode === 'assisted-improvement',
    });

    if (result.status === 'failed') {
      // A degraded compilation must leave observability behind — it must never
      // be silently attached as if it were a healthy summary.
      observabilityService.recordWarning({
        source: 'operation',
        title: 'Compilación de artefacto degradada',
        message: `El compilador devolvió un resultado de respaldo seguro para "${artifact.name}". El artefacto se conserva, pero su compilación requiere revisión.`,
        operationName: 'recompileArtifactBeforePersist',
        recoverable: true,
        userVisible: false,
        metadata: { artifactId: artifact.id, artifactType: String(artifact.type), mode },
      });
    }

    const compiledArtifact = mode === 'assisted-improvement' ? result.compiled : artifact;
    return {
      artifact: { ...compiledArtifact, compilation: buildCompilerSummary(result) },
      recompiled: true,
      contentChanged: mode === 'assisted-improvement' && result.compiled !== result.original,
      previousFreshness,
      status: result.status,
      ok: result.status !== 'failed',
    };
  } catch (error) {
    // `compileArtifact` is total, so this is defence-in-depth. Persistence must
    // never break — keep the artifact and any prior compilation untouched.
    observabilityService.reportError(error, {
      source: 'operation',
      severity: 'warning',
      title: 'Recompilación de artefacto falló',
      message: 'No se pudo recompilar el artefacto antes de persistirlo; se conserva la compilación previa.',
      operationName: 'recompileArtifactBeforePersist',
      recoverable: true,
      userVisible: false,
      metadata: { artifactId: artifact.id },
    });
    return {
      artifact,
      recompiled: false,
      contentChanged: false,
      previousFreshness,
      status: null,
      ok: false,
    };
  }
};
