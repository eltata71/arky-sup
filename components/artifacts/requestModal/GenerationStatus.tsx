import React from 'react';
import type { ArtifactGenerationPhaseEvent } from '../../../lib/artifacts';
import { GENERATION_PHASE_COPY, GENERATION_STATUS_COPY } from '../../../lib/artifacts/generationPhaseCopy';
import { CheckCircleIcon, Square2StackIcon } from '../../Icons';
import { CollapsibleSection } from '../wizard';

const STATUS_STYLE: Record<string, { dot: string; chip: string; ring: string }> = {
  'in-progress': {
    dot: 'bg-blue-500 animate-pulse',
    chip: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
    ring: 'ring-blue-300/60 dark:ring-blue-800/60',
  },
  success: {
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    ring: 'ring-emerald-300/60 dark:ring-emerald-800/60',
  },
  warning: {
    dot: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
    ring: 'ring-amber-300/60 dark:ring-amber-800/60',
  },
  error: {
    dot: 'bg-rose-500',
    chip: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
    ring: 'ring-rose-300/60 dark:ring-rose-800/60',
  },
  skipped: {
    dot: 'bg-gray-300 dark:bg-gray-600',
    chip: 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300',
    ring: 'ring-gray-300/60 dark:ring-gray-700/60',
  },
};

export const formatDuration = (ms?: number): string | null => {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
};

const stageStyle = (status: string) => STATUS_STYLE[status] ?? STATUS_STYLE.success;
interface StatusBannerProps {
  phase: string;
  stage?: ArtifactGenerationPhaseEvent['stage'];
  durationLabel: string | null;
  tone: 'info' | 'success' | 'error';
}

export const StatusBanner: React.FC<StatusBannerProps> = ({ phase, stage, durationLabel, tone }) => {
  const palette = tone === 'error'
    ? 'border-rose-200 bg-rose-50/80 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-100'
    : tone === 'success'
      ? 'border-emerald-200 bg-emerald-50/80 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100'
      : 'border-blue-200 bg-blue-50/80 text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200';
  return (
    <div className={`rounded-xl border p-4 text-sm ${palette}`} role="status" aria-live="polite" data-generation-phase={stage}>
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">Estado</p>
        {durationLabel && (
          <span className="text-[11px] font-medium opacity-80">{durationLabel} acumulado</span>
        )}
      </div>
      <p className="mt-1 leading-relaxed">{phase}</p>
    </div>
  );
};

interface TechnicalTimelineDisclosureProps {
  events: ArtifactGenerationPhaseEvent[];
  showTechnical: boolean;
  onToggleTechnical: () => void;
  reportCopied: boolean;
  onCopyReport: () => void;
}

export const TechnicalTimelineDisclosure: React.FC<TechnicalTimelineDisclosureProps> = ({
  events,
  showTechnical,
  onToggleTechnical,
  reportCopied,
  onCopyReport,
}) => (
  <CollapsibleSection
    label={`Mostrar trazabilidad técnica (${events.length} ${events.length === 1 ? 'evento' : 'eventos'})`}
    openLabel={`Ocultar trazabilidad técnica (${events.length} ${events.length === 1 ? 'evento' : 'eventos'})`}
    tone="subtle"
    hint="Línea de tiempo de fases, advertencias y diagnósticos para soporte y debugging."
  >
    <div className="rounded-xl border border-gray-200 bg-white/70 p-3 text-sm dark:border-gray-800 dark:bg-gray-950/40" aria-live="polite">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCopyReport}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          title="Copiar reporte técnico al portapapeles para soporte"
        >
          {reportCopied ? <CheckCircleIcon className="h-3 w-3" /> : <Square2StackIcon className="h-3 w-3" />}
          {reportCopied ? 'Reporte copiado' : 'Copiar reporte técnico'}
        </button>
        <button
          type="button"
          onClick={onToggleTechnical}
          aria-pressed={showTechnical}
          className="text-[11px] font-medium text-primary-700 hover:underline dark:text-primary-300"
        >
          {showTechnical ? 'Ocultar metadatos' : 'Ver metadatos por evento'}
        </button>
      </div>
      <ol className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
        {events.map((event, index) => {
          const styles = stageStyle(event.status);
          const copy = GENERATION_PHASE_COPY[event.stage];
          const duration = formatDuration(event.durationMs);
          return (
            <li
              key={`${event.stage}-${event.at}-${index}`}
              className={`relative rounded-lg border border-gray-100 bg-white px-3 py-2 ring-1 dark:border-gray-800 dark:bg-gray-900/70 ${styles.ring}`}
            >
              <div className="flex items-center gap-3">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${styles.dot}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-semibold text-gray-900 dark:text-white">
                      <span aria-hidden className="mr-1.5">{copy.icon}</span>
                      {copy.label}
                      <span className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${styles.chip}`}>
                        {GENERATION_STATUS_COPY[event.status]}
                      </span>
                    </p>
                    {duration && (
                      <span className="whitespace-nowrap text-[10px] text-gray-500 dark:text-gray-400">{duration}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs leading-snug text-gray-700 dark:text-gray-300">{copy.description}</p>
                  {showTechnical && event.detail && (
                    <p className="mt-0.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400">{event.detail}</p>
                  )}
                  {showTechnical && <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{event.message}</p>}
                  {showTechnical && event.meta && Object.keys(event.meta).length > 0 && (
                    <pre className="mt-1 max-h-24 overflow-auto rounded bg-gray-50 p-1.5 text-[10px] text-gray-700 dark:bg-gray-950 dark:text-gray-300">
{JSON.stringify(event.meta, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  </CollapsibleSection>
);
