import React from 'react';
import { motion } from 'motion/react';
import { MICRO } from '../../../lib/designTokens';
import useReducedMotion from '../../../hooks/useReducedMotion';

export interface AppearProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Animate the move when the list this item belongs to re-sorts (13.5 «reordenar»). */
  reorder?: boolean;
  children: React.ReactNode;
}

/**
 * Content arriving (13.5 «aparecer»): a fade and an 8 px rise, 180 ms, once on
 * mount. With `reorder`, a re-sorted list slides its items to their new place
 * instead of jumping. Reduced motion: neither.
 */
export const Appear: React.FC<AppearProps> = ({ reorder = false, children, className, ...rest }) => {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className} {...rest}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={MICRO.appear.initial}
      animate={MICRO.appear.animate}
      transition={MICRO.appear.transition}
      layout={reorder ? 'position' : undefined}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </motion.div>
  );
};

export default Appear;
