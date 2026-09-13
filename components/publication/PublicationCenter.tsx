import React, { useCallback, useMemo, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { XMarkIcon } from '../Icons';
import { Badge, Button, Tabs, TabList, Tab, TabPanel } from '../ui';
import {
  SYSTEM_PUBLICATION_ACTOR,
  listPublicationProfiles,
  resolvePackageProfile,
  createPackageForProject,
  evaluateProjectPackage,
  runProjectPackagePreflight,
  generateProjectPackageManifest,
  publishProjectPackage,
  versionProjectPackage,
  upsertPublicationPackage,
  submitForReview,
  requestChanges,
  approvePackage,
  archivePackage,
  updatePackageArtifacts,
  runPublicationExportBatch,
  type CreatePublicationPackageInput,
  type PublicationActor,
  type PublicationExportBatchResult,
  type PublicationExportJob,
  type PublicationManifest,
  type PublicationPreflightReport,
  type PublicationProjectInput,
  type PublicationTransitionResult,
} from '../../services/publicationPipeline';
import { PublicationPackagePanel } from './PublicationPackagePanel';
import { PublicationReadinessPanel } from './PublicationReadinessPanel';
import { PublicationAccessibilityPanel } from './PublicationAccessibilityPanel';
import { PublicationApprovalPanel } from './PublicationApprovalPanel';
import { PublicationManifestView } from './PublicationManifestView';
import { PublicationExportPanel } from './PublicationExportPanel';
import { PublicationPreflightModal } from './PublicationPreflightModal';
import {
  compileArtifactPresentation,
  isPresentationExportEnabled,
} from '../../services/artifacts';

interface PublicationCenterProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
}

/**
 * Publication Center — the first-class entry point for the professional
 * publication pipeline. Lets architects create packages, evaluate readiness,
 * run preflight, validate accessibility, drive the approval workflow, inspect
 * the manifest and orchestrate exports — without leaving the project.
 *
 * The overlay is keyboard-accessible (focus trap, Escape to close, visible
 * focus rings), dark-mode aware and degrades gracefully on every error.
 */
