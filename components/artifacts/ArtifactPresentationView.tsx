import React, { useEffect, useMemo, useState } from 'react';
import type { ArtifactPresentationCallout, ArtifactPresentationModel } from '../../lib/artifacts/artifactPresentationModel';
import { SafeRichText } from '../ui/SafeRichText';

export interface ArtifactPresentationViewProps {
  model: ArtifactPresentationModel | null;
  errors?: string[];
  onOpenExport: () => void;
  onOpenTrace: () => void;
}

const scoreTone = (score: number): string =>
  score >= 85 ? 'text-emerald-600 dark:text-emerald-300'
    : score >= 70 ? 'text-blue-600 dark:text-blue-300'
      : score >= 50 ? 'text-amber-600 dark:text-amber-300'
        : 'text-red-600 dark:text-red-300';


const MermaidPreview: React.FC<{ code?: string; title: string }> = ({ code, title }) => {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useMemo(() => `publication-mermaid-${Math.random().toString(36).slice(2)}`, []);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);
    if (!code?.trim()) return;
    import('mermaid')
      .then((module) => {
        const mermaid = module.default;
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default' });
        return mermaid.render(id, code);
      })
      .then((result) => { if (!cancelled) setSvg(result.svg); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo renderizar Mermaid.'); });
    return () => { cancelled = true; };
  }, [code, id]);

  if (!code?.trim()) {
    return <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">No hay código Mermaid renderizable; se conserva lectura técnica.</div>;
  }
  if (svg) {
    // Sanitises Mermaid's rendered SVG; `securityLevel: 'strict'` above only
    // constrains the diagram source it was given.
    return (
        <SafeRichText
            as="div"
            className="overflow-auto rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950"
            containerProps={{ role: 'img', 'aria-label': `Diagrama ${title}` }}
            html={svg}
        />
    );
  }
  return (
    <div className="space-y-2">
      {error && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-100">Render visual no disponible: {error}. Se muestra Mermaid fuente como fallback honesto.</p>}
      <pre className="max-h-[420px] overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100"><code>{code}</code></pre>
    </div>
  );
};

const calloutTone = (type: ArtifactPresentationCallout['type']): string => {
  if (type === 'risk' || type === 'warning') return 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100';
  if (type === 'decision') return 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-100';
  if (type === 'assumption') return 'border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-100';
  if (type === 'recommendation') return 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100';
  return 'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100';
};

