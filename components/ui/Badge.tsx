import React from 'react';
import { cn } from './cn';

export type BadgeTone =
    | 'gray'
    | 'primary'
    | 'success'
    | 'warning'
    | 'danger'
    | 'info'
    | 'ai'
    | 'audience-exec'
    | 'audience-tech'
    | 'audience-ops';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
    tone?: BadgeTone;
    size?: 'xs' | 'sm';
    /** Show a leading dot indicator. */
    dot?: boolean;
    /** Outlined variant — softer for dense surfaces. */
    outline?: boolean;
}

const tones: Record<BadgeTone, { solid: string; outline: string; dot: string }> = {
    gray:    { solid: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300', outline: 'border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300', dot: 'bg-gray-400' },
    primary: { solid: 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300', outline: 'border-primary-300 text-primary-700 dark:border-primary-700 dark:text-primary-300', dot: 'bg-primary-500' },
    success: { solid: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300', outline: 'border-green-300 text-green-700 dark:border-green-700 dark:text-green-300', dot: 'bg-green-500' },
    warning: { solid: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', outline: 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
    danger:  { solid: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', outline: 'border-red-300 text-red-700 dark:border-red-700 dark:text-red-300', dot: 'bg-red-500' },
    info:    { solid: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', outline: 'border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300', dot: 'bg-blue-500' },
    ai:      { solid: 'bg-ai-100 text-ai-700 dark:bg-ai-900/40 dark:text-ai-300', outline: 'border-ai-300 text-ai-700 dark:border-ai-700 dark:text-ai-300', dot: 'bg-ai-500' },
    'audience-exec': { solid: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300', outline: 'border-sky-300 text-sky-700 dark:border-sky-700 dark:text-sky-300', dot: 'bg-sky-500' },
    'audience-tech': { solid: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300', outline: 'border-indigo-300 text-indigo-700 dark:border-indigo-700 dark:text-indigo-300', dot: 'bg-indigo-500' },
    'audience-ops':  { solid: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', outline: 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
};

const sizes = {
    xs: 'h-5 px-1.5 text-[10px] gap-1 rounded',
    sm: 'h-6 px-2 text-xs gap-1 rounded-md',
};

export const Badge: React.FC<BadgeProps> = ({
    tone = 'gray',
    size = 'sm',
    dot = false,
    outline = false,
    className,
    children,
    ...rest
}) => {
    const palette = tones[tone];
    return (
        <span
            className={cn(
                'inline-flex items-center font-medium tracking-tight whitespace-nowrap',
                outline ? cn('border bg-transparent', palette.outline) : palette.solid,
                sizes[size],
                className,
            )}
            {...rest}
        >
            {dot && <span className={cn('h-1.5 w-1.5 rounded-full', palette.dot)} aria-hidden />}
            {children}
        </span>
    );
};

export default Badge;
