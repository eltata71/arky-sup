import type { PresentationCalloutContent, PresentationKpiContent, PresentationTableContent } from '../../../presentation';
import { PPTX_FONT, PPTX_PALETTE } from './branding';
import { xmlEscape } from './xml';

export interface Frame { x: number; y: number; cx: number; cy: number }

export interface Run { text: string; size?: number; bold?: boolean; color?: string }

export interface Paragraph { runs: Run[]; align?: 'l' | 'ctr'; bullet?: boolean; spaceAfter?: number }

const runXml = (run: Run, fallbackSize: number, fallbackColor: string): string =>
  `<a:r><a:rPr lang="es-ES" sz="${run.size ?? fallbackSize}"${run.bold ? ' b="1"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${run.color ?? fallbackColor}"/></a:solidFill><a:latin typeface="${PPTX_FONT}"/></a:rPr><a:t>${xmlEscape(run.text)}</a:t></a:r>`;

export const paragraphXml = (p: Paragraph, size: number, color: string): string => {
  const bullet = p.bullet
    ? '<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>'
    : '<a:buNone/>';
  const indent = p.bullet ? ' marL="285750" indent="-285750"' : '';
  const space = p.spaceAfter ? `<a:spcAft><a:spcPts val="${p.spaceAfter}"/></a:spcAft>` : '';
  return `<a:p><a:pPr algn="${p.align ?? 'l'}"${indent}>${space}${bullet}</a:pPr>${p.runs.map((r) => runXml(r, size, color)).join('')}</a:p>`;
};

const xfrm = (f: Frame): string => `<a:xfrm><a:off x="${f.x}" y="${f.y}"/><a:ext cx="${f.cx}" cy="${f.cy}"/></a:xfrm>`;

export const textBox = (id: number, name: string, f: Frame, paragraphs: Paragraph[], opts: { size: number; color: string; fill?: string; border?: string; anchor?: 't' | 'ctr'; inset?: number }): string => {
  const fill = opts.fill ? `<a:solidFill><a:srgbClr val="${opts.fill}"/></a:solidFill>` : '<a:noFill/>';
  const line = opts.border ? `<a:ln w="12700"><a:solidFill><a:srgbClr val="${opts.border}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>';
  const inset = opts.inset ?? 91_440;
  const body = paragraphs.length > 0 ? paragraphs.map((p) => paragraphXml(p, opts.size, opts.color)).join('') : '<a:p><a:endParaRPr lang="es-ES"/></a:p>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlEscape(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(f)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}${line}</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="${inset}" tIns="${inset}" rIns="${inset}" bIns="${inset}" anchor="${opts.anchor ?? 't'}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${body}</p:txBody></p:sp>`;
};

