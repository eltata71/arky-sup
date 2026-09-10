import React, { useRef, useState } from 'react';
import { ErrorBoundary } from '../../ErrorBoundary';
import ViewerCrashFallback from '../ViewerCrashFallback';
import DocumentViewToolbar from './DocumentViewToolbar';
import DocumentPaper from './DocumentPaper';
import { DOCUMENT_ZOOM_LEVELS, type DocumentPageSize, type DocumentTheme } from './documentPresentation';
import type { DocumentCoverMeta } from './DocumentPaper';
import type { DocumentTocEntry } from '../../../hooks/artifacts/useDocumentRendering';

export interface DocumentViewProps {
  /** Sanitized HTML rendered inside the paper surface. */
  markdownHtml: string;
  /** Raw artifact content, used as a fallback when the HTML is empty. */
  rawContent: string;
  pageSize: DocumentPageSize;
  zoom: number;
  /** Reading theme of the paper surface (independent of the app theme). */
  theme?: DocumentTheme;
  /** Resolved paper width in CSS px for the active page size. */
  pageWidthPx: number;
  onChangePageSize: (size: DocumentPageSize) => void;
  onChangeZoom: (zoom: number) => void;
  onChangeTheme?: (theme: DocumentTheme) => void;
  onEdit: () => void;
  onExport: () => void;
  /** Opens the print-ready window (browser print → save as PDF). */
  onPrint?: () => void;
  /** Clickable table of contents derived from the document headings. */
  toc?: DocumentTocEntry[];
  /** Formal deliverable header rendered above the document body. */
  cover?: DocumentCoverMeta;
  /** Applies split-view borders when the document shares the canvas. */
  isSplit?: boolean;
}

/**
 * Document view: paper-style Markdown rendering with a Word/Docs toolbar,
 * a clickable table of contents for long documents and a print-ready
 * export path. Self-contained — wraps its render surface in an
 * ErrorBoundary so a broken document never blanks the whole canvas.
 */
export const DocumentView: React.FC<DocumentViewProps> = ({
  markdownHtml,
  rawContent,
  pageSize,
  zoom,
  theme = 'dark',
  pageWidthPx,
  onChangePageSize,
  onChangeZoom,
  onChangeTheme,
  onEdit,
  onExport,
  onPrint,
  toc = [],
  cover,
  isSplit = false,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tocOpen, setTocOpen] = useState(false);

  const scrollToHeading = (id: string) => {
    const container = scrollRef.current;
    const target = container?.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Word-style "fit to width": pick the zoom level whose scaled page best
  // fills the scroll container (accounting for its horizontal padding).
  const fitWidth = () => {
    const container = scrollRef.current;
    if (!container || pageWidthPx <= 0) return;
    const available = container.clientWidth - 48;
    if (available <= 0) return;
    const ideal = (available / pageWidthPx) * 100;
    const fitted = [...DOCUMENT_ZOOM_LEVELS].reverse().find((z) => z <= ideal)
      ?? DOCUMENT_ZOOM_LEVELS[0];
    onChangeZoom(fitted);
  };

  return (
    <div
      className={`flex-1 flex flex-col min-h-0 animate-fade-in ${
        theme === 'dark' ? 'bg-gray-950' : 'bg-gray-100 dark:bg-gray-800'
      } ${isSplit ? 'border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-800' : ''}`}
    >
      <DocumentViewToolbar
        pageSize={pageSize}
        zoom={zoom}
        theme={theme}
        onChangePageSize={onChangePageSize}
        onChangeZoom={onChangeZoom}
        onChangeTheme={onChangeTheme}
        onFitWidth={fitWidth}
        onEdit={onEdit}
        onExport={onExport}
        onPrint={onPrint}
      />
      <ErrorBoundary
        fallback={(error, reset) => (
          <ViewerCrashFallback
            title="El documento falló al renderizar"
            viewerLabel="Documento"
            error={error}
            onReset={reset}
          />
        )}
      >
        <div className="relative flex-1 min-h-0">
          {toc.length >= 3 && (
            <div className="absolute top-3 left-3 z-10">
              <button
                type="button"
                onClick={() => setTocOpen((v) => !v)}
                aria-expanded={tocOpen}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-xl shadow-lg border border-gray-200/80 dark:border-gray-700/80 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-all"
                title="Tabla de contenidos"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h10M4 18h7" />
                </svg>
                Contenido
              </button>
              {tocOpen && (
                <nav
                  aria-label="Tabla de contenidos del documento"
                  className="mt-2 w-72 max-h-[60vh] overflow-y-auto bg-white/95 dark:bg-gray-800/95 backdrop-blur-md rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-2 animate-fade-in"
                >
                  {toc.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => {
                        scrollToHeading(entry.id);
                        setTocOpen(false);
                      }}
                      className={`block w-full text-left rounded-lg px-2 py-1.5 text-[12px] leading-snug text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                        entry.level === 1 ? 'font-semibold' : entry.level === 2 ? 'pl-5' : 'pl-8 text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {entry.text}
                    </button>
                  ))}
                </nav>
              )}
            </div>
          )}
          <div ref={scrollRef} className="h-full overflow-auto px-4 md:px-8 py-6 md:py-10">
            <DocumentPaper html={markdownHtml} widthPx={pageWidthPx} zoom={zoom} theme={theme} fallbackContent={rawContent} cover={cover} />
          </div>
        </div>
      </ErrorBoundary>
    </div>
  );
};

export default DocumentView;
