import { describe, it, expect } from 'vitest';
import {
  toValidDate,
  formatDate,
  formatDateTime,
  formatTime,
  formatRelativeDateTime,
  DATE_FALLBACK,
} from '../../utils/datetime';

describe('toValidDate', () => {
  it('returns null for missing or empty values', () => {
    expect(toValidDate(null)).toBeNull();
    expect(toValidDate(undefined)).toBeNull();
    expect(toValidDate('')).toBeNull();
    expect(toValidDate('   ')).toBeNull();
  });

  it('returns null for unparseable strings and invalid dates', () => {
    expect(toValidDate('not-a-date')).toBeNull();
    expect(toValidDate(new Date('invalid'))).toBeNull();
    expect(toValidDate(Number.NaN)).toBeNull();
  });

  it('parses ISO strings, Date objects and epoch numbers', () => {
    const iso = '2026-05-19T11:59:00.000Z';
    expect(toValidDate(iso)?.toISOString()).toBe(iso);

    const date = new Date(iso);
    expect(toValidDate(date)).toBe(date);

    expect(toValidDate(date.getTime())?.toISOString()).toBe(iso);
  });
});

describe('formatDate / formatDateTime / formatTime', () => {
  it('falls back for invalid input', () => {
    expect(formatDate(null)).toBe(DATE_FALLBACK);
    expect(formatDateTime('garbage')).toBe(DATE_FALLBACK);
    expect(formatTime(undefined)).toBe(DATE_FALLBACK);
    expect(formatDate(null, 'N/D')).toBe('N/D');
  });

  it('formats a valid date with the year present', () => {
    const value = '2026-05-19T15:30:00.000Z';
    expect(formatDate(value)).toContain('2026');
  });

  it('formatDateTime includes a time component', () => {
    const value = '2026-05-19T15:30:00.000Z';
    const out = formatDateTime(value);
    expect(out).toContain('2026');
    expect(out).toMatch(/\d{1,2}:\d{2}/);
  });

  it('formatTime renders only a clock time', () => {
    const out = formatTime('2026-05-19T15:30:00.000Z');
    expect(out).toMatch(/\d{1,2}:\d{2}/);
    expect(out).not.toContain('2026');
  });
});

describe('formatRelativeDateTime', () => {
  const now = new Date('2026-05-19T12:00:00.000Z');

  it('falls back for invalid input', () => {
    expect(formatRelativeDateTime(null, DATE_FALLBACK, now)).toBe(DATE_FALLBACK);
  });

  it('labels very recent activity', () => {
    const value = new Date(now.getTime() - 30_000); // 30s ago
    expect(formatRelativeDateTime(value, DATE_FALLBACK, now)).toBe('hace un momento');
  });

  it('labels minutes, hours and days', () => {
    expect(formatRelativeDateTime(new Date(now.getTime() - 5 * 60_000), DATE_FALLBACK, now)).toBe('hace 5 min');
    expect(formatRelativeDateTime(new Date(now.getTime() - 3 * 3_600_000), DATE_FALLBACK, now)).toBe('hace 3 h');
    expect(formatRelativeDateTime(new Date(now.getTime() - 2 * 86_400_000), DATE_FALLBACK, now)).toBe('hace 2 d');
  });

  it('falls back to an absolute date for older timestamps', () => {
    const value = new Date(now.getTime() - 30 * 86_400_000);
    expect(formatRelativeDateTime(value, DATE_FALLBACK, now)).toContain('2026');
  });

  it('renders an absolute datetime for future timestamps', () => {
    const value = new Date(now.getTime() + 86_400_000);
    expect(formatRelativeDateTime(value, DATE_FALLBACK, now)).toContain('2026');
  });
});
