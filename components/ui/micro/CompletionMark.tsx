import React from 'react';
import { motion } from 'motion/react';
import { MICRO } from '../../../lib/designTokens';
import useReducedMotion from '../../../hooks/useReducedMotion';
import { cn } from '../cn';
import { useJustHappened } from './useJustHappened';

export interface CompletionMarkProps {
  /** The thing is done: a generation finished, a charter approved. */
  done: boolean;
  /** What was completed, for assistive technology. */
  label: string;
  className?: string;
}

/**
 * A check that draws itself, 400 ms (13.5 «completar») — but only when `done`
 * becomes true while the screen is open. Already done on arrival, or with
 * reduced motion, it is simply there. It never repeats.
 */
export const CompletionMark: React.FC<CompletionMarkProps> = ({ done, label, className }) => {
  const reduced = useReducedMotion();
  const just = useJustHappened(done);
  if (!done) return null;
  const draw = just && !reduced;
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
      data-animated={draw ? 'true' : 'false'}
      className={cn('h-5 w-5 text-success-600', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" className="opacity-25" />
      {draw ? (
        <motion.path d="M7 12.5l3.2 3.2L17 9" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={MICRO.complete} />
      ) : (
        <path d="M7 12.5l3.2 3.2L17 9" />
      )}
    </svg>
  );
};

export default CompletionMark;
