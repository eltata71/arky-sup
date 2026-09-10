import React from 'react';
import { CheckCircleIcon, Square2StackIcon } from '../../Icons';
import type { GenerationObservabilityAlert } from '../../artifactCanvasObservability';

export interface ObservabilityBannerProps {
  alert: GenerationObservabilityAlert | null;
  diagnosticReport?: string | null;
  diagnosticCopied: boolean;
  onCopyDiagnosticReport: () => void;
  onOpenTracePanel: () => void;
}

/**
 * Floating diagnostic banner shown above the canvas while a diagram view is
 * active. Surfaces the observability tone (rose/amber/blue) and gives the
 * user one-click recovery to the trace panel and the technical clipboard
 * report.
 */
export const ObservabilityBanner: React.FC<ObservabilityBannerProps> = ({
  alert,
  diagnosticReport,
  diagnosticCopied,
  onCopyDiagnosticReport,
  onOpenTracePanel,
}) => {
  if (!alert) return null;
  const toneClass = alert.tone === 'rose'
    ? 'border-rose-300/70 bg-rose-50/95 text-rose-900 dark:border-rose-800 dark:bg-rose-950/90 dark:text-rose-100'
    : alert.tone === 'amber'
      ? 'border-amber-300/70 bg-amber-50/95 text-amber-900 dark:border-amber-800 dark:bg-amber-950/90 dark:text-amber-100'
      : 'border-blue-300/70 bg-blue-50/95 text-blue-900 dark:border-blue-800 dark:bg-blue-950/90 dark:text-blue-100';

  return (
    <div
      className={`absolute left-4 right-4 top-16 z-30 max-w-2xl rounded-2xl border px-4 py-3 shadow-xl backdrop-blur-md md:left-auto md:right-4 md:w-[28rem] ${toneClass}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{alert.title}</p>
          <p className="mt-1 text-xs leading-relaxed">{alert.body}</p>
          {alert.detail && (
            <p className="mt-1 text-[11px] font-mono opacity-90">{alert.detail}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenTracePanel}
          className="shrink-0 rounded-lg bg-white/80 px-2.5 py-1.5 text-[11px] font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-white dark:bg-gray-900/80 dark:text-white dark:ring-white/10"
        >
          Ver traza
        </button>
      </div>
      {diagnosticReport && (
        <button
          type="button"
          onClick={onCopyDiagnosticReport}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white/70 px-2.5 py-1.5 text-[11px] font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-white dark:bg-gray-900/70 dark:text-white dark:ring-white/10"
        >
          {diagnosticCopied
            ? <CheckCircleIcon className="h-3.5 w-3.5" />
            : <Square2StackIcon className="h-3.5 w-3.5" />}
          {diagnosticCopied ? 'Reporte copiado' : 'Copiar reporte técnico'}
        </button>
      )}
    </div>
  );
};

export default ObservabilityBanner;
