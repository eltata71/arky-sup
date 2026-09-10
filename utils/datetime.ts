/**
 * Centralized date & time formatting for artifact metadata.
 *
 * The artifact data model stores dates as ISO strings, but legacy/remote
 * records may surface a `Date`, an epoch number, or a partial/invalid value.
 * Every helper here coerces defensively and falls back to a stable label so a
 * malformed date can never crash a render.
 */

/** Locale used across the product for artifact metadata. Spanish-first. */
const DATE_LOCALE = 'es-ES';

/** Stable label rendered when a date is missing or cannot be parsed. */
export const DATE_FALLBACK = 'Sin fecha';

/** A value that may carry date information from any persistence layer. */
export type DateLike = string | number | Date | null | undefined;

/**
 * Coerces an unknown date-like value into a valid `Date`, or `null` when the
 * value is missing or cannot be parsed. Never throws.
 */
export function toValidDate(value: DateLike): Date | null {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const fromString = new Date(trimmed);
    return Number.isNaN(fromString.getTime()) ? null : fromString;
  }

  return null;
}

/**
 * Formats a date with both calendar date and clock time, e.g.
 * `19 may 2026, 11:59 a. m.`. Returns `fallback` for missing/invalid values.
 */
export function formatDateTime(value: DateLike, fallback: string = DATE_FALLBACK): string {
  const date = toValidDate(value);
  if (!date) return fallback;

  return date.toLocaleString(DATE_LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Formats the calendar date only, e.g. `19 may 2026`.
 * Returns `fallback` for missing/invalid values.
 */
export function formatDate(value: DateLike, fallback: string = DATE_FALLBACK): string {
  const date = toValidDate(value);
  if (!date) return fallback;

  return date.toLocaleDateString(DATE_LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Formats the clock time only, e.g. `11:59 a. m.`.
 * Returns `fallback` for missing/invalid values.
 */
export function formatTime(value: DateLike, fallback: string = DATE_FALLBACK): string {
  const date = toValidDate(value);
  if (!date) return fallback;

  return date.toLocaleTimeString(DATE_LOCALE, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Produces a short relative label ("hace 5 min", "hace 3 h", "hace 2 d") for
 * recent activity, and falls back to an absolute date for older timestamps.
 * Returns `fallback` for missing/invalid values.
 */
export function formatRelativeDateTime(
  value: DateLike,
  fallback: string = DATE_FALLBACK,
  now: Date = new Date(),
): string {
  const date = toValidDate(value);
  if (!date) return fallback;

  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return formatDateTime(date, fallback);

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} d`;

  return formatDate(date, fallback);
}
