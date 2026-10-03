import type { PresentationLayout } from '../../../presentation';

/** The one place the deck's look is declared. Hex values mirror `tailwind.config.cjs`. */
export const PPTX_PALETTE = {
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

export const PPTX_FONT = 'Inter';

export const SLIDE_WIDTH_EMU = 9_144_000;
export const SLIDE_HEIGHT_EMU = 6_858_000;
export const MARGIN_X = 457_200;
export const CONTENT_WIDTH = SLIDE_WIDTH_EMU - MARGIN_X * 2;
export const BODY_BOTTOM = 6_400_000;

export type LayoutDecoration = 'bar' | 'band' | 'none';

export interface LayoutSpec {
  /** Order in the package: the layout is `slideLayout{index + 1}.xml`. */
  index: number;
  /** Vertical placement of the title: x, y, width, height in EMU. */
  title: { x: number; y: number; cx: number; cy: number };
  titleSize: number;
  align: 'l' | 'ctr';
  /** A hero layout is dark with light text. */
  hero: boolean;
  decoration: LayoutDecoration;
  columns: 1 | 2;
}

const content = (overrides: Partial<LayoutSpec> & { index: number }): LayoutSpec => ({
  title: { x: MARGIN_X, y: 274_320, cx: CONTENT_WIDTH, cy: 820_000 },
  titleSize: 2800,
  align: 'l',
  hero: false,
  decoration: 'bar',
  columns: 1,
  ...overrides,
});

const hero = (overrides: Partial<LayoutSpec> & { index: number }): LayoutSpec => ({
  title: { x: MARGIN_X, y: 2_200_000, cx: CONTENT_WIDTH, cy: 1_400_000 },
  titleSize: 4000,
  align: 'ctr',
  hero: true,
  decoration: 'band',
  columns: 1,
  ...overrides,
});

/** One master layout per `PresentationLayout`; the slide names it, never infers it. */
export const LAYOUT_SPECS: Record<PresentationLayout, LayoutSpec> = {
  titleSlide: hero({ index: 0 }),
  executiveSummary: content({ index: 1 }),
  sectionDivider: hero({ index: 2, titleSize: 3600, title: { x: MARGIN_X, y: 2_600_000, cx: CONTENT_WIDTH, cy: 1_200_000 } }),
  twoColumn: content({ index: 3, columns: 2 }),
  problemSolution: content({ index: 4, columns: 2 }),
  architectureOverview: content({ index: 5, titleSize: 2600 }),
  roadmap: content({ index: 6 }),
  riskMatrix: content({ index: 7 }),
  decisionSlide: content({ index: 8, decoration: 'band', hero: false }),
  diagramFocused: content({ index: 9, titleSize: 2400, title: { x: MARGIN_X, y: 200_000, cx: CONTENT_WIDTH, cy: 700_000 } }),
  comparisonTable: content({ index: 10 }),
  timeline: content({ index: 11 }),
  metricsKpi: content({ index: 12 }),
  closingSlide: hero({ index: 13, title: { x: MARGIN_X, y: 2_400_000, cx: CONTENT_WIDTH, cy: 1_300_000 } }),
};

export const LAYOUT_ORDER = (Object.keys(LAYOUT_SPECS) as PresentationLayout[]).sort(
  (a, b) => LAYOUT_SPECS[a].index - LAYOUT_SPECS[b].index,
);

export const layoutSpecFor = (layout: string): LayoutSpec =>
  (LAYOUT_SPECS as Record<string, LayoutSpec | undefined>)[layout] ?? LAYOUT_SPECS.executiveSummary;
