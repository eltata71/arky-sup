import React from 'react';
import { cn } from './cn';

export type SkeletonShape = 'rect' | 'text' | 'circle' | 'pill';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
    shape?: SkeletonShape;
    /** Quick width helper for inline text skeletons (e.g. "w-32"). */
    width?: string;
    /** Quick height helper for inline text skeletons (e.g. "h-3"). */
    height?: string;
    /** Number of stacked text lines when shape="text" (last line is narrower). */
    lines?: number;
}

const shapeStyles: Record<SkeletonShape, string> = {
    rect: 'rounded-md',
    text: 'rounded h-3',
    circle: 'rounded-full',
    pill: 'rounded-full h-6',
};

const SkeletonBlock: React.FC<{ className?: string }> = ({ className }) => (
    <div
        className={cn(
            'relative overflow-hidden bg-gray-200/80 dark:bg-gray-800/70',
            className,
        )}
        aria-hidden="true"
    >
        <div className="absolute inset-0 skeleton-shimmer" aria-hidden />
    </div>
);

/**
 * Building-block skeleton. Use to mock content while data/AI is loading.
 *
 * For multi-line text skeletons, set `shape="text"` and `lines`. The last
 * line renders shorter to mimic real paragraph rag.
 *
 * Accessibility: the component itself is aria-hidden — wrap a group of
 * skeletons in an element with role="status" + aria-busy + a localised
 * "Cargando…" label so assistive tech understands the loading state.
 */
export const Skeleton: React.FC<SkeletonProps> = ({
    shape = 'rect',
    width,
    height,
    lines,
    className,
    ...rest
}) => {
    if (shape === 'text' && lines && lines > 1) {
        return (
            <div className={cn('space-y-2', className)} {...rest} aria-hidden="true">
                {Array.from({ length: lines }).map((_, i) => {
                    const isLast = i === lines - 1;
                    return (
                        <SkeletonBlock
                            key={i}
                            className={cn(shapeStyles.text, isLast ? 'w-2/3' : 'w-full', height)}
                        />
                    );
                })}
            </div>
        );
    }

    return (
        <SkeletonBlock
            className={cn(shapeStyles[shape], width, height, className)}
            {...rest}
        />
    );
};

export interface SkeletonGroupProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Localised loading label announced to assistive tech. */
    label?: string;
    children: React.ReactNode;
}

/**
 * Wrap a group of skeletons with proper aria-busy + role="status" so screen
 * readers announce a single "loading" status instead of nothing.
 */
export const SkeletonGroup: React.FC<SkeletonGroupProps> = ({
    label = 'Cargando…',
    className,
    children,
    ...rest
}) => (
    <div
        role="status"
        aria-busy="true"
        aria-live="polite"
        className={className}
        {...rest}
    >
        <span className="sr-only">{label}</span>
        {children}
    </div>
);

export default Skeleton;
