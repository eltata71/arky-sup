import { escapeHtml } from '../../utils/text';
import { drawingXml, rasterizeDocumentDiagram, type DocxImage } from './images';

export interface DocxLink { id: number; target: string }
export interface DocxRenderState {
  images: DocxImage[];
  links: DocxLink[];
  warnings: string[];
  /** Tablas del contenido escritas como `w:tbl` (el recibo de 9.4 las cuenta aquí). */
  tables: number;
  /** Títulos del contenido en el orden en que se escribieron: el comienzo de la vista previa. */
  headings: string[];
}

export const createDocxRenderState = (): DocxRenderState => ({ images: [], links: [], warnings: [], tables: 0, headings: [] });

const run = (text: string, decoration = ''): string =>
  `<w:r>${decoration ? `<w:rPr>${decoration}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeHtml(text)}</w:t></w:r>`;

const inlinePattern = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

export function inlineXml(text: string, state: DocxRenderState): string {
  const parts: string[] = [];
  let position = 0;
  for (const match of text.matchAll(inlinePattern)) {
    const start = match.index ?? position;
    if (start > position) parts.push(run(text.slice(position, start)));
    const token = match[0];
    if (token.startsWith('**')) parts.push(run(token.slice(2, -2), '<w:b/>'));
    else if (token.startsWith('*') || token.startsWith('_')) parts.push(run(token.slice(1, -1), '<w:i/>'));
    else if (token.startsWith('`')) parts.push(run(token.slice(1, -1), '<w:rStyle w:val="Code"/>'));
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const label = link?.[1] ?? token;
      const target = link?.[2] ?? '';
      if (/^(https?:\/\/|mailto:)/i.test(target)) {
        const id = state.links.length + 100;
        state.links.push({ id, target });
        parts.push(`<w:hyperlink r:id="rId${id}">${run(label, '<w:color w:val="27346A"/><w:u w:val="single"/>')}</w:hyperlink>`);
      } else parts.push(run(label));
    }
    position = start + token.length;
  }
  if (position < text.length) parts.push(run(text.slice(position)));
  return parts.join('') || run('');
}

export function paragraphXml(text: string, state: DocxRenderState, style?: string, extraPr = ''): string {
  const properties = `${style ? `<w:pStyle w:val="${style}"/>` : ''}${extraPr}`;
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${inlineXml(text, state)}</w:p>`;
}

const splitCells = (line: string): string[] => {
  const value = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cell = '';
  let escaped = false;
  for (const ch of value) {
    if (escaped) { cell += ch; escaped = false; }
    else if (ch === '\\') escaped = true;
    else if (ch === '|') { cells.push(cell.trim()); cell = ''; }
    else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
};

const separator = (line: string): boolean => {
  const cells = splitCells(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
};

const tableCell = (text: string, state: DocxRenderState, width: number, header = false, span = 1): string =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${header ? '<w:shd w:fill="EEF2FF"/>' : ''}</w:tcPr><w:p>${header ? `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeHtml(text)}</w:t></w:r>` : inlineXml(text, state)}</w:p></w:tc>`;

/** Preserve every source cell. A short row is padded; an extra cell gets its own grid column. */
export function tableXml(headers: string[], rows: string[][], state: DocxRenderState, preferredWidths?: number[]): string {
  const width = Math.max(headers.length, ...rows.map((row) => row.length));
  const widths = preferredWidths?.length === width
    ? preferredWidths
    : Array.from({ length: width }, (_, index) => Math.floor(10080 / width) + (index === width - 1 ? 10080 % width : 0));
  const grid = widths.map((columnWidth) => `<w:gridCol w:w="${columnWidth}"/>`).join('');
  const header = headers.map((text, index) => {
    const span = index === headers.length - 1 ? width - headers.length + 1 : 1;
    const cellWidth = widths.slice(index, index + span).reduce((total, column) => total + column, 0);
    return tableCell(text, state, cellWidth, true, span);
  }).join('');
  const body = rows.map((row) => `<w:tr>${Array.from({ length: width }, (_, index) => tableCell(row[index] ?? '', state, widths[index] ?? 0)).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="10080" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid><w:tr>${header}</w:tr>${body}</w:tbl>`;
}

const listParagraph = (text: string, state: DocxRenderState, ordered: boolean, level: number): string =>
  paragraphXml(text, state, 'ListParagraph', `<w:numPr><w:ilvl w:val="${Math.min(level, 2)}"/><w:numId w:val="${ordered ? 2 : 1}"/></w:numPr>`);

export async function renderMarkdownXml(content: string, state: DocxRenderState): Promise<string> {
  const lines = content.split(/\r?\n/);
  const blocks: string[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? '';
    const next = lines[index + 1] ?? '';
    if (/^\s*```/.test(line)) {
      const lang = /^\s*```\s*([\w-]*)/.exec(line)?.[1]?.toLowerCase() ?? '';
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index] ?? '')) { code.push(lines[index] ?? ''); index += 1; }
      if (index < lines.length) index += 1;
      if (lang === 'mermaid') {
        const image = await rasterizeDocumentDiagram(code.join('\n'), state.images.length + 1);
        if (image) { state.images.push(image); blocks.push(drawingXml(image)); }
        else {
          state.warnings.push('Un diagrama Mermaid no pudo rasterizarse; se conservó su código.');
          blocks.push(paragraphXml('Diagrama Mermaid (código)', state, 'Caption'));
          for (const codeLine of code) blocks.push(paragraphXml(codeLine, state));
        }
      } else for (const codeLine of code) blocks.push(paragraphXml(codeLine, state));
      continue;
    }
    if (line.includes('|') && separator(next)) {
      const headers = splitCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? '').includes('|')) { rows.push(splitCells(lines[index] ?? '')); index += 1; }
      blocks.push(tableXml(headers, rows, state));
      state.tables += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(paragraphXml(heading[2] ?? '', state, `Heading${heading[1]?.length ?? 1}`));
      state.headings.push((heading[2] ?? '').replace(/[*_`]/g, '').trim());
    }
    else {
      const list = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/.exec(line);
      if (list) blocks.push(listParagraph(list[3] ?? '', state, /^\d/.test(list[2] ?? ''), Math.floor((list[1]?.length ?? 0) / 2)));
      else if (/^\s*>/.test(line)) blocks.push(paragraphXml(line.replace(/^\s*>\s?/, ''), state, 'Quote'));
      else if (/^\s*---+\s*$/.test(line)) blocks.push(paragraphXml('', state));
      else blocks.push(paragraphXml(line, state));
    }
    index += 1;
  }
  return blocks.join('');
}
