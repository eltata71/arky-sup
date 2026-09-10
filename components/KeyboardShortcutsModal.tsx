/**
 * Keyboard Shortcuts modal.  Renders a polished cheatsheet so the user can
 * discover Cmd+K, the copilot toggle, presentation controls, and audience
 * switches at a glance.  Bound to the global "?" key by default.
 */

import React, { useEffect, useId } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Kbd, isMac } from './ui/Kbd';
import { XMarkIcon } from './Icons';
import { cn } from './ui/cn';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface KeyboardShortcutsModalProps {
    open: boolean;
    onClose: () => void;
}

interface Shortcut { keys: React.ReactNode; label: string; }
interface ShortcutGroup { title: string; items: Shortcut[]; }

const Mod = () => <Kbd>{isMac() ? '⌘' : 'Ctrl'}</Kbd>;

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({ open, onClose }) => {
    const titleId = useId();
    const containerRef = useFocusTrap<HTMLDivElement>(open);

    // Bind global "?" to open the modal and "Esc" to close it.
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (open && event.key === 'Escape') {
                event.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, onClose]);

    const groups: ShortcutGroup[] = [
        {
            title: 'Global',
            items: [
                { keys: <><Mod /><Kbd>K</Kbd></>, label: 'Abrir paleta de comandos' },
                { keys: <><Mod /><Kbd>.</Kbd></>, label: 'Abrir / cerrar Arquitecto Agente' },
                { keys: <Kbd>?</Kbd>, label: 'Mostrar atajos de teclado' },
                { keys: <Kbd>Esc</Kbd>, label: 'Cerrar paneles, modales o presentación' },
            ],
        },
        {
            title: 'Presentación',
            items: [
                { keys: <><Kbd>←</Kbd><Kbd>→</Kbd></>, label: 'Navegar entre escenas' },
                { keys: <Kbd>Espacio</Kbd>, label: 'Avanzar a la siguiente escena' },
                { keys: <Kbd>Esc</Kbd>, label: 'Salir del modo presentación' },
            ],
        },
        {
            title: 'Paleta de comandos',
            items: [
                { keys: <><Kbd>↑</Kbd><Kbd>↓</Kbd></>, label: 'Navegar resultados' },
                { keys: <Kbd>↵</Kbd>, label: 'Ejecutar el comando seleccionado' },
                { keys: <Kbd>Tab</Kbd>, label: 'Avanzar al siguiente resultado' },
            ],
        },
    ];

    return (
        <AnimatePresence>
            {open && (
                <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0 bg-gray-950/60 backdrop-blur-sm"
                        onClick={onClose}
                    />
                    <motion.div
                        ref={containerRef}
                        initial={{ opacity: 0, scale: 0.96, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: 8 }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        className={cn(
                            'relative w-full max-w-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800',
                            'rounded-2xl shadow-pop overflow-hidden',
                        )}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={titleId}
                    >
                        <header className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-primary-50/60 via-white to-ai-50/40 dark:from-primary-950/30 dark:via-gray-900 dark:to-ai-950/20">
                            <div>
                                <p className="text-2xs uppercase tracking-widest-2 font-semibold text-gray-500 dark:text-gray-400">Cheat sheet</p>
                                <h2 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-white">Atajos de teclado</h2>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label="Cerrar"
                                className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                            >
                                <XMarkIcon className="h-4 w-4" />
                            </button>
                        </header>

                        <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-3 gap-5 max-h-[70vh] overflow-y-auto custom-scrollbar">
                            {groups.map((group) => (
                                <section key={group.title}>
                                    <h3 className="text-2xs uppercase tracking-widest-2 font-semibold text-gray-500 dark:text-gray-400 mb-2">
                                        {group.title}
                                    </h3>
                                    <ul className="space-y-2">
                                        {group.items.map((item, idx) => (
                                            <li key={idx} className="flex items-center justify-between gap-2 text-sm">
                                                <span className="text-gray-700 dark:text-gray-200 truncate">{item.label}</span>
                                                <span className="flex items-center gap-1 flex-shrink-0">{item.keys}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            ))}
                        </div>

                        <footer className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 text-2xs text-gray-500 dark:text-gray-400 flex items-center justify-between">
                            <span>Pulsa <Kbd>?</Kbd> en cualquier momento para volver a abrir esta vista.</span>
                            <button
                                type="button"
                                onClick={onClose}
                                className="text-primary-600 dark:text-primary-300 hover:underline"
                            >
                                Cerrar
                            </button>
                        </footer>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default KeyboardShortcutsModal;
