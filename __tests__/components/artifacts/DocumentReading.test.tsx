import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DocumentView from '../../../components/artifacts/document/DocumentView';
import { renderDocumentMarkdown } from '../../../hooks/artifacts/useDocumentRendering';

vi.mock('../../../components/artifacts/CommentThread', () => ({
  default: (p: { filterAnchor?: { sectionId: string } }) => <div data-testid="thread">{p.filterAnchor?.sectionId}</div>,
}));

beforeEach(() => { window.history.replaceState(null, '', '#'); });
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const toc = [
  { id: 'doc-h-uno', text: 'Uno', level: 1 },
  { id: 'doc-h-dos', text: 'Dos', level: 2 },
  { id: 'doc-h-tres', text: 'Tres', level: 3 },
];
const html = '<h1 id="doc-h-uno">Uno</h1><h2 id="doc-h-dos">Dos</h2><h3 id="doc-h-tres">Tres</h3>';
const base = {
  markdownHtml: html, rawContent: '', pageSize: 'a4' as const, zoom: 100, pageWidthPx: 800,
  onChangePageSize: vi.fn(), onChangeZoom: vi.fn(), onEdit: vi.fn(), onExport: vi.fn(), toc,
};

describe('lectura editorial del documento', () => {
  it('el índice lateral refleja la jerarquía y marca la sección activa', () => {
    render(<DocumentView {...base} />);
    const nav = screen.getByRole('navigation', { name: 'Índice del documento' });
    expect(nav.querySelectorAll('a')).toHaveLength(3);
    expect(nav.querySelector('a[aria-current="location"]')?.textContent).toBe('Uno');
    fireEvent.click(nav.querySelectorAll('a')[2]);
    expect(nav.querySelector('a[aria-current="location"]')?.textContent).toBe('Tres');
    expect(window.location.hash).toBe('#doc-h-tres');
  });
  it('[ y ] pasan entre secciones', () => {
    render(<DocumentView {...base} />);
    const scroller = screen.getByLabelText(/^Documento\./);
    fireEvent.keyDown(scroller, { key: ']' });
    expect(screen.getByRole('navigation', { name: 'Índice del documento' }).querySelector('[aria-current]')?.textContent).toBe('Dos');
    fireEvent.keyDown(scroller, { key: '[' });
    expect(screen.getByRole('navigation', { name: 'Índice del documento' }).querySelector('[aria-current]')?.textContent).toBe('Uno');
  });
  it('el modo revisión ancla los comentarios a la sección activa', () => {
    render(<DocumentView {...base} review={{ artifactId: 'a', projectId: 'p', author: { id: 'u', name: 'U' } as never }} />);
    expect(screen.queryByTestId('thread')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Revisión' }));
    expect(screen.getByTestId('thread').textContent).toBe('doc-h-uno');
  });
  it('las tablas se envuelven en una región con desplazamiento', async () => {
    const { html: out } = await renderDocumentMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(out).toContain('doc-table-scroll');
  });
});
