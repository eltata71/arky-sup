import React, { useMemo, useState } from 'react';
import type { Artifact } from '../lib/artifacts';
import { buildDiffHunks, computeLineDiff, summarizeDiff } from '../lib/textDiff';
import type { DiagramIR } from '../lib/diagram';
// Por el fichero y no por el barrel: este chunk es diferido, y entrar por
// `services/diagram` desde aquí parte en dos chunks el ciclo entre el barrel y
// `resolveRenderableDiagram` (aviso de Rollup; el modo de fallo de F6-04).
// `diagramDiff.ts` es puro, sin imports de valor, y es una puerta declarada.
import { diffDiagramIR, type DiagramDiff, type DiagramDiffField, type DiagramFieldChange } from '../services/diagram/diagramDiff';

export interface ArtifactVersionComparisonProps {
    oldVersion: Artifact;
    current: Artifact;
    /** Los modelos de ambas versiones, cuando se pudieron leer; si no, se compara el texto. */
    models: { before: DiagramIR; after: DiagramIR } | null;
}

/**
 * Comparar una versión con la actual (plan de diagramas, 1.3).
 *
 * Un diagrama se compara como diagrama —nodos, conexiones, agrupaciones— y el
 * texto queda a un clic para quien lo necesite. Un documento, o un diagrama del
 * que no se puede leer el modelo, se compara como texto, como siempre.
 *
 * Se carga en diferido desde el historial: sólo lo descarga quien compara.
 */
const ArtifactVersionComparison: React.FC<ArtifactVersionComparisonProps> = ({ oldVersion, current, models }) => {
    const [showText, setShowText] = useState(false);
    const diff = useMemo(() => (models ? diffDiagramIR(models.before, models.after) : null), [models]);

    if (!diff) return <TextVersionDiff oldVersion={oldVersion} current={current} />;
    return (
        <div className="mt-2 space-y-2">
            <SemanticVersionDiff diff={diff} from={oldVersion.version} to={current.version} />
            <button
                type="button"
                onClick={() => setShowText((value) => !value)}
                aria-expanded={showText}
                className="text-[11px] font-semibold text-primary-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
            >
                {showText ? 'Ocultar cambios en el texto' : 'Ver cambios en el texto'}
            </button>
            {showText && <TextVersionDiff oldVersion={oldVersion} current={current} />}
        </div>
    );
};

const FIELD_LABELS: Record<DiagramDiffField, string> = {
    label: 'nombre',
    kind: 'tipo',
    technology: 'tecnología',
    description: 'descripción',
    criticality: 'criticidad',
    protocol: 'protocolo',
    members: 'miembros',
};

const describeChange = (change: DiagramFieldChange): string =>
    `${FIELD_LABELS[change.field]}: ${change.before || '—'} → ${change.after || '—'}`;

const edgeText = (edge: { from: string; to: string; label: string }): string =>
    `${edge.from} → ${edge.to}${edge.label ? ` · ${edge.label}` : ''}`;

interface DiffLine { key: string; tone: 'added' | 'removed' | 'changed'; text: string; detail?: string[] }

const TONE: Record<DiffLine['tone'], { mark: string; className: string }> = {
    added: { mark: '+', className: 'text-emerald-800 dark:text-emerald-200' },
    removed: { mark: '−', className: 'text-rose-800 dark:text-rose-300' },
    changed: { mark: '~', className: 'text-amber-800 dark:text-amber-200' },
};

