import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppContext, type Project } from '../context/AppContext';
import { ChatModalPurpose, Template } from '../types';
import { useCreateAttention } from '../hooks/useCreateAttention';
import { artifactGenerationService, type GuidedProjectData } from '../services/ai';
import { 
    ChatBubbleLeftRightIcon,
    DocumentTextIcon,
    MagnifyingGlassIcon,
    FolderOpenIcon,
    ViewColumnsIcon,
    PlusIcon,
    ArrowRightIcon,
    BuildingOffice2Icon,
    EllipsisHorizontalIcon,
    TrashIcon,
    CheckBadgeIcon,
    PlusCircleIcon,
} from '../components/Icons';
import { LayoutDashboard, ListFilter } from 'lucide-react';
import { ChatModal } from '../components/ChatModal';
import { TemplateSelectionModal } from '../components/GuidedCreationModal';
import { ConsistencyCheckModal } from '../components/ConsistencyCheckModal';
import { Modal } from '../components/Modal';
import ProjectCreationStatus from '../components/ProjectCreationStatus';
import ArtifactSelectionStep from '../components/ArtifactSelectionStep';
import { Button, EmptyState, Input, Tab, TabList, TabPanel, Tabs, cn } from '../components/ui';
import { useInitiatives } from '../context/InitiativeContext';
import { useOffice } from '../context/OfficeContext';
import { useToast } from '../context/ToastContext';
import {
    AttentionCard,
    AttentionInitiativeGate,
    AttentionKpiRow,
    LinkInitiativeModal,
} from '../components/attentions';
import { PortfolioPulse } from '../components/architectureOffice/dashboard';
import {
    EngagementIntakeWizard,
    type EngagementIntakeSubmit,
} from '../components/architectureOffice/EngagementIntakeWizard';
import { useAttentionPortfolio } from '../hooks/useAttentionPortfolio';
import { EA_LEVELS } from '../lib/eaTerminology';

interface ProjectsPageProps {
  navigateToWorkspace: (id: string) => void;
}

