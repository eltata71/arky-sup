import React, { useEffect, useRef } from 'react';
import { decodeMermaidSource } from '../../../hooks/artifacts/useDocumentRendering';
import type { DocumentTheme } from './documentPresentation';
import { SafeRichText } from '../../ui/SafeRichText';

// Layout + structure shared by both reading themes. Colours live in the
// per-theme strings below so the paper can flip light/dark independently of
// the app chrome (`dark:` variants follow the app, not the document).
const PROSE_BASE_CLASS =
  'prose prose-base max-w-none px-[72px] py-[80px] [&>*:first-child]:mt-0 [&_table]:w-full [&_table]:text-sm [&_th]:font-semibold [&_th]:align-top [&_td]:align-top [&_th]:break-words [&_td]:break-words [&_h1]:text-[28px] [&_h1]:leading-tight [&_h1]:border-b [&_h1]:pb-2 [&_h1]:scroll-mt-4 [&_h2]:text-[20px] [&_h2]:mt-8 [&_h2]:scroll-mt-4 [&_h3]:text-[16px] [&_h3]:scroll-mt-4 [&_p]:leading-relaxed [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre]:bg-gray-900 [&_pre]:text-gray-100 [&_pre]:rounded-md [&_pre]:relative [&_pre_code]:bg-transparent [&_pre_code]:text-gray-100 [&_pre_code]:p-0 [&_.code-lang-badge]:absolute [&_.code-lang-badge]:top-2 [&_.code-lang-badge]:right-3 [&_.code-lang-badge]:text-[9px] [&_.code-lang-badge]:uppercase [&_.code-lang-badge]:tracking-widest [&_.code-lang-badge]:text-gray-400 [&_.tok-kw]:text-violet-300 [&_.tok-kw]:font-semibold [&_.tok-str]:text-emerald-300 [&_.tok-com]:text-slate-400 [&_.tok-com]:italic [&_.tok-num]:text-amber-300 [&_.tok-prop]:text-sky-300 [&_blockquote]:border-l-4 [&_blockquote]:border-primary-500 [&_.mermaid-embed_svg]:mx-auto [&_.mermaid-embed_svg]:max-w-full [&_.mermaid-embed.is-rendered]:rounded-xl [&_.mermaid-embed.is-rendered]:border [&_.mermaid-embed.is-rendered]:p-4';

const PROSE_LIGHT_CLASS =
  '[&_th]:bg-gray-50 [&_th]:text-gray-700 [&_tbody_tr:nth-child(even)]:bg-gray-50/60 [&_h1]:border-gray-200 [&_code]:bg-gray-100 [&_code]:text-gray-800 [&_blockquote]:bg-gray-50 [&_blockquote]:text-gray-700 [&_.mermaid-embed.is-rendered]:border-gray-200 [&_.mermaid-embed.is-rendered]:bg-white';

// `!` overrides are required for callouts: their tone classes are baked into
// the generated HTML (light palette), so the dark paper re-tints them here.
const PROSE_DARK_CLASS =
  'prose-invert [&_th]:bg-gray-800 [&_th]:text-gray-200 [&_tbody_tr:nth-child(even)]:bg-gray-800/40 [&_h1]:border-gray-700 [&_code]:bg-gray-800 [&_code]:text-gray-100 [&_pre]:ring-1 [&_pre]:ring-gray-700/80 [&_blockquote]:bg-gray-800/60 [&_blockquote]:text-gray-300 [&_.mermaid-embed.is-rendered]:border-gray-700 [&_.mermaid-embed.is-rendered]:bg-gray-900/70 [&_.doc-chart-figure_svg]:rounded-lg [&_.doc-chart-figure_svg]:bg-white [&_.doc-chart-figure_svg]:p-3 [&_.callout-note]:!bg-sky-950/40 [&_.callout-note]:!text-sky-100 [&_.callout-note]:!border-sky-500 [&_.callout-tip]:!bg-emerald-950/40 [&_.callout-tip]:!text-emerald-100 [&_.callout-tip]:!border-emerald-500 [&_.callout-important]:!bg-violet-950/40 [&_.callout-important]:!text-violet-100 [&_.callout-important]:!border-violet-500 [&_.callout-warning]:!bg-amber-950/40 [&_.callout-warning]:!text-amber-100 [&_.callout-warning]:!border-amber-500 [&_.callout-caution]:!bg-rose-950/40 [&_.callout-caution]:!text-rose-100 [&_.callout-caution]:!border-rose-500';

