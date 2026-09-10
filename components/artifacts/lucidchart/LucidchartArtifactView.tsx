import React from 'react';
import { ErrorBoundary } from '../../ErrorBoundary';
import ViewerCrashFallback from '../ViewerCrashFallback';
import LucidchartViewer from '../../LucidchartViewer';
import type { LucidDocumentSummary } from '../../../services/lucid';
import type { Artifact } from '../../../types';
import type { DiagramFlowData } from '../diagram/diagramFlow';

export interface LucidchartArtifactViewProps {
  artifactContent: string;
  artifactRepresentation: Artifact['representation'];
  artifactTitle: string;
  flowData: DiagramFlowData | null;
  isFlowLoading: boolean;
  flowError: string | null;
  existingLucidDocumentId?: string;
  onLucidDocumentReady: (summary: LucidDocumentSummary) => void;
  onRetry: () => void;
  onOpenExternal: () => void;
  /** Switches the canvas to the document view when the viewer crashes. */
  onSwitchToDocument: () => void;
}

/**
 * Lucidchart artifact view. Wraps `LucidchartViewer` in a dedicated
 * ErrorBoundary so a render crash in the external embed keeps the rest of
 * the canvas usable.
 */
export const LucidchartArtifactView: React.FC<LucidchartArtifactViewProps> = ({
  artifactContent,
  artifactRepresentation,
  artifactTitle,
  flowData,
  isFlowLoading,
  flowError,
  existingLucidDocumentId,
  onLucidDocumentReady,
  onRetry,
  onOpenExternal,
  onSwitchToDocument,
}) => (
  <ErrorBoundary
    fallback={(boundaryError, reset) => (
      <ViewerCrashFallback
        title="Lucidchart falló al renderizar"
        viewerLabel="Lucidchart"
        error={boundaryError}
        onReset={reset}
        onSwitchToDocument={() => {
          reset();
          onSwitchToDocument();
        }}
      />
    )}
  >
    <LucidchartViewer
      artifactContent={artifactContent}
      artifactRepresentation={artifactRepresentation}
      artifactTitle={artifactTitle}
      flowData={flowData}
      isFlowLoading={isFlowLoading}
      flowError={flowError}
      existingLucidDocumentId={existingLucidDocumentId}
      onLucidDocumentReady={onLucidDocumentReady}
      onRetry={onRetry}
      onOpenExternal={onOpenExternal}
    />
  </ErrorBoundary>
);

export default LucidchartArtifactView;
