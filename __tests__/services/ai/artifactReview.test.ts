import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiGateway } from '../../../services/ai/generation/aiGateway';
import {
  applyArtifactImprovements,
  generateTestCases,
  reviewArtifact,
  toImprovementProposals,
  type ArtifactImprovementProposal,
} from '../../../services/ai/generation/artifactReview';
import { artifactGenerationService } from '../../../services/ai/generation/artifactGenerationService';
import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../../services/architectureProjects';
import type { Settings } from '../../../types';
import type { ArtifactReviewSuggestion } from '../../../services/review';

const project = {
  id: 'p1',
  name: 'Portal',
  description: 'Autoservicio',
  projectContext: [],
  artifacts: [],
} as unknown as Project;
const artifact = {
  id: 'a1',
  name: 'Vista de contexto',
  type: 'document',
  objective: 'Explicar el alcance',
  content: '# Contexto original',
} as unknown as Artifact;
const settings = {
  language: 'es',
  aiConfig: { model: 'gemini-2.5-flash', apiKeySource: 'global' },
} as unknown as Settings;

const improvement: ArtifactImprovementProposal = {
  id: 'i1',
  title: 'Cifrar en reposo',
  description: 'Declarar la política de cifrado',
  category: 'Security',
};

afterEach(() => vi.restoreAllMocks());

describe('review, improvements and test cases outside the engine (F5-01 corte 11)', () => {
  it('the engine owns none of the three prompts, nor the three uncalled media methods', () => {
    const engine = readFileSync('services/ai/generation/artifacts/artifactGenerationEngine.ts', 'utf8');
    for (const method of [
      'reviewArtifact',
      'applyArtifactImprovements',
      'generateTestCases',
      'generateImageForArtifact',
      'generateSpeechForArtifact',
      'generateSvgForArtifact',
    ]) {
      expect(engine, method).not.toMatch(new RegExp(`public async ${method}\\(`));
    }
  });

  it('the façade serves the vertical, not the engine', () => {
    expect(artifactGenerationService.reviewArtifact).toBe(reviewArtifact);
    expect(artifactGenerationService.applyArtifactImprovements).toBe(applyArtifactImprovements);
    expect(artifactGenerationService.generateTestCases).toBe(generateTestCases);
  });

  it('the port accepts the review context suggestion unchanged', () => {
    const suggestion: ArtifactReviewSuggestion = improvement;
    const proposal: ArtifactImprovementProposal = suggestion;
    expect(proposal).toBe(improvement);
  });

  it('reviews through the gateway with the JSON schema, keeping only well-formed entries', async () => {
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({
      text: `Aquí tienes: ${JSON.stringify([improvement, { id: 'x', title: 'Sin categoría' }])}`,
    });

    await expect(reviewArtifact(artifact, project, settings)).resolves.toEqual([improvement]);
    expect(spy.mock.calls[0][2]).toContain('# Contexto original');
    expect(spy.mock.calls[0][3]).toMatchObject({ responseMimeType: 'application/json' });
  });

  it('a failed review degrades to no suggestions instead of throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(aiGateway, 'generateContent').mockRejectedValue(new Error('503'));
    await expect(reviewArtifact(artifact, project, settings)).resolves.toEqual([]);
  });

  it('applies improvements with the original budget and keeps the content when nothing comes back', async () => {
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({ text: '' });

    await expect(applyArtifactImprovements(artifact, [improvement], project, settings))
      .resolves.toBe('# Contexto original');
    expect(spy.mock.calls[0][2]).toContain('- [Security] Cifrar en reposo: Declarar la política de cifrado');
    expect(spy.mock.calls[0][3]).toEqual({ temperature: 0.3 });
    expect(spy.mock.calls[0][4]).toEqual({ maxRetries: 1, maxCandidates: 4 });
  });

  it('generates test cases in the settings language', async () => {
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({ text: '## Casos' });

    await expect(generateTestCases(artifact, project, settings)).resolves.toBe('## Casos');
    expect(spy.mock.calls[0][2]).toContain('Language: Spanish.');
    expect(spy.mock.calls[0][3]).toEqual({ temperature: 0.7 });
  });

  it('a non-array answer yields no proposals', () => {
    expect(toImprovementProposals({ id: 'x' })).toEqual([]);
    expect(toImprovementProposals(null)).toEqual([]);
  });
});
