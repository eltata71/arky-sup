/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
/**
 * Negative and positive specs for the single sanitizer.
 *
 * The negatives are the point: every payload class here defeated the previous
 * regex denylist, and each one arrived through a real path — a chat turn, a
 * Firestore note, a model completion. The positives matter just as much: a
 * sanitizer that eats legitimate Markdown gets ripped out within a week, and
 * then there is no sanitizer at all.
 */

import { describe, it, expect } from 'vitest';
import { sanitizeRichTextHtml, sanitizeSvg } from '../../lib/richText/sanitizeHtml';

/** Nothing that survives sanitisation may be able to run. */
const expectInert = (output: string) => {
  const lowered = output.toLowerCase();
  expect(lowered).not.toContain('<script');
  expect(lowered).not.toContain('javascript:');
  expect(lowered).not.toContain('vbscript:');
  expect(lowered).not.toContain('data:text/html');
  expect(lowered).not.toContain('srcdoc');
  expect(lowered).not.toMatch(/\son[a-z]+\s*=/);
};

describe('script injection', () => {
  it('removes a plain script tag', () => {
    expectInert(sanitizeRichTextHtml('<p>hola</p><script>alert(1)</script>'));
  });

  it('removes a script tag split by nesting, which a single-pass regex reassembles', () => {
    // The old denylist replaced the inner <script> and left "<script>" behind.
    expectInert(sanitizeRichTextHtml('<scr<script>ipt>alert(1)</scr</script>ipt>'));
  });

  it('removes a script with attributes and odd spacing', () => {
    expectInert(sanitizeRichTextHtml('<script\n\ttype="text/javascript"\n>alert(1)</script >'));
  });
});

describe('event handlers', () => {
  it('strips onerror from an image', () => {
    expectInert(sanitizeRichTextHtml('<img src=x onerror=alert(1)>'));
  });

  it('strips onload from an svg, tag and all', () => {
    const output = sanitizeRichTextHtml('<svg onload=alert(1)></svg>');
    expectInert(output);
    expect(output.toLowerCase()).not.toContain('<svg');
  });

  it('strips a handler written with newlines and no quotes', () => {
    expectInert(sanitizeRichTextHtml('<div\nonmouseover\n=\nalert(1)>hover</div>'));
  });

  it('strips a handler on an otherwise allowed element', () => {
    expectInert(sanitizeRichTextHtml('<p onclick="alert(1)">texto</p>'));
  });
});

describe('dangerous URL schemes', () => {
  it('drops a javascript: href', () => {
    expectInert(sanitizeRichTextHtml('<a href="javascript:alert(1)">click</a>'));
  });

  it('drops a javascript: href obfuscated with entities and whitespace', () => {
    expectInert(sanitizeRichTextHtml('<a href="  java\tscript:alert(1)">click</a>'));
    expectInert(sanitizeRichTextHtml('<a href="&#106;avascript:alert(1)">click</a>'));
  });

  it('drops a vbscript: href', () => {
    expectInert(sanitizeRichTextHtml('<a href="vbscript:msgbox(1)">click</a>'));
  });

  it('drops a data:text/html href, the classic sandbox escape', () => {
    expectInert(sanitizeRichTextHtml('<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>'));
  });

  it('drops a data:text/html image source but keeps a real inline image', () => {
    expectInert(sanitizeRichTextHtml('<img src="data:text/html,<script>alert(1)</script>">'));
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(sanitizeRichTextHtml(`<img src="${png}" alt="figura">`)).toContain(png);
  });
});

describe('embedding and form surfaces', () => {
  it('removes an iframe, srcdoc included', () => {
    expectInert(sanitizeRichTextHtml('<iframe srcdoc="<script>alert(1)</script>"></iframe>'));
  });

  it('removes object and embed', () => {
    const output = sanitizeRichTextHtml('<object data="x"></object><embed src="y">');
    expect(output.toLowerCase()).not.toContain('<object');
    expect(output.toLowerCase()).not.toContain('<embed');
  });

  it('removes a form and its formaction', () => {
    const output = sanitizeRichTextHtml('<form action="javascript:alert(1)"><button formaction="javascript:alert(1)">x</button></form>');
    expectInert(output);
    expect(output.toLowerCase()).not.toContain('<form');
  });

  it('removes <base>, which repoints every relative URL on the page', () => {
    expect(sanitizeRichTextHtml('<base href="https://evil.example/">').toLowerCase()).not.toContain('<base');
  });

  it('removes a style block and the style attribute', () => {
    const output = sanitizeRichTextHtml('<style>body{background:url(javascript:alert(1))}</style><p style="background:url(javascript:alert(1))">x</p>');
    expectInert(output);
    expect(output.toLowerCase()).not.toContain('<style');
    expect(output.toLowerCase()).not.toContain('style=');
  });
});

