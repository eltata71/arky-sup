import { describe, it, expect } from 'vitest';
import { buildPdfDocument } from '../../../services/export/adapters/pdf/documentPdf';
import type { ExportContext } from '../../../services/export/exportTypes';
import type { Artifact } from '../../../lib/artifacts';
import { readPdf, type PdfReading } from '../../export/pdfTextReader';

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

const exportPdf = async (overrides: Partial<Artifact>, context: Partial<ExportContext> = {}): Promise<PdfReading> =>
  readPdf((await buildPdfDocument({ activeView: 'document', artifact: artifact(overrides), ...context })).bytes);

/** Las fuentes de cada tramo cuyo texto es exactamente `text`. */
const fontsOf = (pdf: PdfReading, text: string): string[] =>
  pdf.runs.filter((run) => run.text === text).map((run) => pdf.baseFonts.get(run.font) ?? '');

describe('pdfExporter — professional layout', () => {
  it('emits a valid PDF with header, trailer and xref table', async () => {
    const { raw } = await exportPdf({ content: '# Título\n\nPárrafo de prueba.' });
    expect(raw.startsWith('%PDF-1.4')).toBe(true);
    expect(raw).toContain('xref');
    expect(raw).toContain('trailer');
    expect(raw.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('embeds subset fonts for regular, bold, italic and monospace, on a Letter media box', async () => {
    const pdf = await exportPdf({ content: '# Heading\n\nBody **bold** and *italic* and `code`.' });
    const names = [...pdf.baseFonts.values()];
    expect(names).toEqual(expect.arrayContaining([
      expect.stringMatching(/^[A-Z]{6}\+Inter-Regular$/),
      expect.stringMatching(/^[A-Z]{6}\+Inter-Bold$/),
      expect.stringMatching(/^[A-Z]{6}\+Inter-Italic$/),
      expect.stringMatching(/^[A-Z]{6}\+NotoSansMono-Regular$/),
    ]));
    expect(pdf.raw).toContain('/Subtype /Type0');
    expect(pdf.raw).toContain('/Encoding /Identity-H');
    expect(pdf.raw).toContain('/FontFile2');
    expect(pdf.raw).not.toContain('/Helvetica');
    expect(pdf.raw).toContain('/MediaBox [0 0 612 792]');
  });

  it('paginates long markdown content into multiple pages', async () => {
    const long = Array.from({ length: 80 }, (_, i) => `Línea ${i + 1}: contenido suficientemente largo para forzar saltos de página y verificar que el renderizador respeta los márgenes.`).join('\n\n');
    const { raw } = await exportPdf({ content: long });
    const pageMatches = raw.match(/\/Type \/Page[^s]/g) ?? [];
    expect(pageMatches.length).toBeGreaterThan(1);
    const count = /\/Type \/Pages \/Kids \[[^\]]+\] \/Count (\d+)/.exec(raw);
    expect(Number(count?.[1])).toBe(pageMatches.length);
  });

  it('renders a metadata cover with the artifact name and objective', async () => {
    const pdf = await exportPdf({ content: '# Visión\n\nResumen ejecutivo.', name: 'Visión Estratégica' }, { appName: 'Arky 10', modelId: 'gemini-test' });
    expect(pdf.text).toContain('Visión Estratégica');
    expect(pdf.text).toContain('ARKY 10');
    expect(pdf.text).toContain('EXPORTACIÓN DOCUMENTAL');
    expect(pdf.text).toContain('gemini-test');
  });

  it('draws each inline run in its own font', async () => {
    const pdf = await exportPdf({ content: 'Normal **fuerte** seguido de *cursiva* y `monoespaciado`.' });
    expect(fontsOf(pdf, 'fuerte')).toEqual([expect.stringMatching(/Inter-Bold$/)]);
    expect(fontsOf(pdf, 'cursiva')).toEqual([expect.stringMatching(/Inter-Italic$/)]);
    expect(fontsOf(pdf, 'monoespaciado')).toEqual([expect.stringMatching(/NotoSansMono-Regular$/)]);
  });

  it('renders Markdown tables with header row, borders and zebra stripes', async () => {
    const pdf = await exportPdf({ content: '# Tabla\n\n| Campo | Valor |\n| --- | --- |\n| Uno | A |\n| Dos | B |\n| Tres | C |\n' });
    for (const cell of ['Campo', 'Valor', 'Uno', 'Tres']) expect(pdf.runs.map((r) => r.text)).toContain(cell);
    expect(pdf.raw).toContain('0.93 0.95 1 rg');
    expect(pdf.raw).toContain('0.98 0.98 1 rg');
  });

  it('handles empty content gracefully (still produces a valid PDF)', async () => {
    const { raw } = await exportPdf({ content: '' });
    expect(raw.startsWith('%PDF-1.4')).toBe(true);
    expect(raw).toContain('/Type /Catalog');
  });

  it('keeps Spanish punctuation as written: smart quotes, dashes and ellipsis are drawable', async () => {
    const pdf = await exportPdf({ content: '# Resumen\n\n“Acción” — visión clara… ‘ok’.' });
    expect(pdf.text).toContain('“Acción” — visión clara… ‘ok’.');
  });
});

describe('pdfExporter — sin pérdidas (9.3)', () => {
  it('flechas, comparadores, marcas, letras griegas y emoji llegan como texto, nunca como «?»', async () => {
    const content = 'Solicitud → emisión ⇒ póliza. Suma ≤ 150 000 y edad ≥ 18: ✓ aprobado, ✗ rechazado. Factor α, β y Δ. ⚠ Revisión 🗓️ trimestral.';
    const pdf = await exportPdf({ content });
    for (const ch of ['→', '⇒', '≤', '≥', '✓', '✗', 'α', 'β', 'Δ', '⚠', '🗓']) expect(pdf.text, ch).toContain(ch);
    expect(pdf.text).not.toContain('?');
  });

  it('un carácter que ninguna fuente dibuja se informa en vez de sustituirse', async () => {
    const result = await buildPdfDocument({ activeView: 'document', artifact: artifact({ content: 'Texto con 𓀀 jeroglífico.' }) });
    expect(readPdf(result.bytes).text).not.toContain('?');
    expect(result.warnings.join(' ')).toMatch(/«𓀀» \(U\+13000\)/);
  });

  it('una fila con más celdas que la cabecera conserva todas sus celdas', async () => {
    const pdf = await exportPdf({ content: '| A | B |\n|---|---|\n| uno | dos | tres-sobrante |\n' });
    expect(pdf.runs.map((r) => r.text)).toContain('tres-sobrante');
  });

  it('una línea de código más ancha que el bloque se parte, no se recorta', async () => {
    const line = `llamada(${'parametro_largo, '.repeat(12)}fin_de_linea)`;
    const pdf = await exportPdf({ content: `\`\`\`ts\n${line}\n\`\`\`` });
    const code = pdf.runs.filter((r) => /NotoSansMono/.test(pdf.baseFonts.get(r.font) ?? '')).map((r) => r.text);
    expect(code.length).toBeGreaterThan(1);
    expect(code.join('')).toBe(line);
  });

  it('el título, el asunto, la fecha y el idioma viajan como metadatos', async () => {
    const { raw } = await exportPdf({ name: 'Visión → objetivo', objective: 'Asunto' }, { generatedAt: new Date('2026-10-03T12:00:00Z') });
    expect(raw).toMatch(/\/Title <FEFF[0-9A-F]+>/);
    expect(raw).toContain('/Subject (Asunto)');
    expect(raw).toContain('/CreationDate (D:20261003120000Z)');
    expect(raw).toContain('/Lang (es-ES)');
    expect(raw).toContain('/DisplayDocTitle true');
  });
});

describe('pdfExporter — estructura etiquetada', () => {
  it('se declara etiquetado, con árbol de estructura y árbol de padres', async () => {
    const { raw } = await exportPdf({ content: '# Título\n\nUn párrafo.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- Uno\n- Dos' });
    expect(raw).toContain('/MarkInfo << /Marked true >>');
    expect(raw).toMatch(/\/StructTreeRoot \d+ 0 R/);
    expect(raw).toMatch(/\/Type \/StructTreeRoot .*\/ParentTree \d+ 0 R/);
    for (const tag of ['Document', 'H1', 'P', 'Table', 'TR', 'TH', 'TD', 'L', 'LI', 'LBody']) expect(raw, tag).toContain(`/S /${tag} `);
    expect(raw).toMatch(/\/StructParents 0/);
  });

  it('cada contenido marcado tiene su MCID y la decoración es Artifact', async () => {
    const { raw } = await exportPdf({ content: '# Título\n\nTexto.' });
    expect(raw).toMatch(/\/H1 <<\/MCID \d+>> BDC/);
    expect(raw).toMatch(/\/P <<\/MCID \d+>> BDC/);
    expect(raw).toContain('/Artifact BMC');
    const opened = (raw.match(/ BDC\n|BMC\n/g) ?? []).length;
    const closed = (raw.match(/\nEMC/g) ?? []).length;
    expect(opened).toBe(closed);
  });
});

describe('pdfExporter — cabecera binaria', () => {
  it('la cabecera binaria mantiene cuatro bytes por encima de 127', async () => {
    const { bytes } = await buildPdfDocument({ activeView: 'document', artifact: artifact({ content: 'x' }) });
    expect(Array.from(bytes.slice(9, 15))).toEqual([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
  });
});
