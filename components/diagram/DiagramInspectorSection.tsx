/**
 * Read-only inspector section for a selected diagram node or edge.
 *
 * Lives alongside the editable form in the editor panel so the user gets:
 *  - A read-only "Inspeccionar" block with every IR-derived metadata
 *    (semantic role/type, criticality, sensitivity, retry policy, related
 *    nodes, …).
 *  - The familiar "Editar" form for the writable fields (label, type,
 *    description, color, edge type, animation).
 *
 * The component is intentionally presentational — it accepts plain data
 * (no hooks, no context) so it can also render inside the export view or
 * a slide-over modal without re-wiring.
 */

import React, { useMemo } from 'react';
import type { Edge, Node } from 'reactflow';
import { resolveEdgeCategoryLabel, resolveNodeCategoryLabel } from '../../lib/diagramCategoryLabels';
import type { DiagramIREdge, DiagramIRNode } from '../../lib/diagram';

interface NodeInspectorProps {
    node: Node;
    nodes: Node[];
    edges: Edge[];
}

interface EdgeInspectorProps {
    edge: Edge;
    nodes: Node[];
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="grid grid-cols-[110px_1fr] gap-x-2 items-start">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 pt-0.5">
            {label}
        </span>
        <span className="text-[12px] text-gray-700 dark:text-gray-200 break-words">{children}</span>
    </div>
);

