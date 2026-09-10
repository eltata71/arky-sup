import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './cn';

type Side = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
    label: React.ReactNode;
    children: React.ReactElement;
    side?: Side;
    /** Show after this many ms of hover (default 350). */
    delay?: number;
    className?: string;
}

/**
 * Lightweight tooltip — uses CSS transforms (no portal) and motion for fade.
 * Wraps a single child element via cloneElement so handlers compose with whatever
 * the caller already has.
 */
export const Tooltip: React.FC<TooltipProps> = ({ label, children, side = 'top', delay = 350, className }) => {
    const [open, setOpen] = useState(false);
    const timeoutRef = useRef<number | null>(null);

    const cancel = () => {
        if (timeoutRef.current !== null) {
            window.clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
    };

    const onEnter = useCallback(() => {
        cancel();
        timeoutRef.current = window.setTimeout(() => setOpen(true), delay);
    }, [delay]);

    const onLeave = useCallback(() => {
        cancel();
        setOpen(false);
    }, []);

    useEffect(() => () => cancel(), []);

    const sideClasses: Record<Side, string> = {
        top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
        bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
        left: 'right-full top-1/2 -translate-y-1/2 mr-2',
        right: 'left-full top-1/2 -translate-y-1/2 ml-2',
    };

    const Trigger = React.cloneElement(children, {
        onMouseEnter: (e: React.MouseEvent) => {
            children.props.onMouseEnter?.(e);
            onEnter();
        },
        onMouseLeave: (e: React.MouseEvent) => {
            children.props.onMouseLeave?.(e);
            onLeave();
        },
        onFocus: (e: React.FocusEvent) => {
            children.props.onFocus?.(e);
            onEnter();
        },
        onBlur: (e: React.FocusEvent) => {
            children.props.onBlur?.(e);
            onLeave();
        },
    });

    return (
        <span className="relative inline-flex">
            {Trigger}
            <AnimatePresence>
                {open && (
                    <motion.span
                        /*
                         * Visual only. The trigger already carries this text as
                         * its accessible name, so announcing the bubble too
                         * would say it twice — the defect VoiceOver users hit
                         * across the whole rail. See rule 2 in `lib/a11y.ts`.
                         */
                        aria-hidden
                        initial={{ opacity: 0, scale: 0.95, y: side === 'top' ? 4 : -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: side === 'top' ? 4 : -4 }}
                        transition={{ duration: 0.15, ease: 'easeOut' }}
                        className={cn(
                            'absolute z-[1000] px-2 py-1 rounded-md whitespace-nowrap pointer-events-none',
                            'bg-gray-900 text-white text-xs font-medium shadow-lg',
                            'dark:bg-gray-100 dark:text-gray-900',
                            sideClasses[side],
                            className,
                        )}
                    >
                        {label}
                    </motion.span>
                )}
            </AnimatePresence>
        </span>
    );
};

export default Tooltip;
