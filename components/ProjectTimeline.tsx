/**
 * Project Timeline — narrative "story arc" of a project, organised by the four
 * SDD/architectural phases plus the cross-cutting SDD column.  Each phase node
 * shows the count of unique artefacts produced + a percentage of completion
 * relative to the recommended templates from `constants.ARTIFACT_TEMPLATES`.
 *
 * The component is purely presentational; it computes its own stats from the
 * provided project so the container doesn't have to.
 */

import React, { useMemo } from 'react';
import type { Artifact } from '../lib/artifacts';
import type { Project } from '../context/AppContext';
import { ARTIFACT_TEMPLATES } from '../constants';
import { Card, CardEyebrow, Badge } from './ui';
import { cn } from './ui/cn';
import type { BadgeTone } from './ui/Badge';

interface ProjectTimelineProps {
    project: Project;
    /** When provided, clicking on a node opens the latest artefact in that phase. */
    onOpenArtifact?: (artifactId: string) => void;
    className?: string;
}

interface PhaseInfo {
    id: string;
    label: string;
    short: string;
    description: string;
    accent: string;
    /** A `BadgeTone`, not free text: the table feeds it straight to `<Badge>`. */
    badge: BadgeTone;
}

const PHASES: PhaseInfo[] = [
    { id: 'Fase 1: Estratégica y de Visión de Negocio', label: 'Estrategia', short: '1', description: 'Visión, contexto, valor de negocio.', accent: 'from-sky-400 to-cyan-500', badge: 'audience-exec' },
    { id: 'Fase 2: Diseño Conceptual y Lógico', label: 'Diseño Lógico', short: '2', description: 'Componentes, vistas lógicas, datos.', accent: 'from-indigo-400 to-violet-500', badge: 'audience-tech' },
    { id: 'Fase 3: Diseño Físico y Tecnológico', label: 'Diseño Físico', short: '3', description: 'Despliegue, infraestructura, runtime.', accent: 'from-amber-400 to-orange-500', badge: 'audience-ops' },
    { id: 'Fase 4: Implementación y Operaciones', label: 'Implementación', short: '4', description: 'Operación, observabilidad, evolución.', accent: 'from-emerald-400 to-teal-500', badge: 'success' },
];

function uniqueLatestArtifacts(artifacts: Artifact[]): Artifact[] {
    const map = new Map<string, Artifact>();
    for (const a of artifacts) {
        const existing = map.get(a.versionGroupId);
        if (!existing || a.version > existing.version) map.set(a.versionGroupId, a);
    }
    return Array.from(map.values());
}

