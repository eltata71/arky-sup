import type { OfficeEngagement, OfficeTask, OfficeTaskReview } from '../domain/OfficeTypes';
import type { PersistenceResult, PersistenceStatus } from '../../persistence';
import type { AgentInvocationMeasurement } from '../../../lib/ai/agentUsage';

export interface OfficeProduceOutcome {
  status: 'success' | 'failed';
  artifactId?: string;
  versionGroupId?: string;
  aiCalls?: number;
  traceId?: string;
  /** Sello del prompt de producción (`lib/agents/promptCatalog`). */
  promptStamp?: string;
  message?: string;
}

export interface OfficeConsolidateOutcome {
  status: 'success' | 'failed';
  summary: string;
  measurement?: AgentInvocationMeasurement;
  aiCalls?: number;
  traceId?: string;
  /** Sello del prompt de consolidación (`lib/agents/promptCatalog`). */
  promptStamp?: string;
  /** Veredicto del evaluador sobre el texto final y si hubo corrección (18.2). */
  review?: { ok: boolean; gaps: string[]; refined: boolean };
  /** La única pasada de corrección, cuando la hubo. */
  refinement?: { traceId: string; promptStamp: string; measurement?: AgentInvocationMeasurement };
}

/** External dependencies for the pure Office task scheduler. */
export interface OfficeRunnerPorts {
  produceArtifact(task: OfficeTask, engagement: OfficeEngagement): Promise<OfficeProduceOutcome>;
  reviewArtifact(task: OfficeTask, engagement: OfficeEngagement): Promise<OfficeTaskReview>;
  consolidate(task: OfficeTask, engagement: OfficeEngagement): Promise<OfficeConsolidateOutcome>;
  persist(engagement: OfficeEngagement): Promise<PersistenceResult<OfficeEngagement>>;
  onProgress?(engagement: OfficeEngagement): void;
}

export interface OfficeRunOptions {
  maxConcurrency?: number;
  agentConcurrency?: ReadonlyMap<string, number>;
  runId?: string;
  isRunning?: boolean;
  signal?: AbortSignal;
}

export interface OfficeRunResult {
  engagement: OfficeEngagement;
  status: 'completed' | 'partial' | 'blocked' | 'cancelled' | 'budget-exhausted'
    | 'not-persisted' | 'refused';
  message: string;
  persistence?: PersistenceStatus;
}
