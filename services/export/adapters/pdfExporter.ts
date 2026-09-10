import type { ExportAdapter, ExportContext } from '../exportTypes';
import { EXPORT_DEFINITIONS } from '../exportRegistry';
import { artifactTables, buildFile, buildMetadata, publicationMarkdown, shouldExportPublication } from './shared';
import { buildArtifactQualityReport } from '../../quality/artifactQualityService';
import { renderQualityReportMarkdown } from '../../quality/qualityReportRenderer';
import { parseChartSpec, CHART_PALETTE, type ChartSpec } from '../../../lib/chartSvg';

/**
 * Hand-written PDF 1.4 generator with professional layout:
 *  - Letter page size (612 x 792 pt), 1" margins
 *  - Title page band with brand eyebrow + metadata table
 *  - Heading hierarchy (H1/H2/H3) with sizes and weights
 *  - Bullet / numbered lists, blockquotes, code blocks
 *  - Bold / italic inline runs
 *  - Simple Markdown tables
 *  - Page header (artifact name) and footer (page X of Y)
 *
 * Implemented from scratch (no jsPDF dependency) so the bundle stays slim
 * and the output is byte-deterministic. Glyph widths use approximate AFM
 * advance values for Helvetica + Helvetica-Bold (good enough for wrapping).
 */

const encoder = new TextEncoder();

// Page geometry (Letter, 72 dpi → points).
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 72;
const MARGIN_TOP = 90;
const MARGIN_BOTTOM = 72;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

// Type scale.
const SIZE_BODY = 11;
const SIZE_H1 = 22;
const SIZE_H2 = 16;
const SIZE_H3 = 13;
const SIZE_CODE = 9.5;
const SIZE_META = 9;
const SIZE_FOOTER = 8.5;
const LEADING_BODY = 15;
const LEADING_H1 = 28;
const LEADING_H2 = 22;
const LEADING_H3 = 18;

// Font ids referenced inside the page resource dict.
const F_REG = 'F1';
const F_BOLD = 'F2';
const F_ITAL = 'F3';
const F_MONO = 'F4';

// --- PDF string + glyph helpers ---------------------------------------------

const escapePdfString = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

// Latin-1 (WinAnsi) is the default encoding for Type1 fonts. Map common
// punctuation to ASCII equivalents and drop anything we cannot represent so
// PDFs stay valid for Spanish content (accents survive via WinAnsi).
const sanitizeForPdf = (value: string): string => {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[•◦]/g, '-')
    .replace(/…/g, '...')
    .replace(/\u00A0/g, ' ')
    // Anything outside printable Latin-1 → '?'
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
};

// Approximate Helvetica advance widths (in 1/1000 em). Good enough for
// proportional wrap calculations. Source: Adobe Core 14 AFM (rounded).
const HELV_W: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
  '@': 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
};
const HELV_BOLD_W: Record<string, number> = {
  ' ': 278, '!': 333, '"': 474, '#': 556, '$': 556, '%': 889, '&': 722, "'": 238,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, ':': 333, ';': 333, '<': 584, '=': 584, '>': 584, '?': 611,
  '@': 975, A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 556, K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 333, '\\': 278, ']': 333, '^': 584, _: 556, '`': 333,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278,
  k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333,
  u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
  '{': 389, '|': 280, '}': 389, '~': 584,
};
const FALLBACK_W_REG = 500;
const FALLBACK_W_BOLD = 556;
const MONO_W = 600; // Courier-ish

const measure = (text: string, fontPt: number, font: 'reg' | 'bold' | 'ital' | 'mono'): number => {
  let units = 0;
  for (const ch of text) {
    if (font === 'mono') units += MONO_W;
    else if (font === 'bold') units += HELV_BOLD_W[ch] ?? FALLBACK_W_BOLD;
    else units += HELV_W[ch] ?? FALLBACK_W_REG; // italic shares regular metrics
  }
  return (units / 1000) * fontPt;
};

// --- Inline parsing ----------------------------------------------------------
// Splits a line into runs of {text, font}. Supports **bold**, *italic*,
// _italic_, `code`. Strips link syntax, keeping the visible label.

type RunFont = 'reg' | 'bold' | 'ital' | 'mono';
interface Run { text: string; font: RunFont }

const parseInline = (rawLine: string): Run[] => {
  // Replace links [text](url) → text
  const line = rawLine.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  const runs: Run[] = [];
  let i = 0;
  let buffer = '';
  const flush = (font: RunFont = 'reg') => {
    if (buffer) {
      runs.push({ text: buffer, font });
      buffer = '';
    }
  };
  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '*' && next === '*') {
      flush('reg');
      const end = line.indexOf('**', i + 2);
      if (end === -1) { buffer += '**'; i += 2; continue; }
      runs.push({ text: line.slice(i + 2, end), font: 'bold' });
      i = end + 2;
      continue;
    }
    if (ch === '`') {
      flush('reg');
      const end = line.indexOf('`', i + 1);
      if (end === -1) { buffer += '`'; i += 1; continue; }
      runs.push({ text: line.slice(i + 1, end), font: 'mono' });
      i = end + 1;
      continue;
    }
    if (ch === '*' || ch === '_') {
      const marker = ch;
      // require non-space immediately after
      if (next && next !== marker && next !== ' ') {
        const end = line.indexOf(marker, i + 1);
        if (end !== -1) {
          flush('reg');
          runs.push({ text: line.slice(i + 1, end), font: 'ital' });
          i = end + 1;
          continue;
        }
      }
    }
    buffer += ch;
    i += 1;
  }
  flush('reg');
  return runs.length ? runs : [{ text: '', font: 'reg' }];
};

