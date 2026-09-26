import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { useOffice } from '../context/OfficeContext';
import { useToast } from '../context/ToastContext';
import { ArtifactTemplate } from '../types';
import type { Artifact, ArtifactGenerationPhaseListener } from '../lib/artifacts';
import { ArtifactCanvas } from '../components/ArtifactCanvas';
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
import { observabilityService } from '../services/observability';
import { useProjectArtifacts } from '../hooks/useProjectArtifacts';
import { useArtifactPersona } from '../hooks/useArtifactPersona';
import { runArtifactGeneration } from '../services/artifacts/application/artifactGenerationRun';
import { describeGenerationFailure } from '../services/artifacts/application/generationFailure';

interface WorkspaceProps {
  projectId: string;
}

interface IntegrityCheckResult {
  corruptArtifacts: Artifact[];
}

interface GenerationFailureState {
  artifactName: string;
  headline: string;
  userMessage: string;
  technicalMessage: string;
  onRetry: () => void;
}

const Workspace: React.FC<WorkspaceProps> = ({ projectId }) => {
  // The portfolio loads an index, not the documents. This screen edits their
  // content, so it asks for the real artifacts on mount.
  useProjectArtifacts(projectId);
  const { projects, t, createArtifact, createArtifactVersion, updateArtifact, deleteArtifact, settings, findLatestArtifactByName, removeCorruptArtifacts, isLoading: isGlobalLoading } = useAppContext();
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
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingMessage, setGeneratingMessage] = useState('');
  const [generationElapsedSec, setGenerationElapsedSec] = useState(0);
  const [versionConflict, setVersionConflict] = useState<{ template: ArtifactTemplate, existingArtifact: Artifact } | null>(null);
  
  // Integrity check
  const [integrityCheckResult, setIntegrityCheckResult] = useState<IntegrityCheckResult | null>(null);
  
  // Confirm delete state
  const [deleteConfirm, setDeleteConfirm] = useState<{ artifactId: string; name: string } | null>(null);
  const [readinessResult, setReadinessResult] = useState<(ReadinessResult & { artifactName: string }) | null>(null);
  const [generationFailure, setGenerationFailure] = useState<GenerationFailureState | null>(null);

  const isMounted = useRef(true);

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
    if (!pendingOpenArtifactId) return;
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
  }, [pendingOpenArtifactId, setSearchParams]);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    if (!isGenerating) return;
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      setGenerationElapsedSec(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isGenerating]);

  const handleDismissGenerationOverlay = useCallback(() => {
    setIsGenerating(false);
    setGeneratingMessage('');
    addToast('La generación sigue protegida por trazabilidad. Si termina correctamente, el artefacto se abrirá automáticamente; si falla, verás el diagnóstico.', 'warning', { durationMs: 7000 });
    observabilityService.trackEvent({
        severity: 'warning',
        source: 'user-action',
        status: 'observed',
        title: 'Overlay de generación cerrado manualmente',
        message: 'El usuario recuperó acceso al workspace mientras la operación asincrónica seguía en curso.',
        recoverable: true,
        userVisible: true,
        metadata: { projectId: project?.id, elapsedSec: generationElapsedSec },
    });
  }, [addToast, generationElapsedSec, project?.id]);

  const handleConfirmCleanup = () => {
      if (project && integrityCheckResult) {
          const idsToRemove = integrityCheckResult.corruptArtifacts.map(a => a.id).filter(id => id);
          removeCorruptArtifacts(project.id, idsToRemove);
          setIntegrityCheckResult(null); 
      }
  };

  const composePersonaInstruction = useArtifactPersona();
  const proceedWithGeneration = useCallback(async (
        template: ArtifactTemplate,
        action: 'create' | 'replace' | 'new_version' = 'create',
        existingArtifact?: Artifact,
        onPhase?: ArtifactGenerationPhaseListener,
  ): Promise<boolean> => {
    if (!project) return false;
    setIsGenerating(true);
    setGenerationElapsedSec(0);
    setGenerationFailure(null);
    setGeneratingMessage(t('generatingArtifact', {artifactName: template.name}));
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const generationOperationId = `gen-${project.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const observedOperation = observabilityService.startOperation('Generación de artefacto', {
        operationId: generationOperationId,
        projectId: project.id,
        artifactName: template.name,
        artifactType: template.type,
        action,
    });
    try {
        const {
            generatedContent,
            persistedContent,
            ir,
            persistedAudience,
            generationTrace,
            persistedEnvelope,
            skeletonFallbackError,
        } = await runArtifactGeneration({
            project,
            template,
            settings,
            existingArtifact,
            action,
            operationId: generationOperationId,
            startedAt,
            startedMs,
            onPhase, composePersonaInstruction,
            onWarning: message => {
                if (isMounted.current) addToast(message, 'warning', { durationMs: 8000 });
            },
        });

        onPhase?.({
            stage: 'persistence',
            status: 'in-progress',
            message: 'Persistiendo artefacto y preparando el canvas.',
            at: new Date().toISOString(),
            meta: {
                operationId: generationOperationId,
                action,
                hasIR: Boolean(ir),
                contentLength: persistedContent.length,
                fallback: skeletonFallbackError ? 'skeleton' : 'none',
            },
        });

        if (isMounted.current) {
            if (action === 'replace' && existingArtifact) {
                updateArtifact(project.id, existingArtifact.id, {
                    content: persistedContent,
                    ...(ir ? { ir } : {}),
                    ...(persistedAudience ? { audience: persistedAudience } : {}),
                    generationTrace,
                    rawResponse: generatedContent,
                    artifactEnvelope: persistedEnvelope,
                    ...(skeletonFallbackError ? { lastDiagramError: skeletonFallbackError } : { lastDiagramError: undefined }),
                });
                setActiveArtifactId(existingArtifact.id);
            } else if (action === 'new_version' && existingArtifact) {
                const newArtifactData = {
                    name: template.name,
                    type: template.type,
                    phase: template.phase,
                    architecturalView: template.architecturalView,
                    content: persistedContent,
                    objective: template.objective,
                    keyConcepts: template.keyConcepts,
                    representation: template.representation,
                    isFavorite: false,
                    ...(ir ? { ir } : {}),
                    ...(persistedAudience ? { audience: persistedAudience } : {}),
                    generationTrace,
                    rawResponse: generatedContent,
                    artifactEnvelope: persistedEnvelope,
                    ...(skeletonFallbackError ? { lastDiagramError: skeletonFallbackError } : {}),
                };
                const addedArtifact = createArtifactVersion(project.id, existingArtifact.versionGroupId, newArtifactData);
                // Bridge against the project-sync useEffect race: createArtifactVersion returns
                // a fully-formed artifact synchronously, but the global `projects` state may
                // not have flushed yet (Firestore-backed updates are async). Setting
                // `activeArtifact` directly guarantees the canvas mounts immediately, and the
                // project-sync useEffect will overwrite it as soon as the new artifact is
                // visible in `project.artifacts`.
                setActiveArtifact(addedArtifact);
                setActiveArtifactId(addedArtifact.id);
            } else {
                const newArtifactData = {
                    name: template.name,
                    type: template.type,
                    phase: template.phase,
                    architecturalView: template.architecturalView,
                    content: persistedContent,
                    objective: template.objective,
                    keyConcepts: template.keyConcepts,
                    representation: template.representation,
                    isFavorite: false,
                    ...(ir ? { ir } : {}),
                    ...(persistedAudience ? { audience: persistedAudience } : {}),
                    generationTrace,
                    rawResponse: generatedContent,
                    artifactEnvelope: persistedEnvelope,
                    ...(skeletonFallbackError ? { lastDiagramError: skeletonFallbackError } : {}),
                };
                const addedArtifact = createArtifact(project.id, newArtifactData);
                // See note above on createArtifactVersion: prevent the canvas from
                // missing the just-created artifact during the React/Firestore round-trip.
                setActiveArtifact(addedArtifact);
                setActiveArtifactId(addedArtifact.id);
            }
        }
        onPhase?.({
            stage: 'persistence',
            status: 'success',
            message: 'Artefacto persistido y abriendo el canvas.',
            at: new Date().toISOString(),
            meta: { operationId: generationOperationId, durationMs: Date.now() - startedMs },
        });
        observedOperation.succeed(
            skeletonFallbackError
                ? `"${template.name}" se generó con fallback determinístico renderizable.`
                : `"${template.name}" se generó y abrió correctamente.`,
            {
                durationMs: Date.now() - startedMs,
                artifactName: template.name,
                artifactType: template.type,
                operationId: generationOperationId,
                traceStatus: generationTrace.status,
            },
        );
        return true;
    } catch (error) {
        // Map raw Gemini errors to a friendly message + retry affordance.
        // First-attempt 503 / network errors are common during peak hours;
        // surfacing a one-tap retry instead of a stack trace keeps the
        // architect productive without having to redo their click chain.
        const failure = describeGenerationFailure(error);
        console.error('[Workspace] generation failed', {
            artifactName: template.name,
            category: failure.category,
            status: failure.status,
            message: failure.message,
        });
        observedOperation.fail(failure.message, {
            title: failure.headline,
            message: failure.userMessage,
            detail: failure.technicalDetail,
            severity: failure.severity,
            recoverable: failure.retryable,
            metadata: {
                artifactName: template.name,
                artifactType: template.type,
                operationId: generationOperationId,
                category: failure.category,
                status: failure.status,
            },
        });
        if (isMounted.current) {
            const retry = () => proceedWithGeneration(template, action, existingArtifact);
            setGenerationFailure({
                artifactName: template.name,
                headline: failure.headline,
                userMessage: failure.userMessage,
                technicalMessage: failure.technicalDetail,
                onRetry: retry,
            });
            addToast(
                `${failure.headline} al generar "${template.name}". ${failure.userMessage}`,
                failure.severity,
                failure.retryable
                    ? {
                        action: {
                            label: 'Reintentar',
                            onClick: retry,
                        },
                        durationMs: 8000,
                    }
                    : undefined,
            );
        }
        return false;
    } finally {
        if (isMounted.current) {
            setIsGenerating(false);
            setGenerationElapsedSec(0);
            setGeneratingMessage('');
        }
    }
  }, [project, settings, t, createArtifact, createArtifactVersion, updateArtifact, addToast, composePersonaInstruction]);

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
    if (!project || isGenerating) return;

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
  }, [project, isGenerating, proceedWithGeneration, addToast]);

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

        {/* Loading Overlay — branded as "AI Architect en acción". */}
        {(isGenerating || pendingOpenArtifactId) && (
            <div className="fixed inset-0 bg-black/55 backdrop-blur-md flex flex-col items-center justify-center z-[200] animate-fade-in" role="dialog" aria-modal="true" aria-label="Procesando">
                <div className="bg-white dark:bg-gray-900 px-8 py-7 rounded-2xl shadow-pop flex flex-col items-center max-w-sm w-full mx-6 border border-gray-100 dark:border-gray-800 animate-slide-up">
                    <div className="relative mb-5 ai-orbit rounded-full p-1">
                        <div className="relative h-14 w-14 rounded-full bg-ai-gradient flex items-center justify-center shadow-glow-ai">
                            <SparklesIcon className="h-7 w-7 text-white" />
                        </div>
                    </div>
                    <p className="text-2xs uppercase tracking-widest-2 text-ai-600 dark:text-ai-300 font-semibold mb-1">
                        {pendingOpenArtifactId ? 'Lienzo' : 'AI Architect'}
                    </p>
                    <p className="text-lg font-bold text-gray-900 dark:text-white mb-1.5 text-center">
                      {pendingOpenArtifactId ? 'Abriendo lienzo' : 'Generando artefacto'}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-4 leading-relaxed">
                      {pendingOpenArtifactId ? 'Preparando la vista del artefacto recién generado…' : generatingMessage}
                    </p>
                    {/* Indeterminate progress strip */}
                    <div className="w-full h-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <div className="h-full w-full progress-indeterminate" />
                    </div>
                    {!pendingOpenArtifactId && (
                        <div className="mt-4 w-full rounded-xl border border-gray-200 bg-gray-50 p-3 text-left dark:border-gray-800 dark:bg-gray-950/60">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">Estado resiliente</span>
                                <span className="font-mono text-2xs text-gray-500">{generationElapsedSec}s</span>
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                                Puedes liberar la pantalla sin perder trazabilidad. Si el proveedor IA se demora o falla, el sistema mostrará diagnóstico y opción de reintento.
                            </p>
                            {generationElapsedSec >= 20 && (
                                <button
                                    type="button"
                                    onClick={handleDismissGenerationOverlay}
                                    className="mt-3 inline-flex w-full items-center justify-center rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-white dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900"
                                >
                                    Recuperar acceso al workspace
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* Workspace shell: main canvas/hub on the left, persistent copilot on the right */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden">
                {activeArtifact ? (
                    /* SCREEN 3: ARTIFACT CANVAS (Active) */
                    <div className="flex flex-col h-full bg-white dark:bg-gray-950 animate-fade-in min-h-0">
                        <div className="flex-1 relative overflow-hidden min-h-0">
                            <ErrorBoundary key={activeArtifact.id} fallbackTitle="Error al renderizar el artefacto">
                                <ArtifactCanvas
                                    project={project}
                                    artifact={activeArtifact}
                                    onGenerateWorldClass={handleGenerateWorldClassArtifact}
                                    setActiveArtifactId={setActiveArtifactId}
                                    onBack={() => setActiveArtifactId(null)}
                                />
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
        {generationFailure && (
            <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 backdrop-blur-md p-4" role="alertdialog" aria-modal="true" aria-labelledby="generation-failure-title">
                <div className="w-full max-w-lg rounded-2xl border border-rose-200 bg-white p-6 shadow-2xl dark:border-rose-900/60 dark:bg-gray-900">
                    <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300">
                        <SparklesIcon className="h-6 w-6" />
                    </div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-600 dark:text-rose-300">Generación interrumpida</p>
                    <h2 id="generation-failure-title" className="mt-1 text-xl font-bold text-gray-900 dark:text-white">
                        {generationFailure.headline}: {generationFailure.artifactName}
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                        {generationFailure.userMessage}
                    </p>
                    <details className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950/60">
                        <summary className="cursor-pointer text-xs font-semibold text-gray-600 dark:text-gray-300">Detalle técnico observable</summary>
                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] text-gray-700 dark:text-gray-300">{generationFailure.technicalMessage}</pre>
                    </details>
                    <div className="mt-5 flex flex-wrap justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => setGenerationFailure(null)}
                            className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                        >
                            Cerrar
                        </button>
                        <button
                            type="button"
                            onClick={generationFailure.onRetry}
                            className="inline-flex h-10 items-center justify-center rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700"
                        >
                            Reintentar generación
                        </button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
};

export default Workspace;
