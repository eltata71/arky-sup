/**
 * A `<div onClick>` is a control only a mouse can operate. Cards that must stay
 * containers use `activatable()` (role, tab stop, Enter/Space); pointer-only
 * backdrops are `aria-hidden`; overlays are `components/ui/Modal`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : files(path);
    return path.endsWith('.tsx') ? [path] : [];
  });

describe('clickable divs', () => {
  it('every actionable <div onClick> has a keyboard path', () => {
    const offenders: string[] = [];
    for (const file of ['components', 'pages'].flatMap(files)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/<div\b(?:=>|[^>])*?>/gs)) {
        const tag = m[0];
        if (!/\bonClick\s*=/.test(tag)) continue;
        if (/aria-hidden|stopPropagation\(\)/.test(tag)) continue;
        // Pointer dismissal on a dialog backdrop is supplementary to its
        // keyboard-accessible close control, not the dialog's only action.
        if (/\brole="dialog"/.test(tag) && /\baria-modal="true"/.test(tag)) continue;
        if (/\.\.\.activatable\(/.test(tag)) continue;
        if (/\brole\s*=/.test(tag) && /\btabIndex\s*=/.test(tag) && /\bonKeyDown\s*=/.test(tag)) continue;
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${file}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
