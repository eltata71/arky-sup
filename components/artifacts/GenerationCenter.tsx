import { useEffect, useState } from 'react';
import { useGenerationQueue } from '../../hooks/artifacts/useGenerationQueue';
import { GENERATION_PHASE_COPY } from '../../lib/artifacts/generationPhaseCopy';

export function GenerationCenter() {
  const { jobs, panelOpen, setPanelOpen, cancel, retry, open } = useGenerationQueue();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!jobs.some(job => job.status === 'running')) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [jobs]);
  if (!panelOpen) return <button type="button" onClick={() => setPanelOpen(true)} aria-label="Abrir centro de generaciones" className="fixed bottom-20 right-3 z-40 rounded-full bg-primary-600 px-4 py-3 text-sm font-semibold text-white shadow-lg md:hidden">✦ {jobs.filter(job => job.status === 'running' || job.status === 'queued').length}</button>;
  return (
    <aside aria-label="Centro de generaciones" className="fixed bottom-16 right-3 top-3 z-[90] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 md:bottom-3">
      <header className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
        <div><h2 className="font-semibold">Generaciones</h2><p className="text-xs text-gray-500">Puedes seguir trabajando mientras se preparan.</p></div>
        <button type="button" aria-label="Cerrar centro de generaciones" onClick={() => setPanelOpen(false)} className="rounded-lg px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800">Cerrar</button>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-4" role="list">
        {jobs.length === 0 && <p className="text-sm text-gray-500">Aún no hay generaciones.</p>}
        {jobs.map(job => {
          const phase = job.phase && job.phase in GENERATION_PHASE_COPY
            ? GENERATION_PHASE_COPY[job.phase as keyof typeof GENERATION_PHASE_COPY].label : job.phase;
          return <article key={job.id} role="listitem" className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <div className="flex justify-between gap-2"><h3 className="min-w-0 truncate text-sm font-semibold">{job.artifactName}</h3><span className="text-xs text-gray-500">{job.status === 'queued' ? 'En cola' : job.status === 'running' ? 'En curso' : job.status === 'done' ? 'Listo' : job.status === 'failed' ? 'Falló' : 'Cancelado'}</span></div>
            {job.status === 'running' && <p data-generation-phase={job.phase} role="status" className="mt-2 text-sm text-primary-700 dark:text-primary-300">{phase} · {Math.floor((now - (job.startedAt ?? now)) / 1000)} s</p>}
            {job.status === 'running' && job.partial && <pre data-generation-partial aria-label="Vista previa en curso" className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-2 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">{job.partial.slice(-1200)}<span aria-hidden="true" className="motion-safe:animate-pulse">▍</span></pre>}
            {job.failure && <div className="mt-2 text-sm text-rose-700 dark:text-rose-300"><p>{job.failure.headline}: {job.failure.message}</p><details className="mt-1"><summary>Detalle técnico</summary><pre className="whitespace-pre-wrap break-words text-xs">{job.failure.detail}</pre></details></div>}
            <div className="mt-3 flex gap-2 text-sm">
              {(job.status === 'queued' || job.status === 'running') && <button type="button" onClick={() => cancel(job.id)} className="rounded-lg border px-3 py-1">Cancelar</button>}
              {job.status === 'done' && <button type="button" onClick={() => open(job)} className="rounded-lg bg-primary-600 px-3 py-1 font-medium text-white">Abrir</button>}
              {job.status === 'failed' && job.failure?.retryable && <button type="button" onClick={() => retry(job.id)} className="rounded-lg bg-primary-600 px-3 py-1 font-medium text-white">Reintentar</button>}
            </div>
          </article>;
        })}
      </div>
    </aside>
  );
}
