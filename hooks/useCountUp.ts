import { useEffect, useMemo, useState } from 'react';
import { formatKpiAtProgress, parseKpiCountTarget } from '../services/presentation/presentationRuntime';

/** Long enough to read as a count, short enough that nobody waits for the figure. */
export const COUNT_UP_MS = 900;

/**
 * A KPI value counting up to what it says (12.4). Returns the value as written
 * when `animate` is off, when the user prefers reduced motion, or when the
 * value states no single number — never a half-counted figure left on screen.
 */
export function useCountUp(value: string, animate: boolean, reducedMotion: boolean): string {
  const target = useMemo(() => parseKpiCountTarget(value), [value]);
  const enabled = animate && !reducedMotion && target !== null;
  const [display, setDisplay] = useState(() => (enabled && target ? formatKpiAtProgress(target, 0) : value));

  useEffect(() => {
    if (!enabled || !target) {
      setDisplay(value);
      return undefined;
    }
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / COUNT_UP_MS);
      setDisplay(progress >= 1 ? value : formatKpiAtProgress(target, progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    setDisplay(formatKpiAtProgress(target, 0));
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled, target, value]);

  return display;
}