// --- Helper Component: Project Context Editor Modal ---
const ProjectContextModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    project: Project;
}> = ({ isOpen, onClose, project }) => {
    const { updateProjectContext } = useAppContext();
    const [contextLines, setContextLines] = useState<string[]>([]);

    useEffect(() => {
        if (project) {
            setContextLines(project.projectContext || []);
        }
    }, [project]);

    const handleSave = () => {
        updateProjectContext(project.id, contextLines.filter(line => line.trim() !== ''));
        onClose();
    };

    const handleAddLine = () => {
        setContextLines([...contextLines, '']);
    };

    const handleChangeLine = (index: number, value: string) => {
        const newLines = [...contextLines];
        newLines[index] = value;
        setContextLines(newLines);
    };

    const handleRemoveLine = (index: number) => {
        setContextLines(contextLines.filter((_, i) => i !== index));
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Contexto: ${project.name}`}>
            <div className="space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    Define las reglas, restricciones y tecnologías que la IA debe considerar para este proyecto específico.
                </p>
                <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
                    {contextLines.map((line, index) => (
                        <div key={index} className="flex items-center space-x-2">
                            <input
                                type="text"
                                value={line}
                                onChange={(e) => handleChangeLine(index, e.target.value)}
                                placeholder="Ej. Usar React y Node.js..."
                                className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                            />
                            <button 
                                onClick={() => handleRemoveLine(index)}
                                className="p-2 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                            >
                                <TrashIcon className="h-4 w-4" />
                            </button>
                        </div>
                    ))}
                    {contextLines.length === 0 && (
                        <div className="text-center py-4 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
                            <p className="text-sm text-gray-400">No hay contexto definido.</p>
                        </div>
                    )}
                </div>
                
                <div className="flex justify-between items-center pt-4 border-t border-gray-100 dark:border-gray-700">
                    <button 
                        onClick={handleAddLine}
                        className="flex items-center text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors"
                    >
                        <PlusCircleIcon className="h-5 w-5 mr-1" />
                        Añadir Regla
                    </button>
                    <div className="flex space-x-3">
                        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 rounded-lg transition-colors">
                            Cancelar
                        </button>
                        <button onClick={handleSave} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors shadow-sm font-medium">
                            Guardar Cambios
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
};

// --- Helper Component: Project Actions Menu ---
const ProjectActionsMenu: React.FC<{
    project: Project;
    isOpen: boolean;
    onClose: () => void;
    onDelete: () => void;
    onManageContext: () => void;
    onCheckConsistency: () => void;
    onChat: () => void;
}> = ({ isOpen, onClose, onDelete, onManageContext, onCheckConsistency, onChat }) => {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        if (isOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div ref={menuRef} className="absolute right-0 top-10 z-50 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 text-sm animate-fade-in origin-top-right">
            <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700/50">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Acciones de Proyecto</p>
            </div>
            
            <div className="py-1">
                {/* NEW ACTION: Conversar con IA (First Item) */}
                <button 
                    onClick={(e) => { e.stopPropagation(); onChat(); onClose(); }} 
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-primary-600 dark:text-primary-400 flex items-center group transition-colors font-medium"
                >
                    <ChatBubbleLeftRightIcon className="w-4 h-4 mr-3" /> 
                    Conversar con Arquitecto IA
                </button>

                <button 
                    onClick={(e) => { e.stopPropagation(); onManageContext(); onClose(); }} 
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 flex items-center group transition-colors"
                >
                    <DocumentTextIcon className="w-4 h-4 mr-3 text-gray-400 group-hover:text-primary-600" /> 
                    Gestionar Contexto
                </button>
                <button 
                    onClick={(e) => { e.stopPropagation(); onCheckConsistency(); onClose(); }} 
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 flex items-center group transition-colors"
                >
                    <CheckBadgeIcon className="w-4 h-4 mr-3 text-gray-400 group-hover:text-primary-600" /> 
                    Verificar Consistencia
                </button>
            </div>

            <div className="border-t border-gray-100 dark:border-gray-700/50 py-1">
                <button 
                    onClick={(e) => { e.stopPropagation(); onDelete(); onClose(); }} 
                    className="w-full text-left px-4 py-2 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 flex items-center transition-colors"
                >
                    <TrashIcon className="w-4 h-4 mr-3" /> 
                    Eliminar Proyecto
                </button>
            </div>
        </div>
    );
};

// Define color variants explicitly for Tailwind JIT
const CARD_THEMES = {
    indigo: {
        icon: 'text-indigo-600 dark:text-indigo-400',
        bg: 'bg-indigo-50 dark:bg-indigo-900/20',
        accent: 'text-indigo-500',
        hoverBorder: 'hover:border-indigo-300 dark:hover:border-indigo-700'
    },
    emerald: {
        icon: 'text-emerald-600 dark:text-emerald-400',
        bg: 'bg-emerald-50 dark:bg-emerald-900/20',
        accent: 'text-emerald-500',
        hoverBorder: 'hover:border-emerald-300 dark:hover:border-emerald-700'
    },
    blue: {
        icon: 'text-blue-600 dark:text-blue-400',
        bg: 'bg-blue-50 dark:bg-blue-900/20',
        accent: 'text-blue-500',
        hoverBorder: 'hover:border-blue-300 dark:hover:border-blue-700'
    }
};

const ActionCard: React.FC<{
    icon: React.ReactNode;
    title: string;
    description: string;
    onClick: () => void;
    theme: keyof typeof CARD_THEMES;
}> = ({ icon, title, description, onClick, theme }) => {
    const styles = CARD_THEMES[theme];
    
    return (
        <button 
            onClick={onClick}
            className={`group relative overflow-hidden text-left p-6 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 ${styles.hoverBorder} shadow-sm hover:shadow-md transition-all duration-300`}
        >
            <div className={`absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity transform group-hover:scale-110 duration-500 ${styles.accent}`}>
                {React.cloneElement(icon as React.ReactElement, { className: "w-24 h-24" })}
            </div>
            <div className={`h-12 w-12 rounded-lg flex items-center justify-center mb-4 ${styles.bg} ${styles.icon}`}>
                {icon}
            </div>
            <h3 className="font-bold text-lg text-gray-900 dark:text-white mb-1 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">{title}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{description}</p>
            <div className="mt-4 flex items-center text-xs font-semibold text-primary-600 dark:text-primary-400 opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0 transition-all duration-300">
                Comenzar <ArrowRightIcon className="ml-1 h-3 w-3" />
            </div>
        </button>
    );
};

/** The list filters, by whether the attention declares what it answers. */
const LINK_FILTERS: { id: LinkFilterId; label: string }[] = [
    { id: 'all', label: 'Todas' },
    { id: 'linked', label: 'Con iniciativa' },
    { id: 'unlinked', label: 'Sin iniciativa' },
    { id: 'active', label: 'Con entregables' },
];

type ViewId = 'resumen' | 'listado';
type LinkFilterId = 'all' | 'linked' | 'unlinked' | 'active';

/** A creation the user asked for, waiting on the initiative gate. */
type PendingCreation =
  | { kind: 'chat'; purpose: Extract<ChatModalPurpose, 'guided-creation' | 'analyze-document'> }
  | { kind: 'template' };

/** How the gate names what the user is about to do. */
const CREATION_INTENT: Record<string, string> = {
  'guided-creation': 'crear el proyecto con el arquitecto IA',
  'analyze-document': 'analizar el documento y abrir el proyecto',
  template: 'abrir el proyecto desde una plantilla',
};

const ProjectsPage: React.FC<ProjectsPageProps> = ({ navigateToWorkspace }) => {
  const { projects, deleteProject, runProjectCommand, t, settings } = useAppContext();
  const { initiatives } = useInitiatives();
  const { engagements, loadEngagements, createEngagement, approveCharter, runEngagementNow } = useOffice();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [view, setView] = useState<ViewId>('resumen');
  const [linkFilter, setLinkFilter] = useState<LinkFilterId>('all');
  const [linkProject, setLinkProject] = useState<Project | null>(null);
  /**
   * The creation the user asked for, held until the initiative gate is
   * answered. Every entry point parks here first — a gate that only covers
   * some of the doors is not a gate.
   */
  const [pendingCreation, setPendingCreation] = useState<PendingCreation | null>(null);
  /** Initiatives chosen at the gate, written with the project itself. */
  const [creationLinks, setCreationLinks] = useState<{ initiativeIds: string[]; codes: string[] }>({ initiativeIds: [], codes: [] });
  const createAttention = useCreateAttention();
  const [intakeProjectId, setIntakeProjectId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isChatModalOpen, setChatModalOpen] = useState(false);
  const [isTemplateModalOpen, setTemplateModalOpen] = useState(false);
  const [chatModalConfig, setChatModalConfig] = useState<{ purpose: ChatModalPurpose; title: string; initialPrompt: string; projectId?: string; } | null>(null);
  
  // States for Project Actions
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [contextProject, setContextProject] = useState<Project | null>(null);
  const [consistencyProject, setConsistencyProject] = useState<Project | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  type CreationStage = 'idle' | 'selecting' | 'creating';
  const [creationStage, setCreationStage] = useState<CreationStage>('idle');
  const [creationData, setCreationData] = useState<{ project: Project; suggestedArtifactNames: string[]; selectedArtifactNames: string[] } | null>(null);

  // Office engagements are what make an attention's health readable. They load
  // per project, so the page asks for all of them once and lets the context
  // deduplicate; without this the list would report every attention as idle.
  useEffect(() => {
    for (const project of projects) void loadEngagements(project.id);
  }, [projects, loadEngagements]);

  // The portrait and each attention's initiatives, resolved by key in
  // `useAttentionPortfolio` — ids win over the code mirror.
  const { portfolio, initiativesFor, servedInitiatives, unlinkedCount } =
    useAttentionPortfolio(initiatives, projects, engagements);

  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );

  const visibleNodes = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return portfolio.projects.filter((node) => {
      const linked = initiativesFor(node.projectId).length > 0;
      if (linkFilter === 'linked' && !linked) return false;
      if (linkFilter === 'unlinked' && linked) return false;
      if (linkFilter === 'active' && node.rollup.engagements === 0) return false;
      if (!needle) return true;
      return node.name.toLowerCase().includes(needle)
        || node.description.toLowerCase().includes(needle);
    });
  }, [portfolio.projects, initiativesFor, linkFilter, searchTerm]);

  /**
   * What the guided creation is told about the initiative the user picked at
   * the gate.
   *
   * Without this the assistant asks for a project name and objective as if the
   * need had never been written down — the user restates their own initiative
   * to a system that already holds it. The gate is the only place that knows
   * which initiative was chosen, so the briefing is assembled from its answer.
   */
  const creationContext = useMemo(() => {
    const chosen = initiatives.filter((candidate) => creationLinks.initiativeIds.includes(candidate.id));
    if (chosen.length === 0) return undefined;
    return chosen.map((initiative) => [
      `Iniciativa de negocio: ${initiative.code ? `${initiative.code} · ` : ''}${initiative.title}`,
      `Necesidad: ${initiative.need}`,
      initiative.driver ? `Driver: ${initiative.driver}` : '',
      initiative.objectives.length > 0 ? `Objetivos: ${initiative.objectives.join('; ')}` : '',
      initiative.expectedOutcomes.length > 0
        ? `Resultados esperados: ${initiative.expectedOutcomes.map((outcome) => outcome.statement).join('; ')}`
        : '',
      'Este proyecto de arquitectura es la respuesta a esa iniciativa. Encuadra tus preguntas y tus propuestas dentro de ella, y no vuelvas a preguntar lo que ya está declarado arriba.',
    ].filter(Boolean).join('\n')).join('\n\n');
  }, [initiatives, creationLinks]);

  /**
   * Deep link from an initiative: `?iniciativa=<id>&crear=guiado`.
   *
   * The initiative gate exists to stop a project being opened with no declared
   * business reason. Arriving from an initiative room, that question is already
   * answered — asking it again would be the system forgetting where the user
   * just came from. So the gate is satisfied from the link and the creation
   * opens directly, carrying the initiative's context into the assistant.
   */
  useEffect(() => {
    const initiativeId = searchParams.get('iniciativa');
    const mode = searchParams.get('crear');
    if (!initiativeId || !mode) return;
    const initiative = initiatives.find((candidate) => candidate.id === initiativeId);
    if (!initiative) return;

    setCreationLinks({
      initiativeIds: [initiative.id],
      codes: initiative.code ? [initiative.code] : [],
    });
    if (mode === 'plantilla') setTemplateModalOpen(true);
    else handleOpenChatModal(mode === 'documento' ? 'analyze-document' : 'guided-creation');

    // Consume the parameters so a reload does not reopen the flow.
    const next = new URLSearchParams(searchParams);
    next.delete('iniciativa');
    next.delete('crear');
    setSearchParams(next, { replace: true });
    // `handleOpenChatModal` is stable enough for this one-shot effect; adding it
    // would re-run the deep link on every render of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, initiatives, setSearchParams]);

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
    navigate('/office');
  }, [approveCharter, runEngagementNow, addToast, navigate]);

  /**
   * Creating an attention always asks for its initiative first. Talking to an
   * existing project does not — that is not a creation.
   */
  const startCreation = useCallback((pending: PendingCreation) => {
    setPendingCreation(pending);
  }, []);

  const handleOpenChatModal = (purpose: ChatModalPurpose, project?: Project) => {
    if (purpose === 'guided-creation') {
        setChatModalConfig({
            purpose,
            title: t('guidedCreationTitle'),
            initialPrompt: t('guidedCreationIntro'),
        });
    } else if (purpose === 'analyze-document') {
        setChatModalConfig({
            purpose,
            title: t('analyzeDocument'),
            initialPrompt: "Por favor, sube un documento de texto (.txt, .md) con los requerimientos o la descripción de tu proyecto. Analizaré su contenido para configurar el proyecto inicial.",
        });
    } else if (purpose === 'project-chat' && project) {
        setChatModalConfig({
            purpose,
            title: `Conversación: ${project.name}`,
            initialPrompt: `Hola, soy el arquitecto de soluciones asignado al proyecto "${project.name}". ¿En qué puedo ayudarte hoy?`,
            projectId: project.id
        });
    }
    setChatModalOpen(true);
  };
  
  const handleChatComplete = (projectData: GuidedProjectData) => {
    // Only handle completion for creation-related tasks
    if (chatModalConfig?.purpose === 'project-chat') {
        // For project chat, closing is handled by modal close button, data is persisted continuously.
        return;
    }

    setChatModalOpen(false);
    if (projectData && projectData.name) {
        const createdProject = createAttention({
          name: projectData.name,
          description: projectData.description,
          projectContext: projectData.projectContext || [],
          initiativeIds: creationLinks.initiativeIds,
          linkedBusinessProjects: creationLinks.codes,
        });
        if (!createdProject) return;

        const suggested: string[] = Array.isArray(projectData.initialArtifacts) ? projectData.initialArtifacts : [];
        setCreationData({
            project: createdProject,
            suggestedArtifactNames: suggested,
            selectedArtifactNames: [],
        });
        setCreationStage('selecting');
    }
  };

  const handleTemplateSelect = async (template: Template) => {
    setTemplateModalOpen(false);

    const createdProject = createAttention({
      name: template.name,
      description: template.description,
      projectContext: [`Basado en la plantilla: ${template.name}`],
      initiativeIds: creationLinks.initiativeIds,
      linkedBusinessProjects: creationLinks.codes,
    });
    if (!createdProject) return;

    const initialArtifacts = await artifactGenerationService.getInitialArtifactsForTemplate(template.name, settings);

    setCreationData({
        project: createdProject,
        suggestedArtifactNames: initialArtifacts,
        selectedArtifactNames: [],
    });
    setCreationStage('selecting');
  };

  const handleSelectionConfirm = (selectedNames: string[]) => {
    setCreationData(prev => prev ? { ...prev, selectedArtifactNames: selectedNames } : prev);
    setCreationStage('creating');
  };

  const handleSelectionSkip = () => {
    if (!creationData) return;
    const projectId = creationData.project.id;
    setCreationStage('idle');
    setCreationData(null);
    navigateToWorkspace(projectId);
  };

  const handleSelectionCancel = () => {
    // Keep the created project (so the user doesn't lose context) and return to the list.
    setCreationStage('idle');
    setCreationData(null);
  };

  const handleConfirmDelete = () => {
    if (projectToDelete) {
      deleteProject(projectToDelete);
      setProjectToDelete(null);
    }
  };

  if (creationStage === 'selecting' && creationData) {
    return (
      <ArtifactSelectionStep
        projectName={creationData.project.name}
        projectDescription={creationData.project.description}
        suggestedNames={creationData.suggestedArtifactNames}
        onConfirm={handleSelectionConfirm}
        onSkip={handleSelectionSkip}
        onCancel={handleSelectionCancel}
      />
    );
  }

  if (creationStage === 'creating' && creationData) {
    return (
      <ProjectCreationStatus
        project={creationData.project}
        initialArtifactNames={creationData.selectedArtifactNames}
        onComplete={(projectId) => {
          setCreationStage('idle');
          setCreationData(null);
          navigateToWorkspace(projectId);
        }}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-50 dark:bg-gray-950">
      <div className="flex-1 overflow-y-auto p-4 md:p-12 md:pl-20">
        {isChatModalOpen && chatModalConfig && (
            <ChatModal
                isOpen={isChatModalOpen}
                onClose={() => setChatModalOpen(false)}
                onComplete={handleChatComplete}
                purpose={chatModalConfig.purpose}
                title={chatModalConfig.title}
                initialPrompt={chatModalConfig.initialPrompt}
                projectId={chatModalConfig.projectId}
                contextData={chatModalConfig.purpose === 'project-chat' ? undefined : creationContext}
            />
        )}
        <TemplateSelectionModal 
            isOpen={isTemplateModalOpen}
            onClose={() => setTemplateModalOpen(false)}
            onSelect={handleTemplateSelect}
        />
        
        {/* Modals for Project Actions */}
        {projectToDelete && (
            <Modal
            isOpen={!!projectToDelete}
            onClose={() => setProjectToDelete(null)}
            title={t('confirmDelete')}
            >
            <div className="space-y-6 p-2">
                <div className="flex items-center space-x-4 bg-red-50 dark:bg-red-900/20 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                    <div className="flex-shrink-0">
                         <TrashIcon className="h-6 w-6 text-red-600" />
                    </div>
                    <p className="text-sm text-red-800 dark:text-red-200">
                        {t('deleteProjectWarning')}
                    </p>
                </div>
                <div className="flex justify-end space-x-3">
                    <Button variant="secondary" onClick={() => setProjectToDelete(null)}>{t('no')}</Button>
                    <Button variant="danger" onClick={handleConfirmDelete}>{t('yes')}</Button>
                </div>
            </div>
            </Modal>
        )}

        {contextProject && (
            <ProjectContextModal 
                isOpen={!!contextProject}
                onClose={() => setContextProject(null)}
                project={contextProject}
            />
        )}

        {consistencyProject && (
            <ConsistencyCheckModal 
                isOpen={!!consistencyProject}
                onClose={() => setConsistencyProject(null)}
                project={consistencyProject}
            />
        )}

        <div className="mx-auto max-w-7xl space-y-5">

            {/* Sección 1 · Identidad de la pantalla y acción principal */}
            <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-in">
                <div className="min-w-0">
                    <p className="text-2xs font-semibold uppercase tracking-widest-2 text-primary-600 dark:text-primary-400">
                        Arquitectura Empresarial · capa de respuesta
                    </p>
                    <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-50 md:text-display-sm">
                        {EA_LEVELS.engagementProject.plural}
                    </h1>
                    <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
                        {EA_LEVELS.engagementProject.definition}
                    </p>
                </div>
                <Button variant="primary" onClick={() => startCreation({ kind: 'chat', purpose: 'guided-creation' })}>
                    <PlusIcon className="mr-1.5 h-4 w-4" aria-hidden />
                    Nuevo proyecto
                </Button>
            </header>

            {projects.length === 0 ? (
                <EmptyState
                    flavor="ai"
                    icon={<FolderOpenIcon className="h-7 w-7" />}
                    title="Todavía no hay proyectos de arquitectura"
                    description="Un proyecto de arquitectura es la respuesta a una necesidad del negocio. Créalo aquí y desde él abrirás los entregables que la Oficina va a producir."
                    actions={
                        <Button
                            variant="ai"
                            leftIcon={<PlusIcon className="h-4 w-4" />}
                            onClick={() => startCreation({ kind: 'chat', purpose: 'guided-creation' })}
                        >
                            Crear el primer proyecto
                        </Button>
                    }
                />
            ) : (
                <>
                    {/* Sección 2 · Los números del nivel */}
                    <AttentionKpiRow
                        portfolio={portfolio}
                        unlinkedCount={unlinkedCount}
                        servedInitiatives={servedInitiatives}
                        onFocusUnlinked={() => { setView('listado'); setLinkFilter('unlinked'); }}
                        onFocusDecisions={() => navigate('/office')}
                    />

                    {/* Sección 3 · Resumen y listado, la misma navegación que iniciativas */}
                    <Tabs
                        value={view}
                        onChange={(next) => setView(next as ViewId)}
                        variant="pill"
                        aria-label="Vistas de proyectos de arquitectura"
                    >
                        <TabList className="w-full overflow-x-auto sm:w-auto">
                            <Tab value="resumen" icon={<LayoutDashboard className="h-4 w-4" aria-hidden />}>
                                Resumen
                            </Tab>
                            <Tab
                                value="listado"
                                icon={<ListFilter className="h-4 w-4" aria-hidden />}
                                badge={projects.length}
                            >
                                Listado
                            </Tab>
                        </TabList>

                        <TabPanel value="resumen" className="space-y-4 pt-4">
                            <PortfolioPulse rollup={portfolio.rollup} activity={portfolio.activity} />

                            {/*
                              The Architecture Office is the default way work enters the
                              system: a brief becomes a deliverable with a charter, assigned
                              specialists and cross-review. The three cards below stay as
                              "modo directo" for one-off work that does not warrant one.
                            */}
                            <button
                                type="button"
                                onClick={() => navigate('/office')}
                                className="group w-full text-left rounded-2xl border border-primary-200 dark:border-primary-900/60 bg-gradient-to-br from-primary-50 via-white to-indigo-50 dark:from-primary-950/40 dark:via-gray-900 dark:to-indigo-950/40 p-6 shadow-sm hover:shadow-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                            >
                                <div className="flex flex-wrap items-center gap-4">
                                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-900/50 text-primary-600 dark:text-primary-300">
                                        <BuildingOffice2Icon className="h-7 w-7" />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-400">
                                            Recomendado
                                        </p>
                                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                                            Abrir un entregable en la Oficina de Arquitectura
                                        </h3>
                                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                                            Describe el entregable y la Oficina propone el plan de artefactos, asigna un
                                            especialista a cada uno con un revisor distinto, ejecuta el trabajo y lo lleva
                                            al comité de arquitectura.
                                        </p>
                                    </div>
                                    <span className="inline-flex items-center text-sm font-semibold text-primary-600 dark:text-primary-400">
                                        Ir a la Oficina <ArrowRightIcon className="ml-1 h-4 w-4" />
                                    </span>
                                </div>
                            </button>

                            <div className="space-y-3">
                                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                    Modo directo
                                </h2>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <ActionCard
                                        icon={<ChatBubbleLeftRightIcon className="h-8 w-8" />}
                                        title={t('guidedCreation')}
                                        description={t('guidedCreationDescription')}
                                        onClick={() => startCreation({ kind: 'chat', purpose: 'guided-creation' })}
                                        theme="indigo"
                                    />
                                    <ActionCard
                                        icon={<DocumentTextIcon className="h-8 w-8" />}
                                        title={t('analyzeDocument')}
                                        description={t('analyzeDocumentDescription')}
                                        onClick={() => startCreation({ kind: 'chat', purpose: 'analyze-document' })}
                                        theme="emerald"
                                    />
                                    <ActionCard
                                        icon={<ViewColumnsIcon className="h-8 w-8" />}
                                        title={t('startFromTemplate')}
                                        description={t('startFromTemplateDescription')}
                                        onClick={() => startCreation({ kind: 'template' })}
                                        theme="blue"
                                    />
                                </div>
                            </div>
                        </TabPanel>

                        <TabPanel value="listado" className="space-y-3 pt-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="relative min-w-0 flex-1 sm:max-w-xs">
                                    <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
                                    <Input
                                        aria-label="Buscar por nombre o descripción"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        placeholder="Buscar por nombre o descripción"
                                        className="pl-8"
                                    />
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    {LINK_FILTERS.map(({ id, label }) => (
                                        <button
                                            key={id}
                                            type="button"
                                            onClick={() => setLinkFilter(id)}
                                            aria-pressed={linkFilter === id}
                                            className={cn(
                                                'rounded-lg px-2.5 py-1 text-2xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                                                linkFilter === id
                                                    ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-200'
                                                    : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
                                            )}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {visibleNodes.length === 0 ? (
                                <p className="rounded-xl bg-gray-50 px-4 py-6 text-center text-sm text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
                                    Ningún proyecto coincide con el filtro.
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {visibleNodes.map((node) => (
                                        <div key={node.projectId} className="relative">
                                            <AttentionCard
                                                node={node}
                                                initiatives={initiativesFor(node.projectId)}
                                                onOpen={() => navigateToWorkspace(node.projectId)}
                                                onNewDeliverable={() => setIntakeProjectId(node.projectId)}
                                                onLinkInitiative={() => setLinkProject(projects.find((p) => p.id === node.projectId) ?? null)}
                                                onOpenInitiative={(initiativeId) => navigate(`/initiatives/${initiativeId}`)}
                                            />
                                            <div className="absolute right-3 top-3" onClick={(e) => e.stopPropagation()}>
                                                <Button
                                                    variant="ghost"
                                                    iconOnly
                                                    size="sm"
                                                    aria-label={`Acciones de ${node.name}`}
                                                    onClick={() => setOpenMenuId(openMenuId === node.projectId ? null : node.projectId)}
                                                    className={openMenuId === node.projectId ? 'bg-gray-100 dark:bg-gray-800' : ''}
                                                >
                                                    <EllipsisHorizontalIcon className="h-5 w-5" />
                                                </Button>
                                                {projectsById.get(node.projectId) && (
                                                    <ProjectActionsMenu
                                                        project={projectsById.get(node.projectId)!}
                                                        isOpen={openMenuId === node.projectId}
                                                        onClose={() => setOpenMenuId(null)}
                                                        onDelete={() => setProjectToDelete(node.projectId)}
                                                        onManageContext={() => setContextProject(projectsById.get(node.projectId)!)}
                                                        onCheckConsistency={() => setConsistencyProject(projectsById.get(node.projectId)!)}
                                                        onChat={() => handleOpenChatModal('project-chat', projectsById.get(node.projectId)!)}
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </TabPanel>
                    </Tabs>
                </>
            )}
        </div>
      </div>

      <AttentionInitiativeGate
        open={pendingCreation !== null}
        initiatives={initiatives}
        intent={pendingCreation
          ? CREATION_INTENT[pendingCreation.kind === 'template' ? 'template' : pendingCreation.purpose]
          : 'abrir el proyecto'}
        onCreateInitiative={() => { setPendingCreation(null); navigate('/initiatives'); }}
        onClose={() => setPendingCreation(null)}
        onContinue={(links) => {
          setCreationLinks(links);
          const pending = pendingCreation;
          setPendingCreation(null);
          if (!pending) return;
          if (pending.kind === 'template') setTemplateModalOpen(true);
          else handleOpenChatModal(pending.purpose);
        }}
      />

      <LinkInitiativeModal
        project={linkProject}
        initiatives={initiatives}
        onClose={() => setLinkProject(null)}
        onSave={(projectId, links) => runProjectCommand(projectId, {
          kind: 'link-initiatives', initiativeIds: links.initiativeIds, codes: links.codes,
        })}
        onCreateInitiative={() => navigate('/initiatives')}
      />

      {/*
        Opening a deliverable from an attention preselects that attention, so the
        second level of the hierarchy is already answered when the dialog opens.
      */}
      <EngagementIntakeWizard
        open={intakeProjectId !== null}
        initialProjectId={intakeProjectId ?? undefined}
        projects={projects.map((project) => ({
          id: project.id,
          name: project.name,
          initiativeIds: project.initiativeIds ?? [],
        }))}
        initiatives={initiatives}
        onCreateAttention={() => { setIntakeProjectId(null); startCreation({ kind: 'chat', purpose: 'guided-creation' }); }}
        onCreateInitiative={() => navigate('/initiatives')}
        onPropose={handleProposeEngagement}
        onApproveAndRun={handleApproveAndRun}
        onClose={() => setIntakeProjectId(null)}
      />
    </div>
  );
};

export default ProjectsPage;
