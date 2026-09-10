/**
 * Copilot Sidebar — persistent right-side rail in the Workspace.
 *
 * Wraps `AssistantPanel` with a header, collapse toggle, and a localStorage-
 * backed open/closed memory.  Collapses to a 56px rail with a vertical "AI"
 * label so the architect can summon the copilot without losing the canvas.
 *
 * The sidebar is purely a layout container — it does not own conversation
 * state or call Gemini directly.  All AI work still goes through services.
 *
 * ## El ancho lo decide quien trabaja, no quien lo diseñó
 *
 * Vivía a 384 px fijos, y ése es el ancho equivocado dos veces: sobra cuando
 * alguien está leyendo un diagrama a pantalla completa y sólo quiere no perder
 * de vista al asistente, y falta cuando está repasando con él una
 * recomendación de doce párrafos. Son el mismo usuario en la misma sesión, así
 * que la elección no puede hacerse en tiempo de diseño.
 *
 * El asa se arrastra **y** se opera con flechas (`useResizablePanel`), porque
 * WCAG 2.2 · 2.5.7 prohíbe que arrastrar sea el único camino hacia una función.
 * Y mientras se arrastra el panel apaga sus transiciones: un ancho interpolado
 * va siempre un fotograma por detrás del cursor, y esa desincronización se lee
 * como lentitud del sistema.
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Project, Artifact, ArtifactTemplate } from '../types';
import { AssistantPanel } from './AssistantPanel';
import { AIArchitectAvatar, AIArchitectChip } from './ui/AIArchitectIdentity';
import { ResizeHandle } from './ui/ResizeHandle';
import { Tooltip } from './ui/Tooltip';
import { cn } from './ui/cn';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { ArrowRightIcon, XMarkIcon, SparklesIcon } from './Icons';

const STORAGE_KEY = 'arky_copilot_open';
const WIDTH_STORAGE_KEY = 'arky.copilot.width';

/**
 * Los límites del panel, y de dónde salen.
 *
 * El mínimo es el ancho por debajo del cual el chat deja de ser legible: una
 * burbuja de conversación a menos de ~320 px parte casi cada frase en tres
 * líneas. El máximo deja siempre al menos media pantalla al lienzo en un
 * portátil de 1280 px — el copiloto asiste al trabajo, y un asistente que puede
 * tapar el trabajo ha dejado de asistirlo.
 */
const MIN_WIDTH = 320;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 384;

interface CopilotSidebarProps {
    project: Project;
    activeArtifact: Artifact | null;
    setActiveArtifactId: (id: string | null) => void;
    onRequestArtifactGeneration: (template: ArtifactTemplate) => void;
}

function readPersistedOpen(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        // UX guardrail: by product requirement, the Arquitecto Agente must be
        // collapsed by default in every surface (project hub + canvas). We
        // therefore ignore prior "open" state on boot and only honour an
        // explicit persisted close.
        if (stored === '0') return false;
    } catch { /* noop */ }
    return false;
}

