import { describe, it, expect } from 'vitest';
import { buildPdfBlob } from '../../../services/export/adapters/pdfExporter';
import type { Artifact } from '../../../types';

const artifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'art-pdf-1',
  versionGroupId: 'vg-1',
  version: 1,
  createdAt: '2026-05-13T00:00:00.000Z',
  name: 'Visión de la Arquitectura — PALIC',
  type: 'markdown',
  phase: 'Diseño',
  architecturalView: 'Vista SDD',
  objective: 'Verificar exportación PDF profesional con jerarquía, tablas y listas.',
  keyConcepts: [],
  representation: 'document',
  content: '',
  ...overrides,
});

const readText = async (blob: Blob): Promise<string> => {
  // Decode the raw PDF bytes as Latin-1 so PDF tokens (which are ASCII) survive
  // while binary payloads stay opaque. This is enough to assert structural
  // markers like /Type /Catalog, /Font, /MediaBox, etc.
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let out = '';
  for (let i = 0; i < buffer.length; i += 1) out += String.fromCharCode(buffer[i]);
  return out;
};

describe('pdfExporter — professional layout', () => {
  it('emits a valid PDF 1.4 with header, trailer and xref table', async () => {
    const blob = buildPdfBlob({ activeView: 'document', artifact: artifact({ content: '# Título\n\nPárrafo de prueba.' }) });
    const text = await readText(blob);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('xref');
    expect(text).toContain('trailer');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('registers four font resources (regular, bold, italic, monospace) and Letter media box', async () => {
    const blob = buildPdfBlob({ activeView: 'document', artifact: artifact({ content: '# Heading\n\nBody **bold** and *italic* and `code`.' }) });
    const text = await readText(blob);
    expect(text).toContain('/BaseFont /Helvetica');
    expect(text).toContain('/BaseFont /Helvetica-Bold');
    expect(text).toContain('/BaseFont /Helvetica-Oblique');
    expect(text).toContain('/BaseFont /Courier');
    expect(text).toContain('/MediaBox [0 0 612 792]');
  });

  it('paginates long markdown content into multiple pages', async () => {
    const long = Array.from({ length: 80 }, (_, i) => `Línea ${i + 1}: contenido suficientemente largo para forzar saltos de página y verificar que el renderizador respeta los márgenes.`).join('\n\n');
    const blob = buildPdfBlob({ activeView: 'document', artifact: artifact({ content: long }) });
    const text = await readText(blob);
    const pageMatches = text.match(/\/Type \/Page[^s]/g) ?? [];
    expect(pageMatches.length).toBeGreaterThan(1);
    // Pages object Count should match the number of Page objects.
    const count = /\/Type \/Pages \/Kids \[[^\]]+\] \/Count (\d+)/.exec(text);
    expect(count).not.toBeNull();
    expect(Number(count?.[1])).toBe(pageMatches.length);
  });

  it('renders a metadata cover with the artifact name and objective', async () => {
    const blob = buildPdfBlob({
      activeView: 'document',
      artifact: artifact({ content: '# Visión\n\nResumen ejecutivo.', name: 'Visión Estratégica' }),
      appName: 'Arky 10',
      modelId: 'gemini-test',
    });
    const text = await readText(blob);
    expect(text).toContain('(Visi');
    expect(text).toContain('ARKY 10');
    expect(text).toContain('EXPORTACION DOCUMENTAL');
  });

  it('emits inline runs with the right font switches for bold/italic/code', async () => {
    const blob = buildPdfBlob({ activeView: 'document', artifact: artifact({ content: 'Normal **fuerte** seguido de *cursiva* y `monoespaciado`.' }) });
    const text = await readText(blob);
    // Each run should select its font before drawing.
    expect(text).toMatch(/\/F2 11 Tf[^]*?\(fuerte\) Tj/);
    expect(text).toMatch(/\/F3 11 Tf[^]*?\(cursiva\) Tj/);
    expect(text).toMatch(/\/F4 11 Tf[^]*?\(monoespaciado\) Tj/);
  });

  it('renders Markdown tables with header row, borders and zebra stripes', async () => {
    const md = '# Tabla\n\n| Campo | Valor |\n| --- | --- |\n| Uno | A |\n| Dos | B |\n| Tres | C |\n';
    const blob = buildPdfBlob({ activeView: 'document', artifact: artifact({ content: md }) });
    const text = await readText(blob);
    expect(text).toContain('(Campo) Tj');
    expect(text).toContain('(Valor) Tj');
    expect(text).toContain('(Uno) Tj');
    expect(text).toContain('(Tres) Tj');
    // Header gets the indigo-tinted background fill ('0.93 0.95 1 rg').
    expect(text).toContain('0.93 0.95 1 rg');
  });

  it('handles empty content gracefully (still produces a valid PDF)', async () => {
    const blob = buildPdfBlob({ activeView: 'document', artifact: artifact({ content: '' }) });
    const text = await readText(blob);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Type /Catalog');
  });

  it('normalises Spanish punctuation to characters representable in WinAnsi', async () => {
    const blob = buildPdfBlob({ activeView: 'document', artifact: artifact({ content: '# Resumen\n\n“Acción” — visión clara… ‘ok’.' }) });
    const text = await readText(blob);
    // Smart quotes should be normalised to straight quotes; em-dash to hyphen.
    expect(text).toMatch(/\("Acci/);
    expect(text).toMatch(/n" - visi/);
    expect(text).toContain('...');
  });
});
