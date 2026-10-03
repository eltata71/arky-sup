/**
 * El PDF de un diagrama, dibujado en vectores (plan de diagramas, 2.4).
 *
 * Hasta ahora un diagrama exportado a PDF salía como documento: el texto del
 * artefacto, sin el dibujo. Aquí el diagrama se dibuja con operadores de PDF
 * —rectángulos, líneas, texto—, así que escala sin perder nitidez y su texto
 * se puede seleccionar y buscar. Dos páginas apaisadas:
 *
 * 1. El diagrama, con la disposición que tiene en pantalla (`DiagramSnapshot`),
 *    bajo una cabecera con título, versión, fecha y clasificación.
 * 2. El resumen accesible: lo que un lector de pantalla leería del diagrama, y
 *    lo que necesita quien lo recibe impreso para entenderlo sin leer cajas.
 *
 * Se carga con `import()` desde el adaptador PDF: `services/export` está en el
 * arranque, y esto sólo lo necesita quien exporta un diagrama.
 *
 * Desde 9.3 escribe con las mismas fuentes incrustadas que el PDF documental:
 * una etiqueta «Solicitud → Emisión» conserva su flecha.
 */

import type { DiagramSnapshot, DiagramSnapshotNode } from '../diagramSnapshot';
import type { ExportContext, ExportedFile } from '../exportTypes';
import { buildFile } from './shared';
import { EXPORT_DEFINITIONS } from '../exportRegistry';
import { PdfFontSet, type FontStyle } from './pdf/pdfFonts';
import { PdfWriter, ascii, pdfTextString } from './pdf/pdfWriter';

// Carta apaisada, en puntos.
const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 40;
const HEADER_H = 56;
const FOOTER_H = 24;
const MAX_SCALE = 1.25;

const INK = '0.200 0.255 0.333'; // #334155
const MUTED = '0.392 0.455 0.545'; // #64748b
const NODE_FILL = '0.973 0.980 0.988'; // #f8fafc

export interface DiagramPdfInput {
  readonly title: string;
  readonly version?: number;
  readonly date: string;
  readonly owner?: string;
  readonly confidentiality?: string;
  readonly snapshot: DiagramSnapshot;
}

const num = (value: number): string => String(Math.round(value * 100) / 100);
const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Las fuentes del documento en curso; se cargan antes de dibujar. */
let fonts: PdfFontSet;
const measure = (text: string, size: number, font: FontStyle): number => fonts.measure(text, size, font);

const textOp = (font: 'F1' | 'F2', size: number, x: number, y: number, value: string, rgb = INK): string =>
  `${rgb} rg BT ${num(x)} ${num(y)} Td ${fonts.showText(value, Math.round(size * 100) / 100, font === 'F2' ? 'bold' : 'reg')} ET`;

/** Parte un texto en líneas que caben en `maxWidth`; una palabra demasiado larga se corta. */
function wrap(value: string, size: number, maxWidth: number, font: 'reg' | 'bold' = 'reg'): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of clean(value).split(' ').filter(Boolean)) {
    let piece = word;
    while (measure(piece, size, font) > maxWidth && piece.length > 1) {
      let cut = piece.length - 1;
      while (cut > 1 && measure(piece.slice(0, cut), size, font) > maxWidth) cut -= 1;
      if (line) { lines.push(line); line = ''; }
      lines.push(piece.slice(0, cut));
      piece = piece.slice(cut);
    }
    const candidate = line ? `${line} ${piece}` : piece;
    if (measure(candidate, size, font) <= maxWidth) line = candidate;
    else { if (line) lines.push(line); line = piece; }
  }
  if (line) lines.push(line);
  return lines;
}

/** Donde la recta del centro de `from` hacia `toward` cruza el borde de `from`. */
function borderPoint(
  from: { cx: number; cy: number; hw: number; hh: number },
  toward: { x: number; y: number },
): { x: number; y: number } {
  const dx = toward.x - from.cx;
  const dy = toward.y - from.cy;
  if (dx === 0 && dy === 0) return { x: from.cx, y: from.cy };
  const t = Math.min(
    dx !== 0 ? from.hw / Math.abs(dx) : Number.POSITIVE_INFINITY,
    dy !== 0 ? from.hh / Math.abs(dy) : Number.POSITIVE_INFINITY,
  );
  return { x: from.cx + dx * t, y: from.cy + dy * t };
}

