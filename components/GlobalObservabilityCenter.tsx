import React, { useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clipboard, ShieldCheck, X } from 'lucide-react';
import { useObservability } from '../context/ObservabilityContext';
import type { ObservabilityEvent, ObservabilitySeverity } from '../services/observability';
import type { Project } from '../types';
import { evaluateOfficeQualityGates, OFFICE_GATE_LABELS } from '../services/architectureOffice/officeQualityGates';

interface GlobalObservabilityCenterProps {
  project?: Project;
}


const severityStyles: Record<ObservabilitySeverity, { dot: string; label: string; text: string }> = {
  critical: { dot: 'bg-rose-500', label: 'Crítico', text: 'text-rose-700 dark:text-rose-300' },
  error: { dot: 'bg-red-500', label: 'Error', text: 'text-red-700 dark:text-red-300' },
  warning: { dot: 'bg-amber-500', label: 'Aviso', text: 'text-amber-700 dark:text-amber-300' },
  success: { dot: 'bg-emerald-500', label: 'Correcto', text: 'text-emerald-700 dark:text-emerald-300' },
  info: { dot: 'bg-blue-500', label: 'Info', text: 'text-blue-700 dark:text-blue-300' },
};

const formatTime = (iso: string): string => {
  try {
    return new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso));
  } catch {
    return iso;
  }
};

const buildDiagnostics = (events: ObservabilityEvent[]): string => events.map((event) => [
  `[${event.at}] ${event.severity.toUpperCase()} ${event.source}.${event.status}`,
  `title=${event.title}`,
  `message=${event.message}`,
  event.route ? `route=${event.route}` : undefined,
  event.operationName ? `operation=${event.operationName}` : undefined,
  event.detail ? `detail=${event.detail}` : undefined,
].filter((line): line is string => Boolean(line)).join('\n')).join('\n\n');

