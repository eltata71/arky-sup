/**
 * Shared shapes for the chart primitives.
 *
 * A segment always arrives with its own colour classes rather than an index
 * into a palette: colour follows the entity, so filtering a chart down to three
 * segments must never repaint the survivors.
 */

export interface ChartSegment {
  id: string;
  /** Written label. Always rendered — colour never carries meaning alone. */
  label: string;
  value: number;
  /** Tailwind `fill-*` classes, light and dark. For area and bar marks. */
  fill: string;
  /** Tailwind `stroke-*` classes, light and dark. For ring and line marks. */
  stroke: string;
  /** Tailwind `text-*` classes for the legend glyph and value. */
  ink: string;
  /** Tailwind `bg-*` classes for the legend swatch. */
  surface: string;
  /** Optional one-line explanation shown in the native tooltip. */
  hint?: string;
}

export interface ChartPoint {
  /** X label, already formatted for display. */
  label: string;
  value: number;
}

/** Sum of a segment list, guarding against negative inputs. */
export const sumSegments = (segments: readonly ChartSegment[]): number =>
  segments.reduce((total, segment) => total + Math.max(0, segment.value), 0);
