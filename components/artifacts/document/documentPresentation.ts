/**
 * Document presentation primitives — Word / Google Docs style paper widths
 * and zoom levels for the document + markdown canvases.
 *
 * Extracted verbatim from `ArtifactCanvas` so the document toolbar, the
 * document view and the `useDocumentPresentation` hook share a single source
 * of truth for paper sizing and persistence keys.
 */

// Word / Google Docs style paper widths in CSS px (at 96 dpi). The "wide"
// preset is a non-paginated reading layout for very long markdown that does
// not need a physical page facsimile.
export const DOCUMENT_PAGE_SIZES = {
  letter: { label: 'Carta · 8.5"', width: 816 },
  a4: { label: 'A4 · 210 mm', width: 794 },
  wide: { label: 'Amplio', width: 1100 },
} as const;

export type DocumentPageSize = keyof typeof DOCUMENT_PAGE_SIZES;

export const DOCUMENT_ZOOM_LEVELS = [60, 75, 90, 100, 110, 125, 150, 175, 200] as const;

// Reading theme for the paper surface, independent of the app chrome theme so
// the architect can review a dark document inside a light app (and vice
// versa), like Word's page-color toggle. Dark is the product default.
export type DocumentTheme = 'light' | 'dark';

export const DOC_VIEW_PAGE_SIZE_KEY = 'arky.docView.pageSize';
export const DOC_VIEW_ZOOM_KEY = 'arky.docView.zoom';
export const DOC_VIEW_THEME_KEY = 'arky.docView.theme';

export const isDocumentPageSize = (value: string | null): value is DocumentPageSize =>
  value === 'letter' || value === 'a4' || value === 'wide';

export const readStoredPageSize = (): DocumentPageSize => {
  if (typeof window === 'undefined') return 'letter';
  try {
    const raw = window.localStorage.getItem(DOC_VIEW_PAGE_SIZE_KEY);
    return isDocumentPageSize(raw) ? raw : 'letter';
  } catch {
    return 'letter';
  }
};

export const isDocumentTheme = (value: string | null): value is DocumentTheme =>
  value === 'light' || value === 'dark';

export const readStoredTheme = (): DocumentTheme => {
  if (typeof window === 'undefined') return 'dark';
  try {
    const raw = window.localStorage.getItem(DOC_VIEW_THEME_KEY);
    return isDocumentTheme(raw) ? raw : 'dark';
  } catch {
    return 'dark';
  }
};

export const readStoredZoom = (): number => {
  if (typeof window === 'undefined') return 100;
  try {
    const stored = window.localStorage.getItem(DOC_VIEW_ZOOM_KEY);
    // `Number(null)` is 0 (finite!), which used to clamp every first-time
    // visitor to the 60% minimum zoom. Only parse real stored values.
    if (stored === null || stored.trim() === '') return 100;
    const raw = Number(stored);
    if (!Number.isFinite(raw) || raw <= 0) return 100;
    return Math.min(200, Math.max(60, Math.round(raw)));
  } catch {
    return 100;
  }
};

export const stepDocumentZoom = (current: number, direction: 1 | -1): number => {
  const sorted = DOCUMENT_ZOOM_LEVELS;
  if (direction === 1) return sorted.find((z) => z > current) ?? sorted[sorted.length - 1];
  const reversed = [...sorted].reverse();
  return reversed.find((z) => z < current) ?? sorted[0];
};
