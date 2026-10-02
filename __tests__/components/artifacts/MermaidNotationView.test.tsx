import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// A plain function, not `vi.fn()`: the spy tracks a returned promise and
// re-reports its rejection even when the component handles it.
type RenderImpl = (id: string, source: string) => Promise<{ svg: string }>;
const calls: Array<[string, string]> = [];
let renderImpl: RenderImpl = async () => ({ svg: '<svg></svg>' });
vi.mock('mermaid', () => ({
  default: {
    initialize: () => {},
    render: (id: string, source: string) => {
      calls.push([id, source]);
      return renderImpl(id, source);
    },
  },
}));

import { MermaidNotationView } from '../../../components/artifacts/diagram/MermaidNotationView';

const SEQUENCE = 'sequenceDiagram\n  A->>B: Solicita\n  loop cada día\n    B-->>A: Estado\n  end';

describe('MermaidNotationView (8.3a)', () => {
  beforeEach(() => {
    calls.length = 0;
    renderImpl = async () => ({ svg: '<svg></svg>' });
  });

  it('dibuja el texto guardado con Mermaid, tal cual', async () => {
    renderImpl = async () => ({ svg: '<svg height="300"><g class="actor-line"></g></svg>' });
    render(<MermaidNotationView source={SEQUENCE} artifactName="Autorización" onViewText={() => {}} />);
    const img = await screen.findByRole('img', { name: 'Diagrama «Autorización» en su notación' });
    expect(img.querySelector('.actor-line')).not.toBeNull();
    expect(img.getAttribute('height')).toBeNull();
    expect(calls).toEqual([[expect.stringMatching(/^notation-/), SEQUENCE]]);
  });

  it('si Mermaid rechaza el texto, lo dice y ofrece verlo como texto', async () => {
    renderImpl = async () => { throw new Error('Parse error on line 2'); };
    const onViewText = vi.fn();
    render(<MermaidNotationView source={SEQUENCE} artifactName="X" onViewText={onViewText} />);
    expect(await screen.findByText('No se pudo dibujar la notación')).toBeInTheDocument();
    expect(screen.getByText(/Parse error on line 2/)).toBeInTheDocument();
  });

  it('sin texto Mermaid no llama al dibujante', async () => {
    render(<MermaidNotationView source={null} artifactName="X" onViewText={() => {}} />);
    expect(await screen.findByText('No se pudo dibujar la notación')).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('el zoom se maneja con botones', async () => {
    render(<MermaidNotationView source={SEQUENCE} artifactName="X" onViewText={() => {}} />);
    await waitFor(() => expect(screen.getByRole('group', { name: 'Zoom de la notación' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Acercar' }));
    expect(screen.getByRole('button', { name: 'Restablecer zoom' })).toHaveTextContent('125 %');
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer zoom' }));
    expect(screen.getByRole('button', { name: 'Restablecer zoom' })).toHaveTextContent('100 %');
  });
});
