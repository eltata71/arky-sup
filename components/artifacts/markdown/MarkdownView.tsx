import React from 'react';
import { ErrorBoundary } from '../../ErrorBoundary';
import ViewerCrashFallback from '../ViewerCrashFallback';
import DocumentViewToolbar from '../document/DocumentViewToolbar';
import DocumentPaper from '../document/DocumentPaper';
import type { DocumentPageSize, DocumentTheme } from '../document/documentPresentation';
import {
  ArrowUpTrayIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  LightBulbIcon,
  Square2StackIcon,
} from '../../Icons';
import type { Artifact } from '../../../types';

export interface MarkdownViewProps {
  markdownHtml: string;
  rawContent: string;
  representation: Artifact['representation'];
  /** When true, shows the raw `.md` source instead of the rendered preview. */
  showSource: boolean;
  onToggleSource: (showSource: boolean) => void;
  markdownCopied: boolean;
  onCopyMarkdown: () => void;
  onDownloadMarkdown: () => void;
  pageSize: DocumentPageSize;
  zoom: number;
  /** Reading theme of the paper surface (independent of the app theme). */
  theme?: DocumentTheme;
  pageWidthPx: number;
  onChangePageSize: (size: DocumentPageSize) => void;
  onChangeZoom: (zoom: number) => void;
  onChangeTheme?: (theme: DocumentTheme) => void;
}

/**
 * Markdown view: `.md` source / rendered preview toggle plus copy + download
 * affordances. Self-contained — its render surface is wrapped in an
 * ErrorBoundary so a malformed document never blanks the canvas.
 */
export const MarkdownView: React.FC<MarkdownViewProps> = ({
  markdownHtml,
  rawContent,
  representation,
  showSource,
  onToggleSource,
  markdownCopied,
  onCopyMarkdown,
  onDownloadMarkdown,
  pageSize,
  zoom,
  theme = 'dark',
  pageWidthPx,
  onChangePageSize,
  onChangeZoom,
  onChangeTheme,
}) => (
  <div className={`flex-1 flex flex-col min-h-0 overflow-hidden animate-fade-in ${theme === 'dark' ? 'bg-gray-950' : 'bg-gray-100 dark:bg-gray-800'}`}>
    <div className="flex-shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 md:px-8 py-3 border-b border-gray-200 dark:border-gray-800 bg-white/85 dark:bg-gray-950/80 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <DocumentTextIcon className="w-5 h-5 text-primary-600 dark:text-primary-400" />
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white leading-tight">Vista Markdown (.md)</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">Formato listo para compartir con el equipo de desarrollo</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center bg-gray-200 dark:bg-gray-800 rounded-lg p-0.5">
          <button
            onClick={() => onToggleSource(false)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${!showSource ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'}`}
          >Vista previa</button>
          <button
            onClick={() => onToggleSource(true)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${showSource ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'}`}
          >Fuente</button>
        </div>
        <button
          onClick={onCopyMarkdown}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          {markdownCopied ? <CheckCircleIcon className="w-4 h-4 text-green-500" /> : <Square2StackIcon className="w-4 h-4" />}
          {markdownCopied ? 'Copiado' : 'Copiar Markdown'}
        </button>
        <button
          onClick={onDownloadMarkdown}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors"
        >
          <ArrowUpTrayIcon className="w-4 h-4" />
          Descargar .md
        </button>
      </div>
    </div>
    {representation === 'diagram' && (
      <div className="flex-shrink-0 px-4 md:px-8 py-2 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-100 dark:border-blue-900/40 text-xs text-blue-800 dark:text-blue-200 flex items-start gap-2">
        <LightBulbIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>Este artefacto es un diagrama. El Markdown incluye su código fuente como bloque <code className="font-mono bg-blue-100 dark:bg-blue-900/40 px-1 rounded">```mermaid```</code> para que pueda renderizarse en cualquier visor Markdown.</span>
      </div>
    )}
    {!showSource && (
      <DocumentViewToolbar
        pageSize={pageSize}
        zoom={zoom}
        theme={theme}
        onChangePageSize={onChangePageSize}
        onChangeZoom={onChangeZoom}
        onChangeTheme={onChangeTheme}
        canEdit={false}
      />
    )}
    <ErrorBoundary
      fallback={(error, reset) => (
        <ViewerCrashFallback
          title="La vista Markdown falló al renderizar"
          viewerLabel="Markdown"
          error={error}
          onReset={reset}
        />
      )}
    >
      <div className="flex-1 overflow-auto min-h-0 px-4 md:px-8 py-6 md:py-10">
        {showSource ? (
          <pre className="font-mono text-xs md:text-sm text-gray-100 whitespace-pre-wrap break-words max-w-4xl mx-auto rounded-md bg-gray-950 dark:bg-black/60 p-6 shadow-inner ring-1 ring-gray-800">{rawContent}</pre>
        ) : (
          <DocumentPaper html={markdownHtml} widthPx={pageWidthPx} zoom={zoom} theme={theme} fallbackContent={rawContent} />
        )}
      </div>
    </ErrorBoundary>
  </div>
);

export default MarkdownView;
