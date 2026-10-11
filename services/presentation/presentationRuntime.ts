/**
 * What the presentation mode decides, without React (12.4): how a KPI counts
 * up to its value, where the keyboard laser goes, and what the presenter's
 * clock reads. Each is a pure function so the rule is tested without timers
 * or a second window.
 */

/** A KPI value split around the one number it can count up to. */
export interface KpiCountTarget {
  prefix: string;
  value: number;
  suffix: string;
  decimals: number;
  /** Decimal separator as written: «98,5 %» keeps its comma. */
  decimalSeparator: '.' | ',';
}

/**
 * Reads the number a KPI states, or `null` when it states none or several.
 * «98,5 %», «$1.2M», «-12» and «4 semanas» count; «Q3 2026» and «3 de 5» do
 * not — counting one of two numbers would animate a figure the slide does not
 * mean. Thousands separators are not guessed: a value that needs them is
 * shown as written.
 */
export const parseKpiCountTarget = (raw: string): KpiCountTarget | null => {
  const text = raw.trim();
  const matches = text.match(/-?\d+(?:[.,]\d+)?/g);
  if (!matches || matches.length !== 1) return null;
  const literal = matches[0];
  const at = text.indexOf(literal);
  const separator = literal.includes(',') ? ',' : '.';
  const decimals = literal.includes(separator) ? literal.split(separator)[1].length : 0;
  const value = Number(literal.replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  return {
    prefix: text.slice(0, at),
    value,
    suffix: text.slice(at + literal.length),
    decimals,
    decimalSeparator: separator,
  };
};

/** Ease-out, so the count slows as it reaches the figure the audience reads. */
const easeOut = (t: number): number => 1 - (1 - t) ** 3;

/** The KPI as it reads at `progress` (0–1) of its count; 1 is the value as written. */
export const formatKpiAtProgress = (target: KpiCountTarget, progress: number): string => {
  const clamped = Math.min(1, Math.max(0, progress));
  const current = target.value * easeOut(clamped);
  let digits = current.toFixed(target.decimals);
  if (target.decimalSeparator === ',') digits = digits.replace('.', ',');
  return `${target.prefix}${digits}${target.suffix}`;
};

/** Laser position in percent of the slide, so it means the same on every screen. */
export interface LaserPosition { x: number; y: number }

export const LASER_STEP = 2;
export const LASER_COARSE_STEP = 8;

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

/**
 * Moves the laser for an arrow key, or returns `null` for any other key so
 * the caller can let it through. `Shift` takes the coarse step.
 */
export const moveLaser = (position: LaserPosition, key: string, coarse = false): LaserPosition | null => {
  const step = coarse ? LASER_COARSE_STEP : LASER_STEP;
  switch (key) {
    case 'ArrowLeft': return { ...position, x: clampPercent(position.x - step) };
    case 'ArrowRight': return { ...position, x: clampPercent(position.x + step) };
    case 'ArrowUp': return { ...position, y: clampPercent(position.y - step) };
    case 'ArrowDown': return { ...position, y: clampPercent(position.y + step) };
    default: return null;
  }
};

export const LASER_HOME: LaserPosition = { x: 50, y: 50 };

/** Elapsed presenting time as `m:ss`, or `h:mm:ss` past the hour. */
export const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
};