export const CopilotSidebar: React.FC<CopilotSidebarProps> = ({
    project,
    activeArtifact,
    setActiveArtifactId,
    onRequestArtifactGeneration,
}) => {
    const [open, setOpen] = useState<boolean>(() => readPersistedOpen());
    const panel = useResizablePanel({
        defaultWidth: DEFAULT_WIDTH,
        minWidth: MIN_WIDTH,
        maxWidth: MAX_WIDTH,
        storageKey: WIDTH_STORAGE_KEY,
        edge: 'start',
    });

    useEffect(() => {
        try { window.localStorage.setItem(STORAGE_KEY, open ? '1' : '0'); } catch { /* noop */ }
    }, [open]);

    // Hotkey: Cmd/Ctrl + . toggles the copilot
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            const isMod = event.metaKey || event.ctrlKey;
            if (isMod && event.key === '.') {
                event.preventDefault();
                setOpen((v) => !v);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    // Smart context handoff: when the architect leaves an artifact and returns
    // to the Hub, auto-collapse the panel so the focus is on the project
    // overview again. The user can still summon the copilot with one click on
    // the rail (or ⌘/Ctrl + .). We only act on the artifact→hub transition so
    // we never fight an open panel that the user deliberately opened on the
    // Hub for a project-wide conversation.
    const previousArtifactIdRef = useRef<string | null>(activeArtifact?.id ?? null);
    useEffect(() => {
        const previousArtifactId = previousArtifactIdRef.current;
        const nextArtifactId = activeArtifact?.id ?? null;

        if (previousArtifactId && !nextArtifactId) {
            setOpen(false);
        }

        previousArtifactIdRef.current = nextArtifactId;
    }, [activeArtifact]);

    return (
        <>
            {/* Collapsed rail — visible when sidebar is closed */}
            <AnimatePresence>
                {!open && (
                    <motion.aside
                        key="copilot-rail"
                        initial={{ x: 16, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: 16, opacity: 0 }}
                        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                        className="hidden md:flex w-12 flex-shrink-0 flex-col items-center justify-between py-4 border-l border-gray-200 dark:border-gray-800 bg-white/60 dark:bg-gray-900/40 backdrop-blur-sm"
                        aria-label="Arquitecto Agente colapsado"
                    >
                        <Tooltip label="Abrir Arquitecto Agente · ⌘ ." side="left">
                            <button
                                type="button"
                                onClick={() => setOpen(true)}
                                className="relative inline-flex items-center justify-center h-10 w-10 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                                aria-label="Abrir Arquitecto Agente"
                            >
                                <AIArchitectAvatar size="sm" state="idle" />
                            </button>
                        </Tooltip>
                        <div className="text-[10px] tracking-widest-2 font-bold text-gray-400 dark:text-gray-500 [writing-mode:vertical-rl] rotate-180 select-none">
                            AGENTE · IA
                        </div>
                        <div className="h-5" />
                    </motion.aside>
                )}
            </AnimatePresence>

            {/* Expanded sidebar */}
            <AnimatePresence>
                {open && (
                    <motion.aside
                        key="copilot-panel"
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: panel.width, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        // Durante el arrastre no hay transición: el ancho sigue
                        // al puntero exactamente. La animación es para abrir y
                        // cerrar, que es cuando nadie está apuntando a nada.
                        transition={panel.resizing ? { duration: 0 } : { duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                        className="hidden md:flex flex-shrink-0 overflow-hidden bg-white dark:bg-gray-900"
                        aria-label="Arquitecto Agente"
                    >
                      <ResizeHandle
                        {...panel.handleProps}
                        label="Ancho del Arquitecto Agente"
                        active={panel.resizing}
                      />
                      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-ai-50/60 via-white to-primary-50/60 dark:from-ai-950/30 dark:via-gray-900 dark:to-primary-950/30 flex-shrink-0">
                            <AIArchitectChip subtitle="Soporte continuo de arquitectura" />
                            <Tooltip label="Cerrar Arquitecto Agente · ⌘ ." side="left">
                                <button
                                    type="button"
                                    onClick={() => setOpen(false)}
                                    className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                                    aria-label="Cerrar Arquitecto Agente"
                                >
                                    <XMarkIcon className="h-4 w-4" />
                                </button>
                            </Tooltip>
                        </header>

                        {/* Active artifact context strip — gives the user a clear sense of what
                            the copilot is reasoning about right now.  When no artifact is open,
                            the strip nudges them toward a starting action. */}
                        <div className="flex-shrink-0 px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40">
                            {activeArtifact ? (
                                <div className="flex items-center gap-2 text-2xs">
                                    <span className="uppercase tracking-widest-2 text-gray-400">Contexto activo</span>
                                    <ArrowRightIcon className="h-3 w-3 text-gray-400" />
                                    <span className="font-medium text-gray-700 dark:text-gray-200 truncate">{activeArtifact.name}</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 text-2xs">
                                    <SparklesIcon className="h-3 w-3 text-ai-500" />
                                    <span className="text-gray-500 dark:text-gray-400">Trabajando con el proyecto completo</span>
                                </div>
                            )}
                        </div>

                        <div className="flex-1 min-h-0 flex flex-col">
                            <AssistantPanel
                                project={project}
                                activeArtifact={activeArtifact}
                                setActiveArtifactId={setActiveArtifactId}
                                onRequestArtifactGeneration={onRequestArtifactGeneration}
                            />
                        </div>
                      </div>
                    </motion.aside>
                )}
            </AnimatePresence>

            {/* Mobile bottom-sheet: rendered when open on small screens */}
            <AnimatePresence>
                {open && (
                    <motion.div
                        key="copilot-mobile"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="md:hidden fixed inset-0 z-[110] flex flex-col bg-gray-950/60 backdrop-blur-sm"
                        onClick={() => setOpen(false)}
                    >
                        <motion.div
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
                            className="mt-auto bg-white dark:bg-gray-900 rounded-t-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-pop"
                            onClick={(e) => e.stopPropagation()}
                            role="dialog"
                            aria-modal="true"
                            aria-label="Arquitecto Agente"
                        >
                            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
                                <AIArchitectChip />
                                <button
                                    type="button"
                                    onClick={() => setOpen(false)}
                                    className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                                    aria-label="Cerrar Arquitecto Agente"
                                >
                                    <XMarkIcon className="h-4 w-4" />
                                </button>
                            </header>
                            <div className="flex-1 min-h-0 flex flex-col">
                                <AssistantPanel
                                    project={project}
                                    activeArtifact={activeArtifact}
                                    setActiveArtifactId={setActiveArtifactId}
                                    onRequestArtifactGeneration={onRequestArtifactGeneration}
                                />
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Mobile FAB to summon the copilot when closed */}
            {!open && (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className={cn(
                        'md:hidden fixed bottom-5 right-5 z-[100] h-14 w-14 rounded-2xl',
                        'bg-ai-gradient text-white shadow-glow-ai bg-[length:200%_200%] animate-gradient-shift',
                        'flex items-center justify-center active:scale-95 transition-transform',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ai-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950',
                    )}
                    aria-label="Abrir Arquitecto Agente"
                >
                    <SparklesIcon className="h-6 w-6" />
                </button>
            )}
        </>
    );
};

export default CopilotSidebar;
