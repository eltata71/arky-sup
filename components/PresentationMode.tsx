/**
 * Presentation Mode — fullscreen cinematic experience for diagrams.
 *
 * Walks the user through a diagram scene-by-scene, dimming everything that
 * is not part of the active scene, panning to the focus area, and applying
 * cinematic transitions between scenes (zoom + fade + blur).  The overlay
 * draws over an existing ReactFlow canvas and uses the canvas's own viewport
 * controls — we don't re-mount ReactFlow inside the overlay.
 *
 * Inputs are intentionally narrow (an array of `DiagramScene` plus the
 * underlying nodes/edges) so this component is independent of the canvas's
 * own state machine.  The owning component is responsible for actually
 * dimming nodes (we only emit which ids are focused at any given step).
 *
 * **The walk comes from `buildStoryPlan`, not from a private derivation.**
 * This file used to hold its own BFS over the IR — a third copy of the same
 * traversal, and the one place where an authored `metadata.narrative.scenes`
 * was silently ignored: the overlay honoured the `scenes` *prop*, which the
 * canvas filled from a field nobody ever set, and fell through to topology
 * for every real diagram. One rule now answers "in what order is this read",
 * and it is the rule that knows whether the answer was written or guessed.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Edge, Node } from 'reactflow';
import { useReactFlow } from 'reactflow';
import type { DiagramIR, DiagramScene } from '../lib/diagram';
import { buildStoryPlan } from '../services/diagram';

export interface PresentationModeProps {
    open: boolean;
    onClose: () => void;
    /**
     * Explicit override for the walk. Left unset the overlay reads the story
     * off the IR, which is where an authored narrative actually lives.
     */
    scenes?: DiagramScene[];
    /** Optional executive summary to show on the cover slide. */
    title?: string;
    summary?: string;
    /** Underlying diagram — the source of the story and of the fallback walk. */
    ir?: DiagramIR;
    /** Live ReactFlow nodes/edges, used to pan-to-focus. */
    nodes: Node[];
    edges: Edge[];
    /** Callback invoked whenever the active scene changes — owner uses it to dim nodes/edges. */
    onSceneChange: (focus: { nodeIds: Set<string>; edgeIds: Set<string> } | null) => void;
}

interface ResolvedScene {
    id: string;
    title: string;
    insight?: string;
    nodeIds: Set<string>;
    edgeIds: Set<string>;
}

const COVER_DURATION_MS = 1100;

/**
 * The walk, read off the diagram's story plan. Authored scenes when the IR
 * carries them, the derived reading order otherwise — the planner is what
 * knows which, and `plan.source` is what says so.
 */
function scenesFromStoryPlan(ir: DiagramIR | undefined): ResolvedScene[] {
    if (!ir || ir.nodes.length === 0) return [];
    const plan = buildStoryPlan(ir);
    if (!plan) return [];
    return plan.steps
        .filter((step) => step.nodeIds.length > 0)
        .map((step) => ({
            id: step.id,
            title: step.title,
            insight: step.insight,
            nodeIds: new Set(step.nodeIds),
            edgeIds: new Set(step.edgeIds),
        }));
}

function resolveScenes(
    scenes: DiagramScene[] | undefined,
    ir: DiagramIR | undefined,
): ResolvedScene[] {
    if (Array.isArray(scenes) && scenes.length > 0) {
        return scenes.map((s) => ({
            id: s.id,
            title: s.title,
            insight: s.insight,
            nodeIds: new Set(Array.isArray(s.focusNodeIds) ? s.focusNodeIds : []),
            edgeIds: new Set(Array.isArray(s.focusEdgeIds) ? s.focusEdgeIds : []),
        }));
    }
    return scenesFromStoryPlan(ir);
}

