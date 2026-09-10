/**
 * A chart of nothing is not a chart.
 *
 * With an empty portfolio the donut drew a grey ring, a "0" and a legend of
 * five zeros; the ranked bars drew five empty tracks; the trend drew a line
 * pinned to the baseline. Each occupied the space and authority of a figure
 * while carrying no information, and read as a rendering fault rather than as
 * an accurate report of an empty portfolio.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DonutChart, FlowBars, TrendArea, StatTile } from '../../../components/ui/charts';
import { Hourglass, PlayCircle } from 'lucide-react';

const segments = [
  { id: 'a', label: 'Bloqueado', value: 0, fill: 'fill-[#dc2626]', stroke: 'stroke-[#dc2626]', surface: 'bg-[#dc2626]', ink: 'text-[#dc2626]' },
  { id: 'b', label: 'En ejecución', value: 0, fill: 'fill-[#4f46e5]', stroke: 'stroke-[#4f46e5]', surface: 'bg-[#4f46e5]', ink: 'text-[#4f46e5]' },
];

const stages = [
  { id: 'q', label: 'En cola', value: 0, surface: 'bg-gray-400', ink: 'text-gray-500', icon: Hourglass },
  { id: 'r', label: 'En curso', value: 0, surface: 'bg-[#4f46e5]', ink: 'text-[#4f46e5]', icon: PlayCircle },
];

describe('charts with nothing to plot', () => {
  it('replaces an all-zero donut with the reason it is empty', () => {
    render(
      <DonutChart
        segments={segments}
        title="Entregables por estado"
        emptyMessage="Ningún entregable abierto todavía."
      />,
    );
    expect(screen.getByText('Ningún entregable abierto todavía.')).toBeInTheDocument();
    // No ring, and no legend of zeros pretending to be a distribution.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('Bloqueado')).not.toBeInTheDocument();
  });

  it('still draws the donut as soon as one segment carries a value', () => {
    render(
      <DonutChart
        segments={[{ ...segments[0], value: 3 }, segments[1]]}
        title="Entregables por estado"
        emptyMessage="Ningún entregable abierto todavía."
      />,
    );
    expect(screen.getByRole('img', { name: 'Entregables por estado' })).toBeInTheDocument();
    expect(screen.queryByText('Ningún entregable abierto todavía.')).not.toBeInTheDocument();
  });

  it('replaces all-zero bars with the reason, and keeps them otherwise', () => {
    const { rerender } = render(
      <FlowBars stages={stages} title="Tareas por etapa" emptyMessage="Sin tareas planificadas." />,
    );
    expect(screen.getByText('Sin tareas planificadas.')).toBeInTheDocument();

    rerender(
      <FlowBars
        stages={[{ ...stages[0], value: 4 }, stages[1]]}
        title="Tareas por etapa"
        emptyMessage="Sin tareas planificadas."
      />,
    );
    expect(screen.getByLabelText('Tareas por etapa')).toBeInTheDocument();
  });

  it('refuses to draw a trend line pinned to zero', () => {
    render(
      <TrendArea
        points={[{ label: 'lun', value: 0 }, { label: 'mar', value: 0 }]}
        title="Tareas completadas"
        emptyMessage="Sin tareas completadas en los últimos días."
      />,
    );
    expect(screen.getByText('Sin tareas completadas en los últimos días.')).toBeInTheDocument();
  });

  it('keeps drawing the chart when a caller supplies no message', () => {
    // The empty state is opt-in: only the caller knows what would fill it, so a
    // chart without a message must not silently disappear.
    render(<DonutChart segments={segments} title="Sin mensaje" />);
    expect(screen.getByRole('img', { name: 'Sin mensaje' })).toBeInTheDocument();
  });
});

describe('StatTile hierarchy', () => {
  it('marks the meter decorative, since the value above says the same thing', () => {
    // A progressbar named after the tile made VoiceOver announce the label, the
    // number, and then the label and number again.
    render(<StatTile label="Avance de tareas" value="55 %" meter={0.55} />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('55 %')).toBeInTheDocument();
  });

  it('makes a finding look like a finding, and leaves a count calm', () => {
    const { container, rerender } = render(<StatTile label="Sin iniciativa" value={3} tone="danger" />);
    const findingClasses = container.firstElementChild?.className ?? '';
    expect(findingClasses).toContain('bg-red-50/60');

    rerender(<StatTile label="Proyectos" value={4} tone="primary" />);
    const countClasses = container.firstElementChild?.className ?? '';
    expect(countClasses).toContain('bg-white');
    expect(countClasses).not.toContain('bg-red-50/60');
  });
});
