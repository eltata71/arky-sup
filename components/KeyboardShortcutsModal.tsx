import { useUiTranslation } from '../lib/i18n/UiTranslationContext';
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
import { MOTION } from '../lib/designTokens';

interface KeyboardShortcutsModalProps {
    open: boolean;
    onClose: () => void;
}

interface Shortcut { keys: React.ReactNode; label: string; }
interface ShortcutGroup { title: string; items: Shortcut[]; }

const Mod = () => { const t = useUiTranslation(); return <Kbd>{isMac() ? '⌘' : t("uiExpr.ctrl.dd6a02")}</Kbd>; };

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({ open, onClose }) => {
  const t = useUiTranslation();
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
            title: t("Global"),
            items: [
                { keys: <><Mod /><Kbd>K</Kbd></>, label: t("Abrir paleta de comandos") },
                { keys: <><Mod /><Kbd>.</Kbd></>, label: t("Abrir / cerrar Arquitecto Agente") },
                { keys: <><Mod /><Kbd>{t("ui.alt.e30eff")}</Kbd><Kbd>Z</Kbd></>, label: t("Deshacer el último cambio de la IA") },
                { keys: <Kbd>?</Kbd>, label: t("Mostrar atajos de teclado") },
                { keys: <Kbd>{t("ui.esc.1f7a4f")}</Kbd>, label: t("Cerrar paneles, modales o presentación") },
            ],
        },
        {
            title: t("Documento"),
            items: [
                { keys: <Kbd>]</Kbd>, label: t("Ir a la sección siguiente") },
                { keys: <Kbd>[</Kbd>, label: t("Ir a la sección anterior") },
            ],
        },
        {
            title: t("Lienzo del artefacto"),
            items: [
                { keys: <><Kbd>⌥</Kbd><Kbd>⇧</Kbd><Kbd>R</Kbd></>, label: t("Revisar: revalidar la calidad") },
                { keys: <><Kbd>⌥</Kbd><Kbd>⇧</Kbd><Kbd>M</Kbd></>, label: t("Mejorar: sugerencias con IA") },
                { keys: <><Kbd>⌥</Kbd><Kbd>⇧</Kbd><Kbd>P</Kbd></>, label: t("Compartir: modo presentación") },
                { keys: <><Kbd>⌥</Kbd><Kbd>⇧</Kbd><Kbd>E</Kbd></>, label: t("Editar contenido o salir de la edición") },
                { keys: <><Kbd>⌥</Kbd><Kbd>⇧</Kbd><Kbd>D</Kbd></>, label: t("Detalle técnico: traza de generación") },
            ],
        },
        {
            title: t("Presentación"),
            items: [
                { keys: <><Kbd>←</Kbd><Kbd>→</Kbd></>, label: t("Navegar entre escenas o diapositivas") },
                { keys: <Kbd>{t("ui.espacio.90ff8e")}</Kbd>, label: t("Avanzar a la siguiente escena o diapositiva") },
                { keys: <Kbd>L</Kbd>, label: t("Encender o apagar el puntero láser") },
                { keys: <><Kbd>←</Kbd><Kbd>↑</Kbd><Kbd>→</Kbd><Kbd>↓</Kbd></>, label: t("Con el láser encendido: moverlo (⇧ para pasos largos)") },
                { keys: <><Kbd>⇞</Kbd><Kbd>⇟</Kbd></>, label: t("Con el láser encendido: cambiar de diapositiva") },
                { keys: <Kbd>P</Kbd>, label: t("Abrir la vista del presentador en otra ventana") },
                { keys: <Kbd>{t("ui.esc.1f7a4f")}</Kbd>, label: t("Salir del modo presentación") },
            ],
        },
        {
            title: t("Paleta de comandos"),
            items: [
                { keys: <><Kbd>↑</Kbd><Kbd>↓</Kbd></>, label: t("Navegar resultados") },
                { keys: <Kbd>↵</Kbd>, label: t("Ejecutar el comando seleccionado") },
                { keys: <Kbd>{t("ui.tab.fe06eb")}</Kbd>, label: t("Avanzar al siguiente resultado") },
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
                        transition={{ duration: MOTION.duration.fast }}
                        className="absolute inset-0 bg-gray-950/60 backdrop-blur-sm"
                        onClick={onClose}
                    />
                    <motion.div
                        ref={containerRef}
                        initial={{ opacity: 0, scale: 0.96, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: 8 }}
                        transition={{ duration: MOTION.duration.fast, ease: MOTION.ease.enter }}
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
                                <p className="text-2xs uppercase tracking-widest-2 font-semibold text-gray-500 dark:text-gray-400">{t("ui.cheat-sheet.99957d")}</p>
                                <h2 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-white">{t("ui.atajos-de-teclado.e91567")}</h2>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label={t("sdd.close")}
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
                            <span>{t("ui.pulsa.2fd3da")} <Kbd>?</Kbd> {t("ui.en-cualquier-momento-para-vo.e0bbbc")}</span>
                            <button
                                type="button"
                                onClick={onClose}
                                className="text-primary-600 dark:text-primary-300 hover:underline"
                            >
                                {t("sdd.close")}
                            </button>
                        </footer>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default KeyboardShortcutsModal;
