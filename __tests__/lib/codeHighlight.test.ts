import { describe, it, expect } from 'vitest';
import { highlightCode, resolveHighlightLanguage, escapeHtml } from '../../lib/codeHighlight';
import { renderDocumentMarkdown } from '../../hooks/artifacts/useDocumentRendering';

describe('resolveHighlightLanguage', () => {
    it('maps aliases to canonical languages', () => {
        expect(resolveHighlightLanguage('ts')).toBe('typescript');
        expect(resolveHighlightLanguage('yml')).toBe('yaml');
        expect(resolveHighlightLanguage('sh')).toBe('bash');
        expect(resolveHighlightLanguage('desconocido')).toBe('plain');
        expect(resolveHighlightLanguage(undefined)).toBe('plain');
    });
});

describe('highlightCode', () => {
    it('escapes HTML in plain code', () => {
        expect(highlightCode('<script>alert(1)</script>', 'plain')).not.toContain('<script>');
    });

    it('wraps keywords, strings and comments in token spans', () => {
        const html = highlightCode(`// comentario\nconst x = "hola"; return 42;`, 'ts');
        expect(html).toContain('<span class="tok-com">// comentario</span>');
        expect(html).toContain('<span class="tok-kw">const</span>');
        expect(html).toContain('<span class="tok-str">&quot;hola&quot;</span>');
        expect(html).toContain('<span class="tok-num">42</span>');
    });

    it('never highlights keywords inside strings or comments', () => {
        const html = highlightCode(`const s = "const dentro de string";`, 'js');
        const insideString = html.match(/tok-str">([^<]*)</);
        expect(insideString?.[1]).toContain('const dentro de string');
    });

    it('is case-insensitive for SQL keywords', () => {
        const html = highlightCode('select id from claims;', 'sql');
        expect(html).toContain('<span class="tok-kw">select</span>');
    });
});

describe('renderDocumentMarkdown', () => {
    it('adds collision-free heading ids and collects the TOC', async () => {
        const { html, toc } = await renderDocumentMarkdown('# Visión General\n\n## Detalle\n\n## Detalle\n\n#### Profundo');
        expect(html).toContain('<h1 id="doc-h-vision-general">');
        expect(html).toContain('<h2 id="doc-h-detalle">');
        expect(html).toContain('<h2 id="doc-h-detalle-2">');
        expect(toc).toHaveLength(3); // h4 excluded
        expect(toc[0]).toMatchObject({ id: 'doc-h-vision-general', level: 1 });
    });

    it('renders highlighted code blocks with a language badge', async () => {
        const { html } = await renderDocumentMarkdown('```ts\nconst a = 1;\n```');
        expect(html).toContain('code-lang-badge');
        expect(html).toContain('tok-kw');
    });

    it('escapes raw HTML inside code blocks', async () => {
        const { html } = await renderDocumentMarkdown('```\n<img src=x onerror=alert(1)>\n```');
        expect(html).not.toContain('<img');
        expect(html).toContain(escapeHtml('<img src=x onerror=alert(1)>'));
    });
});
