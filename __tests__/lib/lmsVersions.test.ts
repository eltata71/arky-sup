import { describe, it, expect } from 'vitest';
import { applyVersionWrite, seedVersionsFromCache, versionKey } from '../../lib/lmsVersions';
import { LessonVersionStore } from '../../types/lms';

describe('lmsVersions', () => {
  describe('versionKey', () => {
    it('combines lesson and tab into the canonical cache key', () => {
      expect(versionKey('l1', 'Resumen Ejecutivo')).toBe('l1_Resumen Ejecutivo');
    });
  });

  describe('applyVersionWrite', () => {
    it('records the first write as the immutable original', () => {
      const next = applyVersionWrite({}, 'l1_Resumen', 'primera versión', 1000);
      expect(next['l1_Resumen']).toEqual({ original: 'primera versión', originalAt: 1000 });
    });

    it('keeps the original untouched when content is regenerated', () => {
      const first = applyVersionWrite({}, 'k', 'original', 1000);
      const second = applyVersionWrite(first, 'k', 'regenerada', 2000);
      expect(second['k'].original).toBe('original');
      expect(second['k'].originalAt).toBe(1000);
      expect(second['k'].updatedAt).toBe(2000);
      expect(second['k'].revisions).toBe(1);
    });

    it('counts every regeneration without ever losing the first version', () => {
      let store: LessonVersionStore = {};
      store = applyVersionWrite(store, 'k', 'v1', 1);
      store = applyVersionWrite(store, 'k', 'v2', 2);
      store = applyVersionWrite(store, 'k', 'v3', 3);
      expect(store['k'].original).toBe('v1');
      expect(store['k'].revisions).toBe(2);
    });

    it('does not mutate the input store', () => {
      const input: LessonVersionStore = {};
      applyVersionWrite(input, 'k', 'v1', 1);
      expect(input).toEqual({});
    });
  });

  describe('seedVersionsFromCache', () => {
    it('backfills originals for cached content that predates versioning', () => {
      const seeded = seedVersionsFromCache({}, { a: 'texto A', b: 'texto B' }, 500);
      expect(seeded.a).toEqual({ original: 'texto A', originalAt: 500 });
      expect(seeded.b).toEqual({ original: 'texto B', originalAt: 500 });
    });

    it('never overwrites an already-tracked original', () => {
      const existing: LessonVersionStore = { a: { original: 'real original', originalAt: 1 } };
      const seeded = seedVersionsFromCache(existing, { a: 'regenerated current' }, 999);
      expect(seeded.a.original).toBe('real original');
      expect(seeded.a.originalAt).toBe(1);
    });
  });
});
