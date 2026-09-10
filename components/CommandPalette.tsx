/**
 * Command Palette — global Cmd/Ctrl+K overlay.
 *
 * Reads commands from `CommandPaletteContext` and surfaces a fast, keyboard-
 * driven launcher.  Patterns: Linear/VSCode/Vercel-style.  Fuzzy match is a
 * cheap subsequence check (good enough for <500 commands without a tokenizer).
 *
 * Sections are rendered as headers between groups; selection wraps; Enter runs
 * and closes.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useCommandPalette, type Command } from '../context/CommandPaletteContext';
import { Kbd, isMac } from './ui/Kbd';
import { cn } from './ui/cn';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { MagnifyingGlassIcon, SparklesIcon, ArrowRightIcon, XMarkIcon } from './Icons';

function fuzzyScore(query: string, text: string): number {
    if (!query) return 1;
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    if (t.includes(q)) return 2 + (1 - q.length / Math.max(t.length, 1));
    // subsequence match
    let qi = 0;
    for (let i = 0; i < t.length && qi < q.length; i++) {
        if (t[i] === q[qi]) qi++;
    }
    return qi === q.length ? 0.5 : 0;
}

function rankCommand(query: string, command: Command): number {
    const fields = [command.title, command.subtitle ?? '', (command.keywords ?? []).join(' ')];
    let best = 0;
    for (const f of fields) {
        const s = fuzzyScore(query, f);
        if (s > best) best = s;
    }
    return best;
}

export const CommandPalette: React.FC = () => {
    const { open, setOpen, commands } = useCommandPalette();
    const [query, setQuery] = useState('');
    const [highlight, setHighlight] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const containerRef = useFocusTrap<HTMLDivElement>(open);
    const titleId = useId();

    // Reset state every time the palette opens
    useEffect(() => {
        if (open) {
            setQuery('');
            setHighlight(0);
            // Focus the input on next tick (after AnimatePresence mounts it)
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [open]);

    const filtered = useMemo(() => {
        if (!query.trim()) {
            return commands.map((c, i) => ({ command: c, score: commands.length - i }));
        }
        return commands
            .map((c) => ({ command: c, score: rankCommand(query, c) }))
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score);
    }, [commands, query]);

    // Keep highlight in range as the result list changes
    useEffect(() => {
        if (highlight >= filtered.length) setHighlight(0);
    }, [filtered.length, highlight]);

    // Build sectioned list for rendering
    const sectionedList = useMemo(() => {
        const groups: Array<{ section: string | null; items: Array<{ command: Command; index: number }> }> = [];
        const map = new Map<string, { command: Command; index: number }[]>();
        filtered.forEach((entry, idx) => {
            const section = entry.command.section ?? '';
            if (!map.has(section)) map.set(section, []);
            map.get(section)!.push({ command: entry.command, index: idx });
        });
        for (const [section, items] of map) {
            groups.push({ section: section || null, items });
        }
        return groups;
    }, [filtered]);

    const runCommand = useCallback(async (command: Command) => {
        if (command.disabled) return;
        setOpen(false);
        try { await command.run(); }
        catch (err) { console.error('[CommandPalette] command failed', { id: command.id, err }); }
    }, [setOpen]);

    const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const entry = filtered[highlight];
            if (entry) runCommand(entry.command);
        } else if (event.key === 'Tab') {
            event.preventDefault();
            setHighlight((h) => (h + 1) % Math.max(filtered.length, 1));
        }
    }, [filtered, highlight, runCommand]);

    // Keep highlighted item in view
    useEffect(() => {
        if (!listRef.current) return;
        const el = listRef.current.querySelector<HTMLElement>(`[data-cmd-index="${highlight}"]`);
        if (el) el.scrollIntoView({ block: 'nearest' });
    }, [highlight]);

    return (
        <AnimatePresence>
            {open && (
                <div className="fixed inset-0 z-[120] flex items-start justify-center pt-24 px-4 sm:pt-32">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0 bg-gray-950/60 backdrop-blur-sm"
                        onClick={() => setOpen(false)}
                    />
                    <motion.div
                        ref={containerRef}
                        initial={{ opacity: 0, scale: 0.97, y: -8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: -8 }}
                        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                        className="relative w-full max-w-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-pop overflow-hidden"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={titleId}
                    >
                        <h2 id={titleId} className="sr-only">Paleta de comandos</h2>
                        {/* Search input */}
                        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                            <MagnifyingGlassIcon className="h-5 w-5 text-gray-400 flex-shrink-0" />
                            <input
                                ref={inputRef}
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={onKeyDown}
                                placeholder="Busca comandos, navega o pídele algo a la IA…"
                                className="flex-1 bg-transparent text-base placeholder:text-gray-400 dark:placeholder:text-gray-500 text-gray-900 dark:text-gray-100 focus:outline-none"
                                aria-label="Busca comandos, navega o pídele algo a la IA…"
                            />
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                                aria-label="Cerrar paleta"
                            >
                                <XMarkIcon className="h-4 w-4" />
                            </button>
                        </div>

                        {/* Results */}
                        <div ref={listRef} className="max-h-[60vh] overflow-y-auto custom-scrollbar py-2">
                            {filtered.length === 0 ? (
                                <div className="px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                                    <SparklesIcon className="h-6 w-6 mx-auto mb-2 text-gray-400" />
                                    Sin coincidencias para “{query}”. Prueba con otro término.
                                </div>
                            ) : (
                                sectionedList.map((group, gi) => (
                                    <div key={`group-${gi}`} className="mb-1">
                                        {group.section && (
                                            <div className="px-4 py-1 text-2xs uppercase tracking-widest-2 font-semibold text-gray-400 dark:text-gray-500">
                                                {group.section}
                                            </div>
                                        )}
                                        {group.items.map(({ command, index }) => {
                                            const active = highlight === index;
                                            const isAi = command.flavor === 'ai';
                                            const isStory = command.flavor === 'storytelling';
                                            return (
                                                <button
                                                    key={command.id}
                                                    type="button"
                                                    data-cmd-index={index}
                                                    disabled={command.disabled}
                                                    onMouseEnter={() => setHighlight(index)}
                                                    onClick={() => runCommand(command)}
                                                    className={cn(
                                                        'w-full text-left flex items-center gap-3 px-4 py-2.5 transition-colors',
                                                        active
                                                            ? isAi
                                                                ? 'bg-ai-50 dark:bg-ai-950/40'
                                                                : isStory
                                                                    ? 'bg-amber-50 dark:bg-amber-950/40'
                                                                    : 'bg-primary-50 dark:bg-primary-950/40'
                                                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50',
                                                        command.disabled && 'opacity-50 cursor-not-allowed',
                                                    )}
                                                >
                                                    <span className={cn(
                                                        'flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0',
                                                        isAi
                                                            ? 'bg-ai-gradient text-white shadow-glow-ai'
                                                            : isStory
                                                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                                                                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
                                                    )}>
                                                        {command.icon ?? <ArrowRightIcon className="h-4 w-4" />}
                                                    </span>
                                                    <span className="flex-1 min-w-0">
                                                        <span className={cn(
                                                            'block text-sm font-medium truncate',
                                                            active ? 'text-gray-900 dark:text-white' : 'text-gray-800 dark:text-gray-100',
                                                        )}>
                                                            {command.title}
                                                        </span>
                                                        {command.subtitle && (
                                                            <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">
                                                                {command.subtitle}
                                                            </span>
                                                        )}
                                                    </span>
                                                    {command.shortcut && (
                                                        <span className="text-2xs text-gray-400 font-mono flex-shrink-0">
                                                            {command.shortcut}
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Footer hints */}
                        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/50 text-2xs text-gray-500 dark:text-gray-400">
                            <span className="flex items-center gap-2">
                                <Kbd>↑</Kbd><Kbd>↓</Kbd> navegar · <Kbd>↵</Kbd> ejecutar · <Kbd>Esc</Kbd> cerrar
                            </span>
                            <span className="flex items-center gap-1">
                                <Kbd>{isMac() ? '⌘' : 'Ctrl'}</Kbd><Kbd>K</Kbd>
                            </span>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default CommandPalette;
