import React from 'react';
import { Modal } from './Modal';
import { SparklesIcon, ArrowPathIcon } from './Icons';

interface VersionConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  artifactName: string;
  onGenerateNewVersion: () => void;
  onReplaceExisting: () => void;
}

export const VersionConflictModal: React.FC<VersionConflictModalProps> = ({
  isOpen,
  onClose,
  artifactName,
  onGenerateNewVersion,
  onReplaceExisting
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Artefacto Existente">
      <div className="space-y-4">
        <p className="text-gray-600 dark:text-gray-400">
          El artefacto llamado <strong className="text-gray-900 dark:text-white">{artifactName}</strong> ya existe en este proyecto. ¿Qué te gustaría hacer?
        </p>
        <div className="flex justify-end space-x-4 pt-4">
          <button
            onClick={onReplaceExisting}
            className="px-4 py-2 flex items-center bg-gray-200 dark:bg-gray-600 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 font-semibold text-gray-800 dark:text-gray-100"
          >
            <ArrowPathIcon className="h-5 w-5 mr-2" />
            Reemplazar Existente
          </button>
          <button
            onClick={onGenerateNewVersion}
            className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-semibold flex items-center shadow-sm"
          >
            <SparklesIcon className="h-5 w-5 mr-2" />
            Generar Nueva Versión
          </button>
        </div>
      </div>
    </Modal>
  );
};
