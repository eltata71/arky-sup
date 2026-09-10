import React from 'react';
import { ErrorBoundary } from '../ErrorBoundary';

interface BoundaryProps {
  children: React.ReactNode;
  panelName: string;
  /**
   * Replace the default panel.
   *
   * `DiagramView` has been passing this all along and it was never declared,
   * so the caller's `ViewerCrashFallback` was discarded and the generic panel
   * rendered in its place. Nothing failed — the wrong fallback simply appeared,
   * which is the sort of thing only a crash reveals.
   */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

const FallbackPanel: React.FC<{ panelName: string; error: Error; onRetry: () => void }> = ({ panelName, error, onRetry }) => {
  const copy = async () => {
    const payload = `[${panelName}] ${error.name}: ${error.message}`;
    try { await navigator.clipboard.writeText(payload); } catch { /* noop */ }
  };
  return (
    <div className="rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-4 text-sm">
      <p className="font-semibold text-amber-900 dark:text-amber-100">No se pudo renderizar este panel</p>
      <p className="mt-1 text-amber-800 dark:text-amber-200">Panel: {panelName}. La sesión se mantiene activa.</p>
      <div className="mt-3 flex gap-2">
        <button className="px-3 py-1.5 rounded-md bg-amber-600 text-white" onClick={onRetry}>Reintentar render</button>
        <button className="px-3 py-1.5 rounded-md border border-amber-400 text-amber-900 dark:text-amber-100" onClick={() => { void copy(); }}>Copiar diagnóstico</button>
      </div>
    </div>
  );
};

export const CanvasErrorBoundary: React.FC<BoundaryProps> = ({ children, panelName, fallback }) => (
  <ErrorBoundary
    fallbackTitle={`Error en ${panelName}`}
    fallback={fallback ?? ((error, reset) => <FallbackPanel panelName={panelName} error={error} onRetry={reset} />)}
  >
    {children}
  </ErrorBoundary>
);

export const InspectorErrorBoundary: React.FC<BoundaryProps> = ({ children, panelName = 'Inspector' }) => (
  <CanvasErrorBoundary panelName={panelName}>{children}</CanvasErrorBoundary>
);

export const ExportErrorBoundary: React.FC<BoundaryProps> = ({ children, panelName = 'Exportación' }) => (
  <CanvasErrorBoundary panelName={panelName}>{children}</CanvasErrorBoundary>
);

export const PresentationErrorBoundary: React.FC<BoundaryProps> = ({ children, panelName = 'Presentación' }) => (
  <CanvasErrorBoundary panelName={panelName}>{children}</CanvasErrorBoundary>
);
