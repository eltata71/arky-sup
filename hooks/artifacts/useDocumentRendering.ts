import { useEffect, useMemo, useRef, useState } from 'react';
import { Marked } from 'marked';
import type { Artifact } from '../../lib/artifacts';
import { sanitizeGeneratedHtml } from '../../lib/security';
import { extractMermaidCode } from '../../utils/diagram/extractMermaid';
import { highlightCode, escapeHtml, resolveHighlightLanguage } from '../../lib/codeHighlight';
import { renderChartFence } from '../../lib/chartSvg';

export interface DocumentTocEntry {
  /** DOM id assigned to the heading (prefixed, collision-free). */
  id: string;
  /** Plain text of the heading. */
  text: string;
  /** Heading level 1–6. */
  level: number;
}

export interface UseDocumentRenderingResult {
  /** Sanitized HTML for the document / markdown paper surfaces. */
  markdownHtml: string;
  /** Centralised Mermaid extraction — single source of truth for every view. */
  mermaidCode: string | null;
  /** Clickable table of contents derived from the document headings. */
  toc: DocumentTocEntry[];
}

const slugify = (text: string): string => text
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '')
  .slice(0, 64) || 'seccion';

/** Base64 helpers tolerant of UTF-8 (btoa alone throws on accents). */
export const encodeMermaidSource = (code: string): string => {
  try {
    return btoa(unescape(encodeURIComponent(code)));
  } catch {
    return '';
  }
};
export const decodeMermaidSource = (encoded: string): string => {
  try {
    return decodeURIComponent(escape(atob(encoded)));
  } catch {
    return '';
  }
};

/** GitHub-style admonition tones for `> [!NOTE]` blockquotes. */
const CALLOUT_TONES: Record<string, { label: string; classes: string; icon: string }> = {
  NOTE:      { label: 'Nota',       classes: 'border-sky-400 bg-sky-50 text-sky-900',            icon: 'ℹ' },
  TIP:       { label: 'Sugerencia', classes: 'border-emerald-400 bg-emerald-50 text-emerald-900', icon: '✓' },
  IMPORTANT: { label: 'Importante', classes: 'border-violet-400 bg-violet-50 text-violet-900',    icon: '★' },
  WARNING:   { label: 'Atención',   classes: 'border-amber-400 bg-amber-50 text-amber-900',       icon: '⚠' },
  CAUTION:   { label: 'Riesgo',     classes: 'border-rose-400 bg-rose-50 text-rose-900',          icon: '⛔' },
};

/**
 * Render markdown with professional document affordances:
 *  - heading anchors (`doc-h-…` ids) + a collected table of contents;
 *  - ```chart fences rendered as inline presentation-grade SVG charts;
 *  - ```mermaid fences emitted as hydration placeholders (DocumentPaper
 *    renders the real diagram client-side; the highlighted source stays as
 *    fallback so the document is never blank);
 *  - GitHub-style callouts (`> [!NOTE]`, `[!WARNING]`, …) as editorial cards;
 *  - dependency-free syntax highlighting on remaining code blocks.
 * Returns the HTML (NOT yet sanitized) plus the TOC entries.
 */
