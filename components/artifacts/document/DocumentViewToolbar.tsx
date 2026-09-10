import React from 'react';
import { ArrowUpTrayIcon, ChevronDownIcon, MoonIcon, PencilIcon, SunIcon } from '../../Icons';
import {
  DOCUMENT_PAGE_SIZES,
  DOCUMENT_ZOOM_LEVELS,
  stepDocumentZoom,
  type DocumentPageSize,
  type DocumentTheme,
} from './documentPresentation';

export interface DocumentViewToolbarProps {
  pageSize: DocumentPageSize;
  zoom: number;
  /** Reading theme of the paper surface (independent of the app theme). */
  theme?: DocumentTheme;
  onChangePageSize: (size: DocumentPageSize) => void;
  onChangeZoom: (zoom: number) => void;
  onChangeTheme?: (theme: DocumentTheme) => void;
  /** Computes the zoom that makes the page fill the available width. */
  onFitWidth?: () => void;
  onEdit?: () => void;
  onExport?: () => void;
  /** Opens the print-ready window (browser print → save as PDF). */
  onPrint?: () => void;
  canEdit?: boolean;
}

/**
 * Document toolbar: page-size dropdown + zoom controls. Mimics the layout
 * affordances found in Word and Google Docs so reviewers can pick a paper
 * width and zoom level without leaving the canvas.
 */
export const DocumentViewToolbar: React.FC<DocumentViewToolbarProps> = ({
  pageSize,
  zoom,
  theme,
  onChangePageSize,
  onChangeZoom,
  onChangeTheme,
  onFitWidth,
  onEdit,
  onExport,
  onPrint,
  canEdit = true,
}) => {
  return (
    <div className="flex-shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 md:px-6 py-2 border-b border-gray-200 dark:border-gray-800 bg-white/85 dark:bg-gray-950/80 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <label htmlFor="doc-page-size" className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Tamaño</label>
        <div className="relative">
          <select
            id="doc-page-size"
            value={pageSize}
            onChange={(e) => onChangePageSize(e.target.value as DocumentPageSize)}
            className="appearance-none pl-3 pr-8 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs font-medium text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {(Object.keys(DOCUMENT_PAGE_SIZES) as DocumentPageSize[]).map((size) => (
              <option key={size} value={size}>{DOCUMENT_PAGE_SIZES[size].label}</option>
            ))}
          </select>
          <ChevronDownIcon className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500" />
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="inline-flex items-center rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
          <button
            type="button"
            onClick={() => onChangeZoom(stepDocumentZoom(zoom, -1))}
            disabled={zoom <= DOCUMENT_ZOOM_LEVELS[0]}
            className="px-2 py-1 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Reducir zoom"
            title="Reducir zoom"
          >−</button>
          <button
            type="button"
            onClick={() => onChangeZoom(100)}
            className="px-2 py-1 min-w-[52px] text-xs font-semibold text-gray-700 dark:text-gray-200 border-x border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
            title="Restablecer zoom (100%)"
          >{zoom}%</button>
          <button
            type="button"
            onClick={() => onChangeZoom(stepDocumentZoom(zoom, 1))}
            disabled={zoom >= DOCUMENT_ZOOM_LEVELS[DOCUMENT_ZOOM_LEVELS.length - 1]}
            className="px-2 py-1 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Ampliar zoom"
            title="Ampliar zoom"
          >+</button>
        </div>
        {onFitWidth && (
          <button
            type="button"
            onClick={onFitWidth}
            className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            title="Ajustar la página al ancho disponible"
          >Ajustar</button>
        )}
        {theme && onChangeTheme && (
          <button
            type="button"
            onClick={() => onChangeTheme(theme === 'dark' ? 'light' : 'dark')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            title={theme === 'dark' ? 'Leer en página clara' : 'Leer en página oscura'}
            aria-label={theme === 'dark' ? 'Cambiar a página clara' : 'Cambiar a página oscura'}
          >
            {theme === 'dark' ? <SunIcon className="w-3.5 h-3.5" /> : <MoonIcon className="w-3.5 h-3.5" />}
            {theme === 'dark' ? 'Clara' : 'Oscura'}
          </button>
        )}
        {canEdit && onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
            title="Editar contenido"
          >
            <PencilIcon className="w-3.5 h-3.5" />
            Editar
          </button>
        )}
        {onPrint && (
          <button
            type="button"
            onClick={onPrint}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
            title="Imprimir o guardar como PDF (vista limpia, sin interfaz)"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 9V4h12v5M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v7H6v-7z" />
            </svg>
            Imprimir
          </button>
        )}
        {onExport && (
          <button
            type="button"
            onClick={onExport}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-primary-600 text-white hover:bg-primary-700"
            title="Exportar documento"
          >
            <ArrowUpTrayIcon className="w-3.5 h-3.5" />
            Exportar
          </button>
        )}
      </div>
    </div>
  );
};

export default DocumentViewToolbar;