const cellXml = (text: string, header: boolean, zebra: boolean): string => {
  const fill = header ? PPTX_PALETTE.primary : zebra ? PPTX_PALETTE.surfaceAlt : 'FFFFFF';
  const color = header ? PPTX_PALETTE.onDark : PPTX_PALETTE.ink;
  const border = `<a:solidFill><a:srgbClr val="${PPTX_PALETTE.border}"/></a:solidFill>`;
  const edge = (tag: string) => `<a:${tag} w="6350">${border}</a:${tag}>`;
  return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${paragraphXml({ runs: [{ text, bold: header }] }, header ? 1200 : 1100, color)}</a:txBody><a:tcPr marL="72000" marR="72000" marT="45720" marB="45720">${edge('lnL')}${edge('lnR')}${edge('lnT')}${edge('lnB')}<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></a:tcPr></a:tc>`;
};

/** Native table; ragged rows are padded to the widest row, nothing is cut. */
export const tableFrame = (id: number, f: Frame, table: PresentationTableContent): { xml: string; height: number } => {
  const width = Math.max(1, table.headers.length, ...table.rows.map((r) => r.length));
  const pad = (row: string[]): string[] => Array.from({ length: width }, (_, i) => row[i] ?? '');
  const rowH = 330_000;
  const colW = Math.floor(f.cx / width);
  const grid = Array.from({ length: width }, () => `<a:gridCol w="${colW}"/>`).join('');
  const rows = [
    { cells: pad(table.headers), header: true },
    ...table.rows.map((r) => ({ cells: pad(r), header: false })),
  ];
  const trs = rows
    .map((row, i) => `<a:tr h="${rowH}">${row.cells.map((c) => cellXml(c, row.header, !row.header && i % 2 === 0)).join('')}</a:tr>`)
    .join('');
  const height = rowH * rows.length;
  const xml = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Tabla"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${f.x}" y="${f.y}"/><a:ext cx="${colW * width}" cy="${height}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${grid}</a:tblGrid>${trs}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  return { xml, height };
};

/** Trend is written as glyph and word, never as colour alone. */
export const kpiCard = (id: number, f: Frame, kpi: PresentationKpiContent): string => {
  const trend = kpi.trend ? PPTX_PALETTE.trend[kpi.trend] : undefined;
  const paragraphs: Paragraph[] = [
    { runs: [{ text: kpi.label, size: 1100, color: PPTX_PALETTE.inkMuted }] },
    { runs: [{ text: kpi.value, size: 3000, bold: true, color: PPTX_PALETTE.primaryDark }] },
  ];
  if (trend) paragraphs.push({ runs: [{ text: `${trend.glyph} ${trend.word}`, size: 1100, bold: true, color: trend.color }] });
  if (kpi.detail) paragraphs.push({ runs: [{ text: kpi.detail, size: 1000, color: PPTX_PALETTE.inkMuted }] });
  return textBox(id, `KPI ${kpi.label}`, f, paragraphs, { size: 1100, color: PPTX_PALETTE.ink, fill: PPTX_PALETTE.surfaceAlt, border: PPTX_PALETTE.border });
};

/** The tone is named in the label, so it survives a greyscale print. */
export const calloutBox = (id: number, f: Frame, callout: PresentationCalloutContent): string => {
  const tone = PPTX_PALETTE.tone[callout.tone] ?? PPTX_PALETTE.tone.info;
  const paragraphs: Paragraph[] = [
    { runs: [{ text: callout.title ? `${tone.label}: ${callout.title}` : tone.label, size: 1200, bold: true, color: tone.solid }], spaceAfter: 200 },
    { runs: [{ text: callout.body, size: 1200, color: PPTX_PALETTE.ink }] },
  ];
  return textBox(id, `Aviso ${tone.label}`, f, paragraphs, { size: 1200, color: PPTX_PALETTE.ink, fill: tone.tint, border: tone.solid });
};

export const pictureXml = (id: number, f: Frame, relId: string, alt: string): string =>
  `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Diagrama" descr="${xmlEscape(alt)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(f)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;

/** A step on a drawn timeline: a numbered marker over a connecting rule, with its text beneath. */
export const timelineXml = (startId: number, f: Frame, steps: string[]): { xml: string; nextId: number } => {
  const count = Math.max(1, steps.length);
  const slot = Math.floor(f.cx / count);
  const marker = 380_000;
  const lineY = f.y + marker / 2;
  const parts: string[] = [
    `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${startId}" name="Línea de tiempo"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="${f.x + slot / 2}" y="${lineY}"/><a:ext cx="${slot * (count - 1)}" cy="0"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="28575"><a:solidFill><a:srgbClr val="${PPTX_PALETTE.primary}"/></a:solidFill></a:ln></p:spPr></p:cxnSp>`,
  ];
  let id = startId + 1;
  steps.forEach((step, i) => {
    const cx = f.x + slot * i + slot / 2;
    parts.push(
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Hito ${i + 1}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm({ x: Math.round(cx - marker / 2), y: f.y, cx: marker, cy: marker })}<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${PPTX_PALETTE.primary}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"/><a:lstStyle/>${paragraphXml({ runs: [{ text: String(i + 1), bold: true }], align: 'ctr' }, 1200, PPTX_PALETTE.onDark)}</p:txBody></p:sp>`,
    );
    id += 1;
    parts.push(textBox(id, `Texto del hito ${i + 1}`, { x: f.x + slot * i, y: f.y + marker + 80_000, cx: slot, cy: f.cy - marker - 80_000 }, [{ runs: [{ text: step }], align: 'ctr' }], { size: 1100, color: PPTX_PALETTE.ink }));
    id += 1;
  });
  return { xml: parts.join(''), nextId: id };
};
