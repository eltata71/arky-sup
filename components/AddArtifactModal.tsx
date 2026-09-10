import React, { useState, useMemo, useEffect } from 'react';
import { Modal } from './Modal';
import { useAppContext } from '../context/AppContext';
import { ArtifactTemplate } from '../types';
import { ARTIFACT_TEMPLATES } from '../constants';
import { ArrowUturnLeftIcon, SparklesIcon } from './Icons';

interface AddArtifactModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (template: ArtifactTemplate) => void;
}

export const AddArtifactModal: React.FC<AddArtifactModalProps> = ({ isOpen, onClose, onGenerate }) => {
    const { t } = useAppContext();
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedTemplate, setSelectedTemplate] = useState<ArtifactTemplate | null>(null);

    useEffect(() => {
        // Reset state when modal is closed
        if (!isOpen) {
            setSearchTerm('');
            setSelectedTemplate(null);
        }
    }, [isOpen]);

    const groupedArtifacts = useMemo(() => {
        const filtered = ARTIFACT_TEMPLATES.filter(template =>
            template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            template.objective.toLowerCase().includes(searchTerm.toLowerCase())
        );

        return filtered.reduce((acc, template) => {
            (acc[template.phase] = acc[template.phase] || []).push(template);
            return acc;
        }, {} as Record<string, ArtifactTemplate[]>);
    }, [searchTerm]);

    const handleGenerate = () => {
        if (selectedTemplate) {
            onGenerate(selectedTemplate);
        }
    };
    
    const renderTemplateSelection = () => (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="flex-shrink-0 mb-4">
                <input
                    type="text"
                    placeholder={t('searchArtifact')}
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
            </div>
            <div className="flex-1 overflow-y-auto pr-2 min-h-0">
                {Object.keys(groupedArtifacts).map((phase) => {
                    const templates = groupedArtifacts[phase];
                    if (!Array.isArray(templates) || templates.length === 0) {
                        return null;
                    }
                    return (
                        <div key={phase} className="mb-4">
                            <h3 className="text-sm font-bold uppercase text-gray-500 dark:text-gray-400 mb-2 sticky top-0 bg-white dark:bg-gray-800 py-1 z-10">{phase}</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {templates.map(template => (
                                    <button
                                        key={template.name}
                                        onClick={() => setSelectedTemplate(template)}
                                        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-left hover:border-primary-500 dark:hover:border-primary-500 hover:shadow-md transition-all duration-200"
                                    >
                                        <h4 className="font-bold text-gray-900 dark:text-white">{template.name}</h4>
                                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{template.objective}</p>
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );

    const renderTemplateDetails = () => {
        if (!selectedTemplate) return null;

        return (
            <div className="flex flex-col h-full overflow-hidden">
                <div className="flex-shrink-0 mb-4">
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-white leading-tight">{selectedTemplate.name}</h3>
                </div>
                
                <div className="flex-1 overflow-y-auto pr-2 space-y-6 text-sm min-h-0">
                    <div>
                        <h4 className="font-semibold text-gray-800 dark:text-gray-200">{t('objective')}</h4>
                        <p className="text-gray-600 dark:text-gray-400 mt-1">{selectedTemplate.objective}</p>
                    </div>
                    
                    <div>
                        <h4 className="font-semibold text-gray-800 dark:text-gray-200">{t('keyConcepts')}</h4>
                        <ul className="list-disc list-inside mt-2 space-y-2 text-gray-600 dark:text-gray-400">
                            {selectedTemplate.keyConcepts.map(concept => (
                                <li key={concept.term}>
                                    <strong className="text-gray-700 dark:text-gray-300">{concept.term}:</strong> {concept.definition}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                <div className="flex-shrink-0 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center bg-white dark:bg-gray-800">
                    <button
                        onClick={() => setSelectedTemplate(null)}
                        className="px-4 py-3 flex items-center bg-gray-200 dark:bg-gray-600 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 font-semibold text-gray-800 dark:text-gray-100"
                    >
                        <ArrowUturnLeftIcon className="h-5 w-5 mr-2" />
                        {t('back')}
                    </button>
                    <button
                        onClick={handleGenerate}
                        className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-semibold flex items-center shadow-sm"
                    >
                        <SparklesIcon className="h-5 w-5 mr-2" />
                        {t('generateArtifact')}
                    </button>
                </div>
            </div>
        );
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={selectedTemplate ? t('createArtifactTitle', { templateName: selectedTemplate.name }) : t('addArtifact')}>
           {selectedTemplate ? renderTemplateDetails() : renderTemplateSelection()}
        </Modal>
    );
};