import { describe, it, expect } from 'vitest';
import { buildPdfBlob, computeTocPageCount } from '../../../services/export/adapters/pdfExporter';
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

const readText = async (blob: Blob): Promise<string> => {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let out = '';
  for (let i = 0; i < buffer.length; i += 1) out += String.fromCharCode(buffer[i]);
  return out;
};

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
    const text = await readText(buildPdfBlob({ activeView: 'document', artifact: artifact(structuredDoc) }));
    expect(text).toContain('(Contenido) Tj');
    // Dot leaders between entry text and page number.
    expect(text).toMatch(/\(\.{6,}\) Tj/);
    // Entries reference the shifted page numbers (some page > 2 exists).
    expect(text).toMatch(/\(Seccion 8\) Tj/);
  });

  it('skips the TOC for short documents (< 4 headings)', async () => {
    const text = await readText(buildPdfBlob({
      activeView: 'document',
      artifact: artifact('# Unico\n\nParrafo corto sin mas estructura.'),
    }));
    expect(text).not.toContain('(Contenido) Tj');
  });

  it('keeps the Pages /Count consistent with the actual Page objects', async () => {
    const text = await readText(buildPdfBlob({ activeView: 'document', artifact: artifact(structuredDoc) }));
    const pageMatches = text.match(/\/Type \/Page[^s]/g) ?? [];
    const count = /\/Type \/Pages \/Kids \[[^\]]+\] \/Count (\d+)/.exec(text);
    expect(Number(count?.[1])).toBe(pageMatches.length);
  });
});

describe('pdfExporter — outline bookmarks', () => {
  it('emits a navigable outline with H1 parents and H2 children', async () => {
    const text = await readText(buildPdfBlob({ activeView: 'document', artifact: artifact(structuredDoc) }));
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
    const text = await readText(buildPdfBlob({
      activeView: 'document',
      artifact: artifact('Parrafo plano sin encabezados de ningun tipo.'),
    }));
    expect(text).not.toContain('/Type /Outlines');
  });
});

describe('pdfExporter — smart page breaks', () => {
  it('splits a code block taller than a page instead of overflowing', async () => {
    const hugeCode = ['```', ...Array.from({ length: 180 }, (_, i) => `linea_codigo_${i + 1}();`), '```'].join('\n');
    const text = await readText(buildPdfBlob({
      activeView: 'document',
      artifact: artifact(`# Codigo\n\n${hugeCode}`),
    }));
    const pageMatches = text.match(/\/Type \/Page[^s]/g) ?? [];
    expect(pageMatches.length).toBeGreaterThanOrEqual(3);
    // The last code line must still be rendered (nothing silently dropped).
    expect(text).toContain('linea_codigo_180');
  });
});

describe('pdfExporter — native charts and callouts', () => {
  it('renders ```chart bar specs as native vector bars with palette colors', async () => {
    const chartDoc = `# Datos\n\n\`\`\`chart\n{ "type": "bar", "title": "Esfuerzo", "labels": ["Diseno", "Build"], "series": [{ "name": "Semanas", "values": [4, 9] }], "unit": " sem" }\n\`\`\``;
    const text = await readText(buildPdfBlob({ activeView: 'document', artifact: artifact(chartDoc) }));
    // Palette color #6366f1 -> "0.388 0.400 0.945 rg" fills.
    expect(text).toContain('0.388 0.400 0.945 rg');
    expect(text).toContain('(9 sem) Tj');
    expect(text).toContain('(Esfuerzo) Tj');
    // No raw JSON dump of the spec.
    expect(text).not.toContain('"series"');
  });

  it('degrades line charts to a clean data table', async () => {
    const lineDoc = `# Tendencia\n\n\`\`\`chart\n{ "type": "line", "labels": ["Q1", "Q2"], "series": [{ "name": "Reclamos", "values": [120, 180] }] }\n\`\`\``;
    const text = await readText(buildPdfBlob({ activeView: 'document', artifact: artifact(lineDoc) }));
    expect(text).toContain('(Reclamos) Tj');
    expect(text).toContain('(Q2) Tj');
  });

  it('renders GitHub-style admonitions as labelled callout cards', async () => {
    const calloutDoc = `# Decisiones\n\n> [!WARNING] El core legado no soporta TLS 1.3 en produccion.`;
    const text = await readText(buildPdfBlob({ activeView: 'document', artifact: artifact(calloutDoc) }));
    expect(text).toContain('(ATENCION) Tj');
    expect(text).toContain('TLS 1.3');
    expect(text).not.toContain('[!WARNING]');
  });
});