describe('mutation XSS', () => {
  it('neutralises the noscript reparse trick', () => {
    expectInert(sanitizeRichTextHtml('<noscript><p title="</noscript><img src=x onerror=alert(1)>">'));
  });

  it('neutralises a payload hidden in a malformed comment', () => {
    expectInert(sanitizeRichTextHtml('<!--><script>alert(1)</script>-->'));
  });

  it('neutralises math/annotation-xml smuggling', () => {
    expectInert(sanitizeRichTextHtml('<math><annotation-xml encoding="text/html"><script>alert(1)</script></annotation-xml></math>'));
  });
});

describe('legitimate Markdown survives', () => {
  it('keeps headings, emphasis and paragraphs', () => {
    const output = sanitizeRichTextHtml('<h2 id="titulo">Título</h2><p>Texto con <strong>énfasis</strong> y <em>matiz</em>.</p>');
    expect(output).toContain('<h2');
    expect(output).toContain('id="titulo"');
    expect(output).toContain('<strong>énfasis</strong>');
  });

  it('keeps tables whole', () => {
    const table = '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td colspan="2">1</td></tr></tbody></table>';
    const output = sanitizeRichTextHtml(table);
    expect(output).toContain('<table>');
    expect(output).toContain('colspan="2"');
  });

  it('keeps code blocks and their highlight classes', () => {
    const output = sanitizeRichTextHtml('<pre><code class="language-ts"><span class="tok-kw">const</span> x = 1;</code></pre>');
    expect(output).toContain('<pre>');
    expect(output).toContain('class="language-ts"');
    expect(output).toContain('tok-kw');
  });

  it('keeps safe links, and hardens the ones that open a new tab', () => {
    expect(sanitizeRichTextHtml('<a href="https://arky.example/doc">doc</a>')).toContain('href="https://arky.example/doc"');
    expect(sanitizeRichTextHtml('<a href="#seccion">ir</a>')).toContain('href="#seccion"');
    expect(sanitizeRichTextHtml('<a href="mailto:a@b.com">correo</a>')).toContain('mailto:a@b.com');
    expect(sanitizeRichTextHtml('<a href="https://x.example" target="_blank">x</a>')).toContain('noopener');
  });

  it('keeps the pipeline data attributes the document views read', () => {
    const output = sanitizeRichTextHtml('<div data-mermaid-source="Z3JhcGggVEQ=" data-chart="bar">x</div>');
    expect(output).toContain('data-mermaid-source');
    expect(output).toContain('data-chart');
  });

  it('keeps callouts, lists and blockquotes', () => {
    const output = sanitizeRichTextHtml('<blockquote class="border-sky-400" data-callout="NOTE"><ul><li>uno</li></ul></blockquote>');
    expect(output).toContain('<blockquote');
    expect(output).toContain('<li>uno</li>');
    expect(output).toContain('data-callout="NOTE"');
  });

  it('keeps the text of a dropped wrapper instead of deleting the content', () => {
    expect(sanitizeRichTextHtml('<unknown-tag>contenido importante</unknown-tag>')).toContain('contenido importante');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeRichTextHtml('')).toBe('');
  });
});

describe('sanitizeSvg', () => {
  it('keeps a Mermaid-shaped diagram intact', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" role="img" aria-label="d">'
      + '<defs><marker id="a" refX="9" orient="auto"><path d="M0,0 L10,5"/></marker></defs>'
      + '<g class="node"><rect x="1" y="2" width="30" height="20" fill="#eee" stroke="#333"/>'
      + '<text x="5" y="15" font-size="10" text-anchor="middle">Nodo</text></g>'
      + '<line x1="0" y1="0" x2="10" y2="10" marker-end="url(#a)"/></svg>';
    const output = sanitizeSvg(svg);
    expect(output).toContain('<svg');
    expect(output).toContain('viewBox');
    expect(output).toContain('marker-end');
    expect(output).toContain('Nodo');
  });

  it('keeps foreignObject label markup, which Mermaid emits for wrapped text', () => {
    const output = sanitizeSvg('<svg><foreignObject width="10" height="10"><div><span>etiqueta</span></div></foreignObject></svg>');
    expect(output).toContain('etiqueta');
  });

  it('removes a script inside the svg', () => {
    expectInert(sanitizeSvg('<svg><script>alert(1)</script><rect width="1" height="1"/></svg>'));
  });

  it('removes a script smuggled through foreignObject', () => {
    expectInert(sanitizeSvg('<svg><foreignObject><script>alert(1)</script></foreignObject></svg>'));
  });

  it('removes handlers on svg elements', () => {
    expectInert(sanitizeSvg('<svg><rect onload="alert(1)" onclick="alert(2)" width="1" height="1"/></svg>'));
  });

  it('removes a javascript: xlink:href on <use>', () => {
    expectInert(sanitizeSvg('<svg><use xlink:href="javascript:alert(1)"/></svg>'));
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeSvg('')).toBe('');
  });
});