/** Compute the bounding rectangle of the focus nodes in canvas coordinates. */
function focusBounds(focus: ResolvedScene, nodes: Node[]): { x: number; y: number; width: number; height: number } | null {
    if (focus.nodeIds.size === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
        if (!focus.nodeIds.has(node.id)) continue;
        const w = (node.width as number | null | undefined) ?? 260;
        const h = (node.height as number | null | undefined) ?? 160;
        const x = node.position.x;
        const y = node.position.y;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x + w > maxX) maxX = x + w;
        if (y + h > maxY) maxY = y + h;
    }
    if (!Number.isFinite(minX)) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const PresentationMode: React.FC<PresentationModeProps> = ({
    open,
    onClose,
    scenes,
    title,
    summary,
    ir,
    nodes,
    edges,
    onSceneChange,
}) => {
    const { fitBounds, fitView } = useReactFlow();
    const [stage, setStage] = useState<'cover' | 'scene' | 'closing'>('cover');
    const [sceneIndex, setSceneIndex] = useState(0);
    const lastEmittedFocusRef = useRef<string | null>(null);

    const resolvedScenes = useMemo(() => resolveScenes(scenes, ir), [scenes, ir]);
    const totalScenes = resolvedScenes.length;
    const activeScene = resolvedScenes[sceneIndex];

    // Reset when opened/closed.
    useEffect(() => {
        if (open) {
            setStage('cover');
            setSceneIndex(0);
            lastEmittedFocusRef.current = null;
            const t = window.setTimeout(() => {
                if (totalScenes > 0) setStage('scene');
            }, COVER_DURATION_MS);
            return () => window.clearTimeout(t);
        }
        onSceneChange(null);
        return undefined;
    }, [open, totalScenes, onSceneChange]);

    // Emit current focus and pan camera when the scene changes.
    useEffect(() => {
        if (!open || stage !== 'scene' || !activeScene) return;
        const focus = { nodeIds: activeScene.nodeIds, edgeIds: activeScene.edgeIds };
        const fingerprint = `${activeScene.id}:${activeScene.nodeIds.size}:${activeScene.edgeIds.size}`;
        if (lastEmittedFocusRef.current !== fingerprint) {
            onSceneChange(focus);
            lastEmittedFocusRef.current = fingerprint;
        }
        const bounds = focusBounds(activeScene, nodes);
        try {
            if (bounds) {
                const padding = 0.25;
                fitBounds(bounds, { duration: 600, padding });
            } else {
                fitView({ duration: 600, padding: 0.18 });
            }
        } catch {
            /* fitBounds may throw if the canvas isn't mounted yet */
        }
    }, [open, stage, activeScene, nodes, fitBounds, fitView, onSceneChange]);

    const goNext = useCallback(() => {
        if (stage === 'cover') { setStage('scene'); return; }
        if (sceneIndex < totalScenes - 1) {
            setSceneIndex((i) => i + 1);
        } else {
            setStage('closing');
            window.setTimeout(onClose, 700);
        }
    }, [stage, sceneIndex, totalScenes, onClose]);

    const goPrev = useCallback(() => {
        if (stage === 'cover') return;
        if (sceneIndex > 0) {
            setSceneIndex((i) => i - 1);
        } else {
            setStage('cover');
        }
    }, [stage, sceneIndex]);

    // Keyboard navigation
    useEffect(() => {
        if (!open) return undefined;
        const handler = (event: KeyboardEvent) => {
            if (event.key === 'ArrowRight' || event.key === ' ') { event.preventDefault(); goNext(); }
            else if (event.key === 'ArrowLeft') { event.preventDefault(); goPrev(); }
            else if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, goNext, goPrev, onClose]);

    if (!open) return null;
    void edges; // edges are accepted but the canvas owns dimming

    return (
        <AnimatePresence mode="wait">
            <motion.div
                key="presentation-overlay"
                className="fixed inset-0 z-[80] pointer-events-none"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
            >
                {/* Vignette */}
                <div
                    aria-hidden
                    className="absolute inset-0 pointer-events-none"
                    style={{
                        background:
                            'radial-gradient(120% 80% at 50% 40%, transparent 0%, rgba(2,6,23,0.55) 65%, rgba(2,6,23,0.85) 100%)',
                    }}
                />

                {/* Top progress bar */}
                <div className="absolute top-4 left-1/2 -translate-x-1/2 w-[min(80vw,640px)] pointer-events-auto">
                    <div className="h-1 w-full rounded-full bg-white/15 overflow-hidden backdrop-blur-md">
                        <motion.div
                            className="h-full bg-gradient-to-r from-cyan-400 via-indigo-400 to-fuchsia-400"
                            initial={{ width: 0 }}
                            animate={{
                                width:
                                    stage === 'cover' ? '8%' :
                                    stage === 'closing' ? '100%' :
                                    `${Math.round(((sceneIndex + 1) / Math.max(totalScenes, 1)) * 100)}%`,
                            }}
                            transition={{ duration: 0.5, ease: 'easeOut' }}
                        />
                    </div>
                </div>

                {/* Close button */}
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-4 right-4 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-semibold tracking-wide uppercase backdrop-blur-md pointer-events-auto transition"
                    aria-label="Salir de modo presentación"
                >
                    Salir · Esc
                </button>

                {/* Cover */}
                <AnimatePresence mode="wait">
                    {stage === 'cover' && (
                        <motion.div
                            key="cover"
                            className="absolute inset-0 flex items-center justify-center pointer-events-auto"
                            initial={{ opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 1.02, filter: 'blur(8px)' }}
                            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <div className="text-center max-w-2xl px-8">
                                <div className="inline-block px-3 py-1 rounded-full bg-white/12 text-white/80 uppercase tracking-[0.32em] text-[10px] mb-5 backdrop-blur-md">
                                    Modo presentación
                                </div>
                                <h1 className="text-4xl md:text-5xl font-semibold text-white leading-tight">
                                    {title || 'Arquitectura de la solución'}
                                </h1>
                                {summary && (
                                    <p className="mt-5 text-lg text-white/85 leading-relaxed">
                                        {summary}
                                    </p>
                                )}
                                <button
                                    type="button"
                                    onClick={goNext}
                                    className="mt-10 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-gray-900 text-sm font-semibold tracking-wide hover:scale-[1.03] active:scale-95 transition"
                                >
                                    Comenzar recorrido
                                    <span>→</span>
                                </button>
                                <div className="mt-6 text-white/55 text-xs">
                                    Usa ← → para navegar · Esc para salir
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Scene caption */}
                <AnimatePresence mode="wait">
                    {stage === 'scene' && activeScene && (
                        <motion.div
                            key={`scene-${activeScene.id}`}
                            className="absolute bottom-12 left-1/2 -translate-x-1/2 w-[min(90vw,720px)] pointer-events-auto"
                            initial={{ opacity: 0, y: 32, filter: 'blur(8px)' }}
                            animate={{ opacity: 1, y: 0, filter: 'blur(0)' }}
                            exit={{ opacity: 0, y: -16, filter: 'blur(6px)' }}
                            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <div className="rounded-2xl bg-white/10 dark:bg-white/5 backdrop-blur-2xl border border-white/15 shadow-2xl px-7 py-6 text-white">
                                <div className="flex items-baseline justify-between mb-2">
                                    <div className="text-xs uppercase tracking-[0.28em] text-white/60">
                                        Escena {sceneIndex + 1} / {totalScenes}
                                    </div>
                                    <div className="flex gap-1.5">
                                        {resolvedScenes.map((_, i) => (
                                            <span
                                                key={`dot-${i}`}
                                                className={`h-1.5 rounded-full transition-all ${i === sceneIndex ? 'w-6 bg-white' : 'w-1.5 bg-white/30'}`}
                                            />
                                        ))}
                                    </div>
                                </div>
                                <h2 className="text-2xl font-semibold leading-tight">{activeScene.title}</h2>
                                {activeScene.insight && (
                                    <p className="mt-3 text-white/85 leading-relaxed">
                                        {activeScene.insight}
                                    </p>
                                )}
                                <div className="mt-5 flex items-center justify-between">
                                    <button
                                        type="button"
                                        onClick={goPrev}
                                        className="text-xs uppercase tracking-wider text-white/65 hover:text-white transition"
                                    >
                                        ← Anterior
                                    </button>
                                    <button
                                        type="button"
                                        onClick={goNext}
                                        className="px-4 py-1.5 rounded-full bg-white text-gray-900 text-xs font-semibold tracking-wide hover:scale-[1.03] active:scale-95 transition"
                                    >
                                        {sceneIndex === totalScenes - 1 ? 'Cerrar' : 'Siguiente →'}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </AnimatePresence>
    );
};

export default PresentationMode;