const wrapRuns = (runs: Run[], fontPt: number, maxWidth: number): Run[][] => {
  const lines: Run[][] = [];
  let current: Run[] = [];
  let currentWidth = 0;
  const spaceWidth = measure(' ', fontPt, 'reg');

  // Tokenize each run into words while preserving font.
  const tokens: Array<{ text: string; font: RunFont; isSpace: boolean }> = [];
  runs.forEach((run) => {
    const parts = run.text.split(/(\s+)/);
    parts.forEach((part) => {
      if (!part) return;
      if (/^\s+$/.test(part)) tokens.push({ text: ' ', font: run.font, isSpace: true });
      else tokens.push({ text: part, font: run.font, isSpace: false });
    });
  });

  const pushCurrent = () => {
    // Trim trailing spaces.
    while (current.length && current[current.length - 1].text.endsWith(' ')) {
      const last = current[current.length - 1];
      last.text = last.text.replace(/\s+$/, '');
      if (!last.text) current.pop();
    }
    if (current.length) lines.push(current);
    current = [];
    currentWidth = 0;
  };

  for (const tok of tokens) {
    const w = tok.isSpace ? spaceWidth : measure(tok.text, fontPt, tok.font);
    if (!tok.isSpace && currentWidth + w > maxWidth && current.length) {
      pushCurrent();
    }
    if (tok.isSpace && current.length === 0) continue; // skip leading spaces
    if (current.length && tok.font === current[current.length - 1].font) {
      current[current.length - 1].text += tok.text;
    } else {
      current.push({ text: tok.text, font: tok.font });
    }
    currentWidth += w;
  }
  pushCurrent();
  return lines.length ? lines : [[{ text: '', font: 'reg' }]];
};

// --- Block parsing -----------------------------------------------------------

type CalloutTone = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION';

type Block =
  | { kind: 'h1' | 'h2' | 'h3'; text: string }
  | { kind: 'paragraph'; runs: Run[] }
  | { kind: 'bullet' | 'numbered'; marker: string; runs: Run[] }
  | { kind: 'quote'; runs: Run[] }
  | { kind: 'callout'; tone: CalloutTone; runs: Run[] }
  | { kind: 'code'; lines: string[] }
  | { kind: 'chart'; spec: ChartSpec }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'rule' }
  | { kind: 'spacer'; height: number };

const CALLOUT_PDF_TONES: Record<CalloutTone, { label: string; rgb: string; bg: string }> = {
  NOTE:      { label: 'NOTA',       rgb: '0.22 0.74 0.97', bg: '0.94 0.98 1' },
  TIP:       { label: 'SUGERENCIA', rgb: '0.20 0.83 0.60', bg: '0.93 0.99 0.96' },
  IMPORTANT: { label: 'IMPORTANTE', rgb: '0.65 0.55 0.98', bg: '0.96 0.95 1' },
  WARNING:   { label: 'ATENCION',   rgb: '0.98 0.75 0.14', bg: '1 0.98 0.92' },
  CAUTION:   { label: 'RIESGO',     rgb: '0.98 0.44 0.52', bg: '1 0.95 0.95' },
};

/** Hex `#rrggbb` → PDF `r g b` operands (0–1, 3 decimals). */
const hexToPdfRgb = (hex: string): string => {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
};

