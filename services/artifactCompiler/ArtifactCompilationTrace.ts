/**
 * Compilation trace recorder.
 *
 * Accumulates a step-by-step record of a compilation pass so the UI, the
 * generation trace and observability tooling can replay exactly what the
 * compiler decided, repaired and scored.
 */

import type {
  ArtifactCompilationTrace,
  CompilationStage,
  CompilationStatus,
  CompilationStep,
  CompilationTier,
  CompilerRepair,
} from './ArtifactCompilerTypes';

const nowIso = (): string => new Date().toISOString();
const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

let traceCounter = 0;

export class CompilationTraceRecorder {
  private readonly steps: CompilationStep[] = [];
  private readonly warnings: string[] = [];
  private readonly errors: string[] = [];
  private readonly startedAtIso = nowIso();
  private readonly startedAtMs = nowMs();
  private lastStepMs = this.startedAtMs;

  /** Record a compilation step and return it (for chaining/logging). */
  step(
    stage: CompilationStage,
    status: CompilationStep['status'],
    message: string,
    detail?: string,
  ): CompilationStep {
    const at = nowIso();
    const current = nowMs();
    const step: CompilationStep = {
      stage,
      status,
      message,
      detail,
      at,
      durationMs: Math.max(0, Math.round(current - this.lastStepMs)),
    };
    this.lastStepMs = current;
    this.steps.push(step);
    if (status === 'warning') this.warnings.push(`${stage}: ${message}`);
    if (status === 'error') this.errors.push(`${stage}: ${message}`);
    return step;
  }

  /** Finalise the trace into an immutable record. */
  build(params: {
    artifactId: string;
    contractId: string;
    status: CompilationStatus;
    score: number;
    tier: CompilationTier;
    repairs: CompilerRepair[];
  }): ArtifactCompilationTrace {
    traceCounter += 1;
    const completedAtMs = nowMs();
    return {
      id: `compile_${params.artifactId.slice(0, 8)}_${traceCounter.toString(36)}`,
      artifactId: params.artifactId,
      contractId: params.contractId,
      startedAt: this.startedAtIso,
      completedAt: nowIso(),
      durationMs: Math.max(0, Math.round(completedAtMs - this.startedAtMs)),
      status: params.status,
      score: params.score,
      tier: params.tier,
      steps: [...this.steps],
      repairs: [...params.repairs],
      warnings: [...this.warnings],
      errors: [...this.errors],
    };
  }
}
