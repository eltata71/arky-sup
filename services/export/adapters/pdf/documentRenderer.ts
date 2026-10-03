/**
 * La paginación y el dibujo del PDF documental: portada, índice, títulos,
 * párrafos, listas, tablas, código, citas, diagramas y gráficos.
 *
 * Es el renderizador que vivía dentro de `pdfExporter.ts`, con tres cambios de
 * 9.3: escribe con las fuentes incrustadas de `PdfFontSet` (nada se convierte
 * en «?»), marca cada trazo de contenido para la estructura etiquetada, y no
 * recorta: una fila con más celdas que la cabecera ensancha la tabla, una
 * línea de código larga se parte y una palabra que no cabe en su celda se
 * corta en vez de invadir la de al lado.
 */
import type { ExportContext } from '../../exportTypes';
import { buildMetadata } from '../shared';
import type { Block, CalloutTone, Run } from './documentBlocks';
import { parseInline } from './documentBlocks';
import type { FontStyle, PdfFontSet } from './pdfFonts';
import { num } from './pdfWriter';
import { structElem, type StructElem } from './pdfStructure';
import { drawChart } from './documentCharts';
import { CONTENT_W, MARGIN_BOTTOM, MARGIN_TOP, MARGIN_X, PAGE_H, PAGE_W } from './pageGeometry';


const SIZE_BODY = 11;
const SIZE_CODE = 9.5;
const SIZE_FOOTER = 8.5;
const LEADING_BODY = 15;
const HEADING = {
  1: { size: 22, leading: 28, top: 18, bottom: 6, color: '0.06 0.09 0.16 rg' },
  2: { size: 16, leading: 22, top: 14, bottom: 4, color: '0.12 0.16 0.27 rg' },
  3: { size: 13, leading: 18, top: 10, bottom: 2, color: '0.2 0.25 0.35 rg' },
} as const;
const INK = '0.09 0.12 0.20 rg';
const BRAND = '0.31 0.27 0.9';

/** Un diagrama ya rasterizado, listo para dibujarse como imagen. */
export interface PdfImage { readonly name: string; readonly width: number; readonly height: number; readonly alt: string }
export type RenderBlock = Block | { kind: 'image'; image: PdfImage };

export interface PdfHeadingRecord { text: string; level: 1 | 2 | 3; page: number; y: number }
export interface PdfTocEntry { text: string; level: 1 | 2; page: number }

const TOC_TITLE_BLOCK_H = 52;
const TOC_LINE_H = 18;
const TOC_PAGE_AVAIL_H = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM;

/** Páginas exactas que ocupa un índice de `entryCount` entradas. */
export const computeTocPageCount = (entryCount: number): number => {
  if (entryCount <= 0) return 0;
  const firstPageLines = Math.floor((TOC_PAGE_AVAIL_H - TOC_TITLE_BLOCK_H) / TOC_LINE_H);
  if (entryCount <= firstPageLines) return 1;
  const perPage = Math.floor(TOC_PAGE_AVAIL_H / TOC_LINE_H);
  return 1 + Math.ceil((entryCount - firstPageLines) / perPage);
};

const CALLOUT_TONES: Record<CalloutTone, { label: string; rgb: string; bg: string }> = {
  NOTE: { label: 'NOTA', rgb: '0.22 0.74 0.97', bg: '0.94 0.98 1' },
  TIP: { label: 'SUGERENCIA', rgb: '0.20 0.83 0.60', bg: '0.93 0.99 0.96' },
  IMPORTANT: { label: 'IMPORTANTE', rgb: '0.65 0.55 0.98', bg: '0.96 0.95 1' },
  WARNING: { label: 'ATENCIÓN', rgb: '0.98 0.75 0.14', bg: '1 0.98 0.92' },
  CAUTION: { label: 'RIESGO', rgb: '0.98 0.44 0.52', bg: '1 0.95 0.95' },
};