function header(input: DiagramPdfInput, page: number, pages: number): string[] {
  const titleSize = 15;
  const maxTitle = PAGE_W - MARGIN * 2;
  let title = clean(input.title);
  if (measure(title, titleSize, 'bold') > maxTitle) {
    while (title.length > 4 && measure(`${title}...`, titleSize, 'bold') > maxTitle) title = title.slice(0, -1);
    title = `${title.trimEnd()}...`;
  }
  const meta = [
    input.version ? `v${input.version}` : null,
    input.date.slice(0, 10),
    input.owner ? clean(input.owner) : null,
    input.confidentiality ? clean(input.confidentiality) : null,
  ].filter(Boolean).join('  ·  ');
  const top = PAGE_H - MARGIN;
  return [
    textOp('F2', titleSize, MARGIN, top - titleSize, title),
    textOp('F1', 9, MARGIN, top - titleSize - 16, meta, MUTED),
    `${MUTED} RG 0.5 w ${MARGIN} ${num(PAGE_H - MARGIN - HEADER_H + 8)} m ${PAGE_W - MARGIN} ${num(PAGE_H - MARGIN - HEADER_H + 8)} l S`,
    textOp('F1', 7.5, MARGIN, MARGIN - 12, `Página ${page} de ${pages}  ·  Diagrama vectorial generado con Arky: el texto se puede seleccionar y buscar.`, MUTED),
  ];
}

function drawDiagram(snapshot: DiagramSnapshot): string[] {
  const nodes = snapshot.nodes;
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.width));
  const maxY = Math.max(...nodes.map((n) => n.y + n.height));
  const areaX = MARGIN;
  const areaBottom = MARGIN + FOOTER_H;
  const areaW = PAGE_W - MARGIN * 2;
  const areaH = PAGE_H - MARGIN * 2 - HEADER_H - FOOTER_H;
  const scale = Math.min(areaW / Math.max(1, maxX - minX), areaH / Math.max(1, maxY - minY), MAX_SCALE);
  const offX = (areaW - (maxX - minX) * scale) / 2;
  const offY = (areaH - (maxY - minY) * scale) / 2;

  // Del lienzo (origen arriba a la izquierda, y hacia abajo) a la página (origen abajo, y hacia arriba).
  const box = (n: DiagramSnapshotNode) => {
    const w = n.width * scale;
    const h = n.height * scale;
    const x = areaX + offX + (n.x - minX) * scale;
    const y = areaBottom + areaH - offY - (n.y - minY) * scale - h;
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, hw: w / 2, hh: h / 2 };
  };
  const boxes = new Map(nodes.map((n) => [n.id, box(n)]));
  const ops: string[] = [];

  // Conexiones debajo de las cajas.
  const labelSize = Math.max(5.5, Math.min(8, 7 * scale));
  for (const edge of snapshot.edges) {
    const from = boxes.get(edge.source);
    const to = boxes.get(edge.target);
    if (!from || !to || edge.source === edge.target) continue;
    const start = borderPoint(from, { x: to.cx, y: to.cy });
    const end = borderPoint(to, { x: from.cx, y: from.cy });
    ops.push(`${INK} RG 0.7 w ${edge.dashed ? '[3 2] 0 d' : '[] 0 d'} ${num(start.x)} ${num(start.y)} m ${num(end.x)} ${num(end.y)} l S [] 0 d`);
    // Punta de flecha en el destino.
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const size = Math.max(3.5, Math.min(6, 5 * scale));
    const left = { x: end.x - size * Math.cos(angle - 0.4), y: end.y - size * Math.sin(angle - 0.4) };
    const right = { x: end.x - size * Math.cos(angle + 0.4), y: end.y - size * Math.sin(angle + 0.4) };
    ops.push(`${INK} rg ${num(end.x)} ${num(end.y)} m ${num(left.x)} ${num(left.y)} l ${num(right.x)} ${num(right.y)} l h f`);
    if (edge.label) {
      const label = clean(edge.label).slice(0, 48);
      const w = measure(label, labelSize, 'reg') + 4;
      const mx = (start.x + end.x) / 2;
      const my = (start.y + end.y) / 2;
      ops.push(`1 1 1 rg ${num(mx - w / 2)} ${num(my - labelSize / 2 - 1)} ${num(w)} ${num(labelSize + 2)} re f`);
      ops.push(textOp('F1', labelSize, mx - w / 2 + 2, my - labelSize / 2 + 1, label, MUTED));
    }
  }

  // Cajas, con su etiqueta centrada.
  const nodeSize = Math.max(6, Math.min(11, 9 * scale));
  for (const node of nodes) {
    const b = boxes.get(node.id)!;
    ops.push(`${NODE_FILL} rg ${INK} RG 0.8 w ${num(b.x)} ${num(b.y)} ${num(b.w)} ${num(b.h)} re B`);
    const leading = nodeSize * 1.2;
    const maxLines = Math.max(1, Math.floor((b.h - 4) / leading));
    const lines = wrap(node.label, nodeSize, Math.max(8, b.w - 8), 'bold').slice(0, maxLines);
    const blockH = lines.length * leading;
    lines.forEach((line, index) => {
      const w = measure(line, nodeSize, 'bold');
      const y = b.cy + blockH / 2 - leading * (index + 1) + (leading - nodeSize) / 2 + 1;
      ops.push(textOp('F2', nodeSize, b.cx - w / 2, y, line));
    });
  }
  return ops;
}

