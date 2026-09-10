import { describe, it, expect } from 'vitest';
import { buildPptx, collectSlideMermaid, fitImageIntoZone } from '../../../services/export/adapters/pptxExporter';
import type { PresentationDeck } from '../../../services/presentation';
import type { RasterizedDiagram } from '../../../services/export/utils/mermaidRaster';

const buildDeck = (): PresentationDeck => ({
  kind: 'presentation',
  version: '1.0.0',
  title: 'Arquitectura PBM',
  audience: 'executive',
  theme: 'dark',
  slides: [
    {
      id: 's1',
      slideNumber: 1,
      title: 'Portada',
      layout: 'titleSlide',
      contentBlocks: [],
    },
    {
      id: 's2',
      slideNumber: 2,
      title: 'Vista de Contexto',
      layout: 'diagramFocused',
      keyMessage: 'El PBM orquesta elegibilidad y reclamaciones.',
      contentBlocks: [
        {
          type: 'diagram',
          content: {
            mermaid: 'flowchart LR\n  A[Portal] --> B[PBM]\n  B --> C[(BD)]',
            description: 'Flujo principal de reclamaciones.',
          },
        },
      ],
    },
  ],
  metadata: {},
});

const zipToLatin1 = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
};

const fakeRaster = (): RasterizedDiagram => ({
  // Minimal PNG-ish payload: only needs to round-trip as bytes in the zip.
  pngBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]),
  width: 1200,
  height: 600,
});

describe('collectSlideMermaid', () => {
  it('returns the first mermaid source per slide, keyed by slide index', () => {
    const map = collectSlideMermaid(buildDeck());
    expect(map.size).toBe(1);
    expect(map.get(1)).toContain('flowchart LR');
  });
});

describe('fitImageIntoZone', () => {
  it('aspect-fits a wide image to the zone width and centres it vertically', () => {
    const frame = fitImageIntoZone(2000, 500);
    // Width-bound: cx equals the zone width (8,229,600 EMU).
    expect(frame.cx).toBe(8_229_600);
    expect(frame.cy).toBe(Math.round(8_229_600 / 4));
    expect(frame.y).toBeGreaterThan(2_400_000);
  });

  it('never upscales small images beyond their natural size', () => {
    const frame = fitImageIntoZone(100, 100);
    expect(frame.cx).toBe(100 * 9525);
    expect(frame.cy).toBe(100 * 9525);
  });
});

describe('buildPptx with rasterized diagrams', () => {
  it('embeds the PNG, its relationship and the picture shape', () => {
    const deck = buildDeck();
    const zip = zipToLatin1(buildPptx(deck, new Map([[1, fakeRaster()]])));
    expect(zip).toContain('ppt/media/image1.png');
    expect(zip).toContain('<p:pic>');
    expect(zip).toContain('relationships/image');
    expect(zip).toContain('Extension="png"');
    // The mermaid source dump must be gone — the image replaces it.
    expect(zip).not.toContain('[diagrama]');
    // The description survives as a caption line.
    expect(zip).toContain('Flujo principal de reclamaciones.');
  });

  it('keeps the legacy text fallback when no raster is supplied', () => {
    const zip = zipToLatin1(buildPptx(buildDeck()));
    expect(zip).not.toContain('ppt/media/');
    expect(zip).not.toContain('<p:pic>');
    expect(zip).toContain('[diagrama]');
    expect(zip).toContain('flowchart LR');
  });

  it('numbers media files sequentially across multiple slides', () => {
    const deck = buildDeck();
    deck.slides.push({ ...deck.slides[1], id: 's3', slideNumber: 3, title: 'Otra vista' });
    const zip = zipToLatin1(buildPptx(deck, new Map([[1, fakeRaster()], [2, fakeRaster()]])));
    expect(zip).toContain('ppt/media/image1.png');
    expect(zip).toContain('ppt/media/image2.png');
    expect(zip).toContain('media/image2.png"/>');
  });
});
