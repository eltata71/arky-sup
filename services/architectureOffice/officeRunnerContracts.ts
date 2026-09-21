import type { OfficeEngagement, OfficeTask, OfficeTaskReview } from './OfficeTypes';
import type { PersistenceResult, PersistenceStatus } from '../persistence';

export interface OfficeProduceOutcome {
  status: 'success' | 'failed';
  artifactId?: string;
  versionGroupId?: string;
  aiCalls?: number;
  traceId?: string;
  message?: string;
}

export interface OfficeConsolidateOutcome {
  status: 'success' | 'failed';
  summary: string;
  aiCalls?: number;
  traceId?: string;
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
