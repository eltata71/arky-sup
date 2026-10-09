/**
 * Exports a summary that is not an artifact (the capability map) as a PPTX or
 * a PNG. The caller hands over plain labelled data; the deck is built here so
 * no screen has to know the presentation model. The PPTX writer loads on demand.
 */

import type { PresentationDeck, PresentationSlide } from '../presentation';
import type { ExportedFile } from './exportTypes';
import { EXPORT_DEFINITIONS } from './exportRegistry';
import { sanitizeFileName } from './fileNameSanitizer';

export interface TableDeckSummary {
  readonly title: string;
  readonly subtitle: string;
  readonly kpis: readonly { readonly label: string; readonly value: string }[];
  readonly tableTitle: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** A finding worth its own slide; omitted when there is none. */
  readonly callout?: { readonly title: string; readonly body: string };
  readonly rowsPerSlide?: number;
}

const ROWS_PER_SLIDE = 10;

export const buildTableDeck = (summary: TableDeckSummary): PresentationDeck => {
  const size = summary.rowsPerSlide ?? ROWS_PER_SLIDE;
  const slides: PresentationSlide[] = [];
  const push = (slide: Omit<PresentationSlide, 'id' | 'slideNumber'>) => {
    const slideNumber = slides.length + 1;
    slides.push({ id: `slide-${slideNumber}`, slideNumber, ...slide });
  };
  push({ title: summary.title, subtitle: summary.subtitle, layout: 'titleSlide', contentBlocks: [] });
  push({
    title: summary.title,
    layout: 'metricsKpi',
    contentBlocks: [{ type: 'kpi', content: summary.kpis.map((k) => ({ label: k.label, value: k.value })) }],
  });
  const pages = Math.max(1, Math.ceil(summary.rows.length / size));
  for (let page = 0; page < pages; page += 1) {
    push({
      title: pages > 1 ? `${summary.tableTitle} (${page + 1}/${pages})` : summary.tableTitle,
      layout: 'comparisonTable',
      contentBlocks: [
        {
          type: 'table',
          content: { headers: [...summary.headers], rows: summary.rows.slice(page * size, (page + 1) * size).map((r) => [...r]) },
        },
      ],
    });
  }
  if (summary.callout) {
    push({
      title: summary.callout.title,
      layout: 'executiveSummary',
      contentBlocks: [{ type: 'callout', content: { tone: 'warning', title: summary.callout.title, body: summary.callout.body } }],
    });
  }
  return { kind: 'presentation', version: '1', title: summary.title, audience: 'executive', slides };
};

export const exportTableDeckAsPptx = async (summary: TableDeckSummary, name: string): Promise<ExportedFile> => {
  const { buildPptx } = await import('./adapters/pptxExporter');
  const definition = EXPORT_DEFINITIONS.pptx;
  const bytes = buildPptx(buildTableDeck(summary));
  return {
    blob: new Blob([bytes.slice().buffer], { type: definition.mimeType }),
    filename: sanitizeFileName(name, { extension: definition.extension }),
    mimeType: definition.mimeType,
    extension: definition.extension,
    format: 'pptx',
  };
};

export const pngFile = (blob: Blob, name: string): ExportedFile => ({
  blob,
  filename: sanitizeFileName(name, { extension: 'png' }),
  mimeType: 'image/png',
  extension: 'png',
  format: 'png',
});
