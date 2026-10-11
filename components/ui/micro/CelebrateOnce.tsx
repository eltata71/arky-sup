import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { MICRO } from '../../../lib/designTokens';
import useReducedMotion from '../../../hooks/useReducedMotion';

const STORAGE_KEY = 'arky.celebrated.v1';
const MAX_REMEMBERED = 200;

const remembered = (): string[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

const remember = (id: string) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...remembered().filter((item) => item !== id), id].slice(-MAX_REMEMBERED)));
  } catch {
    /* a full or blocked storage only means it might celebrate again */
  }
};

/** Whether this id has had its celebration — exported for tests. */
export const hasCelebrated = (id: string): boolean => remembered().includes(id);

export interface CelebrateOnceProps {
  /** What is being celebrated — the package id. */
  id: string;
  /** The event happened: the package is published. */
  active: boolean;
  /** Said once, politely, when the celebration plays. */
  message: string;
}

/**
 * Celebrate once (13.5 «celebrar una vez»): when a package is published, a
 * single ring expands and fades behind a short sentence. Never again for the
 * same package — the id is remembered in this browser — and never confetti.
 * With reduced motion the sentence is announced and nothing moves.
 */
export const CelebrateOnce: React.FC<CelebrateOnceProps> = ({ id, active, message }) => {
  const reduced = useReducedMotion();
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!active || hasCelebrated(id)) return;
    remember(id);
    setPlaying(true);
  }, [active, id]);

  if (!playing) return null;
  return (
    <span role="status" className="relative inline-flex items-center gap-2 text-sm font-medium text-success-700 dark:text-success-500">
      {!reduced && (
        <motion.span
          aria-hidden="true"
          data-testid="celebrate-ring"
          className="absolute -left-1 h-6 w-6 rounded-full border-2 border-success-500"
          initial={{ scale: 0.6, opacity: 0.8 }}
          animate={{ scale: 2.2, opacity: 0 }}
          transition={MICRO.celebrate}
        />
      )}
      <span className="relative">{message}</span>
    </span>
  );
};

export default CelebrateOnce;
