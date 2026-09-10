/**
 * `lib/richText` — the boundary between untrusted text and the DOM.
 *
 * Everything that turns Markdown, model output or stored content into HTML
 * goes through here, and `components/ui/SafeRichText` is the only component
 * allowed to insert the result.
 */

export { sanitizeRichTextHtml, sanitizeSvg, isSanitizerAvailable } from './sanitizeHtml';
export { renderMarkdownToSafeHtml } from './renderMarkdown';
