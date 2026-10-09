/**
 * R-16: the interface is bilingual, so a literal in JSX is a string that one
 * language cannot translate. This counts them — JSX text nodes and the
 * accessible/visible string attributes — under `components/` and `pages/`.
 *
 * The budget is monotonic: it records today's count and may only fall. New
 * copy goes through `t()`; extracting a screen lowers the number in the same
 * change. `LITERAL_BUDGET` reaches 0 when no language option is left partially
 * translated.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LITERAL_BUDGET = 1184;

const ROOTS = ['components', 'pages'];
const TEXT_NODE = />\s*([^<>{}\n=]*[A-Za-zÁ-ÿ]{3,}[^<>{}\n=]*)</g;
const STRING_ATTR = /\b(?:aria-label|placeholder|title|alt|label)="([^"{}]*[A-Za-zÁ-ÿ]{3,}[^"{}]*)"/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

function countLiterals(): number {
  let total = 0;
  for (const root of ROOTS) {
    for (const file of sources(root)) {
      const text = readFileSync(file, 'utf8');
      total += (text.match(TEXT_NODE)?.length ?? 0) + (text.match(STRING_ATTR)?.length ?? 0);
    }
  }
  return total;
}

describe('literal copy in JSX', () => {
  it('never rises above its recorded budget', () => {
    expect(countLiterals()).toBeLessThanOrEqual(LITERAL_BUDGET);
  });
});
