import React from 'react';
import type { CapabilityLayer, CapabilityNode, LayerValue } from '../../services/enterpriseRepository';
import { cn } from '../ui/cn';

export interface CapabilityHeatmapProps {
  roots: readonly CapabilityNode[];
  layer: CapabilityLayer;
  t: (key: string, replacements?: Record<string, string>) => string;
  reducedMotion: boolean;
}

/** Five steps of one hue; the figure is always written in the cell, so hue never carries meaning alone. */
const STEPS = [
  'bg-primary-50 dark:bg-primary-950/40 border-primary-100 dark:border-primary-900/60',
  'bg-primary-100 dark:bg-primary-900/50 border-primary-200 dark:border-primary-800',
  'bg-primary-200 dark:bg-primary-800/60 border-primary-300 dark:border-primary-700',
  'bg-primary-300 dark:bg-primary-700/70 border-primary-400 dark:border-primary-600',
  'bg-primary-400 dark:bg-primary-600/80 border-primary-500 dark:border-primary-500',
] as const;
const UNMEASURED = 'bg-transparent border-dashed border-gray-300 dark:border-gray-600';

const stepFor = (intensity: number | null): string =>
  intensity === null ? UNMEASURED : STEPS[Math.min(STEPS.length - 1, Math.round(intensity * (STEPS.length - 1)))];

const INVESTMENT_KEYS = ['none', 'low', 'medium', 'high'] as const;
const RISK_KEYS = ['', 'low', 'medium', 'high'] as const;

export const describeLayerValue = (
  layer: CapabilityLayer,
  v: LayerValue,
  t: CapabilityHeatmapProps['t'],
): string => {
  if (v.value === null) return layer === 'coverage' ? t('cap.coverage.none') : t('cap.unmeasured');
  const raw = Math.round(v.value * 10) / 10;
  const base =
    layer === 'maturity'
      ? t('cap.value.maturity', { n: String(raw) })
      : layer === 'investment'
        ? t(`cap.investment.${INVESTMENT_KEYS[Math.round(v.value)] ?? 'none'}`)
        : layer === 'risk'
          ? t(`cap.risk.${RISK_KEYS[Math.round(v.value)] || 'low'}`)
          : t('cap.value.coverage', { n: String(raw) });
  return v.source === 'derived' ? `${base} · ${t('cap.derived')}` : base;
};

const Cell: React.FC<{ node: CapabilityNode } & Omit<CapabilityHeatmapProps, 'roots'>> = ({ node, layer, t, reducedMotion }) => {
  const value = node.layers[layer];
  const label = describeLayerValue(layer, value, t);
  return (
    <li className="list-none">
      <div
        className={cn(
          'rounded-xl border p-3',
          !reducedMotion && 'transition-colors duration-300',
          stepFor(value.intensity),
        )}
      >
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">
          <span className="mr-1.5 text-2xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
            {`L${node.level}`}
          </span>
          {node.item.name}
        </p>
        <p className="mt-0.5 text-xs text-gray-800 dark:text-gray-100">{label}</p>
        {node.supportingApplications.length > 0 && (
          <p className="mt-1 text-2xs text-gray-700 dark:text-gray-300">
            {t('cap.supportedBy', { apps: node.supportingApplications.map((a) => a.name).join(', ') })}
          </p>
        )}
        {node.children.length > 0 && (
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label={t('cap.children', { name: node.item.name })}>
            {node.children.map((child) => (
              <Cell key={child.item.id} node={child} layer={layer} t={t} reducedMotion={reducedMotion} />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
};

export const CapabilityHeatmap: React.FC<CapabilityHeatmapProps> = ({ roots, layer, t, reducedMotion }) => (
  <ul className="grid gap-3 lg:grid-cols-2" aria-label={t('cap.mapLabel')}>
    {roots.map((node) => (
      <Cell key={node.item.id} node={node} layer={layer} t={t} reducedMotion={reducedMotion} />
    ))}
  </ul>
);

export const CapabilityLegend: React.FC<{ layer: CapabilityLayer; t: CapabilityHeatmapProps['t'] }> = ({ layer, t }) => (
  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-700 dark:text-gray-200" role="group" aria-label={t('cap.legend.title')}>
    <span className="font-semibold">{t(`cap.legend.${layer}`)}</span>
    <span className="inline-flex items-center gap-1">
      <span className={cn('inline-block h-3 w-6 rounded border', STEPS[0])} aria-hidden="true" />
      {t('cap.legend.low')}
    </span>
    <span className="inline-flex items-center gap-1">
      <span className={cn('inline-block h-3 w-6 rounded border', STEPS[4])} aria-hidden="true" />
      {t('cap.legend.high')}
    </span>
    <span className="inline-flex items-center gap-1">
      <span className={cn('inline-block h-3 w-6 rounded border', UNMEASURED)} aria-hidden="true" />
      {t('cap.unmeasured')}
    </span>
  </div>
);