interface Page { ops: string[]; marks: StructElem[] }

export class DocumentRenderer {
  readonly pages: Page[] = [];
  readonly headings: PdfHeadingRecord[] = [];
  readonly root = structElem('Document');
  /** Tablas del contenido, sin la de la portada (recibo de 9.4). */
  contentTables = 0;
  cursorY = PAGE_H - MARGIN_TOP;
  private list: StructElem | null = null;

  constructor(readonly fonts: PdfFontSet, private readonly headerTitle: string) {
    this.newPage();
  }

  // ─── Primitivas ───────────────────────────────────────────────────────────

  measure(text: string, size: number, style: FontStyle): number {
    return this.fonts.measure(text, size, style);
  }

  /** La página donde se escribe: la última, salvo al numerar los pies. */
  private target: Page | null = null;

  private get page(): Page {
    return this.target ?? this.pages[this.pages.length - 1];
  }

  /** Trazos que no son contenido: fondos, filetes, cabeceras y pies. */
  art(...ops: string[]): void {
    this.page.ops.push('/Artifact BMC', ...ops, 'EMC');
  }

  /** Trazos de contenido de `elem`, marcados con un MCID de la página actual. */
  mark(elem: StructElem, ...ops: string[]): void {
    const mcid = this.page.marks.length;
    this.page.marks.push(elem);
    elem.children.push({ page: this.pages.length - 1, mcid });
    this.page.ops.push(`/${elem.type} <</MCID ${mcid}>> BDC`, ...ops, 'EMC');
  }

  /** Una línea de tramos con su fuente; sin `elem`, es decoración. */
  line(runs: Run[], size: number, x: number, y: number, color: string, elem: StructElem | null): void {
    const shown = runs.filter((run) => run.text).map((run) => this.fonts.showText(run.text, size, run.font)).join(' ');
    if (!shown) return;
    const ops = ['BT', color, `${num(x)} ${num(y)} Td`, shown, 'ET'];
    if (elem) this.mark(elem, ...ops);
    else this.art(...ops);
  }

  ensureSpace(height: number): void {
    if (this.cursorY - height < MARGIN_BOTTOM) this.newPage();
  }

  breakPage(): void {
    this.newPage();
  }

  private newPage(): void {
    this.pages.push({ ops: [], marks: [] });
    this.cursorY = PAGE_H - MARGIN_TOP;
    let title = this.headerTitle;
    while (this.measure(title, 9, 'reg') > CONTENT_W * 0.55 && title.length > 4) title = `${title.slice(0, -2).trimEnd()}…`;
    this.art(`${BRAND} RG`, '1 w', `${MARGIN_X} ${PAGE_H - 60} m ${PAGE_W - MARGIN_X} ${PAGE_H - 60} l S`);
    this.line([{ text: 'ARKY 10  ·  EXPORTACIÓN DOCUMENTAL', font: 'bold' }], 8, MARGIN_X, PAGE_H - 52, `${BRAND} rg`, null);
    this.line([{ text: title, font: 'reg' }], 9, PAGE_W - MARGIN_X - this.measure(title, 9, 'reg'), PAGE_H - 52, '0.27 0.31 0.41 rg', null);
  }

