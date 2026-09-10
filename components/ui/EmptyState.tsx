import React from 'react';
import { cn } from './cn';

export interface EmptyStateProps {
    icon?: React.ReactNode;
    title: string;
    description?: string;
    actions?: React.ReactNode;
    /** When true, render with the AI-tinted gradient surface. */
    flavor?: 'default' | 'ai';
    className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
    icon,
    title,
    description,
    actions,
    flavor = 'default',
    className,
}) => {
    return (
        <div
            className={cn(
                'flex flex-col items-center justify-center text-center px-6 py-12 rounded-2xl',
                flavor === 'ai'
                    ? 'bg-gradient-to-br from-ai-50/60 via-white to-primary-50/60 dark:from-ai-950/30 dark:via-gray-900 dark:to-primary-950/30 border border-ai-200/60 dark:border-ai-900/40'
                    : 'bg-gray-50/60 dark:bg-gray-900/40 border border-dashed border-gray-200 dark:border-gray-800',
                className,
            )}
        >
            {icon && (
                <div className={cn(
                    'inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4',
                    flavor === 'ai'
                        ? 'bg-ai-gradient text-white shadow-glow-ai'
                        : 'bg-white dark:bg-gray-900 text-gray-400 dark:text-gray-500 shadow-sm border border-gray-200 dark:border-gray-800',
                )}>
                    {icon}
                </div>
            )}
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">{title}</h3>
            {description && (
                <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md leading-relaxed">{description}</p>
            )}
            {actions && <div className="mt-5 flex items-center gap-2">{actions}</div>}
        </div>
    );
};

export default EmptyState;
