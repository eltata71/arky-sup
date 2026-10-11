import type { PresentationLayout } from '../../../presentation';
// A declared small door: the deck schema's barrel is shared by every route, the brand only by the canvas and the exporter.
import { SLIDE_FONT, SLIDE_LAYOUT_BRAND, SLIDE_PALETTE, type SlideDecoration } from '../../../presentation/slideBrand';

/**
 * The deck's look comes from `services/presentation/slideBrand.ts`, which the
 * on-screen slides read too (12.4): what is presented is what is exported.
 * This file adds only what a PPTX needs on top — geometry in EMU.
 */
export const PPTX_PALETTE = SLIDE_PALETTE;

export const PPTX_FONT = SLIDE_FONT;

export const SLIDE_WIDTH_EMU = 9_144_000;
export const SLIDE_HEIGHT_EMU = 6_858_000;
export const MARGIN_X = 457_200;
export const CONTENT_WIDTH = SLIDE_WIDTH_EMU - MARGIN_X * 2;
export const BODY_BOTTOM = 6_400_000;

export type LayoutDecoration = SlideDecoration;

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

type Geometry = Pick<LayoutSpec, 'index'> & Partial<Pick<LayoutSpec, 'title' | 'titleSize'>>;

const CONTENT_TITLE = { x: MARGIN_X, y: 274_320, cx: CONTENT_WIDTH, cy: 820_000 };
const HERO_TITLE = { x: MARGIN_X, y: 2_200_000, cx: CONTENT_WIDTH, cy: 1_400_000 };

/** The brand decides how a layout looks; this adds where its title sits. */
const spec = (layout: PresentationLayout, geometry: Geometry): LayoutSpec => {
  const brand = SLIDE_LAYOUT_BRAND[layout];
  return {
    index: geometry.index,
    title: geometry.title ?? (brand.hero ? HERO_TITLE : CONTENT_TITLE),
    titleSize: geometry.titleSize ?? (brand.hero ? 4000 : 2800),
    align: brand.align === 'center' ? 'ctr' : 'l',
    hero: brand.hero,
    decoration: brand.decoration,
    columns: brand.columns,
  };
};

/** One master layout per `PresentationLayout`; the slide names it, never infers it. */
export const LAYOUT_SPECS: Record<PresentationLayout, LayoutSpec> = {
  titleSlide: spec('titleSlide', { index: 0 }),
  executiveSummary: spec('executiveSummary', { index: 1 }),
  sectionDivider: spec('sectionDivider', { index: 2, titleSize: 3600, title: { x: MARGIN_X, y: 2_600_000, cx: CONTENT_WIDTH, cy: 1_200_000 } }),
  twoColumn: spec('twoColumn', { index: 3 }),
  problemSolution: spec('problemSolution', { index: 4 }),
  architectureOverview: spec('architectureOverview', { index: 5, titleSize: 2600 }),
  roadmap: spec('roadmap', { index: 6 }),
  riskMatrix: spec('riskMatrix', { index: 7 }),
  decisionSlide: spec('decisionSlide', { index: 8 }),
  diagramFocused: spec('diagramFocused', { index: 9, titleSize: 2400, title: { x: MARGIN_X, y: 200_000, cx: CONTENT_WIDTH, cy: 700_000 } }),
  comparisonTable: spec('comparisonTable', { index: 10 }),
  timeline: spec('timeline', { index: 11 }),
  metricsKpi: spec('metricsKpi', { index: 12 }),
  closingSlide: spec('closingSlide', { index: 13, title: { x: MARGIN_X, y: 2_400_000, cx: CONTENT_WIDTH, cy: 1_300_000 } }),
};

export const LAYOUT_ORDER = (Object.keys(LAYOUT_SPECS) as PresentationLayout[]).sort(
  (a, b) => LAYOUT_SPECS[a].index - LAYOUT_SPECS[b].index,
);

export const layoutSpecFor = (layout: string): LayoutSpec =>
  (LAYOUT_SPECS as Record<string, LayoutSpec | undefined>)[layout] ?? LAYOUT_SPECS.executiveSummary;