export const ProjectTimeline: React.FC<ProjectTimelineProps> = ({ project, onOpenArtifact, className }) => {
    const stats = useMemo(() => {
        const latest = uniqueLatestArtifacts(project.artifacts);
        const recommendedByPhase = new Map<string, number>();
        for (const t of ARTIFACT_TEMPLATES) {
            recommendedByPhase.set(t.phase, (recommendedByPhase.get(t.phase) ?? 0) + 1);
        }
        return PHASES.map((phase) => {
            const inPhase = latest.filter((a) => a.phase === phase.id);
            const recommended = recommendedByPhase.get(phase.id) ?? 0;
            const percent = recommended > 0 ? Math.min(100, Math.round((inPhase.length / recommended) * 100)) : 0;
            const lastUpdated = inPhase.reduce<string | null>((acc, a) => {
                if (!acc) return a.createdAt;
                return new Date(a.createdAt).getTime() > new Date(acc).getTime() ? a.createdAt : acc;
            }, null);
            return {
                ...phase,
                count: inPhase.length,
                recommended,
                percent,
                lastUpdated,
                latest: inPhase.slice(0, 4),
            };
        });
    }, [project.artifacts]);

    const totalArtifacts = useMemo(() => uniqueLatestArtifacts(project.artifacts).length, [project.artifacts]);

    return (
        <Card tone="default" className={cn('relative overflow-hidden rounded-[2rem] border-slate-200 bg-white/95 shadow-sm dark:border-white/10 dark:bg-[#111116]', className)}>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <CardEyebrow>Línea narrativa</CardEyebrow>
                    <h3 className="mt-2 text-xl font-black tracking-tight text-gray-900 dark:text-white">
                        Historia del proyecto · de la visión a la operación
                    </h3>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-400">
                        Cada fase muestra cobertura, señales de avance y acceso directo a los artefactos más recientes.
                    </p>
                </div>
                <Badge tone="primary" outline>{totalArtifacts} artefactos activos</Badge>
            </div>

            <div className="relative">
                {/* Connecting line behind the phase cards; hidden when cards wrap. */}
                <div aria-hidden className="absolute left-0 right-0 top-9 hidden h-0.5 bg-gradient-to-r from-transparent via-gray-200 to-transparent dark:via-gray-700 2xl:block" />

                <ol className="relative grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
                    {stats.map((phase) => {
                        const isEmpty = phase.count === 0;
                        const statusTone = phase.percent >= 100 ? 'success' : isEmpty ? 'gray' : phase.badge;
                        return (
                            <li key={phase.id} className="relative rounded-3xl border border-gray-100 bg-gray-50/80 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                                <div className="mb-3 flex items-start justify-between gap-3">
                                    <Badge tone={statusTone} size="xs" outline>
                                        {phase.percent >= 100 ? 'Completa' : isEmpty ? 'Pendiente' : 'En progreso'}
                                    </Badge>
                                </div>
                                <div className="mb-3 flex items-start gap-3">
                                    <div className={cn(
                                        'flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl text-xl font-black text-white',
                                        'bg-gradient-to-br shadow-soft transition-transform',
                                        phase.accent,
                                        !isEmpty && 'animate-fade-in',
                                        isEmpty && 'opacity-40 grayscale',
                                    )}>
                                        {phase.short}
                                    </div>
                                    <div className="min-w-0 pt-1">
                                        <p className="truncate text-base font-black text-gray-900 dark:text-white">{phase.label}</p>
                                        <p className="text-xs leading-snug text-gray-500 dark:text-gray-400">{phase.description}</p>
                                    </div>
                                </div>

                                {/* Progress meter */}
                                <div className="mb-2">
                                    <div className="flex items-baseline justify-between mb-1">
                                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">Avance</span>
                                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                                            {phase.count}<span className="text-gray-400">/{phase.recommended || '–'}</span>
                                        </span>
                                    </div>
                                    <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                                        <div
                                            className={cn(
                                                'h-full rounded-full bg-gradient-to-r transition-[width] duration-500 ease-out',
                                                phase.accent,
                                            )}
                                            style={{ width: `${phase.percent}%` }}
                                        />
                                    </div>
                                </div>

                                {phase.latest.length > 0 ? (
                                    <ul className="mt-2 space-y-1">
                                        {phase.latest.map((a) => (
                                            <li key={a.id}>
                                                <button
                                                    type="button"
                                                    disabled={!onOpenArtifact}
                                                    onClick={() => onOpenArtifact?.(a.id)}
                                                    className={cn(
                                                        'flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs',
                                                        'text-gray-700 dark:text-gray-200',
                                                        onOpenArtifact && 'hover:bg-gray-50 dark:hover:bg-gray-800',
                                                        !onOpenArtifact && 'cursor-default',
                                                    )}
                                                    title={a.name}
                                                >
                                                    <span className="h-1.5 w-1.5 rounded-full bg-primary-400 flex-shrink-0" aria-hidden />
                                                    <span className="truncate">{a.name}</span>
                                                </button>
                                            </li>
                                        ))}
                                        {phase.count > phase.latest.length && (
                                            <li className="px-2 text-xs text-gray-400">+{phase.count - phase.latest.length} más</li>
                                        )}
                                    </ul>
                                ) : (
                                    <p className="mt-3 rounded-2xl border border-dashed border-gray-200 px-3 py-2 text-xs italic text-gray-400 dark:border-white/10">Sin artefactos aún</p>
                                )}

                                {phase.lastUpdated && (
                                    <p className="mt-3 text-xs text-gray-400">
                                        Última actividad · {new Date(phase.lastUpdated).toLocaleDateString()}
                                    </p>
                                )}
                            </li>
                        );
                    })}
                </ol>
            </div>
        </Card>
    );
};

export default ProjectTimeline;
