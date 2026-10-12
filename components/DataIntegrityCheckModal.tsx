import { useUiTranslation } from '../lib/i18n/UiTranslationContext';
import React from 'react';
import type { Artifact } from '../lib/artifacts';
import { ExclamationTriangleIcon, TrashIcon } from './Icons';

interface DataIntegrityCheckModalProps {
  corruptArtifacts: Artifact[];
  onConfirm: () => void;
}

export const DataIntegrityCheckModal: React.FC<DataIntegrityCheckModalProps> = ({ corruptArtifacts, onConfirm }) => {
  const t = useUiTranslation();
  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-80 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-2xl transform transition-all p-8 border-t-4 border-yellow-500">
        <div className="flex items-start">
            <div className="flex-shrink-0">
                <ExclamationTriangleIcon className="h-10 w-10 text-yellow-500" />
            </div>
            <div className="ml-5 w-0 flex-1">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t("ui.se-ha-detectado-una-inconsis.80055e")}</h2>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                    {t("ui.hemos-detectado-que-algunos.8bc4a3")}
                </p>
                <div className="mb-6">
                    <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-2">{t("ui.artefactos-afectados.054d4b")}</h3>
                    <div className="max-h-48 overflow-y-auto bg-gray-100 dark:bg-gray-900/50 rounded-md p-3 border border-gray-200 dark:border-gray-700">
                        <ul className="list-disc list-inside space-y-1 text-sm text-gray-700 dark:text-gray-300">
                            {corruptArtifacts.map((artifact, index) => (
                                <li key={artifact?.id || `corrupt-${index}`} className="truncate">
                                    {artifact?.name || t("uiExpr.artefacto-sin-nombre-id-desc.e386e3")}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-500 mb-6">
                    {t("ui.esta-accion-eliminara-perman.91f33e")}
                </p>
                <div className="flex justify-end">
                    <button
                        onClick={onConfirm}
                        className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                    >
                        <TrashIcon className="h-5 w-5 mr-3" />
                        {t("ui.confirmar-y-eliminar-artefac.1f3d4a")}
                    </button>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};
