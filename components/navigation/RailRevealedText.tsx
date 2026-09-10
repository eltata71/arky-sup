import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { DURATION_S, EASING } from '../../lib/designTokens';

/**
 * El texto que sólo existe cuando el raíl está abierto.
 *
 * Se desmonta en vez de ocultarse con CSS, y eso es deliberado: un nombre
 * presente en el DOM pero invisible lo sigue leyendo el lector de pantalla, y
 * el botón ya lleva ese mismo nombre en su `aria-label`. Sería la regla 1 de
 * `lib/a11y.ts` otra vez, con otra ropa.
 */
export const RailRevealedText: React.FC<{ show: boolean; reduced: boolean; children: React.ReactNode; className?: string }> = ({
    show, reduced, children, className,
}) => (
    <AnimatePresence initial={false}>
        {show && (
            <motion.span
                aria-hidden
                initial={reduced ? false : { opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, x: -6 }}
                transition={{ duration: DURATION_S.fast, ease: EASING.standard }}
                className={className}
            >
                {children}
            </motion.span>
        )}
    </AnimatePresence>
);

export default RailRevealedText;