export const ArtifactPresentationView: React.FC<ArtifactPresentationViewProps> = ({ model, errors = [], onOpenExport, onOpenTrace }) => {
  if (!model) {
    return (
      <div className="flex-1 overflow-y-auto bg-slate-50 p-4 dark:bg-gray-950 sm:p-6">
        <div className="mx-auto max-w-4xl rounded-2xl border border-amber-200 bg-white p-6 shadow-sm dark:border-amber-900/60 dark:bg-gray-900">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-600 dark:text-amber-300">Vista publicación no disponible</p>
          <h2 className="mt-2 text-xl font-black text-gray-900 dark:text-white">La compilación no bloqueó el canvas</h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Puedes seguir usando las vistas existentes. Revisa observabilidad para ver advertencias no bloqueantes.
          </p>
          {errors.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm text-amber-700 dark:text-amber-200">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
          <button type="button" onClick={onOpenTrace} className="mt-4 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700">Ver traza</button>
        </div>
      </div>
    );
  }

  const publicationLabel = model.quality.readyForPublication ? 'Listo para publicación' : 'Requiere ajustes';
  return (
    <article className="flex-1 overflow-y-auto bg-slate-50 p-4 text-slate-900 dark:bg-gray-950 dark:text-slate-100 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-gray-900 sm:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-primary-600 dark:text-primary-300">Entregable profesional · {model.mode}</p>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950 dark:text-white sm:text-4xl">{model.title}</h1>
              {model.subtitle && <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300 sm:text-base">{model.subtitle}</p>}
            </div>
            <div className="grid min-w-[220px] grid-cols-2 gap-2 rounded-2xl bg-slate-50 p-3 dark:bg-white/5">
              <div>
                <span className="block text-[11px] uppercase text-slate-500 dark:text-slate-400">Score</span>
                <strong className={`text-2xl ${scoreTone(model.quality.score)}`}>{model.quality.score}</strong>
              </div>
              <div>
                <span className="block text-[11px] uppercase text-slate-500 dark:text-slate-400">Estado</span>
                <strong className={model.quality.readyForPublication ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}>{publicationLabel}</strong>
              </div>
              <div className="col-span-2 text-xs text-slate-500 dark:text-slate-400">Compiler {model.compilerVersion} · {new Date(model.updatedAt).toLocaleString()}</div>
            </div>
          </div>
          {model.executiveSummary && (
            <section className="mt-6 rounded-2xl bg-gradient-to-br from-primary-50 to-sky-50 p-4 dark:from-primary-950/30 dark:to-sky-950/20">
              <h2 className="text-sm font-bold uppercase tracking-wide text-primary-700 dark:text-primary-200">Resumen ejecutivo</h2>
              <p className="mt-2 text-sm leading-7 text-slate-700 dark:text-slate-200">{model.executiveSummary}</p>
            </section>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={onOpenExport} className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">Exportar</button>
            <button type="button" onClick={onOpenTrace} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5">Trazabilidad</button>
          </div>
        </header>

        {(model.quality.blockers.length > 0 || model.quality.warnings.length > 0) && (
          <section className="grid gap-3 md:grid-cols-2" aria-label="Estado de publicación">
            {model.quality.blockers.length > 0 && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100">
                <h2 className="font-bold">Bloqueadores</h2>
                <ul className="mt-2 list-disc pl-5 space-y-1">{model.quality.blockers.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
            {model.quality.warnings.length > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                <h2 className="font-bold">Advertencias accionables</h2>
                <ul className="mt-2 list-disc pl-5 space-y-1">{model.quality.warnings.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
          </section>
        )}

        {model.diagrams.map((diagram) => (
          <section key={diagram.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Diagrama · {diagram.diagramKind ?? 'generic'} {diagram.c4Level ? `· C4 ${diagram.c4Level}` : ''}</p>
                <h2 className="mt-1 text-xl font-black text-slate-950 dark:text-white">{diagram.title}</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{diagram.purpose}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${diagram.exportSafe ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'}`}>{diagram.exportSafe ? 'Export safe' : 'Revisar visual'}</span>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <MermaidPreview code={diagram.mermaid} title={diagram.title} />
              <aside className="space-y-3">
                <div className="rounded-2xl bg-slate-50 p-3 dark:bg-white/5">
                  <h3 className="text-sm font-bold">Leyenda</h3>
                  <ul className="mt-2 space-y-2 text-xs text-slate-600 dark:text-slate-300">{diagram.legend.map((item) => <li key={item.id}><strong>{item.label}:</strong> {item.meaning}</li>)}</ul>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3 dark:bg-white/5">
                  <h3 className="text-sm font-bold">Notas de lectura</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-600 dark:text-slate-300">{diagram.readingNotes.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              </aside>
            </div>
          </section>
        ))}

        {model.callouts.length > 0 && (
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {model.callouts.map((callout) => (
              <div key={callout.id} className={`rounded-2xl border p-4 ${calloutTone(callout.type)}`}>
                <p className="text-[11px] font-bold uppercase tracking-wide">{callout.type}{callout.severity ? ` · ${callout.severity}` : ''}</p>
                <h3 className="mt-1 font-bold">{callout.title}</h3>
                <p className="mt-1 text-sm leading-6">{callout.content}</p>
              </div>
            ))}
          </section>
        )}

        {model.sections.length > 0 && (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
            <h2 className="text-xl font-black">Documento compilado</h2>
            <div className="mt-4 space-y-5">
              {model.sections.map((section) => (
                <section key={section.id} className="rounded-2xl border border-slate-100 p-4 dark:border-white/10">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-primary-600 dark:text-primary-300">{section.type}</p>
                  <h3 className="mt-1 text-lg font-bold text-slate-950 dark:text-white">{section.title}</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-slate-200">{section.content}</p>
                </section>
              ))}
            </div>
          </section>
        )}

        {model.tables.length > 0 && (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
            <h2 className="text-xl font-black">Tablas y matrices</h2>
            <div className="mt-4 space-y-5">{model.tables.map((table) => (
              <div key={table.id} className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-white/10">
                <div className="flex items-center justify-between gap-2 border-b border-slate-200 p-3 text-sm dark:border-white/10"><strong>{table.title}</strong><span>{Math.round(table.completeness * 100)}% completo</span></div>
                <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-white/10"><thead className="bg-slate-50 dark:bg-white/5"><tr>{table.headers.map((header) => <th key={header} className="px-3 py-2 text-left font-bold">{header}</th>)}</tr></thead><tbody className="divide-y divide-slate-100 dark:divide-white/10">{table.rows.slice(0, 8).map((row, idx) => <tr key={`${table.id}-${idx}`}>{table.headers.map((header, cellIdx) => <td key={`${header}-${cellIdx}`} className="px-3 py-2 text-slate-700 dark:text-slate-200">{row[cellIdx] || '—'}</td>)}</tr>)}</tbody></table>
              </div>
            ))}</div>
          </section>
        )}

        {(model.nextSteps.length > 0 || model.traceability.length > 0) && (
          <section className="grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900"><h2 className="font-black">Próximos pasos</h2><ul className="mt-3 list-disc pl-5 text-sm leading-7 text-slate-700 dark:text-slate-200">{model.nextSteps.map((item) => <li key={item}>{item}</li>)}</ul></div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900"><h2 className="font-black">Trazabilidad</h2><ul className="mt-3 list-disc pl-5 text-sm leading-7 text-slate-700 dark:text-slate-200">{model.traceability.map((item) => <li key={item}>{item}</li>)}</ul></div>
          </section>
        )}
      </div>
    </article>
  );
};

export default ArtifactPresentationView;
