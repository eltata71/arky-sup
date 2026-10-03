import type { ExportAdapter, ExportContext, ExportReceipt } from '../exportTypes';
import { EXPORT_DEFINITIONS } from '../exportRegistry';
import { createStoredZip, type ZipEntryInput } from '../utils/zip';
import { buildFile } from './shared';
import { parsePresentationDeck } from '../../presentation';
import type { PresentationDeck, PresentationDiagramContent, PresentationSlide } from '../../presentation';
import { rasterizeMermaidToPng, type RasterizedDiagram } from '../utils/mermaidRaster';
import { LAYOUT_ORDER, layoutSpecFor } from './pptx/branding';
import { buildSlideLayoutRels, buildSlideLayoutXml, buildSlideMasterRels, buildSlideMasterXml } from './pptx/layouts';
import { buildNotesMasterRels, buildNotesMasterXml, buildNotesSlideRels, buildNotesSlideXml } from './pptx/notes';
import { ROOT_RELS, buildContentTypes, buildCoreProps, buildPresentationRels, buildPresentationXml } from './pptx/package';
import { buildSlideRels, buildSlideXml, fitImage, type SlideImage } from './pptx/slide';
import { buildThemeXml } from './pptx/theme';

/**
 * Native PPTX (OOXML PresentationML) exporter. The deck's layouts are real
 * master layouts (one per `PresentationLayout`), tables are `a:tbl`, KPIs and
 * callouts are shapes, and speaker notes live in `notesSlide` parts. The parts
 * themselves are built in `./pptx/`.
 */

/** Rasterized diagram attached to a slide, ready for OOXML embedding. */
export type SlideDiagramImage = SlideImage;

const IMAGE_ZONE = { x: 457_200, y: 2_400_000, cx: 8_229_600, cy: 4_000_000 } as const;

/** Frame for a picture inside the default diagram zone, centred and never upscaled. */
export const fitImageIntoZone = (widthPx: number, heightPx: number): { x: number; y: number; cx: number; cy: number } =>
  fitImage(IMAGE_ZONE, widthPx, heightPx);

/**
 * Build the PPTX bundle. `slideDiagrams` maps slide index → rasterized PNG of
 * that slide's first Mermaid diagram block; slides without an entry keep the
 * text rendering, so a partial rasterization failure never blocks the export.
 */
export const buildPptx = (deck: PresentationDeck, slideDiagrams: Map<number, RasterizedDiagram> = new Map()): Uint8Array => {
  const entries: ZipEntryInput[] = [];
  const add = (path: string, content: string | Uint8Array): void => { entries.push({ path, content }); };

  const notesNumbers: number[] = [];
  const slideParts: { xml: string; rels: string; notes?: { number: number; xml: string }; image?: { number: number; bytes: Uint8Array } }[] = [];
  let imageCounter = 0;
  deck.slides.forEach((slide, idx) => {
    const raster = slideDiagrams.get(idx);
    const image: SlideImage | undefined = raster ? { ...raster, imageNumber: ++imageCounter } : undefined;
    const notesText = slide.speakerNotes?.replace(/\s+/g, ' ').trim();
    const notesNumber = notesText ? notesNumbers.push(idx + 1) : undefined;
    slideParts.push({
      xml: buildSlideXml(slide, image),
      rels: buildSlideRels(layoutSpecFor(slide.layout).index, { imageNumber: image?.imageNumber, notesNumber }),
      notes: notesNumber && notesText ? { number: idx + 1, xml: buildNotesSlideXml(notesText) } : undefined,
      image: image && raster ? { number: image.imageNumber, bytes: raster.pngBytes } : undefined,
    });
  });

  add('[Content_Types].xml', buildContentTypes(deck.slides.length, notesNumbers));
  add('_rels/.rels', ROOT_RELS);
  add('docProps/core.xml', buildCoreProps(deck));
  add('ppt/presentation.xml', buildPresentationXml(deck.slides.length));
  add('ppt/_rels/presentation.xml.rels', buildPresentationRels(deck.slides.length));
  add('ppt/slideMasters/slideMaster1.xml', buildSlideMasterXml());
  add('ppt/slideMasters/_rels/slideMaster1.xml.rels', buildSlideMasterRels());
  LAYOUT_ORDER.forEach((layoutId, i) => {
    add(`ppt/slideLayouts/slideLayout${i + 1}.xml`, buildSlideLayoutXml(layoutId));
    add(`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`, buildSlideLayoutRels());
  });
  add('ppt/theme/theme1.xml', buildThemeXml('Arky'));
  add('ppt/theme/theme2.xml', buildThemeXml('Arky Notas'));
  add('ppt/notesMasters/notesMaster1.xml', buildNotesMasterXml());
  add('ppt/notesMasters/_rels/notesMaster1.xml.rels', buildNotesMasterRels());

  slideParts.forEach((part, idx) => {
    add(`ppt/slides/slide${idx + 1}.xml`, part.xml);
    add(`ppt/slides/_rels/slide${idx + 1}.xml.rels`, part.rels);
    if (part.image) add(`ppt/media/image${part.image.number}.png`, part.image.bytes);
    if (part.notes) {
      add(`ppt/notesSlides/notesSlide${part.notes.number}.xml`, part.notes.xml);
      add(`ppt/notesSlides/_rels/notesSlide${part.notes.number}.xml.rels`, buildNotesSlideRels(idx + 1));
    }
  });
  return createStoredZip(entries);
};

