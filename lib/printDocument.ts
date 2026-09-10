/**
 * Print / save-as-PDF for document artifacts.
 *
 * Opens a dedicated print window containing ONLY the rendered document with
 * an embedded professional print stylesheet (@page margins, serif-free
 * typography, zebra tables, page-break control), so the browser's
 * "Save as PDF" produces a clean deliverable instead of a screenshot of the
 * app chrome.
 */

export interface PrintDocumentOptions {
    title: string;
    /** Sanitized document HTML (the same markup DocumentPaper renders). */
    html: string;
    /** Optional subtitle shown under the title (project name, version…). */
    subtitle?: string;
    /**
     * Reading theme the live HTML was hydrated with. Embedded Mermaid SVGs
     * carry their palette inline, so dark-hydrated diagrams need a dark card
     * behind them to stay legible on the white printed page.
     */
    mermaidTheme?: 'light' | 'dark';
}

export function buildPrintHtml(opts: PrintDocumentOptions): string {
    const safeTitle = opts.title.replace(/</g, '&lt;');
    const subtitle = opts.subtitle ? `<p class="doc-subtitle">${opts.subtitle.replace(/</g, '&lt;')}</p>` : '';
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${safeTitle}</title>
<style>
  @page { size: A4; margin: 22mm 18mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Inter', 'Segoe UI', -apple-system, sans-serif;
    color: #1e293b; line-height: 1.6; font-size: 11.5pt; margin: 0;
  }
  header.doc-header { border-bottom: 2px solid #4338ca; padding-bottom: 10px; margin-bottom: 24px; }
  h1.doc-title { font-size: 20pt; margin: 0; color: #1e1b4b; }
  .doc-subtitle { margin: 4px 0 0; color: #64748b; font-size: 10pt; }
  h1, h2, h3, h4 { color: #1e1b4b; page-break-after: avoid; break-after: avoid-page; }
  h1 { font-size: 16pt; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  h2 { font-size: 13.5pt; margin-top: 22px; }
  h3 { font-size: 12pt; }
  p, li { orphans: 3; widows: 3; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; page-break-inside: auto; margin: 12px 0; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  th { background: #eef2ff; color: #312e81; text-align: left; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; vertical-align: top; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  pre, .code-block {
    background: #0f172a; color: #e2e8f0; padding: 12px 14px; border-radius: 6px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 9pt;
    white-space: pre-wrap; word-break: break-word; page-break-inside: avoid;
    position: relative;
  }
  code { font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
  p > code, li > code, td > code { background: #f1f5f9; color: #0f172a; padding: 1px 4px; border-radius: 3px; font-size: 9.5pt; }
  .code-lang-badge { position: absolute; top: 6px; right: 10px; font-size: 7.5pt; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.08em; }
  .tok-kw { color: #c4b5fd; font-weight: 600; }
  .tok-str { color: #86efac; }
  .tok-com { color: #94a3b8; font-style: italic; }
  .tok-num { color: #fcd34d; }
  .tok-prop { color: #7dd3fc; }
  blockquote { border-left: 3px solid #6366f1; margin: 12px 0; padding: 4px 14px; color: #475569; background: #f8fafc; }
  .callout { border-left: 4px solid #94a3b8; border-radius: 8px; padding: 10px 14px; margin: 14px 0; page-break-inside: avoid; }
  .callout p:first-child { margin: 0 0 4px; font-size: 8.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
  .callout-note      { border-color: #38bdf8; background: #f0f9ff; color: #0c4a6e; }
  .callout-tip       { border-color: #34d399; background: #ecfdf5; color: #065f46; }
  .callout-important { border-color: #a78bfa; background: #f5f3ff; color: #4c1d95; }
  .callout-warning   { border-color: #fbbf24; background: #fffbeb; color: #78350f; }
  .callout-caution   { border-color: #fb7185; background: #fff1f2; color: #881337; }
  .doc-chart-figure, .mermaid-embed { margin: 16px 0; text-align: center; page-break-inside: avoid; }
  .mermaid-embed.is-rendered { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; background: ${opts.mermaidTheme === 'dark' ? '#0f172a' : '#ffffff'}; }
  img, svg { max-width: 100%; }
  footer.doc-footer { margin-top: 32px; padding-top: 8px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 8.5pt; }
</style>
</head>
<body>
  <header class="doc-header">
    <h1 class="doc-title">${safeTitle}</h1>
    ${subtitle}
  </header>
  <main>${opts.html}</main>
  <footer class="doc-footer">Generado con Arky · ${new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}</footer>
</body>
</html>`;
}

/**
 * Open the print window and trigger the native print dialog once the
 * content has rendered. Returns false when the popup was blocked so the
 * caller can surface a toast.
 */
export function printDocumentHtml(opts: PrintDocumentOptions): boolean {
    if (typeof window === 'undefined') return false;
    const win = window.open('', '_blank', 'noopener,width=900,height=1100');
    if (!win) return false;
    win.document.open();
    win.document.write(buildPrintHtml(opts));
    win.document.close();
    // Give the new document a beat to lay out fonts/tables before printing.
    win.setTimeout(() => {
        try {
            win.focus();
            win.print();
        } catch { /* the user may have closed the window */ }
    }, 250);
    return true;
}
