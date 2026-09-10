import { describe, it, expect } from 'vitest';
import { fallbackBulletsFromInstruction, MEMORY_BULLET_LIMITS } from '../memoryExtractor';

describe('fallbackBulletsFromInstruction', () => {
  it('returns an empty array for empty input', () => {
    expect(fallbackBulletsFromInstruction('')).toEqual([]);
    expect(fallbackBulletsFromInstruction('   ')).toEqual([]);
  });

  it('returns one bullet for a single sentence', () => {
    const out = fallbackBulletsFromInstruction('Usamos PostgreSQL 15 como base de datos principal.');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('PostgreSQL');
  });

  it('splits multi-sentence input into multiple bullets', () => {
    const out = fallbackBulletsFromInstruction(
      'Usamos PostgreSQL 15. La latencia objetivo es 200ms. El equipo prefiere Kubernetes.',
    );
    expect(out.length).toBeGreaterThanOrEqual(2);
  });

  it('respects MAX_BULLETS', () => {
    const long = Array(20).fill('Frase importante.').join(' ');
    const out = fallbackBulletsFromInstruction(long);
    expect(out.length).toBeLessThanOrEqual(MEMORY_BULLET_LIMITS.MAX_BULLETS);
  });

  it('caps individual bullet length', () => {
    const huge = 'x'.repeat(MEMORY_BULLET_LIMITS.MAX_BULLET_LENGTH + 200);
    const out = fallbackBulletsFromInstruction(huge);
    expect(out[0].length).toBeLessThanOrEqual(MEMORY_BULLET_LIMITS.MAX_BULLET_LENGTH);
  });

  it('filters out very short sentences', () => {
    const out = fallbackBulletsFromInstruction('ok. La latencia objetivo es 200ms.');
    // "ok." is shorter than the minimum sentence length and should be dropped.
    expect(out.every((b) => b.length > 6)).toBe(true);
  });
});
