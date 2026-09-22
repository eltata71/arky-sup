import React from 'react';
import type { Node, Edge } from 'reactflow';
// Vite loads this package CSS with the lazy Workspace chunk, before the canvas renders.
import 'reactflow/dist/style.css';
import { CanvasErrorBoundary } from '../../diagram/CanvasErrorBoundaries';
import ViewerCrashFallback from '../ViewerCrashFallback';
import DiagramErrorPanel from './DiagramErrorPanel';
import { DiagramSkeleton } from './DiagramSkeleton';
import ReactFlowCanvas, { type ReactFlowCanvasHandle } from '../../ReactFlowCanvas';
import {
  CheckCircleIcon,
  Square2StackIcon,
} from '../../Icons';
import type { Artifact } from '../../../lib/artifacts';
import type { DiagramAudience } from '../../../lib/diagram';
import type { RenderableDiagramResolution } from '../../../services/diagram/resolveRenderableDiagram';
import type { DiagramFlowData } from './diagramFlow';
import type { LayoutPlan } from '../../../lib/layoutSelector';

export interface DiagramViewProps {
  artifact: Artifact;
  renderable: RenderableDiagramResolution;
  audience: DiagramAudience;
  isFullscreen: boolean;
  /** Whether the React Flow minimap is shown — off by default, host-controlled. */
  showMiniMap: boolean;
  isLoading: boolean;
  loadingMessage: string;
  diagramError: string | null;
  displayFlowNodes: Node[];
  displayFlowEdges: Edge[];
  displayedFlowSource: string;
  renderableSignature: string;
  mermaidCode: string | null;
  renderDiagnosticsSummary: string | null;
  diagnosticCopied: boolean;
  onCopyDiagnosticReport: () => void;
  reactFlowRef: React.Ref<ReactFlowCanvasHandle>;
  onCanvasChange: (flow: DiagramFlowData) => void;
  onCancelLoading: () => void;
  onAutoFix: () => void;
  /** Full diagram retry: clears caches and re-runs the render pipeline. */
  onRetryDiagram: () => void;
  /** Switches the canvas to the document view. */
  onViewText: () => void;
  /** Clears the cached flow data after a ReactFlow render crash. */
  onResetCanvas: () => void;
  /**
   * Layout plan resolved asynchronously by `useDiagramRendering`. When the
   * ELK pass has produced positions, the canvas is asked to preserve them
   * instead of re-running its internal Dagre layout.
   */
  layoutPlan?: LayoutPlan | null;
  /** True iff the externally-supplied node positions came from a real layout pass. */
  hasExternalPositions?: boolean;
  /**
   * Gap 4 — receives the materialised node/group rectangles whenever the
   * canvas settles so the host can compute real-position layout quality.
   * Forwards the extended snapshot (viewport, floating obstacles, edge
   * segments) so the host can run the full layout-aware quality + preflight.
   */
  onLayoutQualityComputed?: (snapshot: {
    nodeRects: Array<{ id: string; x: number; y: number; width: number; height: number }>;
    groupRects: Array<{ id: string; label: string; x: number; y: number; width: number; height: number; memberIds?: string[] }>;
    boundingBox: { x: number; y: number; width: number; height: number };
    viewport?: { x: number; y: number; width: number; height: number };
    floatingObstacles?: Array<{ x: number; y: number; width: number; height: number; label?: string }>;
    edgeSegments?: Array<{ id: string; source: string; target: string; waypoints: Array<{ x: number; y: number }> }>;
    smartViewport?: {
      readable: boolean;
      showExploreHint: boolean;
      showViewAllSecondary: boolean;
      reason?: 'ok' | 'zoom-too-low' | 'node-too-small' | 'label-too-small';
    };
    canvasState?: {
      visibleViewport: { minX: number; minY: number; maxX: number; maxY: number };
      contentBounds: { minX: number; minY: number; maxX: number; maxY: number };
      logicalCanvasBounds: { minX: number; minY: number; maxX: number; maxY: number };
      safeInteractionBounds: { minX: number; minY: number; maxX: number; maxY: number };
      exportBounds: { minX: number; minY: number; maxX: number; maxY: number };
    };
    layoutPlan: LayoutPlan | null | undefined;
  }) => void;
}

