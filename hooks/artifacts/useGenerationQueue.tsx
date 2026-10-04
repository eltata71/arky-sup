import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Artifact, ArtifactContextPorts, ArtifactGenerationPhaseListener, ArtifactPersonaComposer } from '../../lib/artifacts';
import type { ArtifactTemplate, Settings } from '../../types';
import type { Project } from '../../services/architectureProjects';
import type { ArtifactGenerationAction } from '../../services/artifacts/application/artifactGenerationRun';
import { cancelGenerationJob, changeGenerationJob, countInterrupted, planGenerationWrite, retryGenerationJob, runnableJobs, type GenerationJob } from '../../services/artifacts/application/generationQueue';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

interface GenerationRequest {
  project: Project;
  template: ArtifactTemplate;
  settings: Settings;
  action: ArtifactGenerationAction;
  existingArtifact?: Artifact;
  composePersonaInstruction: ArtifactPersonaComposer;
  loadContextPorts: () => Promise<ArtifactContextPorts>;
  onPhase?: ArtifactGenerationPhaseListener;
  priority?: number;
}

interface GenerationQueueContextValue {
  jobs: GenerationJob[];
  enqueue: (request: GenerationRequest) => string;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  open: (job: GenerationJob) => void;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
}

const GenerationQueueContext = createContext<GenerationQueueContextValue | null>(null);
const INTERRUPTED_KEY = 'arky-interrupted-generations';