/** First Mermaid source of each slide, keyed by slide index. */
export const collectSlideMermaid = (deck: PresentationDeck): Map<number, string> => {
  const out = new Map<number, string>();
  deck.slides.forEach((slide, idx) => {
    for (const block of slide.contentBlocks) {
      if (block.type !== 'diagram') continue;
      const diagram = block.content as PresentationDiagramContent;
      if (diagram?.mermaid && diagram.mermaid.trim().length > 0) {
        out.set(idx, diagram.mermaid);
        break;
      }
    }
  });
  return out;
};

/** Las primeras líneas de una diapositiva: su mensaje, viñetas y textos, en orden. */
const slideLines = (slide: PresentationSlide): string[] => {
  const lines: string[] = slide.keyMessage ? [slide.keyMessage] : [];
  for (const block of slide.contentBlocks) {
    if (typeof block.content === 'string') lines.push(block.content);
    else if (Array.isArray(block.content)) lines.push(...block.content.map((item) => (typeof item === 'string' ? item : `${item.label}: ${item.value}`)));
  }
  return lines.map((line) => line.trim()).filter(Boolean).slice(0, 6);
};

/**
 * El recibo del deck (plan de clase mundial 9.4), contado sobre lo que
 * `buildPptx` acaba de escribir: cada tabla es un `a:tbl`, cada diagrama
 * rasterizado una imagen, y cada diagrama que no se pudo dibujar, una pérdida.
 */
export const pptxReceipt = (deck: PresentationDeck, slideDiagrams: ReadonlyMap<number, RasterizedDiagram>, usedFallback: boolean): ExportReceipt => {
  const losses: string[] = [];
  if (usedFallback) losses.push('El contenido no era un deck válido: se exportó una presentación mínima con su texto.');
  for (const idx of collectSlideMermaid(deck).keys()) {
    if (!slideDiagrams.has(idx)) losses.push(`El diagrama de la diapositiva ${idx + 1} no se pudo dibujar en este navegador y se conserva como texto.`);
  }
  const first = deck.slides[0];
  return {
    slides: deck.slides.length,
    slidesWithNotes: deck.slides.filter((slide) => slide.speakerNotes?.trim()).length,
    tables: deck.slides.reduce((sum, slide) => sum + slide.contentBlocks.filter((block) => block.type === 'table').length, 0),
    diagrams: slideDiagrams.size,
    losses,
    preview: first ? { kind: 'slide', title: first.title, subtitle: first.subtitle, lines: slideLines(first) } : undefined,
  };
};

export const pptxExporter: ExportAdapter = {
  format: 'pptx',
  async export(context: ExportContext) {
    const parsed = parsePresentationDeck(context.artifact.content, {
      artifactType: context.artifact.type,
      artifactName: context.artifact.name,
    });
    const slideDiagrams = new Map<number, RasterizedDiagram>();
    for (const [idx, mermaid] of collectSlideMermaid(parsed.deck)) {
      const raster = await rasterizeMermaidToPng(mermaid);
      if (raster) slideDiagrams.set(idx, raster);
    }
    const blobBytes = buildPptx(parsed.deck, slideDiagrams);
    const blob = new Blob([blobBytes.slice().buffer], { type: EXPORT_DEFINITIONS.pptx.mimeType });
    return buildFile(context, 'pptx', blob, undefined, pptxReceipt(parsed.deck, slideDiagrams, parsed.usedFallback));
  },
};