const Pill: React.FC<{ tone?: 'neutral' | 'info' | 'warning' | 'critical' | 'success'; children: React.ReactNode }> = ({ tone = 'neutral', children }) => {
    const palette: Record<NonNullable<typeof tone>, string> = {
        neutral:  'bg-gray-100 text-gray-700 dark:bg-gray-700/60 dark:text-gray-200',
        info:     'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
        warning:  'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
        critical: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
        success:  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    };
    return (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${palette[tone]}`}>
            {children}
        </span>
    );
};

const SectionHeader: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mt-3 mb-1.5">
        {children}
    </div>
);

const criticalityTone = (criticality?: string): 'neutral' | 'info' | 'warning' | 'critical' => {
    switch (criticality) {
        case 'critical': return 'critical';
        case 'high':     return 'warning';
        case 'medium':   return 'info';
        default:         return 'neutral';
    }
};

const sensitivityTone = (sensitivity?: string): 'neutral' | 'info' | 'warning' | 'critical' => {
    switch (sensitivity) {
        case 'restricted':   return 'critical';
        case 'confidential': return 'warning';
        case 'internal':     return 'info';
        default:             return 'neutral';
    }
};

/**
 * Node inspector — surfaces every IR-derived metadata field and the list of
 * incoming/outgoing edges. The list of related nodes is the most-requested
 * feature: it lets the user pivot through the graph without losing the
 * inspector context.
 */
export const NodeInspector: React.FC<NodeInspectorProps> = ({ node, nodes, edges }) => {
    const data = (node.data ?? {}) as Partial<DiagramIRNode> & { type?: string; category?: string };
    const nodesById = useMemo(() => {
        const map = new Map<string, Node>();
        for (const n of nodes) map.set(n.id, n);
        return map;
    }, [nodes]);

    const incoming = edges.filter((e) => e.target === node.id);
    const outgoing = edges.filter((e) => e.source === node.id);

    const category = data.category ?? resolveNodeCategoryLabel(data as DiagramIRNode);

    return (
        <div className="space-y-1.5">
            <SectionHeader>Inspeccionar</SectionHeader>
            <Field label="Categoría">{category}</Field>
            {data.kind && data.kind !== category && (
                <Field label="Kind (IR)"><code className="text-[11px]">{data.kind}</code></Field>
            )}
            {data.semanticRole && <Field label="Rol semántico"><Pill>{data.semanticRole}</Pill></Field>}
            {data.semanticType && data.semanticType !== 'generic' && (
                <Field label="Tipo semántico"><Pill tone="info">{data.semanticType}</Pill></Field>
            )}
            {data.technology && <Field label="Tecnología">{data.technology}</Field>}
            {data.group && <Field label="Grupo">{data.group}</Field>}
            {data.description && <Field label="Descripción"><span className="block leading-snug">{data.description}</span></Field>}
            {data.status && (
                <Field label="Estado"><Pill tone={data.status === 'error' ? 'critical' : data.status === 'warning' ? 'warning' : 'success'}>{data.status}</Pill></Field>
            )}

            {(incoming.length > 0 || outgoing.length > 0) && (
                <>
                    <SectionHeader>Relaciones</SectionHeader>
                    {outgoing.length > 0 && (
                        <div>
                            <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Salientes ({outgoing.length})</div>
                            <ul className="space-y-1">
                                {outgoing.slice(0, 8).map((e) => {
                                    const target = nodesById.get(e.target);
                                    const targetLabel = (target?.data as { label?: string } | undefined)?.label ?? e.target;
                                    return (
                                        <li key={e.id} className="text-[11px] text-gray-600 dark:text-gray-300 flex items-start gap-1.5">
                                            <span className="text-gray-400">→</span>
                                            <span className="truncate" title={typeof e.label === 'string' ? e.label : targetLabel}>
                                                <strong className="text-gray-800 dark:text-gray-100">{targetLabel}</strong>
                                                {e.label && <span className="ml-1 text-gray-500">· {String(e.label)}</span>}
                                            </span>
                                        </li>
                                    );
                                })}
                                {outgoing.length > 8 && (
                                    <li className="text-[10px] text-gray-400 italic">…y {outgoing.length - 8} más</li>
                                )}
                            </ul>
                        </div>
                    )}
                    {incoming.length > 0 && (
                        <div className="mt-2">
                            <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Entrantes ({incoming.length})</div>
                            <ul className="space-y-1">
                                {incoming.slice(0, 8).map((e) => {
                                    const source = nodesById.get(e.source);
                                    const sourceLabel = (source?.data as { label?: string } | undefined)?.label ?? e.source;
                                    return (
                                        <li key={e.id} className="text-[11px] text-gray-600 dark:text-gray-300 flex items-start gap-1.5">
                                            <span className="text-gray-400">←</span>
                                            <span className="truncate" title={typeof e.label === 'string' ? e.label : sourceLabel}>
                                                <strong className="text-gray-800 dark:text-gray-100">{sourceLabel}</strong>
                                                {e.label && <span className="ml-1 text-gray-500">· {String(e.label)}</span>}
                                            </span>
                                        </li>
                                    );
                                })}
                                {incoming.length > 8 && (
                                    <li className="text-[10px] text-gray-400 italic">…y {incoming.length - 8} más</li>
                                )}
                            </ul>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

/**
 * Edge inspector — surfaces the full IR metadata for a relationship.
 */
export const EdgeInspector: React.FC<EdgeInspectorProps> = ({ edge, nodes }) => {
    const data = (edge.data ?? {}) as Partial<DiagramIREdge> & {
        edgeType?: string;
        protocol?: string;
        criticality?: 'low' | 'medium' | 'high' | 'critical';
        dataSensitivity?: 'public' | 'internal' | 'confidential' | 'restricted';
        retryPolicy?: string;
        direction?: 'unidirectional' | 'bidirectional';
        semanticType?: string;
    };

    const source = nodes.find((n) => n.id === edge.source);
    const target = nodes.find((n) => n.id === edge.target);
    const sourceLabel = (source?.data as { label?: string } | undefined)?.label ?? edge.source;
    const targetLabel = (target?.data as { label?: string } | undefined)?.label ?? edge.target;

    const category = resolveEdgeCategoryLabel({
        protocol: data.protocol,
        semanticType: data.semanticType as DiagramIREdge['semanticType'],
        relation: data.edgeType as DiagramIREdge['relation'],
        label: edge.label as string | undefined,
    });

    return (
        <div className="space-y-1.5">
            <SectionHeader>Inspeccionar</SectionHeader>
            <Field label="Origen"><strong>{sourceLabel}</strong></Field>
            <Field label="Destino"><strong>{targetLabel}</strong></Field>
            {category && <Field label="Mecanismo">{category}</Field>}
            {data.edgeType && <Field label="Relación"><Pill>{data.edgeType}</Pill></Field>}
            {data.semanticType && data.semanticType !== 'generic' && (
                <Field label="Tipo semántico"><Pill tone="info">{data.semanticType}</Pill></Field>
            )}
            {data.protocol && <Field label="Protocolo"><code className="text-[11px]">{data.protocol}</code></Field>}
            {data.direction && (
                <Field label="Dirección"><Pill>{data.direction === 'bidirectional' ? '↔ Bidireccional' : '→ Unidireccional'}</Pill></Field>
            )}
            {data.criticality && (
                <Field label="Criticidad"><Pill tone={criticalityTone(data.criticality)}>{data.criticality}</Pill></Field>
            )}
            {data.dataSensitivity && (
                <Field label="Sensibilidad"><Pill tone={sensitivityTone(data.dataSensitivity)}>{data.dataSensitivity}</Pill></Field>
            )}
            {data.retryPolicy && <Field label="Reintentos"><span className="block leading-snug">{data.retryPolicy}</span></Field>}
            {edge.label && (
                <Field label="Etiqueta completa"><span className="block leading-snug">{String(edge.label)}</span></Field>
            )}
        </div>
    );
};
