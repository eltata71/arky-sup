/**
 * Applies a document patch — checked before applied, never a partial
 * rewrite, and honest when nothing changed (plan de calidad de artefactos,
 * 7.4b). The three guarantees of the diagram patch engine, over Markdown:
 *
 * - **Checked before applied.** An operation that names a section that does
 *   not exist, or two that match, or a table row with the wrong number of
 *   cells, is rejected with a typed reason; the valid operations beside it
 *   still apply.
 * - **Only what was named changes.** A section is the lines from its heading
 *   to the next heading of the same or a higher level; nothing outside the
 *   touched sections is rewritten, so a paragraph the model never saw is a
 *   paragraph the model cannot damage.
 * - **A patch that changes nothing says so** — `changed: false` and the
 *   original text.
 *
 * Headings inside code fences are not sections. Pure: no I/O, no model.
 */
import type {
  DocumentPatch,
  DocumentPatchOperation,
  DocumentPatchRejection,
  DocumentPatchRejectionCode,
  DocumentPatchResult,
} from '../../../lib/artifacts';
import { DOCUMENT_PATCH_OPERATIONS } from '../../../lib/artifacts';

interface Section {
  heading: string;
  level: number;
  /** Line index of the heading. */
  start: number;
  /** Line index after the last line of the section (subsections included). */
  end: number;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const normalize = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();

function sectionsOf(lines: readonly string[]): Section[] {
  const found: Omit<Section, 'end'>[] = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) return;
    const match = HEADING.exec(line);
    if (match) found.push({ heading: match[2].trim(), level: match[1].length, start: index });
  });
  return found.map((section, index) => {
    const next = found.slice(index + 1).find((candidate) => candidate.level <= section.level);
    return { ...section, end: next ? next.start : lines.length };
  });
}

type Lookup = { section: Section } | { code: DocumentPatchRejectionCode; message: string };

/** Exact heading first; then a unique heading that contains the name. */
function findSection(sections: readonly Section[], name: string): Lookup {
  const wanted = normalize(name);
  if (!wanted) return { code: 'unknown-section', message: 'La operación no nombra ninguna sección.' };
  const exact = sections.filter((section) => normalize(section.heading) === wanted);
  if (exact.length === 1) return { section: exact[0] };
  const partial = exact.length > 1 ? exact : sections.filter((section) => normalize(section.heading).includes(wanted));
  if (partial.length === 1) return { section: partial[0] };
  if (partial.length > 1) return { code: 'ambiguous-section', message: `«${name}» coincide con ${partial.length} secciones; nómbrala con su título exacto.` };
  return { code: 'unknown-section', message: `No existe una sección «${name}» en el documento.` };
}

const bodyLines = (body: string): string[] => body.replace(/\r\n/g, '\n').trim().split('\n');

/**
 * Put a block between two runs of lines with exactly one blank line on each
 * side, touching only the blank lines at the seams — never anything further in.
 */
function splice(before: readonly string[], block: readonly string[], after: readonly string[]): string[] {
  const head = [...before];
  while (head.length > 0 && head[head.length - 1].trim() === '') head.pop();
  const tail = [...after];
  while (tail.length > 0 && tail[0].trim() === '') tail.shift();
  if (block.length === 0) return [...head, ...(head.length && tail.length ? [''] : []), ...tail];
  return [...head, ...(head.length ? [''] : []), ...block, ...(tail.length ? [''] : []), ...tail];
}

const rowOf = (cells: readonly string[]): string => `| ${cells.map((cell) => cell.replace(/\|/g, '\\|').trim()).join(' | ')} |`;

const cellsOf = (row: string): string[] =>
  row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim());

/** The first table of a section: header line, delimiter, and the data rows after it. */
function firstTable(lines: readonly string[], section: Section): { header: number; lastRow: number; columns: number } | null {
  for (let index = section.start + 1; index < section.end - 1; index += 1) {
    if (TABLE_ROW.test(lines[index]) && TABLE_DELIMITER.test(lines[index + 1])) {
      let lastRow = index + 1;
      while (lastRow + 1 < section.end && TABLE_ROW.test(lines[lastRow + 1])) lastRow += 1;
      return { header: index, lastRow, columns: cellsOf(lines[index]).length };
    }
  }
  return null;
}

const isOperation = (value: unknown): value is DocumentPatchOperation =>
  Boolean(value) && typeof value === 'object'
  && DOCUMENT_PATCH_OPERATIONS.includes((value as { op?: unknown }).op as DocumentPatchOperation['op']);

type Outcome = { lines: string[]; applied: string } | { code: DocumentPatchRejectionCode; message: string };

