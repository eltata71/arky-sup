import React, { Suspense, useEffect, useMemo, useState, useCallback } from 'react';
import { ErrorBoundary } from '../../ErrorBoundary';
import ViewerCrashFallback from '../ViewerCrashFallback';
import { parsePresentationDeck } from '../../../services/presentation';
import type { ArtifactType } from '../../../types';
import type { PresentationDeck } from '../../../services/presentation';
import { useUiText } from '../../../hooks/useUiText';
import { SlideFrame } from './SlideFrame';
import { lazyWithRetry } from '../../routing/lazyWithRetry';

// Presenting is the rare path: the stage, the laser and the second window load on «Presentar».
const DeckPresenter = lazyWithRetry(() => import('./DeckPresenter'), { chunkName: 'DeckPresenter' });

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

interface DeckOutlineProps {
  deck: PresentationDeck;
  activeIndex: number;
  onSelect: (idx: number) => void;
}

const DeckOutline: React.FC<DeckOutlineProps> = ({ deck, activeIndex, onSelect }) => {
  const t = useUiText();
  return (
    <ol className="space-y-2 text-sm">
      {deck.slides.map((slide, idx) => (
        <li key={slide.id}>
          <button
            type="button"
            onClick={() => onSelect(idx)}
            aria-current={idx === activeIndex ? 'true' : undefined}
            className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
              idx === activeIndex
                ? 'border-primary-500 bg-primary-500/15 text-white'
                : 'border-gray-800 bg-gray-900/40 text-gray-300 hover:border-gray-700 hover:bg-gray-900/70'
            }`}
          >
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className="font-mono">{String(slide.slideNumber).padStart(2, '0')}</span>
              <span aria-hidden className="opacity-70">·</span>
              <span>{t(`deck.layout.${slide.layout}`)}</span>
            </div>
            <div className="mt-0.5 font-medium">{slide.title}</div>
            {slide.keyMessage && <div className="mt-1 text-xs text-gray-400 line-clamp-2">{slide.keyMessage}</div>}
          </button>
        </li>
      ))}
    </ol>
  );
};

/**
 * Slide viewer for presentation artifacts. Each slide is drawn in the brand
 * the PPTX exports (`SlideFrame`), with an outline, a documented fallback when
 * the deck cannot be parsed — the canvas never blanks out on invalid content —
 * and «Presentar», which opens the deck full screen (`DeckPresenter`).
 */
export const SlideViewer: React.FC<SlideViewerProps> = ({
  content,
  artifactName,
  artifactType,
  onEdit,
  onExport,
  isSplit = false,
}) => {
  const t = useUiText();
  const parseResult = useMemo(
    () => parsePresentationDeck(content, { artifactType, artifactName }),
    [content, artifactType, artifactName],
  );
  const deck = parseResult.deck;
  const totalSlides = deck.slides.length;

  const [activeIndex, setActiveIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('slides');
  const [presenting, setPresenting] = useState(false);

  useEffect(() => {
    setActiveIndex(0);
  }, [deck.title, totalSlides]);

  const goPrev = useCallback(() => setActiveIndex(idx => Math.max(0, idx - 1)), []);
  const goNext = useCallback(() => setActiveIndex(idx => Math.min(totalSlides - 1, idx + 1)), [totalSlides]);

  useEffect(() => {
    // While presenting, the presenter owns the keyboard; two handlers would turn every key into two slides.
    if (presenting) return undefined;
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
  }, [goNext, goPrev, presenting]);

  const slide = deck.slides[activeIndex] ?? deck.slides[0];
  const toolbarButton = 'px-2 py-1 text-xs rounded border border-gray-700 text-gray-300 hover:border-gray-600 hover:bg-gray-800';

  return (
    <div
      className={`flex-1 flex flex-col bg-gray-950 min-h-0 animate-fade-in ${
        isSplit ? 'border-b lg:border-b-0 lg:border-r border-gray-800' : ''
      }`}
    >
      <ErrorBoundary
        fallback={(error, reset) => (
          <ViewerCrashFallback
            title={t('deck.crashTitle')}
            viewerLabel={t('deck.viewerLabel')}
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
                className={`px-3 py-1 ${viewMode === 'slides' ? 'bg-primary-500/20 text-primary-200' : 'text-gray-300 hover:bg-gray-800'}`}
              >
                {t('deck.viewSlides')}
              </button>
              <button
                type="button"
                aria-pressed={viewMode === 'outline'}
                onClick={() => setViewMode('outline')}
                className={`px-3 py-1 ${viewMode === 'outline' ? 'bg-primary-500/20 text-primary-200' : 'text-gray-300 hover:bg-gray-800'}`}
              >
                {t('deck.viewOutline')}
              </button>
            </div>
            <div className="hidden md:flex items-center gap-2 text-xs text-gray-400 truncate">
              <span className="font-medium text-gray-200 truncate">{deck.title}</span>
              <span aria-hidden>·</span>
              <span>{t('deck.audience', { audience: deck.audience })}</span>
              <span aria-hidden>·</span>
              <span>{t('deck.slideCount', { count: String(totalSlides) })}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {totalSlides > 0 && (
              <button
                type="button"
                onClick={() => setPresenting(true)}
                className="px-3 py-1 text-xs rounded bg-primary-600 font-semibold text-white hover:bg-primary-500"
              >
                {t('deck.present')}
              </button>
            )}
            {onEdit && <button type="button" onClick={onEdit} className={toolbarButton}>{t('deck.editJson')}</button>}
            {onExport && <button type="button" onClick={onExport} className={toolbarButton}>{t('export')}</button>}
          </div>
        </div>
        {parseResult.usedFallback && (
          <div className="px-4 md:px-6 py-2 text-xs text-amber-200 bg-amber-500/10 border-b border-amber-500/30">
            {t('deck.fallback')}
          </div>
        )}
        {viewMode === 'slides' ? (
          <div className="flex-1 flex min-h-0">
            <aside className="hidden lg:flex w-64 flex-shrink-0 flex-col border-r border-gray-800 bg-gray-950 overflow-y-auto px-3 py-4">
              <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">{t('deck.outlineTitle')}</h3>
              <DeckOutline deck={deck} activeIndex={activeIndex} onSelect={setActiveIndex} />
            </aside>
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
                {slide ? (
                  <>
                    <SlideFrame slide={slide} />
                    {slide.speakerNotes && (
                      <details className="mx-auto mt-4 max-w-4xl rounded-lg bg-gray-900/60 border border-gray-800 px-4 py-2 text-sm text-gray-300">
                        <summary className="cursor-pointer text-gray-400 hover:text-gray-200 select-none">{t('deck.notes')}</summary>
                        <p className="mt-2 leading-relaxed">{slide.speakerNotes}</p>
                      </details>
                    )}
                  </>
                ) : (
                  <div className="text-center text-gray-400 mt-12">{t('deck.noSlides')}</div>
                )}
              </div>
              <div className="flex items-center justify-between px-4 md:px-8 py-3 border-t border-gray-800 bg-gray-900/60">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={activeIndex === 0}
                  className="px-3 py-1 rounded text-sm border border-gray-700 text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-800"
                >
                  {t('deck.prev')}
                </button>
                <div className="text-xs text-gray-400">
                  {t('deck.slideOf', { current: String(activeIndex + 1), total: String(totalSlides) })}
                </div>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={activeIndex >= totalSlides - 1}
                  className="px-3 py-1 rounded text-sm border border-gray-700 text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-800"
                >
                  {t('deck.next')}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
            <div className="mx-auto max-w-3xl">
              <h2 className="text-lg font-semibold text-gray-100 mb-3">{t('deck.outlineHeading')}</h2>
              <DeckOutline deck={deck} activeIndex={activeIndex} onSelect={(idx) => { setActiveIndex(idx); setViewMode('slides'); }} />
            </div>
          </div>
        )}
        {presenting && (
          <Suspense fallback={null}>
            <DeckPresenter deck={deck} index={activeIndex} onIndexChange={setActiveIndex} onClose={() => setPresenting(false)} />
          </Suspense>
        )}
      </ErrorBoundary>
    </div>
  );
};

export default SlideViewer;
