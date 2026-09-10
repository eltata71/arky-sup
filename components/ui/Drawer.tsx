import React, { ReactNode, useEffect, useId } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { XMarkIcon } from '../Icons';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { cn } from './cn';

export type DrawerSide = 'right' | 'left' | 'bottom';
export type DrawerSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface DrawerProps {
    isOpen: boolean;
    onClose: () => void;
    title?: ReactNode;
    description?: string;
    side?: DrawerSide;
    size?: DrawerSize;
    /** Removes the default header so the consumer can supply their own. */
    hideHeader?: boolean;
    /** Footer pinned to the bottom of the drawer. */
    footer?: ReactNode;
    /** Optional extra classes for the panel surface. */
    className?: string;
    children: ReactNode;
    /** Aria-label override when title is not provided. */
    ariaLabel?: string;
}

const sizeMap: Record<DrawerSide, Record<DrawerSize, string>> = {
    right: {
        sm: 'w-full sm:max-w-sm',
        md: 'w-full sm:max-w-md',
        lg: 'w-full sm:max-w-lg lg:max-w-xl',
        xl: 'w-full sm:max-w-xl lg:max-w-2xl',
        full: 'w-full sm:max-w-3xl',
    },
    left: {
        sm: 'w-full sm:max-w-sm',
        md: 'w-full sm:max-w-md',
        lg: 'w-full sm:max-w-lg lg:max-w-xl',
        xl: 'w-full sm:max-w-xl lg:max-w-2xl',
        full: 'w-full sm:max-w-3xl',
    },
    bottom: {
        sm: 'w-full h-1/3',
        md: 'w-full h-1/2',
        lg: 'w-full h-2/3',
        xl: 'w-full h-3/4',
        full: 'w-full h-[92vh]',
    },
};

const positionMap: Record<DrawerSide, string> = {
    right: 'right-0 top-0 bottom-0',
    left: 'left-0 top-0 bottom-0',
    bottom: 'left-0 right-0 bottom-0',
};

const enterFrom: Record<DrawerSide, Record<string, number | string>> = {
    right: { x: '100%' },
    left: { x: '-100%' },
    bottom: { y: '100%' },
};

const enterTo: Record<DrawerSide, Record<string, number | string>> = {
    right: { x: 0 },
    left: { x: 0 },
    bottom: { y: 0 },
};

/**
 * Side-sheet drawer for contextual panels (properties, comments, history…).
 *
 * Accessibility:
 *  - role="dialog" with aria-modal and labelled by the title.
 *  - Focus trap with focus return on close.
 *  - Escape to close.
 *  - Touch targets >= 44px on the close button.
 */
export const Drawer: React.FC<DrawerProps> = ({
    isOpen,
    onClose,
    title,
    description,
    side = 'right',
    size = 'md',
    hideHeader = false,
    footer,
    className,
    children,
    ariaLabel,
}) => {
    const titleId = useId();
    const descriptionId = useId();
    const containerRef = useFocusTrap<HTMLDivElement>(isOpen);
    const reducedMotion = useReducedMotion();

    useEffect(() => {
        if (!isOpen) return;
        const handler = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen, onClose]);

    const cornerRadius = side === 'bottom' ? 'rounded-t-2xl' : '';

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100]">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-gray-900/50 backdrop-blur-[2px]"
                        onClick={onClose}
                        aria-hidden
                    />
                    <motion.div
                        ref={containerRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={title ? titleId : undefined}
                        aria-label={!title ? ariaLabel : undefined}
                        aria-describedby={description ? descriptionId : undefined}
                        initial={reducedMotion ? { opacity: 0 } : enterFrom[side]}
                        animate={reducedMotion ? { opacity: 1 } : enterTo[side]}
                        exit={reducedMotion ? { opacity: 0 } : enterFrom[side]}
                        transition={reducedMotion ? { duration: 0.12 } : { type: 'spring', damping: 28, stiffness: 320 }}
                        className={cn(
                            'fixed bg-white dark:bg-gray-900 shadow-pop ring-1 ring-gray-900/5 dark:ring-white/10 flex flex-col',
                            positionMap[side],
                            sizeMap[side][size],
                            cornerRadius,
                            className,
                        )}
                    >
                        {!hideHeader && (
                            <div className="flex-shrink-0 flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                                <div className="min-w-0">
                                    {title && (
                                        <h2 id={titleId} className="text-base font-semibold text-gray-900 dark:text-white leading-snug truncate">
                                            {title}
                                        </h2>
                                    )}
                                    {description && (
                                        <p id={descriptionId} className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{description}</p>
                                    )}
                                </div>
                                <button
                                    onClick={onClose}
                                    type="button"
                                    aria-label="Cerrar panel"
                                    className="flex-shrink-0 p-2 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 min-h-[44px] min-w-[44px] flex items-center justify-center"
                                >
                                    <XMarkIcon className="h-5 w-5" />
                                </button>
                            </div>
                        )}
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {children}
                        </div>
                        {footer && (
                            <div className="flex-shrink-0 border-t border-gray-100 dark:border-gray-800 px-5 py-3 bg-gray-50/60 dark:bg-gray-950/40">
                                {footer}
                            </div>
                        )}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default Drawer;
