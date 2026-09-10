import React, { useCallback, useRef, useState, useEffect } from 'react';
import type { DiagramIR, DiagramNarrative } from '../lib/diagram';
import { motion } from 'motion/react';
import { toPng } from 'html-to-image';
import { Button, Badge } from './ui';
import { PencilIcon, CheckCircleIcon, XMarkIcon } from './Icons';

interface ExecutiveOnePagerProps {
    title: string;
    /**
     * Accepts either the legacy string form or the structured narrative so
     * migration is painless.  When an object is supplied, `summary` is used
     * as the main paragraph and `callouts` rendered as bullet points.
     */
    narrative?: string | DiagramNarrative;
    ir: DiagramIR;
    onClose?: () => void;
    /**
     * Optional override. When absent the component ships its own PNG export
     * using html-to-image against the rendered card.
     */
    onDownload?: () => void;
    /** Optional file name stem. Defaults to "brief-ejecutivo". */
    exportName?: string;
    /**
     * When provided, enables inline editing of the title and narrative
     * summary.  The owner persists the edits (typically by patching
     * `ir.metadata.narrative` and the artifact name) inside this callback.
     */
    onSaveNarrative?: (next: { title: string; summary: string }) => void;
}

const keyNumber = (n: number, label: string, hint: string) => (
    <div className="flex flex-col items-start px-4 py-3 bg-white/80 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700">
        <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-medium">{label}</span>
        <span className="text-3xl font-bold text-gray-900 dark:text-white leading-none mt-1">{n}</span>
        <span className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{hint}</span>
    </div>
);

