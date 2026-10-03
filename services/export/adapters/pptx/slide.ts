import type { PresentationCalloutContent, PresentationDiagramContent, PresentationKpiContent, PresentationSlide, PresentationTableContent } from '../../../presentation';
import type { RasterizedDiagram } from '../../utils/mermaidRaster';
import { BODY_BOTTOM, CONTENT_WIDTH, MARGIN_X, PPTX_PALETTE, layoutSpecFor, LAYOUT_SPECS } from './branding';
import { calloutBox, kpiCard, pictureXml, tableFrame, textBox, timelineXml, type Frame, type Paragraph } from './shapes';
import { GROUP_HEADER, NS, XML_DECL, relationships } from './xml';

const EMU_PER_PX = 9525;
const GAP = 160_000;

export interface SlideImage extends RasterizedDiagram { imageNumber: number }

export const fitImage = (zone: Frame, widthPx: number, heightPx: number): Frame => {
  const w = Math.max(1, widthPx) * EMU_PER_PX;
  const h = Math.max(1, heightPx) * EMU_PER_PX;
  const scale = Math.min(zone.cx / w, zone.cy / h, 1);
  const cx = Math.max(1, Math.round(w * scale));
  const cy = Math.max(1, Math.round(h * scale));
  return { x: zone.x + Math.round((zone.cx - cx) / 2), y: zone.y + Math.round((zone.cy - cy) / 2), cx, cy };
};

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Builds one slide's shapes top-down; `cursor` is the next free y. */
export const buildSlideXml = (slide: PresentationSlide, image?: SlideImage): string => {
  const spec = layoutSpecFor(slide.layout);
  const dark = spec.hero;
  const ink = dark ? PPTX_PALETTE.onDark : PPTX_PALETTE.ink;
  const muted = dark ? PPTX_PALETTE.border : PPTX_PALETTE.inkMuted;
  let id = 2;
  const shapes: string[] = [];

  shapes.push(textBox(id++, 'Título', spec.title, [{ runs: [{ text: slide.title, size: spec.titleSize, bold: true, color: ink }], align: spec.align }], { size: spec.titleSize, color: ink, anchor: dark ? 'ctr' : 't' }));

  let cursor = spec.title.y + spec.title.cy;
  const sub = slide.subtitle || slide.keyMessage;
  if (sub) {
    const h = dark ? 600_000 : 480_000;
    shapes.push(textBox(id++, 'Mensaje', { x: MARGIN_X, y: cursor, cx: CONTENT_WIDTH, cy: h }, [{ runs: [{ text: sub, size: 1600, color: dark ? PPTX_PALETTE.primaryTint : PPTX_PALETTE.primary }], align: spec.align }], { size: 1600, color: muted }));
    cursor += h + GAP / 2;
  }

  const bodyTop = cursor;
  const room = (): Frame => ({ x: MARGIN_X, y: cursor, cx: CONTENT_WIDTH, cy: Math.max(300_000, BODY_BOTTOM - cursor) });
  const textParagraphs: Paragraph[] = [];
  const flushText = (): void => {
    if (textParagraphs.length === 0) return;
    const frame = room();
    const lines = textParagraphs.length;
    const h = Math.min(frame.cy, Math.max(360_000, lines * 330_000));
    const cols = spec.columns === 2 && lines > 1;
    if (cols) {
      const half = Math.ceil(lines / 2);
      const w = Math.floor((CONTENT_WIDTH - GAP) / 2);
      shapes.push(textBox(id++, 'Columna 1', { x: MARGIN_X, y: cursor, cx: w, cy: h }, textParagraphs.slice(0, half), { size: 1600, color: ink }));
      shapes.push(textBox(id++, 'Columna 2', { x: MARGIN_X + w + GAP, y: cursor, cx: w, cy: h }, textParagraphs.slice(half), { size: 1600, color: ink }));
    } else {
      shapes.push(textBox(id++, 'Texto', { x: MARGIN_X, y: cursor, cx: CONTENT_WIDTH, cy: h }, textParagraphs, { size: 1600, color: ink }));
    }
    cursor += (cols ? Math.ceil(h / 2) + 120_000 : h) + GAP;
    textParagraphs.length = 0;
  };

  let imageUsed = false;
  for (const block of slide.contentBlocks) {
    switch (block.type) {
      case 'text': {
        const text = asString(block.content);
        if (text) textParagraphs.push({ runs: [{ text }], spaceAfter: 400 });
        break;
      }
      case 'bullets':
        for (const item of asList(block.content)) textParagraphs.push({ runs: [{ text: item }], bullet: true, spaceAfter: 300 });
        break;
      case 'table': {
        flushText();
        const frame = room();
        const t = tableFrame(id++, { ...frame, cy: frame.cy }, block.content as PresentationTableContent);
        shapes.push(t.xml);
        cursor += t.height + GAP;
        const caption = (block.content as PresentationTableContent).caption;
        if (caption) {
          shapes.push(textBox(id++, 'Pie de tabla', { x: MARGIN_X, y: cursor, cx: CONTENT_WIDTH, cy: 320_000 }, [{ runs: [{ text: caption, size: 1000, color: muted }] }], { size: 1000, color: muted }));
          cursor += 320_000 + GAP / 2;
        }
        break;
      }
      case 'kpi': {
        flushText();
        const list = (Array.isArray(block.content) ? block.content : [block.content]) as PresentationKpiContent[];
        const n = Math.max(1, Math.min(4, list.length));
        const w = Math.floor((CONTENT_WIDTH - GAP * (n - 1)) / n);
        const rows = Math.ceil(list.length / n);
        const h = 1_500_000;
        list.forEach((kpi, i) => {
          shapes.push(kpiCard(id++, { x: MARGIN_X + (i % n) * (w + GAP), y: cursor + Math.floor(i / n) * (h + GAP), cx: w, cy: h }, kpi));
        });
        cursor += rows * (h + GAP);
        break;
      }
      case 'callout': {
        flushText();
        const h = 1_000_000;
        shapes.push(calloutBox(id++, { x: MARGIN_X, y: cursor, cx: CONTENT_WIDTH, cy: h }, block.content as PresentationCalloutContent));
        cursor += h + GAP;
        break;
      }
      case 'diagram': {
        flushText();
        const diagram = block.content as PresentationDiagramContent;
        const description = diagram.description?.trim();
        if (image && !imageUsed && diagram.mermaid?.trim()) {
          imageUsed = true;
          const captionH = description ? 380_000 : 0;
          const zone: Frame = { x: MARGIN_X, y: cursor, cx: CONTENT_WIDTH, cy: Math.max(600_000, BODY_BOTTOM - cursor - captionH) };
          const frame = fitImage(zone, image.width, image.height);
          shapes.push(pictureXml(id++, frame, 'rId3', description || slide.title));
          cursor = frame.y + frame.cy + GAP / 2;
          if (description) {
            shapes.push(textBox(id++, 'Pie de diagrama', { x: MARGIN_X, y: cursor, cx: CONTENT_WIDTH, cy: captionH }, [{ runs: [{ text: description, size: 1100, color: muted }], align: 'ctr' }], { size: 1100, color: muted }));
            cursor += captionH;
          }
        } else {
          const lines: Paragraph[] = [{ runs: [{ text: '[diagrama]', bold: true }] }];
          if (description) lines.push({ runs: [{ text: description }] });
          if (diagram.mermaid?.trim()) for (const l of diagram.mermaid.split('\n')) lines.push({ runs: [{ text: l, size: 1000, color: PPTX_PALETTE.inkMuted }] });
          const h = Math.min(room().cy, 300_000 * Math.min(lines.length, 12));
          shapes.push(textBox(id++, 'Diagrama (texto)', { x: MARGIN_X, y: cursor, cx: CONTENT_WIDTH, cy: h }, lines, { size: 1200, color: ink, fill: PPTX_PALETTE.surfaceAlt, border: PPTX_PALETTE.border }));
          cursor += h + GAP;
        }
        break;
      }
      case 'imagePlaceholder': {
        const text = typeof block.content === 'string' ? block.content : '';
        textParagraphs.push({ runs: [{ text: text ? `[imagen] ${text}` : '[imagen]' }] });
        break;
      }
    }
  }

  if (slide.layout === 'timeline' && textParagraphs.length > 0 && spec === LAYOUT_SPECS.timeline) {
    const steps = textParagraphs.splice(0).map((p) => p.runs.map((r) => r.text).join(''));
    const t = timelineXml(id, { x: MARGIN_X, y: bodyTop + 200_000, cx: CONTENT_WIDTH, cy: 2_000_000 }, steps);
    shapes.push(t.xml);
    id = t.nextId;
  }
  flushText();

  return `${XML_DECL}
<p:sld ${NS}><p:cSld><p:spTree>${GROUP_HEADER}${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
};

export const buildSlideRels = (layoutIndex: number, opts: { imageNumber?: number; notesNumber?: number }): string =>
  relationships([
    { id: 'rId1', type: 'slideLayout', target: `../slideLayouts/slideLayout${layoutIndex + 1}.xml` },
    ...(opts.notesNumber ? [{ id: 'rId2', type: 'notesSlide', target: `../notesSlides/notesSlide${opts.notesNumber}.xml` }] : []),
    ...(opts.imageNumber ? [{ id: 'rId3', type: 'image', target: `../media/image${opts.imageNumber}.png` }] : []),
  ]);
