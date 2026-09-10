import React from 'react';
import { ExclamationTriangleIcon } from '../Icons';

interface ViewerCrashFallbackProps {
  title: string;
  error: Error;
  onReset: () => void;
  onSwitchToDocument?: () => void;
  /** Optional contextual label so the user knows which viewer failed. */
  viewerLabel?: string;
}

/**
 * Inline fallback for per-viewer ErrorBoundary. Keeps the surrounding canvas
 * (toolbar, document tab, version history, export modal) usable when a
 * single viewer (ReactFlow / Excalidraw / Lucidchart) crashes during render.
 *
 * Extracted from the inline ArtifactCanvas implementation so the same shell
 * is reused by `DiagramView`, `DocumentView`, `ExcalidrawViewer` and the
 * Phase 4 workspace surfaces.
 */
export const ViewerCrashFallback: React.FC<ViewerCrashFallbackProps> = ({
  title,
  error,
  onReset,
  onSwitchToDocument,
  viewerLabel,
}) => (
  <div
    role="alert"
    className="absolute inset-0 z-30 flex items-center justify-center p-6 bg-white/95 dark:bg-gray-950/95 backdrop-blur-sm"
  >
    <div className="max-w-md w-full rounded-2xl border border-red-200 dark:border-red-900/50 bg-white dark:bg-gray-900 shadow-pop p-5 text-center">
      <div className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300 mb-3">
        <ExclamationTriangleIcon className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
      {viewerLabel && (
        <p className="mt-1 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Vista afectada: {viewerLabel}
        </p>
      )}
      <p className="mt-2 text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
        Capturamos el error para que el resto del artefacto siga siendo usable. Puedes reintentar el
        renderizado o cambiar a la vista de documento.
      </p>
      <details className="mt-3 text-left bg-gray-50 dark:bg-gray-950/50 rounded-md p-2 border border-gray-200 dark:border-gray-800">
        <summary className="cursor-pointer text-[11px] font-medium text-gray-500 dark:text-gray-400">
          Detalles técnicos
        </summary>
        <pre className="mt-2 text-[10px] text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words max-h-24 overflow-auto custom-scrollbar">
          {error.message}
        </pre>
      </details>
      <div className="mt-4 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center justify-center h-9 px-3 rounded-md text-xs font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors"
        >
          Reintentar render
        </button>
        {onSwitchToDocument && (
          <button
            type="button"
            onClick={onSwitchToDocument}
            className="inline-flex items-center justify-center h-9 px-3 rounded-md text-xs font-medium border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Ver como documento
          </button>
        )}
      </div>
    </div>
  </div>
);

export default ViewerCrashFallback;
