import React, { useEffect, useState } from 'react';
import { formatElapsed } from '../../../services/presentation/presentationRuntime';
import type { PresentationSlide } from '../../../services/presentation';
import { useUiText } from '../../../hooks/useUiText';
import { SlideFrame } from './SlideFrame';

export interface PresenterViewProps {
  slide: PresentationSlide;
  nextSlide: PresentationSlide | null;
  index: number;
  total: number;
  startedAt: number;
  onPrev: () => void;
  onNext: () => void;
}

/** A clock that ticks once a second, and only while it is on screen. */
const useNow = (): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
};

/**
 * What only the presenter sees (12.4): the notes, the next slide and the
 * clock. It renders in the second window when the browser allows one, and
 * beside the stage when it does not — the same component either way.
 */
export const PresenterView: React.FC<PresenterViewProps> = ({ slide, nextSlide, index, total, startedAt, onPrev, onNext }) => {
  const t = useUiText();
  const now = useNow();
  const clock = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <section aria-label={t('deck.presenterTitle')} className="flex h-full flex-col gap-4 bg-gray-950 p-5 text-white">
      <header className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-300">{t('deck.presenterTitle')}</h2>
        <dl className="flex items-baseline gap-5 tabular-nums">
          <div>
            <dt className="text-xs text-gray-400">{t('deck.elapsed')}</dt>
            <dd className="text-2xl font-semibold" data-testid="presenter-elapsed">{formatElapsed(now - startedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">{t('deck.clock')}</dt>
            <dd className="text-2xl font-semibold">{clock}</dd>
          </div>
        </dl>
      </header>
      <p className="text-sm text-gray-300">{t('deck.slideOf', { current: String(index + 1), total: String(total) })} · {slide.title}</p>
      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto rounded-lg bg-gray-900 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">{t('deck.notes')}</h3>
          <p className="whitespace-pre-wrap text-lg leading-relaxed">{slide.speakerNotes?.trim() || t('deck.noNotes')}</p>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">{t('deck.nextSlide')}</h3>
          {nextSlide ? <SlideFrame slide={nextSlide} size="thumb" /> : <p className="text-sm text-gray-400">{t('deck.lastSlide')}</p>}
        </div>
      </div>
      <div className="flex justify-between">
        <button type="button" onClick={onPrev} disabled={index === 0} className="rounded-md border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800 disabled:opacity-40">
          {t('deck.prev')}
        </button>
        <button type="button" onClick={onNext} disabled={index >= total - 1} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold hover:bg-primary-500 disabled:opacity-40">
          {t('deck.next')}
        </button>
      </div>
    </section>
  );
};

export default PresenterView;
