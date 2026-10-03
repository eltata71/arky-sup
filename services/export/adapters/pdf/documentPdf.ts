/**
 * El PDF de un documento (plan de clase mundial, 9.3): se carga con `import()`
 * desde `pdfExporter.ts`, que está en el arranque, y sólo cuando alguien
 * exporta un PDF —junto con sus fuentes, que son chunks propios—.
 *
 * Lo que cambió respecto del PDF anterior, y por qué:
 *
 * - **Nada se pierde en silencio.** El texto se escribe con fuentes
 *   incrustadas; lo que ninguna dibuja se informa en `warnings`, y un diagrama
 *   que no se pudo dibujar también.
 * - **Los diagramas se ven.** Un ```mermaid se rasteriza con la misma ruta que
 *   usan el DOCX y el PPTX y se incrusta como imagen JPEG.
 * - **Es un documento, no un dibujo de uno.** Marcadores por título,
 *   metadatos, idioma declarado y estructura etiquetada para lectores de
 *   pantalla (`docs/publication-accessibility.md`).
 */
import type { ExportContext, ExportReceipt } from '../../exportTypes';
import { artifactTables, buildMetadata, publicationMarkdown, shouldExportPublication } from '../shared';
import { buildArtifactQualityReport } from '../../../quality/artifactQualityService';
import { renderQualityReportMarkdown } from '../../../quality/qualityReportRenderer';
import { rasterizeMermaidToJpeg } from '../../utils/mermaidRaster';
import { parseMarkdownBlocks, stylesOf, textOf, type Block } from './documentBlocks';
import { DocumentRenderer, computeTocPageCount, type PdfHeadingRecord, type PdfTocEntry, type RenderBlock } from './documentRenderer';
import { PAGE_H, PAGE_W } from './pageGeometry';
import { PdfFontSet } from './pdfFonts';
import { writeStructTree } from './pdfStructure';
import { PdfWriter, ascii, pdfDate, pdfTextString } from './pdfWriter';

export { computeTocPageCount };

/** Títulos de nivel 1 y 2 a partir de los cuales el índice compensa sus páginas. */
const TOC_MIN_HEADINGS = 4;

export interface BuiltPdf {
  readonly bytes: Uint8Array;
  /** Lo que el PDF no pudo representar, en frases para quien exporta. */
  readonly warnings: string[];
  /** Lo que el PDF contiene, contado por el renderizador que lo dibujó (9.4). */
  readonly receipt: ExportReceipt;
}

interface Image { name: string; bytes: Uint8Array; width: number; height: number }

const contentBlocks = (context: ExportContext): Block[] => {
  const source = shouldExportPublication(context) ? publicationMarkdown(context) : (context.artifact.content || '');
  const blocks = parseMarkdownBlocks(source);
  // Las tablas detectadas se repiten como anexo sólo en la exportación original:
  // la de publicación ya las pinta una vez.
  const tables = shouldExportPublication(context) ? [] : artifactTables(context.artifact);
  if (tables.length > 0) {
    blocks.push({ kind: 'h2', text: 'Tablas detectadas' });
    for (const table of tables) blocks.push({ kind: 'h3', text: table.title || 'Tabla' }, { kind: 'table', headers: table.headers, rows: table.rows });
  }
  if (context.includeQualityReport) {
    blocks.push({ kind: 'rule' }, ...parseMarkdownBlocks(renderQualityReportMarkdown(buildArtifactQualityReport(context.artifact))));
  }
  return blocks;
};

/** Cada ```mermaid pasa a imagen; el que no se pudo dibujar se queda como código, y se dice. */
const rasterizeDiagrams = async (blocks: Block[], images: Image[], warnings: string[]): Promise<RenderBlock[]> => {
  const out: RenderBlock[] = [];
  let diagram = 0;
  for (const block of blocks) {
    if (block.kind !== 'diagram') { out.push(block); continue; }
    diagram += 1;
    const raster = await rasterizeMermaidToJpeg(block.code);
    if (!raster) {
      warnings.push(`El diagrama ${diagram} no se pudo dibujar en este navegador y se incluye como código Mermaid.`);
      out.push(block);
      continue;
    }
    const name = `Im${images.length + 1}`;
    images.push({ name, bytes: raster.jpegBytes, width: raster.width, height: raster.height });
    const kind = /^\s*(\w[\w-]*)/.exec(block.code)?.[1] ?? 'diagrama';
    out.push({ kind: 'image', image: { name, width: raster.width, height: raster.height, alt: `Diagrama ${diagram} (${kind}).` } });
  }
  return out;
};

const render = (context: ExportContext, fonts: PdfFontSet, blocks: RenderBlock[], toc: PdfTocEntry[] | null): DocumentRenderer => {
  fonts.resetMissing();
  const renderer = new DocumentRenderer(fonts, context.presentationModel?.title || context.artifact.name || 'Documento');
  renderer.drawCover(context);
  if (toc && toc.length > 0) {
    renderer.breakPage();
    renderer.drawToc(toc);
  }
  // El contenido empieza siempre en página nueva: así las dos pasadas sólo
  // difieren en las páginas del índice, que es el desplazamiento de sus entradas.
  renderer.breakPage();
  renderer.drawBlocks(blocks);
  renderer.finalize();
  return renderer;
};

