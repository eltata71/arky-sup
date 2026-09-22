import React, { useMemo, useState } from 'react';
import { Modal } from './Modal';
import type { Artifact } from '../lib/artifacts';
import { useAppContext } from '../context/AppContext';
import { ClockIcon, EyeIcon } from './Icons';
import { buildDiffHunks, computeLineDiff, summarizeDiff } from '../lib/textDiff';

interface ArtifactHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectId: string;
    artifact: Artifact | null;
    onOpenVersion: (artifactId: string) => void;
}

/**
 * Inline version-diff viewer: collapsed unchanged regions, coloured added /
 * removed lines, and a compact summary. Lets the architect verify exactly
 * what changed between a historical version and the current one without
 * leaving the history modal.
 */
const VersionDiff: React.FC<{ oldVersion: Artifact; current: Artifact }> = ({ oldVersion, current }) => {
    const { summary, hunks } = useMemo(() => {
        const lines = computeLineDiff(oldVersion.content ?? '', current.content ?? '');
        return { summary: summarizeDiff(lines), hunks: buildDiffHunks(lines, 2) };
    }, [oldVersion.content, current.content]);

    if (summary.identical) {
        return (
            <p className="mt-2 rounded-lg bg-gray-100 dark:bg-gray-700/60 px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                El contenido es idéntico a la versión actual.
            </p>
        );
    }

    return (
        <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700 text-[11px]">
                <span className="font-semibold text-gray-700 dark:text-gray-200">
                    v{oldVersion.version} → v{current.version}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-semibold">
                    +{summary.added}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 font-semibold">
                    −{summary.removed}
                </span>
                <span className="text-gray-400 dark:text-gray-500">{summary.unchanged} sin cambios</span>
            </div>
            <div className="max-h-72 overflow-auto bg-white dark:bg-gray-900 font-mono text-[11px] leading-5">
                {hunks.map((hunk, hIdx) => (
                    <div key={hIdx}>
                        <div className="px-3 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 text-[10px] font-semibold sticky top-0">
                            {hunk.header}
                        </div>
                        {hunk.lines.map((line, lIdx) => (
                            <div
                                key={`${hIdx}-${lIdx}`}
                                className={`px-3 whitespace-pre-wrap break-words ${
                                    line.type === 'added'
                                        ? 'bg-emerald-50 dark:bg-emerald-900/25 text-emerald-800 dark:text-emerald-200'
                                        : line.type === 'removed'
                                            ? 'bg-rose-50 dark:bg-rose-900/25 text-rose-800 dark:text-rose-300 line-through decoration-rose-400/50'
                                            : 'text-gray-500 dark:text-gray-400'
                                }`}
                            >
                                <span className="select-none inline-block w-4 text-gray-400 dark:text-gray-600">
                                    {line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}
                                </span>
                                {line.text || ' '}
                            </div>
                        ))}
                    </div>
                ))}
            </div>
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
                                <VersionDiff oldVersion={ver} current={currentVersion} />
                            )}
                        </div>
                    ))
                )}
            </div>
        </Modal>
    );
};
