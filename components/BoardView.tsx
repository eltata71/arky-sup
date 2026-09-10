import React, { useState, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { Project, Artifact } from '../types';
import { KANBAN_COLUMNS } from '../constants';
import { DocumentTextIcon, DiagramIcon } from './Icons';

interface BoardViewProps {
  project: Project;
  onSelectArtifact: (artifactId: string) => void;
}

const ArtifactCard: React.FC<{ artifact: Artifact; onSelectArtifact: (id: string) => void; }> = ({ artifact, onSelectArtifact }) => {
    const isDiagram = artifact.representation === 'diagram' || artifact.representation === 'hybrid';

    return (
        <button
            onClick={() => onSelectArtifact(artifact.id)}
            className="w-full text-left bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-100 dark:border-gray-800 shadow-sm active:scale-95 hover:border-primary-500 dark:hover:border-primary-500 hover:shadow-md transition-all duration-200 flex flex-col h-full"
        >
            <div className="flex items-start justify-between mb-3">
                 <div className={`p-2 rounded-xl ${isDiagram ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
                    {isDiagram ? <DiagramIcon className="h-6 w-6"/> : <DocumentTextIcon className="h-6 w-6"/> }
                </div>
                {artifact.isFavorite && <div className="h-2 w-2 rounded-full bg-amber-400 shadow-sm ring-2 ring-white dark:ring-gray-800"></div>}
            </div>
            
            <h4 className="font-bold text-lg text-gray-900 dark:text-white mb-2 leading-tight line-clamp-2">{artifact.name}</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-3 leading-relaxed flex-grow">{artifact.objective}</p>
            
            <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700/50 flex justify-between items-center opacity-70 w-full">
                <span className="text-[10px] uppercase font-bold tracking-wider text-gray-400 bg-gray-50 dark:bg-gray-900 px-2 py-1 rounded">v{artifact.version}</span>
                <span className="text-[10px] text-gray-400">{new Date(artifact.createdAt).toLocaleDateString()}</span>
            </div>
        </button>
    );
};

export const BoardView: React.FC<BoardViewProps> = ({ project, onSelectArtifact }) => {
    const { getGroupedArtifactsByView } = useAppContext();
    const [selectedPhase, setSelectedPhase] = useState<string>('Todos');

    const latestArtifacts = useMemo(() => {
        const grouped = getGroupedArtifactsByView(project.id);
        return Object.values(grouped).flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [project.id, getGroupedArtifactsByView]);

    const filteredArtifacts = useMemo(() => {
        if (selectedPhase === 'Todos') return latestArtifacts;
        return latestArtifacts.filter(a => a.phase === selectedPhase);
    }, [latestArtifacts, selectedPhase]);

    // Shorten phase names for mobile chips
    const shortPhaseName = (phase: string) => {
        if (phase.includes('Fase 1')) return 'Estrategia';
        if (phase.includes('Fase 2')) return 'Diseño Lógico';
        if (phase.includes('Fase 3')) return 'Diseño Físico';
        if (phase.includes('Fase 4')) return 'Implementación';
        return phase;
    };

    return (
        <div className="flex flex-col h-full bg-gray-50 dark:bg-black">
            {/* Filter Chips - Horizontal Scroll */}
            <div className="flex-shrink-0 px-4 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 overflow-x-auto no-scrollbar">
                <div className="flex space-x-2">
                    <button
                        onClick={() => setSelectedPhase('Todos')}
                        className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${
                            selectedPhase === 'Todos' 
                            ? 'bg-gray-900 text-white dark:bg-white dark:text-black' 
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        }`}
                    >
                        Todos ({latestArtifacts.length})
                    </button>
                    {KANBAN_COLUMNS.map(phase => (
                        <button
                            key={phase}
                            onClick={() => setSelectedPhase(phase)}
                            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${
                                selectedPhase === phase 
                                ? 'bg-primary-600 text-white shadow-md shadow-primary-500/30' 
                                : 'bg-white border border-gray-200 text-gray-600 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400'
                            }`}
                        >
                            {shortPhaseName(phase)}
                        </button>
                    ))}
                </div>
            </div>

            {/* Gallery Grid */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {filteredArtifacts.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-20">
                        {filteredArtifacts.map(artifact => (
                            <ArtifactCard
                                key={artifact.id}
                                artifact={artifact}
                                onSelectArtifact={onSelectArtifact}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-64 text-center">
                        <div className="w-16 h-16 bg-gray-100 dark:bg-gray-900 rounded-full flex items-center justify-center mb-4">
                            <DocumentTextIcon className="h-8 w-8 text-gray-300 dark:text-gray-700" />
                        </div>
                        <p className="text-gray-500 dark:text-gray-400 font-medium">No hay artefactos en esta fase.</p>
                    </div>
                )}
            </div>
        </div>
    );
};