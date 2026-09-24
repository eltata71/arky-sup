import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiGateway } from '../../../services/ai/generation/aiGateway';
import {
  critiqueArtifactContent,
  refineArtifactContent,
  type ArtifactContentCritiqueRequest,
} from '../../../services/ai/generation/artifactQualityRefinement';

const request = {
  project: { name: 'Portal', description: 'Autoservicio', projectContext: ['Retención de datos'] },
  template: { type: 'document', objective: 'Definir la solución' },
  settings: { aiConfig: { model: 'gemini-2.5-flash', apiKeySource: 'global' } },
  content: '# Diseño actual',
  mode: 'document',
  score: 72,
  issues: ['Falta trazabilidad'],
} as unknown as ArtifactContentCritiqueRequest;

afterEach(() => vi.restoreAllMocks());

describe('quality refinement outside the engine', () => {
  it('the engine no longer owns either prompt', () => {
    const engine = readFileSync('services/ai/generation/artifacts/artifactGenerationEngine.ts', 'utf8');
    expect(engine).not.toMatch(/public async critiqueArtifactContent\(/);
    expect(engine).not.toMatch(/public async refineArtifactContent\(/);
  });

  it('critiques through the shared gateway with the original budget', async () => {
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({ text: '  Añadir trazabilidad.  ' });

    await expect(critiqueArtifactContent(request)).resolves.toBe('Añadir trazabilidad.');
    expect(spy.mock.calls[0][2]).toContain('Falta trazabilidad');
    expect(spy.mock.calls[0][3]).toEqual({ temperature: 0.2 });
    expect(spy.mock.calls[0][4]).toEqual({ maxRetries: 1, maxCandidates: 2 });
  });

  it('refines through the shared gateway and retains the source content', async () => {
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({ text: '  # Diseño mejorado  ' });

    await expect(refineArtifactContent({ ...request, critique: 'Añadir trazabilidad.' }))
      .resolves.toBe('# Diseño mejorado');
    expect(spy.mock.calls[0][2]).toContain('# Diseño actual');
    expect(spy.mock.calls[0][2]).toContain('Añadir trazabilidad.');
    expect(spy.mock.calls[0][3]).toEqual({ temperature: 0.25 });
    expect(spy.mock.calls[0][4]).toEqual({ maxRetries: 1, maxCandidates: 2 });
  });
});