function applyOne(lines: string[], operation: DocumentPatchOperation): Outcome {
  const sections = sectionsOf(lines);
  switch (operation.op) {
    case 'replace-section': {
      if (!operation.body?.trim()) return { code: 'empty-body', message: 'Reemplazar una sección por nada es quitarla: usa remove-section.' };
      const found = findSection(sections, operation.heading);
      if (!('section' in found)) return found;
      const { section } = found;
      const next = splice([...lines.slice(0, section.start + 1), ''], bodyLines(operation.body), lines.slice(section.end));
      return { lines: next, applied: `Sección «${section.heading}»: contenido reemplazado.` };
    }
    case 'insert-section': {
      if (!operation.body?.trim() || !operation.heading?.trim()) return { code: 'empty-body', message: 'Una sección nueva necesita título y contenido.' };
      if (sections.some((section) => normalize(section.heading) === normalize(operation.heading))) {
        return { code: 'duplicate-section', message: `Ya existe una sección «${operation.heading}».` };
      }
      let at = lines.length;
      let level = 2;
      if (operation.after) {
        const found = findSection(sections, operation.after);
        if (!('section' in found)) return found;
        at = found.section.end;
        level = Math.max(2, found.section.level);
      }
      const block = [`${'#'.repeat(level)} ${operation.heading.trim()}`, '', ...bodyLines(operation.body)];
      return { lines: splice(lines.slice(0, at), block, lines.slice(at)), applied: `Sección «${operation.heading.trim()}» añadida.` };
    }
    case 'remove-section': {
      const found = findSection(sections, operation.heading);
      if (!('section' in found)) return found;
      return { lines: splice(lines.slice(0, found.section.start), [], lines.slice(found.section.end)), applied: `Sección «${found.section.heading}» eliminada.` };
    }
    case 'append-table-row':
    case 'update-table-row': {
      const found = findSection(sections, operation.heading);
      if (!('section' in found)) return found;
      const table = firstTable(lines, found.section);
      if (!table) return { code: 'no-table', message: `La sección «${found.section.heading}» no tiene una tabla.` };
      const cells = [...(operation.cells ?? [])];
      if (cells.length !== table.columns) {
        return { code: 'cell-count', message: `La tabla de «${found.section.heading}» tiene ${table.columns} columnas y la fila trae ${cells.length}.` };
      }
      if (operation.op === 'append-table-row') {
        const next = [...lines.slice(0, table.lastRow + 1), rowOf(cells), ...lines.slice(table.lastRow + 1)];
        return { lines: next, applied: `Tabla de «${found.section.heading}»: fila añadida.` };
      }
      const wanted = normalize(operation.match);
      for (let index = table.header + 2; index <= table.lastRow; index += 1) {
        if (normalize(cellsOf(lines[index])[0] ?? '') === wanted) {
          const next = [...lines];
          next[index] = rowOf(cells);
          return { lines: next, applied: `Tabla de «${found.section.heading}»: fila «${operation.match}» actualizada.` };
        }
      }
      return { code: 'row-not-found', message: `La tabla de «${found.section.heading}» no tiene una fila «${operation.match}».` };
    }
  }
}

/** Apply a patch to a document. Never throws; the preview is this same call. */
export function applyDocumentPatch(content: string, patch: DocumentPatch): DocumentPatchResult {
  let lines = (content ?? '').replace(/\r\n/g, '\n').split('\n');
  const applied: string[] = [];
  const rejected: DocumentPatchRejection[] = [];
  (patch.operations ?? []).forEach((operation, index) => {
    if (!isOperation(operation)) {
      rejected.push({ index, op: String((operation as { op?: unknown })?.op ?? '?'), code: 'invalid-operation', message: 'Operación desconocida.' });
      return;
    }
    const outcome = applyOne(lines, operation);
    if ('code' in outcome) rejected.push({ index, op: operation.op, code: outcome.code, message: outcome.message });
    else {
      lines = outcome.lines;
      applied.push(outcome.applied);
    }
  });
  const next = lines.join('\n');
  // Blank lines at a seam are layout, not content: a patch that only moved
  // them changed nothing anyone would read.
  const meaning = (text: string): string => text.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim()).join('\n');
  const changed = applied.length > 0 && meaning(next) !== meaning(content ?? '');
  return { content: changed ? next : content, changed, applied: changed ? applied : [], rejected };
}

/** The document's headings, in order — what a model is shown to name a section. */
export const outlineOfDocument = (content: string): string[] =>
  sectionsOf((content ?? '').split('\n')).map((section) => `${'#'.repeat(section.level)} ${section.heading}`);
