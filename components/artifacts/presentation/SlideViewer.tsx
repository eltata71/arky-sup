import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { ErrorBoundary } from '../../ErrorBoundary';
import ViewerCrashFallback from '../ViewerCrashFallback';
import { parsePresentationDeck } from '../../../services/presentation';
import type { ArtifactType } from '../../../types';
import type { PresentationCalloutContent, PresentationContentBlock, PresentationDeck, PresentationDiagramContent, PresentationKpiContent, PresentationSlide, PresentationTableContent } from '../../../services/presentation';

export interface SlideViewerProps {
  /** Raw artifact content — expected to be a JSON-serialised `PresentationDeck`. */
  content: string;
  artifactName: string;
  artifactType: ArtifactType;
  onEdit?: () => void;
  onExport?: () => void;
  isSplit?: boolean;
}

type ViewMode = 'slides' | 'outline';

const calloutToneStyles: Record<PresentationCalloutContent['tone'], string> = {
  info: 'border-blue-500/50 bg-blue-500/10 text-blue-100',
  success: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-100',
  warning: 'border-amber-500/50 bg-amber-500/10 text-amber-100',
  risk: 'border-rose-500/50 bg-rose-500/10 text-rose-100',
};

const layoutBadgeStyles: Record<string, string> = {
  titleSlide: 'bg-indigo-500/20 text-indigo-200 ring-indigo-500/30',
  executiveSummary: 'bg-sky-500/20 text-sky-200 ring-sky-500/30',
  sectionDivider: 'bg-slate-500/20 text-slate-200 ring-slate-500/30',
  twoColumn: 'bg-violet-500/20 text-violet-200 ring-violet-500/30',
  problemSolution: 'bg-fuchsia-500/20 text-fuchsia-200 ring-fuchsia-500/30',
  architectureOverview: 'bg-cyan-500/20 text-cyan-200 ring-cyan-500/30',
  roadmap: 'bg-emerald-500/20 text-emerald-200 ring-emerald-500/30',
  riskMatrix: 'bg-rose-500/20 text-rose-200 ring-rose-500/30',
  decisionSlide: 'bg-amber-500/20 text-amber-200 ring-amber-500/30',
  diagramFocused: 'bg-cyan-500/20 text-cyan-200 ring-cyan-500/30',
  comparisonTable: 'bg-violet-500/20 text-violet-200 ring-violet-500/30',
  timeline: 'bg-emerald-500/20 text-emerald-200 ring-emerald-500/30',
  metricsKpi: 'bg-teal-500/20 text-teal-200 ring-teal-500/30',
  closingSlide: 'bg-slate-500/20 text-slate-200 ring-slate-500/30',
};

const layoutLabels: Record<string, string> = {
  titleSlide: 'Portada',
  executiveSummary: 'Resumen ejecutivo',
  sectionDivider: 'Separador',
  twoColumn: 'Dos columnas',
  problemSolution: 'Problema / Solución',
  architectureOverview: 'Arquitectura',
  roadmap: 'Roadmap',
  riskMatrix: 'Matriz de riesgos',
  decisionSlide: 'Decisión',
  diagramFocused: 'Diagrama',
  comparisonTable: 'Comparativa',
  timeline: 'Línea de tiempo',
  metricsKpi: 'KPIs',
  closingSlide: 'Cierre',
};

