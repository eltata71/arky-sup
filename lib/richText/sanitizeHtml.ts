/**
 * The one sanitizer.
 *
 * Before this module the app had a regex denylist (`lib/security.sanitizeGeneratedHtml`)
 * wired into exactly one of twenty `dangerouslySetInnerHTML` sites. The other
 * nineteen inserted `marked.parse(...)` output directly, and `marked` v12
 * removed its own `sanitize` option, so raw HTML written into any Markdown
 * source passed straight through to the DOM. The content came from chat turns,
 * Firestore documents and model output — none of which is a trust boundary.
 *
 * Why an allowlist library rather than a better regex: a denylist has to
 * enumerate every way of writing an attack, and HTML parsing has more of those
 * than anyone can hold in their head. The old one missed nested tag
 * obfuscation (its single pass turns `<scr<script>ipt>` back into `<script>`),
 * `data:text/html`, `vbscript:`, `srcdoc`, `formaction`, and mXSS through
 * `<noscript>`. DOMPurify parses the document the way the browser will and
 * keeps only what is on the list, so an attack it has never seen still has to
 * survive the allowlist to reach the DOM.
 *
 * Two policies, because the shapes are genuinely different:
 *  - **Markdown-derived HTML** — semantic prose. No SVG, no MathML, no forms.
 *  - **Mermaid-rendered SVG** — graphics only, and a different tag universe.
 *    Mermaid runs with `securityLevel: 'strict'`, which is upstream hardening
 *    of the *input*; this is the check on the *output*, and one does not
 *    substitute for the other.
 */

import DOMPurify from 'dompurify';

/**
 * Attributes and URL schemes shared by both policies.
 *
 * `data:` is allowed only for images (`data:image/...`), which is how Markdown
 * carries an inline figure. `data:text/html` is the classic sandbox escape and
 * is excluded by the regex, not merely by convention.
 */
const SAFE_URI_PATTERN = /^(?:https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i;
const SAFE_IMAGE_URI_PATTERN = /^(?:https?:|data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,|\/|\.\/|\.\.\/)/i;

/** Tags a Markdown renderer can legitimately produce, plus the app's callouts. */
const MARKDOWN_ALLOWED_TAGS = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup',
  'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li',
  'mark', 'ol', 'p', 'pre', 's', 'samp', 'section', 'small', 'span', 'strong',
  'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'tr', 'u', 'ul', 'var',
];

/**
 * `class` and `id` are allowed because the document pipeline relies on them:
 * heading ids anchor the table of contents, and Tailwind classes carry the
 * callout, chart and code-highlight styling. `style` is NOT allowed — it is
 * the one attribute that can still reach a URL (`background:url(...)`).
 */
const MARKDOWN_ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'class', 'id', 'colspan', 'rowspan', 'align',
  'width', 'height', 'open', 'start', 'reversed', 'type', 'loading', 'target',
  'data-mermaid-source', 'data-chart', 'data-language', 'data-callout',
];

const SVG_ALLOWED_TAGS = [
  'svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'rect', 'text', 'tspan', 'defs', 'marker', 'pattern', 'clipPath', 'mask',
  'linearGradient', 'radialGradient', 'stop', 'use', 'symbol', 'title', 'desc',
  'foreignObject', 'style',
  // Mermaid emits HTML inside <foreignObject> for wrapped labels.
  'div', 'span', 'p', 'br', 'b', 'i', 'em', 'strong',
];

/**
 * `href`/`xlink:href` stay for `<use>`, which Mermaid needs for arrowheads.
 * The URI policy below still restricts what they may point at.
 */
const SVG_ALLOWED_ATTR = [
  'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points',
  'width', 'height', 'viewBox', 'preserveAspectRatio', 'transform', 'fill',
  'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'opacity', 'class',
  'id', 'style', 'font-family', 'font-size', 'font-weight', 'font-style',
  'text-anchor', 'dominant-baseline', 'dy', 'dx', 'marker-end', 'marker-start',
  'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'offset',
  'stop-color', 'stop-opacity', 'gradientUnits', 'patternUnits', 'clip-path',
  'mask', 'href', 'xlink:href', 'xmlns', 'xmlns:xlink', 'aria-label',
  'aria-labelledby', 'aria-roledescription', 'role',
];

/** `true` in a browser or jsdom; `false` under plain Node (SSR, a build script). */
export function isSanitizerAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(DOMPurify.isSupported);
}

/**
 * Without a DOM there is nothing to parse, so there is nothing to sanitize.
 * Returning the input would be the one failure mode this module exists to
 * prevent, so an unusable sanitizer yields empty output instead: a missing
 * paragraph is a visible bug someone fixes, a passed-through payload is not.
 */
const REFUSED = '';

let hooksInstalled = false;

