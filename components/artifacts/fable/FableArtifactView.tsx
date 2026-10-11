import { useUiTranslation } from '../../../lib/i18n/UiTranslationContext';
import React from 'react';
import { ErrorBoundary } from '../../ErrorBoundary';
import ViewerCrashFallback from '../ViewerCrashFallback';
import { FableDiagramCanvas } from './FableDiagramCanvas';
import type { DiagramAudience, DiagramIR } from '../../../lib/diagram';

export interface FableArtifactViewProps {
  ir: DiagramIR | null;
  artifactName: string;
  audience: DiagramAudience;
  isLoading: boolean;
  onRetry: () => void;
  /** Switches the canvas to the document view when the viewer crashes. */
  onSwitchToDocument: () => void;
}

/**
 * "Vista Fable" — premium diagram visualization authored with Anthropic's
 * design capability (Claude Fable). Renders the canonical DiagramIR with a
 * cinematic, interactive design; fully deterministic at runtime (no AI
 * calls). Wrapped in its own ErrorBoundary so a render crash keeps the rest
 * of the canvas usable, mirroring the Excalidraw/Lucidchart views.
 */
export const FableArtifactView: React.FC<FableArtifactViewProps> = ({
  ir,
  artifactName,
  audience,
  isLoading,
  onRetry,
  onSwitchToDocument,
}) => {
  const t = useUiTranslation();
  const hasRenderableIR = Boolean(ir && ir.nodes.length > 0);

  return (
    <ErrorBoundary
      fallback={(boundaryError, reset) => (
        <ViewerCrashFallback
          title={t("ui.la-vista-fable-fallo-al-rend.5ea0fa")}
          viewerLabel={t("Vista Fable")}
          error={boundaryError}
          onReset={reset}
          onSwitchToDocument={() => {
            reset();
            onSwitchToDocument();
          }}
        />
      )}
    >
      {hasRenderableIR ? (
        <FableDiagramCanvas ir={ir!} artifactName={artifactName} audience={audience} />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gray-50 p-8 text-center dark:bg-gray-950">
          {isLoading ? (
            <>
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" aria-hidden />
              <p className="text-sm text-gray-600 dark:text-gray-300">{t("ui.preparando-la-vista-fable.8cca97")}</p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("ui.este-artefacto-aun-no-tiene.1d9c6f")}
              </p>
              <p className="max-w-sm text-xs text-gray-500 dark:text-gray-400">
                {t("ui.la-vista-fable-necesita-la-r.112cd4")}
              </p>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white hover:bg-primary-700"
                >
                  {t("ui.reintentar-diagrama.a9bc84")}
                </button>
                <button
                  type="button"
                  onClick={onSwitchToDocument}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  {t("ui.ver-documento.42bef3")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </ErrorBoundary>
  );
};

export default FableArtifactView;
