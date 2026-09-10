#!/usr/bin/env node
/**
 * checkOrphanScripts — the repository root does not collect scaffolding.
 *
 * Eleven `.cjs` codegen and codemod scripts had accumulated in the root,
 * roughly 127 KB, alongside an `app/` tree of three more. None was referenced
 * by any code or config. They were ESLint-ignored and never typechecked, so
 * nothing told anyone they had gone stale — and a stale script that still
 * *looks* runnable is worse than a missing one: it describes an architecture
 * the app no longer has, to whoever reads it first.
 *
 * They arrived one at a time, each obviously fine on its own. So the rule is
 * mechanical rather than a convention: a script in the root is either build
 * configuration this file knows about, or it does not belong there.
 *
 * Legitimate tooling lives in `scripts/`, is linted, and is covered by tests.
 */

import { readdirSync, existsSync } from 'node:fs';

/**
 * Build configuration that genuinely belongs in the root, because the tools
 * that read it look there and nowhere else.
 */
const ALLOWED_ROOT_SCRIPTS = new Set([
  // ESLint 9 flat config: discovered by name, in the root, by the CLI.
  'eslint.config.js',
  // PostCSS reads these two from the root during the Vite build.
  'tailwind.config.cjs',
  'postcss.config.cjs',
]);

/** Trees that were deleted and should not come back. */
const FORBIDDEN_DIRECTORIES = ['app'];

const SCRIPT_EXTENSIONS = /\.(cjs|mjs|js)$/;

export function findOrphanScripts(root = '.') {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => SCRIPT_EXTENSIONS.test(name))
    .filter((name) => !ALLOWED_ROOT_SCRIPTS.has(name))
    .sort();
}

export function findForbiddenDirectories(root = '.') {
  return FORBIDDEN_DIRECTORIES.filter((dir) => existsSync(`${root}/${dir}`));
}

function main() {
  const orphans = findOrphanScripts();
  const directories = findForbiddenDirectories();

  if (orphans.length === 0 && directories.length === 0) {
    console.log('[check:no-orphan-scripts] OK — the root holds only build configuration.');
    return;
  }

  console.error('[check:no-orphan-scripts] FAILED\n');
  for (const name of orphans) console.error(`  unexpected root script: ${name}`);
  for (const dir of directories) console.error(`  resurrected directory: ${dir}/`);
  console.error(
    '\nPut runnable tooling in `scripts/` where it is linted and tested. If this is\n'
    + 'genuinely build configuration a tool must find in the root, add it to\n'
    + 'ALLOWED_ROOT_SCRIPTS in scripts/checkOrphanScripts.mjs with a reason.',
  );
  process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('checkOrphanScripts.mjs')) main();
