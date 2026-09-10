import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { MarkdownView } from '../../../components/artifacts/markdown/MarkdownView';

const noop = () => {};

const baseProps = {
  markdownHtml: '<h2>Sección</h2><p>Texto renderizado.</p>',
  rawContent: '## Sección\n\nTexto renderizado.',
  representation: 'document' as const,
  showSource: false,
  onToggleSource: noop,
  markdownCopied: false,
  onCopyMarkdown: noop,
  onDownloadMarkdown: noop,
  pageSize: 'letter' as const,
  zoom: 100,
  pageWidthPx: 816,
  onChangePageSize: noop,
  onChangeZoom: noop,
};

describe('MarkdownView', () => {
  it('renders the rendered preview by default', () => {
    render(<MarkdownView {...baseProps} />);
    expect(screen.getByRole('heading', { name: 'Sección' })).toBeInTheDocument();
    expect(screen.getByText('Texto renderizado.')).toBeInTheDocument();
  });

  it('renders the raw .md source when showSource is enabled', () => {
    render(<MarkdownView {...baseProps} showSource />);
    expect(screen.getByText(/## Sección/)).toBeInTheDocument();
  });

  it('fires the copy and download callbacks from the toolbar', () => {
    const onCopyMarkdown = vi.fn();
    const onDownloadMarkdown = vi.fn();
    render(<MarkdownView {...baseProps} onCopyMarkdown={onCopyMarkdown} onDownloadMarkdown={onDownloadMarkdown} />);
    fireEvent.click(screen.getByRole('button', { name: /Copiar Markdown/i }));
    fireEvent.click(screen.getByRole('button', { name: /Descargar \.md/i }));
    expect(onCopyMarkdown).toHaveBeenCalledTimes(1);
    expect(onDownloadMarkdown).toHaveBeenCalledTimes(1);
  });

  it('switches to the source view through the preview/source toggle', () => {
    const onToggleSource = vi.fn();
    render(<MarkdownView {...baseProps} onToggleSource={onToggleSource} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fuente' }));
    expect(onToggleSource).toHaveBeenCalledWith(true);
  });
});
