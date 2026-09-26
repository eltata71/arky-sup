/**
 * El recompilado sin efectos (F6-03, corte 4).
 *
 * Es la misma lógica que `recompileArtifactBeforePersist`, salvo que en lugar
 * de registrar una compilación degradada la **describe** en el resultado
 * (`degradation`). Así la fábrica de artefactos, que es dominio, puede
 * recompilar sin cargar la observabilidad. Quien persiste usa el envoltorio de
 * `recompile.ts`, que registra, y el comportamiento para él no cambia.
 */

import type { Artifact } from '../../lib/artifacts';
import { buildCompilerSummary, compileArtifact } from './ArtifactCompiler';
import type { CompilationStatus, CompileArtifactOptions, CompilationFreshness } from './ArtifactCompilerTypes';
import { getCompilationFreshness } from './artifactSignature';

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

/** Por qué una compilación no salió sana, para que quien persiste lo registre. */
export type RecompileDegradation =
  | { readonly kind: 'failed-status'; readonly mode: CompilationMode }
  | { readonly kind: 'threw'; readonly error: unknown };

export interface RecompileResult extends RecompileOutcome {
  /** Presente sólo cuando la compilación salió degradada o lanzó. */
  readonly degradation?: RecompileDegradation;
}

/** Recompila sin efectos: nunca lanza y nunca registra. */
export const recompileArtifact = (
  artifact: Artifact,
  options: RecompileOptions = {},
): RecompileResult => {
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
    const compiledArtifact = mode === 'assisted-improvement' ? result.compiled : artifact;
    return {
      artifact: { ...compiledArtifact, compilation: buildCompilerSummary(result) },
      recompiled: true,
      contentChanged: mode === 'assisted-improvement' && result.compiled !== result.original,
      previousFreshness,
      status: result.status,
      ok: result.status !== 'failed',
      ...(result.status === 'failed' ? { degradation: { kind: 'failed-status' as const, mode } } : {}),
    };
  } catch (error) {
    // `compileArtifact` is total, so this is defence-in-depth. Persistence must
    // never break — keep the artifact and any prior compilation untouched.
    return {
      artifact,
      recompiled: false,
      contentChanged: false,
      previousFreshness,
      status: null,
      ok: false,
      degradation: { kind: 'threw', error },
    };
  }
};

/**
 * Observe-only, sin efectos: el artefacto con su resumen de compilación al día.
 * La versión que registra una degradación es `attachCompilerSummary`, en el
 * barril del módulo.
 */
export const summarizeCompilation = (artifact: Artifact): Artifact =>
  recompileArtifact(artifact, { source: 'persistence', mode: 'safe', force: true }).artifact;
