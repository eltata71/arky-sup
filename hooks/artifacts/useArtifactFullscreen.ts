import { useCallback, useState } from 'react';

export interface UseArtifactFullscreenResult {
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  setFullscreen: (value: boolean) => void;
}

/** Owns the diagram fullscreen toggle for the artifact canvas. */
export const useArtifactFullscreen = (): UseArtifactFullscreenResult => {
  const [isFullscreen, setFullscreen] = useState(false);
  const toggleFullscreen = useCallback(() => setFullscreen((prev) => !prev), []);
  return { isFullscreen, toggleFullscreen, setFullscreen };
};
