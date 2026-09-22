import React, { useCallback, useState, useMemo, useEffect, useRef } from 'react';
import { ArtifactTemplate } from '../types';
import type { Artifact, ArtifactGenerationPhaseListener } from '../lib/artifacts';
import { type Project, useAppContext } from '../context/AppContext';
import { ARTIFACT_TEMPLATES, KANBAN_COLUMNS } from '../constants';
import { sortTemplatesByRoadmap } from '../lib/artifacts/artifactGovernance';
import {
    DocumentTextIcon,
    Squares2X2Icon,
    PlusIcon,
    TrashIcon,
    ClockIcon,
    MagnifyingGlassIcon,
    ArrowRightIcon,
    CheckBadgeIcon,
    HomeIcon,
    TableCellsIcon,
    EllipsisHorizontalIcon,
    SparklesIcon,
    DocumentTextIcon as DocIcon,
    PresentationChartBarIcon,
    ArrowPathIcon,
    ChatBubbleLeftRightIcon,
    CpuChipIcon,
    FunnelIcon
} from './Icons';
import { RealArtifactHistoryModal } from './ArtifactHistoryModal';
import { ChatModal } from './ChatModal';
import { ProjectCopilotChatModal } from './copilot/ProjectCopilotChatModal';
import { AssistantDock } from './architectureOffice/AssistantDock';
import { AssistantLauncher } from './architectureOffice/AssistantLauncher';
import {
    EngagementIntakeWizard,
    type EngagementIntakeSubmit,
} from './architectureOffice/EngagementIntakeWizard';
import { useOffice } from '../context/OfficeContext';
import { useToast } from '../context/ToastContext';
import { buildProjectHubScope } from '../services/architectureOffice/application/assistantConsultation';
import { ProjectTimeline } from './ProjectTimeline';
import { CustomArtifactRequestModal } from './CustomArtifactRequestModal';
import { MemoryCenterModal } from './MemoryCenterModal';
import { PublicationCenter } from './publication';
import { LatestArtifactCard } from './LatestArtifactCard';
import { ArtifactSortControl } from './ArtifactSortControl';
import { ArtifactOriginBadge } from './ArtifactOriginBadge';
import { OfficeCapabilitiesPanel } from './architectureOffice/OfficeCapabilitiesPanel';
import { AttentionDetailsPanel } from './attentions';
import { useInitiatives } from '../context/InitiativeContext';
import { formatDate, formatDateTime } from '../utils/datetime';
import {
    getPhaseLabel,
    getLatestArtifact,
    getArtifactActivityDate,
    sortArtifacts,
    sortTemplates,
    ARTIFACT_SORT_OPTIONS,
    DEFAULT_ARTIFACT_SORT,
    DEFAULT_TEMPLATE_SORT,
    type ArtifactSortKey,
} from '../utils/artifactExploration';

interface ProjectHubProps {
    project: Project;
    /**
     * Opens artifact creation on mount. Set by the deep link a deliverable uses
     * to hand the user here — `/workspace/:id?crear=artefacto`.
     */
    openArtifactCreation?: boolean;
    onArtifactCreationOpened?: () => void;
    onOpenArtifact: (artifactId: string) => void;
    onCreateArtifact: (template: ArtifactTemplate, onPhase?: ArtifactGenerationPhaseListener) => Promise<boolean>;
    onDeleteArtifact: (artifactId: string) => void;
    onGenerateWorldClass: (artifact: Artifact) => void;
    onBack: () => void;
    onOpenSDD?: () => void;
}

const ArtifactActionsMenu: React.FC<{
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
                        v{artifact.version} (Actual)
                    </span>
                </div>
            </div>

            <div className="py-1">
                {/* NEW ACTION: Conversar con IA (First Item) */}
                <button onClick={() => { onChat(); onClose(); }} className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-primary-600 dark:text-primary-400 flex items-center group transition-colors font-medium">
                    <ChatBubbleLeftRightIcon className="w-4 h-4 mr-3" /> 
                    Conversar sobre este Artefacto
                </button>

                <button onClick={() => { onOpen(); onClose(); }} className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 flex items-center group transition-colors">
                    <ArrowRightIcon className="w-4 h-4 mr-3 text-gray-400 group-hover:text-primary-600" /> 
                    Abrir y Gestionar
                </button>
                <button onClick={() => { onShowHistory(); onClose(); }} className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 flex items-center group transition-colors">
                    <ClockIcon className="w-4 h-4 mr-3 text-gray-400 group-hover:text-primary-600" /> 
                    Ver Historial de Versiones
                </button>
                <button className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 flex items-center group transition-colors">
                    <DocIcon className="w-4 h-4 mr-3 text-gray-400 group-hover:text-primary-600" /> 
                    Ver Contexto del Artefacto
                </button>
            </div>

            <div className="border-t border-gray-100 dark:border-gray-700/50 py-1">
                <div className="px-4 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Inteligencia Artificial</div>
                <button
                    onClick={() => { onGenerateWorldClass(); onClose(); }}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-primary-600 dark:text-primary-400 flex items-center transition-colors font-semibold"
                    title="Genera una nueva versión del artefacto seleccionado con estándar World Class."
                >
                    <SparklesIcon className="w-4 h-4 mr-3" /> Generación de clase mundial
                </button>
                <button className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-primary-600 dark:text-primary-400 flex items-center transition-colors">
                    <SparklesIcon className="w-4 h-4 mr-3" /> Generar Tests
                </button>
                <button className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-primary-600 dark:text-primary-400 flex items-center transition-colors">
                    <PresentationChartBarIcon className="w-4 h-4 mr-3" /> Revisión IA
                </button>
            </div>

            <div className="border-t border-gray-100 dark:border-gray-700/50 py-1">
                <button onClick={() => { onDelete(); onClose(); }} className="w-full text-left px-4 py-2.5 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 flex items-center transition-colors">
                    <TrashIcon className="w-4 h-4 mr-3" /> Eliminar Artefacto
                </button>
            </div>
        </div>
    );
};

