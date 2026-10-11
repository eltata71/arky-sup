/**
 * The deck's brand, declared once for every surface that draws a slide (12.4).
 *
 * The PPTX exporter (9.2) and the on-screen slides used to describe the same
 * fourteen layouts twice: the exporter with a light master, a bar or a band and
 * one or two columns; the screen with one dark card for all of them. What was
 * presented was not what was exported. Both now read this file: the exporter
 * adds geometry in EMU, the screen maps the same words to Tailwind classes.
 *
 * Colour values mirror `tailwind.config.cjs` (`gray`, `primary`, `success`,
 * `warning`, `danger`), so the screen can use classes and the PPTX hex codes
 * without a second palette.
 */
import type { PresentationLayout } from './PresentationTypes';

export const SLIDE_PALETTE = {
  ink: '18181B',
  inkMuted: '52525B',
  surface: 'FAFAFA',
  surfaceAlt: 'F4F4F5',
  border: 'D4D4D8',
  primary: '4F46E5',
  primaryDark: '312E81',
  primaryTint: 'E0E7FF',
  onDark: 'FFFFFF',
  darkSurface: '18181B',
  tone: {
    info: { solid: '4F46E5', tint: 'EEF2FF', label: 'Información' },
    success: { solid: '15803D', tint: 'F0FDF4', label: 'Logro' },
    warning: { solid: 'B45309', tint: 'FFFBEB', label: 'Atención' },
    risk: { solid: 'B91C1C', tint: 'FEF2F2', label: 'Riesgo' },
  },
  trend: {
    up: { color: '15803D', glyph: '▲', word: 'Sube' },
    down: { color: 'B91C1C', glyph: '▼', word: 'Baja' },
    flat: { color: '52525B', glyph: '■', word: 'Estable' },
  },
} as const;

export const SLIDE_FONT = 'Inter';

/** Slides are 4:3 in the PPTX (9 144 000 × 6 858 000 EMU), and on screen. */
export const SLIDE_ASPECT = { width: 4, height: 3 } as const;

export type SlideDecoration = 'bar' | 'band' | 'none';

export interface SlideLayoutBrand {
  /** A hero layout is dark with light, centred text. */
  hero: boolean;
  decoration: SlideDecoration;
  align: 'left' | 'center';
  columns: 1 | 2;
}

const contentLayout = (overrides: Partial<SlideLayoutBrand> = {}): SlideLayoutBrand => ({
  hero: false, decoration: 'bar', align: 'left', columns: 1, ...overrides,
});
const heroLayout = (): SlideLayoutBrand => ({
  hero: true, decoration: 'band', align: 'center', columns: 1,
});

/**
 * One entry per `PresentationLayout`; a slide names its layout, nothing infers
 * it. The layout's name is copy, so it lives in the dictionary
 * (`deck.layout.<layout>`), not here.
 */
export const SLIDE_LAYOUT_BRAND: Record<PresentationLayout, SlideLayoutBrand> = {
  titleSlide: heroLayout(),
  executiveSummary: contentLayout(),
  sectionDivider: heroLayout(),
  twoColumn: contentLayout({ columns: 2 }),
  problemSolution: contentLayout({ columns: 2 }),
  architectureOverview: contentLayout(),
  roadmap: contentLayout(),
  riskMatrix: contentLayout(),
  decisionSlide: contentLayout({ decoration: 'band' }),
  diagramFocused: contentLayout(),
  comparisonTable: contentLayout(),
  timeline: contentLayout(),
  metricsKpi: contentLayout(),
  closingSlide: heroLayout(),
};

/** An unknown layout reads as the plainest content slide, as the exporter does. */
export const slideBrandFor = (layout: string): SlideLayoutBrand =>
  (SLIDE_LAYOUT_BRAND as Record<string, SlideLayoutBrand | undefined>)[layout] ?? SLIDE_LAYOUT_BRAND.executiveSummary;
