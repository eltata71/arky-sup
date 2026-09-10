/**
 * Las tres formas nuevas del sistema de gráficos, comprobadas por sus reglas de
 * honestidad y no por su aspecto.
 *
 * Cada `it` corresponde a una afirmación escrita en el componente: si un día se
 * decide que un portafolio sin medir puede pintarse como 0 %, esta prueba es lo
 * que obliga a cambiar la decisión en voz alta.
 */

import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RadialGauge } from '../../../components/ui/charts/RadialGauge';
import { Sparkline } from '../../../components/ui/charts/Sparkline';
import { StatusBars } from '../../../components/ui/charts/StatusBars';
import { StatTile } from '../../../components/ui/charts/StatTile';
import { StatusDot } from '../../../components/ui/StatusDot';

describe('RadialGauge', () => {
  it('says a null value is unmeasured instead of drawing zero', () => {
    render(<RadialGauge value={null} title="Salud del portafolio" />);

    expect(screen.getByText('Sin medir')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /sin medir/i })).toBeInTheDocument();
  });

  it('names the band in the accessible label, never only in the hue', () => {
    render(<RadialGauge value={0.82} title="Salud del portafolio" bandLabel="Estable" />);

    expect(screen.getByRole('img', { name: 'Salud del portafolio: 82 %, Estable' })).toBeInTheDocument();
    expect(screen.getByText('Estable')).toBeInTheDocument();
  });

  it('clamps a ratio outside 0..1 rather than sweeping past the dial', () => {
    render(<RadialGauge value={1.4} title="Avance" />);

    expect(screen.getByRole('img', { name: 'Avance: 100 %' })).toBeInTheDocument();
  });
});

describe('Sparkline', () => {
  it('draws nothing from a single point, because one value is not a trend', () => {
    const { container } = render(<Sparkline values={[4]} />);

    expect(container.querySelector('svg')).toBeNull();
  });

  it('is hidden from assistive technology — the tile states the movement in words', () => {
    const { container } = render(<Sparkline values={[1, 4, 2, 8]} />);
    const svg = container.querySelector('svg');

    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('centres a flat series instead of pinning it to the floor', () => {
    const { container } = render(<Sparkline values={[5, 5, 5]} height={28} />);
    const line = container.querySelectorAll('path')[1];

    // Con altura 28 y padding 2, el centro del área útil está en y = 14.
    expect(line?.getAttribute('d')).toContain('14.00');
  });
});

describe('StatusBars', () => {
  const rows = [
    { id: 'a', label: 'Entregables bloqueados', value: 2, surface: 'bg-red-500', ink: 'text-red-700' },
    { id: 'b', label: 'Vínculos rotos', value: 8, surface: 'bg-amber-500', ink: 'text-amber-700' },
  ];

  it('renders the empty message instead of a set of empty tracks', () => {
    render(
      <StatusBars
        rows={rows.map((row) => ({ ...row, value: 0 }))}
        title="Señales"
        emptyMessage="Nada reclama atención ahora mismo."
      />,
    );

    expect(screen.getByText('Nada reclama atención ahora mismo.')).toBeInTheDocument();
    expect(screen.queryByText('Vínculos rotos')).not.toBeInTheDocument();
  });

  it('writes every label, so no row is identified by its colour alone', () => {
    render(<StatusBars rows={rows} title="Señales" />);

    expect(screen.getByText('Entregables bloqueados')).toBeInTheDocument();
    expect(screen.getByText('Vínculos rotos')).toBeInTheDocument();
  });
});

describe('StatTile', () => {
  it('draws no delta without a stated baseline', () => {
    render(<StatTile label="Tareas" value={12} delta={5} />);

    expect(screen.queryByText('+5')).not.toBeInTheDocument();
  });

  it('shows the delta once a baseline is stated', () => {
    render(<StatTile label="Tareas" value={12} delta={5} since="vs. 7 días previos" goodDirection="up" />);

    expect(screen.getByText('+5')).toBeInTheDocument();
    expect(screen.getByText('vs. 7 días previos')).toBeInTheDocument();
  });

  it('does not colour a flat delta as an outcome', () => {
    render(<StatTile label="Tareas" value={12} delta={0} since="vs. 7 días previos" goodDirection="up" />);

    const delta = screen.getByText('0').closest('p');
    expect(delta?.className).toContain('text-gray-500');
  });
});

describe('StatusDot', () => {
  it('always carries the state in words, even when only the dot is drawn', () => {
    // Un punto sin nombre es una decoración que lleva el dato más importante de
    // la fila. WCAG 1.4.1 no se satisface con una leyenda en otra parte.
    render(<StatusDot tone="critical" label="Entregable bloqueado" />);

    expect(screen.getByText('Entregable bloqueado')).toHaveClass('sr-only');
  });

  it('gives each of the four severities its own silhouette, in one shared box', () => {
    // El color no puede ser lo único: en escala de grises, en una impresión o
    // en un proyector malo, la forma es lo que queda. Y todas caben en la misma
    // caja de 10 px, o una columna de puntos deja de alinearse.
    const shapes = (['success', 'warning', 'risk', 'critical'] as const).map((tone) => {
      const { container, unmount } = render(<StatusDot tone={tone} />);
      const dot = container.querySelector('span > span:last-child');
      const className = dot?.className ?? '';
      unmount();
      return className;
    });

    expect(new Set(shapes).size).toBe(4);
    expect(shapes.every((className) => className.includes('h-full w-full'))).toBe(true);
  });

  it('pulses only when asked, and never for a reader who opted out of motion', () => {
    const { container } = render(<StatusDot tone="info" pulse />);
    const ping = container.querySelector('.motion-safe\\:animate-ping');

    expect(ping).not.toBeNull();
    expect(ping?.className).toContain('motion-reduce:hidden');
  });
});
