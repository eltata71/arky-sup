#!/usr/bin/env node
/**
 * countAnyTokens — how many `any` types are left, counted honestly.
 *
 * The audit reported 233. That is the count of the *word*: it includes the
 * word inside comments, inside Spanish prose, inside prompt templates and
 * inside identifiers such as `anyOf` and `Company`. The real figure in type
 * position is a third of that, and the difference matters — a backlog that
 * looks three times its size is one nobody starts.
 *
 * This counts `any` where it is actually a type: annotations, assertions,
 * array and generic positions. It is a lexical scan rather than an AST walk,
 * so it strips comments and string literals first — the AST version is the
 * right end state, and this is the version that can gate CI today without
 * adding a parser dependency to every build.
 *
 * The budget is monotonic: the count may fall and must never rise. Lowering
 * `MAX_ANY_TOKENS` after a reduction is the intended workflow; raising it is
 * how a gate stops meaning anything.
 */

import { evaluateBudgetTargets, todayIso } from './budgetTargets.mjs';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Measured 2026-09-02, after Wave 4 took it from 38 to 23 by typing what the
 * LMS generators return. Lower this as the count falls; never raise it.
 *
 * What is left is concentrated rather than scattered, and each group has a
 * named reason:
 *
 * - 0 in `services/geminiService.ts` — the corte 10 cleanup typed its remaining
 *   transport config and artifact model config after the prompt move exposed
 *   two tokens hidden by this lexical scanner. The LMS vertical took its share
 *   with it, and the transport took five more (F5-01): it left typed, with
 *   `unknown` and the SDK's own parameter types, rather than carrying them;
 *   `evaluateChallenge` left the same way (corte 2), the recommendation
 *   vertical (corte 4) left with `unknown` in place of its `Record<string, any>`
 *   and took the dead `withTimeout` helper's `any` with it, and the assistant
 *   vertical (corte 7) left with a declared course port instead of `any[]`,
 *   and its agent turn (corte 8) with a typed `functionCall`.
 * - 4 in `services/ai/generation/diagram/` — they left the engine with the
 *   diagram vertical (corte 6), unchanged: the diagram config and the
 *   ReactFlow conversion still hand SDK-shaped objects through.
 * - 6 in `components/ExcalidrawViewer.tsx` — the lazily-imported Excalidraw
 *   surface, which is genuinely untyped at the boundary we load it through.
 * - 1 in `components/routing/lazyWithRetry.ts` — `ComponentType<any>`, which
 *   is how React's own `lazy` is declared; narrowing it would reject valid
 *   components.
 */
export const MAX_ANY_TOKENS = 11;

/**
 * Directories, not globs.
 *
 * A recursive-glob pathspec matches only files nested at least one directory
 * deep, so it silently skipped `services/geminiService.ts` — the
 * single largest holder of `any` in the repository. A budget that cannot see
 * the worst file is worse than no budget, so the extension filter lives in JS
 * where its behaviour is obvious.
 */
const SOURCE_ROOTS = [
  'api', 'components', 'context', 'hooks', 'lib', 'pages', 'services', 'utils',
  'types.ts', 'constants.ts', 'utils.ts',
];

const SOURCE_EXTENSIONS = /\.tsx?$/;

/**
 * `any` in type position.
 *
 * Each alternative is a place the compiler reads it as a type:
 * `: any`, `as any`, `<any>`, `any[]`, `, any>` and `(any)`. A bare word
 * elsewhere — prose, an identifier, a prompt — is not matched.
 */
const ANY_IN_TYPE_POSITION = /(:\s*any\b)|(\bas\s+any\b)|(<\s*any\s*[,>])|(\bany\[\])|(,\s*any\s*[,>])|(\|\s*any\b)|(\bany\s*\|)/g;

export function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

export function countAnyIn(source) {
  const matches = stripCommentsAndStrings(source).match(ANY_IN_TYPE_POSITION);
  return matches ? matches.length : 0;
}

export function sourceFiles() {
  // `--others --exclude-standard` includes files that exist but are not
  // committed yet. Without it a brand-new module full of `any` passes the gate
  // locally and only fails once someone commits it — which is the least useful
  // moment to find out.
  const pathspec = SOURCE_ROOTS.map((root) => `"${root}"`).join(' ');
  return execSync(`git ls-files --cached --others --exclude-standard ${pathspec}`)
    .toString()
    .split('\n')
    .filter(Boolean)
    .filter((file) => SOURCE_EXTENSIONS.test(file))
    .filter((file) => !/\.d\.ts$/.test(file))
    .filter((file) => !/\.(test|spec)\.tsx?$/.test(file) && !file.includes('__tests__/'));
}

export function scan() {
  const perFile = sourceFiles()
    .map((file) => ({ file, count: countAnyIn(readFileSync(file, 'utf8')) }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);
  return { perFile, total: perFile.reduce((sum, entry) => sum + entry.count, 0) };
}

function main() {
  const { perFile, total } = scan();

  if (total > MAX_ANY_TOKENS) {
    console.error(`[check:any-budget] FAILED — ${total} \`any\` types, budget is ${MAX_ANY_TOKENS}.\n`);
    for (const { file, count } of perFile.slice(0, 15)) console.error(`  ${String(count).padStart(3)}  ${file}`);
    console.error('\nReplace `any` with `unknown` plus a type guard, a precise type, or a');
    console.error('discriminated union. If a cast is genuinely unavoidable, narrow its scope');
    console.error('so it covers one expression rather than a whole signature.');
    process.exit(1);
  }

  // F3-04: el presupuesto tiene además objetivo y fecha.
  const targets = evaluateBudgetTargets({ 'any-tokens': total }, todayIso());
  for (const note of targets.notes) console.log(`[check:any-budget] ${note}`);
  if (targets.failures.length > 0) {
    for (const failure of targets.failures) console.error(`[check:any-budget] ${failure}`);
    process.exit(1);
  }

  console.log(`[check:any-budget] OK — ${total} \`any\` types, budget ${MAX_ANY_TOKENS}.`);
  if (total < MAX_ANY_TOKENS) {
    console.log(`Budget has slack: lower MAX_ANY_TOKENS to ${total} in scripts/countAnyTokens.mjs to lock the gain in.`);
  }
  for (const { file, count } of perFile.slice(0, 10)) console.log(`  ${String(count).padStart(3)}  ${file}`);
}

if (process.argv[1] && process.argv[1].endsWith('countAnyTokens.mjs')) main();
