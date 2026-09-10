/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DOC_VIEW_THEME_KEY,
  isDocumentTheme,
  readStoredTheme,
  readStoredPageSize,
  readStoredZoom,
} from '../../../components/artifacts/document/documentPresentation';

describe('document presentation reading theme', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to dark when nothing is stored', () => {
    expect(readStoredTheme()).toBe('dark');
  });

  it('honours a stored light preference', () => {
    window.localStorage.setItem(DOC_VIEW_THEME_KEY, 'light');
    expect(readStoredTheme()).toBe('light');
  });

  it('falls back to dark on corrupt values', () => {
    window.localStorage.setItem(DOC_VIEW_THEME_KEY, 'sepia');
    expect(readStoredTheme()).toBe('dark');
  });

  it('validates theme values with the type guard', () => {
    expect(isDocumentTheme('light')).toBe(true);
    expect(isDocumentTheme('dark')).toBe(true);
    expect(isDocumentTheme(null)).toBe(false);
    expect(isDocumentTheme('blue')).toBe(false);
  });

  it('keeps the existing page-size and zoom defaults intact', () => {
    expect(readStoredPageSize()).toBe('letter');
    expect(readStoredZoom()).toBe(100);
  });
});
