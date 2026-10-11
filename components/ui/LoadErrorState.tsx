import React from 'react';
import { cn } from './cn';

export interface LoadErrorStateProps {
    title: string;
    description?: string;
    /** The cause as the system reported it; shown smaller, under the explanation. */
    detail?: string;
    retryLabel: string;
    onRetry: () => void;
    diagnoseLabel?: string;
    onDiagnose?: () => void;
    retrying?: boolean;
    className?: string;
}

/**
 * A view that could not load (13.4). It says so, and it always offers the next
 * thing to do: try again, or open the diagnosis. The one thing it must never be
 * is an empty state — «no hay proyectos» over a failed read tells someone their
 * work is gone.
 */
export const LoadErrorState: React.FC<LoadErrorStateProps> = ({
    title,
    description,
    detail,
    retryLabel,
    onRetry,
    diagnoseLabel,
    onDiagnose,
    retrying = false,
    className,
}) => (
    <div
        role="alert"
        className={cn(
            'flex flex-col items-center justify-center text-center px-6 py-12 rounded-2xl border border-danger-200 bg-danger-50/60 dark:border-danger-900/60 dark:bg-danger-900/20',
            className,
        )}
    >
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">{title}</h3>
        {description && <p className="text-sm text-gray-600 dark:text-gray-300 max-w-md leading-relaxed">{description}</p>}
        {detail && <p className="mt-2 max-w-md text-xs text-gray-500 dark:text-gray-400 break-words">{detail}</p>}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <button
                type="button"
                onClick={onRetry}
                disabled={retrying}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60"
            >
                {retryLabel}
            </button>
            {onDiagnose && diagnoseLabel && (
                <button
                    type="button"
                    onClick={onDiagnose}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900"
                >
                    {diagnoseLabel}
                </button>
            )}
        </div>
    </div>
);

export default LoadErrorState;
