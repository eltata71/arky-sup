import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import type { ArtifactViewMode } from '../../lib/artifacts/contracts';
import { diagramGenerationService } from '../../services/ai';
import {
  isDiagramAIFallbackEnabled,
  mermaidToExcalidraw as mermaidToExcalidrawDeterministic,
} from '../../services/diagram';

type ExcalidrawPayload = { elements: unknown[] };

export interface UseExcalidrawRenderingInput {
  artifact: Artifact;
  settings: Settings;
  viewMode: ArtifactViewMode;
  mermaidCode: string | null;
  setViewMode: (next: ArtifactViewMode) => void;
}

export interface UseExcalidrawRenderingResult {
  excalidrawData: ExcalidrawPayload | null;
  isLoading: boolean;
  error: string | null;
  openExternal: () => void;
  retry: () => void;
}

/**
 * Owns Excalidraw conversion for the artifact canvas. The deterministic
 * renderer is canonical; the AI hop is a diagnostics-only fallback enabled
 * via `VITE_DIAGRAM_AI_FALLBACK`.
 */
export const useExcalidrawRendering = (input: UseExcalidrawRenderingInput): UseExcalidrawRenderingResult => {
  const { artifact, settings, viewMode, mermaidCode, setViewMode } = input;

  const [excalidrawData, setExcalidrawData] = useState<ExcalidrawPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(new Map<string, ExcalidrawPayload>());
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (viewMode !== 'excalidraw') return;

    if (cache.current.has(artifact.id)) {
      setExcalidrawData(cache.current.get(artifact.id) ?? null);
      return;
    }

    if (artifact.representation === 'document' && !mermaidCode) {
      setError('Este artefacto no contiene diagrama. Usa la vista Documento o Markdown.');
      return;
    }

    const mermaidContent = mermaidCode ?? artifact.content;

    const generate = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const isDark = document.documentElement.classList.contains('dark');
        let result: ExcalidrawPayload | null = null;
        try {
          const det = mermaidToExcalidrawDeterministic(mermaidContent, isDark);
          if (det.elements.length > 0) result = det;
        } catch (parserErr) {
          console.warn('[useExcalidrawRendering] Canonical Excalidraw render failed.', parserErr);
        }
        if (!result && isDiagramAIFallbackEnabled()) {
          result = await diagramGenerationService.convertToExcalidrawJSON(mermaidContent, settings, isDark);
        }
        if (!isMounted.current) return;
        if (result && result.elements?.length > 0) {
          cache.current.set(artifact.id, result);
          setExcalidrawData(result);
        } else {
          setError('No se pudieron generar los elementos del diagrama. Inténtalo de nuevo.');
        }
      } catch (err) {
        if (isMounted.current) {
          setError(err instanceof Error ? err.message : 'Error al generar el diagrama Excalidraw.');
        }
      } finally {
        if (isMounted.current) setIsLoading(false);
      }
    };

    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.id, artifact.content, viewMode, mermaidCode]);

  const openExternal = useCallback(() => {
    if (excalidrawData && excalidrawData.elements.length > 0) {
      const fileData = {
        type: 'excalidraw',
        version: 2,
        source: 'arkypro',
        elements: excalidrawData.elements,
        appState: { viewBackgroundColor: '#ffffff', gridSize: null },
        files: {},
      };
      const blob = new Blob([JSON.stringify(fileData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${artifact.name ?? 'diagram'}.excalidraw`;
      a.click();
      URL.revokeObjectURL(url);
    }
    window.open('https://excalidraw.com', '_blank');
  }, [excalidrawData, artifact.name]);

  const retry = useCallback(() => {
    cache.current.delete(artifact.id);
    setExcalidrawData(null);
    setError(null);
    setViewMode('excalidraw');
  }, [artifact.id, setViewMode]);

  return { excalidrawData, isLoading, error, openExternal, retry };
};
