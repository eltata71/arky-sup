import { useEffect, useState } from 'react';
import {
  DOC_VIEW_PAGE_SIZE_KEY,
  DOC_VIEW_THEME_KEY,
  DOC_VIEW_ZOOM_KEY,
  DOCUMENT_PAGE_SIZES,
  readStoredPageSize,
  readStoredTheme,
  readStoredZoom,
  type DocumentPageSize,
  type DocumentTheme,
} from '../../components/artifacts/document/documentPresentation';

export interface UseDocumentPresentationResult {
  pageSize: DocumentPageSize;
  zoom: number;
  theme: DocumentTheme;
  setPageSize: (size: DocumentPageSize) => void;
  setZoom: (zoom: number) => void;
  setTheme: (theme: DocumentTheme) => void;
  /** Resolved paper width in CSS px for the active page size. */
  pageWidthPx: number;
}

/**
 * Owns the Word/Docs style document presentation state (paper size + zoom +
 * reading theme) and persists it to localStorage so the architect keeps
 * their preferred layout across artifacts. The reading theme defaults to
 * dark and is independent of the app chrome theme.
 */
export const useDocumentPresentation = (): UseDocumentPresentationResult => {
  const [pageSize, setPageSize] = useState<DocumentPageSize>(() => readStoredPageSize());
  const [zoom, setZoom] = useState<number>(() => readStoredZoom());
  const [theme, setTheme] = useState<DocumentTheme>(() => readStoredTheme());

  useEffect(() => {
    try {
      window.localStorage.setItem(DOC_VIEW_PAGE_SIZE_KEY, pageSize);
    } catch {
      /* ignore quota errors */
    }
  }, [pageSize]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DOC_VIEW_ZOOM_KEY, String(zoom));
    } catch {
      /* ignore quota errors */
    }
  }, [zoom]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DOC_VIEW_THEME_KEY, theme);
    } catch {
      /* ignore quota errors */
    }
  }, [theme]);

  return {
    pageSize,
    zoom,
    theme,
    setPageSize,
    setZoom,
    setTheme,
    pageWidthPx: DOCUMENT_PAGE_SIZES[pageSize].width,
  };
};
