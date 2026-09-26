import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Artifact } from '../../lib/artifacts';
import type { ArtifactViewMode } from '../../lib/artifacts/contracts';
import {
  getArtifactViewCapabilities,
  resolveSafeArtifactView,
  type ArtifactViewCapabilities,
} from '../../services/artifacts/application/viewController';

export interface UseArtifactViewModeOptions {
  /** Whether the host is in a narrow (mobile) viewport. */
  isNarrowViewport?: boolean;
  /** If provided, the hook will not run its own auto-correction effect. */
  manual?: boolean;
}

export interface UseArtifactViewModeResult {
  viewMode: ArtifactViewMode;
  setViewMode: (next: ArtifactViewMode) => void;
  setSafeViewMode: (next: ArtifactViewMode) => void;
  capabilities: ArtifactViewCapabilities;
}

/**
 * Hook that owns the active view mode and guarantees the value is always a
 * mode the artifact can actually render. Replaces the inline useState +
 * useEffect dance that lived inside ArtifactCanvas.
 */
export const useArtifactViewMode = (
  artifact: Artifact,
  options: UseArtifactViewModeOptions = {},
): UseArtifactViewModeResult => {
  const { isNarrowViewport = false, manual = false } = options;
  const capabilities = useMemo(() => getArtifactViewCapabilities(artifact), [artifact]);

  const computeInitial = useCallback((): ArtifactViewMode => {
    if (
      capabilities.hasRenderableDiagram
      && capabilities.hasRenderableDocument
      && artifact.representation === 'hybrid'
      && !isNarrowViewport
    ) {
      return 'split';
    }
    return capabilities.preferredView;
  }, [artifact.representation, capabilities, isNarrowViewport]);

  const [viewMode, setViewModeRaw] = useState<ArtifactViewMode>(() => computeInitial());

  useEffect(() => {
    if (manual) return;
    setViewModeRaw(computeInitial());
  }, [computeInitial, manual]);

  useEffect(() => {
    if (manual) return;
    const safe = resolveSafeArtifactView(artifact, viewMode);
    if (safe !== viewMode) setViewModeRaw(safe);
  }, [artifact, viewMode, manual]);

  const setSafeViewMode = useCallback(
    (next: ArtifactViewMode) => {
      setViewModeRaw(resolveSafeArtifactView(artifact, next));
    },
    [artifact],
  );

  return {
    viewMode,
    setViewMode: setViewModeRaw,
    setSafeViewMode,
    capabilities,
  };
};
