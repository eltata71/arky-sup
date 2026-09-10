/**
 * `AppContext.tsx` is composition, and stays composition.
 *
 * It was 917 lines: a dictionary, a settings literal, an 80-line interface and
 * twenty-six callbacks in one file that forty modules import. Nothing broke
 * because of that — it got there the way these files always do, forty lines at
 * a time, each addition obviously reasonable on its own.
 *
 * So the guard is on the shape rather than on the size, which
 * `check:module-size` already covers. What must not come back is *state* in
 * this file: the moment one `useState` lands here, the next one has a
 * precedent, and the hooks under `context/app/` become where some of the
 * context lives rather than where all of it does.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const APP_CONTEXT = readFileSync('context/AppContext.tsx', 'utf8');

const HOOKS = [
  'usePersistenceReporter',
  'useAppBootstrap',
  'useSettingsState',
  'useProjectsState',
  'useArtifactsState',
  'useProjectHistory',
  'useArchitectureGraphSync',
];

describe('the provider composes and does not implement', () => {
  it.each(HOOKS)('delegates to %s', (hook) => {
    expect(APP_CONTEXT).toContain(`from './app/${hook}'`);
  });

  it('holds no state of its own', () => {
    // Calls, not mentions: the memo's own comment explains why every member
    // is already a `useCallback` in the hook that owns it.
    expect(APP_CONTEXT).not.toMatch(/\buseState[(<]/);
    expect(APP_CONTEXT).not.toMatch(/\buseEffect\(/);
    expect(APP_CONTEXT).not.toMatch(/\buseCallback\(/);
  });

  it('reaches no repository and no service directly', () => {
    expect(APP_CONTEXT).not.toMatch(/from '\.\.\/services\//);
  });

  it('carries no translation dictionary', () => {
    // The 18 KB of copy that used to be over half this file.
    expect(APP_CONTEXT).not.toContain('const translations');
    expect(APP_CONTEXT).not.toContain('"projects": "Projects"');
  });
});

describe('one owner for the projects array', () => {
  it('is `useProjectsState`', () => {
    const projects = readFileSync('context/app/useProjectsState.ts', 'utf8');
    expect(projects).toContain('useState<Project[]>([])');
  });

  it('and nothing else declares one', () => {
    // Artifacts and the knowledge graph are fields on a project record. A
    // second array of the same projects is how a canvas and a sidebar start
    // disagreeing about what the user just edited.
    for (const file of ['useArtifactsState.ts', 'useArchitectureGraphSync.ts', 'useAppBootstrap.ts']) {
      const source = readFileSync(`context/app/${file}`, 'utf8');
      expect(source, `${file} declares its own projects state`).not.toContain('useState<Project[]>');
    }
  });
});
