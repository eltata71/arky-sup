import { describe, expect, it } from 'vitest';
import {
  newArtifactId,
  newCourseId,
  newLessonId,
  newModuleId,
  newPrefixedId,
  newProjectId,
  newTraceId,
  newUuid,
  newVersionGroupId,
} from '../../lib/ids';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('lib/ids', () => {
  it('newUuid returns RFC 4122 v4 UUIDs', () => {
    const value = newUuid();
    expect(value).toMatch(UUID_RE);
  });

  it('newUuid is unique across many calls (collision-free in a tick)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 5_000; i++) {
      set.add(newUuid());
    }
    expect(set.size).toBe(5_000);
  });

  it('newPrefixedId composes prefix + uuid', () => {
    const id = newPrefixedId('proj');
    expect(id.startsWith('proj_')).toBe(true);
    expect(id.slice('proj_'.length)).toMatch(UUID_RE);
  });

  it('newPrefixedId rejects unsafe prefixes (defence against injection in keys)', () => {
    expect(() => newPrefixedId('')).toThrow();
    expect(() => newPrefixedId('proj space')).toThrow();
    expect(() => newPrefixedId('proj/x')).toThrow();
  });

  it('typed helpers use the expected prefixes', () => {
    expect(newProjectId().startsWith('proj_')).toBe(true);
    expect(newArtifactId().startsWith('art_')).toBe(true);
    expect(newVersionGroupId().startsWith('art_')).toBe(true);
    expect(newCourseId().startsWith('course_')).toBe(true);
    expect(newModuleId().startsWith('mod_')).toBe(true);
    expect(newLessonId().startsWith('les_')).toBe(true);
    expect(newTraceId().startsWith('trace_')).toBe(true);
  });

  it('two artifacts created in the same tick get different ids (regression)', () => {
    const ids = Array.from({ length: 100 }, () => newArtifactId());
    expect(new Set(ids).size).toBe(100);
  });
});