const parseMarkdownBlocks = (raw: string): Block[] => {
  const lines = sanitizeForPdf(raw).split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block (```chart specs become native vector charts).
    const fence = /^```(\w+)?/.exec(line);
    if (fence) {
      const lang = (fence[1] ?? '').toLowerCase();
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1;
      if (lang === 'chart') {
        const spec = parseChartSpec(codeLines.join('\n'));
        if (spec) {
          blocks.push({ kind: 'chart', spec });
          continue;
        }
      }
      blocks.push({ kind: 'code', lines: codeLines });
      continue;
    }

    // Table.
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) {
      const headers = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const row = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
        if (row.length) rows.push(row);
        i += 1;
      }
      blocks.push({ kind: 'table', headers, rows });
      continue;
    }

    // Headings.
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 3);
      blocks.push({ kind: (`h${level}` as 'h1' | 'h2' | 'h3'), text: heading[2].trim() });
      i += 1;
      continue;
    }

    // Horizontal rule.
    if (/^\s*(\*\s*){3,}\s*$/.test(line) || /^\s*(-\s*){3,}\s*$/.test(line) || /^\s*(_\s*){3,}\s*$/.test(line)) {
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    // Bullet list.
    if (/^\s*[-*+]\s+/.test(line)) {
      const text = line.replace(/^\s*[-*+]\s+/, '');
      blocks.push({ kind: 'bullet', marker: '-', runs: parseInline(text) });
      i += 1;
      continue;
    }

    // Numbered list.
    const numbered = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (numbered) {
      blocks.push({ kind: 'numbered', marker: `${numbered[1]}.`, runs: parseInline(numbered[2]) });
      i += 1;
      continue;
    }

    // Blockquote — GitHub-style callouts (`> [!WARNING] …`) become labelled
    // editorial cards; plain quotes keep the legacy rendering.
    if (/^\s*>\s?/.test(line)) {
      const text = line.replace(/^\s*>\s?/, '');
      const callout = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i.exec(text);
      if (callout) {
        const parts: string[] = [];
        if (callout[2].trim()) parts.push(callout[2].trim());
        let j = i + 1;
        while (j < lines.length && /^\s*>\s?/.test(lines[j])) {
          const cont = lines[j].replace(/^\s*>\s?/, '').trim();
          if (cont) parts.push(cont);
          j += 1;
        }
        blocks.push({
          kind: 'callout',
          tone: callout[1].toUpperCase() as CalloutTone,
          runs: parseInline(parts.join(' ')),
        });
        i = j;
        continue;
      }
      blocks.push({ kind: 'quote', runs: parseInline(text) });
      i += 1;
      continue;
    }

    // Blank line → spacer.
    if (!line.trim()) {
      blocks.push({ kind: 'spacer', height: 6 });
      i += 1;
      continue;
    }

    // Paragraph: greedily consume consecutive non-empty plain lines.
    const paragraphLines: string[] = [line];
    let j = i + 1;
    while (
      j < lines.length &&
      lines[j].trim() &&
      !/^#{1,6}\s+/.test(lines[j]) &&
      !/^\s*[-*+]\s+/.test(lines[j]) &&
      !/^\s*\d+\.\s+/.test(lines[j]) &&
      !/^```/.test(lines[j]) &&
      !/^\s*>\s?/.test(lines[j]) &&
      !/^\s*\|/.test(lines[j])
    ) {
      paragraphLines.push(lines[j]);
      j += 1;
    }
    blocks.push({ kind: 'paragraph', runs: parseInline(paragraphLines.join(' ')) });
    i = j;
  }
  return blocks;
};

// --- Rendering (build content stream) ---------------------------------------

interface PageBuffer {
  ops: string[];
}

const fontFor = (run: RunFont): string => {
  if (run === 'bold') return F_BOLD;
  if (run === 'ital') return F_ITAL;
  if (run === 'mono') return F_MONO;
  return F_REG;
};

/** Heading position recorded during rendering — feeds the TOC + outline. */
export interface PdfHeadingRecord {
  text: string;
  level: 1 | 2 | 3;
  /** 1-based page number. */
  page: number;
  /** Baseline Y of the heading on its page (PDF coords, bottom-up). */
  y: number;
}

export interface PdfTocEntry {
  text: string;
  level: 1 | 2;
  page: number;
}

// TOC geometry — shared by the renderer and the exact page-count planner.
const TOC_TITLE_BLOCK_H = 52;
const TOC_LINE_H = 18;
const TOC_PAGE_AVAIL_H = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM;

/** Exact number of pages the TOC will occupy for `entryCount` entries. */
export const computeTocPageCount = (entryCount: number): number => {
  if (entryCount <= 0) return 0;
  const firstPageLines = Math.floor((TOC_PAGE_AVAIL_H - TOC_TITLE_BLOCK_H) / TOC_LINE_H);
  if (entryCount <= firstPageLines) return 1;
  const perPage = Math.floor(TOC_PAGE_AVAIL_H / TOC_LINE_H);
  return 1 + Math.ceil((entryCount - firstPageLines) / perPage);
};

class PdfRenderer {
  pages: PageBuffer[] = [];
  /** Headings recorded as they are rendered (page + position). */
  headings: PdfHeadingRecord[] = [];
  private cursorY = PAGE_H - MARGIN_TOP;
  private artifactTitle: string;

  constructor(artifactTitle: string) {
    this.artifactTitle = sanitizeForPdf(artifactTitle);
    this.newPage();
  }

  private newPage(): void {
    this.pages.push({ ops: [] });
    this.cursorY = PAGE_H - MARGIN_TOP;
    this.drawPageHeader();
  }

  /** Force the next content onto a fresh page (cover/TOC separation). */
  breakPage(): void {
    this.newPage();
  }

  private current(): PageBuffer {
    return this.pages[this.pages.length - 1];
  }

  private ensureSpace(height: number): void {
    if (this.cursorY - height < MARGIN_BOTTOM) this.newPage();
  }

  private drawPageHeader(): void {
    const page = this.current();
    // Brand eyebrow band — thin line.
    page.ops.push('0.31 0.27 0.9 RG'); // indigo-ish
    page.ops.push('1 w');
    page.ops.push(`${MARGIN_X} ${PAGE_H - 60} m ${PAGE_W - MARGIN_X} ${PAGE_H - 60} l S`);
    // Eyebrow text on the left.
    page.ops.push('BT');
    page.ops.push(`/${F_BOLD} 8 Tf`);
    page.ops.push('0.31 0.27 0.9 rg');
    page.ops.push(`${MARGIN_X} ${PAGE_H - 52} Td`);
    page.ops.push(`(${escapePdfString('ARKY 10  ·  EXPORTACION DOCUMENTAL')}) Tj`);
    page.ops.push('ET');
    // Title (right aligned, truncated).
    const titleFont = SIZE_META;
    const maxTitleW = CONTENT_W * 0.55;
    let title = this.artifactTitle;
    while (measure(title, titleFont, 'reg') > maxTitleW && title.length > 4) {
      title = `${title.slice(0, -2).trimEnd()}...`;
    }
    const titleX = PAGE_W - MARGIN_X - measure(title, titleFont, 'reg');
    page.ops.push('BT');
    page.ops.push(`/${F_REG} ${titleFont} Tf`);
    page.ops.push('0.27 0.31 0.41 rg');
    page.ops.push(`${titleX} ${PAGE_H - 52} Td`);
    page.ops.push(`(${escapePdfString(title)}) Tj`);
    page.ops.push('ET');
  }

  private drawPageFooter(pageNumber: number, total: number): void {
    const page = this.pages[pageNumber - 1];
    page.ops.push('0.85 0.87 0.93 RG');
    page.ops.push('0.5 w');
    page.ops.push(`${MARGIN_X} 54 m ${PAGE_W - MARGIN_X} 54 l S`);
    const text = `${pageNumber} / ${total}`;
    const x = (PAGE_W - measure(text, SIZE_FOOTER, 'reg')) / 2;
    page.ops.push('BT');
    page.ops.push(`/${F_REG} ${SIZE_FOOTER} Tf`);
    page.ops.push('0.4 0.45 0.55 rg');
    page.ops.push(`${x} 42 Td`);
    page.ops.push(`(${escapePdfString(text)}) Tj`);
    page.ops.push('ET');
    // Left footer: app name. Right footer: generated date is captured in metadata.
    page.ops.push('BT');
    page.ops.push(`/${F_REG} ${SIZE_FOOTER} Tf`);
    page.ops.push('0.4 0.45 0.55 rg');
    page.ops.push(`${MARGIN_X} 42 Td`);
    page.ops.push(`(${escapePdfString('Arky Pro')}) Tj`);
    page.ops.push('ET');
  }

  private drawRunsLine(runs: Run[], fontPt: number, x: number, y: number, color = '0.09 0.12 0.20 rg'): void {
    const page = this.current();
    page.ops.push('BT');
    page.ops.push(color);
    page.ops.push(`${x} ${y} Td`);
    let lastFont: RunFont | null = null;
    for (const run of runs) {
      if (run.font !== lastFont) {
        page.ops.push(`/${fontFor(run.font)} ${fontPt} Tf`);
        lastFont = run.font;
      }
      page.ops.push(`(${escapePdfString(run.text)}) Tj`);
    }
    page.ops.push('ET');
  }

  private drawHeading(text: string, level: 1 | 2 | 3): void {
    const fontPt = level === 1 ? SIZE_H1 : level === 2 ? SIZE_H2 : SIZE_H3;
    const leading = level === 1 ? LEADING_H1 : level === 2 ? LEADING_H2 : LEADING_H3;
    const lines = wrapRuns([{ text, font: 'bold' }], fontPt, CONTENT_W);
    const topPad = level === 1 ? 18 : level === 2 ? 14 : 10;
    const bottomPad = level === 1 ? 6 : level === 2 ? 4 : 2;
    // Keep-with-next: a heading must never be orphaned at the bottom of a
    // page — reserve room for at least two body lines after it.
    this.ensureSpace(topPad + leading * lines.length + bottomPad + LEADING_BODY * 2);
    this.cursorY -= topPad;
    this.headings.push({
      text,
      level,
      page: this.pages.length,
      y: this.cursorY,
    });
    const color = level === 1 ? '0.06 0.09 0.16 rg' : level === 2 ? '0.12 0.16 0.27 rg' : '0.2 0.25 0.35 rg';
    for (const line of lines) {
      this.cursorY -= leading * 0.78;
      this.drawRunsLine(line, fontPt, MARGIN_X, this.cursorY, color);
      this.cursorY -= leading * 0.22;
    }
    if (level === 2) {
      const page = this.current();
      page.ops.push('0.83 0.85 0.92 RG');
      page.ops.push('0.6 w');
      page.ops.push(`${MARGIN_X} ${this.cursorY - 2} m ${PAGE_W - MARGIN_X} ${this.cursorY - 2} l S`);
    }
    this.cursorY -= bottomPad;
  }

  private drawParagraph(runs: Run[], opts: { indent?: number; leftBar?: boolean } = {}): void {
    const indent = opts.indent ?? 0;
    const wrapped = wrapRuns(runs, SIZE_BODY, CONTENT_W - indent);
    for (const line of wrapped) {
      this.ensureSpace(LEADING_BODY);
      this.cursorY -= LEADING_BODY * 0.78;
      if (opts.leftBar) {
        const page = this.current();
        page.ops.push('0.31 0.27 0.9 RG');
        page.ops.push('2 w');
        page.ops.push(`${MARGIN_X} ${this.cursorY - 2} m ${MARGIN_X} ${this.cursorY + 11} l S`);
      }
      this.drawRunsLine(line, SIZE_BODY, MARGIN_X + indent, this.cursorY);
      this.cursorY -= LEADING_BODY * 0.22;
    }
    this.cursorY -= 4;
  }

  private drawListItem(marker: string, runs: Run[]): void {
    const indent = 18;
    const markerX = MARGIN_X;
    const wrapped = wrapRuns(runs, SIZE_BODY, CONTENT_W - indent);
    this.ensureSpace(LEADING_BODY);
    this.cursorY -= LEADING_BODY * 0.78;
    // Draw marker on first line only.
    this.drawRunsLine([{ text: marker, font: 'bold' }], SIZE_BODY, markerX, this.cursorY, '0.31 0.27 0.9 rg');
    this.drawRunsLine(wrapped[0], SIZE_BODY, MARGIN_X + indent, this.cursorY);
    this.cursorY -= LEADING_BODY * 0.22;
    for (let k = 1; k < wrapped.length; k += 1) {
      this.ensureSpace(LEADING_BODY);
      this.cursorY -= LEADING_BODY * 0.78;
      this.drawRunsLine(wrapped[k], SIZE_BODY, MARGIN_X + indent, this.cursorY);
      this.cursorY -= LEADING_BODY * 0.22;
    }
    this.cursorY -= 2;
  }

  private drawCode(lines: string[]): void {
    const padX = 10;
    const padY = 8;
    const lineH = SIZE_CODE + 3;
    // Smart page break: a code block taller than the remaining page (or even
    // a whole page) is split into per-page chunks so it never overflows
    // below the bottom margin. Each chunk keeps the dark background.
    const maxLinesPerPage = Math.max(4, Math.floor((PAGE_H - MARGIN_TOP - MARGIN_BOTTOM - padY * 2 - 10) / lineH));
    if (lines.length > maxLinesPerPage) {
      for (let start = 0; start < lines.length; start += maxLinesPerPage) {
        this.drawCode(lines.slice(start, start + maxLinesPerPage));
      }
      return;
    }
    const blockH = lineH * lines.length + padY * 2;
    this.ensureSpace(blockH + 6);
    this.cursorY -= 4;
    const top = this.cursorY;
    const bottom = top - blockH;
    const page = this.current();
    // Background.
    page.ops.push('0.07 0.09 0.16 rg');
    page.ops.push(`${MARGIN_X} ${bottom} ${CONTENT_W} ${blockH} re f`);
    // Code text.
    let y = top - padY - SIZE_CODE;
    for (const raw of lines) {
      const line = raw.replace(/\t/g, '  ');
      page.ops.push('BT');
      page.ops.push(`/${F_MONO} ${SIZE_CODE} Tf`);
      page.ops.push('0.94 0.96 1 rg');
      page.ops.push(`${MARGIN_X + padX} ${y} Td`);
      // Truncate over-long lines instead of wrapping.
      let text = line;
      while (measure(text, SIZE_CODE, 'mono') > CONTENT_W - padX * 2 && text.length > 0) {
        text = text.slice(0, -1);
      }
      page.ops.push(`(${escapePdfString(text)}) Tj`);
      page.ops.push('ET');
      y -= lineH;
    }
    this.cursorY = bottom - 6;
  }

  private drawTable(headers: string[], rows: string[][]): void {
    const cols = headers.length;
    if (cols === 0) return;
    const colW = CONTENT_W / cols;
    const padX = 4;
    const rowH = 16;
    const cellFontPt = 9;

    const renderRow = (cells: string[], isHeader: boolean) => {
      // Compute height by wrapping each cell.
      const wrappedCells: Run[][][] = cells.map((c) =>
        wrapRuns([{ text: c, font: isHeader ? 'bold' : 'reg' }], cellFontPt, colW - padX * 2),
      );
      const lineCount = Math.max(1, ...wrappedCells.map((w) => w.length));
      const height = Math.max(rowH, lineCount * (cellFontPt + 3) + 6);
      this.ensureSpace(height);
      const top = this.cursorY;
      const bottom = top - height;
      const page = this.current();
      if (isHeader) {
        page.ops.push('0.93 0.95 1 rg');
        page.ops.push(`${MARGIN_X} ${bottom} ${CONTENT_W} ${height} re f`);
      }
      // Borders.
      page.ops.push('0.83 0.85 0.92 RG');
      page.ops.push('0.5 w');
      page.ops.push(`${MARGIN_X} ${bottom} m ${MARGIN_X + CONTENT_W} ${bottom} l S`);
      page.ops.push(`${MARGIN_X} ${top} m ${MARGIN_X + CONTENT_W} ${top} l S`);
      for (let c = 0; c <= cols; c += 1) {
        const x = MARGIN_X + c * colW;
        page.ops.push(`${x} ${bottom} m ${x} ${top} l S`);
      }
      // Text.
      wrappedCells.forEach((wrapped, ci) => {
        let y = top - (cellFontPt + 4);
        for (const line of wrapped) {
          this.drawRunsLine(line, cellFontPt, MARGIN_X + ci * colW + padX, y, isHeader ? '0.13 0.18 0.36 rg' : '0.13 0.16 0.24 rg');
          y -= cellFontPt + 3;
        }
      });
      this.cursorY = bottom;
    };

    this.cursorY -= 4;
    renderRow(headers, true);
    rows.forEach((row, idx) => {
      // Zebra striping.
      if (idx % 2 === 1) {
        const page = this.current();
        const cells = row.length < cols ? [...row, ...Array(cols - row.length).fill('')] : row.slice(0, cols);
        // Pre-measure height (mirror logic above without rendering).
        const wrapped = cells.map((c) => wrapRuns([{ text: c, font: 'reg' }], cellFontPt, colW - padX * 2));
        const lineCount = Math.max(1, ...wrapped.map((w) => w.length));
        const height = Math.max(rowH, lineCount * (cellFontPt + 3) + 6);
        this.ensureSpace(height);
        const top = this.cursorY;
        const bottom = top - height;
        page.ops.push('0.98 0.98 1 rg');
        page.ops.push(`${MARGIN_X} ${bottom} ${CONTENT_W} ${height} re f`);
      }
      const padded = row.length < cols ? [...row, ...Array(cols - row.length).fill('')] : row.slice(0, cols);
      renderRow(padded, false);
    });
    this.cursorY -= 8;
  }

  /**
   * Native vector chart. Bar/pie/donut render as horizontal bars (pie values
   * become percentages); line series degrade to a clean data table. Pure PDF
   * rect/text ops — crisp at any zoom and printer-safe.
   */
  private drawChart(spec: ChartSpec): void {
    if (spec.title) this.drawHeading(spec.title, 3);
    if (spec.type === 'line') {
      const headers = ['Serie', ...spec.labels];
      const rows = spec.series.map((s, i) => [s.name ?? `Serie ${i + 1}`, ...s.values.map((v) => `${v}${spec.unit ?? ''}`)]);
      this.drawTable(headers, rows);
      return;
    }
    const isPie = spec.type === 'pie' || spec.type === 'donut';
    const series = isPie ? [spec.series[0]] : spec.series;
    const total = series[0].values.reduce((a, b) => a + Math.max(0, b), 0);
    const max = Math.max(1e-9, ...series.flatMap((s) => s.values.map((v) => Math.abs(v))));
    const labelW = 150;
    const valueW = 64;
    const barMaxW = CONTENT_W - labelW - valueW - 12;
    const rowH = 17;
    this.cursorY -= 4;
    spec.labels.forEach((label, li) => {
      series.forEach((s, si) => {
        this.ensureSpace(rowH + 2);
        this.cursorY -= rowH;
        const page = this.current();
        const value = s.values[li];
        const ratio = isPie
          ? (total > 0 ? Math.max(0, value) / total : 0)
          : Math.abs(value) / max;
        const w = Math.max(2, ratio * barMaxW);
        const color = hexToPdfRgb(CHART_PALETTE[(isPie ? li : si) % CHART_PALETTE.length]);
        // Track + bar.
        page.ops.push('0.95 0.96 0.98 rg');
        page.ops.push(`${MARGIN_X + labelW} ${this.cursorY} ${barMaxW} ${rowH - 6} re f`);
        page.ops.push(`${color} rg`);
        page.ops.push(`${MARGIN_X + labelW} ${this.cursorY} ${w.toFixed(1)} ${rowH - 6} re f`);
        // Label (first series only) + value.
        if (si === 0) {
          let text = sanitizeForPdf(label);
          while (measure(text, 9, 'reg') > labelW - 10 && text.length > 4) text = `${text.slice(0, -2)}..`;
          this.drawRunsLine([{ text, font: 'reg' }], 9, MARGIN_X, this.cursorY + 1, '0.2 0.25 0.35 rg');
        }
        const valueText = isPie
          ? `${Math.round(ratio * 100)}%`
          : `${Math.round(value * 100) / 100}${spec.unit ?? ''}`;
        this.drawRunsLine([{ text: valueText, font: 'bold' }], 9, MARGIN_X + labelW + barMaxW + 6, this.cursorY + 1, '0.13 0.16 0.24 rg');
      });
      this.cursorY -= 3;
    });
    // Legend for multi-series bars.
    if (!isPie && spec.series.length > 1) {
      this.ensureSpace(14);
      this.cursorY -= 12;
      let x = MARGIN_X + labelW;
      spec.series.forEach((s, si) => {
        const page = this.current();
        page.ops.push(`${hexToPdfRgb(CHART_PALETTE[si % CHART_PALETTE.length])} rg`);
        page.ops.push(`${x} ${this.cursorY} 8 8 re f`);
        const name = sanitizeForPdf(s.name ?? `Serie ${si + 1}`);
        this.drawRunsLine([{ text: name, font: 'reg' }], 8.5, x + 12, this.cursorY + 1, '0.27 0.31 0.41 rg');
        x += 12 + measure(name, 8.5, 'reg') + 18;
      });
    }
    this.cursorY -= 8;
  }

  /** Labelled editorial callout: tinted background, tone bar and title. */
  private drawCallout(tone: CalloutTone, runs: Run[]): void {
    const palette = CALLOUT_PDF_TONES[tone];
    const indent = 16;
    const wrapped = wrapRuns(runs, SIZE_BODY, CONTENT_W - indent - 12);
    const labelH = 13;
    const blockH = labelH + wrapped.length * LEADING_BODY + 14;
    this.ensureSpace(blockH + 4);
    this.cursorY -= 4;
    const top = this.cursorY;
    const bottom = top - blockH;
    const page = this.current();
    page.ops.push(`${palette.bg} rg`);
    page.ops.push(`${MARGIN_X} ${bottom} ${CONTENT_W} ${blockH} re f`);
    page.ops.push(`${palette.rgb} rg`);
    page.ops.push(`${MARGIN_X} ${bottom} 3.5 ${blockH} re f`);
    this.drawRunsLine([{ text: palette.label, font: 'bold' }], 8.5, MARGIN_X + indent, top - 12, `${palette.rgb} rg`);
    let y = top - 12 - labelH;
    for (const line of wrapped) {
      y -= LEADING_BODY * 0.78;
      this.drawRunsLine(line, SIZE_BODY, MARGIN_X + indent, y + LEADING_BODY * 0.78 - 2);
      y -= LEADING_BODY * 0.22;
    }
    this.cursorY = bottom - 6;
  }

  private drawRule(): void {
    this.ensureSpace(14);
    this.cursorY -= 7;
    const page = this.current();
    page.ops.push('0.85 0.87 0.93 RG');
    page.ops.push('0.6 w');
    page.ops.push(`${MARGIN_X} ${this.cursorY} m ${PAGE_W - MARGIN_X} ${this.cursorY} l S`);
    this.cursorY -= 7;
  }

  drawCover(context: ExportContext): void {
    const artifact = context.artifact;
    // Brand band.
    const page = this.current();
    page.ops.push('0.31 0.27 0.9 rg');
    page.ops.push(`${MARGIN_X} ${PAGE_H - 110} 4 60 re f`);
    // Eyebrow.
    page.ops.push('BT');
    page.ops.push(`/${F_BOLD} 9 Tf`);
    page.ops.push('0.31 0.27 0.9 rg');
    page.ops.push(`${MARGIN_X + 16} ${PAGE_H - 76} Td`);
    page.ops.push(`(${escapePdfString('ARKY 10 · DOCUMENTO ARQUITECTURAL')}) Tj`);
    page.ops.push('ET');
    // Title.
    const titleText = sanitizeForPdf(artifact.name || 'Documento');
    const titleLines = wrapRuns([{ text: titleText, font: 'bold' }], 28, CONTENT_W - 16);
    let y = PAGE_H - 110;
    for (const line of titleLines) {
      y -= 34;
      this.drawRunsLine(line, 28, MARGIN_X + 16, y, '0.06 0.09 0.16 rg');
    }
    // Subtitle.
    const subtitle = sanitizeForPdf(artifact.objective || 'Documento generado por Arky Pro para revisión ejecutiva y técnica.');
    const subLines = wrapRuns([{ text: subtitle, font: 'reg' }], 12, CONTENT_W - 16);
    y -= 16;
    for (const line of subLines) {
      y -= 16;
      this.drawRunsLine(line, 12, MARGIN_X + 16, y, '0.4 0.45 0.55 rg');
    }
    this.cursorY = y - 28;

    // Metadata table.
    const meta = buildMetadata(context);
    this.drawTable(['Campo', 'Valor'], meta.map(([k, v]) => [k, sanitizeForPdf(v)]));
    this.cursorY -= 6;
  }

  /**
   * Render the table of contents: "Contenido" title followed by one
   * dot-leader line per entry with the right-aligned page number. Geometry
   * matches {@link computeTocPageCount} exactly so the page shift applied to
   * entry numbers is always correct.
   */
  drawToc(entries: PdfTocEntry[]): void {
    // Title block (fixed height TOC_TITLE_BLOCK_H).
    this.cursorY -= 34;
    this.drawRunsLine([{ text: 'Contenido', font: 'bold' }], SIZE_H1, MARGIN_X, this.cursorY, '0.06 0.09 0.16 rg');
    const page = this.current();
    page.ops.push('0.31 0.27 0.9 RG');
    page.ops.push('1.4 w');
    page.ops.push(`${MARGIN_X} ${this.cursorY - 8} m ${MARGIN_X + 120} ${this.cursorY - 8} l S`);
    this.cursorY -= TOC_TITLE_BLOCK_H - 34;

    for (const entry of entries) {
      if (this.cursorY - TOC_LINE_H < MARGIN_BOTTOM) this.newPage();
      this.cursorY -= TOC_LINE_H;
      const indent = entry.level === 1 ? 0 : 16;
      const font: RunFont = entry.level === 1 ? 'bold' : 'reg';
      const pageLabel = String(entry.page);
      const pageLabelW = measure(pageLabel, SIZE_BODY, 'reg');
      const numberX = PAGE_W - MARGIN_X - pageLabelW;
      // Truncate the entry text so it never collides with the page number.
      const maxTextW = CONTENT_W - indent - pageLabelW - 24;
      let text = entry.text;
      while (measure(text, SIZE_BODY, font) > maxTextW && text.length > 4) {
        text = `${text.slice(0, -2).trimEnd()}...`;
      }
      this.drawRunsLine([{ text, font }], SIZE_BODY, MARGIN_X + indent, this.cursorY,
        entry.level === 1 ? '0.09 0.12 0.20 rg' : '0.27 0.31 0.41 rg');
      // Dot leader between text end and the page number.
      const textEnd = MARGIN_X + indent + measure(text, SIZE_BODY, font) + 6;
      const dotW = measure('.', SIZE_BODY, 'reg') + 2.4;
      const dotCount = Math.max(0, Math.floor((numberX - 8 - textEnd) / dotW));
      if (dotCount > 0) {
        const dots = '.'.repeat(dotCount);
        this.drawRunsLine([{ text: dots, font: 'reg' }], SIZE_BODY, textEnd, this.cursorY, '0.72 0.75 0.82 rg');
      }
      this.drawRunsLine([{ text: pageLabel, font: 'reg' }], SIZE_BODY, numberX, this.cursorY, '0.27 0.31 0.41 rg');
    }
  }

  drawBlocks(blocks: Block[]): void {
    for (const block of blocks) {
      switch (block.kind) {
        case 'h1':
          this.drawHeading(block.text, 1);
          break;
        case 'h2':
          this.drawHeading(block.text, 2);
          break;
        case 'h3':
          this.drawHeading(block.text, 3);
          break;
        case 'paragraph':
          this.drawParagraph(block.runs);
          break;
        case 'bullet':
        case 'numbered':
          this.drawListItem(block.marker, block.runs);
          break;
        case 'quote':
          this.drawParagraph(block.runs, { indent: 14, leftBar: true });
          break;
        case 'callout':
          this.drawCallout(block.tone, block.runs);
          break;
        case 'code':
          this.drawCode(block.lines);
          break;
        case 'chart':
          this.drawChart(block.spec);
          break;
        case 'table':
          this.drawTable(block.headers, block.rows);
          break;
        case 'rule':
          this.drawRule();
          break;
        case 'spacer':
          this.cursorY -= block.height;
          break;
      }
    }
  }

  finalize(): void {
    const total = this.pages.length;
    for (let p = 1; p <= total; p += 1) {
      this.drawPageFooter(p, total);
    }
  }
}

// --- PDF assembly ------------------------------------------------------------

const concatBytes = (chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

/** Minimum number of H1/H2 headings before a TOC is worth its pages. */
const TOC_MIN_HEADINGS = 4;

interface PdfRenderPlan {
  blocks: Block[];
  appendixBlocks: Block[];
}

const buildRenderPlan = (context: ExportContext): PdfRenderPlan => {
  const exportContent = shouldExportPublication(context) ? publicationMarkdown(context) : (context.artifact.content || '');
  const blocks = parseMarkdownBlocks(exportContent);
  const appendixBlocks: Block[] = [];
  // Appendix: detected tables for the *original* export only. Publication
  // markdown already renders its tables exactly once inside the blocks above.
  const tables = shouldExportPublication(context) ? [] : artifactTables(context.artifact);
  if (tables.length > 0) {
    appendixBlocks.push({ kind: 'h2', text: 'Tablas detectadas' });
    for (const table of tables) {
      appendixBlocks.push(
        { kind: 'h3', text: table.title || 'Tabla' },
        { kind: 'table', headers: table.headers, rows: table.rows },
      );
    }
  }
  // Optional formal quality report appended at the end of the document.
  if (context.includeQualityReport) {
    appendixBlocks.push({ kind: 'rule' });
    appendixBlocks.push(...parseMarkdownBlocks(renderQualityReportMarkdown(buildArtifactQualityReport(context.artifact))));
  }
  return { blocks, appendixBlocks };
};

const renderPass = (context: ExportContext, plan: PdfRenderPlan, toc: PdfTocEntry[] | null): PdfRenderer => {
  const renderer = new PdfRenderer(context.presentationModel?.title || context.artifact.name || 'Documento');
  renderer.drawCover(context);
  if (toc && toc.length > 0) {
    renderer.breakPage();
    renderer.drawToc(toc);
  }
  // Content always starts on a fresh page after the cover/TOC so the
  // pagination of pass 1 (no TOC) and pass 2 (with TOC) only differs by the
  // number of TOC pages — which is exactly the shift applied to the entries.
  renderer.breakPage();
  renderer.drawBlocks(plan.blocks);
  renderer.drawBlocks(plan.appendixBlocks);
  renderer.finalize();
  return renderer;
};

export function buildPdfBlob(context: ExportContext): Blob {
  const plan = buildRenderPlan(context);

  // Pass 1: paginate without TOC to learn which page each heading lands on.
  const probe = renderPass(context, plan, null);
  const tocCandidates = probe.headings.filter((h): h is PdfHeadingRecord & { level: 1 | 2 } => h.level <= 2);
  let toc: PdfTocEntry[] | null = null;
  if (tocCandidates.length >= TOC_MIN_HEADINGS) {
    const tocPages = computeTocPageCount(tocCandidates.length);
    toc = tocCandidates.map((h) => ({ text: h.text, level: h.level, page: h.page + tocPages }));
  }

  // Pass 2: the real render (identical pagination, TOC inserted when useful).
  const renderer = toc ? renderPass(context, plan, toc) : probe;

  // Object layout:
  //   1: Catalog
  //   2: Pages
  //   3..(2+pages): Page objects
  //   (3+pages)..(2+2*pages): Content streams
  //   next 4: Font resources (F1..F4)
  //   then: Outline root + one item per H1/H2 heading (document bookmarks)
  const pageCount = renderer.pages.length;
  const fontObjStart = 3 + pageCount * 2;
  const objects: string[] = [];
  const outlineHeadings = renderer.headings.filter((h) => h.level <= 2);
  const outlineRootObj = outlineHeadings.length > 0 ? fontObjStart + 4 : 0;
  objects.push(outlineRootObj > 0
    ? `<< /Type /Catalog /Pages 2 0 R /Outlines ${outlineRootObj} 0 R /PageMode /UseOutlines >>`
    : '<< /Type /Catalog /Pages 2 0 R >>');
  const pageObjNums: number[] = [];
  for (let i = 0; i < pageCount; i += 1) pageObjNums.push(3 + i * 2);
  objects.push(`<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageCount} >>`);
  const fontResource = `<< /${F_REG} ${fontObjStart} 0 R /${F_BOLD} ${fontObjStart + 1} 0 R /${F_ITAL} ${fontObjStart + 2} 0 R /${F_MONO} ${fontObjStart + 3} 0 R >>`;
  for (let i = 0; i < pageCount; i += 1) {
    const pageObj = 3 + i * 2;
    const streamObj = pageObj + 1;
    const stream = renderer.pages[i].ops.join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font ${fontResource} >> /Contents ${streamObj} 0 R >>`);
    const streamBytes = encoder.encode(stream);
    objects.push(`<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');

  // Document outline (bookmarks): every H1 is a top-level item; the H2s that
  // follow it become its children, so PDF viewers offer sidebar navigation.
  if (outlineHeadings.length > 0) {
    const firstItemObj = outlineRootObj + 1;
    interface OutlineItem { heading: PdfHeadingRecord; obj: number; parent: number; children: number[] }
    const items: OutlineItem[] = outlineHeadings.map((heading, idx) => ({
      heading,
      obj: firstItemObj + idx,
      parent: outlineRootObj,
      children: [],
    }));
    let lastTopLevel: OutlineItem | null = null;
    for (const item of items) {
      if (item.heading.level === 1) {
        lastTopLevel = item;
      } else if (lastTopLevel) {
        item.parent = lastTopLevel.obj;
        lastTopLevel.children.push(item.obj);
      }
    }
    const topLevel = items.filter((item) => item.parent === outlineRootObj);
    objects.push(`<< /Type /Outlines /First ${topLevel[0].obj} 0 R /Last ${topLevel[topLevel.length - 1].obj} 0 R /Count ${topLevel.length} >>`);
    for (const item of items) {
      const siblings = item.parent === outlineRootObj
        ? topLevel
        : items.filter((i) => i.parent === item.parent);
      const idx = siblings.indexOf(item);
      const pageObj = 3 + (item.heading.page - 1) * 2;
      const destY = Math.min(PAGE_H, Math.round(item.heading.y + 24));
      const parts = [
        `/Title (${escapePdfString(sanitizeForPdf(item.heading.text))})`,
        `/Parent ${item.parent} 0 R`,
        `/Dest [${pageObj} 0 R /XYZ 0 ${destY} 0]`,
      ];
      if (idx > 0) parts.push(`/Prev ${siblings[idx - 1].obj} 0 R`);
      if (idx < siblings.length - 1) parts.push(`/Next ${siblings[idx + 1].obj} 0 R`);
      if (item.children.length > 0) {
        parts.push(`/First ${item.children[0]} 0 R`);
        parts.push(`/Last ${item.children[item.children.length - 1]} 0 R`);
        parts.push(`/Count ${item.children.length}`);
      }
      objects.push(`<< ${parts.join(' ')} >>`);
    }
  }

  const chunks: Uint8Array[] = [];
  chunks.push(encoder.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));
  const offsets: number[] = [0];
  let cursor = chunks[0].length;
  objects.forEach((obj, index) => {
    offsets.push(cursor);
    const bytes = encoder.encode(`${index + 1} 0 obj\n${obj}\nendobj\n`);
    chunks.push(bytes);
    cursor += bytes.length;
  });
  const xrefOffset = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { xref += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  chunks.push(encoder.encode(xref));
  chunks.push(encoder.encode(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));

  return new Blob([concatBytes(chunks)], { type: EXPORT_DEFINITIONS.pdf.mimeType });
}

export const pdfExporter: ExportAdapter = {
  format: 'pdf',
  async export(context) {
    return buildFile(context, 'pdf', buildPdfBlob(context), 'PDF generado con tipografía profesional, jerarquía de títulos, tablas y paginación.');
  },
};
