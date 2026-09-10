import React, { useState, useEffect, useRef } from 'react';
import { Modal } from './Modal';
import { useAppContext } from '../context/AppContext';
import { Project, ConsistencySuggestion } from '../types';
import { assistantService } from '../services/ai';
import { CheckCircleIcon } from './Icons';

interface ConsistencyCheckModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
}

export const ConsistencyCheckModal: React.FC<ConsistencyCheckModalProps> = ({ isOpen, onClose, project }) => {
    const { settings, applyConsistencySuggestion, getArtifact } = useAppContext();
    const [isLoading, setIsLoading] = useState(true);
    const [suggestions, setSuggestions] = useState<ConsistencySuggestion[]>([]);
    const isMounted = useRef(true);

    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
        };
    }, []);

    useEffect(() => {
        const runCheck = async () => {
            if (isOpen) {
                setIsLoading(true);
                try {
                    const results = await assistantService.runConsistencyCheck(project, settings);
                    if (isMounted.current) {
                        setSuggestions(results);
                    }
                } catch (e) {
                    console.error("Error during consistency check:", e);
                } finally {
                    if (isMounted.current) {
                        setIsLoading(false);
                    }
                }
            }
        };
        runCheck();
    }, [isOpen, project, settings]);
    
    const handleApplySuggestion = (suggestion: ConsistencySuggestion) => {
        applyConsistencySuggestion(project.id, suggestion);
        // Update local state to show it's applied
        setSuggestions(prev => prev.map(s => s.id === suggestion.id ? { ...s, isApplied: true } : s));
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Análisis de Consistencia del Proyecto">
            {/* Changed h-[70vh] to h-full */}
            <div className="flex flex-col h-full">
                {isLoading ? (
                    <div className="flex-1 flex flex-col items-center justify-center">
                        <svg className="animate-spin h-10 w-10 text-primary-600 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <p className="text-lg">Analizando artefactos en busca de inconsistencias...</p>
                    </div>
                ) : suggestions.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center">
                        <CheckCircleIcon className="h-16 w-16 text-green-500 mb-4" />
                        <h3 className="text-xl font-bold">¡Todo en orden!</h3>
                        <p className="text-gray-500 mt-2">No se encontraron inconsistencias en el proyecto.</p>
                    </div>
                ) : (
                    <div className="flex-grow overflow-y-auto pr-2 space-y-4">
                        {suggestions.map(suggestion => (
                            <div key={suggestion.id} className="p-4 bg-gray-100 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                                <h4 className="font-bold text-red-600 dark:text-red-400">Inconsistencia Detectada:</h4>
                                <p className="text-sm mb-2">{suggestion.inconsistency}</p>
                                
                                <h4 className="font-bold text-green-600 dark:text-green-400">Sugerencia:</h4>
                                <p className="text-sm mb-3">{suggestion.suggestion}</p>

                                <div className="text-xs mb-3">
                                    {suggestion.changes.map((change, index) => (
                                        <span key={index} className="inline-block bg-primary-100 dark:bg-primary-900/50 text-primary-800 dark:text-primary-200 rounded-full px-2 py-0.5 mr-2">
                                            Afecta a: {getArtifact(project.id, change.artifactId)?.name || 'Artefacto desconocido'}
                                        </span>
                                    ))}
                                </div>
                                
                                <button
                                    onClick={() => handleApplySuggestion(suggestion)}
                                    disabled={suggestion.isApplied}
                                    className="px-3 py-1 text-sm font-semibold text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                                >
                                    {suggestion.isApplied ? 'Aplicado' : 'Aplicar Sugerencia'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Modal>
    );
};