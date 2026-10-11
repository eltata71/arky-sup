import { type Node, type Edge, MarkerType, useReactFlow } from 'reactflow';
import { XMarkIcon } from '../Icons';
import { EdgeInspector, NodeInspector } from '../diagram/DiagramInspectorSection';
import { useAppContext } from '../../context/AppContext';

interface CanvasEditorPanelProps {
    selectedNode: Node | null;
    selectedEdge: Edge | null;
    nodes: Node[];
    edges: Edge[];
    inspectorPinned: boolean;
    onTogglePinned: () => void;
    onClose: () => void;
    focusNeighbors: () => void;
    clearFocusFilters: () => void;
    duplicateSelectedNode: () => void;
    updateNodeData: (id: string, data: Record<string, unknown>) => void;
    updateEdgeData: (id: string, data: Record<string, unknown>) => void;
}

export function CanvasEditorPanel({ selectedNode, selectedEdge, nodes, edges, inspectorPinned, onTogglePinned, onClose, focusNeighbors, clearFocusFilters, duplicateSelectedNode, updateNodeData, updateEdgeData }: CanvasEditorPanelProps) {
    const reactFlowInstance = useReactFlow();
    const { t } = useAppContext();
    return (

                <div className="diagram-editor-panel absolute top-4 right-4 w-96 bg-white/95 dark:bg-gray-800/95 backdrop-blur-md rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-20 flex flex-col max-h-[calc(100%-2rem)] overflow-hidden animate-fade-in">
                    <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700">
                        <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
                            {selectedNode ? t('diagramEditor.nodeTitle') : t('diagramEditor.edgeTitle')}
                        </h3>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => onTogglePinned()}
                                className="text-[10px] px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"
                                aria-label={inspectorPinned ? t('diagramEditor.unpin') : t('diagramEditor.pin')}
                            >
                                {inspectorPinned ? t('diagramEditor.unpinShort') : t('diagramEditor.pinShort')}
                            </button>
                        <button onClick={() => { if (inspectorPinned) return; onClose(); }} aria-label={t('diagramEditor.close')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                            <XMarkIcon className="w-5 h-5" />
                        </button>
                        </div>
                    </div>
                    <div className="p-4 overflow-y-auto flex-1 space-y-4">
                        {selectedNode && (
                            <>
                                <NodeInspector node={selectedNode} nodes={nodes} edges={edges} />
                                <div className="border-t border-gray-100 dark:border-gray-700 -mx-4" />
                                <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">{t('diagramEditor.edit')}</div>
                                <div className="flex flex-wrap gap-2">
                                    <button type="button" onClick={focusNeighbors} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">{t('diagramEditor.focusNeighbors')}</button>
                                    <button type="button" onClick={clearFocusFilters} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">{t('diagramEditor.showSecondary')}</button>
                                    <button
                                        type="button"
                                        onClick={duplicateSelectedNode}
                                        className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700"
                                        title={t('diagramEditor.duplicateTitle')}
                                    >
                                        {t('diagramEditor.duplicate')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!selectedNode) return;
                                            try {
                                                reactFlowInstance.deleteElements({ nodes: [{ id: selectedNode.id }] });
                                            } catch { /* deleteElements unavailable in this ReactFlow build */ }
                                        }}
                                        className="text-xs px-2 py-1 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                                        title={t('diagramEditor.deleteNodeTitle')}
                                    >
                                        {t('diagramEditor.delete')}
                                    </button>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('diagramEditor.name')}</label>
                                    <input
                                        type="text"
                                        value={selectedNode.data.label || ''}
                                        onChange={(e) => updateNodeData(selectedNode.id, { label: e.target.value })}
                                        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('diagramEditor.typeTechnology')}</label>
                                    <input
                                        type="text"
                                        value={selectedNode.data.type || ''}
                                        onChange={(e) => updateNodeData(selectedNode.id, { type: e.target.value })}
                                        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:text-white"
                                        placeholder={t('diagramEditor.technologyExample')}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('diagramEditor.description')}</label>
                                    <textarea
                                        value={selectedNode.data.description || ''}
                                        onChange={(e) => updateNodeData(selectedNode.id, { description: e.target.value })}
                                        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:text-white resize-none h-24"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('diagramEditor.customColor')}</label>
                                    <input
                                        type="color"
                                        value={selectedNode.data.color || '#ffffff'}
                                        onChange={(e) => updateNodeData(selectedNode.id, { color: e.target.value })}
                                        className="w-full h-10 p-1 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg cursor-pointer"
                                    />
                                    <button
                                        onClick={() => updateNodeData(selectedNode.id, { color: undefined })}
                                        className="mt-1 text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400"
                                    >
                                        {t('diagramEditor.resetColor')}
                                    </button>
                                </div>
                            </>
                        )}
                        {selectedEdge && (
                            <>
                                <EdgeInspector edge={selectedEdge} nodes={nodes} />
                                <div className="border-t border-gray-100 dark:border-gray-700 -mx-4" />
                                <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">{t('diagramEditor.edit')}</div>
                                <div className="flex flex-wrap gap-2">
                                    <button type="button" onClick={focusNeighbors} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">{t('diagramEditor.focusNeighbors')}</button>
                                    <button type="button" onClick={clearFocusFilters} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">{t('diagramEditor.showSecondary')}</button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!selectedEdge) return;
                                            try {
                                                reactFlowInstance.deleteElements({ edges: [{ id: selectedEdge.id }] });
                                            } catch { /* deleteElements unavailable in this ReactFlow build */ }
                                        }}
                                        className="text-xs px-2 py-1 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                                        title={t('diagramEditor.deleteEdgeTitle')}
                                    >
                                        {t('diagramEditor.delete')}
                                    </button>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('diagramEditor.edgeLabel')}</label>
                                    <input
                                        type="text"
                                        value={selectedEdge.label as string || ''}
                                        onChange={(e) => updateEdgeData(selectedEdge.id, { label: e.target.value })}
                                        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('diagramEditor.relationType')}</label>
                                    <select
                                        value={selectedEdge.data?.edgeType || 'default'}
                                        onChange={(e) => updateEdgeData(selectedEdge.id, { data: { ...selectedEdge.data, edgeType: e.target.value } })}
                                        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:text-white"
                                    >
                                        <option value="default">{t('diagramEditor.default')}</option>
                                        <option value="sync">{t('diagramEditor.sync')}</option>
                                        <option value="async">{t('diagramEditor.async')}</option>
                                        <option value="data-flow">{t('diagramEditor.dataFlow')}</option>
                                        <option value="dependency">{t('diagramEditor.dependency')}</option>
                                        <option value="inheritance">{t('diagramEditor.inheritance')}</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('diagramEditor.edgeColor')}</label>
                                    <input
                                        type="color"
                                        value={selectedEdge.style?.stroke || '#64748b'}
                                        onChange={(e) => updateEdgeData(selectedEdge.id, {
                                            style: { ...selectedEdge.style, stroke: e.target.value },
                                            markerEnd: { type: MarkerType.ArrowClosed, color: e.target.value }
                                        })}
                                        className="w-full h-10 p-1 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg cursor-pointer"
                                    />
                                </div>
                                <div className="flex items-center mt-2">
                                    <input
                                        type="checkbox"
                                        id="animated-edge"
                                        checked={selectedEdge.data?.animated || false}
                                        onChange={(e) => updateEdgeData(selectedEdge.id, { data: { ...selectedEdge.data, animated: e.target.checked } })}
                                        className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                                    />
                                    <label htmlFor="animated-edge" className="ml-2 block text-sm text-gray-900 dark:text-gray-300">
                                        {t('diagramEditor.animateFlow')}
                                    </label>
                                </div>
                            </>
                        )}
                    </div>
                </div>

    );
}