export const PublicationCenter: React.FC<PublicationCenterProps> = ({ isOpen, onClose, projectId }) => {
  const { getProject, savePublicationPackages, getArchitectureGraphFreshness } = useAppContext();
  const { user, profile } = useAuth();
  const containerRef = useFocusTrap<HTMLDivElement>(isOpen);

  const project = getProject(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recalcKey, setRecalcKey] = useState(0);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);
  const [manifest, setManifest] = useState<PublicationManifest | null>(null);
  const [preflight, setPreflight] = useState<PublicationPreflightReport | null>(null);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [lastBatch, setLastBatch] = useState<PublicationExportBatchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('readiness');

  const actor = useMemo<PublicationActor>(() => (
    user
      ? { id: user.uid, name: profile?.displayName ?? user.displayName ?? 'Usuario', role: profile?.role }
      : SYSTEM_PUBLICATION_ACTOR
  ), [user, profile]);

  const projectInput = useMemo<PublicationProjectInput | null>(() => (
    project
      ? {
          projectId: project.id,
          projectName: project.name,
          artifacts: project.artifacts,
          architectureKnowledgeGraph: project.architectureKnowledgeGraph,
          architectureKnowledgeGraphFreshness: getArchitectureGraphFreshness(project.id),
        }
      : null
  ), [project, getArchitectureGraphFreshness]);

  const packages = useMemo(() => project?.publicationPackages ?? [], [project]);
  const selectedPackage = useMemo(
    () => packages.find((p) => p.id === selectedId) ?? packages[0] ?? null,
    [packages, selectedId],
  );

  const evaluation = useMemo(() => {
    if (!projectInput || !selectedPackage) return null;
    // recalcKey is an intentional invalidation dependency.
    void recalcKey;
    try {
      return evaluateProjectPackage(projectInput, selectedPackage);
    } catch {
      return null;
    }
  }, [projectInput, selectedPackage, recalcKey]);

  const profiles = useMemo(() => listPublicationProfiles(), []);
  const presentationReadiness = useMemo(() => {
    if (!project) return [];
    return project.artifacts.map((artifact) => {
      const compiled = compileArtifactPresentation(artifact);
      return {
        artifactId: artifact.id,
        name: artifact.name,
        ready: Boolean(compiled.model?.quality.readyForPublication),
        score: compiled.model?.quality.score ?? null,
        warnings: compiled.model ? compiled.model.quality.blockers.length + compiled.model.quality.warnings.length : compiled.warnings.length,
        blockers: compiled.model?.quality.blockers.length ?? 0,
        recommendedFormats: compiled.model?.exportProfile.recommendedFormats ?? [],
        isFallback: Boolean(compiled.model?.quality.blockers.some((blocker) => /skeleton|fallback|respaldo/i.test(blocker))),
        requiresReview: Boolean(compiled.model?.exportProfile.requiresUserReview),
      };
    });
  }, [project]);

  const persist = useCallback((updated: typeof packages) => {
    savePublicationPackages(projectId, updated);
  }, [savePublicationPackages, projectId]);

  const applyTransition = useCallback((result: PublicationTransitionResult) => {
    if (!result.ok) {
      setFeedback({ tone: 'error', message: result.reason ?? 'No se pudo aplicar la transición.' });
      return;
    }
    persist(upsertPublicationPackage(packages, result.package));
    setFeedback({ tone: 'ok', message: 'Operación aplicada correctamente.' });
  }, [packages, persist]);

  const handleCreate = useCallback((input: Omit<CreatePublicationPackageInput, 'projectId'>) => {
    if (!projectInput) return;
    const pkg = createPackageForProject(projectInput, { ...input, actor });
    persist(upsertPublicationPackage(packages, pkg));
    setSelectedId(pkg.id);
    setFeedback({ tone: 'ok', message: `Paquete "${pkg.name}" creado.` });
  }, [projectInput, actor, packages, persist]);

  const handleRecalc = useCallback(() => {
    if (!projectInput || !selectedPackage) return;
    setPreflight(runProjectPackagePreflight(projectInput, selectedPackage));
    setRecalcKey((k) => k + 1);
    setFeedback({ tone: 'ok', message: 'Preflight y readiness recalculados.' });
  }, [projectInput, selectedPackage]);

  const handleGenerateManifest = useCallback(() => {
    if (!projectInput || !selectedPackage) return;
    const { manifest: generated } = generateProjectPackageManifest(projectInput, selectedPackage, { generatedBy: actor });
    setManifest(generated);
    setFeedback({ tone: 'ok', message: 'Manifiesto generado.' });
  }, [projectInput, selectedPackage, actor]);

  const handlePublish = useCallback((override: boolean, overrideReason: string) => {
    if (!projectInput || !selectedPackage) return;
    const { result, manifest: generated } = publishProjectPackage(projectInput, selectedPackage, {
      actor, override, overrideReason,
    });
    setManifest(generated);
    applyTransition(result);
  }, [projectInput, selectedPackage, actor, applyTransition]);

  const handleExport = useCallback(async (jobs: PublicationExportJob[]) => {
    if (!projectInput || !selectedPackage || !evaluation) return;
    setBusy(true);
    try {
      const { manifest: generated, readiness } = generateProjectPackageManifest(projectInput, selectedPackage, { generatedBy: actor });
      setManifest(generated);
      const artifacts = projectInput.artifacts.filter((a) =>
        selectedPackage.artifactRefs.some((r) => r.versionGroupId === a.versionGroupId));
      const batch = await runPublicationExportBatch({
        pkg: selectedPackage,
        profile: evaluation.profile,
        readiness,
        report: evaluation.report,
        manifest: generated,
        artifacts,
        jobs,
        triggerDownload: true,
      });
      setLastBatch(batch);
      setFeedback({
        tone: batch.allSucceeded ? 'ok' : 'error',
        message: batch.allSucceeded ? 'Exportación completada.' : 'La exportación terminó con fallos.',
      });
    } finally {
      setBusy(false);
    }
  }, [projectInput, selectedPackage, evaluation, actor]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Centro de Publicación Profesional"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div
        ref={containerRef}
        className="flex h-full max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-[#0c0c11]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-white/10">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary-600 dark:text-primary-300">
              Pipeline de Publicación Profesional
            </p>
            <h1 className="text-lg font-black text-slate-900 dark:text-white">
              Centro de Publicación — {project?.name ?? 'Proyecto'}
            </h1>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar el Centro de Publicación"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-400 dark:hover:bg-white/10"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </header>

        {!project || !projectInput ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            No se encontró el proyecto. Cierra y vuelve a abrir el Centro de Publicación.
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="min-h-0 border-b border-slate-200 md:border-b-0 md:border-r dark:border-white/10">
              <PublicationPackagePanel
                packages={packages}
                profiles={profiles}
                artifacts={project.artifacts}
                selectedId={selectedPackage?.id ?? null}
                onSelect={setSelectedId}
                onCreate={handleCreate}
              />
            </aside>

            <main className="min-h-0 overflow-y-auto p-4">
              {feedback && (
                <div
                  role="status"
                  className={
                    feedback.tone === 'ok'
                      ? 'mb-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-200'
                      : 'mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200'
                  }
                >
                  {feedback.message}
                </div>
              )}

              {!selectedPackage || !evaluation ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Selecciona o crea un paquete de publicación
                  </p>
                  <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
                    Un paquete agrupa artefactos en un entregable profesional, accesible, gobernado y auditable.
                  </p>
                </div>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">{selectedPackage.name}</h2>
                    <Badge tone="primary" size="sm" outline>{resolvePackageProfile(selectedPackage).name}</Badge>
                    <Button variant="ghost" size="sm"
                      onClick={() => { handleRecalc(); setPreflightOpen(true); }}
                      aria-label="Ver el detalle del preflight">
                      Ver preflight
                    </Button>
                  </div>

                  {presentationReadiness.length > 0 && (
                    <section className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5" aria-label="Estado de presentación por artefacto">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Compilador de presentación</p>
                          <p className="text-sm text-slate-700 dark:text-slate-200">
                            {presentationReadiness.filter((item) => item.ready).length}/{presentationReadiness.length} artefactos listos para publicación profesional.
                          </p>
                        </div>
                        <Badge tone={presentationReadiness.every((item) => item.ready) ? 'success' : 'warning'} size="sm" outline>
                          {presentationReadiness.every((item) => item.ready) ? 'Listos' : 'Requieren ajustes'}
                        </Badge>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                        {isPresentationExportEnabled()
                          ? 'La versión publicación profesional se exporta por artefacto desde el lienzo (Exportar → Versión publicación). La exportación batch de este paquete entrega el contenido original.'
                          : 'La exportación de la versión publicación está deshabilitada por feature flag; la exportación batch entrega el contenido original.'}
                      </p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {presentationReadiness.slice(0, 6).map((item) => (
                          <div key={item.artifactId} className="rounded-lg bg-white px-2 py-1.5 text-xs dark:bg-black/20">
                            <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{item.name}</span><span>{item.score ?? 'N/A'}/100</span></div>
                            <p className={item.ready ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}>{item.ready ? 'Listo' : `${item.warnings} ajuste(s) · ${item.blockers} bloqueador(es)`}</p><p className="truncate text-[10px] text-slate-500 dark:text-slate-400">{item.recommendedFormats.join(', ') || 'Sin formatos recomendados'}{item.isFallback ? ' · fallback' : ''}{item.requiresReview ? ' · requiere revisión' : ''}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <Tabs value={tab} onChange={setTab}>
                    <TabList aria-label="Secciones del paquete de publicación">
                      <Tab value="readiness">Readiness</Tab>
                      <Tab value="accesibilidad">Accesibilidad</Tab>
                      <Tab value="aprobacion">Aprobación</Tab>
                      <Tab value="manifiesto">Manifiesto</Tab>
                      <Tab value="exportar">Exportar</Tab>
                    </TabList>

                    <TabPanel value="readiness">
                      <PublicationReadinessPanel
                        readiness={evaluation.readiness}
                        profile={evaluation.profile}
                        onRecalc={handleRecalc}
                        busy={busy}
                      />
                    </TabPanel>
                    <TabPanel value="accesibilidad">
                      <PublicationAccessibilityPanel report={evaluation.readiness.accessibilityResults} />
                    </TabPanel>
                    <TabPanel value="aprobacion">
                      <PublicationApprovalPanel
                        pkg={selectedPackage}
                        profile={evaluation.profile}
                        readiness={evaluation.readiness}
                        busy={busy}
                        onSubmitForReview={(c) => applyTransition(submitForReview(selectedPackage, actor, c))}
                        onRequestChanges={(r) => applyTransition(requestChanges(selectedPackage, r, actor))}
                        onApprove={(c) => applyTransition(approvePackage(selectedPackage, evaluation.readiness, actor, c))}
                        onPublish={handlePublish}
                        onArchive={(r) => applyTransition(archivePackage(selectedPackage, actor, r))}
                        onCreateVersion={() => {
                          const versioned = versionProjectPackage(projectInput, selectedPackage, actor);
                          const aligned = updatePackageArtifacts(
                            versioned,
                            versioned.artifactRefs.map((r) => r.artifactId),
                            projectInput.artifacts,
                            actor,
                          );
                          persist(upsertPublicationPackage(packages, aligned));
                          setFeedback({ tone: 'ok', message: `Versión ${versioned.version} creada.` });
                        }}
                      />
                    </TabPanel>
                    <TabPanel value="manifiesto">
                      <PublicationManifestView
                        manifest={manifest ?? selectedPackage.manifest ?? null}
                        onGenerate={handleGenerateManifest}
                        busy={busy}
                      />
                    </TabPanel>
                    <TabPanel value="exportar">
                      <PublicationExportPanel
                        pkg={selectedPackage}
                        profile={evaluation.profile}
                        busy={busy}
                        lastBatch={lastBatch}
                        onExport={handleExport}
                      />
                    </TabPanel>
                  </Tabs>
                </>
              )}
            </main>
          </div>
        )}
      </div>

      <PublicationPreflightModal
        isOpen={preflightOpen}
        onClose={() => setPreflightOpen(false)}
        report={preflight}
      />
    </div>
  );
};