export const ExecutiveOnePager: React.FC<ExecutiveOnePagerProps> = ({ title, narrative, ir, onClose, onDownload, exportName = 'brief-ejecutivo', onSaveNarrative }) => {
    const totalNodes = ir.nodes.length;
    const externalActors = ir.nodes.filter(n => /person|external|partner|cliente|stakeholder/i.test(n.kind)).length;
    const dataStores = ir.nodes.filter(n => /data|db|storage|warehouse|cache/i.test(n.kind)).length;
    const criticalFlows = ir.edges.filter(e => e.relation === 'data-flow' || /critic|core|main/i.test(e.label ?? '')).length;

    const cardRef = useRef<HTMLDivElement>(null);

    // Accept both string and structured narrative forms.
    const narrativeText = typeof narrative === 'string' ? narrative : narrative?.summary;
    const narrativeCallouts = typeof narrative === 'object' ? narrative?.callouts : undefined;

    // Inline-editing state.  Only mounted when the parent passed onSaveNarrative.
    const editable = !!onSaveNarrative;
    const [isEditing, setIsEditing] = useState(false);
    const [draftTitle, setDraftTitle] = useState(title);
    const [draftSummary, setDraftSummary] = useState(narrativeText ?? '');

    // Re-sync drafts when the parent passes a new artefact / narrative —
    // otherwise the editor would show stale text after switching artefacts.
    useEffect(() => {
        if (!isEditing) {
            setDraftTitle(title);
            setDraftSummary(narrativeText ?? '');
        }
    }, [title, narrativeText, isEditing]);

    const startEditing = () => {
        setDraftTitle(title);
        setDraftSummary(narrativeText ?? '');
        setIsEditing(true);
    };

    const cancelEditing = () => {
        setDraftTitle(title);
        setDraftSummary(narrativeText ?? '');
        setIsEditing(false);
    };

    const saveEditing = () => {
        if (!onSaveNarrative) return;
        const trimmedTitle = draftTitle.trim() || title;
        onSaveNarrative({ title: trimmedTitle, summary: draftSummary.trim() });
        setIsEditing(false);
    };

    const handleDownload = useCallback(async () => {
        if (onDownload) {
            onDownload();
            return;
        }
        const el = cardRef.current;
        if (!el) return;
        try {
            const dataUrl = await toPng(el, { pixelRatio: 2, cacheBust: true });
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = `${exportName}.png`;
            a.click();
        } catch (err) {
            console.error('[ExecutiveOnePager] download failed', err);
        }
    }, [onDownload, exportName]);

    return (
        <motion.div
            ref={cardRef}
            className="relative w-full max-w-5xl mx-auto bg-gradient-to-br from-white via-gray-50 to-primary-50 dark:from-gray-950 dark:via-gray-900 dark:to-primary-950/40 border border-gray-200 dark:border-gray-800 rounded-3xl shadow-2xl p-8"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
        >
            <header className="flex items-start justify-between mb-6 gap-4">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] uppercase tracking-[0.16em] text-primary-600 dark:text-primary-300 font-medium">Brief ejecutivo</span>
                        {isEditing && <Badge tone="ai" size="xs">Editando</Badge>}
                    </div>
                    {isEditing ? (
                        <input
                            type="text"
                            value={draftTitle}
                            onChange={(e) => setDraftTitle(e.target.value)}
                            placeholder="Título del brief"
                            aria-label="Título del brief"
                            className="w-full text-3xl font-bold text-gray-900 dark:text-white leading-tight bg-transparent border-b-2 border-primary-400 focus:border-primary-600 outline-none py-0.5"
                            autoFocus
                        />
                    ) : (
                        <h1 className="text-3xl font-bold text-gray-900 dark:text-white leading-tight">{title}</h1>
                    )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    {editable && !isEditing && (
                        <Button
                            variant="ghost"
                            size="sm"
                            leftIcon={<PencilIcon className="h-3.5 w-3.5" />}
                            onClick={startEditing}
                            aria-label="Editar narrativa"
                        >
                            Editar narrativa
                        </Button>
                    )}
                    {isEditing && (
                        <>
                            <Button
                                variant="primary"
                                size="sm"
                                leftIcon={<CheckCircleIcon className="h-3.5 w-3.5" />}
                                onClick={saveEditing}
                            >
                                Guardar
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                leftIcon={<XMarkIcon className="h-3.5 w-3.5" />}
                                onClick={cancelEditing}
                            >
                                Cancelar
                            </Button>
                        </>
                    )}
                    {!isEditing && (
                        <Button variant="secondary" size="sm" onClick={handleDownload}>
                            Descargar PNG
                        </Button>
                    )}
                    {!isEditing && onClose && (
                        <Button variant="ghost" size="sm" onClick={onClose}>Cerrar</Button>
                    )}
                </div>
            </header>

            {/* Narrative summary — editable textarea or readonly paragraph */}
            {isEditing ? (
                <div className="mb-6">
                    <label htmlFor="narrative-summary" className="block text-2xs uppercase tracking-widest-2 font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                        Resumen narrativo
                    </label>
                    <textarea
                        id="narrative-summary"
                        value={draftSummary}
                        onChange={(e) => setDraftSummary(e.target.value)}
                        placeholder="Cuenta la historia: el problema, la solución, el valor entregado y los próximos pasos."
                        rows={5}
                        className="w-full px-4 py-3 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 leading-relaxed"
                    />
                    <p className="mt-2 text-2xs text-gray-500 dark:text-gray-400">
                        Tip: empieza por el "para quién", luego "qué problema resuelve" y termina con la métrica de éxito.
                    </p>
                </div>
            ) : narrativeText ? (
                <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed mb-6 max-w-3xl">
                    {narrativeText}
                </p>
            ) : editable ? (
                <button
                    type="button"
                    onClick={startEditing}
                    className="w-full text-left mb-6 px-4 py-3 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-white/40 dark:bg-gray-900/40 hover:border-primary-400 dark:hover:border-primary-600 transition-colors text-sm text-gray-500 dark:text-gray-400 italic"
                >
                    Aún no hay narrativa. Haz clic para escribir el resumen ejecutivo.
                </button>
            ) : null}

            {narrativeCallouts && narrativeCallouts.length > 0 && (
                <ul className="mb-6 flex flex-wrap gap-2">
                    {narrativeCallouts.slice(0, 5).map((c) => (
                        <li key={c.id}
                            className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${
                                c.severity === 'critical' ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800' :
                                c.severity === 'warning' ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800' :
                                'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/30 dark:text-primary-200 dark:border-primary-800'
                            }`}>
                            {typeof c.index === 'number' && <span className="mr-1 font-semibold">#{c.index}</span>}
                            {c.text}
                        </li>
                    ))}
                </ul>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
                {keyNumber(totalNodes,      'Componentes',      'Piezas en el sistema')}
                {keyNumber(externalActors,  'Actores externos', 'Usuarios / partners')}
                {keyNumber(dataStores,      'Datos',            'Almacenes y bases')}
                {keyNumber(criticalFlows,   'Flujos críticos',  'Con impacto en KPIs')}
            </div>

            <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
                    Capacidades clave
                </h2>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {ir.nodes.slice(0, 8).map(n => (
                        <li key={n.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/60 px-4 py-3">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">{n.label}</p>
                            {n.description && (
                                <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 line-clamp-2">{n.description}</p>
                            )}
                        </li>
                    ))}
                </ul>
            </section>
        </motion.div>
    );
};

export default ExecutiveOnePager;
