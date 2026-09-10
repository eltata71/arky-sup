import React from 'react';
import { cn } from './cn';

export interface SegmentedOption<T extends string> {
    value: T;
    label: React.ReactNode;
    icon?: React.ReactNode;
    description?: string;
}

export interface SegmentedControlProps<T extends string> {
    options: SegmentedOption<T>[];
    value: T;
    onChange: (value: T) => void;
    size?: 'sm' | 'md';
    className?: string;
    'aria-label'?: string;
}

/**
 * Pill-style segmented control.  Useful for Audience switcher, tabs etc.
 * Generic over the option value to keep the API type-safe.
 */
export function SegmentedControl<T extends string>({
    options,
    value,
    onChange,
    size = 'md',
    className,
    ...rest
}: SegmentedControlProps<T>) {
    const sizeStyles = size === 'sm' ? 'h-8 text-xs' : 'h-10 text-sm';
    return (
        <div
            role="tablist"
            aria-label={rest['aria-label']}
            className={cn(
                'inline-flex items-center bg-gray-100 dark:bg-gray-800/60 p-1 rounded-xl border border-gray-200 dark:border-gray-700/60',
                className,
            )}
        >
            {options.map((opt) => {
                const isActive = opt.value === value;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        title={opt.description}
                        onClick={() => onChange(opt.value)}
                        className={cn(
                            'inline-flex items-center justify-center gap-2 px-3 rounded-lg font-medium',
                            'transition-all duration-200 ease-out',
                            sizeStyles,
                            isActive
                                ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm'
                                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100',
                        )}
                    >
                        {opt.icon}
                        <span>{opt.label}</span>
                    </button>
                );
            })}
        </div>
    );
}

export default SegmentedControl;
