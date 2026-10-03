import React, { useEffect, useRef } from 'react';
import type { ExportedFile } from '../../../lib/artifacts';
import { announceExportReceipt, describeExportReceipt } from '../../../lib/artifacts';
import { useAriaAnnouncer } from '../../../hooks/useAriaAnnouncer';

export interface ExportReceiptPanelProps {
  file: ExportedFile;
  /** «PDF», «Word (.docx)»… como lo nombra la lista de formatos. */
  formatLabel: string;
  onDownload: () => void;
  onBack: () => void;
  downloading?: boolean;
}

/**
 * Lo que la exportación hizo, antes de descargar (plan de clase mundial 9.4).
 *
 * El fichero ya está generado; aquí se ve su primera página o diapositiva, el
 * recibo que escribió el exportador —«3 páginas, 2 tablas, 1 diagrama»— y,
 * **antes que nada**, cada pérdida. Nadie debería descubrir en una reunión que
 * a un PDF le faltaba un diagrama: si faltó, lo dice esta pantalla, y la
 * descarga es un clic posterior a haberlo leído.
 *
 * Al aparecer, el foco va al título y el resultado se anuncia una sola vez
 * por `useAriaAnnouncer` (por eso los avisos no llevan además `role="alert"`:
 * se leerían dos veces).
 */
export const ExportReceiptPanel: React.FC<ExportReceiptPanelProps> = ({ file, formatLabel, onDownload, onBack, downloading = false }) => {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { announce } = useAriaAnnouncer();
  const { receipt } = file;
  const losses = receipt?.losses ?? [];

  // Se anuncia y se enfoca al aparecer el recibo de este fichero, no en cada render.
  useEffect(() => {
    headingRef.current?.focus();
    announce(announceExportReceipt(formatLabel, file.receipt));
  }, [file, formatLabel, announce]);

  const preview = receipt?.preview;
  const sizeKb = Math.max(1, Math.round(file.blob.size / 1024));

  return (
    <section aria-labelledby="export-receipt-title" className="space-y-4 text-sm">
      <div>
        <h3 id="export-receipt-title" ref={headingRef} tabIndex={-1} className="text-base font-semibold text-gray-900 outline-none dark:text-white">
          {formatLabel} listo para descargar
        </h3>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          {file.filename} · {sizeKb} KB{receipt ? ` · ${describeExportReceipt(receipt)}` : ''}
        </p>
      </div>

      {losses.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="font-semibold">
            {losses.length === 1 ? 'Antes de descargar: 1 aviso de pérdida' : `Antes de descargar: ${losses.length} avisos de pérdida`}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {losses.map((loss, index) => <li key={index}>{loss}</li>)}
          </ul>
        </div>
      ) : receipt ? (
        <p className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
          El exportador no informó ninguna pérdida.
        </p>
      ) : null}

      {preview && (
        <figure className="space-y-1">
          <figcaption className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {preview.kind === 'slide' ? 'Primera diapositiva' : 'Así empieza el documento'}
          </figcaption>
          <div
            className={`mx-auto overflow-hidden rounded-md border border-gray-200 bg-white p-4 text-left text-gray-900 shadow-sm dark:border-gray-700 ${preview.kind === 'slide' ? 'aspect-video w-full' : 'aspect-[8.5/11] w-2/3 max-w-[260px]'}`}
          >
            <p className="text-sm font-bold leading-snug">{preview.title}</p>
            {preview.subtitle && <p className="mt-1 text-[11px] leading-snug text-gray-500">{preview.subtitle}</p>}
            <ul className="mt-3 space-y-1 text-[11px] leading-snug text-gray-700">
              {preview.lines.map((line, index) => <li key={index} className="truncate">{line}</li>)}
            </ul>
          </div>
        </figure>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Volver a los formatos
        </button>
        <button
          type="button"
          onClick={onDownload}
          disabled={downloading}
          className="rounded-md bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
        >
          {downloading ? 'Descargando…' : losses.length > 0 ? 'Descargar de todos modos' : 'Descargar'}
        </button>
      </div>
    </section>
  );
};

export default ExportReceiptPanel;
