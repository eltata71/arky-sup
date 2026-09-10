/**
 * Parsing GitHub-flavoured Markdown tables.
 *
 * Pure text in, plain objects out — no imports, no I/O. It lived under
 * `services/export/utils/` and was used from four places in three different
 * modules, which meant `services/quality` had to import the export engine to
 * read a table. A parser is not part of anyone's domain; it belongs in the
 * layer with no dependencies.
 */
export interface MarkdownTable {
  title: string;
  headers: string[];
  rows: string[][];
  startLine: number;
  endLine: number;
}

const splitMarkdownRow = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  let escaped = false;
  for (const char of trimmed) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
};

const isSeparator = (line: string): boolean => {
  const cells = splitMarkdownRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
};

const isTableRow = (line: string): boolean => line.includes('|') && splitMarkdownRow(line).length >= 2;

const titleBefore = (lines: string[], index: number): string => {
  for (let cursor = index - 1; cursor >= Math.max(0, index - 4); cursor -= 1) {
    const candidate = lines[cursor]?.trim() ?? '';
    if (!candidate) continue;
    return candidate.replace(/^#{1,6}\s*/, '').replace(/[:：]$/, '').trim() || 'Tabla';
  }
  return 'Tabla';
};

export function parseMarkdownTables(content: string): MarkdownTable[] {
  const lines = content.split(/\r?\n/);
  const tables: MarkdownTable[] = [];
  let index = 0;
  while (index < lines.length - 1) {
    const headerLine = lines[index] ?? '';
    const separatorLine = lines[index + 1] ?? '';
    if (!isTableRow(headerLine) || !isSeparator(separatorLine)) {
      index += 1;
      continue;
    }
    const headers = splitMarkdownRow(headerLine);
    const rows: string[][] = [];
    let cursor = index + 2;
    while (cursor < lines.length && isTableRow(lines[cursor] ?? '')) {
      const row = splitMarkdownRow(lines[cursor] ?? '');
      if (row.length === headers.length) rows.push(row);
      cursor += 1;
    }
    if (headers.length >= 2) {
      tables.push({ title: titleBefore(lines, index), headers, rows, startLine: index + 1, endLine: cursor });
    }
    index = Math.max(cursor, index + 1);
  }
  return tables;
}

export function hasMarkdownTables(content: string): boolean {
  return parseMarkdownTables(content).length > 0;
}