const SlideBlock: React.FC<{ block: PresentationContentBlock }> = ({ block }) => {
  switch (block.type) {
    case 'text': {
      const text = typeof block.content === 'string' ? block.content : '';
      return <p className="text-base md:text-lg leading-relaxed text-gray-100">{text}</p>;
    }
    case 'bullets': {
      const items = Array.isArray(block.content) ? (block.content as string[]) : [];
      return (
        <ul className="space-y-2 text-base md:text-lg text-gray-100">
          {items.map((item, idx) => (
            <li key={idx} className="flex gap-3">
              <span aria-hidden className="mt-2 inline-block h-2 w-2 rounded-full bg-indigo-400 flex-shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    }
    case 'callout': {
      const callout = block.content as PresentationCalloutContent;
      const styles = calloutToneStyles[callout.tone] ?? calloutToneStyles.info;
      return (
        <div className={`rounded-lg border px-4 py-3 ${styles}`}>
          {callout.title && <div className="font-semibold mb-1">{callout.title}</div>}
          <div className="text-sm md:text-base">{callout.body}</div>
        </div>
      );
    }
    case 'kpi': {
      const items: PresentationKpiContent[] = Array.isArray(block.content)
        ? (block.content as PresentationKpiContent[])
        : [block.content as PresentationKpiContent];
      return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {items.map((kpi, idx) => {
            const trendSymbol = kpi.trend === 'up' ? '↑' : kpi.trend === 'down' ? '↓' : kpi.trend === 'flat' ? '→' : '';
            return (
              <div key={idx} className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
                <div className="text-xs uppercase tracking-wider text-gray-400">{kpi.label}</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <div className="text-2xl font-semibold text-white">{kpi.value}</div>
                  {trendSymbol && (
                    <span aria-label={`trend ${kpi.trend}`} className={`text-sm ${kpi.trend === 'up' ? 'text-emerald-400' : kpi.trend === 'down' ? 'text-rose-400' : 'text-gray-400'}`}>
                      {trendSymbol}
                    </span>
                  )}
                </div>
                {kpi.detail && <div className="mt-1 text-xs text-gray-400">{kpi.detail}</div>}
              </div>
            );
          })}
        </div>
      );
    }
    case 'table': {
      const table = block.content as PresentationTableContent;
      return (
        <div className="overflow-x-auto rounded-lg border border-gray-700">
          <table className="min-w-full divide-y divide-gray-700 text-sm">
            <thead className="bg-gray-800/60">
              <tr>
                {table.headers.map((header, idx) => (
                  <th key={idx} className="px-3 py-2 text-left font-semibold text-gray-200">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {table.rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3 py-2 text-gray-200">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {table.caption && <div className="px-3 py-2 text-xs text-gray-400 border-t border-gray-800">{table.caption}</div>}
        </div>
      );
    }
    case 'diagram': {
      const diagram = block.content as PresentationDiagramContent;
      return (
        <div className="rounded-lg border border-dashed border-cyan-500/40 bg-cyan-500/5 px-4 py-3 text-sm">
          <div className="text-xs uppercase tracking-wider text-cyan-300 mb-1">Diagrama sugerido</div>
          {diagram.description && <div className="text-gray-200 mb-2">{diagram.description}</div>}
          {diagram.mermaid && (
            <pre className="rounded bg-gray-950/70 p-3 text-xs text-cyan-100 overflow-x-auto whitespace-pre-wrap">{diagram.mermaid}</pre>
          )}
          {diagram.artifactId && <div className="text-xs text-gray-400 mt-2">Vincula con artefacto: {diagram.artifactId}</div>}
        </div>
      );
    }
    case 'imagePlaceholder': {
      const text = typeof block.content === 'string' ? block.content : 'Imagen sugerida';
      return (
        <div className="rounded-lg border border-dashed border-gray-600 bg-gray-900/60 px-4 py-6 text-center text-sm text-gray-400">
          <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Imagen sugerida</div>
          <div>{text}</div>
        </div>
      );
    }
    default:
      return null;
  }
};

interface SlideCanvasProps {
  slide: PresentationSlide;
  totalSlides: number;
  deckTitle: string;
}

const SlideCanvas: React.FC<SlideCanvasProps> = ({ slide, totalSlides, deckTitle }) => {
  const layoutLabel = layoutLabels[slide.layout] ?? slide.layout;
  const badgeStyles = layoutBadgeStyles[slide.layout] ?? 'bg-gray-700/40 text-gray-200 ring-gray-700/40';
  return (
    <article className="mx-auto max-w-4xl rounded-2xl bg-gradient-to-br from-gray-900 via-gray-950 to-gray-900 border border-gray-800 shadow-2xl overflow-hidden">
      <header className="flex items-center justify-between px-6 md:px-10 pt-6 md:pt-8 text-xs text-gray-400">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded ring-1 ring-inset ${badgeStyles}`}>{layoutLabel}</span>
          <span className="opacity-60">·</span>
          <span className="opacity-80">{deckTitle}</span>
        </div>
        <span aria-label={`slide ${slide.slideNumber} of ${totalSlides}`}>
          {slide.slideNumber} / {totalSlides}
        </span>
      </header>
      <div className="px-6 md:px-10 pb-10 pt-4 md:pt-6 space-y-4">
        <div>
          <h2 className="text-2xl md:text-4xl font-bold text-white tracking-tight">{slide.title}</h2>
          {slide.subtitle && <p className="mt-1 text-base md:text-lg text-gray-300">{slide.subtitle}</p>}
        </div>
        {slide.keyMessage && (
          <div className="rounded-lg border-l-4 border-indigo-500 bg-indigo-500/5 px-4 py-2 text-sm md:text-base text-indigo-100">
            <span className="font-semibold mr-2">Mensaje clave:</span>{slide.keyMessage}
          </div>
        )}
        <div className="space-y-3">
          {slide.contentBlocks.map((block, idx) => (
            <SlideBlock key={`${slide.id}-block-${idx}`} block={block} />
          ))}
          {slide.contentBlocks.length === 0 && slide.layout !== 'titleSlide' && slide.layout !== 'sectionDivider' && slide.layout !== 'closingSlide' && (
            <div className="text-sm text-gray-500 italic">Slide sin contenido — regenera el deck para añadir bloques.</div>
          )}
        </div>
        {slide.speakerNotes && (
          <details className="rounded-lg bg-gray-900/60 border border-gray-800 px-4 py-2 text-sm text-gray-300">
            <summary className="cursor-pointer text-gray-400 hover:text-gray-200 select-none">Notas del presentador</summary>
            <p className="mt-2 leading-relaxed">{slide.speakerNotes}</p>
          </details>
        )}
      </div>
    </article>
  );
};

interface DeckOutlineProps {
  deck: PresentationDeck;
  activeIndex: number;
  onSelect: (idx: number) => void;
}

const DeckOutline: React.FC<DeckOutlineProps> = ({ deck, activeIndex, onSelect }) => (
  <ol className="space-y-2 text-sm">
    {deck.slides.map((slide, idx) => (
      <li key={slide.id}>
        <button
          type="button"
          onClick={() => onSelect(idx)}
          className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
            idx === activeIndex
              ? 'border-indigo-500 bg-indigo-500/15 text-white'
              : 'border-gray-800 bg-gray-900/40 text-gray-300 hover:border-gray-700 hover:bg-gray-900/70'
          }`}
        >
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="font-mono">{String(slide.slideNumber).padStart(2, '0')}</span>
            <span className="opacity-70">·</span>
            <span>{layoutLabels[slide.layout] ?? slide.layout}</span>
          </div>
          <div className="mt-0.5 font-medium">{slide.title}</div>
          {slide.keyMessage && <div className="mt-1 text-xs text-gray-400 line-clamp-2">{slide.keyMessage}</div>}
        </button>
      </li>
    ))}
  </ol>
);

/**
 * Cinematic-but-compact slide viewer for presentation artifacts. Renders a
 * parsed `PresentationDeck` with slide-by-slide navigation, an outline
 * sidebar, and a documented fallback when the deck cannot be parsed — the
 * canvas never blanks out on invalid content.
 */
export const SlideViewer: React.FC<SlideViewerProps> = ({
  content,
  artifactName,
  artifactType,
  onEdit,
  onExport,
  isSplit = false,
}) => {
  const parseResult = useMemo(
    () => parsePresentationDeck(content, { artifactType, artifactName }),
    [content, artifactType, artifactName],
  );
  const deck = parseResult.deck;
  const totalSlides = deck.slides.length;

  const [activeIndex, setActiveIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('slides');

  useEffect(() => {
    setActiveIndex(0);
  }, [deck.title, totalSlides]);

  const goPrev = useCallback(() => setActiveIndex(idx => Math.max(0, idx - 1)), []);
  const goNext = useCallback(() => setActiveIndex(idx => Math.min(totalSlides - 1, idx + 1)), [totalSlides]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable)) {
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        goNext();
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        goPrev();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev]);

  const slide = deck.slides[activeIndex] ?? deck.slides[0];

  return (
    <div
      className={`flex-1 flex flex-col bg-gray-950 min-h-0 animate-fade-in ${
        isSplit ? 'border-b lg:border-b-0 lg:border-r border-gray-800' : ''
      }`}
    >
      <ErrorBoundary
        fallback={(error, reset) => (
          <ViewerCrashFallback
            title="La presentación falló al renderizar"
            viewerLabel="Presentación"
            error={error}
            onReset={reset}
          />
        )}
      >
        <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-2 border-b border-gray-800 bg-gray-900/60 text-sm">
          <div className="min-w-0 flex items-center gap-3">
            <div className="flex rounded-md border border-gray-700 overflow-hidden text-xs">
              <button
                type="button"
                aria-pressed={viewMode === 'slides'}
                onClick={() => setViewMode('slides')}
                className={`px-3 py-1 ${viewMode === 'slides' ? 'bg-indigo-500/20 text-indigo-200' : 'text-gray-300 hover:bg-gray-800'}`}
              >
                Presentación
              </button>
              <button
                type="button"
                aria-pressed={viewMode === 'outline'}
                onClick={() => setViewMode('outline')}
                className={`px-3 py-1 ${viewMode === 'outline' ? 'bg-indigo-500/20 text-indigo-200' : 'text-gray-300 hover:bg-gray-800'}`}
              >
                Estructura
              </button>
            </div>
            <div className="hidden md:flex items-center gap-2 text-xs text-gray-400 truncate">
              <span className="font-medium text-gray-200 truncate">{deck.title}</span>
              <span aria-hidden>·</span>
              <span>Audiencia: {deck.audience}</span>
              <span aria-hidden>·</span>
              <span>{totalSlides} slide{totalSlides === 1 ? '' : 's'}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="px-2 py-1 text-xs rounded border border-gray-700 text-gray-300 hover:border-gray-600 hover:bg-gray-800"
              >
                Editar JSON
              </button>
            )}
            {onExport && (
              <button
                type="button"
                onClick={onExport}
                className="px-2 py-1 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-500"
              >
                Exportar
              </button>
            )}
          </div>
        </div>
        {parseResult.usedFallback && (
          <div className="px-4 md:px-6 py-2 text-xs text-amber-200 bg-amber-500/10 border-b border-amber-500/30">
            El deck no se pudo parsear como presentación válida. Mostrando un deck mínimo de respaldo — regenera el artefacto para obtener un deck completo.
          </div>
        )}
        {viewMode === 'slides' ? (
          <div className="flex-1 flex min-h-0">
            <aside className="hidden lg:flex w-64 flex-shrink-0 flex-col border-r border-gray-800 bg-gray-950 overflow-y-auto px-3 py-4">
              <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">Slides</h3>
              <DeckOutline deck={deck} activeIndex={activeIndex} onSelect={setActiveIndex} />
            </aside>
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
                {slide ? (
                  <SlideCanvas slide={slide} totalSlides={totalSlides} deckTitle={deck.title} />
                ) : (
                  <div className="text-center text-gray-400 mt-12">El deck no contiene slides.</div>
                )}
              </div>
              <div className="flex items-center justify-between px-4 md:px-8 py-3 border-t border-gray-800 bg-gray-900/60">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={activeIndex === 0}
                  className="px-3 py-1 rounded text-sm border border-gray-700 text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-800"
                >
                  ← Anterior
                </button>
                <div className="text-xs text-gray-400">
                  Slide {activeIndex + 1} de {totalSlides}
                </div>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={activeIndex >= totalSlides - 1}
                  className="px-3 py-1 rounded text-sm border border-gray-700 text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-800"
                >
                  Siguiente →
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
            <div className="mx-auto max-w-3xl">
              <h2 className="text-lg font-semibold text-gray-100 mb-3">Estructura del deck</h2>
              <DeckOutline deck={deck} activeIndex={activeIndex} onSelect={(idx) => { setActiveIndex(idx); setViewMode('slides'); }} />
            </div>
          </div>
        )}
      </ErrorBoundary>
    </div>
  );
};

export default SlideViewer;
