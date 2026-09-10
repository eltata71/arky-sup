/**
 * Centralised entity-ID generation.
 *
 * Historically the codebase used `proj_${Date.now()}`-style identifiers in
 * several places. That pattern has three real problems:
 *
 *   1. **Collisions** — two `createArtifact` calls dispatched in the same tick
 *      produce identical IDs.
 *   2. **Predictability** — sequential IDs leak ordering / volume metadata
 *      and are easy to enumerate.
 *   3. **Inconsistency** — different services rolled their own variants
 *      (`art_${Date.now()}_${Math.random().toString(36).substr(2,9)}`,
 *      `course_${Date.now()}`, etc.).
 *
 * Use these helpers for all new identifier generation. The implementation
 * prefers the platform `crypto.randomUUID()` and falls back to the bundled
 * `uuid` package for older runtimes (and Node < 19 in tests).
 */

import { v4 as uuidv4 } from 'uuid';

/** Returns a RFC 4122 v4 UUID string (`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`). */
export function newUuid(): string {
  const cryptoApi = typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return uuidv4();
}

/**
 * Builds an identifier of the form `{prefix}_{uuid}`.
 *
 * The prefix is preserved (rather than producing bare UUIDs) so existing
 * persisted documents keep working — a code path that scanned for `proj_…`
 * identifiers will continue to match.
 */
export function newPrefixedId(prefix: string): string {
  if (!prefix || /[^a-zA-Z0-9-]/.test(prefix)) {
    throw new Error(`newPrefixedId: invalid prefix "${prefix}". Use [a-zA-Z0-9-].`);
  }
  return `${prefix}_${newUuid()}`;
}

export const newProjectId = (): string => newPrefixedId('proj');
export const newArtifactId = (): string => newPrefixedId('art');
export const newVersionGroupId = (): string => newPrefixedId('art');
export const newCourseId = (): string => newPrefixedId('course');
export const newModuleId = (): string => newPrefixedId('mod');
export const newLessonId = (): string => newPrefixedId('les');
export const newTraceId = (): string => newPrefixedId('trace');
