/**
 * Markdown → safe HTML, in one step that cannot be half-performed.
 *
 * The previous shape of this in the app was `marked.parse(x)` at the call
 * site, with sanitisation as a separate, optional second step that nineteen of
 * twenty call sites did not take. Rendering and sanitising are fused here for
 * that reason: there is no exported function that returns unsanitised HTML, so
 * forgetting the second step is not a mistake anyone can make.
 *
 * The `Marked` *instance* is deliberately not the global singleton. `marked`
 * carries options and extensions on its default export, so a call anywhere in
 * the app that reconfigures it would silently change what every other surface
 * renders — including `hooks/artifacts/useDocumentRendering`, which builds its
 * own richer instance for the artifact document pipeline.
 */

import { Marked } from 'marked';
import { sanitizeRichTextHtml } from './sanitizeHtml';

/**
 * `gfm` for tables/strikethrough, `breaks` because chat and notes are written
 * with single newlines meaning single newlines — a Markdown purist's
 * paragraph rule reads as a bug in a chat bubble.
 */
const richTextMarked = new Marked({
  gfm: true,
  breaks: true,
});

/**
 * Render Markdown and return HTML that is safe to insert.
 *
 * Synchronous: `marked.parse` is only async when an async extension is
 * registered, and this instance registers none. Callers therefore do not need
 * an effect and a piece of state just to show a paragraph, which is what the
 * previous `await marked.parse(...)` pattern forced on several components.
 */
export function renderMarkdownToSafeHtml(markdown: string | null | undefined): string {
  if (!markdown) return '';
  const parsed = richTextMarked.parse(markdown, { async: false });
  return sanitizeRichTextHtml(typeof parsed === 'string' ? parsed : '');
}
