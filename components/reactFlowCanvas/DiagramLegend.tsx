/**
 * The diagram legend.
 */

import React, { useMemo } from 'react';
import { getEdgeCategoryLabel, getNodeCategoryLabel, type EdgeSemanticType, type NodeSemanticType } from '../../lib/diagramCategoryLabels';

// Diagram Legend Component
//
// The legend used to be a static dictionary that listed every supported
// node shape and edge relation, regardless of whether the current diagram
// contained those types. That produced a noisy panel (e.g. "Person / User"
// on a pure container diagram with no actors) and contradicted the user-
// facing taxonomy on insurance / PBM diagrams.
//
// The new legend is built from the IR types actually present on the
// canvas: the canvas hands a {nodeTypes, edgeTypes} bag, and the legend
// renders only the rows that match. Empty diagrams keep a sane minimal
// fallback so the panel never looks broken.

const ROLE_LEGEND_PALETTE: Record<string, { color: string; shape: string }> = {
    person:    { color: '#3b82f6', shape: 'person' },
    system:    { color: '#6366f1', shape: 'rectangle' },
    gateway:   { color: '#8b5cf6', shape: 'diamond' },
    data:      { color: '#10b981', shape: 'cylinder' },
    messaging: { color: '#eab308', shape: 'rectangle' },
    external:  { color: '#0ea5e9', shape: 'cloud' },
    service:   { color: '#6366f1', shape: 'hexagon' },
    process:   { color: '#ec4899', shape: 'rectangle' },
    generic:   { color: '#64748b', shape: 'rectangle' },
};

const SEMANTIC_TYPE_TO_ROLE: Partial<Record<NodeSemanticType, keyof typeof ROLE_LEGEND_PALETTE>> = {
    'human-actor':           'person',
    'business-role':         'person',
    'internal-system':       'system',
    'external-system':       'external',
    'legacy-system':         'system',
    'application':           'system',
    'portal':                'service',
    'api':                   'gateway',
    'service':               'service',
    'microservice':          'service',
    'component':             'service',
    'c4-container':          'system',
    'database':              'data',
    'document-repository':   'data',
    'integration-platform':  'gateway',
    'messaging':             'messaging',
    'cloud-service':         'external',
    'security-service':      'service',
    'notification-service':  'service',
    'rules-engine':          'service',
    'business-process':      'process',
    'external-provider':     'external',
    'digital-channel':       'service',
    'batch-file':            'messaging',
    'report':                'data',
    'dashboard':             'data',
    'data-product':          'data',
    'analytics-system':      'data',
    'generic':               'generic',
};

const EDGE_RELATION_LEGEND: Record<string, { color: string; dash: string | undefined; label: string; animated: boolean }> = {
    sync:        { color: '#6366f1', dash: undefined, label: 'Sincrónico (HTTP/REST)', animated: false },
    async:       { color: '#f59e0b', dash: '8 4',      label: 'Asíncrono (Eventos/Cola)', animated: true },
    'data-flow': { color: '#06b6d4', dash: undefined, label: 'Flujo de Datos', animated: true },
    dependency:  { color: '#94a3b8', dash: '4 4',      label: 'Dependencia / Referencia', animated: false },
    inheritance: { color: '#8b5cf6', dash: undefined, label: 'Composición / Herencia', animated: false },
    default:     { color: '#475569', dash: undefined, label: 'Relación', animated: false },
};

export interface LegendData {
    nodeTypes: NodeSemanticType[];
    edgeRelations: string[];
    edgeTypes: EdgeSemanticType[];
}

export const DiagramLegend: React.FC<{ show: boolean; onToggle: () => void; legendData: LegendData }> = ({ show, onToggle, legendData }) => {
    // De-dupe + cap to the most informative dozen so the panel never grows
    // taller than the canvas. Stable ordering keeps the panel from flickering
    // between renders.
    const rows = useMemo(() => {
        const dedupedNodeTypes = Array.from(new Set(legendData.nodeTypes)).slice(0, 12);
        const dedupedRelations = Array.from(new Set(legendData.edgeRelations)).slice(0, 6);
        const dedupedEdgeTypes = Array.from(new Set(legendData.edgeTypes)).filter((t) => t !== 'generic').slice(0, 8);
        return { dedupedNodeTypes, dedupedRelations, dedupedEdgeTypes };
    }, [legendData]);

    const showFallback = rows.dedupedNodeTypes.length === 0 && rows.dedupedRelations.length === 0;

    return (
        <div className="absolute bottom-20 right-4 z-20">
            <button
                onClick={onToggle}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-xl shadow-lg border border-gray-200/80 dark:border-gray-700/80 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-all"
                title="Mostrar / ocultar leyenda"
            >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                Leyenda
            </button>
            {show && (
                <div className="absolute bottom-full right-0 mb-2 w-64 max-h-[60vh] overflow-y-auto bg-white/95 dark:bg-gray-800/95 backdrop-blur-md rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-3 animate-fade-in">
                    {rows.dedupedNodeTypes.length > 0 && (
                        <>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-2">Tipos de elemento</p>
                            <div className="space-y-1.5 mb-3">
                                {rows.dedupedNodeTypes.map((type) => {
                                    const role = SEMANTIC_TYPE_TO_ROLE[type] ?? 'generic';
                                    const palette = ROLE_LEGEND_PALETTE[role];
                                    return (
                                        <div key={type} className="flex items-center gap-2">
                                            <span className="w-4 h-4 rounded flex-shrink-0 border-2" style={{ borderColor: palette.color, backgroundColor: `${palette.color}18` }} />
                                            <span className="text-[11px] text-gray-600 dark:text-gray-300">{getNodeCategoryLabel(type)}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                    {rows.dedupedRelations.length > 0 && (
                        <>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-2">Tipos de conexión</p>
                            <div className="space-y-1.5 mb-3">
                                {rows.dedupedRelations.map((relation) => {
                                    const entry = EDGE_RELATION_LEGEND[relation] ?? EDGE_RELATION_LEGEND.default;
                                    return (
                                        <div key={relation} className="flex items-center gap-2">
                                            <svg width="28" height="10" className="flex-shrink-0">
                                                <line x1="0" y1="5" x2="28" y2="5"
                                                    stroke={entry.color}
                                                    strokeWidth={entry.animated ? 2.5 : 1.5}
                                                    strokeDasharray={entry.dash}
                                                />
                                                <polygon points="22,2 28,5 22,8" fill={entry.color} />
                                            </svg>
                                            <span className="text-[11px] text-gray-600 dark:text-gray-300">{entry.label}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                    {rows.dedupedEdgeTypes.length > 0 && (
                        <>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-2">Mecanismos de integración</p>
                            <div className="flex flex-wrap gap-1.5">
                                {rows.dedupedEdgeTypes.map((type) => (
                                    <span
                                        key={type}
                                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300"
                                    >
                                        {getEdgeCategoryLabel(type)}
                                    </span>
                                ))}
                            </div>
                        </>
                    )}
                    {showFallback && (
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 italic">
                            La leyenda se completará cuando el diagrama tenga nodos clasificados.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};
