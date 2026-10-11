/**
 * 12.4 — presenting a deck: the screen draws each of the fourteen layouts in
 * the brand the PPTX exports, the presenter's view works in a second window,
 * the laser moves from the keyboard, and reduced motion keeps the information
 * while dropping the motion.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { SUPPORTED_LAYOUTS } from '../../../services/presentation';
import { SLIDE_LAYOUT_BRAND } from '../../../services/presentation/slideBrand';
import { SlideViewer } from '../../../components/artifacts/presentation/SlideViewer';

const deck = {
  kind: 'presentation',
  version: '1.0',
  title: 'Plataforma de siniestros',
  audience: 'executive',
  slides: SUPPORTED_LAYOUTS.map((layout, idx) => ({
    id: `s${idx + 1}`,
    slideNumber: idx + 1,
    layout,
    title: `Diapositiva ${layout}`,
    keyMessage: `Mensaje ${idx + 1}`,
    speakerNotes: idx === 0 ? 'Saludar al comité y fijar el objetivo.' : undefined,
    contentBlocks: layout === 'metricsKpi'
      ? [{ type: 'kpi', content: [{ label: 'Disponibilidad', value: '98,5 %', trend: 'up' }] }]
      : layout === 'titleSlide' || layout === 'sectionDivider' || layout === 'closingSlide'
        ? []
        : [{ type: 'bullets', content: ['Primero', 'Segundo'] }],
  })),
};

const renderViewer = () => render(
  <SlideViewer content={JSON.stringify(deck)} artifactName="Deck" artifactType="presentation-summary" />,
);

const setReducedMotion = (reduced: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduced && query.includes('reduce'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
};

const present = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Presentar' }));
  return screen.findByRole('dialog', { name: 'Presentación de «Plataforma de siniestros»' }, { timeout: 5000 });
};

const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: k, ...init });

// The presenter is a lazy chunk; warm it once so no case races its first import.
beforeAll(async () => { await import('../../../components/artifacts/presentation/DeckPresenter'); });
beforeEach(() => setReducedMotion(false));
afterEach(() => vi.restoreAllMocks());

describe('slides in the PPTX brand', () => {
  it('draws every one of the fourteen layouts as its brand declares', () => {
    renderViewer();
    for (const [idx, layout] of SUPPORTED_LAYOUTS.entries()) {
      fireEvent.click(screen.getAllByRole('button', { name: new RegExp(`Diapositiva ${layout}`) })[0]);
      const slide = screen.getByRole('article', { name: `Diapositiva ${idx + 1}: Diapositiva ${layout}` });
      const brand = SLIDE_LAYOUT_BRAND[layout];
      expect(slide).toHaveAttribute('data-layout', layout);
      expect(slide).toHaveAttribute('data-hero', String(brand.hero));
      expect(slide).toHaveAttribute('data-decoration', brand.decoration);
      expect(slide).toHaveAttribute('data-columns', String(brand.columns));
    }
  });
});

describe('presentation mode', () => {
  it('walks the deck from the keyboard and leaves the reader where the presentation ended', async () => {
    renderViewer();
    const dialog = await present();
    expect(within(dialog).getByText('Diapositiva 1 de 14')).toBeInTheDocument();
    key('ArrowRight');
    key(' ');
    expect(within(dialog).getByText('Diapositiva 3 de 14')).toBeInTheDocument();
    key('ArrowLeft');
    key('End');
    expect(within(dialog).getByText('Diapositiva 14 de 14')).toBeInTheDocument();
    key('Escape');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Diapositiva 14 de 14')).toBeInTheDocument();
  });

  it('counts every press, even several before React re-renders', async () => {
    renderViewer();
    const dialog = await present();
    // Dispatched outside act(): the handler sees no re-render between them.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(await within(dialog).findByText('Diapositiva 4 de 14')).toBeInTheDocument();
  });

  it('moves the laser with the arrows while it is on, and the slides with Page Down', async () => {
    renderViewer();
    const dialog = await present();
    key('l');
    const laser = screen.getByTestId('laser-pointer');
    expect(laser.style.left).toBe('50%');
    key('ArrowRight');
    key('ArrowDown', { shiftKey: true });
    expect(screen.getByTestId('laser-pointer').style.left).toBe('52%');
    expect(screen.getByTestId('laser-pointer').style.top).toBe('58%');
    expect(within(dialog).getByText('Diapositiva 1 de 14')).toBeInTheDocument();
    key('PageDown');
    expect(within(dialog).getByText('Diapositiva 2 de 14')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Puntero láser · L' })).toHaveAttribute('aria-pressed', 'true');
    key('L');
    expect(screen.queryByTestId('laser-pointer')).not.toBeInTheDocument();
  });

  it('opens the presenter view in a second window, with notes, next slide and clock', async () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const popup = frame.contentWindow!;
    const close = vi.spyOn(popup, 'close').mockImplementation(() => undefined);
    vi.spyOn(window, 'open').mockReturnValue(popup);

    renderViewer();
    await present();
    key('p');
    const view = within(popup.document.body);
    expect(view.getByRole('region', { name: 'Vista del presentador' })).toBeInTheDocument();
    expect(view.getByText('Saludar al comité y fijar el objetivo.')).toBeInTheDocument();
    expect(view.getByRole('article', { name: 'Diapositiva 2: Diapositiva executiveSummary' })).toBeInTheDocument();
    expect(view.getByTestId('presenter-elapsed')).toHaveTextContent(/^0:0\d$/);

    // The presenter's own keyboard drives the deck.
    fireEvent.keyDown(popup, { key: 'ArrowRight' });
    expect(view.getByText('Esta diapositiva no tiene notas.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('Diapositiva 2 de 14');

    key('Escape');
    expect(close).toHaveBeenCalled();
    frame.remove();
  });

  it('shows the presenter view in place when the browser blocks the window', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    renderViewer();
    const dialog = await present();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vista del presentador · P' }));
    expect(within(dialog).getByRole('note')).toHaveTextContent('El navegador no abrió la segunda ventana');
    expect(within(dialog).getByRole('region', { name: 'Vista del presentador' })).toBeInTheDocument();
  });
});

describe('KPIs while presenting', () => {
  const toKpiSlide = async () => {
    renderViewer();
    const dialog = await present();
    key('Home');
    for (let i = 0; i < SUPPORTED_LAYOUTS.indexOf('metricsKpi'); i += 1) key('ArrowRight');
    return dialog;
  };

  it('count up, while a screen reader hears the final figure', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    try {
      const dialog = await toKpiSlide();
      expect(within(dialog).getByText('0,0 %')).toHaveAttribute('aria-hidden', 'true');
      expect(within(dialog).getByText('98,5 %')).toHaveClass('sr-only');
      act(() => { vi.advanceTimersByTime(2000); });
      expect(within(dialog).getAllByText('98,5 %')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('show the figure at once with reduced motion — same information, no count', async () => {
    setReducedMotion(true);
    const dialog = await toKpiSlide();
    expect(within(dialog).queryByText('0,0 %')).not.toBeInTheDocument();
    expect(within(dialog).getAllByText('98,5 %')).toHaveLength(2);
  });
});
