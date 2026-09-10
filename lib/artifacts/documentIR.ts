import type { DocumentBlock, DocumentIR } from './contracts';

/**
 * Builds a minimal Document IR from a Markdown string. Phase 1 needs the
 * shape stabilised; Phase 2 will reuse this builder to power the document
 * quality scoring (heading hierarchy, tables, callouts...).
 *
 * The implementation deliberately avoids pulling in `marked` so it can run
 * on the server (tests) and on hot paths without paying the marked startup
 * cost.
 */
export const buildDocumentIR = (markdown: string): DocumentIR => {
  const source = (markdown ?? '').replace(/\r\n/g, '\n');
  const blocks: DocumentBlock[] = [];
  const warnings: string[] = [];
  if (!source.trim()) {
    return { blocks, hasFrontMatter: false, tableCount: 0, mermaidBlockCount: 0, warnings };
  }

  let cursor = 0;
  let hasFrontMatter = false;
  let title: string | undefined;
  let tableCount = 0;
  let mermaidBlockCount = 0;

  // Detect YAML/TOML front-matter so the document view can hide it.
  if (source.startsWith('---\n')) {
    const end = source.indexOf('\n---', 4);
    if (end > 0) {
      hasFrontMatter = true;
      cursor = end + 4;
      while (source[cursor] === '\n') cursor += 1;
    }
  }

  const rest = source.slice(cursor);
  const lines = rest.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const offset = cursor + lines.slice(0, i).reduce((acc, l) => acc + l.length + 1, 0);

    // Fenced code blocks (including ```mermaid```).
    const fenceMatch = line.match(/^```(\w+)?\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] ?? '';
      const start = i + 1;
      let end = lines.findIndex((l, idx) => idx >= start && /^```\s*$/.test(l));
      if (end === -1) {
        warnings.push('unterminated-code-fence');
        end = lines.length;
      }
      const body = lines.slice(start, end).join('\n');
      const isMermaid = lang.toLowerCase() === 'mermaid';
      if (isMermaid) mermaidBlockCount += 1;
      blocks.push({
        kind: isMermaid ? 'mermaid' : 'code',
        text: body,
        sourceOffset: offset,
      });
      i = end + 1;
      continue;
    }

    // Headings.
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      if (!title && level === 1) title = text;
      blocks.push({ kind: 'heading', level, text, sourceOffset: offset });
      i += 1;
      continue;
    }

    // Tables — detect header + separator on the next line.
    if (line.includes('|') && lines[i + 1] && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const rows: string[] = [line];
      let j = i + 1;
      while (j < lines.length && lines[j].includes('|') && lines[j].trim().length > 0) {
        rows.push(lines[j]);
        j += 1;
      }
      tableCount += 1;
      blocks.push({ kind: 'table', text: rows.join('\n'), sourceOffset: offset });
      i = j;
      continue;
    }

    // Block-quote callouts.
    if (/^\s*>/.test(line) && line.trim().length > 1) {
      const rows: string[] = [line];
      let j = i + 1;
      while (j < lines.length && /^\s*>/.test(lines[j])) {
        rows.push(lines[j]);
        j += 1;
      }
      blocks.push({ kind: 'callout', text: rows.join('\n'), sourceOffset: offset });
      i = j;
      continue;
    }

    // Lists.
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const rows: string[] = [line];
      let j = i + 1;
      while (j < lines.length && (/^\s*([-*+]|\d+\.)\s+/.test(lines[j]) || lines[j].startsWith('  '))) {
        rows.push(lines[j]);
        j += 1;
      }
      blocks.push({ kind: 'list', text: rows.join('\n'), sourceOffset: offset });
      i = j;
      continue;
    }

    // Paragraph (default).
    if (line.trim().length === 0) {
      i += 1;
      continue;
    }
    const rows: string[] = [line];
    let j = i + 1;
    while (j < lines.length && lines[j].trim().length > 0 && !/^(#{1,6})\s+/.test(lines[j]) && !/^```/.test(lines[j])) {
      rows.push(lines[j]);
      j += 1;
    }
    blocks.push({ kind: 'paragraph', text: rows.join('\n'), sourceOffset: offset });
    i = j;
  }

  return {
    title,
    blocks,
    hasFrontMatter,
    tableCount,
    mermaidBlockCount,
    warnings,
  };
};
