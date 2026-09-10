/**
 * SafeRichText — the only component in the app that may insert HTML.
 *
 * `__tests__/security/noRawHtmlSinks.test.ts` enforces that claim by scanning
 * the tracked source tree, so "the only one" is a fact the build checks rather
 * than a convention a reviewer has to remember. That matters more than it
 * sounds: the seventeen sinks this component replaced were added one at a
 * time, each one locally reasonable, each one inserting `marked.parse(...)`
 * output straight into the DOM.
 *
 * Give it `markdown` and it renders and sanitises in one step. Give it `html`
 * only when the HTML came from a pipeline that already sanitised it — today
 * that is the artifact document renderer — and it sanitises again anyway,
 * because a prop whose safety depends on who is passing it is not a boundary.
 */

import React, { forwardRef, useMemo } from 'react';
import { renderMarkdownToSafeHtml, sanitizeRichTextHtml } from '../../lib/richText';
import { cn } from './cn';

export interface SafeRichTextProps {
  /** Markdown source. Rendered and sanitised. */
  markdown?: string | null;
  /** Pre-rendered HTML. Sanitised again regardless of its origin. */
  html?: string | null;
  className?: string;
  /** Element to render. Defaults to `div`; use `span` for inline contexts. */
  as?: 'div' | 'span' | 'article' | 'section';
  /** Forwarded so callers can keep their existing test hooks. */
  'data-testid'?: string;
  id?: string;
  /**
   * Extra attributes for the container element.
   *
   * Typed to exclude `dangerouslySetInnerHTML` and `children` on purpose: a
   * plain `...rest` spread would let a caller hand raw HTML straight back to
   * React through this component, which would make the whole boundary
   * decorative. The compiler refuses it here.
   */
  containerProps?: Omit<
    React.HTMLAttributes<HTMLElement>,
    'dangerouslySetInnerHTML' | 'children' | 'className' | 'id'
  >;
}

export const SafeRichText = forwardRef<HTMLElement, SafeRichTextProps>(({
  markdown,
  html,
  className,
  as: Tag = 'div',
  id,
  containerProps,
  'data-testid': testId,
}, ref) => {
  const safeHtml = useMemo(
    // `markdown` wins when both are given: it is the un-rendered source, so
    // it cannot already have been through a renderer that widened anything.
    () => (markdown != null && markdown !== ''
      ? renderMarkdownToSafeHtml(markdown)
      : sanitizeRichTextHtml(html ?? '')),
    [markdown, html],
  );

  return (
    <Tag
      {...containerProps}
      ref={ref as React.Ref<never>}
      id={id}
      data-testid={testId}
      className={cn(className)}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
});

SafeRichText.displayName = 'SafeRichText';

export default SafeRichText;
