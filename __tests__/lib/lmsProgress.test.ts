import { describe, it, expect } from 'vitest';
import {
  levelFromXp,
  competencyLevel,
  updateStreak,
  dayKey,
  generateVerificationCode,
  QUIZ_PASS_PERCENT,
  XP_REWARDS,
} from '../../lib/lmsProgress';

describe('lmsProgress helpers', () => {
  describe('levelFromXp', () => {
    it('starts at level 1 with 0 XP', () => {
      const info = levelFromXp(0);
      expect(info.level).toBe(1);
      expect(info.title).toBe('Aprendiz');
      expect(info.progressPercent).toBe(0);
    });

    it('advances level as XP crosses thresholds', () => {
      expect(levelFromXp(100).level).toBe(2);
      expect(levelFromXp(260).level).toBe(3);
    });

    it('computes progress toward the next level', () => {
      // Level 2 spans 100..250 (150 XP). At 175 → 50% into level.
      const info = levelFromXp(175);
      expect(info.level).toBe(2);
      expect(info.progressPercent).toBe(50);
    });

    it('caps at the max level', () => {
      const info = levelFromXp(999_999);
      expect(info.isMaxLevel).toBe(true);
      expect(info.progressPercent).toBe(100);
    });

    it('treats negative/NaN XP as zero', () => {
      expect(levelFromXp(-50).level).toBe(1);
      expect(levelFromXp(NaN).level).toBe(1);
    });
  });

  describe('competencyLevel', () => {
    it('maps scores to qualitative levels', () => {
      expect(competencyLevel(90)).toBe('Experto');
      expect(competencyLevel(70)).toBe('Avanzado');
      expect(competencyLevel(50)).toBe('Competente');
      expect(competencyLevel(10)).toBe('Novato');
    });
  });

  describe('updateStreak', () => {
    it('initializes when no prior streak', () => {
      expect(updateStreak(undefined, '2026-06-08')).toEqual({ count: 1, lastActiveDate: '2026-06-08' });
    });

    it('is unchanged on the same day', () => {
      const prev = { count: 3, lastActiveDate: '2026-06-08' };
      expect(updateStreak(prev, '2026-06-08')).toBe(prev);
    });

    it('increments on a consecutive day', () => {
      expect(updateStreak({ count: 3, lastActiveDate: '2026-06-08' }, '2026-06-09'))
        .toEqual({ count: 4, lastActiveDate: '2026-06-09' });
    });

    it('resets after a gap', () => {
      expect(updateStreak({ count: 9, lastActiveDate: '2026-06-08' }, '2026-06-11'))
        .toEqual({ count: 1, lastActiveDate: '2026-06-11' });
    });
  });

  describe('dayKey', () => {
    it('formats a date as YYYY-MM-DD', () => {
      expect(dayKey(new Date('2026-01-05T10:00:00'))).toBe('2026-01-05');
    });
  });

  describe('generateVerificationCode', () => {
    it('produces an ARKY-prefixed code', () => {
      const code = generateVerificationCode();
      expect(code).toMatch(/^ARKY-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    });
  });

  it('exposes sane constants', () => {
    expect(QUIZ_PASS_PERCENT).toBe(70);
    expect(XP_REWARDS.courseCompleted).toBeGreaterThan(XP_REWARDS.lessonRead);
  });
});
