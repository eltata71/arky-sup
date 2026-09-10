import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Project } from '../types';
import type { DiagramErrorRecord } from '../lib/diagram';
import { useAppContext } from '../context/AppContext';
import { artifactGenerationService, C4SelfHealingError } from '../services/ai';
import { ARTIFACT_TEMPLATES } from '../constants';
import { CheckCircleIcon, XCircleIcon } from './Icons';

interface ProjectCreationStatusProps {
    project: Project;
    initialArtifactNames: string[];
    onComplete: (projectId: string) => void;
}

interface CreationLogEntry {
    name: string;
    status: 'pending' | 'creating' | 'done' | 'failed' | 'skeleton';
    reason?: string;
    detail?: string;
}

const ProjectCreationStatus: React.FC<ProjectCreationStatusProps> = ({ project, initialArtifactNames, onComplete }) => {
    const { settings, createArtifact } = useAppContext();
    const [creationLog, setCreationLog] = useState<CreationLogEntry[]>([]);
    // Anti-reentry guard: ensures the generation loop runs exactly once for
    // this mount, even under React StrictMode double-invocation or unrelated
    // state churn that would otherwise re-trigger the effect.
    const hasStartedRef = useRef(false);

    const uniqueArtifactNames = useMemo(() => {
        const seen = new Set<string>();
        const result: string[] = [];
        for (const raw of initialArtifactNames ?? []) {
            const name = (raw ?? '').trim();
            if (!name || seen.has(name)) continue;
            seen.add(name);
            result.push(name);
        }
        return result;
    }, [initialArtifactNames]);

    useEffect(() => {
        if (uniqueArtifactNames.length > 0) {
            setCreationLog(uniqueArtifactNames.map(name => ({ name, status: 'pending' })));
        } else {
            // If no artifacts to create, just complete after a short delay
            const timeoutId = setTimeout(() => onComplete(project.id), 1500);
            return () => clearTimeout(timeoutId);
        }
    }, [uniqueArtifactNames, project.id, onComplete]);

    useEffect(() => {
        if (hasStartedRef.current) return;
        if (uniqueArtifactNames.length === 0) return;

        hasStartedRef.current = true;

        const updateLog = (name: string, patch: Partial<CreationLogEntry>) =>
            setCreationLog(prev => prev.map(log => log.name === name ? { ...log, ...patch } : log));

        const createAllArtifacts = async () => {
            const currentProjectState = project;

            for (let i = 0; i < uniqueArtifactNames.length; i++) {
                const name = uniqueArtifactNames[i];

                updateLog(name, { status: 'creating' });

                const template = ARTIFACT_TEMPLATES.find(t => t.name === name);
                if (template) {
                    try {
                        const content = await artifactGenerationService.generateArtifactContent(currentProjectState, template, settings);
                        createArtifact(project.id, {
                            name: template.name,
                            type: template.type,
                            phase: template.phase,
                            architecturalView: template.architecturalView,
                            content: content,
                            objective: template.objective,
                            keyConcepts: template.keyConcepts,
                            representation: template.representation,
                            isFavorite: false,
                        });
                        updateLog(name, { status: 'done' });
                    } catch (e) {
                        if (e instanceof C4SelfHealingError) {
                            // The skeleton fallback succeeded — the canvas
                            // gets a deterministic minimal IR so the user
                            // is never stuck with a blank diagram. We still
                            // mark it visually so the user knows it needs
                            // manual editing.
                            const lastDiagramError: DiagramErrorRecord = {
                                reason: e.reason,
                                attempt: e.attempts,
                                at: new Date().toISOString(),
                                sample: e.sampleMermaid.slice(0, 240),
                                message: 'C4 generation fell back to a deterministic skeleton after retries.',
                            };
                            createArtifact(project.id, {
                                name: template.name,
                                type: template.type,
                                phase: template.phase,
                                architecturalView: template.architecturalView,
                                content: e.sampleMermaid,
                                objective: template.objective,
                                keyConcepts: template.keyConcepts,
                                representation: template.representation,
                                isFavorite: false,
                                lastDiagramError,
                            });
                            updateLog(name, {
                                status: 'skeleton',
                                reason: 'Esqueleto base — edítame',
                                detail: `Tras ${e.attempts} reintento(s) automático(s) el modelo no produjo un diagrama válido. Se generó una estructura mínima local.`,
                            });
                            console.warn(`[ProjectCreationStatus] Skeleton fallback for "${name}":`, e.warnings);
                        } else {
                            console.error(`Error creating artifact "${name}":`, e);
                            const message = e instanceof Error ? e.message : String(e);
                            updateLog(name, { status: 'failed', reason: 'Generación fallida', detail: message });
                        }
                    }
                } else {
                    console.warn(`Template not found for "${name}"`);
                    updateLog(name, { status: 'failed', reason: 'Plantilla no encontrada', detail: name });
                }
            }

            setTimeout(() => onComplete(project.id), 1000);
        };

        createAllArtifacts();
    }, [uniqueArtifactNames, project, settings, createArtifact, onComplete]);

    const allDone = creationLog.length > 0 && creationLog.every(log => log.status === 'done' || log.status === 'failed' || log.status === 'skeleton');

    return (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-gray-50 dark:bg-gray-900">
            <h1 className="text-3xl font-bold mb-4">Creando tu proyecto: <span className="text-primary-600">{project.name}</span></h1>
            <p className="text-gray-500 dark:text-gray-400 mb-8 max-w-2xl">
                {allDone
                    ? "La configuración ha finalizado. ¡Todo listo para que empieces a diseñar!"
                    : "Estamos generando los artefactos iniciales para darte un punto de partida sólido."
                }
            </p>

            <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 space-y-3">
                {creationLog.map((log, index) => (
                    <div key={index} className="text-sm">
                        <div className="flex items-center justify-between">
                            <span className="text-gray-700 dark:text-gray-300">{log.name}</span>
                            {log.status === 'pending' && <span className="text-gray-400">Pendiente...</span>}
                            {log.status === 'creating' && <svg className="animate-spin h-5 w-5 text-primary-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                            {log.status === 'done' && <CheckCircleIcon className="h-5 w-5 text-green-500" />}
                            {log.status === 'failed' && <XCircleIcon className="h-5 w-5 text-red-500" />}
                            {log.status === 'skeleton' && (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                                    Esqueleto base
                                </span>
                            )}
                        </div>
                        {(log.status === 'failed' || log.status === 'skeleton') && (log.reason || log.detail) && (
                            <p className="mt-1 text-left text-xs text-gray-500 dark:text-gray-400">
                                {log.reason ? <span className="font-semibold">{log.reason}: </span> : null}
                                {log.detail}
                            </p>
                        )}
                    </div>
                ))}
                 {creationLog.length === 0 && (
                     <div className="flex items-center justify-center text-sm p-4">
                        <CheckCircleIcon className="h-5 w-5 text-green-500 mr-2" />
                        <span className="text-gray-700 dark:text-gray-300">Proyecto base configurado.</span>
                    </div>
                 )}
            </div>

            {allDone &&
                <p className="mt-8 text-lg text-gray-600 dark:text-gray-300 animate-pulse">Redirigiendo al lienzo...</p>
            }
        </div>
    );
};

export default ProjectCreationStatus;
