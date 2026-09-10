import { LessonVersionStore } from '../types/lms';

/** Builds the `lessonId_tabId` cache/version key used across the LMS. */
export function versionKey(lessonId: string, tabId: string): string {
  return `${lessonId}_${tabId}`;
}

/**
 * Pure reducer for the lesson version store. The first time content is written
 * for a key it is recorded as the immutable `original`; every later write keeps
 * that original intact and only advances the revision metadata. This is what
 * guarantees a student never loses the first generated version of a section.
 */
export function applyVersionWrite(
  store: LessonVersionStore,
  key: string,
  content: string,
  now: number = Date.now(),
): LessonVersionStore {
  const existing = store[key];
  if (!existing) {
    return { ...store, [key]: { original: content, originalAt: now } };
  }
  return {
    ...store,
    [key]: { ...existing, updatedAt: now, revisions: (existing.revisions || 0) + 1 },
  };
}

/**
 * Backfills version entries for any cached content that predates versioning, so
 * the existing text becomes its own original. Never overwrites an entry that is
 * already tracked.
 */
export function seedVersionsFromCache(
  versions: LessonVersionStore,
  cache: Record<string, string>,
  now: number = Date.now(),
): LessonVersionStore {
  const seeded: LessonVersionStore = { ...versions };
  Object.entries(cache).forEach(([key, value]) => {
    if (!seeded[key]) {
      seeded[key] = { original: value, originalAt: now };
    }
  });
  return seeded;
}
