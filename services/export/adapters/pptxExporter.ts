import type { ExportAdapter, ExportContext } from '../exportTypes';
import { EXPORT_DEFINITIONS } from '../exportRegistry';
import { createStoredZip, type ZipEntryInput } from '../utils/zip';
import { escapeHtml } from '../utils/text';
import { buildFile } from './shared';
import { parsePresentationDeck } from '../../presentation';
import { rasterizeMermaidToPng, type RasterizedDiagram } from '../utils/mermaidRaster';
import type { PresentationCalloutContent, PresentationContentBlock, PresentationDeck, PresentationDiagramContent, PresentationKpiContent, PresentationSlide, PresentationTableContent } from '../../presentation';

/**
 * Minimal-but-real PPTX (OOXML PresentationML) exporter.
 *
 * PPTX is a ZIP of OOXML XML parts. The bundle below is the smallest set of
 * parts PowerPoint / Keynote / Google Slides will accept as a valid deck:
 *   - `[Content_Types].xml`         — MIME mapping
 *   - `_rels/.rels`                 — root relationships → presentation.xml
 *   - `ppt/presentation.xml`        — deck + slide ids + dimensions
 *   - `ppt/_rels/presentation.xml.rels` — slide + slideMaster relationships
 *   - `ppt/slideMasters/slideMaster1.xml` (+ rels) — required master
 *   - `ppt/slideLayouts/slideLayout1.xml` (+ rels) — required layout
 *   - `ppt/theme/theme1.xml`        — required theme
 *   - `ppt/slides/slideN.xml` (+ rels) — one per slide
 *
 * Every slide is rendered as a title + a single text body that contains all
 * the slide's content blocks flattened to lines/bullets. This is intentional:
 * we want broad compatibility (PowerPoint is famously picky about layout
 * geometry) — the slide viewer in-app handles the rich rendering, while the
 * PPTX export gives users a real .pptx they can open and refine in their
 * editor of choice.
 */

const SLIDE_WIDTH_EMU = 9_144_000;  // 10in
const SLIDE_HEIGHT_EMU = 6_858_000; // 7.5in
const EMU_PER_PX = 9525;            // 96 dpi

// Zone reserved for an embedded diagram image (below title + key message).
const IMAGE_ZONE = {
  x: 457_200,
  y: 2_400_000,
  width: 8_229_600,
  height: 4_000_000,
} as const;