/**
 * Enforce the URL policy on every element DOMPurify keeps.
 *
 * DOMPurify's own `ALLOWED_URI_REGEXP` is global; images need `data:` and
 * links must not have it, so the split is done per-attribute here.
 */
function installUriHook(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const element = node as Element;

    for (const attribute of ['href', 'xlink:href', 'src', 'action', 'formaction']) {
      const value = element.getAttribute?.(attribute);
      if (value === null || value === undefined) continue;

      const trimmed = value.trim();
      const isImageSource = attribute === 'src' && element.tagName?.toLowerCase() === 'img';
      const permitted = isImageSource ? SAFE_IMAGE_URI_PATTERN : SAFE_URI_PATTERN;

      // A relative or fragment URL is fine; anything with a scheme must match.
      if (trimmed.length > 0 && !permitted.test(trimmed)) {
        element.removeAttribute(attribute);
      }
    }

    // A link that opens a new tab without `noopener` hands the opener window
    // to the destination. Markdown authors never write this themselves.
    if (element.tagName?.toLowerCase() === 'a' && element.getAttribute?.('target')) {
      element.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

/**
 * Sanitize HTML produced from Markdown.
 *
 * Returns `''` for empty input and for a runtime with no DOM.
 */
export function sanitizeRichTextHtml(html: string): string {
  if (!html) return '';
  if (!isSanitizerAvailable()) return REFUSED;

  installUriHook();

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: MARKDOWN_ALLOWED_TAGS,
    ALLOWED_ATTR: MARKDOWN_ALLOWED_ATTR,
    // `USE_PROFILES` is deliberately absent. DOMPurify *replaces*
    // ALLOWED_TAGS/ALLOWED_ATTR wholesale when it is present, so passing both
    // silently discards the allowlist above and runs the full default HTML
    // profile — forms, inputs and all. The explicit lists are the policy;
    // FORBID_* below is belt-and-braces for the tags that must never appear
    // even if someone widens them.
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'select', 'textarea', 'svg', 'math'],
    FORBID_ATTR: ['style', 'srcdoc', 'formaction', 'form', 'ping', 'autofocus'],
    // Keep the element's text when its tag is dropped, so removing an unknown
    // wrapper does not silently delete a paragraph of the user's content.
    KEEP_CONTENT: true,
    RETURN_TRUSTED_TYPE: false,
  }) as unknown as string;
}

/**
 * Sanitize SVG markup rendered by Mermaid.
 *
 * Separate from the Markdown policy because the tag universe barely overlaps:
 * running SVG through the prose allowlist would delete the diagram, and
 * running prose through this one would allow `<foreignObject>` in a chat
 * message.
 */
export function sanitizeSvg(svg: string): string {
  if (!svg) return '';
  if (!isSanitizerAvailable()) return REFUSED;

  installUriHook();

  return DOMPurify.sanitize(svg, {
    ALLOWED_TAGS: SVG_ALLOWED_TAGS,
    ALLOWED_ATTR: SVG_ALLOWED_ATTR,
    // Same reason as above: no `USE_PROFILES`, or the SVG allowlist is
    // discarded wholesale.
    //
    // `HTML_INTEGRATION_POINTS` re-admits `<foreignObject>`, which DOMPurify
    // excludes by default. That default is not paranoia — foreignObject is how
    // an element crosses from the SVG namespace into HTML, and a sanitized
    // string re-parsed in a different context can change meaning there. It is
    // re-admitted deliberately because Mermaid puts every flowchart label
    // inside one: `flowchart.htmlLabels` defaults to true and
    // `securityLevel: 'strict'` does not turn it off, so dropping it would
    // erase the text from every diagram.
    //
    // The exposure is narrowed to almost nothing instead: the tags permitted
    // inside are eight formatting elements, none of which carries a URL, and
    // the attribute allowlist admits no handler and no `href`. The SVG is also
    // sanitized and inserted in the same tick, so the re-parse this vector
    // needs never happens. If a future change serialises and re-parses that
    // markup, this line is the one to revisit.
    // A map, not an array: DOMPurify resolves this option with a plain clone
    // and then looks tags up by key, so an array silently matches nothing.
    HTML_INTEGRATION_POINTS: { 'annotation-xml': true, foreignobject: true },
    // SMIL can drive an attribute to a new value after sanitisation is done,
    // which is a way to reintroduce a URL the allowlist already rejected.
    FORBID_TAGS: ['script', 'animate', 'animateTransform', 'animateMotion', 'set', 'handler'],
    FORBID_ATTR: ['srcdoc', 'formaction', 'ping', 'from', 'to', 'values', 'attributeName', 'begin'],
    KEEP_CONTENT: true,
    RETURN_TRUSTED_TYPE: false,
  }) as unknown as string;
}
