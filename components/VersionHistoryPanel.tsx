import React from 'react';
import type { Artifact } from '../lib/artifacts';
import { useAppContext } from '../context/AppContext';
import { ArrowPathIcon, EyeIcon, XMarkIcon } from './Icons';

interface VersionHistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  versions: Artifact[];
  currentVersionNumber: number;
  viewingVersion: Artifact | null;
  onViewVersion: (artifact: Artifact | null) => void;
  onRestoreVersion: (artifact: Artifact) => void;
}

export const VersionHistoryPanel: React.FC<VersionHistoryPanelProps> = ({
  isOpen,
  onClose,
  versions,
  currentVersionNumber,
  viewingVersion,
  onViewVersion,
  onRestoreVersion,
}) => {
  const { t } = useAppContext();

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <div
      className={`absolute top-0 right-0 h-full bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 shadow-lg z-30 transform transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      } w-80 flex flex-col`}
    >
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-bold">{t('versionHistory')}</h3>
        <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600">
          <XMarkIcon className="h-6 w-6" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-2">
          {versions.map(version => {
            const isCurrent = version.version === currentVersionNumber;
            const isViewing = viewingVersion?.id === version.id;
            
            return (
              <li key={version.id} className={`p-3 rounded-lg border-2 ${isViewing ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30' : 'border-transparent bg-gray-100 dark:bg-gray-900'}`}>
                <div className="flex justify-between items-center mb-2">
                  <div className="font-bold">
                    {t('version', { v: String(version.version) })}
                    {isCurrent && <span className="ml-2 text-xs font-semibold bg-green-200 text-green-800 dark:bg-green-700 dark:text-green-100 px-2 py-0.5 rounded-full">{t('latest')}</span>}
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{formatDate(version.createdAt)}</span>
                </div>
                <div className="flex items-center space-x-2 mt-3">
                  <button
                    onClick={() => onViewVersion(isViewing ? null : version)}
                    className={`w-full flex items-center justify-center px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                      isViewing 
                        ? 'bg-primary-600 text-white hover:bg-primary-700' 
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    <EyeIcon className="h-4 w-4 mr-2"/>
                    {isViewing ? 'Viewing' : t('view')}
                  </button>
                  {!isCurrent && (
                    <button
                      onClick={() => onRestoreVersion(version)}
                      title="Restore this version"
                      className="w-full flex items-center justify-center px-3 py-1.5 text-sm font-semibold rounded-md bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900"
                    >
                      <ArrowPathIcon className="h-4 w-4 mr-2"/>
                      {t('restore')}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};