function drawSummary(summary: readonly string[]): string[] {
  const ops: string[] = [];
  const width = PAGE_W - MARGIN * 2;
  let y = PAGE_H - MARGIN - HEADER_H - 12;
  ops.push(textOp('F2', 12, MARGIN, y, 'Resumen accesible'));
  y -= 20;
  const paragraphs = summary.length > 0 ? summary : ['Este diagrama no tiene un resumen accesible disponible.'];
  for (const paragraph of paragraphs) {
    for (const line of wrap(paragraph, 10, width)) {
      if (y < MARGIN + FOOTER_H) {
        ops.push(textOp('F1', 10, MARGIN, y, '(El resumen continúa en el diagrama exportado en otros formatos.)', MUTED));
        return ops;
      }
      ops.push(textOp('F1', 10, MARGIN, y, line));
      y -= 14;
    }
    y -= 6;
  }
  return ops;
}

/** El PDF de dos páginas: el diagrama en vectores y su resumen accesible. */
export async function buildDiagramPdfBlob(input: DiagramPdfInput): Promise<Blob> {
  const text = [input.title, input.owner ?? '', input.confidentiality ?? '', ...input.snapshot.nodes.map((n) => n.label),
    ...input.snapshot.edges.map((e) => e.label ?? ''), ...input.snapshot.summary].join('\n');
  fonts = await PdfFontSet.load(new Set<FontStyle>(['reg', 'bold']), text);
  const pages = [
    [...header(input, 1, 2), ...drawDiagram(input.snapshot)],
    [...header(input, 2, 2), ...drawSummary(input.snapshot.summary)],
  ];
  const writer = new PdfWriter();
  const catalog = writer.reserve();
  const pagesId = writer.reserve();
  const pageIds = pages.map(() => writer.reserve());
  const fontDict = fonts.writeFonts(writer);
  pages.forEach((ops, index) => {
    const contents = writer.addStream('<< >>', ascii(ops.join('\n')));
    writer.set(pageIds[index], `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font ${fontDict} >> /Contents ${contents} 0 R >>`);
  });
  writer.set(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  writer.set(catalog, `<< /Type /Catalog /Pages ${pagesId} 0 R /Lang (es-ES) /ViewerPreferences << /DisplayDocTitle true >> >>`);
  const info = writer.add(`<< /Title ${pdfTextString(clean(input.title))} /Producer (Arky) >>`);
  return new Blob([writer.toBytes(catalog, info) as BlobPart], { type: EXPORT_DEFINITIONS.pdf.mimeType });
}

/** La exportación PDF de un diagrama desde el lienzo: el adaptador PDF delega aquí si hay instantánea. */
export async function exportDiagramPdf(context: ExportContext): Promise<ExportedFile> {
  const snapshot = context.diagramSnapshot!;
  const blob = await buildDiagramPdfBlob({
    title: context.artifact.name,
    version: context.artifact.version,
    date: (context.generatedAt ?? new Date()).toISOString(),
    owner: snapshot.owner,
    confidentiality: snapshot.confidentiality,
    snapshot,
  });
  const losses = fonts.missing.size > 0
    ? [`El PDF no pudo dibujar ${fonts.missing.size === 1 ? 'un carácter' : `${fonts.missing.size} caracteres`} de las etiquetas: ${[...fonts.missing.keys()].map((ch) => `«${ch}»`).join(', ')}.`]
    : [];
  return buildFile(context, 'pdf', blob, ['PDF vectorial del diagrama, con su resumen accesible.', ...losses].join(' '), {
    pages: 2,
    tables: 0,
    diagrams: 1,
    losses,
    preview: { kind: 'page', title: context.artifact.name, subtitle: 'Diagrama vectorial y resumen accesible', lines: snapshot.summary.slice(0, 6) },
  });
}

