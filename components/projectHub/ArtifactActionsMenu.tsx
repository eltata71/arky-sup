import { useUiTranslation } from '../../lib/i18n/UiTranslationContext';
import React, { useEffect, useRef } from 'react';
import type { Artifact } from '../../lib/artifacts';
import { ArrowRightIcon, TrashIcon, ClockIcon, SparklesIcon, DocumentTextIcon as DocIcon, PresentationChartBarIcon, ChatBubbleLeftRightIcon } from '../Icons';

export const ArtifactActionsMenu: React.FC<{
    artifact: Artifact;
    isOpen: boolean;
    onClose: () => void;
    onDelete: () => void;
    onShowHistory: () => void;
    onOpen: () => void;
    onChat: () => void;
    onGenerateWorldClass: () => void;
    viewMode: 'grid' | 'table';
}> = ({ artifact, isOpen, onClose, onDelete, onShowHistory, onOpen, onChat, onGenerateWorldClass, viewMode }) => {
  const t = useUiTranslation();
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    // Posicionamiento dinámico: En tabla flota encima del resto, en grid sube desde el footer
    const positionClasses = viewMode === 'grid'
        ? "right-0 bottom-12 origin-bottom-right"
        : "right-8 top-0 origin-top-right mt-1"; // Ajustado para tabla: a la izquierda del botón de 3 puntos

    return (
        <div
            ref={menuRef}
            className={`absolute z-[100] w-64 bg-white dark:bg-gray-800 rounded-lg shadow-xl ring-1 ring-black ring-opacity-5 dark:ring-white dark:ring-opacity-10 py-1 text-sm animate-fade-in ${positionClasses}`}
        >
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50">
                <p className="font-semibold text-gray-900 dark:text-white truncate pr-2">{artifact.name}</p>
                <div className="flex items-center mt-1">
                    <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-1.5 py-0.5 rounded dark:bg-blue-900 dark:text-blue-300">
                        v{artifact.version} {t("ui.actual.552b22")}
                    </span>
                </div>
            </div>

            <div className="py-1">
                {/* NEW ACTION: Conversar con IA (First Item) */}
                <button onClick={() => { onChat(); onClose(); }} className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-primary-600 dark:text-primary-400 flex items-center group transition-colors font-medium">
                    <ChatBubbleLeftRightIcon className="w-4 h-4 mr-3" />
                    {t("ui.conversar-sobre-este-artefac.4eeff9")}
                </button>

                <button onClick={() => { onOpen(); onClose(); }} className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 flex items-center group transition-colors">
                    <ArrowRightIcon className="w-4 h-4 mr-3 text-gray-400 group-hover:text-primary-600" />
                    {t("ui.abrir-y-gestionar.6fa476")}
                </button>
                <button onClick={() => { onShowHistory(); onClose(); }} className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 flex items-center group transition-colors">
                    <ClockIcon className="w-4 h-4 mr-3 text-gray-400 group-hover:text-primary-600" />
                    {t("ui.ver-historial-de-versiones.15d65d")}
                </button>
                <button className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 flex items-center group transition-colors">
                    <DocIcon className="w-4 h-4 mr-3 text-gray-400 group-hover:text-primary-600" />
                    {t("ui.ver-contexto-del-artefacto.ddf82f")}
                </button>
            </div>

            <div className="border-t border-gray-100 dark:border-gray-700/50 py-1">
                <div className="px-4 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t("ui.inteligencia-artificial.b027e3")}</div>
                <button
                    onClick={() => { onGenerateWorldClass(); onClose(); }}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-primary-600 dark:text-primary-400 flex items-center transition-colors font-semibold"
                    title={t("ui.genera-una-nueva-version-del.18b475")}
                >
                    <SparklesIcon className="w-4 h-4 mr-3" /> {t("ui.generacion-de-clase-mundial.ebf1bd")}
                </button>
                <button className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-primary-600 dark:text-primary-400 flex items-center transition-colors">
                    <SparklesIcon className="w-4 h-4 mr-3" /> {t("ui.generar-tests.15a4d5")}
                </button>
                <button className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-primary-600 dark:text-primary-400 flex items-center transition-colors">
                    <PresentationChartBarIcon className="w-4 h-4 mr-3" /> {t("ui.revision-ia.012077")}
                </button>
            </div>

            <div className="border-t border-gray-100 dark:border-gray-700/50 py-1">
                <button onClick={() => { onDelete(); onClose(); }} className="w-full text-left px-4 py-2.5 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 flex items-center transition-colors">
                    <TrashIcon className="w-4 h-4 mr-3" /> {t("ui.eliminar-artefacto.9186fe")}
                </button>
            </div>
        </div>
    );
};
