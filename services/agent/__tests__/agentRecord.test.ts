import { describe, it, expect } from 'vitest';
import { buildAgentActionRecord } from '../agentRecord';
import type { AgentActionPlan, AgentActionResult, AgentIntent } from '../agentTypes';

const intent: AgentIntent = {
  type: 'artifact.improve',
  confidence: 0.85,
  userInstruction: 'mejora con base en lo conversado',
  artifactId: 'art-1',
  artifactVersionGroupId: 'grp-1',
  artifactViewContext: 'diagram',
  extractedRequirements: [],
  requiresConfirmation: true,
  impact: 'medium',
  suggestedTarget: 'new_version',
};

const plan: AgentActionPlan = {
  actionId: 'act-1',
  intent,
  artifactId: 'art-1',
  currentVersionId: 'art-1',
  actionType: 'artifact.improve',
  title: 'Mejorar con IA',
  summary: 'desc',
  rationale: 'why',
  affectedAreas: [],
  risks: [],
  target: 'new_version',
  requiresConfirmation: true,
  status: 'pending',
  createdAt: '2026-05-19T00:00:00.000Z',
  traceId: 'agent-test',
};

describe('buildAgentActionRecord', () => {
  it('captures plan and result into a durable record', () => {
    const result: AgentActionResult = {
      status: 'success',
      newArtifactVersionId: 'art-2',
      previousArtifactVersionId: 'art-1',
      appliedChanges: ['Mejora aplicada.'],
      validationResult: { passed: true, summary: 'OK', score: 85 },
      messages: ['Listo.'],
      errors: [],
      traceId: 'agent-test',
    };
    const record = buildAgentActionRecord({
      plan,
      result,
      projectId: 'proj-1',
      actorId: 'user-42',
      actorName: 'Ana',
    });
    expect(record).toMatchObject({
      traceId: 'agent-test',
      projectId: 'proj-1',
      artifactVersionGroupId: 'grp-1',
      newArtifactVersionId: 'art-2',
      previousArtifactVersionId: 'art-1',
      actionType: 'artifact.improve',
      status: 'success',
      target: 'new_version',
      actorId: 'user-42',
      actorName: 'Ana',
      validationSummary: 'OK',
      validationScore: 85,
    });
    expect(record.completedAt).toMatch(/T.*Z$/);
  });

  it('falls back to local-user defaults when actor info is missing', () => {
    const result: AgentActionResult = {
      status: 'failed',
      newArtifactVersionId: null,
      previousArtifactVersionId: 'art-1',
      appliedChanges: [],
      validationResult: null,
      messages: ['Error.'],
      errors: ['boom'],
      traceId: 'agent-test',
    };
    const record = buildAgentActionRecord({ plan, result, projectId: 'proj-1' });
    expect(record.actorId).toBe('local-user');
    expect(record.actorName).toBe('Arquitecto');
    expect(record.status).toBe('failed');
    expect(record.newArtifactVersionId).toBeNull();
    expect(record.validationSummary).toBeNull();
  });
});
