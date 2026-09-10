/**
 * Guards the whole app against the defect class that made VoiceOver read the
 * same thing twice.
 *
 * This is a *source* scan rather than a rendered-DOM check on purpose. The
 * defect was spread across 28 elements in 20 files — screens a rendering test
 * would have to mount one by one, and would silently stop covering the moment
 * someone adds the 21st. Reading the source catches it everywhere, including in
 * components no test renders yet, and it fails at the moment the attribute is
 * typed rather than the moment someone happens to test that screen.
 *
 * The rules being enforced are documented in `lib/a11y.ts`.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['components', 'pages'];

const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      out.push(...sourceFiles(path));
    } else if (entry.endsWith('.tsx')) {
      out.push(path);
    }
  }
  return out;
};

const ALL_FILES = ROOTS.flatMap(sourceFiles);

/** Opening JSX tags with their attribute text and 1-based line number. */
interface Tag {
  file: string;
  line: number;
  name: string;
  attrs: string;
  /** The ~160 characters that follow the tag — enough to see its own text. */
  following: string;
}

const tags = (): Tag[] => {
  const found: Tag[] = [];
  for (const file of ALL_FILES) {
    const source = readFileSync(file, 'utf8');
    const pattern = /<([A-Za-z][\w.]*)\s([^>]*?)>/gs;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      found.push({
        file,
        line: source.slice(0, match.index).split('\n').length,
        name: match[1],
        attrs: match[2],
        following: source.slice(match.index + match[0].length, match.index + match[0].length + 160),
      });
    }
  }
  return found;
};

const ALL_TAGS = tags();

const attr = (attrs: string, name: string): string | null => {
  const match = new RegExp(`${name}=(\\{[^{}]*\\}|"[^"]*")`).exec(attrs);
  return match ? match[1].trim() : null;
};

describe('no element is announced twice', () => {
  it('has JSX to scan at all, so a broken scanner cannot pass silently', () => {
    expect(ALL_FILES.length).toBeGreaterThan(50);
    expect(ALL_TAGS.length).toBeGreaterThan(500);
  });

  it('never carries a title that repeats its own aria-label', () => {
    // `aria-label` is the accessible name and `title` becomes the accessible
    // description, so identical values are spoken one after the other.
    const offenders = ALL_TAGS
      .filter((tag) => {
        const label = attr(tag.attrs, 'aria-label');
        const title = attr(tag.attrs, 'title');
        return label !== null && title !== null && label === title;
      })
      .map((tag) => `${tag.file}:${tag.line} <${tag.name}>`);

    expect(offenders).toEqual([]);
  });

  it('never carries a title that repeats its own visible text', () => {
    // CSS truncation does not remove text from the DOM: a screen reader reads
    // the full string already, so the title only adds a second announcement.
    const offenders = ALL_TAGS
      .filter((tag) => {
        if (attr(tag.attrs, 'aria-label') !== null) return false;
        const title = attr(tag.attrs, 'title');
        if (title === null || !title.startsWith('{')) return false;
        return tag.following.includes(title);
      })
      .map((tag) => `${tag.file}:${tag.line} <${tag.name}> title=${attr(tag.attrs, 'title')}`);

    expect(offenders).toEqual([]);
  });

  it('never gives a field a name and a different placeholder', () => {
    // VoiceOver announces the accessible name and then the placeholder, so
    // "Buscar proyectos…, Buscar por nombre o descripción, campo de texto" is
    // one field read twice. Identical strings collapse to a single
    // announcement, which is why the placeholder *is* the name here.
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (!/<(Input|input|textarea)\b/.test(line)) return;
        const window = lines.slice(index, index + 14).join('\n');
        // Cut at the end of the opening tag, ignoring `>` inside braces.
        let depth = 0;
        let cut = window.length;
        for (let position = 1; position < window.length; position += 1) {
          const character = window[position];
          if (character === '{') depth += 1;
          else if (character === '}') depth -= 1;
          else if (character === '>' && depth === 0) { cut = position; break; }
        }
        const tag = window.slice(0, cut);
        const label = attr(tag, 'aria-label');
        const placeholder = attr(tag, 'placeholder');
        if (label !== null && placeholder !== null && label !== placeholder) {
          offenders.push(`${file}:${index + 1} label=${label} placeholder=${placeholder}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('does not reference visible dialog text as a description', () => {
    // `aria-describedby` pointing at content that is also rendered makes
    // VoiceOver read it on entry and again on reaching it.
    const modal = readFileSync('components/Modal.tsx', 'utf8');
    expect(modal).not.toMatch(/aria-describedby=/);
  });

  it('keeps the visual tooltip out of the accessibility tree', () => {
    // The trigger already carries the same text as its accessible name.
    const tooltip = readFileSync('components/ui/Tooltip.tsx', 'utf8');
    expect(tooltip).toContain('aria-hidden');
    expect(tooltip).not.toContain('role="tooltip"');
  });

  it('keeps a labelled graphic from also announcing its internals', () => {
    // An <svg role="img" aria-label> promises the label covers the graphic;
    // foreignObject text inside would be announced after it.
    const panel = readFileSync('components/architectureOffice/TeamCoordinationPanel.tsx', 'utf8');
    const foreignObjects = panel.split('<foreignObject').slice(1);
    expect(foreignObjects.length).toBeGreaterThan(0);
    for (const block of foreignObjects) {
      expect(block.slice(0, 600)).toContain('aria-hidden');
    }
  });
});