const PAPER_BASE_CLASS = 'document-paper mx-auto rounded-sm transition-all';

const PAPER_LIGHT_CLASS =
  'bg-white text-gray-900 ring-1 ring-gray-200/70 shadow-[0_8px_24px_-4px_rgba(15,23,42,0.18),0_2px_6px_-2px_rgba(15,23,42,0.12)]';

const PAPER_DARK_CLASS =
  'bg-gray-900 text-gray-100 ring-1 ring-gray-700/60 shadow-[0_12px_32px_-6px_rgba(0,0,0,0.65),0_2px_8px_-3px_rgba(0,0,0,0.5)]';

export interface DocumentCoverMeta {
  title: string;
  objective?: string;
  projectName?: string;
  version?: number | string;
  phase?: string;
  updatedAt?: string;
}

export interface DocumentPaperProps {
  /** Sanitized HTML to render inside the paper. */
  html: string;
  /** Paper width in CSS px. */
  widthPx: number;
  /** Zoom percentage (e.g. 100 for 1×). */
  zoom: number;
  /** Reading theme for the paper surface. Defaults to dark. */
  theme?: DocumentTheme;
  /** Raw content shown as a fallback when `html` is empty. */
  fallbackContent?: string;
  /** Formal deliverable header rendered above the document body. */
  cover?: DocumentCoverMeta;
}

let mermaidEmbedCounter = 0;

/**
 * Hydrate every `.mermaid-embed[data-mermaid-source]` placeholder into a real
 * rendered diagram, themed to match the paper surface. Failures keep the
 * highlighted source fallback, so the document is never blank. Idempotent per
 * node and theme (tracked via `data-mermaid-theme`), so switching the reading
 * theme re-renders every diagram with the matching Mermaid palette.
 */
const hydrateMermaidEmbeds = async (
  root: HTMLElement,
  theme: DocumentTheme,
  cancelled: () => boolean,
): Promise<void> => {
  const embeds = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-embed[data-mermaid-source]'))
    .filter((embed) => embed.getAttribute('data-mermaid-theme') !== theme);
  if (embeds.length === 0) return;
  let mermaid: typeof import('mermaid').default;
  try {
    mermaid = (await import('mermaid')).default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'neutral',
      fontFamily: 'Inter, sans-serif',
    });
  } catch {
    return; // keep fallbacks
  }
  for (const embed of embeds) {
    if (cancelled()) return;
    const source = decodeMermaidSource(embed.getAttribute('data-mermaid-source') ?? '');
    if (!source.trim()) continue;
    try {
      mermaidEmbedCounter += 1;
      const { svg } = await mermaid.render(`doc-embed-${Date.now().toString(36)}-${mermaidEmbedCounter}`, source);
      if (cancelled()) return;
      if (svg && svg.includes('<svg')) {
        embed.innerHTML = svg;
        embed.classList.add('is-rendered');
        embed.setAttribute('data-mermaid-theme', theme);
      }
    } catch {
      // Invalid mermaid → the highlighted source stays visible.
    }
  }
};

