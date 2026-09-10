/**
 * Global command-palette context.
 *
 * Why a context: many surfaces (Workspace, ProjectHub, ArtifactCanvas) want to
 * expose contextual commands (e.g. "Generate diagram", "Switch audience to
 * executive") that should appear in the same Cmd+K palette.  Components can
 * register/deregister commands while mounted, and the palette renders the
 * union.
 *
 * Default behaviour: pressing Cmd/Ctrl+K opens it; Escape closes; arrow keys
 * navigate; Enter runs the selected command.  We keep state minimal — the
 * palette UI itself lives in `components/CommandPalette.tsx`.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export interface Command {
    id: string;
    /** Title shown in the palette. */
    title: string;
    /** Optional secondary description shown under the title. */
    subtitle?: string;
    /** Optional grouping header (e.g. "Navegación", "IA", "Audiencia"). */
    section?: string;
    /** Optional keyword list to widen fuzzy matching beyond the title. */
    keywords?: string[];
    /** Optional keyboard shortcut display (e.g. "G then P"). */
    shortcut?: string;
    /** Icon to render to the left. */
    icon?: React.ReactNode;
    /** When the command is AI-driven, render with the AI tint. */
    flavor?: 'default' | 'ai' | 'storytelling';
    /** Disabled commands stay visible but unselectable — used for hints. */
    disabled?: boolean;
    /** Run the command — palette will close after this resolves. */
    run: () => void | Promise<void>;
}

interface CommandPaletteContextValue {
    open: boolean;
    setOpen: (open: boolean) => void;
    toggle: () => void;
    commands: Command[];
    register: (commands: Command[]) => () => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export const CommandPaletteProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [open, setOpen] = useState(false);
    // We keep one map per registration call so unmounting only removes the set
    // of commands that source registered.  Otherwise re-renders that pass new
    // arrays would wipe earlier registrations.
    const groupsRef = useRef<Map<symbol, Command[]>>(new Map());
    const [tick, setTick] = useState(0);

    const register = useCallback((commands: Command[]) => {
        const key = Symbol('cmd-group');
        groupsRef.current.set(key, commands);
        setTick((t) => t + 1);
        return () => {
            groupsRef.current.delete(key);
            setTick((t) => t + 1);
        };
    }, []);

    const commands = useMemo<Command[]>(() => {
        // Registrations live in a ref so a screen can register and unregister
        // without re-rendering every consumer; `tick` is the only signal that
        // the ref changed, so it is read here as well as listed as the
        // dependency — otherwise the flattening never re-runs.
        void tick;
        const flat: Command[] = [];
        groupsRef.current.forEach((group) => {
            for (const c of group) flat.push(c);
        });
        return flat;
    }, [tick]);

    const toggle = useCallback(() => setOpen((v) => !v), []);

    // Global Cmd/Ctrl+K listener
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            const isMod = event.metaKey || event.ctrlKey;
            if (isMod && (event.key === 'k' || event.key === 'K')) {
                event.preventDefault();
                toggle();
            } else if (event.key === 'Escape' && open) {
                setOpen(false);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, toggle]);

    const value = useMemo<CommandPaletteContextValue>(() => ({
        open, setOpen, toggle, commands, register,
    }), [open, toggle, commands, register]);

    return (
        <CommandPaletteContext.Provider value={value}>
            {children}
        </CommandPaletteContext.Provider>
    );
};

export function useCommandPalette(): CommandPaletteContextValue {
    const ctx = useContext(CommandPaletteContext);
    if (!ctx) throw new Error('useCommandPalette must be used within CommandPaletteProvider');
    return ctx;
}

/**
 * Convenience hook: register a static set of commands for the lifetime of the
 * caller.  Pass a stable array (or memoize) to avoid churn.
 */
export function useRegisterCommands(commands: Command[] | undefined | null) {
    const { register } = useCommandPalette();
    useEffect(() => {
        if (!commands || commands.length === 0) return;
        return register(commands);
    }, [commands, register]);
}
