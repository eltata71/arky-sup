import React from 'react';
import { cn } from './cn';

export type CardTone = 'default' | 'muted' | 'gradient' | 'ai' | 'audience-exec' | 'audience-tech' | 'audience-ops';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Visual tone of the card surface. */
    tone?: CardTone;
    /** Make the card behave like a button (cursor + hover lift). */
    interactive?: boolean;
    /** Tighten the default padding. */
    compact?: boolean;
    /** Render as a different element (e.g. 'button' for clickable cards). */
    as?: 'div' | 'section' | 'article' | 'button' | 'a';
}

const toneStyles: Record<CardTone, string> = {
    default: 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800',
    muted: 'bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800',
    gradient: 'bg-gradient-to-br from-primary-50 via-white to-indigo-50 dark:from-primary-950/40 dark:via-gray-900 dark:to-indigo-950/40 border border-primary-200/70 dark:border-primary-900/60',
    ai: 'relative overflow-hidden bg-gradient-to-br from-ai-50/80 via-white to-primary-50/80 dark:from-ai-950/50 dark:via-gray-900 dark:to-primary-950/50 border border-ai-200/60 dark:border-ai-900/40',
    'audience-exec': 'bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900/50',
    'audience-tech': 'bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50',
    'audience-ops': 'bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50',
};

export const Card: React.FC<CardProps> = ({
    tone = 'default',
    interactive = false,
    compact = false,
    as = 'div',
    className,
    children,
    ...rest
}) => {
    const Component = as as React.ElementType;
    return (
        <Component
            className={cn(
                'rounded-2xl shadow-sm transition-all duration-200',
                compact ? 'p-4' : 'p-5 md:p-6',
                interactive && 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 active:scale-[0.99] hover:border-primary-300 dark:hover:border-primary-700',
                toneStyles[tone],
                className,
            )}
            {...rest}
        >
            {children}
        </Component>
    );
};

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
    <div className={cn('flex items-start justify-between gap-3 mb-3', className)} {...rest} />
);

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({ className, ...rest }) => (
    <h3 className={cn('font-semibold text-gray-900 dark:text-white text-base leading-tight tracking-tight', className)} {...rest} />
);

export const CardDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({ className, ...rest }) => (
    <p className={cn('text-sm text-gray-500 dark:text-gray-400 leading-relaxed', className)} {...rest} />
);

export const CardFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
    <div className={cn('mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between', className)} {...rest} />
);

export const CardEyebrow: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
    <div className={cn('text-2xs uppercase tracking-widest-2 font-semibold text-gray-500 dark:text-gray-400', className)} {...rest} />
);

export default Card;