  /** Parte tramos en líneas que caben en `maxWidth`; una palabra más ancha se corta. */
  wrap(runs: Run[], size: number, maxWidth: number): Run[][] {
    const lines: Run[][] = [];
    let current: Run[] = [];
    let width = 0;
    const space = this.measure(' ', size, 'reg');
    const push = () => {
      while (current.length && /\s$/.test(current[current.length - 1].text)) {
        const last = current[current.length - 1];
        last.text = last.text.replace(/\s+$/, '');
        if (!last.text) current.pop();
      }
      if (current.length) lines.push(current);
      current = [];
      width = 0;
    };
    const append = (text: string, font: FontStyle, w: number) => {
      const last = current[current.length - 1];
      if (last && last.font === font) last.text += text;
      else current.push({ text, font });
      width += w;
    };
    for (const run of runs) {
      for (const part of run.text.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          if (current.length) append(' ', run.font, space);
          continue;
        }
        let word = part;
        let w = this.measure(word, size, run.font);
        if (width + w > maxWidth && current.length) push();
        while (w > maxWidth && Array.from(word).length > 1) {
          const chars = Array.from(word);
          let cut = chars.length - 1;
          while (cut > 1 && this.measure(chars.slice(0, cut).join(''), size, run.font) > maxWidth) cut -= 1;
          append(chars.slice(0, cut).join(''), run.font, 0);
          push();
          word = chars.slice(cut).join('');
          w = this.measure(word, size, run.font);
        }
        append(word, run.font, w);
      }
    }
    push();
    return lines.length ? lines : [[{ text: '', font: 'reg' }]];
  }

  // ─── Bloques ──────────────────────────────────────────────────────────────

  private heading(text: string, level: 1 | 2 | 3, parent: StructElem = this.root): void {
    const style = HEADING[level];
    const lines = this.wrap([{ text, font: 'bold' }], style.size, CONTENT_W);
    this.ensureSpace(style.top + style.leading * lines.length + style.bottom + LEADING_BODY * 2);
    this.cursorY -= style.top;
    this.headings.push({ text, level, page: this.pages.length, y: this.cursorY });
    const elem = structElem(`H${level}`, parent);
    for (const line of lines) {
      this.cursorY -= style.leading * 0.78;
      this.line(line, style.size, MARGIN_X, this.cursorY, style.color, elem);
      this.cursorY -= style.leading * 0.22;
    }
    if (level === 2) this.art('0.83 0.85 0.92 RG', '0.6 w', `${MARGIN_X} ${num(this.cursorY - 2)} m ${PAGE_W - MARGIN_X} ${num(this.cursorY - 2)} l S`);
    this.cursorY -= style.bottom;
  }

  private paragraph(runs: Run[], elem: StructElem, opts: { indent?: number; leftBar?: boolean } = {}): void {
    const indent = opts.indent ?? 0;
    for (const line of this.wrap(runs, SIZE_BODY, CONTENT_W - indent)) {
      this.ensureSpace(LEADING_BODY);
      this.cursorY -= LEADING_BODY * 0.78;
      if (opts.leftBar) this.art(`${BRAND} RG`, '2 w', `${MARGIN_X} ${num(this.cursorY - 2)} m ${MARGIN_X} ${num(this.cursorY + 11)} l S`);
      this.line(line, SIZE_BODY, MARGIN_X + indent, this.cursorY, INK, elem);
      this.cursorY -= LEADING_BODY * 0.22;
    }
    this.cursorY -= 4;
  }

  private listItem(marker: string, runs: Run[]): void {
    if (!this.list) this.list = structElem('L', this.root);
    const item = structElem('LI', this.list);
    const label = structElem('Lbl', item);
    const body = structElem('LBody', item);
    const indent = 18;
    const lines = this.wrap(runs, SIZE_BODY, CONTENT_W - indent);
    lines.forEach((line, index) => {
      this.ensureSpace(LEADING_BODY);
      this.cursorY -= LEADING_BODY * 0.78;
      if (index === 0) this.line([{ text: marker, font: 'bold' }], SIZE_BODY, MARGIN_X, this.cursorY, `${BRAND} rg`, label);
      this.line(line, SIZE_BODY, MARGIN_X + indent, this.cursorY, INK, body);
      this.cursorY -= LEADING_BODY * 0.22;
    });
    this.cursorY -= 2;
  }

  private code(lines: string[]): void {
    const elem = structElem('Code', this.root);
    const padX = 10;
    const padY = 8;
    const lineH = SIZE_CODE + 3;
    // Una línea más ancha que el bloque se parte: el código no se recorta.
    const wrapped = lines.flatMap((raw) => {
      const chars = Array.from(raw.replace(/\t/g, '  '));
      const out: string[] = [];
      let current = '';
      for (const ch of chars) {
        if (current && this.measure(current + ch, SIZE_CODE, 'mono') > CONTENT_W - padX * 2) { out.push(current); current = ''; }
        current += ch;
      }
      out.push(current);
      return out;
    });
    const perPage = Math.max(4, Math.floor((PAGE_H - MARGIN_TOP - MARGIN_BOTTOM - padY * 2 - 10) / lineH));
    for (let start = 0; start < wrapped.length || start === 0; start += perPage) {
      const chunk = wrapped.slice(start, start + perPage);
      const blockH = lineH * Math.max(1, chunk.length) + padY * 2;
      this.ensureSpace(blockH + 6);
      this.cursorY -= 4;
      const top = this.cursorY;
      this.art('0.07 0.09 0.16 rg', `${MARGIN_X} ${num(top - blockH)} ${CONTENT_W} ${num(blockH)} re f`);
      let y = top - padY - SIZE_CODE;
      for (const text of chunk) {
        this.line([{ text, font: 'mono' }], SIZE_CODE, MARGIN_X + padX, y, '0.94 0.96 1 rg', elem);
        y -= lineH;
      }
      this.cursorY = top - blockH - 6;
      if (wrapped.length === 0) break;
    }
  }

  /** Una tabla; con `literal`, las celdas son datos y no se leen como Markdown. */
  table(headers: string[], rows: string[][], literal = false): void {
    const cols = Math.max(headers.length, ...rows.map((row) => row.length));
    if (cols === 0) return;
    const table = structElem('Table', this.root);
    const colW = CONTENT_W / cols;
    const padX = 4;
    const size = 9;
    const pad = (cells: string[]) => [...cells, ...Array<string>(cols - cells.length).fill('')];
    const row = (cells: string[], header: boolean, zebra: boolean) => {
      const tr = structElem('TR', table);
      const wrapped = cells.map((cell) => {
        const runs = (literal ? [{ text: cell, font: 'reg' as FontStyle }] : parseInline(cell)).map((run) => (header ? { ...run, font: 'bold' as FontStyle } : run));
        return this.wrap(runs, size, colW - padX * 2);
      });
      const height = Math.max(16, Math.max(1, ...wrapped.map((w) => w.length)) * (size + 3) + 6);
      this.ensureSpace(height);
      const top = this.cursorY;
      const bottom = top - height;
      if (header || zebra) this.art(header ? '0.93 0.95 1 rg' : '0.98 0.98 1 rg', `${MARGIN_X} ${num(bottom)} ${CONTENT_W} ${num(height)} re f`);
      const borders = [`${MARGIN_X} ${num(bottom)} m ${MARGIN_X + CONTENT_W} ${num(bottom)} l S`, `${MARGIN_X} ${num(top)} m ${MARGIN_X + CONTENT_W} ${num(top)} l S`];
      for (let c = 0; c <= cols; c += 1) borders.push(`${num(MARGIN_X + c * colW)} ${num(bottom)} m ${num(MARGIN_X + c * colW)} ${num(top)} l S`);
      this.art('0.83 0.85 0.92 RG', '0.5 w', ...borders);
      wrapped.forEach((lines, ci) => {
        const cell = structElem(header ? 'TH' : 'TD', tr);
        let y = top - (size + 4);
        for (const line of lines) {
          this.line(line, size, MARGIN_X + ci * colW + padX, y, header ? '0.13 0.18 0.36 rg' : '0.13 0.16 0.24 rg', cell);
          y -= size + 3;
        }
      });
      this.cursorY = bottom;
    };
    this.cursorY -= 4;
    row(pad(headers), true, false);
    rows.forEach((cells, index) => row(pad(cells), false, index % 2 === 1));
    this.cursorY -= 8;
  }

  private callout(tone: CalloutTone, runs: Run[]): void {
    const palette = CALLOUT_TONES[tone];
    const elem = structElem('BlockQuote', this.root);
    const indent = 16;
    const lines = this.wrap(runs, SIZE_BODY, CONTENT_W - indent - 12);
    const blockH = 13 + lines.length * LEADING_BODY + 14;
    this.ensureSpace(blockH + 4);
    this.cursorY -= 4;
    const top = this.cursorY;
    this.art(`${palette.bg} rg`, `${MARGIN_X} ${num(top - blockH)} ${CONTENT_W} ${num(blockH)} re f`, `${palette.rgb} rg`, `${MARGIN_X} ${num(top - blockH)} 3.5 ${num(blockH)} re f`);
    this.line([{ text: palette.label, font: 'bold' }], 8.5, MARGIN_X + indent, top - 12, `${palette.rgb} rg`, elem);
    let y = top - 25;
    for (const line of lines) {
      this.line(line, SIZE_BODY, MARGIN_X + indent, y - 2, INK, elem);
      y -= LEADING_BODY;
    }
    this.cursorY = top - blockH - 6;
  }

  private image(image: PdfImage): void {
    const maxH = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM - 24;
    const scale = Math.min(CONTENT_W / image.width, maxH / image.height, 0.5);
    const w = image.width * scale;
    const h = image.height * scale;
    this.ensureSpace(h + 16);
    this.cursorY -= 8;
    const x = MARGIN_X + (CONTENT_W - w) / 2;
    const figure = structElem('Figure', this.root, image.alt);
    this.mark(figure, 'q', `${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.cursorY - h)} cm`, `/${image.name} Do`, 'Q');
    this.cursorY -= h + 8;
  }

  drawBlocks(blocks: readonly RenderBlock[]): void {
    for (const block of blocks) {
      if (block.kind !== 'bullet' && block.kind !== 'numbered' && block.kind !== 'spacer') this.list = null;
      switch (block.kind) {
        case 'h1': this.heading(block.text, 1); break;
        case 'h2': this.heading(block.text, 2); break;
        case 'h3': this.heading(block.text, 3); break;
        case 'paragraph': this.paragraph(block.runs, structElem('P', this.root)); break;
        case 'bullet':
        case 'numbered': this.listItem(block.marker, block.runs); break;
        case 'quote': this.paragraph(block.runs, structElem('BlockQuote', this.root), { indent: 14, leftBar: true }); break;
        case 'callout': this.callout(block.tone, block.runs); break;
        case 'code': this.code(block.lines); break;
        case 'diagram': this.code(block.code.split('\n')); break;
        case 'image': this.image(block.image); break;
        case 'chart': drawChart(this, block.spec, (text, level) => this.heading(text, level)); break;
        case 'table': this.table(block.headers, block.rows); this.contentTables += 1; break;
        case 'rule':
          this.ensureSpace(14);
          this.cursorY -= 7;
          this.art('0.85 0.87 0.93 RG', '0.6 w', `${MARGIN_X} ${num(this.cursorY)} m ${PAGE_W - MARGIN_X} ${num(this.cursorY)} l S`);
          this.cursorY -= 7;
          break;
        case 'spacer': this.cursorY -= block.height; break;
      }
    }
    this.list = null;
  }

  // ─── Portada, índice y pies ───────────────────────────────────────────────

  drawCover(context: ExportContext): void {
    const { artifact } = context;
    this.art(`${BRAND} rg`, `${MARGIN_X} ${PAGE_H - 110} 4 60 re f`);
    this.line([{ text: 'ARKY 10 · DOCUMENTO ARQUITECTURAL', font: 'bold' }], 9, MARGIN_X + 16, PAGE_H - 76, `${BRAND} rg`, null);
    const title = structElem('P', this.root);
    let y = PAGE_H - 110;
    for (const line of this.wrap([{ text: artifact.name || 'Documento', font: 'bold' }], 28, CONTENT_W - 16)) {
      y -= 34;
      this.line(line, 28, MARGIN_X + 16, y, '0.06 0.09 0.16 rg', title);
    }
    const subtitle = structElem('P', this.root);
    y -= 16;
    for (const line of this.wrap([{ text: artifact.objective || 'Documento generado por Arky Pro para revisión ejecutiva y técnica.', font: 'reg' }], 12, CONTENT_W - 16)) {
      y -= 16;
      this.line(line, 12, MARGIN_X + 16, y, '0.4 0.45 0.55 rg', subtitle);
    }
    this.cursorY = y - 28;
    // Los valores de la portada son datos, no Markdown: un identificador con «_» no es cursiva.
    this.table(['Campo', 'Valor'], buildMetadata(context), true);
    this.cursorY -= 6;
  }

  drawToc(entries: PdfTocEntry[]): void {
    const toc = structElem('TOC', this.root);
    this.cursorY -= 34;
    this.line([{ text: 'Contenido', font: 'bold' }], 22, MARGIN_X, this.cursorY, '0.06 0.09 0.16 rg', structElem('H1', toc));
    this.art(`${BRAND} RG`, '1.4 w', `${MARGIN_X} ${num(this.cursorY - 8)} m ${MARGIN_X + 120} ${num(this.cursorY - 8)} l S`);
    this.cursorY -= TOC_TITLE_BLOCK_H - 34;
    for (const entry of entries) {
      if (this.cursorY - TOC_LINE_H < MARGIN_BOTTOM) this.newPage();
      this.cursorY -= TOC_LINE_H;
      const item = structElem('TOCI', toc);
      const indent = entry.level === 1 ? 0 : 16;
      const font: FontStyle = entry.level === 1 ? 'bold' : 'reg';
      const label = String(entry.page);
      const labelW = this.measure(label, SIZE_BODY, 'reg');
      const numberX = PAGE_W - MARGIN_X - labelW;
      let text = entry.text;
      while (this.measure(text, SIZE_BODY, font) > CONTENT_W - indent - labelW - 24 && text.length > 4) text = `${text.slice(0, -2).trimEnd()}…`;
      this.line([{ text, font }], SIZE_BODY, MARGIN_X + indent, this.cursorY, entry.level === 1 ? INK : '0.27 0.31 0.41 rg', item);
      const textEnd = MARGIN_X + indent + this.measure(text, SIZE_BODY, font) + 6;
      const dots = Math.max(0, Math.floor((numberX - 8 - textEnd) / (this.measure('.', SIZE_BODY, 'reg') + 2.4)));
      if (dots > 0) this.line([{ text: '.'.repeat(dots), font: 'reg' }], SIZE_BODY, textEnd, this.cursorY, '0.72 0.75 0.82 rg', null);
      this.line([{ text: label, font: 'reg' }], SIZE_BODY, numberX, this.cursorY, '0.27 0.31 0.41 rg', item);
    }
  }

  finalize(): void {
    const total = this.pages.length;
    this.pages.forEach((page, index) => {
      this.target = page;
      const text = `${index + 1} / ${total}`;
      this.art('0.85 0.87 0.93 RG', '0.5 w', `${MARGIN_X} 54 m ${PAGE_W - MARGIN_X} 54 l S`);
      this.line([{ text, font: 'reg' }], SIZE_FOOTER, (PAGE_W - this.measure(text, SIZE_FOOTER, 'reg')) / 2, 42, '0.4 0.45 0.55 rg', null);
      this.line([{ text: 'Arky Pro', font: 'reg' }], SIZE_FOOTER, MARGIN_X, 42, '0.4 0.45 0.55 rg', null);
    });
    this.target = null;
  }
}
