/**
 * The repository root holds build configuration and nothing else.
 *
 * Eleven `.cjs` scaffolding scripts accumulated there, ~127 KB, none of them
 * referenced by any code or config, none linted or typechecked. They arrived
 * one at a time and each was obviously fine on its own — which is why the rule
 * has to be mechanical rather than a note in CLAUDE.md.
 */

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { findForbiddenDirectories, findOrphanScripts } from '../../scripts/checkOrphanScripts.mjs';

describe('the root is clean', () => {
  it('has no unexpected scripts', () => {
    expect(findOrphanScripts('.')).toEqual([]);
  });

  it('has not resurrected the deleted trees', () => {
    expect(findForbiddenDirectories('.')).toEqual([]);
  });
});

describe('the scaffolding really is gone', () => {
  const deleted = [
    'createCourseViews.cjs', 'createLMSComponents.cjs', 'updateUX.cjs', 'refactor.cjs',
    'updateCourseView.cjs', 'updateCatalog.cjs', 'updateGemini.cjs', 'updateLessonModal.cjs',
    'fixBackticks.cjs', 'updateLessonModalText.cjs', 'updateCourseViewText.cjs',
  ];

  it.each(deleted)('%s no longer exists', (name) => {
    expect(existsSync(name)).toBe(false);
  });
});

describe('build configuration is still where its tools look for it', () => {
  // The guard must not tempt anyone into moving these: PostCSS and the ESLint
  // CLI find them by name in the root and nowhere else.
  it.each(['tailwind.config.cjs', 'postcss.config.cjs', 'eslint.config.js'])('%s is present', (name) => {
    expect(existsSync(name)).toBe(true);
  });
});
