import React from 'react';
import { ErrorBoundary } from '../../ErrorBoundary';
import ViewerCrashFallback from '../ViewerCrashFallback';
import ExcalidrawViewer from '../../ExcalidrawViewer';

export interface ExcalidrawArtifactViewProps {
  elements: unknown[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenExternal: () => void;
  /** Switches the canvas to the document view when the viewer crashes. */
  onSwitchToDocument: () => void;
}

/**
 * Excalidraw artifact view. Wraps `ExcalidrawViewer` in a dedicated
 * ErrorBoundary so a render crash inside the lazy-loaded Excalidraw bundle
 * keeps the rest of the canvas usable.
 */
export const ExcalidrawArtifactView: React.FC<ExcalidrawArtifactViewProps> = ({
  elements,
  isLoading,
  error,
  onRetry,
  onOpenExternal,
  onSwitchToDocument,
}) => (
  <ErrorBoundary
    fallback={(boundaryError, reset) => (
      <ViewerCrashFallback
        title="Excalidraw falló al renderizar"
        viewerLabel="Excalidraw"
        error={boundaryError}
        onReset={reset}
        onSwitchToDocument={() => {
          reset();
          onSwitchToDocument();
        }}
      />
    )}
  >
    <ExcalidrawViewer
      elements={elements}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      onOpenExternal={onOpenExternal}
    />
  </ErrorBoundary>
);

export default ExcalidrawArtifactView;
