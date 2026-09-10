import React from 'react';
import { cn } from './cn';

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
    children: React.ReactNode;
}

/**
 * `<Kbd>⌘K</Kbd>` — renders a keyboard shortcut chip.  Auto-substitutes the
 * platform-correct symbol when children is the literal string 'mod' or 'cmd'.
 */
export const Kbd: React.FC<KbdProps> = ({ className, children, ...rest }) => {
    return (
        <kbd
            className={cn(
                'inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5',
                'rounded border border-gray-300 dark:border-gray-700',
                'bg-gray-50 dark:bg-gray-800/50',
                'text-2xs font-medium text-gray-600 dark:text-gray-300',
                'font-mono leading-none',
                className,
            )}
            {...rest}
        >
            {children}
        </kbd>
    );
};

/** Detect if the user is on macOS — used to render ⌘ vs Ctrl shortcuts. */
export function isMac(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
}

export const ModKey: React.FC = () => {
    return <Kbd>{isMac() ? '⌘' : 'Ctrl'}</Kbd>;
};

export default Kbd;
