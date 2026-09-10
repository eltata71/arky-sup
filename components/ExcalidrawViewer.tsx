import React, { Suspense, useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ExternalLink, Download, RefreshCw, AlertTriangle, Loader2, Layers } from 'lucide-react';
import { inferPalette } from '../lib/diagramTokens';
import { lazyWithRetry } from './routing/lazyWithRetry';

// Lazy-load Excalidraw to keep the initial bundle small. Routed through
// `lazyWithRetry` so a transient failure loading this heavy ESM chunk
// self-recovers instead of breaking the Excalidraw view.
const ExcalidrawComponent = lazyWithRetry(
    () => import('@excalidraw/excalidraw').then((mod) => ({ default: mod.Excalidraw })),
    { chunkName: 'Excalidraw' },
);

// Pre-load restoreElements lazily so we never fall back to `require()` in an ESM build.
let restoreElementsPromise: Promise<((els: unknown[], localAppState: unknown) => unknown[]) | null> | null = null;
function loadRestoreElements(): Promise<((els: unknown[], localAppState: unknown) => unknown[]) | null> {
    if (!restoreElementsPromise) {
        restoreElementsPromise = import('@excalidraw/excalidraw')
            .then((mod) => {
                const fn = (mod as { restoreElements?: (els: unknown[], localAppState: unknown) => unknown[] }).restoreElements;
                return typeof fn === 'function' ? fn : null;
            })
            .catch(() => null);
    }
    return restoreElementsPromise;
}

interface ExcalidrawViewerProps {
    elements: unknown[];
    isLoading: boolean;
    error: string | null;
    onRetry: () => void;
    onOpenExternal: () => void;
}

