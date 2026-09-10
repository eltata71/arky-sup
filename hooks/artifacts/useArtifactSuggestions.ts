import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings } from '../../types';
import {
  requestArtifactSuggestions,
  type ArtifactSuggestionContext,
  type ArtifactSuggestionReport,
} from '../../services/ai/artifactSuggestionService';

export type ArtifactSuggestionsStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UseArtifactSuggestionsInput {
  /** Resets the hook to `idle` whenever the active artifact changes. */
  artifactId: string;
  settings: Settings;
  /** Lazily builds the AI context — invoked only when a request fires. */
  buildContext: () => ArtifactSuggestionContext;
}

export interface UseArtifactSuggestionsResult {
  status: ArtifactSuggestionsStatus;
  report: ArtifactSuggestionReport | null;
  error: string | null;
  /** Triggers an analysis. Safe to call repeatedly; concurrent calls are ignored. */
  request: () => void;
  /** Returns the hook to its idle state. */
  reset: () => void;
}

/**
 * Owns the lifecycle of an artifact suggestion analysis (idle → loading →
 * success/error). Decoupled from the AI provider: it only consumes the
 * `artifactSuggestionService` abstraction and a lazy context builder.
 */
export const useArtifactSuggestions = ({
  artifactId,
  settings,
  buildContext,
}: UseArtifactSuggestionsInput): UseArtifactSuggestionsResult => {
  const [status, setStatus] = useState<ArtifactSuggestionsStatus>('idle');
  const [report, setReport] = useState<ArtifactSuggestionReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isMounted = useRef(true);
  const inFlight = useRef(false);
  const buildContextRef = useRef(buildContext);
  buildContextRef.current = buildContext;

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setReport(null);
    setError(null);
  }, []);

  // Drop stale results when the user switches artifacts.
  useEffect(() => {
    reset();
  }, [artifactId, reset]);

  const request = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus('loading');
    setError(null);

    let context: ArtifactSuggestionContext;
    try {
      context = buildContextRef.current();
    } catch (err) {
      inFlight.current = false;
      setStatus('error');
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo preparar el contexto del artefacto.',
      );
      return;
    }

    void requestArtifactSuggestions(context, settings)
      .then((next) => {
        if (!isMounted.current) return;
        setReport(next);
        setStatus('success');
      })
      .catch((err: unknown) => {
        if (!isMounted.current) return;
        setStatus('error');
        setError(
          err instanceof Error
            ? err.message
            : 'No se pudieron generar sugerencias. Reintenta en unos segundos.',
        );
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [settings]);

  return { status, report, error, request, reset };
};
