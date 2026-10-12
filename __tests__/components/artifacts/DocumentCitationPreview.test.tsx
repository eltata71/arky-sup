import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DocumentPaper from '../../../components/artifacts/document/DocumentPaper';
import { sanitizeGeneratedHtml } from '../../../lib/security';
import { decorateContextCitationsHtml } from '../../../lib/artifacts/contextCitations';
import type { ContextManifest } from '../../../lib/artifacts/contextManifest';

const manifest = {
  records: [{ citations: [{ tag: '[ctx:tech-1]', label: 'Kafka', entityType: 'technology', sources: ['Notas de arquitectura'] }] }],
} as unknown as ContextManifest;

const html = () => sanitizeGeneratedHtml(decorateContextCitationsHtml('<p>Usa [ctx:tech-1] y [ctx:risk-9].</p>', manifest));

describe('vista previa de la fuente en los chips [ctx:*] (12.2)', () => {
  it('muestra etiqueta, tipo y fuente al tomar el foco y se cierra con Esc', () => {
    render(<DocumentPaper html={html()} widthPx={800} zoom={100} />);
    const chip = screen.getByText('Kafka');
    expect(chip).toHaveAttribute('tabindex', '0');
    expect(chip).not.toHaveAttribute('title');
    fireEvent.focus(chip);
    const preview = screen.getByRole('status');
    expect(preview).toHaveTextContent('Tipo: technology');
    expect(preview).toHaveTextContent('Fuente: Notas de arquitectura');
    fireEvent.keyDown(chip, { key: 'Escape' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('también aparece al pasar el cursor y no se abre para citas sin resolver', () => {
    render(<DocumentPaper html={html()} widthPx={800} zoom={100} />);
    fireEvent.mouseOver(screen.getByText(/ctx:risk-9/));
    expect(screen.queryByRole('status')).toBeNull();
    const chip = screen.getByText('Kafka');
    fireEvent.mouseOver(chip);
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.mouseOut(chip);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
