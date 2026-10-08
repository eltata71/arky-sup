import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { useOffice } from '../context/OfficeContext';
import { useToast } from '../context/ToastContext';
import { ArtifactTemplate } from '../types';
import type { Artifact, ArtifactGenerationPhaseListener } from '../lib/artifacts';
import { ProjectHub } from '../components/ProjectHub';
import { ProjectContextBar } from '../components/navigation';
import { SparklesIcon } from '../components/Icons';
import { VersionConflictModal } from '../components/VersionConflictModal';
import { DataIntegrityCheckModal } from '../components/DataIntegrityCheckModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { CopilotSidebar } from '../components/CopilotSidebar';
import { ArtifactReadinessModal } from '../components/ArtifactReadinessModal';
import { useRegisterCommands, type Command } from '../context/CommandPaletteContext';
import { validateArtifactReadiness, type ReadinessResult } from '../lib/artifacts/artifactGovernance';
import { useProjectArtifacts } from '../hooks/useProjectArtifacts';
import { useArtifactPersona } from '../hooks/useArtifactPersona';
import { useArtifactContextPorts } from '../hooks/useArtifactContextPorts';
import { useGenerationQueue } from '../hooks/artifacts/useGenerationQueue';

const ArtifactCanvas = React.lazy(() => import('../components/ArtifactCanvas').then((module) => ({ default: module.ArtifactCanvas })));

interface WorkspaceProps {
  projectId: string;
}

interface IntegrityCheckResult {
  corruptArtifacts: Artifact[];
}

