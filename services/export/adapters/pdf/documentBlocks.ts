/**
 * El Markdown de un artefacto, leído en los bloques que dibuja el PDF.
 *
 * Dos diferencias con la lectura que había dentro del exportador, y las dos
 * son de 9.3: el texto ya no se pasa por `sanitizeForPdf` —la fuente incrustada
 * dibuja lo que el documento dice—, y un bloque ```mermaid es un diagrama, no
 * un bloque de código. Las filas de tabla se conservan con todas sus celdas
 * aunque tengan más que la cabecera: la tabla crece hasta la fila más ancha.
 */
import { parseChartSpec, type ChartSpec } from '../../../../lib/chartSvg';
import type { FontStyle } from './pdfFonts';

export interface Run { text: string; font: FontStyle }

export type CalloutTone = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION';

export type Block =
  | { kind: 'h1' | 'h2' | 'h3'; text: string }
  | { kind: 'paragraph'; runs: Run[] }
  | { kind: 'bullet' | 'numbered'; marker: string; runs: Run[] }
  | { kind: 'quote'; runs: Run[] }
  | { kind: 'callout'; tone: CalloutTone; runs: Run[] }
  | { kind: 'code'; lines: string[] }
  | { kind: 'diagram'; code: string }
  | { kind: 'chart'; spec: ChartSpec }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'rule' }
  | { kind: 'spacer'; height: number };

/** Normaliza saltos de línea y espacios duros; nada más. */
export const normalizeSource = (value: string): string => value.replace(/\r\n?/g, '\n').replace(/\u00A0/g, ' ');

/** `**negrita**`, `*cursiva*`, `_cursiva_` y `` `código` ``; los enlaces conservan su texto. */
export const parseInline = (rawLine: string): Run[] => {
  const line = rawLine.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  const runs: Run[] = [];
  let i = 0;
  let buffer = '';
  const flush = () => {
    if (buffer) {
      runs.push({ text: buffer, font: 'reg' });
      buffer = '';
    }
  };
  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '*' && next === '*') {
      flush();
      const end = line.indexOf('**', i + 2);
      if (end === -1) { buffer += '**'; i += 2; continue; }
      runs.push({ text: line.slice(i + 2, end), font: 'bold' });
      i = end + 2;
      continue;
    }
    if (ch === '`') {
      flush();
      const end = line.indexOf('`', i + 1);
      if (end === -1) { buffer += '`'; i += 1; continue; }
      runs.push({ text: line.slice(i + 1, end), font: 'mono' });
      i = end + 1;
      continue;
    }
    if ((ch === '*' || ch === '_') && next && next !== ch && next !== ' ') {
      const end = line.indexOf(ch, i + 1);
      if (end !== -1) {
        flush();
        runs.push({ text: line.slice(i + 1, end), font: 'ital' });
        i = end + 1;
        continue;
      }
    }
    buffer += ch;
    i += 1;
  }
  flush();
  return runs.length ? runs : [{ text: '', font: 'reg' }];
};

const splitRow = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

const isBlockStart = (line: string): boolean =>
  /^#{1,6}\s+/.test(line) || /^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)
  || /^```/.test(line) || /^\s*>\s?/.test(line) || /^\s*\|/.test(line);

export const parseMarkdownBlocks = (raw: string): Block[] => {
  const lines = normalizeSource(raw).split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const fence = /^```\s*([\w-]+)?/.exec(line);
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
        if (spec) { blocks.push({ kind: 'chart', spec }); continue; }
      }
      if (lang === 'mermaid' && codeLines.some((l) => l.trim())) {
        blocks.push({ kind: 'diagram', code: codeLines.join('\n') });
        continue;
      }
      blocks.push({ kind: 'code', lines: codeLines });
      continue;
    }

    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) {
      const headers = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ kind: 'table', headers, rows });
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 3);
      blocks.push({ kind: `h${level}` as 'h1' | 'h2' | 'h3', text: heading[2].trim() });
      i += 1;
      continue;
    }

    if (/^\s*(\*\s*){3,}\s*$/.test(line) || /^\s*(-\s*){3,}\s*$/.test(line) || /^\s*(_\s*){3,}\s*$/.test(line)) {
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      blocks.push({ kind: 'bullet', marker: '•', runs: parseInline(line.replace(/^\s*[-*+]\s+/, '')) });
      i += 1;
      continue;
    }

    const numbered = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (numbered) {
      blocks.push({ kind: 'numbered', marker: `${numbered[1]}.`, runs: parseInline(numbered[2]) });
      i += 1;
      continue;
    }

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
        blocks.push({ kind: 'callout', tone: callout[1].toUpperCase() as CalloutTone, runs: parseInline(parts.join(' ')) });
        i = j;
        continue;
      }
      blocks.push({ kind: 'quote', runs: parseInline(text) });
      i += 1;
      continue;
    }

    if (!line.trim()) {
      blocks.push({ kind: 'spacer', height: 6 });
      i += 1;
      continue;
    }

    const paragraph: string[] = [line];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() && !isBlockStart(lines[j])) {
      paragraph.push(lines[j]);
      j += 1;
    }
    blocks.push({ kind: 'paragraph', runs: parseInline(paragraph.join(' ')) });
    i = j;
  }
  return blocks;
};

/** Los estilos que usan los bloques: decide qué fuentes se descargan. */
export const stylesOf = (blocks: readonly Block[]): Set<FontStyle> => {
  const styles = new Set<FontStyle>(['reg', 'bold']);
  for (const block of blocks) {
    if (block.kind === 'code') styles.add('mono');
    if ('runs' in block) for (const run of block.runs) styles.add(run.font);
  }
  return styles;
};

/** Todo el texto de los bloques, para saber si hace falta la fuente de símbolos. */
export const textOf = (blocks: readonly Block[]): string => blocks.map((block) => {
  switch (block.kind) {
    case 'h1': case 'h2': case 'h3': return block.text;
    case 'code': return block.lines.join('\n');
    case 'diagram': return block.code;
    case 'chart': return [block.spec.title ?? '', ...block.spec.labels, ...block.spec.series.map((s) => s.name ?? '')].join(' ');
    case 'table': return [...block.headers, ...block.rows.flat()].join(' ');
    case 'rule': case 'spacer': return '';
    default: return block.runs.map((run) => run.text).join('');
  }
}).join('\n');
