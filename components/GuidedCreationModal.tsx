import React, { useState, useMemo } from 'react';
import { Modal } from './Modal';
import { useAppContext } from '../context/AppContext';
import { Template } from '../types';
import { PROJECT_TEMPLATES } from '../constants';

interface TemplateSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (template: Template) => void;
}

export const TemplateSelectionModal: React.FC<TemplateSelectionModalProps> = ({ isOpen, onClose, onSelect }) => {
  const { t } = useAppContext();
  const [searchTerm, setSearchTerm] = useState('');

  const groupedTemplates = useMemo(() => {
    const filtered = Object.entries(PROJECT_TEMPLATES).reduce((acc, [category, templates]) => {
      const filteredTemplates = templates.filter(template =>
        template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        template.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        category.toLowerCase().includes(searchTerm.toLowerCase())
      );
      if (filteredTemplates.length > 0) {
        acc[category] = filteredTemplates;
      }
      return acc;
    }, {} as Record<string, Template[]>);
    return filtered;
  }, [searchTerm]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('startFromTemplate')}>
      {/* Changed h-[70vh] to h-full */}
      <div className="flex flex-col h-full">
        <input
          type="text"
          placeholder="Buscar plantilla..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 mb-4 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <div className="flex-grow overflow-y-auto pr-2">
          {Object.keys(groupedTemplates).length > 0 ? Object.entries(groupedTemplates).map(([category, templates]: [string, Template[]]) => (
            <div key={category} className="mb-4">
              <h3 className="text-sm font-bold uppercase text-gray-500 dark:text-gray-400 mb-2 sticky top-0 bg-white dark:bg-gray-800 py-1">{category}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {templates.map(template => (
                  <button
                    key={template.name}
                    onClick={() => onSelect(template)}
                    className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-left hover:border-primary-500 dark:hover:border-primary-500 hover:shadow-md transition-all duration-200"
                  >
                    <h4 className="font-bold text-gray-900 dark:text-white">{template.name}</h4>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{template.description}</p>
                  </button>
                ))}
              </div>
            </div>
          )) : (
            <p className="text-center text-gray-500">No se encontraron plantillas.</p>
          )}
        </div>
      </div>
    </Modal>
  );
};