const writeOutline = (writer: PdfWriter, headings: PdfHeadingRecord[], pageIds: number[]): number | null => {
  const entries = headings.filter((h) => h.level <= 2);
  if (entries.length === 0) return null;
  const root = writer.reserve();
  const items = entries.map((heading) => ({ heading, id: writer.reserve(), parent: root, children: [] as number[] }));
  let top: (typeof items)[number] | null = null;
  for (const item of items) {
    if (item.heading.level === 1) top = item;
    else if (top) { item.parent = top.id; top.children.push(item.id); }
  }
  const topLevel = items.filter((item) => item.parent === root);
  writer.set(root, `<< /Type /Outlines /First ${topLevel[0].id} 0 R /Last ${topLevel[topLevel.length - 1].id} 0 R /Count ${topLevel.length} >>`);
  for (const item of items) {
    const siblings = item.parent === root ? topLevel : items.filter((other) => other.parent === item.parent);
    const index = siblings.indexOf(item);
    const parts = [
      `/Title ${pdfTextString(item.heading.text)}`,
      `/Parent ${item.parent} 0 R`,
      `/Dest [${pageIds[item.heading.page - 1]} 0 R /XYZ 0 ${Math.min(PAGE_H, Math.round(item.heading.y + 24))} 0]`,
    ];
    if (index > 0) parts.push(`/Prev ${siblings[index - 1].id} 0 R`);
    if (index < siblings.length - 1) parts.push(`/Next ${siblings[index + 1].id} 0 R`);
    if (item.children.length > 0) parts.push(`/First ${item.children[0]} 0 R`, `/Last ${item.children[item.children.length - 1]} 0 R`, `/Count ${item.children.length}`);
    writer.set(item.id, `<< ${parts.join(' ')} >>`);
  }
  return root;
};

export async function buildPdfDocument(context: ExportContext): Promise<BuiltPdf> {
  const warnings: string[] = [];
  const images: Image[] = [];
  const blocks = await rasterizeDiagrams(contentBlocks(context), images, warnings);
  const plain = blocks.filter((block): block is Block => block.kind !== 'image');
  const coverText = [context.artifact.name, context.artifact.objective ?? '', context.presentationModel?.title ?? '', ...buildMetadata(context).flat()].join('\n');
  const fonts = await PdfFontSet.load(stylesOf(plain), `${textOf(plain)}\n${coverText}`);

  // Primera pasada sin índice, para saber en qué página cae cada título.
  const probe = render(context, fonts, blocks, null);
  const candidates = probe.headings.filter((h): h is PdfHeadingRecord & { level: 1 | 2 } => h.level <= 2);
  let renderer = probe;
  if (candidates.length >= TOC_MIN_HEADINGS) {
    const tocPages = computeTocPageCount(candidates.length);
    renderer = render(context, fonts, blocks, candidates.map((h) => ({ text: h.text, level: h.level, page: h.page + tocPages })));
  }

  const writer = new PdfWriter();
  const catalog = writer.reserve();
  const pagesId = writer.reserve();
  const pageIds = renderer.pages.map(() => writer.reserve());
  const fontDict = fonts.writeFonts(writer);
  const xobjects = images.map((image) => `/${image.name} ${writer.addStream(
    `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>`,
    image.bytes,
  )} 0 R`);
  const resources = `<< /Font ${fontDict}${xobjects.length ? ` /XObject << ${xobjects.join(' ')} >>` : ''} >>`;
  renderer.pages.forEach((page, index) => {
    const contents = writer.addStream('<< >>', ascii(page.ops.join('\n')));
    writer.set(pageIds[index], `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources ${resources} /Contents ${contents} 0 R /StructParents ${index} /Tabs /S >>`);
  });
  writer.set(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  const structTree = writeStructTree(writer, renderer.root, renderer.pages.map((page) => page.marks), pageIds);
  const outline = writeOutline(writer, renderer.headings, pageIds);
  writer.set(catalog, [
    '<< /Type /Catalog', `/Pages ${pagesId} 0 R`,
    outline ? `/Outlines ${outline} 0 R /PageMode /UseOutlines` : '',
    `/StructTreeRoot ${structTree} 0 R /MarkInfo << /Marked true >> /Lang (es-ES)`,
    '/ViewerPreferences << /DisplayDocTitle true >> >>',
  ].filter(Boolean).join(' '));
  const { artifact } = context;
  const info = writer.add([
    `<< /Title ${pdfTextString(context.presentationModel?.title || artifact.name || 'Documento')}`,
    artifact.objective ? `/Subject ${pdfTextString(artifact.objective)}` : '',
    `/Keywords ${pdfTextString(`${artifact.type}, v${artifact.version}`)}`,
    `/Creator ${pdfTextString(context.appName ?? 'Arky Pro')} /Producer (Arky)`,
    `/CreationDate ${pdfDate(context.generatedAt ?? new Date())} >>`,
  ].filter(Boolean).join(' '));

  if (fonts.missing.size > 0) {
    const listed = [...fonts.missing].map(([ch, count]) => `«${ch}» (U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')})${count > 1 ? ` ×${count}` : ''}`);
    warnings.push(`El PDF no pudo dibujar ${fonts.missing.size === 1 ? 'un carácter' : `${fonts.missing.size} caracteres`} que ninguna de sus fuentes contiene: ${listed.join(', ')}.`);
  }
  const receipt: ExportReceipt = {
    pages: renderer.pages.length,
    tables: renderer.contentTables,
    diagrams: images.length,
    losses: warnings,
    preview: {
      kind: 'page',
      title: context.presentationModel?.title || artifact.name || 'Documento',
      subtitle: artifact.objective || undefined,
      lines: renderer.headings.map((heading) => heading.text).slice(0, 6),
    },
  };
  return { bytes: writer.toBytes(catalog, info), warnings, receipt };
}
