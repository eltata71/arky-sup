import { useUiTranslation } from '../lib/i18n/UiTranslationContext';
import React, { useState, useEffect, useRef } from 'react';
import { Modal } from './Modal';
import { useAppContext, type Project } from '../context/AppContext';
import { ConsistencySuggestion } from '../types';
import { assistantService } from '../services/ai/lazy';
import { useAiUndo } from '../hooks/artifacts/useAiUndo';
import { CheckCircleIcon } from './Icons';
import { Skeleton, SkeletonGroup } from './ui/Skeleton';

interface ConsistencyCheckModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
}

export const ConsistencyCheckModal: React.FC<ConsistencyCheckModalProps> = ({ isOpen, onClose, project }) => {
  const t = useUiTranslation();
    const { settings, applyConsistencySuggestion, getArtifact } = useAppContext();
    const { offerUndo } = useAiUndo();
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
        const before = suggestion.changes.flatMap(change => {
            const target = getArtifact(project.id, change.artifactId);
            if (!target) return [];
            const latest = project.artifacts
                .filter(a => a.versionGroupId === target.versionGroupId)
                .reduce((top, a) => (a.version > top.version ? a : top), target);
            return [latest];
        });
        const produced = applyConsistencySuggestion(project.id, suggestion);
        if (produced.length > 0) {
            offerUndo({
                projectId: project.id,
                label: t("corrección de consistencia"),
                steps: produced.map(version => ({
                    producedId: version.id,
                    before: before.find(b => b.versionGroupId === version.versionGroupId) ?? version,
                })),
                onUndone: () => setSuggestions(prev => prev.map(s => s.id === suggestion.id ? { ...s, isApplied: false } : s)),
            }, 'Corrección aplicada como versión nueva.');
        }
        // Update local state to show it's applied
        setSuggestions(prev => prev.map(s => s.id === suggestion.id ? { ...s, isApplied: true } : s));
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t("consistencyCheckTitle")}>
            {/* Changed h-[70vh] to h-full */}
            <div className="flex flex-col h-full">
                {isLoading ? (
                    <SkeletonGroup label={t("analyzing")} className="flex-1 space-y-4">
                        {Array.from({ length: 3 }, (_, index) => (
                            <div key={index} className="space-y-2 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                                <Skeleton className="h-5 w-1/3" />
                                <Skeleton shape="text" lines={2} />
                            </div>
                        ))}
                    </SkeletonGroup>
                ) : suggestions.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center">
                        <CheckCircleIcon className="h-16 w-16 text-green-500 mb-4" />
                        <h3 className="text-xl font-bold">{t("allGood")}</h3>
                        <p className="text-gray-500 mt-2">{t("noInconsistencies")}</p>
                    </div>
                ) : (
                    <div className="flex-grow overflow-y-auto pr-2 space-y-4">
                        {suggestions.map(suggestion => (
                            <div key={suggestion.id} className="p-4 bg-gray-100 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                                <h4 className="font-bold text-red-600 dark:text-red-400">{t("inconsistencyDetected")}</h4>
                                <p className="text-sm mb-2">{suggestion.inconsistency}</p>
                                
                                <h4 className="font-bold text-green-600 dark:text-green-400">{t("suggestion")}</h4>
                                <p className="text-sm mb-3">{suggestion.suggestion}</p>

                                <div className="text-xs mb-3">
                                    {suggestion.changes.map((change, index) => (
                                        <span key={index} className="inline-block bg-primary-100 dark:bg-primary-900/50 text-primary-800 dark:text-primary-200 rounded-full px-2 py-0.5 mr-2">
                                            {t("ui.afecta-a.4e5ff8")} {getArtifact(project.id, change.artifactId)?.name || t("uiExpr.artefacto-desconocido.13af2a")}
                                        </span>
                                    ))}
                                </div>
                                
                                <button
                                    onClick={() => handleApplySuggestion(suggestion)}
                                    disabled={suggestion.isApplied}
                                    className="px-3 py-1 text-sm font-semibold text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                                >
                                    {suggestion.isApplied ? t("applied") : t("applySuggestion")}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Modal>
    );
};
