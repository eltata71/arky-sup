import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './cn';

export interface DropdownItem {
    id?: string;
    label: React.ReactNode;
    description?: React.ReactNode;
    icon?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    danger?: boolean;
    active?: boolean;
    trailing?: React.ReactNode;
}

export interface DropdownSection {
    label?: string;
    items: DropdownItem[];
}

export interface DropdownProps {
    trigger: (state: { open: boolean; toggle: () => void }) => React.ReactNode;
    sections?: DropdownSection[];
    items?: DropdownItem[];
    align?: 'left' | 'right' | 'center';
    direction?: 'up' | 'down';
    width?: 'auto' | 'sm' | 'md' | 'lg';
    className?: string;
    menuClassName?: string;
    'aria-label'?: string;
}

const WIDTH_CLASS: Record<NonNullable<DropdownProps['width']>, string> = {
    auto: 'min-w-[12rem]',
    sm: 'w-52',
    md: 'w-64',
    lg: 'w-72',
};

export const Dropdown: React.FC<DropdownProps> = ({
    trigger,
    sections,
    items,
    align = 'right',
    direction = 'up',
    width = 'md',
    className,
    menuClassName,
    ...rest
}) => {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const close = useCallback(() => setOpen(false), []);
    const toggle = useCallback(() => setOpen((v) => !v), []);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, close]);

    const resolvedSections: DropdownSection[] = sections ?? (items ? [{ items }] : []);

    const alignClass = align === 'right' ? 'right-0' : align === 'left' ? 'left-0' : 'left-1/2 -translate-x-1/2';
    const directionClass = direction === 'up' ? 'bottom-full mb-2' : 'top-full mt-2';
    const motionFrom = direction === 'up' ? { y: 6, opacity: 0 } : { y: -6, opacity: 0 };

    return (
        <div ref={containerRef} className={cn('relative inline-flex', className)}>
            {trigger({ open, toggle })}
            <AnimatePresence>
                {open && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={close} aria-hidden="true" />
                        <motion.div
                            role="menu"
                            aria-label={rest['aria-label']}
                            initial={motionFrom}
                            animate={{ y: 0, opacity: 1 }}
                            exit={motionFrom}
                            transition={{ duration: 0.14, ease: 'easeOut' }}
                            className={cn(
                                'absolute z-50',
                                alignClass,
                                directionClass,
                                WIDTH_CLASS[width],
                                'rounded-xl border border-gray-200 dark:border-gray-700/80',
                                'bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl',
                                'shadow-2xl shadow-black/10 dark:shadow-black/40',
                                'py-1.5 origin-bottom',
                                menuClassName,
                            )}
                        >
                            {resolvedSections.map((section, sIdx) => (
                                <div key={sIdx} className={cn(sIdx > 0 && 'mt-1 pt-1 border-t border-gray-100 dark:border-gray-800')}>
                                    {section.label && (
                                        <div className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                                            {section.label}
                                        </div>
                                    )}
                                    <div className="px-1">
                                    {section.items.map((item, iIdx) => (
                                        <button
                                            key={item.id ?? iIdx}
                                            type="button"
                                            role="menuitem"
                                            disabled={item.disabled}
                                            onClick={() => {
                                                if (item.disabled) return;
                                                item.onClick?.();
                                                close();
                                            }}
                                            className={cn(
                                                'w-full flex items-center gap-2.5 px-2.5 py-2 text-left text-sm rounded-md',
                                                'transition-colors duration-100',
                                                item.disabled
                                                    ? 'opacity-40 cursor-not-allowed text-gray-500'
                                                    : item.danger
                                                        ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10'
                                                        : item.active
                                                            ? 'bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300'
                                                            : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800',
                                            )}
                                        >
                                            {item.icon && (
                                                <span className={cn('flex items-center justify-center w-4 h-4 flex-shrink-0', item.active ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400')}>
                                                    {item.icon}
                                                </span>
                                            )}
                                            <span className="flex-1 min-w-0">
                                                <span className="block truncate font-medium">{item.label}</span>
                                                {item.description && (
                                                    <span className="block text-xs text-gray-500 dark:text-gray-400 truncate font-normal">
                                                        {item.description}
                                                    </span>
                                                )}
                                            </span>
                                            {item.trailing && (
                                                <span className="flex items-center text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                                                    {item.trailing}
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                    </div>
                                </div>
                            ))}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
};

export default Dropdown;
