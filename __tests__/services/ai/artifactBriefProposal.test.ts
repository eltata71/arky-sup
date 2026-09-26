import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { aiGateway } from '../../../services/ai/generation/aiGateway';
import { proposeArtifactBriefContract } from '../../../services/ai/generation/artifactBriefProposal';
import { artifactGenerationService } from '../../../services/ai/generation/artifactGenerationService';
import { buildDeterministicArtifactBrief } from '../../../services/artifacts/domain/artifactBriefService';
import type { Settings } from '../../../types';
import type { Project } from '../../../services/architectureProjects';

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

describe('proposeArtifactBriefContract fuera del motor (F5-01 corte 12)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('el motor ya no la contiene y la fachada sirve la vertical', () => {
    const engine = readFileSync('services/ai/generation/artifacts/artifactGenerationEngine.ts', 'utf8');
    expect(engine).not.toMatch(/public async proposeArtifactBriefContract\(/);
    expect(artifactGenerationService.proposeArtifactBriefContract).toBe(proposeArtifactBriefContract);
  });

  it('descarta campos con el tipo equivocado y respuestas que no son un objeto', async () => {
    vi.spyOn(aiGateway, 'generateContent')
      .mockResolvedValueOnce({ text: JSON.stringify({ audience: 3, acceptanceCriteria: ['A', 2], qualityTarget: 'alto' }) })
      .mockResolvedValueOnce({ text: '["executive"]' });

    const first = await proposeArtifactBriefContract(project, request, deterministic, settings);
    expect(first.proposal).toEqual({ acceptanceCriteria: ['A'] });
    const second = await proposeArtifactBriefContract(project, request, deterministic, settings);
    expect(second.proposal).toEqual({});
  });

  it('parsea JSON válido y pasa por aiGateway', async () => {
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({
      text: JSON.stringify({ audience: 'executive', acceptanceCriteria: ['Cubrir riesgos priorizados.'] }),
    });

    const result = await proposeArtifactBriefContract(project, request, deterministic, settings, { timeoutMs: 1234 });

    expect(result.proposal.audience).toBe('executive');
    expect(result.proposal.acceptanceCriteria).toEqual(['Cubrir riesgos priorizados.']);
    expect(result.rawResponse).toContain('executive');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[4]).toMatchObject({ timeoutMs: 1234, maxRetries: 1 });
  });

  it('tolera texto alrededor del JSON', async () => {
    vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({
      text: 'Propuesta:\n```json\n{"artifactFamily":"matrix","purpose":"validation"}\n```\nFin.',
    });

    const result = await proposeArtifactBriefContract(project, request, deterministic, settings);

    expect(result.proposal.artifactFamily).toBe('matrix');
    expect(result.proposal.purpose).toBe('validation');
  });

  it('maneja JSON inválido devolviendo propuesta vacía y rawResponse', async () => {
    vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({ text: '{"audience": ' });

    const result = await proposeArtifactBriefContract(project, request, deterministic, settings);

    expect(result.proposal).toEqual({});
    expect(result.rawResponse).toBe('{"audience": ');
  });

  it('degrada a propuesta vacía si la llamada falla', async () => {
    vi.spyOn(aiGateway, 'generateContent').mockRejectedValue(new Error('timeout'));

    const result = await proposeArtifactBriefContract(project, request, deterministic, settings);

    expect(result.proposal).toEqual({});
    expect(result.rawResponse).toBe('');
  });
});
