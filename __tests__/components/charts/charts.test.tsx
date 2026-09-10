import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DonutChart, FlowBars, StackedBar, StatTile, TrendArea } from '../../../components/ui/charts';
import type { ChartSegment } from '../../../components/ui/charts';
import { CheckCircle2 } from 'lucide-react';

const segment = (id: string, label: string, value: number): ChartSegment => ({
  id,
  label,
  value,
  fill: 'fill-[#4f46e5] dark:fill-[#6366f1]',
  stroke: 'stroke-[#4f46e5] dark:stroke-[#6366f1]',
  ink: 'text-[#4f46e5] dark:text-[#6366f1]',
  surface: 'bg-[#4f46e5] dark:bg-[#6366f1]',
});

describe('DonutChart', () => {
  const segments = [
    segment('blocked', 'Bloqueado', 2),
    segment('running', 'En ejecución', 5),
    segment('delivered', 'Entregado', 3),
  ];

  it('names every segment and its value, so hue never carries the meaning alone', () => {
    render(<DonutChart segments={segments} title="Encargos por estado" />);
    for (const item of segments) {
      expect(screen.getByText(item.label)).toBeInTheDocument();
    }
    expect(screen.getByRole('img', { name: 'Encargos por estado' })).toBeInTheDocument();
  });

  it('puts the total in the hole unless the caller overrides it', () => {
    const { rerender } = render(<DonutChart segments={segments} title="t" centerLabel="Encargos" />);
    expect(screen.getByText('10')).toBeInTheDocument();

    rerender(<DonutChart segments={segments} title="t" centerValue="73 %" centerLabel="Avance" />);
    expect(screen.getByText('73 %')).toBeInTheDocument();
  });

  it('keeps a zero-value segment in the legend rather than silently dropping it', () => {
    render(<DonutChart segments={[...segments, segment('idle', 'En preparación', 0)]} title="t" />);
    expect(screen.getByText('En preparación')).toBeInTheDocument();
  });

  it('renders without an arc when there is nothing to show', () => {
    render(<DonutChart segments={[segment('idle', 'En preparación', 0)]} title="Vacío" />);
    expect(screen.getByRole('img', { name: 'Vacío' })).toBeInTheDocument();
    // The hero figure and the legend value both read zero.
    expect(screen.getAllByText('0')).toHaveLength(2);
  });
});

describe('StackedBar', () => {
  it('spells the whole distribution into its accessible name', () => {
    render(
      <StackedBar
        segments={[segment('a', 'Bloqueado', 1), segment('b', 'Entregado', 3)]}
        title="Estado de NEG-2026-001"
      />,
    );
    const bar = screen.getByRole('img');
    expect(bar).toHaveAccessibleName(/Estado de NEG-2026-001.*Bloqueado: 1.*Entregado: 3/);
  });

  it('can drop the legend for dense rows without losing the accessible name', () => {
    render(
      <StackedBar
        segments={[segment('a', 'Bloqueado', 1)]}
        title="Compacto"
        showLegend={false}
      />,
    );
    expect(screen.queryByText('Bloqueado')).not.toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName(/Bloqueado: 1/);
  });
});

describe('TrendArea', () => {
  const points = [
    { label: '25 ago', value: 1 },
    { label: '26 ago', value: 4 },
    { label: '27 ago', value: 2 },
  ];

  it('says so plainly when there is no activity yet', () => {
    render(<TrendArea points={[]} title="Tareas" />);
    expect(screen.getByText(/todavía no hay actividad/i)).toBeInTheDocument();
  });

  it('offers the numbers as a table, so the hover layer is never the only way in', () => {
    render(<TrendArea points={points} title="Tareas completadas por día" />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver datos' }));

    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '26 ago' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ocultar datos' })).toBeInTheDocument();
  });

  it('carries the period total in the accessible name', () => {
    render(<TrendArea points={points} title="Tareas completadas por día" />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/7 en total/);
  });
});

describe('StatTile', () => {
  it('keeps the meter decorative, because the value already states it', () => {
    // This used to assert a `progressbar` named after the tile. That made
    // VoiceOver announce the label, the number, and then the label and number
    // again — the tile's own value is the same ratio in words.
    const { container } = render(<StatTile label="Avance" value="73 %" meter={0.73} />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('73 %')).toBeInTheDocument();
    const track = container.querySelector('[aria-hidden="true"] > div') as HTMLElement | null;
    expect(track?.style.width).toBe('73%');
  });

  it('clamps a meter that overshoots instead of overflowing the track', () => {
    const { container } = render(<StatTile label="Presupuesto" value="50/40" meter={1.25} />);
    const track = container.querySelector('[aria-hidden="true"] > div') as HTMLElement | null;
    expect(track?.style.width).toBe('100%');
  });

  it('becomes a pressable filter only when it is given an action', () => {
    const onClick = vi.fn();
    const { rerender } = render(<StatTile label="Decisiones" value={3} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(<StatTile label="Decisiones" value={3} onClick={onClick} active />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('FlowBars', () => {
  it('lists every stage with its count, including the empty ones', () => {
    render(
      <FlowBars
        title="Tareas por etapa"
        stages={[
          { id: 'queued', label: 'En cola', value: 0, surface: 'bg-gray-400', ink: 'text-gray-500', icon: CheckCircle2 },
          { id: 'done', label: 'Completadas', value: 5, surface: 'bg-[#059669]', ink: 'text-[#047857]', icon: CheckCircle2 },
        ]}
      />,
    );
    expect(screen.getByRole('list', { name: 'Tareas por etapa' })).toBeInTheDocument();
    expect(screen.getByText('En cola')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('makes a stage clickable when it can be drilled into', () => {
    const onSelect = vi.fn();
    render(
      <FlowBars
        title="Tareas por etapa"
        stages={[
          { id: 'done', label: 'Completadas', value: 5, surface: 'bg-[#059669]', ink: 'text-[#047857]', icon: CheckCircle2, onSelect },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
