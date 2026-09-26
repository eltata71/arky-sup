import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../types';
import type { Project } from '../../services/architectureProjects';
import { extractArtifactBriefWithAI, type BriefAiProposer } from '../../services/artifacts/application/artifactBriefExtractionService';

const project: Project = {
  id: 'p1',
  name: 'Core bancario',
  description: 'Core con APIs y eventos.',
  projectContext: ['El API Gateway es el punto de entrada.'],
  artifacts: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const settings = { language: 'es' } as unknown as Settings;
const REQUEST = 'Necesito un documento que resuma el avance de la modernización del core.';

describe('extractArtifactBriefWithAI', () => {
  it('#9 con extracción IA deshabilitada no invoca el proposer', async () => {
    const proposer = vi.fn<BriefAiProposer>();
    const result = await extractArtifactBriefWithAI({
      project,
      request: REQUEST,
      settings,
      aiEnabled: false,
      proposer,
    });
    expect(proposer).not.toHaveBeenCalled();
    expect(result.source).toBe('deterministic');
    expect(result.contract.originalRequest).toBe(REQUEST);
  });

  it('#10 con extracción IA habilitada fusiona los campos válidos propuestos', async () => {
    const proposer: BriefAiProposer = async () => ({
      proposal: { audience: 'executive', acceptanceCriteria: ['Criterio nuevo aportado por IA.'] },
      rawResponse: '{"audience":"executive"}',
    });
    const result = await extractArtifactBriefWithAI({
      project,
      request: REQUEST,
      settings,
      aiEnabled: true,
      proposer,
    });
    expect(result.source).toBe('ai-assisted');
    expect(result.contract.audience).toBe('executive');
    expect(result.contract.acceptanceCriteria).toContain('Criterio nuevo aportado por IA.');
    expect(result.acceptedAiFields).toContain('audience');
  });

  it('#11 cuando la extracción IA falla degrada al contrato determinístico con advertencia', async () => {
    const proposer: BriefAiProposer = async () => { throw new Error('Gemini no disponible'); };
    const result = await extractArtifactBriefWithAI({
      project,
      request: REQUEST,
      settings,
      aiEnabled: true,
      proposer,
    });
    expect(result.source).toBe('deterministic');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.contract.originalRequest).toBe(REQUEST);
  });

  it('una propuesta vacía no rompe el flujo y se reporta como determinística', async () => {
    const proposer: BriefAiProposer = async () => ({ proposal: {} });
    const result = await extractArtifactBriefWithAI({
      project,
      request: REQUEST,
      settings,
      aiEnabled: true,
      proposer,
    });
    expect(result.source).toBe('deterministic');
    expect(result.acceptedAiFields).toEqual([]);
  });


  it('una propuesta IA inválida degrada al contrato determinístico y conserva raw response', async () => {
    const proposer: BriefAiProposer = async () => ({
      proposal: {
        acceptanceCriteria: [],
        qualityTarget: 20,
        normalizedIntent: 'Una reinterpretación desconectada.',
      },
      rawResponse: '{"qualityTarget":20}',
    });
    const result = await extractArtifactBriefWithAI({
      project,
      request: REQUEST,
      settings,
      aiEnabled: true,
      proposer,
    });
    expect(result.source).toBe('deterministic');
    expect(result.contract.originalRequest).toBe(REQUEST);
    expect(result.rejectedAiFields).toEqual(expect.arrayContaining(['qualityTarget', 'normalizedIntent']));
    expect(result.rawAiResponse).toBe('{"qualityTarget":20}');
  });

  it('un timeout de extracción IA degrada sin romper el flujo', async () => {
    vi.useFakeTimers();
    const proposer: BriefAiProposer = () => new Promise(resolve => {
      setTimeout(() => resolve({ proposal: { audience: 'executive' } }), 50);
    });
    const pending = extractArtifactBriefWithAI({
      project,
      request: REQUEST,
      settings,
      aiEnabled: true,
      proposer,
      timeoutMs: 5,
    });
    await vi.advanceTimersByTimeAsync(6);
    const result = await pending;
    vi.useRealTimers();

    expect(result.source).toBe('deterministic');
    expect(result.warnings.join(' ')).toContain('excedió 5ms');
    expect(result.contract.originalRequest).toBe(REQUEST);
  });

  it('emite eventos de trazabilidad del brief', async () => {
    const events: string[] = [];
    const proposer: BriefAiProposer = async () => ({ proposal: { audience: 'executive' } });
    await extractArtifactBriefWithAI({
      project,
      request: REQUEST,
      settings,
      aiEnabled: true,
      proposer,
      onPhase: event => events.push(event.message),
    });
    expect(events).toContain('brief.extracted.ai-started');
    expect(events).toContain('brief.extracted.ai-success');
    expect(events).toContain('brief.contract.merged');
  });
});