const Workspace: React.FC<WorkspaceProps> = ({ projectId }) => {
  // The portfolio loads an index, not the documents. This screen edits their
  // content, so it asks for the real artifacts on mount.
  useProjectArtifacts(projectId);
  const { projects, t, deleteArtifact, settings, findLatestArtifactByName, removeCorruptArtifacts, isLoading: isGlobalLoading } = useAppContext();
  const { enqueue } = useGenerationQueue();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const project = useMemo(() => projects.find(p => p.id === projectId), [projects, projectId]);

  /**
   * The Office owns the engagements that produce this project's artifacts, so
   * the workspace asks for just this project's — enough to offer the way back
   * up the hierarchy without loading the whole portfolio.
   */
  const { engagements, loadEngagements } = useOffice();
  useEffect(() => {
    if (projectId) void loadEngagements(projectId);
  }, [projectId, loadEngagements]);
  const projectEngagements = useMemo(
    () => engagements.filter((engagement) => engagement.projectId === projectId),
    [engagements, projectId],
  );

  // View State: null means Hub (Screen 2), string means Canvas (Screen 3)
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
  const [pendingOpenArtifactId, setPendingOpenArtifactId] = useState<string | null>(null);
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);

  // States for creation
  const [versionConflict, setVersionConflict] = useState<{ template: ArtifactTemplate, existingArtifact: Artifact } | null>(null);
  
  // Integrity check
  const [integrityCheckResult, setIntegrityCheckResult] = useState<IntegrityCheckResult | null>(null);
  
  // Confirm delete state
  const [deleteConfirm, setDeleteConfirm] = useState<{ artifactId: string; name: string } | null>(null);
  const [readinessResult, setReadinessResult] = useState<(ReadinessResult & { artifactName: string }) | null>(null);

  // Sync active artifact object
  useEffect(() => {
    if (activeArtifactId && project) {
        const art = project.artifacts.find(a => a.id === activeArtifactId);
        // Defence against a Firestore round-trip race: if the project state
        // hasn't observed the just-persisted artifact yet, keep whatever
        // optimistic object `proceedWithGeneration` set instead of clearing
        // it to null (which would close the canvas and the user would land
        // on the project hub, not on their artifact).
        if (art) {
            setActiveArtifact(art);
        } else {
            setActiveArtifact(prev => (prev && prev.id === activeArtifactId ? prev : null));
        }
    } else {
        setActiveArtifact(null);
    }
  }, [activeArtifactId, project]);

  // Deep-link: open canvas from ?artifact=<id> query param (used by SDDProcessView after generation).
  useEffect(() => {
    if (!project) return;
    const artifactParam = searchParams.get('artifact');
    if (!artifactParam || artifactParam === activeArtifactId) {
      setPendingOpenArtifactId(null);
      return;
    }

    setPendingOpenArtifactId(artifactParam);
    setDeepLinkError(null);
    const exists = project.artifacts.some(a => a.id === artifactParam);
    if (exists) {
      setActiveArtifactId(artifactParam);
      setPendingOpenArtifactId(null);
      // Clear the param so back-navigation returns the user to the Hub instead of re-opening the canvas.
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('artifact');
        next.delete('source');
        return next;
      }, { replace: true });
    }
  }, [project, searchParams, activeArtifactId, setSearchParams]);

  useEffect(() => {
    if (!pendingOpenArtifactId || project?.artifactsLoaded === false) return;
    const timeout = window.setTimeout(() => {
      setPendingOpenArtifactId(null);
      setDeepLinkError('El artefacto terminó de generarse, pero no pudimos abrirlo automáticamente. Puedes abrirlo manualmente desde la tabla de artefactos.');
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('artifact');
        next.delete('source');
        return next;
      }, { replace: true });
    }, 10000);

    return () => window.clearTimeout(timeout);
  }, [pendingOpenArtifactId, project?.artifactsLoaded, setSearchParams]);

  const handleConfirmCleanup = () => {
      if (project && integrityCheckResult) {
          const idsToRemove = integrityCheckResult.corruptArtifacts.map(a => a.id).filter(id => id);
          removeCorruptArtifacts(project.id, idsToRemove);
          setIntegrityCheckResult(null); 
      }
  };

  const composePersonaInstruction = useArtifactPersona();
  const loadContextPorts = useArtifactContextPorts(project);
  const proceedWithGeneration = useCallback(async (
        template: ArtifactTemplate,
        action: 'create' | 'replace' | 'new_version' = 'create',
        existingArtifact?: Artifact,
        onPhase?: ArtifactGenerationPhaseListener,
  ): Promise<boolean> => {
    if (!project) return false;
    enqueue({ project, template, settings, action, existingArtifact,
      composePersonaInstruction, loadContextPorts, onPhase });
    addToast(`«${template.name}» está en la cola de generación.`, 'info');
    return true;
  }, [project, settings, enqueue, composePersonaInstruction, loadContextPorts, addToast]);

  const handleCreateArtifact = useCallback(async (
        template: ArtifactTemplate,
        onPhase?: ArtifactGenerationPhaseListener,
  ): Promise<boolean> => {
    if (!project) return false;
    const readiness = validateArtifactReadiness(project, template);
    if (!readiness.canGenerate) {
        setReadinessResult({ ...readiness, artifactName: template.name });
        return false;
    }
    if (readiness.score < 90) {
        addToast(`Validación previa completada para "${template.name}" con score ${readiness.score}/100.`, 'warning');
    }

    // Check if it already exists to show conflict modal
    const existingArtifact = findLatestArtifactByName(project.id, template.name);
    if (existingArtifact) {
        setVersionConflict({ template, existingArtifact });
        return true;
    }

    return proceedWithGeneration(template, 'create', undefined, onPhase);
  }, [project, findLatestArtifactByName, proceedWithGeneration, addToast]);

  const handleGenerateWorldClassArtifact = useCallback((artifact: Artifact) => {
    if (!project) return;

    const template: ArtifactTemplate = {
        name: artifact.name,
        type: artifact.type,
        phase: artifact.phase,
        architecturalView: artifact.architecturalView,
        objective: `${artifact.objective} Generar una nueva versión de clase mundial, lista para presentación ejecutiva y revisión técnica.`,
        keyConcepts: artifact.keyConcepts,
        representation: artifact.representation,
        requestContext: {
            userRequest: `Generación de clase mundial basada en el artefacto seleccionado "${artifact.name}". Mantener el alcance, actores, sistemas y decisiones vigentes, pero corregir hallazgos de calidad, mejorar jerarquía visual, legibilidad, narrativa, exportabilidad y preparación ejecutiva/técnica.`,
            matchedCatalogTemplateName: artifact.name,
            audience: artifact.audience === 'executive' ? 'executive' : 'technical',
            rationale: 'El usuario solicitó una nueva versión World Class desde el menú contextual del artefacto existente, no solo un mensaje de orientación.',
            constructionPlan: [
                'Usar el contenido actual como línea base obligatoria y preservar semántica, alcance y trazabilidad.',
                'Recomponer la presentación con jerarquía visual clara: grupos legibles, etiquetas accionables, narrativa y metadata de calidad.',
                'Eliminar placeholders o señales de esqueleto, normalizar IDs/labels y asegurar que el resultado sea renderizable/exportable.',
                'Apuntar a score ≥ 92/100 en el quality gate y persistir como nueva versión del mismo artefacto.',
            ],
        },
    };

    addToast(`Iniciando generación de clase mundial para "${artifact.name}"…`, 'info');
    void proceedWithGeneration(template, 'new_version', artifact);
  }, [project, proceedWithGeneration, addToast]);

  const handleResolveConflict = (action: 'generate' | 'replace') => {
    if (!versionConflict) return;
    if (action === 'generate') {
        proceedWithGeneration(versionConflict.template, 'new_version', versionConflict.existingArtifact);
    } else {
        proceedWithGeneration(versionConflict.template, 'replace', versionConflict.existingArtifact);
    }
    setVersionConflict(null);
  };

  const handleDeleteArtifact = (artifactId: string) => {
      const artifact = project?.artifacts.find(a => a.id === artifactId);
      setDeleteConfirm({ artifactId, name: artifact?.name || 'artefacto' });
  };

  const confirmDeleteArtifact = () => {
      if (deleteConfirm && project) {
          deleteArtifact(project.id, deleteConfirm.artifactId);
          setDeleteConfirm(null);
      }
  };

  // Register workspace-scoped commands in the global Cmd+K palette.  We rely on
  // useMemo to stabilise the array reference so the registration doesn't churn
  // on every render — useRegisterCommands uses identity to detect changes.
  const workspaceCommands = useMemo<Command[]>(() => {
    if (!project) return [];
    const list: Command[] = [
        {
            id: 'workspace.back-hub',
            section: 'Proyecto',
            title: 'Volver al hub del proyecto',
            subtitle: 'Cerrar el lienzo activo y ver el listado de artefactos',
            run: () => setActiveArtifactId(null),
            keywords: ['hub','volver','listado'],
        },
        {
            id: 'workspace.go-home',
            section: 'Proyecto',
            title: 'Ir al Dashboard',
            run: () => navigate('/'),
            keywords: ['inicio','home'],
        },
    ];
    project.artifacts.slice(0, 30).forEach(a => {
        list.push({
            id: `workspace.open.${a.id}`,
            section: 'Abrir artefacto',
            title: a.name,
            subtitle: `${a.architecturalView} · v${a.version}`,
            run: () => setActiveArtifactId(a.id),
            keywords: [a.type, a.phase],
        });
    });
    return list;
  }, [project, navigate]);
  useRegisterCommands(workspaceCommands);

  // --- Render Logic ---

  if (isGlobalLoading) {
    return (
        <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-950" role="status" aria-label="Cargando proyecto">
            <div className="flex flex-col items-center gap-3 animate-fade-in">
                <div className="relative h-12 w-12">
                    <div className="absolute inset-0 rounded-full bg-primary-200/50 dark:bg-primary-900/40 animate-ping" />
                    <div className="relative h-12 w-12 border-[3px] border-primary-200 dark:border-primary-900 border-t-primary-600 dark:border-t-primary-300 rounded-full animate-spin" />
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Cargando proyecto…</p>
            </div>
        </div>
    );
  }
  if (!project) {
    return (
        <div className="flex items-center justify-center h-screen p-6 bg-gray-50 dark:bg-gray-950">
            <div className="max-w-md text-center animate-slide-up">
                <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300 mb-4">
                    <SparklesIcon className="h-6 w-6" />
                </div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-1">{t('projectNotFound')}</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">El proyecto que buscas puede haber sido eliminado o no tienes acceso a él.</p>
                <button
                    type="button"
                    onClick={() => navigate('/')}
                    className="inline-flex items-center justify-center h-10 px-4 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors"
                >
                    Volver al Dashboard
                </button>
            </div>
        </div>
    );
  }
  if (integrityCheckResult?.corruptArtifacts.length) return <DataIntegrityCheckModal corruptArtifacts={integrityCheckResult.corruptArtifacts} onConfirm={handleConfirmCleanup} />;

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden min-h-0 md:pl-14">

        {pendingOpenArtifactId && <p role="status" className="mx-4 mt-3 text-sm text-gray-600 dark:text-gray-300">{t('workspace.openingArtifact')}</p>}

        {/* Workspace shell: main canvas/hub on the left, persistent copilot on the right */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden">
                {activeArtifact ? (
                    /* SCREEN 3: ARTIFACT CANVAS (Active) */
                    <div className="flex flex-col h-full bg-white dark:bg-gray-950 animate-fade-in min-h-0">
                        <div className="flex-1 relative overflow-hidden min-h-0">
                            <ErrorBoundary key={activeArtifact.id} fallbackTitle="Error al renderizar el artefacto">
                                <React.Suspense fallback={<p role="status" className="p-4 text-sm text-gray-600 dark:text-gray-300">{t('workspace.openingArtifact')}</p>}>
                                    <ArtifactCanvas
                                        project={project}
                                        artifact={activeArtifact}
                                        onGenerateWorldClass={handleGenerateWorldClassArtifact}
                                        setActiveArtifactId={setActiveArtifactId}
                                        onBack={() => setActiveArtifactId(null)}
                                    />
                                </React.Suspense>
                            </ErrorBoundary>
                        </div>
                    </div>
                ) : (
                    /* SCREEN 2: PROJECT HUB */
                    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
                        {deepLinkError && (
                            <div className="mx-4 mt-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 px-4 py-3 rounded-xl text-sm flex items-start justify-between gap-3">
                                <span>{deepLinkError}</span>
                                <button
                                  className="text-amber-700 dark:text-amber-300 hover:underline whitespace-nowrap"
                                  onClick={() => setDeepLinkError(null)}
                                >
                                  Cerrar
                                </button>
                            </div>
                        )}
                        <ProjectContextBar
                            className="shrink-0 bg-white/90 backdrop-blur dark:bg-[#111116]/95"
                            projectName={project.name}
                            businessProgramIds={project.linkedBusinessProjects ?? []}
                            engagements={projectEngagements}
                            onOpenOffice={() => navigate('/office')}
                            onOpenEngagement={(engagementId) => navigate(`/office/${engagementId}`)}
                        />
                        <div className="min-h-0 flex-1">
                        <ProjectHub
                            project={project}
                            /* Deep link from a deliverable: `?crear=artefacto`. */
                            openArtifactCreation={searchParams.get('crear') === 'artefacto'}
                            onArtifactCreationOpened={() => {
                                const next = new URLSearchParams(searchParams);
                                next.delete('crear');
                                setSearchParams(next, { replace: true });
                            }}
                            onOpenArtifact={setActiveArtifactId}
                            onCreateArtifact={handleCreateArtifact}
                            onDeleteArtifact={handleDeleteArtifact}
                            onGenerateWorldClass={handleGenerateWorldClassArtifact}
                            onBack={() => navigate('/')}
                            onOpenSDD={() => navigate(`/sdd-process/${projectId}`)}
                        />
                        </div>
                    </div>
                )}
            </div>

            <CopilotSidebar
                project={project}
                activeArtifact={activeArtifact}
                setActiveArtifactId={setActiveArtifactId}
                onRequestArtifactGeneration={handleCreateArtifact}
            />
        </div>

        {/* Modals */}
        {versionConflict && (
            <VersionConflictModal
                isOpen={!!versionConflict}
                onClose={() => setVersionConflict(null)}
                artifactName={versionConflict.template.name}
                onGenerateNewVersion={() => handleResolveConflict('generate')}
                onReplaceExisting={() => handleResolveConflict('replace')}
            />
        )}

        <ConfirmDialog
            isOpen={!!deleteConfirm}
            title="Eliminar Artefacto"
            message={`¿Estás seguro de que deseas eliminar "${deleteConfirm?.name}"? Esta acción no se puede deshacer.`}
            confirmLabel="Eliminar"
            cancelLabel="Cancelar"
            variant="danger"
            onConfirm={confirmDeleteArtifact}
            onCancel={() => setDeleteConfirm(null)}
        />
        {readinessResult && (
            <ArtifactReadinessModal
                isOpen={!!readinessResult}
                artifactName={readinessResult.artifactName}
                score={readinessResult.score}
                missingArtifacts={readinessResult.missingArtifacts}
                missingInputs={readinessResult.missingInputs}
                blockers={readinessResult.blockers}
                onClose={() => setReadinessResult(null)}
            />
        )}

    </div>
  );
};

export default Workspace;
