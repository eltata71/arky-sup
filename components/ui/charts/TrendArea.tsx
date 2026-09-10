/**
 * Throughput over time — a thin line over a soft area fill, with a crosshair
 * and a tooltip on hover and on keyboard focus.
 *
 * One series only, so no legend box: the title names it. Values are labelled
 * selectively (first, last and peak) rather than on every point, and the
 * underlying numbers are always reachable as a table for anyone who cannot use
 * the hover layer.
 */

import React, { useCallback, useId, useMemo, useState } from 'react';
import { cn } from '../cn';
import { ChartEmptyState } from './ChartEmptyState';
import type { ChartPoint } from './chartTypes';

export interface TrendAreaProps {
  points: ChartPoint[];
  /** Accessible name of the series, e.g. "Tareas completadas por día". */
  title: string;
  /** Tailwind `stroke-*` classes for the line. */
  stroke?: string;
  /** Tailwind `fill-*` classes for the area. */
  fill?: string;
  /** Tailwind `fill-*` classes for the peak marker. Must match `stroke`. */
  markFill?: string;
  height?: number;
  /** Suffix appended to the tooltip value, e.g. "tareas". */
  /** Shown instead of the plot when there is nothing to trend. */
  emptyMessage?: string;
  unit?: string;
  className?: string;
}

const VIEW_WIDTH = 600;

export const TrendArea: React.FC<TrendAreaProps> = ({
  points,
  title,
  stroke = 'stroke-[#4f46e5] dark:stroke-[#6366f1]',
  // Opacity modifiers must be on Tailwind's scale (…/10, /20, /25). An
  // off-scale step such as /12 compiles to nothing and the path falls back to
  // SVG's default black fill.
  fill = 'fill-[#4f46e5]/10 dark:fill-[#6366f1]/20',
  markFill = 'fill-[#4f46e5] dark:fill-[#6366f1]',
  height = 132,
  unit,
  emptyMessage,
  className,
}) => {
  const [hovered, setHovered] = useState<number | null>(null);
  const tableId = useId();
  const [tableOpen, setTableOpen] = useState(false);

  const geometry = useMemo(() => {
    if (points.length === 0) return null;
    const max = Math.max(1, ...points.map((point) => point.value));
    const padTop = 10;
    const usable = height - padTop - 18; // leave room for the baseline label row
    const step = points.length > 1 ? VIEW_WIDTH / (points.length - 1) : 0;
    const coords = points.map((point, index) => ({
      x: points.length > 1 ? index * step : VIEW_WIDTH / 2,
      y: padTop + usable - (point.value / max) * usable,
      point,
    }));
    const line = coords.map((coord, index) => `${index === 0 ? 'M' : 'L'}${coord.x.toFixed(1)},${coord.y.toFixed(1)}`).join(' ');
    const baseline = padTop + usable;
    const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${baseline} L${coords[0].x.toFixed(1)},${baseline} Z`;
    const peakIndex = coords.reduce((best, coord, index) => (
      coord.point.value > coords[best].point.value ? index : best
    ), 0);
    return { coords, line, area, baseline, max, peakIndex };
  }, [points, height]);

  const handleMove = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    if (!geometry) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.round(ratio * (points.length - 1));
    setHovered(Math.max(0, Math.min(points.length - 1, index)));
  }, [geometry, points.length]);

  // A flat line pinned to zero is a chart of nothing, exactly like an empty
  // ring: it occupies the authority of a figure and reports no signal.
  const hasSignal = points.some((point) => point.value > 0);
  if (!geometry || !hasSignal) {
    return (
      <ChartEmptyState
        message={emptyMessage ?? 'Todavía no hay actividad registrada.'}
        className={className}
      />
    );
  }

  const active = hovered === null ? null : geometry.coords[hovered];
  const total = points.reduce((sum, point) => sum + point.value, 0);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="relative">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
          className="w-full"
          style={{ height }}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${title}. ${total} en total en el periodo.`}
          onMouseMove={handleMove}
          onMouseLeave={() => setHovered(null)}
        >
          {/* Recessive baseline — no full grid, the shape carries the reading. */}
          <line
            x1={0}
            y1={geometry.baseline}
            x2={VIEW_WIDTH}
            y2={geometry.baseline}
            strokeWidth={1}
            className="stroke-gray-200 dark:stroke-gray-800"
          />
          <path d={geometry.area} className={fill} />
          <path
            d={geometry.line}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            className={stroke}
            vectorEffect="non-scaling-stroke"
          />
          {/* Peak marker — one selective label instead of a number per point. */}
          <circle
            cx={geometry.coords[geometry.peakIndex].x}
            cy={geometry.coords[geometry.peakIndex].y}
            r={4}
            className={cn(markFill, 'stroke-white dark:stroke-gray-900')}
            strokeWidth={2}
          />
          {active && (
            <>
              <line
                x1={active.x}
                y1={0}
                x2={active.x}
                y2={geometry.baseline}
                strokeWidth={1}
                strokeDasharray="3 3"
                className="stroke-gray-400 dark:stroke-gray-600"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={active.x}
                cy={active.y}
                r={5}
                className="fill-white stroke-gray-900 dark:fill-gray-900 dark:stroke-gray-100"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>

        {active && (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-gray-900 px-2 py-1 text-2xs font-medium text-white shadow-pop dark:bg-gray-100 dark:text-gray-900"
            style={{ left: `${(active.x / VIEW_WIDTH) * 100}%` }}
            role="status"
          >
            {active.point.label} · {active.point.value}{unit ? ` ${unit}` : ''}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-2xs text-gray-400 dark:text-gray-500">
        <span>{points[0]?.label}</span>
        <button
          type="button"
          onClick={() => setTableOpen((open) => !open)}
          aria-expanded={tableOpen}
          aria-controls={tableId}
          className="font-medium text-gray-500 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded dark:text-gray-400"
        >
          {tableOpen ? 'Ocultar datos' : 'Ver datos'}
        </button>
        <span>{points[points.length - 1]?.label}</span>
      </div>

      {/* The table view: the hover layer is a convenience, never the only way
          to reach the numbers. */}
      {tableOpen && (
        <div id={tableId} className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800">
          <table className="w-full text-2xs">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900">
              <tr>
                <th scope="col" className="px-2 py-1 text-left font-semibold text-gray-500 dark:text-gray-400">Día</th>
                <th scope="col" className="px-2 py-1 text-right font-semibold text-gray-500 dark:text-gray-400">Valor</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.label} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-2 py-1 text-gray-600 dark:text-gray-300">{point.label}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-900 dark:text-gray-100">{point.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default TrendArea;
