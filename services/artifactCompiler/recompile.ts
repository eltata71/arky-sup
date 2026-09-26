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

import type { Artifact } from '../../lib/artifacts';
import { observabilityService } from '../observability';
import { recompileArtifact, type RecompileOptions, type RecompileOutcome } from './recompileCore';

export type { CompilationMode, RecompileOptions, RecompileOutcome } from './recompileCore';

/**
 * Recompile an artifact so its `compilation` summary matches its current
 * content, then return it ready to persist. Never throws — persistence must
 * never be broken by the compiler.
 *
 * The recompilation itself is `recompileArtifact` (pure, `recompileCore.ts`);
 * this adds what persisting needs and a rule cannot do: a degraded compilation
 * leaves observability behind.
 */
export const recompileArtifactBeforePersist = (
  artifact: Artifact,
  options: RecompileOptions = {},
): RecompileOutcome => {
  const { degradation, ...outcome } = recompileArtifact(artifact, options);
  if (degradation?.kind === 'failed-status') {
    // A degraded compilation must leave observability behind — it must never
    // be silently attached as if it were a healthy summary.
    observabilityService.recordWarning({
      source: 'operation',
      title: 'Compilación de artefacto degradada',
      message: `El compilador devolvió un resultado de respaldo seguro para "${artifact.name}". El artefacto se conserva, pero su compilación requiere revisión.`,
      operationName: 'recompileArtifactBeforePersist',
      recoverable: true,
      userVisible: false,
      metadata: { artifactId: artifact.id, artifactType: String(artifact.type), mode: degradation.mode },
    });
  } else if (degradation?.kind === 'threw') {
    observabilityService.reportError(degradation.error, {
      source: 'operation',
      severity: 'warning',
      title: 'Recompilación de artefacto falló',
      message: 'No se pudo recompilar el artefacto antes de persistirlo; se conserva la compilación previa.',
      operationName: 'recompileArtifactBeforePersist',
      recoverable: true,
      userVisible: false,
      metadata: { artifactId: artifact.id },
    });
  }
  return outcome;
};