/** Lo que cambió en el modelo, agrupado por clase de elemento. */
const SemanticVersionDiff: React.FC<{ diff: DiagramDiff; from: number; to: number }> = ({ diff, from, to }) => {
    if (diff.identical) {
        return (
            <p className="rounded-lg bg-gray-100 dark:bg-gray-700/60 px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                Mismo diagrama: no cambió ningún elemento, conexión ni agrupación. El orden del texto o la posición de las cajas pueden variar.
            </p>
        );
    }

    const sections: Array<{ title: string; lines: DiffLine[] }> = [
        {
            title: 'Elementos',
            lines: [
                ...diff.nodes.added.map((n) => ({ key: `n+${n.id}`, tone: 'added' as const, text: n.label })),
                ...diff.nodes.removed.map((n) => ({ key: `n-${n.id}`, tone: 'removed' as const, text: n.label })),
                ...diff.nodes.changed.map((n) => ({ key: `n~${n.id}`, tone: 'changed' as const, text: n.label, detail: n.changes.map(describeChange) })),
            ],
        },
        {
            title: 'Conexiones',
            lines: [
                ...diff.edges.added.map((e, i) => ({ key: `e+${i}`, tone: 'added' as const, text: edgeText(e) })),
                ...diff.edges.removed.map((e, i) => ({ key: `e-${i}`, tone: 'removed' as const, text: edgeText(e) })),
                ...diff.edges.changed.map((e, i) => ({ key: `e~${i}`, tone: 'changed' as const, text: `${e.from} → ${e.to}`, detail: e.changes.map(describeChange) })),
            ],
        },
        {
            title: 'Agrupaciones',
            lines: [
                ...diff.groups.added.map((g) => ({ key: `g+${g.id}`, tone: 'added' as const, text: g.label })),
                ...diff.groups.removed.map((g) => ({ key: `g-${g.id}`, tone: 'removed' as const, text: g.label })),
                ...diff.groups.changed.map((g) => ({ key: `g~${g.id}`, tone: 'changed' as const, text: g.label, detail: g.changes.map(describeChange) })),
            ],
        },
    ].filter((section) => section.lines.length > 0);

    return (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                Cambios en el diagrama · v{from} → v{to}
            </div>
            <div className="max-h-72 overflow-auto bg-white dark:bg-gray-900 px-3 py-2 space-y-3 text-xs">
                {sections.map((section) => (
                    <section key={section.title} aria-label={section.title}>
                        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{section.title}</h4>
                        <ul className="mt-1 space-y-1">
                            {section.lines.map((line) => (
                                <li key={line.key} className={TONE[line.tone].className}>
                                    <span className="inline-block w-4 font-mono select-none" aria-hidden>{TONE[line.tone].mark}</span>
                                    <span className="sr-only">{line.tone === 'added' ? 'Añadido: ' : line.tone === 'removed' ? 'Eliminado: ' : 'Modificado: '}</span>
                                    {line.text}
                                    {line.detail && (
                                        <ul className="pl-5 text-gray-600 dark:text-gray-300">
                                            {line.detail.map((item) => <li key={item}>{item}</li>)}
                                        </ul>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
                {diff.reidentified > 0 && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {diff.reidentified === 1 ? 'Un elemento cambió' : `${diff.reidentified} elementos cambiaron`} de identificador y se reconoció por su nombre (típico de una regeneración).
                    </p>
                )}
            </div>
        </div>
    );
};

/**
 * Inline version-diff viewer: collapsed unchanged regions, coloured added /
 * removed lines, and a compact summary. Lets the architect verify exactly
 * what changed between a historical version and the current one without
 * leaving the history modal.
 */
const TextVersionDiff: React.FC<{ oldVersion: Artifact; current: Artifact }> = ({ oldVersion, current }) => {
    const { summary, hunks } = useMemo(() => {
        const lines = computeLineDiff(oldVersion.content ?? '', current.content ?? '');
        return { summary: summarizeDiff(lines), hunks: buildDiffHunks(lines, 2) };
    }, [oldVersion.content, current.content]);

    if (summary.identical) {
        return (
            <p className="mt-2 rounded-lg bg-gray-100 dark:bg-gray-700/60 px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                El contenido es idéntico a la versión actual.
            </p>
        );
    }

    return (
        <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700 text-[11px]">
                <span className="font-semibold text-gray-700 dark:text-gray-200">
                    v{oldVersion.version} → v{current.version}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-semibold">
                    +{summary.added}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 font-semibold">
                    −{summary.removed}
                </span>
                <span className="text-gray-400 dark:text-gray-500">{summary.unchanged} sin cambios</span>
            </div>
            <div className="max-h-72 overflow-auto bg-white dark:bg-gray-900 font-mono text-[11px] leading-5">
                {hunks.map((hunk, hIdx) => (
                    <div key={hIdx}>
                        <div className="px-3 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 text-[10px] font-semibold sticky top-0">
                            {hunk.header}
                        </div>
                        {hunk.lines.map((line, lIdx) => (
                            <div
                                key={`${hIdx}-${lIdx}`}
                                className={`px-3 whitespace-pre-wrap break-words ${
                                    line.type === 'added'
                                        ? 'bg-emerald-50 dark:bg-emerald-900/25 text-emerald-800 dark:text-emerald-200'
                                        : line.type === 'removed'
                                            ? 'bg-rose-50 dark:bg-rose-900/25 text-rose-800 dark:text-rose-300 line-through decoration-rose-400/50'
                                            : 'text-gray-500 dark:text-gray-400'
                                }`}
                            >
                                <span className="select-none inline-block w-4 text-gray-400 dark:text-gray-600">
                                    {line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}
                                </span>
                                {line.text || ' '}
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ArtifactVersionComparison;