/** Detect current dark-mode state from the DOM */
function useIsDark(): boolean {
    const [isDark, setIsDark] = useState(() =>
        document.documentElement.classList.contains('dark')
    );
    useEffect(() => {
        const observer = new MutationObserver(() =>
            setIsDark(document.documentElement.classList.contains('dark'))
        );
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);
    return isDark;
}

/**
 * Infer a semantic background color from the element text content.
 * Delegates to the canonical `diagramTokens` palette so colours stay in sync
 * with CustomNode, Lucid embed and PDF exports.
 */
function inferSemanticColor(text: string, isDark: boolean): { bg: string; stroke: string } {
    const palette = inferPalette(text || '', undefined, isDark);
    return { bg: palette.bg, stroke: palette.stroke };
}

/**
 * Pre-process raw Gemini elements before `restoreElements`:
 * - Clamp NaN/Infinite coordinates to valid numbers
 * - Map unknown types to valid Excalidraw primitives
 * - Ensure arrows have a `points` array
 * - Strip invalid startBinding/endBinding references
 * - Apply semantic color defaults based on element role and dark mode
 */
function preprocessRawElements(rawElements: unknown[], isDark: boolean): unknown[] {
    const validTypes = new Set(['rectangle', 'ellipse', 'diamond', 'arrow', 'text', 'line', 'freedraw']);
    const knownIds = new Set(rawElements.map((e: any) => e?.id).filter(Boolean));

    const defaultStroke = isDark ? '#94a3b8' : '#64748b';
    const defaultTextColor = isDark ? '#e2e8f0' : '#0f172a';

    return rawElements.map((el: any) => {
        if (!el || typeof el !== 'object') return el;
        const e = { ...el };

        // Coordinates — clamp to sane range
        e.x = isFinite(Number(e.x)) ? Number(e.x) : 50;
        e.y = isFinite(Number(e.y)) ? Number(e.y) : 50;
        e.width = isFinite(Number(e.width)) ? Math.max(10, Number(e.width)) : 150;
        e.height = isFinite(Number(e.height)) ? Math.max(10, Number(e.height)) : 60;
        e.angle = isFinite(Number(e.angle)) ? Number(e.angle) : 0;

        // Map unknown types
        if (!validTypes.has(e.type)) e.type = 'rectangle';

        // Arrows / lines need `points`
        if (e.type === 'arrow' || e.type === 'line') {
            if (!Array.isArray(e.points) || e.points.length < 2) {
                e.points = [[0, 0], [e.width ?? 120, 0]];
            }
            // Strip bindings that reference unknown element IDs
            if (e.startBinding && !knownIds.has(e.startBinding?.elementId)) e.startBinding = null;
            if (e.endBinding && !knownIds.has(e.endBinding?.elementId)) e.endBinding = null;
            if (!e.startArrowhead) e.startArrowhead = null;
            if (!e.endArrowhead) e.endArrowhead = 'arrow';
        }

        // Text elements need these fields
        if (e.type === 'text') {
            if (!e.text) e.text = e.label || '';
            if (!e.fontSize) e.fontSize = 13;
            if (!e.fontFamily) e.fontFamily = 1;
            if (!e.textAlign) e.textAlign = 'center';
            if (!e.verticalAlign) e.verticalAlign = 'middle';
            e.containerId = e.containerId ?? null;
            e.originalText = e.originalText ?? e.text;
            // Text on arrows / labels: use appropriate color
            if (!e.strokeColor || e.strokeColor === '#1e293b') {
                e.strokeColor = defaultTextColor;
            }
        }

        // Shape elements: apply semantic colors when missing or using poor defaults
        if (e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'diamond') {
            // If background is missing, transparent, or a too-dark/too-light default, infer it
            const hasBg = e.backgroundColor && e.backgroundColor !== 'transparent' && e.backgroundColor !== '';
            if (!hasBg) {
                const semantic = inferSemanticColor(e.text || '', isDark);
                e.backgroundColor = semantic.bg;
                if (!e.strokeColor || e.strokeColor === '#1e293b') {
                    e.strokeColor = semantic.stroke;
                }
            }
            // Ensure stroke is readable in current mode
            if (!e.strokeColor || e.strokeColor === '#1e293b') {
                const semantic = inferSemanticColor(e.text || '', isDark);
                e.strokeColor = semantic.stroke;
            }
        }

        // Required base fields
        if (!e.strokeColor) e.strokeColor = defaultStroke;
        if (!e.fillStyle) e.fillStyle = 'solid';
        if (!e.strokeWidth) e.strokeWidth = 2;
        if (!e.strokeStyle) e.strokeStyle = 'solid';
        if (e.roughness === undefined || e.roughness === null) e.roughness = 0;
        if (e.opacity === undefined || e.opacity === null) e.opacity = 100;

        return e;
    });
}

/** Internal canvas — normalizes elements, mounts Excalidraw, auto-scrolls */
interface ExcalidrawCanvasProps {
    elements: unknown[];
    isDark: boolean;
    onElementCountChange: (n: number) => void;
}

const ExcalidrawCanvas: React.FC<ExcalidrawCanvasProps> = ({ elements, isDark, onElementCountChange }) => {
     
    const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
    const scrolledRef = useRef(false);
    const [restoreFn, setRestoreFn] = useState<((els: unknown[], localAppState: unknown) => unknown[]) | null>(null);

    // Load Excalidraw's restoreElements lazily via ESM import (no require()).
    useEffect(() => {
        let cancelled = false;
        loadRestoreElements().then((fn) => {
            if (!cancelled) setRestoreFn(() => fn);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    // Normalise the elements using Excalidraw's own restoration function
    const normalizedElements = useMemo(() => {
        if (!elements || elements.length === 0) return [];
        try {
            const preprocessed = preprocessRawElements(elements, isDark);
            if (restoreFn) {
                return restoreFn(preprocessed, null);
            }
            return preprocessed;
        } catch (e) {
            console.warn('[ExcalidrawViewer] Element normalization error:', e);
            return preprocessRawElements(elements, isDark);
        }
    }, [elements, isDark, restoreFn]);

    // Report count to parent
    useEffect(() => {
        onElementCountChange(normalizedElements.length);
    }, [normalizedElements.length, onElementCountChange]);

    // Scroll to content after API is ready
    useEffect(() => {
        if (!excalidrawAPI || scrolledRef.current || normalizedElements.length === 0) return;
        scrolledRef.current = true;
        const t = setTimeout(() => {
            try {
                excalidrawAPI.scrollToContent(undefined, { fitToContent: true, animate: true, duration: 800 });
            } catch {
                try { excalidrawAPI.scrollToContent(); } catch { /* noop */ }
            }
        }, 300);
        return () => clearTimeout(t);
    }, [excalidrawAPI, normalizedElements.length]);

    return (
        <ExcalidrawComponent
             
            excalidrawAPI={(api: any) => setExcalidrawAPI(api)}
            initialData={{
                 
                elements: normalizedElements as any[],
                scrollToContent: true,
                appState: {
                    viewBackgroundColor: isDark ? '#0f172a' : '#f8fafc',
                    theme: isDark ? 'dark' : 'light',
                },
            }}
            theme={isDark ? 'dark' : 'light'}
            UIOptions={{
                canvasActions: {
                    export: false,
                    loadScene: false,
                     
                    saveToActiveFile: false as any,
                },
            }}
        />
    );
};

const ExcalidrawViewer: React.FC<ExcalidrawViewerProps> = ({
    elements,
    isLoading,
    error,
    onRetry,
    onOpenExternal,
}) => {
    const isDark = useIsDark();
    const [elementCount, setElementCount] = useState(0);

    const handleDownload = useCallback(() => {
        const fileData = {
            type: 'excalidraw',
            version: 2,
            source: 'arkypro',
            elements,
            appState: { viewBackgroundColor: isDark ? '#0f172a' : '#f8fafc', gridSize: null },
            files: {},
        };
        const blob = new Blob([JSON.stringify(fileData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'diagram.excalidraw';
        a.click();
        URL.revokeObjectURL(url);
    }, [elements, isDark]);

    return (
        <motion.div
            className="flex-1 flex flex-col min-h-0 h-full bg-white dark:bg-gray-950"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}
        >
            {/* ── Header ── */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2 min-w-0">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6965db" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Excalidraw</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 hidden lg:inline flex-shrink-0">— diagrama interactivo de pizarra</span>
                    {elementCount > 0 && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                            className="hidden md:flex items-center gap-1 ml-1 px-2 py-0.5 bg-violet-50 dark:bg-violet-900/30 rounded-full"
                        >
                            <Layers className="w-3 h-3 text-[#6965db]" />
                            <span className="text-xs text-[#6965db] font-medium">{elementCount} elementos</span>
                        </motion.div>
                    )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    <motion.button
                        onClick={handleDownload}
                        disabled={elements.length === 0}
                        title="Descargar como archivo .excalidraw"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-40"
                        whileTap={{ scale: 0.96 }}
                    >
                        <Download className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Descargar .excalidraw</span>
                    </motion.button>
                    <motion.button
                        onClick={onOpenExternal}
                        title="Abrir en Excalidraw.com"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#6965db] rounded-lg"
                        whileHover={{ backgroundColor: '#5b58c4' }}
                        whileTap={{ scale: 0.96 }}
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Abrir en Excalidraw.com</span>
                    </motion.button>
                </div>
            </div>

            {/* ── Canvas area ── */}
            <div className="flex-1 min-h-0 w-full relative">
                <AnimatePresence mode="wait">
                    {isLoading ? (
                        <motion.div
                            key="loading"
                            className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-white dark:bg-gray-950"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        >
                            <div className="relative">
                                <div className="absolute inset-0 bg-violet-500/15 rounded-full blur-2xl animate-pulse" />
                                <div className="relative w-16 h-16 rounded-2xl bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center">
                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6965db" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                                    </svg>
                                </div>
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Generando diagrama Excalidraw</p>
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">La IA está convirtiendo el diagrama de arquitectura…</p>
                            </div>
                            <div className="relative w-64 h-32 mt-2">
                                {[{ x: '10%', y: '10%', w: 100, h: 40 }, { x: '55%', y: '55%', w: 90, h: 36 }, { x: '5%', y: '65%', w: 80, h: 32 }].map((box, i) => (
                                    <motion.div key={i} className="absolute rounded-lg bg-violet-100 dark:bg-violet-900/40 border border-violet-200 dark:border-violet-800"
                                        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
                                        animate={{ opacity: [0.3, 0.8, 0.3] }}
                                        transition={{ duration: 2, repeat: Infinity, delay: i * 0.35 }}
                                    />
                                ))}
                                <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
                                    <motion.path d="M 70 35 Q 150 70 160 72" fill="none" stroke="#6965db" strokeWidth="1.5" strokeDasharray="4 3" opacity={0.4}
                                        animate={{ strokeDashoffset: [0, -14] }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} />
                                </svg>
                            </div>
                        </motion.div>
                    ) : error ? (
                        <motion.div
                            key="error"
                            className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 bg-white dark:bg-gray-950"
                            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        >
                            <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
                                <AlertTriangle className="w-7 h-7 text-amber-500" />
                            </div>
                            <div className="text-center max-w-sm">
                                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">Error al generar vista Excalidraw</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{error}</p>
                            </div>
                            <motion.button onClick={onRetry}
                                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-xl shadow-sm"
                                whileHover={{ backgroundColor: '#4338ca' }} whileTap={{ scale: 0.96 }}>
                                <RefreshCw className="w-4 h-4" /> Reintentar
                            </motion.button>
                        </motion.div>
                    ) : elements.length === 0 ? (
                        <motion.div key="empty" className="absolute inset-0 flex items-center justify-center bg-white dark:bg-gray-950"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                            <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
                        </motion.div>
                    ) : (
                        <motion.div key="canvas" className="absolute inset-0"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
                            <Suspense fallback={
                                <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-gray-950">
                                    <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
                                </div>
                            }>
                                <ExcalidrawCanvas elements={elements} isDark={isDark} onElementCountChange={setElementCount} />
                            </Suspense>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
};

export default ExcalidrawViewer;
