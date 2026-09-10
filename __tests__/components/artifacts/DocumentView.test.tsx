import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { DocumentView } from '../../../components/artifacts/document/DocumentView';

const noop = () => {};

const baseProps = {
  pageSize: 'letter' as const,
  zoom: 100,
  pageWidthPx: 816,
  onChangePageSize: noop,
  onChangeZoom: noop,
  onEdit: noop,
  onExport: noop,
};

describe('DocumentView', () => {
  it('renders the sanitized markdown HTML inside the paper surface', () => {
    render(
      <DocumentView
        {...baseProps}
        markdownHtml="<h1>Arquitectura</h1><p>Resumen ejecutivo.</p>"
        rawContent="# Arquitectura"
      />,
    );
    expect(screen.getByRole('heading', { name: 'Arquitectura' })).toBeInTheDocument();
    expect(screen.getByText('Resumen ejecutivo.')).toBeInTheDocument();
  });

  it('renders the document toolbar with size and export affordances', () => {
    render(<DocumentView {...baseProps} markdownHtml="<p>x</p>" rawContent="x" />);
    expect(screen.getByText('Tamaño')).toBeInTheDocument();
    expect(screen.getByTitle('Exportar documento')).toBeInTheDocument();
  });

  it('shows a recoverable fallback (never blank) when the HTML is empty', () => {
    render(<DocumentView {...baseProps} markdownHtml="" rawContent="Contenido bruto del artefacto" />);
    expect(screen.getByText('Contenido bruto del artefacto')).toBeInTheDocument();
  });

  it('fires onExport when the export button is pressed', () => {
    const onExport = vi.fn();
    render(<DocumentView {...baseProps} onExport={onExport} markdownHtml="<p>x</p>" rawContent="x" />);
    fireEvent.click(screen.getByTitle('Exportar documento'));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
