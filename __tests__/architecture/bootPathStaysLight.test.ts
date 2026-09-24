/**
 * The application boots without the AI layer.
 *
 * This is a bundle rule with a test because the bundle gate can only say *that*
 * the eager payload grew, never *why*, and the why is always the same shape: a
 * barrel entered from boot code. It cost 156 KB gz here. `AppContext` reached
 * `ArchitectureProjectRepository` → `projectWrites`, which imported
 * `chatHistoryRepository` through the **`services/chat` barrel**; that barrel
 * exports `chatCompactor`, which value-imports `aiGateway` from the
 * **`services/ai` barrel**, which re-exports `generation`, which reaches
 * `services/geminiService`. The entire AI layer and the 5 400-line engine were
 * downloaded before the login screen rendered, to obtain one Firestore
 * repository object.
 *
 * So the walker below follows only what a bundler follows: **value** imports.
 * `import type` and an import whose every binding is inline-`type` are erased
 * by esbuild and cannot put anything in a chunk. Dynamic `import()` is not
 * followed either — that is the mechanism that is *supposed* to keep these
 * modules out, and following it would make the test assert the opposite of
 * what it is for.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = process.cwd();
const ENTRY = join(ROOT, 'index.tsx');

/** Resolve an import specifier the way the bundler's alias config does. */
function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null; // a package — never one of ours
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    base,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** True when this import/export clause survives type erasure. */
function isValueClause(clause: string): boolean {
  const trimmed = clause.trim();
  if (trimmed.startsWith('type ') || trimmed === 'type') return false;
  const braced = trimmed.match(/^\{([\s\S]*)\}$/);
  if (!braced) return true; // default, namespace or `export *`
  const bindings = braced[1]
    .split(',')
    .map((binding) => binding.trim())
    .filter(Boolean);
  return bindings.length === 0 || !bindings.every((b) => b.startsWith('type '));
}

/** Every module statically reachable from `entry` through value imports. */
function staticGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);

    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    const specifiers: string[] = [];
    for (const match of source.matchAll(
      /^[ \t]*(?:import|export)\b([\s\S]*?)\bfrom\s*'([^']+)'/gm,
    )) {
      if (isValueClause(match[1])) specifiers.push(match[2]);
    }
    // Side-effect imports: `import './x';`
    for (const match of source.matchAll(/^[ \t]*import\s+'([^']+)'/gm)) {
      specifiers.push(match[1]);
    }

    for (const spec of specifiers) {
      const target = resolveSpecifier(spec, file);
      if (target) stack.push(target);
    }
  }
  return seen;
}

const REACHABLE = staticGraph(ENTRY);
const relative = (file: string): string => file.replace(`${ROOT}/`, '');
const reachableUnder = (prefix: string): string[] =>
  [...REACHABLE].map(relative).filter((f) => f.startsWith(prefix)).sort();

describe('the boot path', () => {
  it('walks a real graph — the guard would be worthless if it resolved nothing', () => {
    // A regex walker that silently resolves nothing passes every assertion
    // below. This is the canary for that.
    expect(REACHABLE.size).toBeGreaterThan(100);
    expect(reachableUnder('context/')).toContain('context/AppContext.tsx');
  });

  it('does not reach the legacy engine', () => {
    expect(reachableUnder('services/ai/generation/artifacts/artifactGenerationEngine.ts')).toEqual([]);
  });

  it('does not reach the AI generation façades or the provider adapters', () => {
    expect(reachableUnder('services/ai/generation/')).toEqual([]);
    expect(reachableUnder('services/ai/providers/')).toEqual([]);
    expect(reachableUnder('services/ai/core/')).toEqual([]);
    expect(reachableUnder('services/ai/routing/')).toEqual([]);
  });

  /**
   * Dos módulos de IA *son* eager, y legítimamente: son puros, no llaman a
   * ningún modelo, y el arranque los necesita de verdad —
   * `OfficeEngagementPlanner` valida un refinamiento de charter con
   * `parseStructured`. Nombrarlos es el punto: la siguiente incorporación a
   * este conjunto es una decisión que alguien toma a propósito, no un barril
   * que nadie miró.
   *
   * **Eran cuatro hasta F3-08, y bajar a dos no fue trabajo de arranque.**
   * `utils.ts` componía los prompts del proyecto, así que importaba
   * `services/ai/prompts/diagramPrompts` —y con él `diagramStorySchema`—, y
   * `utils.ts` sí está en el camino de arranque: diez módulos lo importan. Al
   * mudarse esa composición a `services/ai/prompts/projectPrompts.ts`, los dos
   * ficheros de diagrama salieron del arranque con ella. La razón por la que
   * aquel import ascendente de fundación a dominio era un problema y este test
   * la nombra sin proponérselo: lo que la capa de fundación importa, el
   * arranque lo descarga.
   */
  it('reaches only the pure, model-free AI leaves', () => {
    expect(reachableUnder('services/ai/')).toEqual([
      'services/ai/parseAiJson.ts',
      'services/ai/structuredOutput/index.ts',
    ]);
  });

  it('does not reach a provider SDK', () => {
    for (const file of REACHABLE) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${relative(file)} is on the boot path`).not.toMatch(
        /^\s*import\s[\s\S]*?from\s*'@google\/genai'/m,
      );
    }
  });
});