export const renderDocumentMarkdown = async (
  markdown: string,
): Promise<{ html: string; toc: DocumentTocEntry[] }> => {
  const toc: DocumentTocEntry[] = [];
  const usedIds = new Set<string>();
  const md = new Marked({
    renderer: {
      heading(text: string, level: number): string {
        const base = `doc-h-${slugify(text)}`;
        let id = base;
        let n = 2;
        while (usedIds.has(id)) id = `${base}-${n++}`;
        usedIds.add(id);
        if (level <= 3) {
          toc.push({ id, text: text.replace(/<[^>]+>/g, ''), level });
        }
        return `<h${level} id="${id}">${text}</h${level}>\n`;
      },
      blockquote(quote: string): string {
        const match = /^<p>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?\s*/i.exec(quote);
        if (!match) return `<blockquote>${quote}</blockquote>\n`;
        const toneKey = match[1].toUpperCase();
        const tone = CALLOUT_TONES[toneKey];
        const body = quote.replace(match[0], '<p>').replace(/^<p>\s*<\/p>/, '');
        return `<div class="callout callout-${toneKey.toLowerCase()} not-prose my-4 rounded-xl border-l-4 px-4 py-3 ${tone.classes}">`
          + `<p class="m-0 mb-1 text-[11px] font-bold uppercase tracking-widest">${tone.icon} ${tone.label}</p>`
          + `<div class="text-[13.5px] leading-relaxed [&_p]:m-0 [&_p+p]:mt-2">${body}</div>`
          + `</div>\n`;
      },
      code(code: string, infostring: string | undefined): string {
        const lang = (infostring ?? '').trim().split(/\s+/)[0].toLowerCase();
        if (lang === 'chart') {
          const svg = renderChartFence(code);
          if (svg) return `<figure class="doc-chart-figure my-5 flex justify-center">${svg}</figure>\n`;
          // Invalid spec → keep the JSON visible so the author can fix it.
        }
        if (lang === 'mermaid') {
          const encoded = encodeMermaidSource(code);
          const fallback = `<pre class="code-block">${`<span class="code-lang-badge">mermaid</span>`}<code>${highlightCode(code, 'yaml')}</code></pre>`;
          if (encoded) {
            return `<div class="mermaid-embed my-5" data-mermaid-source="${encoded}">${fallback}</div>\n`;
          }
          return `${fallback}\n`;
        }
        const resolved = resolveHighlightLanguage(infostring);
        const body = highlightCode(code, infostring);
        const badge = resolved !== 'plain'
          ? `<span class="code-lang-badge">${escapeHtml(resolved)}</span>`
          : '';
        return `<pre class="code-block">${badge}<code>${body}</code></pre>\n`;
      },
    },
  });
  const html = await md.parse(markdown);
  return { html: typeof html === 'string' ? html : String(html), toc };
};

/**
 * Owns Markdown parsing for the artifact canvas. Diagram-only artifacts are
 * wrapped in a fenced code block so the document view still has something to
 * render, and hybrid artifacts have their diagram block stripped so it isn't
 * duplicated alongside the rendered canvas.
 */
export const useDocumentRendering = (artifact: Artifact): UseDocumentRenderingResult => {
  const [markdownHtml, setMarkdownHtml] = useState('');
  const [toc, setToc] = useState<DocumentTocEntry[]>([]);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    const parse = async () => {
      let contentToParse = artifact.content;
      if (artifact.representation === 'hybrid') {
        const matchMermaid = artifact.content.match(/```mermaid\s*([\s\S]*?)\s*```/);
        const matchJson = artifact.content.match(/```json\s*([\s\S]*?)\s*```/);
        if (matchMermaid) {
          contentToParse = artifact.content.replace(matchMermaid[0], '').trim();
        } else if (matchJson) {
          contentToParse = artifact.content.replace(matchJson[0], '').trim();
        }
      } else if (artifact.type === 'react-flow-graph') {
        contentToParse = `### Diagrama Interactivo\n\nEste diagrama ha sido editado visualmente. Su código fuente es JSON:\n\n\`\`\`json\n${artifact.content}\n\`\`\``;
      } else if (artifact.representation === 'diagram') {
        contentToParse = `### Diagrama\n\`\`\`mermaid\n${artifact.content}\n\`\`\``;
      }
      const rendered = await renderDocumentMarkdown(contentToParse);
      const html = sanitizeGeneratedHtml(rendered.html);
      if (isMounted.current) {
        setMarkdownHtml(html);
        setToc(rendered.toc);
      }
    };
    parse();
  }, [artifact.content, artifact.representation, artifact.type]);

  const mermaidCode = useMemo(
    () => extractMermaidCode(artifact.content, artifact.representation),
    [artifact.content, artifact.representation],
  );

  return { markdownHtml, mermaidCode, toc };
};
