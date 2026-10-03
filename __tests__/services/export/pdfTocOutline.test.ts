import { describe, it, expect } from 'vitest';
import { buildPdfDocument, computeTocPageCount } from '../../../services/export/adapters/pdf/documentPdf';
import type { ExportContext } from '../../../services/export/exportTypes';
import { readPdf, type PdfReading } from '../../export/pdfTextReader';
import type { Artifact } from '../../../lib/artifacts';

const artifact = (content: string, overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'art-pdf-toc',
  versionGroupId: 'vg-1',
  version: 1,
  createdAt: '2026-06-10T00:00:00.000Z',
  name: 'SDD — Plataforma PBM',
  type: 'markdown',
  phase: 'Diseño',
  architecturalView: 'Vista SDD',
  objective: 'Validar índice, marcadores y saltos de página del PDF.',
  keyConcepts: [],
  representation: 'document',
  content,
  ...overrides,
});

const read = async (context: ExportContext): Promise<PdfReading> => readPdf((await buildPdfDocument(context)).bytes);
const texts = (pdf: PdfReading): string[] => pdf.runs.map((run) => run.text);

const longSection = (n: number) =>
  `## Seccion ${n}\n\n${`Contenido extenso de la seccion ${n} para forzar paginacion real. `.repeat(20)}\n\n`;

const structuredDoc = `# Vision General\n\nIntroduccion del documento.\n\n${Array.from({ length: 8 }, (_, i) => longSection(i + 1)).join('')}`;

describe('computeTocPageCount', () => {
  it('is exact for the TOC line geometry', () => {
    expect(computeTocPageCount(0)).toBe(0);
    expect(computeTocPageCount(1)).toBe(1);
    expect(computeTocPageCount(32)).toBe(1);
    expect(computeTocPageCount(33)).toBe(2);
    expect(computeTocPageCount(32 + 35)).toBe(2);
    expect(computeTocPageCount(32 + 36)).toBe(3);
  });
});

describe('pdfExporter — table of contents', () => {
  it('renders a "Contenido" page with dot leaders for structured documents', async () => {
    const pdf = await read({ activeView: 'document', artifact: artifact(structuredDoc) });
    expect(texts(pdf)).toContain('Contenido');
    // Dot leaders between entry text and page number.
    expect(texts(pdf).some((t) => /^\.{6,}$/.test(t))).toBe(true);
    expect(texts(pdf)).toContain('Seccion 8');
    expect(pdf.raw).toContain('/S /TOC ');
    expect(pdf.raw).toContain('/S /TOCI ');
  });

  it('skips the TOC for short documents (< 4 headings)', async () => {
    const pdf = await read({
      activeView: 'document',
      artifact: artifact('# Unico\n\nParrafo corto sin mas estructura.'),
    });
    expect(texts(pdf)).not.toContain('Contenido');
  });

  it('keeps the Pages /Count consistent with the actual Page objects', async () => {
    const text = (await read({ activeView: 'document', artifact: artifact(structuredDoc) })).raw;
    const pageMatches = text.match(/\/Type \/Page[^s]/g) ?? [];
    const count = /\/Type \/Pages \/Kids \[[^\]]+\] \/Count (\d+)/.exec(text);
    expect(Number(count?.[1])).toBe(pageMatches.length);
  });
});

describe('pdfExporter — outline bookmarks', () => {
  it('emits a navigable outline with H1 parents and H2 children', async () => {
    const text = (await read({ activeView: 'document', artifact: artifact(structuredDoc) })).raw;
    expect(text).toContain('/Type /Outlines');
    expect(text).toContain('/PageMode /UseOutlines');
    expect(text).toContain('/Title (Vision General)');
    expect(text).toContain('/Title (Seccion 1)');
    // The H1 carries its H2 children via /First /Last /Count.
    expect(text).toMatch(/\/Title \(Vision General\)[^>]*\/First \d+ 0 R \/Last \d+ 0 R \/Count 8/);
    // Destinations point at real page objects.
    expect(text).toMatch(/\/Dest \[\d+ 0 R \/XYZ 0 \d+ 0\]/);
  });

  it('omits the outline when the document has no headings', async () => {
    const text = (await read({
      activeView: 'document',
      artifact: artifact('Parrafo plano sin encabezados de ningun tipo.'),
    })).raw;
    expect(text).not.toContain('/Type /Outlines');
  });

  it('a heading outside ASCII is titled in UTF-16, so the bookmark keeps its accent and arrow', async () => {
    const text = (await read({ activeView: 'document', artifact: artifact('# Visión → objetivo\n\nTexto.') })).raw;
    const hex = Array.from('Visión → objetivo', (ch) => ch.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()).join('');
    expect(text).toContain(`/Title <FEFF${hex}>`);
  });
});

describe('pdfExporter — smart page breaks', () => {
  it('splits a code block taller than a page instead of overflowing', async () => {
    const hugeCode = ['```', ...Array.from({ length: 180 }, (_, i) => `linea_codigo_${i + 1}();`), '```'].join('\n');
    const pdf = await read({
      activeView: 'document',
      artifact: artifact(`# Codigo\n\n${hugeCode}`),
    });
    const pageMatches = pdf.raw.match(/\/Type \/Page[^s]/g) ?? [];
    expect(pageMatches.length).toBeGreaterThanOrEqual(3);
    // The last code line must still be rendered (nothing silently dropped).
    expect(texts(pdf)).toContain('linea_codigo_180();');
  });
});

describe('pdfExporter — native charts and callouts', () => {
  it('renders ```chart bar specs as native vector bars with palette colors', async () => {
    const chartDoc = `# Datos\n\n\`\`\`chart\n{ "type": "bar", "title": "Esfuerzo", "labels": ["Diseno", "Build"], "series": [{ "name": "Semanas", "values": [4, 9] }], "unit": " sem" }\n\`\`\``;
    const pdf = await read({ activeView: 'document', artifact: artifact(chartDoc) });
    // Palette color #6366f1 -> "0.388 0.400 0.945 rg" fills.
    expect(pdf.raw).toContain('0.388 0.400 0.945 rg');
    expect(texts(pdf)).toContain('9 sem');
    expect(texts(pdf)).toContain('Esfuerzo');
    // No raw JSON dump of the spec.
    expect(pdf.text).not.toContain('"series"');
    // The chart is a figure whose alternative text carries every value.
    expect(pdf.raw).toContain('/S /Figure ');
    expect(pdf.raw).toMatch(/\/Alt <FEFF[0-9A-F]+>/);
  });

  it('degrades line charts to a clean data table', async () => {
    const lineDoc = `# Tendencia\n\n\`\`\`chart\n{ "type": "line", "labels": ["Q1", "Q2"], "series": [{ "name": "Reclamos", "values": [120, 180] }] }\n\`\`\``;
    const pdf = await read({ activeView: 'document', artifact: artifact(lineDoc) });
    expect(texts(pdf)).toContain('Reclamos');
    expect(texts(pdf)).toContain('Q2');
  });

  it('renders GitHub-style admonitions as labelled callout cards', async () => {
    const calloutDoc = `# Decisiones\n\n> [!WARNING] El core legado no soporta TLS 1.3 en produccion.`;
    const pdf = await read({ activeView: 'document', artifact: artifact(calloutDoc) });
    expect(texts(pdf)).toContain('ATENCIÓN');
    expect(pdf.text).toContain('TLS 1.3');
    expect(pdf.text).not.toContain('[!WARNING]');
  });
});
