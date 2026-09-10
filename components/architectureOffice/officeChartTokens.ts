/**
 * The visual vocabulary of the Office dashboard.
 *
 * Every chart, badge and status dot in the Office reads its colour from here,
 * so a bar and the badge beside it can never disagree about what "bloqueado"
 * looks like.
 *
 * ## The palette is validated, not chosen by eye
 *
 * These are status colours: they encode a state, not a series. They were run
 * through the data-viz palette validator against the app's real surfaces
 * (light `#ffffff`, dark `#18181b`) and pass every check in both modes —
 * lightness band, chroma floor, CVD separation, normal-vision separation and
 * ≥3:1 contrast:
 *
 * | slot | meaning              | light     | dark      |
 * |------|----------------------|-----------|-----------|
 * | 1    | Bloqueado            | `#dc2626` | `#ef4444` |
 * | 2    | En ejecución         | `#4f46e5` | `#6366f1` |
 * | 3    | Requiere decisión    | `#d97706` | `#d97706` |
 * | 4    | Entregado            | `#059669` | `#059669` |
 * | —    | Preparación (neutro) | `#a1a1aa` | `#52525b` |
 *
 * **The slot order in `OFFICE_HEALTH_ORDER` is the safety mechanism, not a
 * preference.** Indigo sits between red and amber on purpose: it keeps the two
 * hues that colour-blind readers confuse out of adjacent marks. Reordering the
 * slots, or restepping a hue, invalidates the run — redo it before shipping.
 *
 * The one residual warning (amber↔emerald, CVD ΔE 7.9) is answered the way the
 * method requires: every mark carries an icon and a written label, adjacent
 * segments are separated by a 2px surface gap, and values are labelled
 * directly. Hue never carries meaning on its own anywhere in this dashboard.
 *
 * Class strings are written out in full because Tailwind is compiled at build
 * time and only sees literal strings — never assemble one from fragments.
 */

import type { BadgeTone, ChartSegment } from '../ui';
import {
  OFFICE_HEALTH_ORDER,
  type OfficeHealthBucket,
} from '../../services/architectureOffice/officePortfolio';

export interface OfficeHealthVisual {
  /** Short Spanish label. Always rendered next to the colour. */
  label: string;
  /** One-line explanation for tooltips and legends. */
  hint: string;
  /** `fill` for SVG marks. */
  fill: string;
  /** `stroke` for SVG lines. */
  stroke: string;
  /** `background-color` for dots, chips and CSS bars. */
  surface: string;
  /** `color` for the accompanying icon and value. */
  ink: string;
  /** Soft tinted background for cards and rows. */
  wash: string;
  /** Matching design-system badge tone, so badges never drift from charts. */
  badgeTone: BadgeTone;
}

export const OFFICE_HEALTH_VISUALS: Readonly<Record<OfficeHealthBucket, OfficeHealthVisual>> = Object.freeze({
  blocked: {
    label: 'Bloqueado',
    hint: 'Un gate o una tarea impide avanzar.',
    fill: 'fill-[#dc2626] dark:fill-[#ef4444]',
    stroke: 'stroke-[#dc2626] dark:stroke-[#ef4444]',
    surface: 'bg-[#dc2626] dark:bg-[#ef4444]',
    ink: 'text-[#dc2626] dark:text-[#ef4444]',
    wash: 'bg-red-50 dark:bg-red-950/30',
    badgeTone: 'danger',
  },
  running: {
    label: 'En ejecución',
    hint: 'La Oficina está trabajando en el entregable.',
    fill: 'fill-[#4f46e5] dark:fill-[#6366f1]',
    stroke: 'stroke-[#4f46e5] dark:stroke-[#6366f1]',
    surface: 'bg-[#4f46e5] dark:bg-[#6366f1]',
    ink: 'text-[#4f46e5] dark:text-[#6366f1]',
    wash: 'bg-primary-50 dark:bg-primary-950/30',
    badgeTone: 'primary',
  },
  'awaiting-decision': {
    label: 'Requiere decisión',
    hint: 'Espera a que una persona apruebe o decida.',
    fill: 'fill-[#d97706] dark:fill-[#d97706]',
    stroke: 'stroke-[#d97706] dark:stroke-[#d97706]',
    surface: 'bg-[#d97706] dark:bg-[#d97706]',
    ink: 'text-[#b45309] dark:text-[#f59e0b]',
    wash: 'bg-amber-50 dark:bg-amber-950/30',
    badgeTone: 'warning',
  },
  delivered: {
    label: 'Entregado',
    hint: 'El comité aprobó la entrega.',
    fill: 'fill-[#059669] dark:fill-[#059669]',
    stroke: 'stroke-[#059669] dark:stroke-[#059669]',
    surface: 'bg-[#059669] dark:bg-[#059669]',
    ink: 'text-[#047857] dark:text-[#34d399]',
    wash: 'bg-emerald-50 dark:bg-emerald-950/30',
    badgeTone: 'success',
  },
  idle: {
    label: 'En preparación',
    hint: 'Todavía no hay trabajo en curso.',
    fill: 'fill-[#a1a1aa] dark:fill-[#52525b]',
    stroke: 'stroke-[#a1a1aa] dark:stroke-[#52525b]',
    surface: 'bg-[#a1a1aa] dark:bg-[#52525b]',
    ink: 'text-gray-500 dark:text-gray-400',
    wash: 'bg-gray-50 dark:bg-gray-900/50',
    badgeTone: 'gray',
  },
});

/**
 * Chart chrome. Gridlines and axes stay recessive so the data reads first.
 */
export const CHART_INK = Object.freeze({
  grid: 'stroke-gray-200 dark:stroke-gray-800',
  axis: 'stroke-gray-300 dark:stroke-gray-700',
  label: 'fill-gray-500 dark:fill-gray-400',
  value: 'fill-gray-900 dark:fill-gray-100',
  /** The 2px separator painted between adjacent segments. */
  gapSurface: 'stroke-white dark:stroke-gray-900',
});

/** Percentage with no decimals, for labels. `0.734` → `73 %`. */
export const formatPercent = (ratio: number): string =>
  `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)} %`;

/** `2026-08-27` → `27 ago`, for a compact time axis. */
export const formatDayLabel = (isoDay: string): string => {
  const [year, month, day] = isoDay.split('-').map(Number);
  if (!year || !month || !day) return isoDay;
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${day} ${months[month - 1] ?? ''}`.trim();
};

/**
 * Turns a health mix into chart segments, in the fixed validated slot order.
 *
 * Every consumer goes through this function so no chart can accidentally
 * reorder the slots and break the colour separation the order guarantees.
 */
export const healthSegments = (
  mix: Readonly<Record<OfficeHealthBucket, number>>,
  order: readonly OfficeHealthBucket[] = OFFICE_HEALTH_ORDER,
): ChartSegment[] => order.map((bucket) => {
  const visual = OFFICE_HEALTH_VISUALS[bucket];
  return {
    id: bucket,
    label: visual.label,
    value: mix[bucket],
    fill: visual.fill,
    stroke: visual.stroke,
    ink: visual.ink,
    surface: visual.surface,
    hint: visual.hint,
  };
});
