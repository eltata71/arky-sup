import React from 'react';
import { cn } from './cn';
import {
    CheckCircleIcon,
    XCircleIcon,
    ExclamationTriangleIcon,
    InformationCircleIcon,
    LightBulbIcon,
    XMarkIcon,
} from '../Icons';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral' | 'ai';
export type AlertVariant = 'soft' | 'outline' | 'solid';

/**
 * `title` is deliberately re-declared, so the DOM attribute of the same name
 * is omitted from the base type rather than conflicting with it. They are
 * different things: this one is the alert's heading line, and the DOM one is
 * a tooltip that `lib/a11y` explains at length should not be set on an
 * element that already has an accessible name.
 */
export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
    tone?: AlertTone;
    variant?: AlertVariant;
    /** Heading line. Renders semantic <strong> within the alert. */
    title?: React.ReactNode;
    /** Replace the default icon. Pass null to suppress entirely. */
    icon?: React.ReactNode | null;
    /** Optional CTA buttons rendered below the description. */
    actions?: React.ReactNode;
    /** When provided, renders a close button that calls this handler. */
    onDismiss?: () => void;
    /** Aria-live politeness — default polite. Use 'assertive' for errors that block work. */
    live?: 'off' | 'polite' | 'assertive';
}

const toneIcons: Record<AlertTone, React.FC<{ className?: string }>> = {
    info: InformationCircleIcon,
    success: CheckCircleIcon,
    warning: ExclamationTriangleIcon,
    danger: XCircleIcon,
    neutral: InformationCircleIcon,
    ai: LightBulbIcon,
};

const toneStyles: Record<AlertTone, Record<AlertVariant, string>> = {
    info: {
        soft: 'bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950/40 dark:border-blue-800/60 dark:text-blue-100',
        outline: 'bg-transparent border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-200',
        solid: 'bg-blue-600 border-blue-600 text-white',
    },
    success: {
        soft: 'bg-green-50 border-green-200 text-green-900 dark:bg-green-950/40 dark:border-green-800/60 dark:text-green-100',
        outline: 'bg-transparent border-green-300 text-green-700 dark:border-green-700 dark:text-green-200',
        solid: 'bg-green-600 border-green-600 text-white',
    },
    warning: {
        soft: 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-100',
        outline: 'bg-transparent border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-200',
        solid: 'bg-amber-600 border-amber-600 text-white',
    },
    danger: {
        soft: 'bg-red-50 border-red-200 text-red-900 dark:bg-red-950/40 dark:border-red-800/60 dark:text-red-100',
        outline: 'bg-transparent border-red-300 text-red-700 dark:border-red-700 dark:text-red-200',
        solid: 'bg-red-600 border-red-600 text-white',
    },
    neutral: {
        soft: 'bg-gray-50 border-gray-200 text-gray-800 dark:bg-gray-900/60 dark:border-gray-700 dark:text-gray-100',
        outline: 'bg-transparent border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-200',
        solid: 'bg-gray-700 border-gray-700 text-white',
    },
    ai: {
        soft: 'bg-ai-50 border-ai-200 text-ai-900 dark:bg-ai-950/40 dark:border-ai-800/60 dark:text-ai-100',
        outline: 'bg-transparent border-ai-300 text-ai-700 dark:border-ai-700 dark:text-ai-200',
        solid: 'bg-ai-gradient border-transparent text-white',
    },
};

const iconTint: Record<AlertTone, string> = {
    info: 'text-blue-500 dark:text-blue-300',
    success: 'text-green-600 dark:text-green-300',
    warning: 'text-amber-600 dark:text-amber-300',
    danger: 'text-red-600 dark:text-red-300',
    neutral: 'text-gray-500 dark:text-gray-300',
    ai: 'text-ai-600 dark:text-ai-300',
};

/**
 * Static alert / banner. Use for inline messages that should NOT auto-dismiss
 * (errors, warnings, persistent status). For transient feedback, use Toast.
 *
 * Accessibility:
 *  - role="alert" is set automatically for danger; otherwise role="status".
 *  - Configurable aria-live politeness; defaults to polite.
 *  - Includes an optional close button with a localized aria-label.
 *  - Does not depend solely on color: every tone ships with a meaningful icon
 *    and an optional title.
 */
export const Alert: React.FC<AlertProps> = ({
    tone = 'info',
    variant = 'soft',
    title,
    icon,
    actions,
    onDismiss,
    live,
    className,
    children,
    ...rest
}) => {
    const Icon = toneIcons[tone];
    const isSolid = variant === 'solid';
    const role = tone === 'danger' ? 'alert' : 'status';
    const liveValue = live ?? (tone === 'danger' ? 'assertive' : 'polite');

    return (
        <div
            role={role}
            aria-live={liveValue}
            className={cn(
                'rounded-lg border p-3.5 flex items-start gap-3 text-sm',
                toneStyles[tone][variant],
                className,
            )}
            {...rest}
        >
            {icon === undefined ? (
                <Icon
                    className={cn(
                        'h-5 w-5 flex-shrink-0 mt-0.5',
                        isSolid ? 'text-white/90' : iconTint[tone],
                    )}
                    aria-hidden
                />
            ) : icon === null ? null : (
                <span className="flex-shrink-0 mt-0.5" aria-hidden>{icon}</span>
            )}
            <div className="flex-1 min-w-0">
                {title && (
                    <div className="font-semibold leading-snug mb-0.5">{title}</div>
                )}
                {children && <div className="leading-snug opacity-90">{children}</div>}
                {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
            </div>
            {onDismiss && (
                <button
                    type="button"
                    onClick={onDismiss}
                    aria-label="Descartar alerta"
                    className={cn(
                        'flex-shrink-0 -mr-1 -mt-1 p-1 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                        isSolid
                            ? 'text-white/80 hover:bg-white/10 hover:text-white'
                            : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10',
                    )}
                >
                    <XMarkIcon className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    );
};

export default Alert;
