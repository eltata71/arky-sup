/**
 * HTML reaches the DOM through one component, and the build checks it.
 *
 * The seventeen sinks this replaced were not careless. Each was locally
 * reasonable — render a chat turn, show a lesson, display a note — and each
 * inserted `marked.parse(...)` straight into the DOM. The content came from
 * chat messages, Firestore documents and model completions; none of those is a
 * trust boundary, and `marked` v12 dropped its own `sanitize` option, so raw
 * HTML in any Markdown source passed through untouched.
 *
 * A convention would not have prevented that, because there was no moment at
 * which anyone was breaking one. So the constraint is mechanical: exactly one
 * file may contain `dangerouslySetInnerHTML`, and everything else goes through
 * it. The eighteenth sink fails this test instead of shipping.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * The single component permitted to insert HTML. It renders through
 * `lib/richText`, which sanitises with DOMPurify.
 */
const APPROVED_SINK = 'components/ui/SafeRichText.tsx';

/** Source files from git, so the scan cannot drift from the repository. */
const sourceFiles = (): string[] =>
  execSync('git ls-files "components/**/*.tsx" "components/*.tsx" "pages/**/*.tsx" "pages/*.tsx" "context/*.tsx" "hooks/**/*.ts*" "lib/**/*.ts*" "services/**/*.ts*"')
    .toString()
    .split('\n')
    .filter(Boolean);

/**
 * The file with comments stripped — the rule is about code, and a comment
 * explaining the rule would otherwise be reported as breaking it.
 */
const readCode = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('there is exactly one HTML sink', () => {
  it('no file outside the approved component inserts raw HTML', () => {
    const offenders = sourceFiles()
      .filter((file) => file !== APPROVED_SINK)
      .filter((file) => readCode(file).includes('dangerouslySetInnerHTML'));

    expect(offenders, [
      'These files insert HTML directly. Render through `SafeRichText` instead:',
      '  <SafeRichText markdown={source} />        // Markdown from any origin',
      '  <SafeRichText html={alreadyRendered} />   // pre-rendered HTML (sanitised again)',
      '',
      `If a new sink is genuinely unavoidable, it belongs inside ${APPROVED_SINK}.`,
    ].join('\n')).toEqual([]);
  });

  it('the approved component still exists and sanitises', () => {
    // Guards against the test passing because the component was deleted and
    // every caller quietly reverted to a raw sink somewhere unscanned.
    const source = readFileSync(APPROVED_SINK, 'utf8');
    expect(source).toContain('dangerouslySetInnerHTML');
    expect(source).toMatch(/renderMarkdownToSafeHtml|sanitizeRichTextHtml/);
  });
});

describe('markdown is never parsed straight into a render', () => {
  it('no component renders `marked.parse(...)` output itself', () => {
    // The narrower rule above catches the insertion; this catches the step
    // before it — holding unsanitised HTML in a variable or state is what made
    // the insertion look safe at the call site.
    const offenders = sourceFiles()
      .filter((file) => file !== APPROVED_SINK)
      .filter((file) => file.startsWith('components/') || file.startsWith('pages/'))
      .filter((file) => /marked\.parse\s*\(/.test(readCode(file)));

    expect(offenders, [
      'These files render Markdown to HTML themselves. Pass the Markdown source to',
      '`SafeRichText` instead, which renders and sanitises in one step:',
      '  <SafeRichText markdown={source} />',
    ].join('\n')).toEqual([]);
  });
});

describe('there is exactly one sanitiser', () => {
  it('lib/security delegates rather than keeping a second implementation', () => {
    // Two sanitisers is the same defect as two role models: the weaker one
    // silently becomes the real policy.
    const source = readCode('lib/security.ts');
    expect(source).toContain('sanitizeRichTextHtml');
    // The old regex denylist, which nested-tag obfuscation defeated.
    expect(source).not.toContain('.replace(/<\\s*(script');
  });
});
