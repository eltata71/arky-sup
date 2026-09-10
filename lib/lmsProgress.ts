/**
 * Pure helpers for LMS assessment, gamification and adaptive learning.
 *
 * Kept free of React/Firestore so they can be unit-tested in isolation and
 * reused by context, services and views without side effects.
 */
import type { CompetencyLevel, StreakState } from '../types/lms';

/** A quiz (or course) is considered passed at or above this percentage. */
export const QUIZ_PASS_PERCENT = 70;

/** XP rewards per learning action. */
export const XP_REWARDS = {
  lessonRead: 10,
  quizPassed: 25,
  courseCompleted: 100,
  diagnosticCompleted: 30,
} as const;

/** XP required to reach each level (index = level - 1). */
const LEVEL_THRESHOLDS = [0, 100, 250, 500, 900, 1400, 2100, 3000, 4200, 6000];

export interface LevelInfo {
  level: number;
  title: string;
  /** XP accumulated within the current level. */
  xpIntoLevel: number;
  /** XP span of the current level (Infinity at max level). */
  xpForLevel: number;
  /** 0-100 progress toward the next level. */
  progressPercent: number;
  /** True when the learner reached the highest defined level. */
  isMaxLevel: boolean;
}

const LEVEL_TITLES = [
  'Aprendiz', 'Practicante', 'Asociado', 'Arquitecto Jr.', 'Arquitecto',
  'Arquitecto Sr.', 'Arquitecto Líder', 'Principal', 'Distinguido', 'Maestro Arquitecto',
];

/** Resolves the level metadata for a given XP total. */
export function levelFromXp(xp: number): LevelInfo {
  const safeXp = Math.max(0, Math.floor(xp || 0));
  let level = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (safeXp >= LEVEL_THRESHOLDS[i]) level = i + 1;
  }
  const isMaxLevel = level >= LEVEL_THRESHOLDS.length;
  const currentThreshold = LEVEL_THRESHOLDS[level - 1];
  const nextThreshold = isMaxLevel ? currentThreshold : LEVEL_THRESHOLDS[level];
  const xpIntoLevel = safeXp - currentThreshold;
  const xpForLevel = isMaxLevel ? Infinity : nextThreshold - currentThreshold;
  const progressPercent = isMaxLevel ? 100 : Math.min(100, Math.round((xpIntoLevel / xpForLevel) * 100));
  return {
    level,
    title: LEVEL_TITLES[level - 1] ?? `Nivel ${level}`,
    xpIntoLevel,
    xpForLevel,
    progressPercent,
    isMaxLevel,
  };
}

/** Maps a 0-100 competency score to a qualitative level. */
export function competencyLevel(score: number): CompetencyLevel {
  if (score >= 85) return 'Experto';
  if (score >= 65) return 'Avanzado';
  if (score >= 40) return 'Competente';
  return 'Novato';
}

/** Local calendar day key (YYYY-MM-DD) for streak bookkeeping. */
export function dayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Difference in whole calendar days between two YYYY-MM-DD keys. */
function dayDiff(fromKey: string, toKey: string): number {
  const from = new Date(`${fromKey}T00:00:00`);
  const to = new Date(`${toKey}T00:00:00`);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Advances a streak given the current day. Same day → unchanged; consecutive
 * day → +1; any gap → resets to 1.
 */
export function updateStreak(prev: StreakState | undefined, today: string = dayKey()): StreakState {
  if (!prev || !prev.lastActiveDate) return { count: 1, lastActiveDate: today };
  if (prev.lastActiveDate === today) return prev;
  const diff = dayDiff(prev.lastActiveDate, today);
  if (diff === 1) return { count: prev.count + 1, lastActiveDate: today };
  return { count: 1, lastActiveDate: today };
}

/** Generates a short, human-readable certificate verification code. */
export function generateVerificationCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `ARKY-${block()}-${block()}`;
}
