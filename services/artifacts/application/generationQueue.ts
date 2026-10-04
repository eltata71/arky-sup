/** In-memory scheduling decisions for artifact generation. No project state lives here. */
import type { Artifact } from '../../../lib/artifacts';
import type { ArtifactTemplate } from '../../../types';
import type { ArtifactGenerationRunResult } from './artifactGenerationRun';
import type { ArtifactGenerationAction } from '../domain/artifactGenerationTrace';
export type GenerationStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface GenerationJob {
  id: string;
  projectId: string;
  artifactName: string;
  priority: number;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  status: GenerationStatus;
  phase?: string;
  partial?: string;
  artifactId?: string;
  failure?: { headline: string; message: string; detail: string; retryable: boolean };
}

export const DEFAULT_GENERATION_CONCURRENCY = 3;

export function runnableJobs(jobs: readonly GenerationJob[], limit = DEFAULT_GENERATION_CONCURRENCY): GenerationJob[] {
  const available = Math.max(0, limit - jobs.filter(job => job.status === 'running').length);
  return jobs.filter(job => job.status === 'queued')
    .sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt)
    .slice(0, available);
}

export function changeGenerationJob(jobs: readonly GenerationJob[], id: string, change: Partial<GenerationJob>): GenerationJob[] {
  return jobs.map(job => job.id === id ? { ...job, ...change } : job);
}

export function cancelGenerationJob(jobs: readonly GenerationJob[], id: string, at: number): GenerationJob[] {
  return jobs.map(job => job.id === id && (job.status === 'queued' || job.status === 'running')
    ? { ...job, status: 'cancelled', finishedAt: at } : job);
}

export function retryGenerationJob(jobs: readonly GenerationJob[], id: string, at: number): GenerationJob[] {
  return jobs.map(job => job.id === id && job.status === 'failed'
    ? { ...job, status: 'queued', enqueuedAt: at, startedAt: undefined, finishedAt: undefined, failure: undefined, phase: undefined, partial: undefined } : job);
}

export function countInterrupted(jobs: readonly GenerationJob[]): number {
  return jobs.filter(job => job.status === 'queued' || job.status === 'running').length;
}

/** Decide the one artifact command to issue after generation, without touching a repository. */
export function planGenerationWrite(template: ArtifactTemplate, result: ArtifactGenerationRunResult, action: ArtifactGenerationAction, existing?: Artifact) {
  const content = {
    content: result.persistedContent,
    ...(result.ir ? { ir: result.ir } : {}),
    ...(result.persistedAudience ? { audience: result.persistedAudience } : {}),
    generationTrace: result.generationTrace,
    rawResponse: result.generatedContent,
    artifactEnvelope: result.persistedEnvelope,
    ...(result.skeletonFallbackError ? { lastDiagramError: result.skeletonFallbackError } : { lastDiagramError: undefined }),
  };
  if (action === 'replace' && existing) return { kind: 'replace' as const, artifactId: existing.id, updates: content };
  const draft = {
    name: template.name, type: template.type, phase: template.phase,
    architecturalView: template.architecturalView, objective: template.objective,
    keyConcepts: template.keyConcepts, representation: template.representation,
    isFavorite: false, ...content,
  };
  if (action === 'new_version' && existing) return { kind: 'new_version' as const, versionGroupId: existing.versionGroupId, draft };
  return { kind: 'create' as const, draft };
}
