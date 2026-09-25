/**
 * A module file does not import its own barrel when the barrel re-exports it.
 *
 * F6-04. `services/review/artifactReviewService.ts` imported
 * `createDefaultReviewRepository` from `./index`, while `./index` re-exported
 * the service. Tests never noticed: Vitest evaluates each file on its own. In
 * the production bundle Vite hoists `import.meta.env` to a module-level
 * constant, so the service's singleton — built while the barrel was still
 * evaluating — read that constant before it existed, and the whole Workspace
 * chunk failed with «Cannot access … before initialization». Nobody could open
 * a project.
 *
 * Whether such a cycle breaks depends on what runs at module load, which is
 * exactly the part a reviewer cannot see from the import line. So the rule is
 * on the shape: import the file that defines what you need, never the barrel
 * that republishes you.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const SCANNED = ['services', 'lib', 'hooks', 'context', 'components', 'utils'];

/**
 * Named, with the reason. `resolveRenderableDiagram` imports three functions
 * that `services/diagram/index.ts` *declares itself*; function declarations are
 * hoisted and it only calls them inside functions, so nothing reads them at
 * load. It may leave this list, never gain a neighbour.
 */
const ALLOWED = new Set(['services/diagram/resolveRenderableDiagram.ts']);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === '__tests__') return [];
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });

const SELF_BARREL = /from\s+['"]\.(?:\/index)?['"]/;

describe('no module imports the barrel that re-exports it', () => {
  it('finds none outside the named exceptions', () => {
    const offenders: string[] = [];
    for (const area of SCANNED) {
      for (const file of walk(join(ROOT, area))) {
        const name = basename(file);
        if (name === 'index.ts' || name === 'index.tsx') continue;
        const source = readFileSync(file, 'utf8');
        if (!SELF_BARREL.test(source)) continue;
        const barrelPath = join(dirname(file), 'index.ts');
        let barrel: string;
        try {
          barrel = readFileSync(barrelPath, 'utf8');
        } catch {
          continue;
        }
        const stem = name.replace(/\.(ts|tsx)$/, '');
        if (!new RegExp(`from\\s+['"]\\./${stem}['"]`).test(barrel)) continue;
        const rel = relative(ROOT, file).split('\\').join('/');
        if (!ALLOWED.has(rel)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the review service off its barrel', () => {
    const source = readFileSync(join(ROOT, 'services/review/artifactReviewService.ts'), 'utf8');
    expect(source).not.toMatch(SELF_BARREL);
  });
});
