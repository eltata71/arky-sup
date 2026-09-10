import React from 'react';
import { cn } from './cn';

export interface SpinnerProps {
    size?: 'xs' | 'sm' | 'md' | 'lg';
    /** Use the AI gradient instead of solid primary. */
    variant?: 'primary' | 'ai' | 'muted';
    className?: string;
    label?: string;
}

const sizes = {
    xs: 'h-3 w-3 border-2',
    sm: 'h-4 w-4 border-2',
    md: 'h-6 w-6 border-2',
    lg: 'h-10 w-10 border-[3px]',
};

const variants = {
    primary: 'border-primary-200 border-t-primary-600',
    ai: 'border-ai-200 border-t-ai-500',
    muted: 'border-gray-200 dark:border-gray-700 border-t-gray-500 dark:border-t-gray-300',
};

export const Spinner: React.FC<SpinnerProps> = ({ size = 'md', variant = 'primary', className, label }) => {
    return (
        <span
            role={label ? 'status' : 'presentation'}
            aria-label={label}
            className={cn('inline-flex items-center justify-center', className)}
        >
            <span
                className={cn(
                    'rounded-full animate-spin',
                    sizes[size],
                    variants[variant],
                )}
            />
            {label && <span className="sr-only">{label}</span>}
        </span>
    );
};

export default Spinner;
