import type { Artifact } from '../../lib/artifacts';

export interface RuntimeVisualSignals {
  recentRenderErrors: number;
  exportPreflightOk?: boolean;
}

/**
 * Derives runtime hints used by Visual Quality Gate 2.0 from the current
 * artifact/session state. Pure and deterministic for easy testing.
 */
export function deriveRuntimeVisualSignals(
  artifact: Pick<Artifact, 'generationTrace' | 'lastDiagramError'>,
  exportPreflightReady?: boolean,
): RuntimeVisualSignals {
  const traceErrors = artifact.generationTrace?.errors.length ?? 0;
  const lastError = artifact.lastDiagramError ? 1 : 0;

  return {
    recentRenderErrors: traceErrors + lastError,
    exportPreflightOk: exportPreflightReady,
  };
}