export const GlobalObservabilityCenter: React.FC<GlobalObservabilityCenterProps> = ({ project }) => {
  const { events, summary, clear } = useObservability();
  const [open, setOpen] = useState(false);
  const latestVisibleEvents = useMemo(() => events.filter((event) => event.userVisible).slice(0, 12), [events]);
  const lastEvent = summary.lastEvent;
  const officeAssessment = useMemo(
    () => project ? evaluateOfficeQualityGates(project) : null,
    [project],
  );

  const statusConfig = summary.systemStatus === 'critical'
    ? { Icon: AlertTriangle, label: 'Atención crítica', classes: 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/80 dark:text-rose-100' }
    : summary.systemStatus === 'attention'
      ? { Icon: AlertTriangle, label: 'Revisar eventos', classes: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/80 dark:text-amber-100' }
      : { Icon: ShieldCheck, label: 'Sistema estable', classes: 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-900/70 dark:bg-emerald-950/80 dark:text-emerald-100' };
  const StatusIcon = statusConfig.Icon;

  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(buildDiagnostics(events.slice(0, 30)));
    } catch (error) {
      console.warn('[GlobalObservabilityCenter] diagnostics copy failed', error);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed bottom-20 right-4 z-[180] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-pop backdrop-blur transition hover:scale-[1.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:bottom-4 ${statusConfig.classes}`}
        aria-label="Abrir centro de monitoreo global"
      >
        <StatusIcon className="h-4 w-4" />
        <span>{statusConfig.label}</span>
        <span className="rounded-full bg-black/10 px-1.5 py-0.5 dark:bg-white/10">{summary.total}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[450] flex justify-end bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="observability-title">
          <aside className="flex h-full w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950">
            <header className="border-b border-gray-200 p-4 dark:border-gray-800">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-600 dark:text-primary-300">Observabilidad global</p>
                  <h2 id="observability-title" className="mt-1 text-lg font-bold text-gray-900 dark:text-white">Estado operativo de Arky</h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Monitoreo general de render, ejecución, red, recursos y operaciones. No depende de un artefacto específico.</p>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-900 dark:hover:text-white" aria-label="Cerrar monitoreo">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </header>

            <section className="grid grid-cols-3 gap-2 border-b border-gray-200 p-4 dark:border-gray-800">
              <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/40">
                <p className="text-2xs font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">OK</p>
                <p className="mt-1 text-xl font-bold text-emerald-900 dark:text-emerald-100">{summary.successes}</p>
              </div>
              <div className="rounded-xl bg-amber-50 p-3 dark:bg-amber-950/40">
                <p className="text-2xs font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-300">Avisos</p>
                <p className="mt-1 text-xl font-bold text-amber-900 dark:text-amber-100">{summary.warnings}</p>
              </div>
              <div className="rounded-xl bg-rose-50 p-3 dark:bg-rose-950/40">
                <p className="text-2xs font-semibold uppercase tracking-widest text-rose-700 dark:text-rose-300">Errores</p>
                <p className="mt-1 text-xl font-bold text-rose-900 dark:text-rose-100">{summary.activeIssues}</p>
              </div>
            </section>

            {lastEvent && (
              <section className="border-b border-gray-200 p-4 dark:border-gray-800">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                  <Activity className="h-4 w-4 text-primary-500" />
                  Último evento observado
                </div>
                <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{lastEvent.title}: {lastEvent.message}</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">{formatTime(lastEvent.at)} · {lastEvent.source}</p>
              </section>
            )}

            {officeAssessment && (
              <section className="border-b border-gray-200 p-4 dark:border-gray-800" aria-labelledby="office-quality-gates-title">
                <div className="flex items-center justify-between gap-3">
                  <h3 id="office-quality-gates-title" className="text-sm font-semibold text-gray-900 dark:text-white">
                    Quality gates del proyecto
                  </h3>
                  <span className={`rounded-full px-2 py-1 text-2xs font-bold ${
                    officeAssessment.overallStatus === 'pass'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                      : officeAssessment.overallStatus === 'conditional'
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                        : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
                  }`}>
                    {officeAssessment.overallStatus.toUpperCase()}
                  </span>
                </div>
                <ul className="mt-3 space-y-2" aria-label="Quality gates de la Oficina de Arquitectura">
                  {officeAssessment.gates.map((gate) => (
                    <li key={gate.id} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-gray-700 dark:text-gray-300">{OFFICE_GATE_LABELS[gate.id]}</span>
                      <span className={`font-bold ${
                        gate.status === 'pass'
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : gate.status === 'conditional'
                            ? 'text-amber-700 dark:text-amber-300'
                            : 'text-rose-700 dark:text-rose-300'
                      }`}>
                        {gate.status.toUpperCase()}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="min-h-0 flex-1 overflow-auto p-4">
              {latestVisibleEvents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-300 p-6 text-center dark:border-gray-700">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
                  <p className="mt-2 text-sm font-semibold text-gray-900 dark:text-white">Sin incidentes visibles</p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Cuando algo ocurra, aparecerá aquí con trazabilidad.</p>
                </div>
              ) : (
                <ol className="space-y-3">
                  {latestVisibleEvents.map((event) => {
                    const style = severityStyles[event.severity];
                    return (
                      <li key={event.id} className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/70">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`inline-flex items-center gap-2 text-xs font-semibold ${style.text}`}>
                            <span className={`h-2 w-2 rounded-full ${style.dot}`} aria-hidden />
                            {style.label} · {event.source}
                          </span>
                          <span className="text-2xs text-gray-500">{formatTime(event.at)}</span>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-gray-900 dark:text-white">{event.title}</p>
                        <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-400">{event.message}</p>
                        {event.detail && (
                          <details className="mt-2 rounded-lg bg-white p-2 dark:bg-gray-950">
                            <summary className="cursor-pointer text-2xs font-semibold uppercase tracking-widest text-gray-500">Detalle</summary>
                            <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words text-[11px] text-gray-600 dark:text-gray-300">{event.detail}</pre>
                          </details>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>

            <footer className="flex flex-wrap justify-end gap-2 border-t border-gray-200 p-4 dark:border-gray-800">
              <button type="button" onClick={clear} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900">Limpiar</button>
              <button type="button" onClick={copyDiagnostics} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700">
                <Clipboard className="h-4 w-4" />
                Copiar diagnóstico
              </button>
            </footer>
          </aside>
        </div>
      )}
    </>
  );
};
