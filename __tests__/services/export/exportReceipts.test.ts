// @vitest-environment jsdom
/**
 * El recibo de cada exportador (plan de clase mundial 9.4): lo cuenta quien
 * escribe el fichero, y cada pérdida llega como una frase.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../../lib/artifacts';

const raster = vi.hoisted(() => ({ png: vi.fn(), jpeg: vi.fn() }));
vi.mock('../../../services/export/utils/mermaidRaster', () => ({
  rasterizeMermaidToPng: raster.png,
  rasterizeMermaidToJpeg: raster.jpeg,
}));

import { docxExporter } from '../../../services/export/adapters/docxExporter';
import { pptxExporter } from '../../../services/export/adapters/pptxExporter';
import { pdfExporter } from '../../../services/export/adapters/pdfExporter';

const PNG = { pngBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), width: 800, height: 400 };
const JPEG = { jpegBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 800, height: 400 };

const doc = (content: string, overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'r1', versionGroupId: 'r1', version: 1, createdAt: '2026-10-03T00:00:00.000Z',
  name: 'Plan de transición', type: 'markdown', phase: 'Diseño', architecturalView: 'Vista Lógica y de Diseño',
  objective: 'Ordenar la migración del core.', keyConcepts: [], representation: 'document', content, ...overrides,
});

const CONTENT = [
  '# Plan de transición', '', '## Riesgos', '| Riesgo | Nivel |', '|---|---|', '| Datos | Alto |', '',
  '## Hitos', '| Hito | Fecha |', '|---|---|', '| Piloto | Q1 |', '',
  '```mermaid', 'flowchart LR', '  A --> B', '```',
].join('\n');

const deckFixture = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'export-evals', 'vida-deck-tecnico-pago-siniestros.json'), 'utf8')) as { artefacto: { nombre: string; tipo: Artifact['type']; contenido: string } };

describe('recibos de exportación', () => {
  beforeEach(() => {
    raster.png.mockReset().mockResolvedValue(PNG);
    raster.jpeg.mockReset().mockResolvedValue(JPEG);
  });

  it('DOCX cuenta sus tablas y diagramas y empieza por sus títulos', async () => {
    const { receipt } = await docxExporter.export({ artifact: doc(CONTENT), activeView: 'document' });
    expect(receipt).toMatchObject({ tables: 2, diagrams: 1, losses: [] });
    expect(receipt?.preview).toEqual({ kind: 'page', title: 'Plan de transición', subtitle: 'Ordenar la migración del core.', lines: ['Plan de transición', 'Riesgos', 'Hitos'] });
  });

  it('DOCX informa el diagrama que no pudo dibujar', async () => {
    raster.png.mockResolvedValue(null);
    const { receipt } = await docxExporter.export({ artifact: doc(CONTENT), activeView: 'document' });
    expect(receipt?.diagrams).toBe(0);
    expect(receipt?.losses).toEqual(['Un diagrama Mermaid no pudo rasterizarse; se conservó su código.']);
  });

  it('PDF cuenta páginas, tablas del contenido y diagramas', async () => {
    const { receipt } = await pdfExporter.export({ artifact: doc(CONTENT), activeView: 'document' });
    expect(receipt?.pages).toBeGreaterThanOrEqual(2);
    // Dos tablas del contenido y sus dos copias en el anexo «Tablas detectadas»; la de la portada no cuenta.
    expect(receipt).toMatchObject({ tables: 4, diagrams: 1, losses: [] });
    expect(receipt?.preview?.lines.slice(0, 3)).toEqual(['Plan de transición', 'Riesgos', 'Hitos']);
  });

  it('PDF informa un carácter que no pudo dibujar', async () => {
    const { receipt } = await pdfExporter.export({ artifact: doc('Un jeroglífico 𓀀.'), activeView: 'document' });
    expect(receipt?.losses.join(' ')).toMatch(/«𓀀»/);
  });

  it('PPTX cuenta diapositivas, notas, tablas y diagramas, y la vista previa es la primera diapositiva', async () => {
    const artifact = doc(deckFixture.artefacto.contenido, { name: deckFixture.artefacto.nombre, type: deckFixture.artefacto.tipo });
    const deck = JSON.parse(deckFixture.artefacto.contenido) as { slides: Array<{ title: string; speakerNotes?: string; contentBlocks: Array<{ type: string }> }> };
    const { receipt } = await pptxExporter.export({ artifact, activeView: 'document' });
    expect(receipt?.slides).toBe(deck.slides.length);
    expect(receipt?.slidesWithNotes).toBe(deck.slides.filter((s) => s.speakerNotes?.trim()).length);
    expect(receipt?.tables).toBe(deck.slides.flatMap((s) => s.contentBlocks).filter((b) => b.type === 'table').length);
    expect(receipt?.diagrams).toBeGreaterThan(0);
    expect(receipt?.losses).toEqual([]);
    expect(receipt?.preview).toMatchObject({ kind: 'slide', title: deck.slides[0]?.title });
  });

  it('PPTX informa cada diagrama que se quedó en texto', async () => {
    raster.png.mockResolvedValue(null);
    const artifact = doc(deckFixture.artefacto.contenido, { name: deckFixture.artefacto.nombre, type: deckFixture.artefacto.tipo });
    const { receipt } = await pptxExporter.export({ artifact, activeView: 'document' });
    expect(receipt?.diagrams).toBe(0);
    expect(receipt?.losses.length).toBeGreaterThan(0);
    expect(receipt?.losses[0]).toMatch(/^El diagrama de la diapositiva \d+ no se pudo dibujar/);
  });
});