const xmlEscape = (value: string): string => escapeHtml(value).replace(/'/g, '&apos;');

/** Rasterized diagram attached to a slide, ready for OOXML embedding. */
export interface SlideDiagramImage extends RasterizedDiagram {
  /** 1-based global image number → ppt/media/image{n}.png */
  imageNumber: number;
}

const blockToLines = (block: PresentationContentBlock): string[] => {
  switch (block.type) {
    case 'text':
      return typeof block.content === 'string' ? [block.content] : [];
    case 'bullets':
      return Array.isArray(block.content) ? (block.content as string[]) : [];
    case 'callout': {
      const callout = block.content as PresentationCalloutContent;
      const tone = callout.tone.toUpperCase();
      const title = callout.title ? `${callout.title}: ` : '';
      return [`[${tone}] ${title}${callout.body}`];
    }
    case 'kpi': {
      const kpis: PresentationKpiContent[] = Array.isArray(block.content)
        ? (block.content as PresentationKpiContent[])
        : [block.content as PresentationKpiContent];
      return kpis.map(kpi => {
        const trend = kpi.trend === 'up' ? '↑' : kpi.trend === 'down' ? '↓' : kpi.trend === 'flat' ? '→' : '';
        return `${kpi.label}: ${kpi.value}${trend ? ` ${trend}` : ''}${kpi.detail ? ` — ${kpi.detail}` : ''}`;
      });
    }
    case 'table': {
      const table = block.content as PresentationTableContent;
      const headerLine = table.headers.join(' | ');
      const rowLines = table.rows.map(row => row.join(' | '));
      return headerLine ? [headerLine, ...rowLines] : rowLines;
    }
    case 'diagram': {
      const diagram = block.content as PresentationDiagramContent;
      const lines: string[] = [];
      if (diagram.description) lines.push(diagram.description);
      if (diagram.mermaid) lines.push('[diagrama]', ...diagram.mermaid.split('\n').slice(0, 12));
      return lines;
    }
    case 'imagePlaceholder':
      return [`[imagen] ${typeof block.content === 'string' ? block.content : 'Imagen sugerida'}`];
    default:
      return [];
  }
};

/**
 * Aspect-fit an image into {@link IMAGE_ZONE}, centred on both axes.
 * Returns the EMU frame for the `<a:xfrm>` of the picture shape.
 */
export const fitImageIntoZone = (widthPx: number, heightPx: number): { x: number; y: number; cx: number; cy: number } => {
  const naturalW = Math.max(1, widthPx) * EMU_PER_PX;
  const naturalH = Math.max(1, heightPx) * EMU_PER_PX;
  const scale = Math.min(IMAGE_ZONE.width / naturalW, IMAGE_ZONE.height / naturalH, 1);
  const cx = Math.max(1, Math.round(naturalW * scale));
  const cy = Math.max(1, Math.round(naturalH * scale));
  return {
    x: IMAGE_ZONE.x + Math.round((IMAGE_ZONE.width - cx) / 2),
    y: IMAGE_ZONE.y + Math.round((IMAGE_ZONE.height - cy) / 2),
    cx,
    cy,
  };
};

const buildPictureXml = (image: SlideDiagramImage): string => {
  const frame = fitImageIntoZone(image.width, image.height);
  return `<p:pic>
        <p:nvPicPr>
          <p:cNvPr id="4" name="Diagrama"/>
          <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
          <p:nvPr/>
        </p:nvPicPr>
        <p:blipFill>
          <a:blip r:embed="rId2"/>
          <a:stretch><a:fillRect/></a:stretch>
        </p:blipFill>
        <p:spPr>
          <a:xfrm><a:off x="${frame.x}" y="${frame.y}"/><a:ext cx="${frame.cx}" cy="${frame.cy}"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
      </p:pic>`;
};

const buildSlideXml = (slide: PresentationSlide, image?: SlideDiagramImage): string => {
  // When the slide carries a rasterized diagram, the mermaid source dump is
  // replaced by the real image: only the diagram description survives as a
  // caption line and the text body is capped so it never overlaps the image.
  const bodyLines = slide.contentBlocks
    .flatMap((block) => {
      if (image && block.type === 'diagram') {
        const diagram = block.content as PresentationDiagramContent;
        return diagram.description ? [diagram.description] : [];
      }
      return blockToLines(block);
    })
    .filter(line => line && line.trim().length > 0);
  if (slide.keyMessage) bodyLines.unshift(`★ ${slide.keyMessage}`);
  const visibleLines = image ? bodyLines.slice(0, 2) : bodyLines;
  // Power-rounded text body that PPT will render with default bullet styling.
  const paragraphs = visibleLines.map(line => `<a:p><a:r><a:rPr lang="es-ES" sz="1800" dirty="0"/><a:t>${xmlEscape(line)}</a:t></a:r></a:p>`).join('');
  const speakerNotesXml = slide.speakerNotes ? xmlEscape(slide.speakerNotes) : '';
  const titleText = xmlEscape(slide.title);
  const subtitleText = slide.subtitle ? xmlEscape(slide.subtitle) : '';
  const subtitleParagraph = subtitleText
    ? `<a:p><a:r><a:rPr lang="es-ES" sz="2000" dirty="0"/><a:t>${subtitleText}</a:t></a:r></a:p>`
    : '';
  const bodyHeight = image ? 760_000 : 4_800_600;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm>
      </p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="457200" y="274320"/><a:ext cx="8229600" cy="1143000"/></a:xfrm></p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:r><a:rPr lang="es-ES" sz="3600" b="1" dirty="0"/><a:t>${titleText}</a:t></a:r></a:p>
          ${subtitleParagraph}
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="457200" y="1600200"/><a:ext cx="8229600" cy="${bodyHeight}"/></a:xfrm></p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square"/>
          <a:lstStyle/>
          ${paragraphs || '<a:p><a:endParaRPr lang="es-ES" dirty="0"/></a:p>'}
        </p:txBody>
      </p:sp>
      ${image ? buildPictureXml(image) : ''}
    </p:spTree>
  </p:cSld>
  ${speakerNotesXml ? `<p:transition/>` : ''}
</p:sld>`;
};

const buildPresentationXml = (deck: PresentationDeck): string => {
  const sldIdList = deck.slides
    .map((_, idx) => `<p:sldId id="${256 + idx}" r:id="rId${idx + 2}"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>${sldIdList}</p:sldIdLst>
  <p:sldSz cx="${SLIDE_WIDTH_EMU}" cy="${SLIDE_HEIGHT_EMU}" type="screen4x3"/>
  <p:notesSz cx="${SLIDE_HEIGHT_EMU}" cy="${SLIDE_WIDTH_EMU}"/>
</p:presentation>`;
};

const buildPresentationRels = (slideCount: number): string => {
  const slideRels = Array.from({ length: slideCount }, (_, idx) =>
    `<Relationship Id="rId${idx + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${idx + 1}.xml"/>`,
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${slideRels}
</Relationships>`;
};

const buildContentTypes = (slideCount: number): string => {
  const slideOverrides = Array.from({ length: slideCount }, (_, idx) =>
    `<Override PartName="/ppt/slides/slide${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  ${slideOverrides}
</Types>`;
};

const SLIDE_MASTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg>
      <p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles>
    <p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="3200" b="1"/></a:lvl1pPr></p:titleStyle>
    <p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle>
    <p:otherStyle><a:defPPr><a:defRPr sz="1800"/></a:defPPr></p:otherStyle>
  </p:txStyles>
</p:sldMaster>`;

const SLIDE_MASTER_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

const SLIDE_LAYOUT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="title" preserve="1">
  <p:cSld name="Title and Content">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;

const SLIDE_LAYOUT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

const THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Arky">
  <a:themeElements>
    <a:clrScheme name="Arky">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F2937"/></a:dk2>
      <a:lt2><a:srgbClr val="F9FAFB"/></a:lt2>
      <a:accent1><a:srgbClr val="6366F1"/></a:accent1>
      <a:accent2><a:srgbClr val="06B6D4"/></a:accent2>
      <a:accent3><a:srgbClr val="10B981"/></a:accent3>
      <a:accent4><a:srgbClr val="F59E0B"/></a:accent4>
      <a:accent5><a:srgbClr val="EF4444"/></a:accent5>
      <a:accent6><a:srgbClr val="8B5CF6"/></a:accent6>
      <a:hlink><a:srgbClr val="2563EB"/></a:hlink>
      <a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Arky">
      <a:majorFont><a:latin typeface="Inter"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Inter"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Arky">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

const SLIDE_REL_TEMPLATE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

const buildSlideRelsWithImage = (imageNumber: number): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${imageNumber}.png"/>
</Relationships>`;

/**
 * Build the PPTX bundle. `slideDiagrams` maps slide index → rasterized PNG
 * of that slide's first Mermaid diagram block; slides without an entry keep
 * the legacy text-only rendering, so a partial rasterization failure never
 * blocks the export. Exported for unit testing.
 */
export const buildPptx = (deck: PresentationDeck, slideDiagrams: Map<number, RasterizedDiagram> = new Map()): Uint8Array => {
  const entries: ZipEntryInput[] = [];
  entries.push({ path: '[Content_Types].xml', content: buildContentTypes(deck.slides.length) });
  entries.push({ path: '_rels/.rels', content: ROOT_RELS });
  entries.push({ path: 'ppt/presentation.xml', content: buildPresentationXml(deck) });
  entries.push({ path: 'ppt/_rels/presentation.xml.rels', content: buildPresentationRels(deck.slides.length) });
  entries.push({ path: 'ppt/slideMasters/slideMaster1.xml', content: SLIDE_MASTER_XML });
  entries.push({ path: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', content: SLIDE_MASTER_RELS });
  entries.push({ path: 'ppt/slideLayouts/slideLayout1.xml', content: SLIDE_LAYOUT_XML });
  entries.push({ path: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', content: SLIDE_LAYOUT_RELS });
  entries.push({ path: 'ppt/theme/theme1.xml', content: THEME_XML });
  let imageCounter = 0;
  deck.slides.forEach((slide, idx) => {
    const raster = slideDiagrams.get(idx);
    if (raster) {
      imageCounter += 1;
      const image: SlideDiagramImage = { ...raster, imageNumber: imageCounter };
      entries.push({ path: `ppt/media/image${imageCounter}.png`, content: raster.pngBytes });
      entries.push({ path: `ppt/slides/slide${idx + 1}.xml`, content: buildSlideXml(slide, image) });
      entries.push({ path: `ppt/slides/_rels/slide${idx + 1}.xml.rels`, content: buildSlideRelsWithImage(imageCounter) });
    } else {
      entries.push({ path: `ppt/slides/slide${idx + 1}.xml`, content: buildSlideXml(slide) });
      entries.push({ path: `ppt/slides/_rels/slide${idx + 1}.xml.rels`, content: SLIDE_REL_TEMPLATE });
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

export const pptxExporter: ExportAdapter = {
  format: 'pptx',
  async export(context: ExportContext) {
    const parsed = parsePresentationDeck(context.artifact.content, {
      artifactType: context.artifact.type,
      artifactName: context.artifact.name,
    });
    // Rasterize each slide's diagram so PowerPoint shows the real picture
    // instead of the Mermaid source dump. Failures degrade per-slide to the
    // legacy text rendering.
    const slideDiagrams = new Map<number, RasterizedDiagram>();
    for (const [idx, mermaid] of collectSlideMermaid(parsed.deck)) {
      const raster = await rasterizeMermaidToPng(mermaid);
      if (raster) slideDiagrams.set(idx, raster);
    }
    const blobBytes = buildPptx(parsed.deck, slideDiagrams);
    // Force the underlying buffer to ArrayBuffer when called from a strict
    // environment that produces SharedArrayBuffer-backed Uint8Arrays.
    const blob = new Blob([blobBytes.slice().buffer], { type: EXPORT_DEFINITIONS.pptx.mimeType });
    return buildFile(context, 'pptx', blob);
  },
};