/**
 * Diagram view: the interactive ReactFlow surface plus every recovery state
 * (loading skeleton, invalid-diagram panel, empty-diagram panel, render
 * diagnostics). Self-contained — guarantees the canvas is never blank without
 * an actionable diagnostic, and isolates ReactFlow crashes in an
 * ErrorBoundary.
 */
export const DiagramView: React.FC<DiagramViewProps> = ({
  artifact,
  renderable,
  audience,
  isFullscreen,
  showMiniMap,
  isLoading,
  loadingMessage,
  diagramError,
  displayFlowNodes,
  displayFlowEdges,
  displayedFlowSource,
  renderableSignature,
  mermaidCode,
  renderDiagnosticsSummary,
  diagnosticCopied,
  onCopyDiagnosticReport,
  reactFlowRef,
  onCanvasChange,
  onCancelLoading,
  onAutoFix,
  onRetryDiagram,
  onViewText,
  onResetCanvas,
  layoutPlan = null,
  hasExternalPositions = false,
  onLayoutQualityComputed,
}) => {
  const hasDisplayFlowNodes = displayFlowNodes.length > 0;
  const hasDisplayFlowEdges = displayFlowEdges.length > 0;
  const showSkeletonBadge =
    (artifact.ir?.metadata?.fallback === 'skeleton' || renderable.ir?.metadata?.fallback === 'skeleton')
    && !isLoading;

  return (
    <div className={`${isFullscreen ? 'fixed inset-0 z-50' : 'flex-1 relative min-h-0'} bg-gray-100 dark:bg-gray-900 flex flex-col h-full w-full animate-fade-in`}>
      {isLoading && (
        <DiagramSkeleton
          onCancel={onCancelLoading}
          message={loadingMessage || 'Preparando vista interactiva...'}
          detail={renderDiagnosticsSummary ?? `Artefacto ${artifact.type}; contenido ${artifact.content.length} caracteres; fuente ${renderable.source}; nodos detectados ${renderable.counters.renderNodes}.`}
        />
      )}

      {diagramError && !hasDisplayFlowNodes && (
        <DiagramErrorPanel
          title="Error al visualizar"
          body={diagramError}
          mermaidSource={mermaidCode}
          onRetry={onRetryDiagram}
          onViewText={onViewText}
          onAutoFix={onAutoFix}
        />
      )}

      {/*
        Mount the canvas as soon as the render pipeline has produced
        renderable content. Either the legacy in-effect Mermaid re-parse or
        the canonical `resolveRenderableDiagram` (IR-driven) path can supply
        the nodes; mounting on the union prevents the "blank dark canvas"
        regression when one pipeline degrades but the other is healthy.
      */}
      {hasDisplayFlowNodes && !isLoading && (
        <CanvasErrorBoundary panelName="Canvas"
          fallback={(error, reset) => (
            <ViewerCrashFallback
              title="El canvas interactivo falló al renderizar"
              viewerLabel="Diagrama"
              error={error}
              onReset={() => {
                onResetCanvas();
                reset();
              }}
              onSwitchToDocument={() => {
                reset();
                onViewText();
              }}
            />
          )}
        >
          <ReactFlowCanvas
            key={`${artifact.id}-${audience}-${artifact.theme ?? 'editorial'}-${displayedFlowSource}-${renderableSignature}`}
            nodes={displayFlowNodes}
            edges={displayFlowEdges}
            theme={artifact.theme ?? 'editorial'}
            density={audience === 'executive' ? 'compact' : 'standard'}
            onChange={onCanvasChange}
            ref={reactFlowRef}
            presentation={{ ir: renderable.ir ?? undefined }}
            showMiniMap={showMiniMap}
            preserveExternalLayout={hasExternalPositions}
            externalLayoutPlan={layoutPlan ?? renderable.ir?.metadata?.layoutPlan ?? null}
            onLayoutQualityComputed={(snapshot) => onLayoutQualityComputed?.({ ...snapshot, layoutPlan: layoutPlan ?? null })}
          />
        </CanvasErrorBoundary>
      )}

      {showSkeletonBadge && (
        <div className="absolute right-4 top-4 z-20 max-w-sm rounded-xl border border-amber-400/60 bg-amber-50/95 px-3 py-2 text-xs text-amber-900 shadow-lg backdrop-blur-sm dark:border-amber-700 dark:bg-amber-950/85 dark:text-amber-100">
          <p className="font-semibold">Esqueleto base — edítame</p>
          <p className="mt-1 leading-snug">El generador agotó los reintentos automáticos y se construyó una estructura mínima local. Edita los nodos o pulsa Regenerar con más contexto del proyecto.</p>
        </div>
      )}

      {artifact.lastDiagramError && hasDisplayFlowNodes && !isLoading && (
        <div className="absolute left-4 top-4 z-20 max-w-md rounded-xl border border-rose-400/40 bg-rose-50/95 px-3 py-2 text-xs text-rose-900 shadow-lg backdrop-blur-sm dark:border-rose-800 dark:bg-rose-950/85 dark:text-rose-100">
          <p className="font-semibold">Última generación falló</p>
          <p className="mt-1 leading-snug">
            Motivo técnico: <span className="font-mono">{artifact.lastDiagramError.reason}</span>
            {artifact.lastDiagramError.attempt > 1 ? ` (tras ${artifact.lastDiagramError.attempt} intentos)` : ''}.
            {artifact.lastDiagramError.message ? ` ${artifact.lastDiagramError.message}` : ''}
          </p>
        </div>
      )}

      {!isLoading && !diagramError && !hasDisplayFlowNodes && (
        <DiagramErrorPanel
          title="Diagrama sin elementos visibles"
          body={`No hay nodos visibles para renderizar en esta vista.\nNodos base: ${renderable.counters.baseNodes}, nodos proyectados: ${renderable.counters.projectedNodes}, nodos visibles: ${renderable.counters.renderNodes}, aristas visibles: ${hasDisplayFlowEdges ? displayFlowEdges.length : 0}.${renderDiagnosticsSummary ? `\n${renderDiagnosticsSummary}` : ''}\n\nEsto suele ocurrir cuando la IA devolvió contenido incompleto o cuando el parseo dejó el diagrama sin estructura mínima.`}
          mermaidSource={mermaidCode}
          onRetry={onRetryDiagram}
          onViewText={onViewText}
          onAutoFix={onAutoFix}
        />
      )}

      {!isLoading && (renderable.diagnostics.length > 0 || renderable.warnings.length > 0) && (
        <div className="absolute left-4 bottom-4 z-20 max-w-xl rounded-xl border border-amber-400/40 bg-amber-50/95 dark:bg-amber-950/80 dark:border-amber-800 px-3 py-2 text-xs text-amber-900 dark:text-amber-100 shadow-lg backdrop-blur-sm">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="font-semibold">Diagnóstico de renderizado</p>
            <button
              type="button"
              onClick={onCopyDiagnosticReport}
              className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 px-2 py-1 text-[11px] font-medium hover:bg-amber-100/80 dark:hover:bg-amber-900/40"
            >
              {diagnosticCopied ? <CheckCircleIcon className="h-3.5 w-3.5" /> : <Square2StackIcon className="h-3.5 w-3.5" />}
              {diagnosticCopied ? 'Copiado' : 'Copiar reporte'}
            </button>
          </div>
          {renderable.diagnostics.slice(0, 2).map((diag, idx) => (
            <p key={`${diag.stage}-${idx}`} className="leading-snug">
              <span className="font-medium">{diag.stage}:</span> {diag.message}{diag.detail ? ` (${diag.detail})` : ''}
            </p>
          ))}
          {renderable.warnings.slice(0, 2).map((warning, idx) => (
            <p key={`warn-${idx}`} className="leading-snug">• {warning}</p>
          ))}
          {renderable.repairActions.length > 0 && (
            <p className="mt-1 leading-snug text-amber-800 dark:text-amber-200">
              Siguiente paso sugerido: {renderable.repairActions[0]}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default DiagramView;
