import type { DocumentTocEntry } from '../../../hooks/artifacts/useDocumentRendering';

/** Id of the section being read: the last heading whose top has passed the reading line. */
export const activeSectionId = (
  tops: ReadonlyArray<{ id: string; top: number }>,
  readingLine: number,
): string | null => {
  let active: string | null = tops.length > 0 ? tops[0].id : null;
  for (const entry of tops) {
    if (entry.top <= readingLine) active = entry.id;
    else break;
  }
  return active;
};

/** Neighbouring section in the outline; stays put at either end and never invents one. */
export const adjacentSectionId = (
  toc: ReadonlyArray<DocumentTocEntry>,
  currentId: string | null,
  direction: 1 | -1,
): string | null => {
  if (toc.length === 0) return null;
  const index = toc.findIndex((entry) => entry.id === currentId);
  if (index === -1) return direction === 1 ? toc[0].id : toc[toc.length - 1].id;
  const next = Math.min(toc.length - 1, Math.max(0, index + direction));
  return toc[next].id;
};

/** Section a shared link points at, or null when the hash names nothing in this document. */
export const sectionFromHash = (
  hash: string,
  toc: ReadonlyArray<DocumentTocEntry>,
): string | null => {
  const id = hash.replace(/^#/, '');
  if (!id) return null;
  let decoded = id;
  try { decoded = decodeURIComponent(id); } catch { /* keep the raw value */ }
  return toc.some((entry) => entry.id === decoded) ? decoded : null;
};
