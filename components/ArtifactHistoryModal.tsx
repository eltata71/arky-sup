import React, { Suspense, useMemo, useState } from 'react';
import { Modal } from './Modal';
import type { Artifact, ArtifactChangeNote } from '../lib/artifacts';
import { useAppContext } from '../context/AppContext';
import { resolveEditableDiagramIR } from '../services/diagram';
import { ClockIcon, EyeIcon } from './Icons';
import { lazyWithRetry } from './routing/lazyWithRetry';

// Sólo quien compara descarga el comparador (y el diff de texto y de modelo que lleva).
const ArtifactVersionComparison = lazyWithRetry(() => import('./ArtifactVersionComparison'), { chunkName: 'ArtifactVersionComparison' });

interface ArtifactHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectId: string;
    artifact: Artifact | null;
    onOpenVersion: (artifactId: string) => void;
}

const NOTE_VISIBLE_CHANGES = 5;

/**
 * Qué hizo una versión, dicho por quien lo hizo: la instrucción de la persona
 * y las frases del motor de patches. Sin nota, la versión sólo tiene su número.
 */
const VersionChangeNote: React.FC<{ note: ArtifactChangeNote }> = ({ note }) => {
    const hidden = note.changes.length - NOTE_VISIBLE_CHANGES;
    return (
        <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
            <p className="font-medium text-gray-700 dark:text-gray-200">
                Modificado con IA desde la v{note.basedOnVersion}
                {note.instruction && <span className="font-normal italic"> · «{note.instruction}»</span>}
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {note.changes.slice(0, NOTE_VISIBLE_CHANGES).map((change, index) => <li key={index}>{change}</li>)}
                {hidden > 0 && <li className="list-none text-gray-400 dark:text-gray-500">y {hidden} cambio{hidden === 1 ? '' : 's'} más</li>}
            </ul>
        </div>
    );
};

export const RealArtifactHistoryModal: React.FC<ArtifactHistoryModalProps> = ({
    isOpen,
    onClose,
    projectId,
    artifact,
    onOpenVersion
}) => {
    const { getArtifactVersions } = useAppContext();
    const [comparingId, setComparingId] = useState<string | null>(null);

    const versions = useMemo(() => {
        if (!artifact) return [];
        return getArtifactVersions(projectId, artifact.versionGroupId);
    }, [projectId, artifact, getArtifactVersions]);

    const currentVersion = useMemo(
        () => versions.find((v) => v.id === artifact?.id) ?? artifact,
        [versions, artifact],
    );

    // Los modelos se leen aquí, en el chunk que ya lleva el pipeline de
    // diagramas; el comparador diferido sólo los compara.
    const comparedModels = useMemo(() => {
        const old = versions.find((v) => v.id === comparingId);
        if (!old || !currentVersion || old.representation === 'document' || currentVersion.representation === 'document') return null;
        const before = resolveEditableDiagramIR(old);
        const after = resolveEditableDiagramIR(currentVersion);
        return before && after ? { before, after } : null;
    }, [versions, comparingId, currentVersion]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Historial: ${artifact?.name || 'Artefacto'}`}>
            <div className="space-y-4">
                {versions.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">No hay historial disponible.</p>
                ) : (
                    versions.map((ver) => (
                        <div key={ver.id} className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary-300 transition-colors">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="flex items-center space-x-2">
                                        <span className="text-sm font-bold text-gray-900 dark:text-white">Versión {ver.version}</span>
                                        {ver.id === artifact?.id && (
                                            <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full dark:bg-green-900/30 dark:text-green-400">Actual</span>
                                        )}
                                    </div>
                                    <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 mt-1">
                                        <ClockIcon className="w-3 h-3 mr-1"/>
                                        {new Date(ver.createdAt).toLocaleString()}
                                    </div>
                                    {ver.changeNote && <VersionChangeNote note={ver.changeNote} />}
                                </div>
                                <div className="flex items-center gap-1">
                                    {ver.id !== artifact?.id && currentVersion && (
                                        <button
                                            onClick={() => setComparingId((prev) => (prev === ver.id ? null : ver.id))}
                                            className={`px-2 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                                                comparingId === ver.id
                                                    ? 'bg-primary-600 text-white'
                                                    : 'text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20'
                                            }`}
                                            title="Comparar con la versión actual"
                                        >
                                            {comparingId === ver.id ? 'Ocultar diff' : 'Comparar'}
                                        </button>
                                    )}
                                    <button
                                        onClick={() => {
                                            onOpenVersion(ver.id);
                                            onClose();
                                        }}
                                        className="p-2 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-md transition-colors"
                                        title="Abrir esta versión"
                                    >
                                        <EyeIcon className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                            {comparingId === ver.id && currentVersion && ver.id !== currentVersion.id && (
                                <Suspense fallback={<p role="status" className="mt-2 text-xs text-gray-500 dark:text-gray-400">Preparando la comparación…</p>}>
                                    <ArtifactVersionComparison oldVersion={ver} current={currentVersion} models={comparedModels} />
                                </Suspense>
                            )}
                        </div>
                    ))
                )}
            </div>
        </Modal>
    );
};
