import { afterEach, describe, expect, it, vi } from 'vitest';
import { geminiService } from '../../services/geminiService';
import { buildDeterministicArtifactBrief } from '../../services/artifacts/artifactBriefService';
import type { Project, Settings } from '../../types';

const project: Project = {
  id: 'p1',
  name: 'Core bancario',
  description: 'Core bancario con APIs y eventos.',
  projectContext: ['API Gateway integra canales con el core.'],
  artifacts: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const settings: Settings = {
  theme: 'dark',
  language: 'es',
  globalContext: [],
  aiConfig: {
    model: 'gemini-2.5-flash',
    temperature: 0.7,
    tone: 'Profesional y Técnico',
    languageStyle: 'Conciso y directo',
    apiKeySource: 'user',
  },
};

const request = 'Necesito un documento ejecutivo que trace riesgos de integración y decisiones del core bancario.';
const deterministic = buildDeterministicArtifactBrief(project, request, { now: '2026-05-18T00:00:00.000Z' });

describe('geminiService.proposeArtifactBriefContract', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parsea JSON válido y usa generateContentWithFallback', async () => {
    const spy = vi.spyOn(geminiService, 'generateContentWithFallback').mockResolvedValue({
      text: JSON.stringify({ audience: 'executive', acceptanceCriteria: ['Cubrir riesgos priorizados.'] }),
    });

    const result = await geminiService.proposeArtifactBriefContract(project, request, deterministic, settings, { timeoutMs: 1234 });

    expect(result.proposal.audience).toBe('executive');
    expect(result.proposal.acceptanceCriteria).toEqual(['Cubrir riesgos priorizados.']);
    expect(result.rawResponse).toContain('executive');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[4]).toMatchObject({ timeoutMs: 1234, maxRetries: 1 });
  });

  it('tolera texto alrededor del JSON', async () => {
    vi.spyOn(geminiService, 'generateContentWithFallback').mockResolvedValue({
      text: 'Propuesta:\n```json\n{"artifactFamily":"matrix","purpose":"validation"}\n```\nFin.',
    });

    const result = await geminiService.proposeArtifactBriefContract(project, request, deterministic, settings);

    expect(result.proposal.artifactFamily).toBe('matrix');
    expect(result.proposal.purpose).toBe('validation');
  });

  it('maneja JSON inválido devolviendo propuesta vacía y rawResponse', async () => {
    vi.spyOn(geminiService, 'generateContentWithFallback').mockResolvedValue({ text: '{"audience": ' });

    const result = await geminiService.proposeArtifactBriefContract(project, request, deterministic, settings);

    expect(result.proposal).toEqual({});
    expect(result.rawResponse).toBe('{"audience": ');
  });

  it('degrada a propuesta vacía si generateContentWithFallback falla', async () => {
    vi.spyOn(geminiService, 'generateContentWithFallback').mockRejectedValue(new Error('timeout'));

    const result = await geminiService.proposeArtifactBriefContract(project, request, deterministic, settings);

    expect(result.proposal).toEqual({});
    expect(result.rawResponse).toBe('');
  });
});