export function GenerationQueueProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const { createArtifact, createArtifactVersion, updateArtifact } = useAppContext();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const jobsRef = useRef<GenerationJob[]>([]);
  const requests = useRef(new Map<string, GenerationRequest>());
  const [panelOpen, setPanelOpen] = useState(false);
  const update = useCallback((change: (current: GenerationJob[]) => GenerationJob[]) => {
    const next = change(jobsRef.current);
    jobsRef.current = next;
    setJobs(next);
  }, []);

  useEffect(() => {
    if (authLoading || user) return;
    requests.current.clear();
    update(current => current.map(job => job.status === 'queued' || job.status === 'running'
      ? { ...job, status: 'cancelled', finishedAt: Date.now() } : job));
  }, [authLoading, user, update]);

  useEffect(() => {
    const interrupted = Number(localStorage.getItem(INTERRUPTED_KEY) ?? 0);
    localStorage.removeItem(INTERRUPTED_KEY);
    if (interrupted > 0) addToast(`${interrupted} ${interrupted === 1 ? 'generación interrumpida' : 'generaciones interrumpidas'} al cerrar la pestaña. Solicítalas de nuevo.`, 'warning', { durationMs: 8000 });
    const beforeUnload = () => {
      const count = countInterrupted(jobsRef.current);
      if (count) localStorage.setItem(INTERRUPTED_KEY, String(count));
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [addToast]);

  const enqueue = useCallback((request: GenerationRequest) => {
    const id = `gen-${request.project.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    requests.current.set(id, request);
    update(current => [...current, {
      id, projectId: request.project.id, artifactName: request.template.name,
      priority: request.priority ?? 0, enqueuedAt: Date.now(), status: 'queued',
    }]);
    setPanelOpen(true);
    return id;
  }, [update]);

  const cancel = useCallback((id: string) => {
    update(current => cancelGenerationJob(current, id, Date.now()));
    requests.current.delete(id);
  }, [update]);

  const retry = useCallback((id: string) => {
    if (!requests.current.has(id)) return;
    update(current => retryGenerationJob(current, id, Date.now()));
  }, [update]);

  const open = useCallback((job: GenerationJob) => {
    if (job.artifactId) navigate(`/workspace/${job.projectId}?artifact=${encodeURIComponent(job.artifactId)}`);
    setPanelOpen(false);
  }, [navigate]);

  useEffect(() => {
    const ready = runnableJobs(jobs);
    if (!ready.length) return;
    update(current => ready.reduce((next, job) => changeGenerationJob(next, job.id, { status: 'running', startedAt: Date.now(), phase: 'prompt' }), current));
    for (const job of ready) {
      const request = requests.current.get(job.id);
      if (!request) continue;
      void (async () => {
        try {
          // The runner and model are fetched only when the first job starts.
          const [{ runArtifactGeneration }, { getAiBlockingCooldownRemainingMs }] = await Promise.all([
            import('../../services/artifacts/application/artifactGenerationRun'),
            import('../../services/ai/callControl/aiCallControlService'),
          ]);
          while (jobsRef.current.find(item => item.id === job.id)?.status === 'running') {
            const remaining = getAiBlockingCooldownRemainingMs('artifact-generation');
            if (!remaining) break;
            update(current => changeGenerationJob(current, job.id, { phase: `Esperando cuota · ${Math.ceil(remaining / 1000)} s` }));
            await new Promise(resolve => window.setTimeout(resolve, Math.min(remaining, 1000)));
          }
          if (jobsRef.current.find(item => item.id === job.id)?.status !== 'running') return;
          const startedMs = Date.now();
          let lastPartialAt = 0;
          const result = await runArtifactGeneration({
            project: request.project, template: request.template, settings: request.settings,
            existingArtifact: request.existingArtifact, action: request.action,
            operationId: job.id, startedAt: new Date(startedMs).toISOString(), startedMs,
            composePersonaInstruction: request.composePersonaInstruction,
            ...(await request.loadContextPorts()),
            onPhase: event => {
              if (jobsRef.current.find(item => item.id === job.id)?.status === 'running') {
                update(current => changeGenerationJob(current, job.id, { phase: event.stage }));
                request.onPhase?.(event);
              }
            },
            onPartial: text => {
              const now = Date.now();
              if (now - lastPartialAt < 150) return;
              lastPartialAt = now;
              if (jobsRef.current.find(item => item.id === job.id)?.status === 'running') {
                update(current => changeGenerationJob(current, job.id, { partial: text }));
              }
            },
            onWarning: message => addToast(message, 'warning', { durationMs: 8000 }),
          });
          // Cancellation is checked immediately before the first write.
          if (jobsRef.current.find(item => item.id === job.id)?.status !== 'running') return;
          const plan = planGenerationWrite(request.template, result, request.action, request.existingArtifact);
          let artifactId: string;
          if (plan.kind === 'replace') {
            updateArtifact(request.project.id, plan.artifactId, plan.updates);
            artifactId = plan.artifactId;
          } else if (plan.kind === 'new_version') {
            artifactId = createArtifactVersion(request.project.id, plan.versionGroupId, plan.draft).id;
          } else {
            artifactId = createArtifact(request.project.id, plan.draft).id;
          }
          update(current => changeGenerationJob(current, job.id, { status: 'done', phase: 'persistence', artifactId, finishedAt: Date.now() }));
          addToast(`«${request.template.name}» está listo.`, 'success', {
            action: { label: 'Abrir', onClick: () => navigate(`/workspace/${request.project.id}?artifact=${encodeURIComponent(artifactId)}`) },
            durationMs: 10000,
          });
        } catch (error) {
          const { describeGenerationFailure } = await import('../../services/artifacts/application/generationFailure');
          if (jobsRef.current.find(item => item.id === job.id)?.status !== 'running') return;
          const failure = describeGenerationFailure(error);
          update(current => changeGenerationJob(current, job.id, {
            status: 'failed', finishedAt: Date.now(),
            failure: { headline: failure.headline, message: failure.userMessage, detail: failure.technicalDetail, retryable: failure.retryable },
          }));
          addToast(`${failure.headline} al generar «${request.template.name}». ${failure.userMessage}`, failure.severity, {
            ...(failure.retryable ? { action: { label: 'Reintentar', onClick: () => retry(job.id) } } : {}),
            durationMs: 10000,
          });
        }
      })();
    }
  }, [jobs, update, addToast, createArtifact, createArtifactVersion, updateArtifact, navigate, retry]);

  return <GenerationQueueContext.Provider value={{ jobs, enqueue, cancel, retry, open, panelOpen, setPanelOpen }}>{children}</GenerationQueueContext.Provider>;
}

export function useGenerationQueue(): GenerationQueueContextValue {
  const context = useContext(GenerationQueueContext);
  if (!context) throw new Error('useGenerationQueue requires GenerationQueueProvider');
  return context;
}
