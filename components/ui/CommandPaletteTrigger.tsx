import React from 'react';
import { useCommandPalette } from '../../context/CommandPaletteContext';
import { MagnifyingGlassIcon } from '../Icons';
import { Kbd, isMac } from './Kbd';
import { cn } from './cn';

export interface CommandPaletteTriggerProps {
    /** Compact icon-only trigger for tight spaces (icons rail). */
    compact?: boolean;
    className?: string;
}

/**
 * The "press ⌘K to search" affordance shown across the app.  Wraps the global
 * command palette so any header, sidebar, or empty state can surface it.
 */
export const CommandPaletteTrigger: React.FC<CommandPaletteTriggerProps> = ({ compact = false, className }) => {
    const { setOpen } = useCommandPalette();

    if (compact) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label="Abrir paleta de comandos"
                className={cn(
                    'inline-flex items-center justify-center h-9 w-9 rounded-lg',
                    'border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900',
                    'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white',
                    'hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shadow-sm',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                    className,
                )}
            >
                <MagnifyingGlassIcon className="h-4 w-4" />
            </button>
        );
    }

    return (
        <button
            type="button"
            onClick={() => setOpen(true)}
            className={cn(
                'group inline-flex items-center gap-2 h-9 pl-3 pr-1.5 rounded-lg',
                'border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900',
                'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white',
                'hover:border-primary-300 dark:hover:border-primary-700 transition-colors shadow-sm',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                className,
            )}
            aria-label="Abrir paleta de comandos"
        >
            <MagnifyingGlassIcon className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm flex-1 text-left">Comandos, IA o navegación…</span>
            <span className="hidden sm:flex items-center gap-0.5 ml-2">
                <Kbd>{isMac() ? '⌘' : 'Ctrl'}</Kbd>
                <Kbd>K</Kbd>
            </span>
        </button>
    );
};

export default CommandPaletteTrigger;