const CoverHeader: React.FC<{ cover: DocumentCoverMeta; isDark: boolean }> = ({ cover, isDark }) => {
  const chips: Array<{ label: string; value: string }> = [];
  if (cover.projectName) chips.push({ label: 'Proyecto', value: cover.projectName });
  if (cover.phase) chips.push({ label: 'Fase', value: cover.phase });
  if (cover.version !== undefined) chips.push({ label: 'Versión', value: `v${cover.version}` });
  if (cover.updatedAt) {
    const date = new Date(cover.updatedAt);
    if (!Number.isNaN(date.getTime())) {
      chips.push({ label: 'Actualizado', value: date.toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' }) });
    }
  }
  return (
    <header className="document-cover px-[72px] pt-[56px]" data-export-cover>
      <p className={`text-[10px] font-bold uppercase tracking-[0.22em] ${isDark ? 'text-primary-400' : 'text-primary-600'}`}>Arky · Documento arquitectural</p>
      <h1 className={`mt-2 text-[30px] font-bold leading-tight ${isDark ? 'text-gray-50' : 'text-gray-900'}`}>{cover.title}</h1>
      {cover.objective && (
        <p className={`mt-2 text-[13.5px] leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{cover.objective}</p>
      )}
      {chips.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {chips.map((chip) => (
            <span
              key={chip.label}
              className={`inline-flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] ${
                isDark ? 'border-gray-700 bg-gray-800/80' : 'border-gray-200 bg-gray-50'
              }`}
            >
              <span className={`font-bold uppercase tracking-wider text-[9px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{chip.label}</span>
              <span className={`font-semibold ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{chip.value}</span>
            </span>
          ))}
        </div>
      )}
      <div className="mt-6 h-[3px] w-24 rounded-full bg-gradient-to-r from-primary-600 to-cyan-500" />
    </header>
  );
};

/**
 * Word / Google Docs style "paper" surface shared by the document and
 * markdown views. Renders the formal cover header, hydrates embedded Mermaid
 * diagrams into real SVG (themed to the paper surface), and shows a
 * recoverable fallback when the HTML is empty so the canvas is never blank
 * without a diagnostic.
 */
export const DocumentPaper: React.FC<DocumentPaperProps> = ({ html, widthPx, zoom, theme, fallbackContent, cover }) => {
  const proseRef = useRef<HTMLDivElement>(null);
  const resolvedTheme: DocumentTheme = theme ?? 'dark';
  const isDark = resolvedTheme === 'dark';

  useEffect(() => {
    const root = proseRef.current;
    if (!root || !html.includes('mermaid-embed')) return;
    let cancelled = false;
    void hydrateMermaidEmbeds(root, resolvedTheme, () => cancelled);
    return () => { cancelled = true; };
  }, [html, resolvedTheme]);

  return (
    <div
      className={`${PAPER_BASE_CLASS} ${isDark ? PAPER_DARK_CLASS : PAPER_LIGHT_CLASS}`}
      style={{ width: `${widthPx}px`, maxWidth: '100%', zoom: zoom / 100 }}
    >
      {cover && html.trim().length > 0 && <CoverHeader cover={cover} isDark={isDark} />}
      {html.trim().length > 0 ? (
        <SafeRichText
          ref={proseRef}
          containerProps={{ 'data-document-prose': true } as Record<string, unknown>}
          className={`${PROSE_BASE_CLASS} ${isDark ? PROSE_DARK_CLASS : PROSE_LIGHT_CLASS} ${cover ? '!pt-[40px]' : ''}`}
          html={html}
        />
      ) : (
        <pre
          className={`m-[72px] whitespace-pre-wrap rounded-xl border p-4 text-sm ${
            isDark ? 'border-amber-500/50 bg-amber-950/40 text-amber-100' : 'border-amber-300 bg-amber-50 text-amber-950'
          }`}
        >
          {fallbackContent && fallbackContent.length > 0
            ? fallbackContent
            : 'El artefacto no contiene texto. Usa Regenerar para reconstruirlo desde la solicitud original.'}
        </pre>
      )}
    </div>
  );
};

export default DocumentPaper;
