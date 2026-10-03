import { describe, expect, it } from 'vitest';
import { buildPptx } from '../../../services/export/adapters/pptxExporter';
import { LAYOUT_ORDER } from '../../../services/export/adapters/pptx/branding';
import type { PresentationDeck, PresentationSlide } from '../../../services/presentation';
import { readStoredZip } from '../../export/evals/exportEvalHarness';

const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMISDkBAAKEAX1NusKWAAAAAElFTkSuQmCC',
  'base64',
));

const slide = (n: number, overrides: Partial<PresentationSlide>): PresentationSlide => ({
  id: `s${n}`, slideNumber: n, title: `Diapositiva ${n}`, layout: 'executiveSummary', contentBlocks: [], ...overrides,
});

const deck = (slides: PresentationSlide[]): PresentationDeck => ({
  kind: 'presentation', version: '1', title: 'Prueba', audience: 'mixed', slides,
});

const read = (bytes: Uint8Array): ((path: string) => string) => {
  const zip = readStoredZip(bytes);
  return (path) => new TextDecoder().decode(zip.get(path));
};

describe('PPTX nativo', () => {
  it('declara un layout por cada PresentationLayout, nombrado por su id', () => {
    const part = read(buildPptx(deck([slide(1, {})])));
    LAYOUT_ORDER.forEach((id, i) => {
      expect(part(`ppt/slideLayouts/slideLayout${i + 1}.xml`)).toContain(id);
    });
    expect(LAYOUT_ORDER).toHaveLength(14);
  });

  it('escribe la tabla como a:tbl con filas completadas al ancho mayor', () => {
    const part = read(buildPptx(deck([slide(1, {
      layout: 'comparisonTable',
      contentBlocks: [{ type: 'table', content: { headers: ['A', 'B'], rows: [['1', '2', '3'], ['4', '5']] } }],
    })])));
    const xml = part('ppt/slides/slide1.xml');
    expect(xml).toContain('<a:tbl>');
    expect(xml.match(/<a:tr /g)).toHaveLength(3);
    expect(xml.match(/<a:tc>/g)).toHaveLength(9);
    expect(xml).not.toContain('1 | 2');
  });

  it('guarda las notas del orador en notesSlide y las relaciona', () => {
    const part = read(buildPptx(deck([slide(1, { speakerNotes: 'Di esto  primero.' })])));
    expect(part('ppt/notesSlides/notesSlide1.xml')).toContain('Di esto primero.');
    expect(part('ppt/slides/_rels/slide1.xml.rels')).toContain('notesSlide1.xml');
    expect(part('[Content_Types].xml')).toContain('/ppt/notesSlides/notesSlide1.xml');
  });

  it('no usa solo el color: la tendencia lleva glifo y palabra, el aviso su tono', () => {
    const part = read(buildPptx(deck([slide(1, {
      layout: 'metricsKpi',
      contentBlocks: [
        { type: 'kpi', content: { label: 'MTTR', value: '4 h', trend: 'down' } },
        { type: 'callout', content: { tone: 'risk', body: 'Cuidado' } },
      ],
    })])));
    const xml = part('ppt/slides/slide1.xml');
    expect(xml).toContain('▼');
    expect(xml).toContain('Baja');
    expect(xml).toContain('Riesgo');
    expect(xml).toContain('Cuidado');
  });

  it('incrusta el diagrama como imagen y conserva el texto cuando no hay raster', () => {
    const withMermaid = slide(1, {
      layout: 'diagramFocused',
      contentBlocks: [{ type: 'diagram', content: { mermaid: 'flowchart LR\n A-->B' } }],
    });
    const withImage = read(buildPptx(deck([withMermaid]), new Map([[0, { pngBytes: PNG, width: 800, height: 400 }]])));
    expect(withImage('ppt/slides/slide1.xml')).toContain('<p:pic>');
    expect(withImage('ppt/slides/_rels/slide1.xml.rels')).toContain('media/image1.png');

    const fallback = read(buildPptx(deck([withMermaid])));
    expect(fallback('ppt/slides/slide1.xml')).not.toContain('<p:pic>');
    expect(fallback('ppt/slides/slide1.xml')).toContain('[diagrama]');
    expect(fallback('ppt/slides/slide1.xml')).toContain('A--&gt;B');
  });
});
