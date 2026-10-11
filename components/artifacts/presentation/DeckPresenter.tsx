import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import type { PresentationDeck } from '../../../services/presentation';
import { LASER_HOME, moveLaser, type LaserPosition } from '../../../services/presentation/presentationRuntime';
import { MOTION } from '../../../lib/designTokens';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import useReducedMotion from '../../../hooks/useReducedMotion';
import { usePresenterWindow } from '../../../hooks/usePresenterWindow';
import { useUiText } from '../../../hooks/useUiText';
import { cn } from '../../ui/cn';
import { SlideFrame } from './SlideFrame';
import { PresenterView } from './PresenterView';

export interface DeckPresenterProps {
  deck: PresentationDeck;
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

const isTyping = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  return !!el && typeof el.tagName === 'string' && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
};

const controlClass = 'rounded-md border border-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/10 disabled:opacity-40';

/**
 * Presenting a deck (12.4). One slide at a time on a dark stage, in the brand
 * the PPTX exports; each slide enters with a short slide in the direction of
 * travel (only the entrance: the leaving one is gone, so the audience never
 * waits for an exit), and nothing moves with reduced motion;
 * KPIs counting up to their figure; a laser the keyboard can move; and the
 * presenter's notes, next slide and clock in a second window.
 *
 * The index belongs to the viewer that opened this, so leaving the
 * presentation leaves the reader on the slide they were presenting.
 */
export const DeckPresenter: React.FC<DeckPresenterProps> = ({ deck, index, onIndexChange, onClose }) => {
  const t = useUiText();
  const reduced = useReducedMotion();
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const [startedAt] = useState(() => Date.now());
  const [laser, setLaser] = useState<LaserPosition | null>(null);
  const [presenterRequested, setPresenterRequested] = useState(false);
  const [status, setStatus] = useState('');
  const direction = useRef(1);

  const total = deck.slides.length;
  const slide = deck.slides[index] ?? deck.slides[0];
  const nextSlide = deck.slides[index + 1] ?? null;
  const presenter = usePresenterWindow(presenterRequested, t('deck.presenterWindowTitle', { title: deck.title }), () => setPresenterRequested(false));

  const goTo = useCallback((target: number) => {
    const clamped = Math.min(total - 1, Math.max(0, target));
    if (clamped === index) return;
    direction.current = clamped > index ? 1 : -1;
    onIndexChange(clamped);
  }, [index, total, onIndexChange]);
  const goNext = useCallback(() => goTo(index + 1), [goTo, index]);
  const goPrev = useCallback(() => goTo(index - 1), [goTo, index]);

  const toggleLaser = useCallback(() => {
    setStatus(laser ? t('deck.laserOff') : t('deck.laserOn'));
    setLaser(laser ? null : LASER_HOME);
  }, [laser, t]);

  useEffect(() => {
    if (slide) setStatus(t('deck.slideStatus', { current: String(index + 1), total: String(total), title: slide.title }));
  }, [index, total, slide, t]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      const key = event.key;
      if (key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (key === 'l' || key === 'L') { event.preventDefault(); toggleLaser(); return; }
      if (key === 'p' || key === 'P') { event.preventDefault(); setPresenterRequested((v) => !v); return; }
      if (laser) {
        const moved = moveLaser(laser, key, event.shiftKey);
        if (moved) { event.preventDefault(); setLaser(moved); return; }
      }
      if (key === 'ArrowRight' || key === 'PageDown' || key === ' ') { event.preventDefault(); goNext(); }
      else if (key === 'ArrowLeft' || key === 'PageUp') { event.preventDefault(); goPrev(); }
      else if (key === 'Home') { event.preventDefault(); goTo(0); }
      else if (key === 'End') { event.preventDefault(); goTo(total - 1); }
    };
    // The presenter's own window drives the deck too: it is the keyboard in front of them.
    const targets: Window[] = presenter.win ? [window, presenter.win] : [window];
    targets.forEach((target) => target.addEventListener('keydown', onKey));
    return () => targets.forEach((target) => target.removeEventListener('keydown', onKey));
  }, [laser, presenter.win, goNext, goPrev, goTo, total, onClose, toggleLaser]);

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!laser) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    setLaser({ x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 });
  };

  if (!slide) return null;
  const offset = reduced ? 0 : 32 * direction.current;
  const transition = reduced ? { duration: 0 } : { duration: MOTION.duration.slow, ease: MOTION.ease.enter };
  const presenterProps = { slide, nextSlide, index, total, startedAt, onPrev: goPrev, onNext: goNext };
  const inlinePresenter = presenterRequested && presenter.blocked;

  return (
    <div
      ref={trapRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('deck.dialog', { title: deck.title })}
      className="fixed inset-0 z-[90] flex flex-col bg-gray-950 text-white"
    >
      <div className={cn('flex min-h-0 flex-1', inlinePresenter && 'flex-col lg:flex-row')}>
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <div className="relative w-[min(94vw,calc(84vh*4/3))]" onPointerMove={onPointerMove}>
            <motion.div
              key={slide.id}
              initial={reduced ? false : { opacity: 0, x: offset }}
              animate={{ opacity: 1, x: 0 }}
              transition={transition}
            >
              <SlideFrame slide={slide} size="stage" animateFigures reducedMotion={reduced}>
                {laser && (
                  <span
                    data-testid="laser-pointer"
                    aria-hidden="true"
                    className="pointer-events-none absolute z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-danger-500 shadow-[0_0_12px_4px_rgba(239,68,68,0.7)]"
                    style={{ left: `${laser.x}%`, top: `${laser.y}%` }}
                  />
                )}
              </SlideFrame>
            </motion.div>
          </div>
        </div>
        {inlinePresenter && (
          <aside className="min-h-0 overflow-y-auto border-t border-white/10 lg:w-[38%] lg:border-l lg:border-t-0">
            <p role="note" className="bg-warning-900/60 px-5 py-2 text-xs text-warning-100">{t('deck.presenterBlocked')}</p>
            <PresenterView {...presenterProps} />
          </aside>
        )}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={goPrev} disabled={index === 0} className={controlClass}>{t('deck.prev')}</button>
          <span className="px-2 text-sm tabular-nums text-gray-300">{t('deck.slideOf', { current: String(index + 1), total: String(total) })}</span>
          <button type="button" onClick={goNext} disabled={index >= total - 1} className={controlClass}>{t('deck.next')}</button>
        </div>
        <p className="hidden text-xs text-gray-400 md:block">{t('deck.keys')}</p>
        <div className="flex items-center gap-2">
          <button type="button" aria-pressed={laser !== null} onClick={toggleLaser} className={controlClass}>{t('deck.laser')}</button>
          <button type="button" aria-pressed={presenterRequested} onClick={() => setPresenterRequested((v) => !v)} className={controlClass}>{t('deck.presenter')}</button>
          <button type="button" onClick={onClose} className={cn(controlClass, 'bg-white/10')}>{t('deck.exit')}</button>
        </div>
      </footer>
      <p role="status" className="sr-only">{status}</p>
      {presenter.container && createPortal(<PresenterView {...presenterProps} />, presenter.container)}
    </div>
  );
};

export default DeckPresenter;
