import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CapabilityHeatmap, CapabilityLegend, describeLayerValue } from '../../../components/capabilityMap/CapabilityHeatmap';
import type { CapabilityNode } from '../../../services/enterpriseRepository';

const t = (key: string, r?: Record<string, string>) =>
  r ? `${key}|${Object.values(r).join(',')}` : key;

const layers = (maturity: number | null) => ({
  maturity: { intensity: maturity === null ? null : (maturity - 1) / 4, value: maturity, source: maturity === null ? null : 'declared' },
  investment: { intensity: null, value: null, source: null },
  risk: { intensity: null, value: null, source: null },
  coverage: { intensity: 0, value: 0, source: 'derived' },
}) as CapabilityNode['layers'];

const node = (name: string, maturity: number | null, children: CapabilityNode[] = []): CapabilityNode => ({
  item: { id: name, name } as CapabilityNode['item'],
  level: 1,
  children,
  supportingApplications: [],
  initiativeIds: [],
  layers: layers(maturity),
});

describe('CapabilityHeatmap', () => {
  it('escribe el valor en cada celda y dice «sin medir» cuando no hay dato', () => {
    render(<CapabilityHeatmap roots={[node('Ventas', 3, [node('Cotización', null)])]} layer="maturity" t={t} reducedMotion />);
    expect(screen.getByText('Ventas')).toBeTruthy();
    expect(screen.getByText('cap.value.maturity|3')).toBeTruthy();
    expect(screen.getByText('cap.unmeasured')).toBeTruthy();
  });

  it('marca como derivado lo que no declaró nadie', () => {
    expect(describeLayerValue('coverage', { intensity: 0.3, value: 1, source: 'derived' }, t)).toContain('cap.derived');
  });

  it('la leyenda se dice en palabras', () => {
    render(<CapabilityLegend layer="risk" t={t} />);
    expect(screen.getByText('cap.legend.low')).toBeTruthy();
    expect(screen.getByText('cap.legend.high')).toBeTruthy();
    expect(screen.getByText('cap.unmeasured')).toBeTruthy();
  });
});