export const ProjectHub: React.FC<ProjectHubProps> = ({
    project,
    openArtifactCreation = false,
    onArtifactCreationOpened,
    onOpenArtifact,
    onCreateArtifact,
    onDeleteArtifact,
    onGenerateWorldClass,
    onBack,
    onOpenSDD
}) => {
    const { updateProject, settings } = useAppContext();
    const { initiatives } = useInitiatives();
    const { createEngagement, approveCharter, runEngagementNow } = useOffice();
    const { addToast } = useToast();
    const [activeTab, setActiveTab] = useState<'workspace' | 'catalog'>('workspace');
    const [viewMode, setViewMode] = useState<'grid' | 'table'>('table');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedPhase, setSelectedPhase] = useState<string>('all');
    // Mis artefactos uses the activity-based default; the catalog uses the
    // AI-recommended sequence by default so each phase shows the dependency
    // order the architect should follow to avoid inconsistencies.
    const [workspaceSortKey, setWorkspaceSortKey] = useState<ArtifactSortKey>(DEFAULT_ARTIFACT_SORT);
    const [catalogSortKey, setCatalogSortKey] = useState<ArtifactSortKey>(DEFAULT_TEMPLATE_SORT);
    const sortKey = activeTab === 'workspace' ? workspaceSortKey : catalogSortKey;
    const setSortKey = activeTab === 'workspace' ? setWorkspaceSortKey : setCatalogSortKey;
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [historyModalArtifact, setHistoryModalArtifact] = useState<Artifact | null>(null);
    const [chatArtifact, setChatArtifact] = useState<Artifact | null>(null);
    const [isCustomArtifactModalOpen, setIsCustomArtifactModalOpen] = useState(false);
    const [isMemoryCenterOpen, setIsMemoryCenterOpen] = useState(false);
    const [isPublicationCenterOpen, setIsPublicationCenterOpen] = useState(false);
    const [showNarrative, setShowNarrative] = useState(false);
    const [assistantOpen, setAssistantOpen] = useState(false);
    const [intakeOpen, setIntakeOpen] = useState(false);

    useEffect(() => {
        if (!openArtifactCreation) return;
        setIsCustomArtifactModalOpen(true);
        onArtifactCreationOpened?.();
    }, [openArtifactCreation, onArtifactCreationOpened]);

    /**
     * Opening a deliverable from inside its project: the second level of the
     * hierarchy is already answered, so the wizard starts on this project and
     * inherits the initiatives it declares.
     */
    const handleProposeEngagement = useCallback(async (input: EngagementIntakeSubmit) => {
        const result = await createEngagement(input);
        if (!result.ok || !result.engagement) {
            addToast(result.reason ?? 'No se pudo proponer el entregable.', 'error');
            return null;
        }
        return result.engagement;
    }, [createEngagement, addToast]);

    const handleApproveAndRun = useCallback(async (engagementId: string) => {
        const approved = await approveCharter(engagementId);
        if (!approved.ok) {
            addToast(approved.reason ?? 'No se pudo aprobar el charter.', 'error');
            return;
        }
        addToast('Charter aprobado. La Oficina está ejecutando el entregable.', 'success');
        const run = await runEngagementNow(engagementId);
        addToast(run.reason ?? 'Ejecución finalizada.', run.ok ? 'info' : 'warning');
    }, [approveCharter, runEngagementNow, addToast]);

    /**
     * The project's briefing for the office team, with the initiatives it
     * answers carried above it. Asking about an architecture project without
     * the business need behind it invites advice that is internally consistent
     * and beside the point.
     */
    const assistantScope = useMemo(
        () => buildProjectHubScope(project, initiatives),
        [project, initiatives],
    );

    const createGlobalProjectArtifact = (): Artifact => ({
        id: 'global',
        name: 'Proyecto Completo',
        objective: 'Asistencia global de arquitectura',
        content: '',
        type: 'markdown',
        phase: 'General',
        architecturalView: 'Vista de Gestión y Soporte',
        representation: 'document',
        isFavorite: false,
        version: 1,
        versionGroupId: 'global',
        createdAt: new Date().toISOString(),
        keyConcepts: []
    });

    const latestArtifacts = useMemo<Artifact[]>(() => {
        const latestVersionMap = new Map<string, Artifact>();

        project.artifacts.forEach(artifact => {
            const existing = latestVersionMap.get(artifact.versionGroupId);
            if (!existing || artifact.version > existing.version) {
                latestVersionMap.set(artifact.versionGroupId, artifact);
            }
        });

        return Array.from(latestVersionMap.values());
    }, [project.artifacts]);

    const filteredArtifacts = useMemo<Artifact[]>(() => {
        const normalizedSearch = searchTerm.trim().toLowerCase();

        return latestArtifacts.filter(artifact => {
            const matchesSearch = !normalizedSearch ||
                artifact.name.toLowerCase().includes(normalizedSearch) ||
                artifact.objective.toLowerCase().includes(normalizedSearch) ||
                artifact.type.toLowerCase().includes(normalizedSearch);
            const matchesPhase = selectedPhase === 'all' || artifact.phase === selectedPhase;
            return matchesSearch && matchesPhase;
        });
    }, [latestArtifacts, searchTerm, selectedPhase]);

    const filteredTemplates = useMemo<ArtifactTemplate[]>(() => {
        const normalizedSearch = searchTerm.trim().toLowerCase();

        return sortTemplatesByRoadmap(ARTIFACT_TEMPLATES).filter(template => {
            const matchesSearch = !normalizedSearch ||
                template.name.toLowerCase().includes(normalizedSearch) ||
                template.objective.toLowerCase().includes(normalizedSearch) ||
                template.type.toLowerCase().includes(normalizedSearch);
            const matchesPhase = selectedPhase === 'all' || template.phase === selectedPhase;
            return matchesSearch && matchesPhase;
        });
    }, [searchTerm, selectedPhase]);

    // Sort criteria available for the current surface. Catalog templates only
    // expose criteria that produce a meaningful order for them.
    const visibleSortOptions = useMemo(
        () => (activeTab === 'workspace'
            ? ARTIFACT_SORT_OPTIONS
            : ARTIFACT_SORT_OPTIONS.filter(option => option.appliesToTemplates)),
        [activeTab]
    );

    // The catalog falls back to its first applicable criterion when the active
    // sort key is artifact-only (recent/version), keeping control + order aligned.
    const effectiveSortKey = useMemo<ArtifactSortKey>(() => {
        if (activeTab === 'workspace') return sortKey;
        return visibleSortOptions.some(option => option.key === sortKey)
            ? sortKey
            : visibleSortOptions[0]?.key ?? sortKey;
    }, [activeTab, sortKey, visibleSortOptions]);

    const sortedArtifacts = useMemo<Artifact[]>(
        () => sortArtifacts(filteredArtifacts, sortKey),
        [filteredArtifacts, sortKey]
    );

    const sortedTemplates = useMemo<ArtifactTemplate[]>(
        () => sortTemplates(filteredTemplates, effectiveSortKey),
        [filteredTemplates, effectiveSortKey]
    );

    const groupedTemplates = useMemo<Record<string, ArtifactTemplate[]>>(() => {
        return sortedTemplates.reduce<Record<string, ArtifactTemplate[]>>((groups, template) => {
            if (!groups[template.phase]) groups[template.phase] = [];
            groups[template.phase].push(template);
            return groups;
        }, {});
    }, [sortedTemplates]);

    const uniqueArtifactsCount = latestArtifacts.length;
    const latestArtifact = useMemo(() => getLatestArtifact(latestArtifacts), [latestArtifacts]);

    const phaseSummaries = useMemo(() => {
        return KANBAN_COLUMNS.map(phase => {
            const artifactCount = latestArtifacts.filter(artifact => artifact.phase === phase).length;
            const templateCount = ARTIFACT_TEMPLATES.filter(template => template.phase === phase).length;
            const completion = templateCount > 0 ? Math.round((artifactCount / templateCount) * 100) : 0;

            return {
                phase,
                label: getPhaseLabel(phase),
                artifactCount,
                templateCount,
                completion: Math.min(completion, 100)
            };
        });
    }, [latestArtifacts]);

    // Phase sections always follow the roadmap order; the chosen sort only
    // reorders the template cards inside each section.
    const groupedTemplateEntries = (Object.entries(groupedTemplates) as Array<[string, ArtifactTemplate[]]>)
        .sort(([phaseA], [phaseB]) => KANBAN_COLUMNS.indexOf(phaseA) - KANBAN_COLUMNS.indexOf(phaseB));
    const selectedPhaseSummary = phaseSummaries.find(summary => summary.phase === selectedPhase);
    const hasActiveFilters = searchTerm.trim().length > 0 || selectedPhase !== 'all';
    const readyTemplateCount = filteredTemplates.filter(template => !latestArtifacts.some(artifact => artifact.name === template.name)).length;

    const totalRecommendedArtifacts = useMemo(() => ARTIFACT_TEMPLATES.length, []);
    const overallCompletion = totalRecommendedArtifacts > 0
        ? Math.min(100, Math.round((uniqueArtifactsCount / totalRecommendedArtifacts) * 100))
        : 0;
    const nextPhaseSummary = phaseSummaries.find(summary => summary.templateCount > 0 && summary.artifactCount < summary.templateCount) ?? phaseSummaries[0];
    const latestActivityLabel = latestArtifact
        ? formatDate(getArtifactActivityDate(latestArtifact))
        : 'Sin actividad';

    const catalogTitle = selectedPhaseSummary ? `Catálogo · ${selectedPhaseSummary.label}` : 'Catálogo completo';
    const workspaceTitle = selectedPhaseSummary ? `Mis artefactos · ${selectedPhaseSummary.label}` : 'Mis artefactos activos';

    const clearFilters = () => {
        setSearchTerm('');
        setSelectedPhase('all');
    };

    return (
        <div className="flex h-full min-h-0 flex-col bg-slate-50 text-slate-900 dark:bg-[#07070a] dark:text-white">
            <div className="border-b border-slate-200 bg-white/90 px-4 py-3 shadow-sm backdrop-blur dark:border-white/10 dark:bg-[#111116]/95 lg:px-6">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0 flex-1">
                        <button
                            onClick={onBack}
                            className="mb-2 inline-flex items-center text-sm font-medium text-slate-500 transition hover:text-primary-600 dark:text-slate-400 dark:hover:text-primary-300"
                        >
                            <HomeIcon className="mr-1.5 h-4 w-4" />
                            Volver a Proyectos
                        </button>
                        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-primary-600 dark:text-primary-300">Centro de acción del proyecto</p>
                        <h1 className="mt-1 max-w-5xl truncate text-2xl font-black leading-tight tracking-tight text-slate-950 dark:text-white md:text-3xl">
                            {project.name}
                        </h1>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center xl:justify-end">
                        <button
                            onClick={() => setIsMemoryCenterOpen(true)}
                            className="inline-flex min-h-[42px] items-center justify-center rounded-2xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-bold text-violet-700 transition hover:bg-violet-100 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200 dark:hover:bg-violet-500/20"
                            title="Centro de memoria: gestiona memoria global, del agente, del proyecto, captura inicial y por artefacto"
                        >
                            <CpuChipIcon className="mr-2 h-5 w-5" />
                            Centro de Memoria
                        </button>
                        {onOpenSDD && (
                            <button
                                onClick={onOpenSDD}
                                className="inline-flex min-h-[42px] items-center justify-center rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-bold text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200 dark:hover:bg-indigo-500/20"
                                title="Abrir el panel de proceso SDD para este proyecto"
                            >
                                <span className="mr-2 text-base leading-none">📋</span>
                                Proceso SDD
                            </button>
                        )}
                        <button
                            onClick={() => setIsPublicationCenterOpen(true)}
                            className="inline-flex min-h-[42px] items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:bg-emerald-500/20"
                            title="Abrir el Centro de Publicación: convierte artefactos en entregables profesionales, accesibles y gobernados"
                        >
                            <CheckBadgeIcon className="mr-2 h-5 w-5" />
                            Publicación
                        </button>
                        <button
                            onClick={() => setChatArtifact(createGlobalProjectArtifact())}
                            className="inline-flex min-h-[42px] items-center justify-center rounded-2xl bg-primary-600 px-4 py-2 text-sm font-bold text-white shadow-sm shadow-primary-500/20 transition hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-400"
                        >
                            <ChatBubbleLeftRightIcon className="mr-2 h-5 w-5" />
                            Arquitecto Agente
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(280px,25vw)_minmax(0,1fr)]">
                <aside className="min-h-0 overflow-y-auto border-b border-slate-200 bg-white/95 p-4 dark:border-white/10 dark:bg-[#101014] lg:border-b-0 lg:border-r lg:p-5">
                    <div className="space-y-4">
                        {/* A. Último artefacto generado o modificado */}
                        <LatestArtifactCard
                            artifact={latestArtifact}
                            onOpen={onOpenArtifact}
                            onChat={(artifact) => setChatArtifact(artifact)}
                            onExploreCatalog={() => setActiveTab('catalog')}
                        />

                        {/* The team entry point sits with the Office panel:
                            both are about the office acting on this project,
                            as opposed to the artifact tools around them. */}
                        <button
                            type="button"
                            onClick={() => setAssistantOpen(true)}
                            className="group flex w-full items-center gap-3 rounded-2xl border border-primary-200 bg-gradient-to-br from-primary-50 via-white to-indigo-50 p-3 text-left shadow-sm transition-all hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-primary-900/60 dark:from-primary-950/40 dark:via-gray-900 dark:to-indigo-950/40"
                        >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-600 dark:bg-primary-900/50 dark:text-primary-300">
                                <SparklesIcon className="h-5 w-5" />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-sm font-bold text-slate-900 dark:text-white">Equipo de arquitectura</span>
                                <span className="block text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                                    La solicitud entra por la Oficina, se reparte entre especialistas y se consolida.
                                </span>
                            </span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setIntakeOpen(true)}
                            className="group flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-all hover:border-primary-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-primary-700"
                        >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                <PlusIcon className="h-5 w-5" />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-sm font-bold text-slate-900 dark:text-white">Nueva solicitud de entregable</span>
                                <span className="block text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                                    La Oficina planifica los artefactos, asigna especialistas y los revisa.
                                </span>
                            </span>
                        </button>

                        {/* La ficha del proyecto: lo que la Oficina sabe de él,
                            mantenible con la misma ayuda por campo que los otros
                            dos niveles. */}
                        <AttentionDetailsPanel
                            project={project}
                            initiatives={initiatives}
                            onPatch={(patch) => updateProject(project.id, patch)}
                        />

                        <OfficeCapabilitiesPanel
                            project={project}
                            initiatives={initiatives}
                            onChangeInitiativeLinks={({ initiativeIds, codes }) =>
                                updateProject(project.id, {
                                    initiativeIds,
                                    linkedBusinessProjects: codes,
                                })
                            }
                        />

                        {/* B. Exploración de artefactos */}
                        <section className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm dark:border-white/10 dark:bg-white/[0.03]" aria-label="Exploración de artefactos">
                            <p className="px-3 pb-1 pt-2 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Exploración</p>
                            <button
                                onClick={() => setActiveTab('workspace')}
                                aria-pressed={activeTab === 'workspace'}
                                className={`flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${activeTab === 'workspace' ? 'bg-primary-50 text-primary-900 ring-1 ring-primary-200 dark:bg-primary-500/15 dark:text-primary-100 dark:ring-primary-500/30' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/[0.06]'}`}
                            >
                                <span className="inline-flex items-center gap-3 text-sm font-bold"><DocumentTextIcon className="h-5 w-5" />Mis artefactos</span>
                                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-600 ring-1 ring-slate-200 dark:bg-black/20 dark:text-slate-300 dark:ring-white/10">{sortedArtifacts.length}</span>
                            </button>
                            <button
                                onClick={() => setActiveTab('catalog')}
                                aria-pressed={activeTab === 'catalog'}
                                className={`mt-1 flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${activeTab === 'catalog' ? 'bg-primary-50 text-primary-900 ring-1 ring-primary-200 dark:bg-primary-500/15 dark:text-primary-100 dark:ring-primary-500/30' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/[0.06]'}`}
                            >
                                <span className="inline-flex items-center gap-3 text-sm font-bold"><SparklesIcon className="h-5 w-5" />Catálogo</span>
                                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-600 ring-1 ring-slate-200 dark:bg-black/20 dark:text-slate-300 dark:ring-white/10">{filteredTemplates.length}</span>
                            </button>
                        </section>

                        {/* C. Filtros por fase */}
                        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.03]" aria-label="Filtros por fase">
                            <div className="mb-3 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-300">
                                        <FunnelIcon className="h-4 w-4" />
                                    </span>
                                    <div>
                                        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Filtros</p>
                                        <p className="text-sm font-bold text-slate-900 dark:text-white">Buscar y enfocar</p>
                                    </div>
                                </div>
                                {hasActiveFilters && (
                                    <button onClick={clearFilters} className="rounded-lg px-2 py-1 text-xs font-bold text-primary-600 transition hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-300 dark:hover:bg-primary-500/10 dark:hover:text-primary-200">
                                        Limpiar
                                    </button>
                                )}
                            </div>

                            <label className="relative block">
                                <span className="sr-only">Buscar artefactos o plantillas</span>
                                <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder={activeTab === 'workspace' ? 'Buscar artefactos...' : 'Buscar plantillas...'}
                                    value={searchTerm}
                                    onChange={(event) => setSearchTerm(event.target.value)}
                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus-visible:border-primary-400 focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-primary-500/10 dark:border-white/10 dark:bg-black/20 dark:text-white dark:placeholder:text-slate-500 dark:focus-visible:border-primary-400 dark:focus-visible:bg-black/30"
                                />
                            </label>

                            <div className="mt-4 space-y-1.5" role="group" aria-label="Filtrar por fase del proyecto">
                                <button
                                    onClick={() => setSelectedPhase('all')}
                                    aria-pressed={selectedPhase === 'all'}
                                    className={`flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${selectedPhase === 'all' ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/[0.06]'}`}
                                >
                                    <span className="font-bold">Todo</span>
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${selectedPhase === 'all' ? 'bg-white/15 text-white dark:bg-slate-950/10 dark:text-slate-950' : 'bg-slate-100 text-slate-500 dark:bg-white/[0.08] dark:text-slate-400'}`}>{activeTab === 'workspace' ? uniqueArtifactsCount : ARTIFACT_TEMPLATES.length}</span>
                                </button>
                                {phaseSummaries.map(summary => (
                                    <button
                                        key={summary.phase}
                                        onClick={() => setSelectedPhase(summary.phase)}
                                        aria-pressed={selectedPhase === summary.phase}
                                        className={`flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${selectedPhase === summary.phase ? 'bg-primary-50 text-primary-900 ring-1 ring-primary-200 dark:bg-primary-500/15 dark:text-primary-100 dark:ring-primary-500/30' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/[0.06]'}`}
                                    >
                                        <span className="font-bold">{summary.label}</span>
                                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${selectedPhase === summary.phase ? 'bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-100' : 'bg-slate-100 text-slate-500 dark:bg-white/[0.08] dark:text-slate-400'}`}>{summary.artifactCount}/{summary.templateCount}</span>
                                    </button>
                                ))}
                            </div>
                        </section>

                        {/* D. Ordenamiento de artefactos */}
                        <ArtifactSortControl
                            value={effectiveSortKey}
                            options={visibleSortOptions}
                            onChange={setSortKey}
                            context={activeTab}
                        />

                        {/* E. Artefacto a solicitud · F. Conversar con IA */}
                        <section className="grid gap-2" aria-label="Acciones de artefacto y asistencia">
                            <button
                                onClick={() => {
                                    setActiveTab('catalog');
                                    setIsCustomArtifactModalOpen(true);
                                }}
                                className="inline-flex min-h-[46px] items-center justify-center rounded-2xl border border-primary-200 bg-primary-50 px-4 py-2 text-sm font-bold text-primary-800 transition hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:border-primary-500/30 dark:bg-primary-500/10 dark:text-primary-100 dark:hover:bg-primary-500/20 dark:focus-visible:ring-offset-[#101014]"
                            >
                                <SparklesIcon className="mr-2 h-5 w-5" />
                                Artefacto a solicitud
                            </button>
                            <button
                                onClick={() => setChatArtifact(createGlobalProjectArtifact())}
                                className="inline-flex min-h-[46px] items-center justify-center rounded-2xl bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 dark:focus-visible:ring-offset-[#101014]"
                            >
                                <ChatBubbleLeftRightIcon className="mr-2 h-5 w-5" />
                                Conversar con IA
                            </button>
                        </section>

                        {/* G. Resto de opciones del proyecto */}
                        <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-white/10">
                            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Más del proyecto</p>

                            <section className="rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.03]" aria-label="Pulso del proyecto">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Pulso</p>
                                        <p className="mt-1 text-sm font-bold text-slate-900 dark:text-white">{uniqueArtifactsCount}/{totalRecommendedArtifacts} artefactos activos</p>
                                    </div>
                                    <span className="rounded-2xl bg-emerald-50 px-3 py-1 text-sm font-black text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20">{overallCompletion}%</span>
                                </div>
                                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                                    <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-primary-500 to-violet-500 transition-[width] duration-500" style={{ width: `${overallCompletion}%` }} />
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                    <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-200 dark:bg-black/20 dark:ring-white/10">Próximo: {nextPhaseSummary?.label ?? 'General'}</span>
                                    <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-200 dark:bg-black/20 dark:ring-white/10">Actividad: {latestActivityLabel}</span>
                                </div>
                            </section>

                            <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.03]" aria-label="Narrativa del proyecto">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Narrativa</p>
                                        <p className="text-sm font-bold text-slate-900 dark:text-white">Historia y contexto</p>
                                    </div>
                                    <button
                                        onClick={() => setShowNarrative((value) => !value)}
                                        aria-expanded={showNarrative}
                                        className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/[0.06]"
                                    >
                                        {showNarrative ? 'Ocultar' : 'Ver'}
                                    </button>
                                </div>
                                {showNarrative && (
                                    <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                        {project.description || 'Gestión centralizada de arquitectura.'}
                                    </p>
                                )}
                            </section>
                        </div>
                    </div>
                </aside>

                <main className="min-h-0 overflow-y-auto p-4 custom-scrollbar lg:p-6 xl:p-8">
                    <div className="mx-auto max-w-7xl space-y-6">
                        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#111116] md:p-6">
                            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">
                                            {activeTab === 'workspace' ? 'Exploración enfocada' : 'Generación guiada'}
                                        </p>
                                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">{overallCompletion}% madurez</span>
                                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">{uniqueArtifactsCount} activos</span>
                                    </div>
                                    <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950 dark:text-white md:text-3xl">
                                        {activeTab === 'workspace' ? workspaceTitle : catalogTitle}
                                    </h2>
                                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                                        {activeTab === 'workspace'
                                            ? 'Superficie limpia para abrir, conversar y gestionar artefactos. La narrativa permanece disponible bajo demanda.'
                                            : 'Busca, filtra y crea artefactos desde el catálogo sin navegar por contenido irrelevante.'}
                                    </p>
                                </div>
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                    {activeTab === 'workspace' ? (
                                        <>
                                            <button
                                                onClick={() => setShowNarrative((value) => !value)}
                                                className="inline-flex min-h-[40px] items-center justify-center rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/[0.06]"
                                            >
                                                {showNarrative ? 'Ocultar narrativa' : 'Ver narrativa'}
                                            </button>
                                            <div className="flex items-center rounded-2xl bg-slate-100 p-1 dark:bg-white/[0.06]" aria-label="Cambiar vista de artefactos">
                                                <button
                                                    onClick={() => setViewMode('table')}
                                                    className={`inline-flex min-h-[38px] items-center rounded-xl px-3 text-sm font-bold transition ${viewMode === 'table' ? 'bg-white text-primary-700 shadow-sm dark:bg-white/10 dark:text-primary-200' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'}`}
                                                    title="Vista de lista"
                                                >
                                                    <TableCellsIcon className="mr-2 h-5 w-5" />
                                                    Lista
                                                </button>
                                                <button
                                                    onClick={() => setViewMode('grid')}
                                                    className={`inline-flex min-h-[38px] items-center rounded-xl px-3 text-sm font-bold transition ${viewMode === 'grid' ? 'bg-white text-primary-700 shadow-sm dark:bg-white/10 dark:text-primary-200' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'}`}
                                                    title="Vista de tarjetas"
                                                >
                                                    <Squares2X2Icon className="mr-2 h-5 w-5" />
                                                    Tarjetas
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <button
                                            onClick={() => setIsCustomArtifactModalOpen(true)}
                                            className="inline-flex min-h-[44px] items-center justify-center rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
                                        >
                                            <SparklesIcon className="mr-2 h-5 w-5" />
                                            Artefacto a solicitud
                                        </button>
                                    )}
                                </div>
                            </div>
                        </section>

                        {activeTab === 'workspace' && (
                            <div className="space-y-6 animate-fade-in">
                                {showNarrative && <ProjectTimeline project={project} onOpenArtifact={onOpenArtifact} />}

                                {sortedArtifacts.length > 0 ? (
                                    viewMode === 'grid' ? (
                                        <div className="grid grid-cols-1 gap-4 pb-24 md:grid-cols-2 xl:grid-cols-3">
                                            {sortedArtifacts.map(artifact => (
                                                <div
                                                    key={artifact.id}
                                                    className="group relative flex min-h-64 flex-col overflow-visible rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-xl dark:border-white/10 dark:bg-[#111116] dark:hover:border-primary-500/40"
                                                >
                                                    <div className="flex flex-1 flex-col p-5">
                                                        <div className="mb-4 flex items-start justify-between gap-3">
                                                            <div className={`rounded-2xl p-3 ${artifact.representation === 'diagram' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300'}`}>
                                                                {artifact.representation === 'diagram' ? <Squares2X2Icon className="h-6 w-6" /> : <DocumentTextIcon className="h-6 w-6" />}
                                                            </div>
                                                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200 dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/10">
                                                                v{artifact.version}
                                                            </span>
                                                        </div>
                                                        <h3 className="line-clamp-2 text-lg font-black text-slate-950 dark:text-white">{artifact.name}</h3>
                                                        <p className="mt-2 line-clamp-3 flex-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{artifact.objective}</p>
                                                        <div className="mt-4 flex items-center justify-between gap-2 text-xs text-slate-400">
                                                            <div className="flex flex-wrap items-center gap-1.5">
                                                                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-bold text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">{getPhaseLabel(artifact.phase)}</span>
                                                                <ArtifactOriginBadge artifact={artifact} />
                                                            </div>
                                                            <span className="inline-flex items-center whitespace-nowrap" title={`Última modificación: ${formatDateTime(getArtifactActivityDate(artifact))}`}>
                                                                <ClockIcon className="mr-1 h-3.5 w-3.5" />
                                                                {formatDateTime(getArtifactActivityDate(artifact))}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="flex border-t border-slate-200 dark:border-white/10">
                                                        <button
                                                            onClick={() => onOpenArtifact(artifact.id)}
                                                            className="flex min-h-[48px] flex-1 items-center justify-center text-sm font-bold text-primary-600 transition hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-500/10"
                                                        >
                                                            Abrir
                                                        </button>
                                                        <button
                                                            onClick={() => setOpenMenuId(openMenuId === artifact.id ? null : artifact.id)}
                                                            className={`flex w-14 items-center justify-center transition hover:bg-slate-50 dark:hover:bg-white/[0.06] ${openMenuId === artifact.id ? 'bg-slate-100 dark:bg-white/[0.08]' : ''}`}
                                                            aria-label={`Abrir acciones de ${artifact.name}`}
                                                        >
                                                            <EllipsisHorizontalIcon className="h-5 w-5 text-slate-500" />
                                                        </button>
                                                    </div>
                                                    <ArtifactActionsMenu
                                                        artifact={artifact}
                                                        isOpen={openMenuId === artifact.id}
                                                        onClose={() => setOpenMenuId(null)}
                                                        onDelete={() => onDeleteArtifact(artifact.id)}
                                                        onShowHistory={() => setHistoryModalArtifact(artifact)}
                                                        onOpen={() => onOpenArtifact(artifact.id)}
                                                        onChat={() => setChatArtifact(artifact)}
                                                        onGenerateWorldClass={() => onGenerateWorldClass(artifact)}
                                                        viewMode="grid"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="overflow-visible rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#111116]">
                                            <div className="overflow-x-auto overflow-y-visible">
                                                <table className="w-full min-w-[860px] text-left">
                                                    <thead>
                                                        <tr className="border-b border-slate-200 bg-slate-50 text-xs font-black uppercase tracking-wider text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                                                            <th className="px-6 py-4">Nombre</th>
                                                            <th className="px-6 py-4">Fase</th>
                                                            <th className="px-6 py-4">Tipo</th>
                                                            <th className="px-6 py-4 text-center">Versión</th>
                                                            <th className="px-6 py-4">Última modificación</th>
                                                            <th className="px-6 py-4 text-right">Acciones</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100 dark:divide-white/10">
                                                        {sortedArtifacts.map(artifact => (
                                                            <tr key={artifact.id} className="group transition hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                                                                <td className="px-6 py-4">
                                                                    <div className="flex items-center gap-3">
                                                                        <div className={`rounded-2xl p-2.5 ${artifact.representation === 'diagram' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300'}`}>
                                                                            {artifact.representation === 'diagram' ? <Squares2X2Icon className="h-4 w-4" /> : <DocumentTextIcon className="h-4 w-4" />}
                                                                        </div>
                                                                        <div className="min-w-0">
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="max-w-xs truncate font-bold text-slate-950 dark:text-white">{artifact.name}</span>
                                                                                <ArtifactOriginBadge artifact={artifact} variant="compact" />
                                                                            </div>
                                                                            <div className="max-w-xs truncate text-xs text-slate-500 dark:text-slate-400">{artifact.objective}</div>
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                                <td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">
                                                                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold dark:bg-white/[0.06]">{getPhaseLabel(artifact.phase)}</span>
                                                                </td>
                                                                <td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">{artifact.type}</td>
                                                                <td className="px-6 py-4 text-center">
                                                                    <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">v{artifact.version}</span>
                                                                </td>
                                                                <td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatDateTime(getArtifactActivityDate(artifact))}</td>
                                                                <td className="relative px-6 py-4 text-right">
                                                                    <div className="relative flex items-center justify-end gap-2">
                                                                        <button
                                                                            onClick={() => onOpenArtifact(artifact.id)}
                                                                            className="rounded-xl bg-primary-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700"
                                                                        >
                                                                            Abrir
                                                                        </button>
                                                                        <button
                                                                            onClick={() => setOpenMenuId(openMenuId === artifact.id ? null : artifact.id)}
                                                                            className={`rounded-xl p-2 transition ${openMenuId === artifact.id ? 'bg-slate-200 text-slate-900 dark:bg-white/10 dark:text-white' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/[0.06] dark:hover:text-white'}`}
                                                                            aria-label={`Abrir acciones de ${artifact.name}`}
                                                                        >
                                                                            <EllipsisHorizontalIcon className="h-5 w-5" />
                                                                        </button>
                                                                        <ArtifactActionsMenu
                                                                            artifact={artifact}
                                                                            isOpen={openMenuId === artifact.id}
                                                                            onClose={() => setOpenMenuId(null)}
                                                                            onDelete={() => onDeleteArtifact(artifact.id)}
                                                                            onShowHistory={() => setHistoryModalArtifact(artifact)}
                                                                            onOpen={() => onOpenArtifact(artifact.id)}
                                                                            onChat={() => setChatArtifact(artifact)}
                                                                            onGenerateWorldClass={() => onGenerateWorldClass(artifact)}
                                                                            viewMode="table"
                                                                        />
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )
                                ) : (
                                    <div className="flex flex-col items-center justify-center rounded-[2rem] border border-dashed border-slate-300 bg-white px-6 py-20 text-center shadow-sm dark:border-white/15 dark:bg-[#111116]">
                                        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary-50 shadow-inner dark:bg-primary-500/10">
                                            <SparklesIcon className="h-10 w-10 text-primary-500 dark:text-primary-300" />
                                        </div>
                                        <h3 className="text-2xl font-black text-slate-950 dark:text-white">No hay artefactos con este enfoque</h3>
                                        <p className="mt-3 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">
                                            Ajusta los filtros o explora el catálogo para generar el siguiente activo de arquitectura.
                                        </p>
                                        <button
                                            onClick={() => setActiveTab('catalog')}
                                            className="mt-6 inline-flex min-h-[44px] items-center rounded-2xl bg-slate-950 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
                                        >
                                            Explorar catálogo
                                            <ArrowRightIcon className="ml-2 h-4 w-4" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'catalog' && (
                            <div className="space-y-8 animate-slide-up pb-24">
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#111116]">
                                        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Plantillas visibles</p>
                                        <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{filteredTemplates.length}</p>
                                    </div>
                                    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#111116]">
                                        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Listas para crear</p>
                                        <p className="mt-2 text-3xl font-black text-emerald-600 dark:text-emerald-300">{readyTemplateCount}</p>
                                    </div>
                                    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#111116]">
                                        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Filtro activo</p>
                                        <p className="mt-2 truncate text-lg font-black text-slate-950 dark:text-white">{selectedPhaseSummary?.label || 'Todas las fases'}</p>
                                    </div>
                                </div>

                                {groupedTemplateEntries.length > 0 ? (
                                    groupedTemplateEntries.map(([phase, templates]) => (
                                        <section key={phase} className="space-y-4">
                                            <div className="flex items-center gap-3">
                                                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-100 text-sm font-black text-primary-700 dark:bg-primary-500/15 dark:text-primary-200">
                                                    {phase.match(/Fase (\d)/)?.[1] || '#'}
                                                </span>
                                                <div className="min-w-0">
                                                    <h3 className="text-xl font-black text-slate-950 dark:text-white">{phase}</h3>
                                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                                        {templates.length} opciones relevantes para este enfoque
                                                        {effectiveSortKey === 'ai-recommended' && (
                                                            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-700 ring-1 ring-primary-200 dark:bg-primary-500/10 dark:text-primary-200 dark:ring-primary-500/20">
                                                                <SparklesIcon className="h-3 w-3" />
                                                                Orden recomendado por IA
                                                            </span>
                                                        )}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                                                {templates.map((template, indexInPhase) => {
                                                    const existing = latestArtifacts.find(artifact => artifact.name === template.name);
                                                    const sequenceLabel = effectiveSortKey === 'ai-recommended'
                                                        ? `${indexInPhase + 1}`
                                                        : null;

                                                    return (
                                                        <div
                                                            key={template.name}
                                                            className={`relative rounded-3xl border p-5 shadow-sm transition ${existing ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/20 dark:bg-emerald-500/10' : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-xl dark:border-white/10 dark:bg-[#111116] dark:hover:border-primary-500/40'}`}
                                                        >
                                                            <div className="mb-4 flex items-start justify-between gap-3">
                                                                <div>
                                                                    <div className="mb-2 flex flex-wrap items-center gap-2">
                                                                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary-600 dark:text-primary-300">{getPhaseLabel(template.phase)}</p>
                                                                        {sequenceLabel && (
                                                                            <span
                                                                                className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-black text-white dark:bg-white dark:text-slate-900"
                                                                                title="Posición sugerida por la IA dentro de la fase para evitar inconsistencias."
                                                                            >
                                                                                <SparklesIcon className="h-2.5 w-2.5" />
                                                                                Paso {sequenceLabel}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <h4 className="text-lg font-black text-slate-950 dark:text-white">{template.name}</h4>
                                                                </div>
                                                                {existing ? (
                                                                    <CheckBadgeIcon className="h-6 w-6 flex-none text-emerald-500" role="img" aria-label="Ya existe en el proyecto" />
                                                                ) : (
                                                                    <span className="h-6 w-6 flex-none rounded-full border border-slate-300 dark:border-white/20" />
                                                                )}
                                                            </div>
                                                            <p className="line-clamp-3 min-h-[4.5rem] text-sm leading-6 text-slate-500 dark:text-slate-400">{template.objective}</p>
                                                            <p className="mt-4 text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">Secuencia guiada · {template.representation}</p>
                                                            <button
                                                                onClick={() => onCreateArtifact(template)}
                                                                className={`mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-2xl px-4 py-2 text-sm font-bold transition ${existing ? 'bg-white text-slate-800 ring-1 ring-emerald-200 hover:bg-emerald-50 dark:bg-white/[0.06] dark:text-white dark:ring-emerald-500/20 dark:hover:bg-white/[0.1]' : 'bg-primary-600 text-white shadow-sm hover:bg-primary-700'}`}
                                                            >
                                                                {existing ? (
                                                                    <>
                                                                        <ArrowPathIcon className="mr-2 h-4 w-4" />
                                                                        Generar de Nuevo
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <PlusIcon className="mr-2 h-4 w-4" />
                                                                        Crear Artefacto
                                                                    </>
                                                                )}
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </section>
                                    ))
                                ) : (
                                    <div className="rounded-[2rem] border border-dashed border-slate-300 bg-white px-6 py-20 text-center shadow-sm dark:border-white/15 dark:bg-[#111116]">
                                        <SparklesIcon className="mx-auto mb-4 h-10 w-10 text-slate-400" />
                                        <h3 className="text-2xl font-black text-slate-950 dark:text-white">No encontramos plantillas</h3>
                                        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">Prueba con otra búsqueda o cambia la fase seleccionada.</p>
                                        <button onClick={clearFilters} className="mt-6 text-sm font-bold text-primary-600 hover:text-primary-700 dark:text-primary-300 dark:hover:text-primary-200">Limpiar filtros</button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </main>
            </div>

            <RealArtifactHistoryModal
                isOpen={!!historyModalArtifact}
                onClose={() => setHistoryModalArtifact(null)}
                projectId={project.id}
                artifact={historyModalArtifact}
                onOpenVersion={onOpenArtifact}
            />

            <CustomArtifactRequestModal
                isOpen={isCustomArtifactModalOpen}
                project={project}
                onClose={() => setIsCustomArtifactModalOpen(false)}
                onGenerate={onCreateArtifact}
            />

            <MemoryCenterModal
                isOpen={isMemoryCenterOpen}
                onClose={() => setIsMemoryCenterOpen(false)}
                project={project}
            />

            <PublicationCenter
                isOpen={isPublicationCenterOpen}
                onClose={() => setIsPublicationCenterOpen(false)}
                projectId={project.id}
            />

            <EngagementIntakeWizard
                open={intakeOpen}
                initialProjectId={project.id}
                projects={[{ id: project.id, name: project.name, initiativeIds: project.initiativeIds ?? [] }]}
                initiatives={initiatives}
                onCreateInitiative={() => { setIntakeOpen(false); onBack(); }}
                onPropose={handleProposeEngagement}
                onApproveAndRun={handleApproveAndRun}
                onClose={() => setIntakeOpen(false)}
            />

            <AssistantLauncher
                onOpen={() => setAssistantOpen(true)}
                label={`Abrir el equipo de arquitectura para ${project.name}`}
            />

            <AssistantDock
                open={assistantOpen}
                onClose={() => setAssistantOpen(false)}
                scope={assistantScope}
                settings={settings}
                project={project}
                suggestions={[
                    '¿Qué artefactos le faltan a este proyecto para estar completo?',
                    'Revisa la coherencia entre los artefactos que ya existen',
                    'Propón los entregables que la Oficina debería abrir aquí',
                ]}
            />

            {chatArtifact && chatArtifact.id === 'global' && (
                <ProjectCopilotChatModal
                    isOpen={!!chatArtifact}
                    onClose={() => setChatArtifact(null)}
                    project={project}
                    onOpenArtifact={(artifactId) => onOpenArtifact(artifactId)}
                />
            )}
            {chatArtifact && chatArtifact.id !== 'global' && (
                <ChatModal
                    isOpen={!!chatArtifact}
                    onClose={() => setChatArtifact(null)}
                    purpose="project-chat"
                    title={`Chat: ${chatArtifact.name}`}
                    initialPrompt="Continuando conversación sobre el proyecto..."
                    projectId={project.id}
                    contextData={`Nombre del Artefacto: ${chatArtifact.name}\nObjetivo: ${chatArtifact.objective}\nContenido Actual (Resumen):\n${chatArtifact.content.substring(0, 1000)}...`}
                />
            )}
        </div>
    );
};
